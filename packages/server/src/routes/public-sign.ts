/**
 * Public (no-JWT) document signing routes.
 *
 * Intended use:
 * - GP creates a signing link for a PDF document
 * - signer views and signs the PDF via a public URL
 * - server stores an audit record and returns a short-lived ndaProofToken
 */

import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import bcrypt from 'bcryptjs';
import { readStoredFile, saveUploadedBuffer } from '../lib/storage';
import { sendTransactionalEmail } from '../lib/email';
import {
  getDocumentById,
  getSigningLinkByTokenHash,
  insertDocumentSignature,
  markDocumentAndLinkUsed,
} from '../db/repositories/documents-repository';

const router = Router();
const DEFAULT_DATE_FIELD_VALUE = () => new Date().toISOString().slice(0, 10);
const SIGNATURE_FONT_CANDIDATES = [
  path.resolve(__dirname, '../../node_modules/@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff'),
  path.resolve(process.cwd(), 'packages/server/node_modules/@fontsource/dancing-script/files/dancing-script-latin-700-normal.woff'),
];
let cachedSignatureFontBytes: Buffer | null | undefined;

function getSignatureFontBytes(): Uint8Array | null {
  if (cachedSignatureFontBytes !== undefined) return cachedSignatureFontBytes ? new Uint8Array(cachedSignatureFontBytes) : null;
  for (const candidate of SIGNATURE_FONT_CANDIDATES) {
    try {
      if (!fs.existsSync(candidate)) continue;
      cachedSignatureFontBytes = fs.readFileSync(candidate);
      return new Uint8Array(cachedSignatureFontBytes);
    } catch {
      // Try next candidate path.
    }
  }
  cachedSignatureFontBytes = null;
  return null;
}

function getNdaNotifyEmails(): string[] {
  const configured = String(process.env.NDA_SIGN_NOTIFY_EMAILS || '').trim();
  const mandatoryBcc = ['james.anfossi@accountingbda.com', 'lancefraser89@gmail.com'];
  const configuredList = (configured || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([...configuredList, ...mandatoryBcc]));
}

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.trim().length > 0) return configured;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'dev-secret-change-me';
}

function sha256Hex(input: Buffer | string): string {
  // TS/Node typings can disagree on Buffer's ArrayBufferLike; cast to keep runtime correct.
  return createHash('sha256').update(input as any).digest('hex');
}

function tokenHash(rawToken: string): string {
  return sha256Hex(String(rawToken || '').trim());
}

function generateInvestorAccessCode(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

function isExpired(expiresAt: unknown): boolean {
  if (!expiresAt) return false;
  const t = new Date(String(expiresAt)).getTime();
  if (!Number.isFinite(t)) return false;
  return t < Date.now();
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  // Node's Buffer/Uint8Array typings can be finicky across TS/lib versions.
  // We only need a Buffer at the end; keep this permissive.
  const chunks: any[] = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (c) => {
      if (c instanceof Uint8Array) chunks.push(c);
      else chunks.push(Buffer.from(c));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function storageKeyFromFilePath(filePath: string): string | null {
  const fp = String(filePath || '');
  if (fp.startsWith('/api/files/')) return decodeURIComponent(fp.replace('/api/files/', ''));
  if (fp.startsWith('/uploads/')) return fp.replace('/uploads/', '');
  return null;
}

type SigningLinkRow = {
  id: number;
  document_id: number;
  token_hash: string;
  is_single_use: number;
  expires_at: string | null;
  used_at: string | null;
};

type DocumentRow = {
  id: number;
  name: string;
  file_path: string;
  file_type: string;
  requires_signature: number;
  signed_at: string | null;
};

function normalizeFieldName(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickFirstValue(formValues: Record<string, string>, candidateNames: string[]): string {
  for (const key of candidateNames) {
    const v = String(formValues[key] || '').trim();
    if (v) return v;
  }
  const normalizedMap = new Map<string, string>();
  for (const [k, v] of Object.entries(formValues)) {
    normalizedMap.set(normalizeFieldName(k), String(v || '').trim());
  }
  for (const key of candidateNames) {
    const v = String(normalizedMap.get(normalizeFieldName(key)) || '').trim();
    if (v) return v;
  }
  for (const [k, v] of normalizedMap.entries()) {
    for (const candidate of candidateNames) {
      const target = normalizeFieldName(candidate);
      if (!target) continue;
      if (k.includes(target) || target.includes(k)) {
        if (v) return v;
      }
    }
  }
  return '';
}

function getFieldByCandidates(form: ReturnType<PDFDocument['getForm']>, candidateNames: string[]) {
  for (const f of form.getFields()) {
    const actualName = f.getName();
    if (candidateNames.includes(actualName)) return { name: actualName, field: f as any };
  }
  const wanted = new Set(candidateNames.map((n) => normalizeFieldName(n)));
  for (const f of form.getFields()) {
    const actualName = f.getName();
    const actualNormalized = normalizeFieldName(actualName);
    const isDirectMatch = wanted.has(actualNormalized);
    const isFuzzyMatch = !isDirectMatch && candidateNames.some((n) => {
      const candidate = normalizeFieldName(n);
      return candidate && (actualNormalized.includes(candidate) || candidate.includes(actualNormalized));
    });
    if (isDirectMatch || isFuzzyMatch) return { name: actualName, field: f as any };
  }
  return null;
}

function getTextFieldByCandidates(form: ReturnType<PDFDocument['getForm']>, candidateNames: string[]) {
  for (const name of candidateNames) {
    try {
      const f = form.getTextField(name);
      return { name, field: f };
    } catch {
      // Try the next candidate name.
    }
  }
  const matched = getFieldByCandidates(form, candidateNames);
  if (matched) {
    try {
      const tf = form.getTextField(matched.name);
      return { name: matched.name, field: tf };
    } catch {
      // Matched field exists but is not a text field.
    }
  }
  return null;
}

async function getValidLinkAndDoc(rawToken: string) {
  const h = tokenHash(rawToken);
  const link = (await getSigningLinkByTokenHash(h)) as SigningLinkRow | null;
  if (!link) return { error: 'Invalid or expired link' as const };
  if (link.expires_at && isExpired(link.expires_at)) return { error: 'Invalid or expired link' as const };
  if (link.is_single_use && link.used_at) return { error: 'This link has already been used' as const };

  const doc = (await getDocumentById(link.document_id)) as DocumentRow | null;
  if (!doc) return { error: 'Document not found' as const };
  if (!doc.file_type?.includes('pdf')) return { error: 'Only PDF documents can be signed' as const };
  if (!doc.requires_signature) return { error: 'This document does not require a signature' as const };

  return { link, doc };
}

function labelForFieldName(fieldName: string) {
  const n = String(fieldName || '');
  if (n === 'Signature_es_:signatureblock') return 'Signature';
  return n;
}

function pickSignerEmail(explicitEmail: unknown, formValues: Record<string, string>): string {
  const direct = String(explicitEmail || '').trim();
  if (direct && direct.includes('@')) return direct;

  const preferredKeys = ['Email', 'E-mail', 'email', 'signerEmail', 'Signer Email'];
  for (const key of preferredKeys) {
    const v = String(formValues[key] || '').trim();
    if (v && v.includes('@')) return v;
  }

  for (const [k, v] of Object.entries(formValues)) {
    if (!/email/i.test(k)) continue;
    const candidate = String(v || '').trim();
    if (candidate && candidate.includes('@')) return candidate;
  }
  return '';
}

function isFullName(value: string): boolean {
  const v = String(value || '').trim();
  return /^[A-Za-z][A-Za-z'`.-]*\s+[A-Za-z][A-Za-z'`.-]*(?:\s+[A-Za-z][A-Za-z'`.-]*)*$/.test(v);
}

// GET /api/public/sign/:token - metadata for signing page
router.get('/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = await getValidLinkAndDoc(token);
  if ('error' in result) return res.status(400).json({ error: result.error });

  res.json({
    document: {
      id: result.doc.id,
      name: result.doc.name,
    },
    alreadySigned: !!result.doc.signed_at,
  });
});

// GET /api/public/sign/:token/form-fields - list PDF form fields (for dynamic UI)
router.get('/:token/form-fields', async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = await getValidLinkAndDoc(token);
  if ('error' in result) return res.status(400).json({ error: result.error });

  const storageKey = storageKeyFromFilePath(result.doc.file_path);
  if (!storageKey) return res.status(500).json({ error: 'Unsupported document storage path' });

  try {
    const file = await readStoredFile(storageKey);
    const originalBytes = await streamToBuffer(file.body);
    const pdf = await PDFDocument.load(originalBytes as any);
    const form = pdf.getForm();
    const fields = form.getFields().map((f) => {
      const name = f.getName();
      const isDate = name.toLowerCase() === 'date';
      const isRecipient = name.toLowerCase() === 'recipient';
      const required = !isDate && !isRecipient; // recipient is auto-populated from signer name
      return {
        name,
        label: labelForFieldName(name),
        type: 'text' as const,
        required,
        readOnly: isDate || isRecipient,
        defaultValue: isDate ? DEFAULT_DATE_FIELD_VALUE() : '',
      };
    });
    res.json({ fields });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to read PDF fields' });
  }
});

// GET /api/public/sign/:token/document - stream original PDF
router.get('/:token/document', async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = await getValidLinkAndDoc(token);
  if ('error' in result) return res.status(400).json({ error: result.error });

  const storageKey = storageKeyFromFilePath(result.doc.file_path);
  if (!storageKey) return res.status(500).json({ error: 'Unsupported document storage path' });

  try {
    const file = await readStoredFile(storageKey);
    res.setHeader('Content-Type', result.doc.file_type || 'application/pdf');
    // Let browsers cache lightly; token gating is the primary protection.
    res.setHeader('Cache-Control', 'private, max-age=300');
    file.body.pipe(res);
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'File not found' });
  }
});

// POST /api/public/sign/:token/submit - submit signature and return ndaProofToken
router.post('/:token/submit', async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const body = req.body || {};
  const rawFormValues = body.formValues && typeof body.formValues === 'object' ? body.formValues : {};
  const formValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFormValues)) {
    formValues[String(k)] = String(v ?? '').trim();
  }

  // Back-compat with older payloads (before dynamic PDF fields).
  const fallbackName = String(body.signerName || '').trim();
  const fallbackRecipient = String(body.signerCompany || '').trim();
  const fallbackTitle = String(body.signerTitle || '').trim();
  const fallbackSig = String(body.signatureText || '').trim();

  const name = pickFirstValue(formValues, ['Name', 'FullName', 'Full Name', 'SignerName', 'Signer Name']) || fallbackName;
  const recipient = pickFirstValue(formValues, ['Recipient', 'Company', 'SignerCompany', 'Signer Company']) || fallbackRecipient || name;
  const sig =
    pickFirstValue(formValues, [
      'Signature_es_:signatureblock',
      'Signature',
      'SignerSignature',
      'Signer Signature',
      'SignedBy',
      'Signed By',
    ]) || fallbackSig;
  const date = DEFAULT_DATE_FIELD_VALUE(); // always auto-filled
  const email = pickSignerEmail(body.signerEmail, formValues);

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!sig) return res.status(400).json({ error: 'Signature is required' });
  if (!isFullName(sig)) return res.status(400).json({ error: 'Signature must be full name (first and last)' });

  const result = await getValidLinkAndDoc(token);
  if ('error' in result) return res.status(400).json({ error: result.error });

  const storageKey = storageKeyFromFilePath(result.doc.file_path);
  if (!storageKey) return res.status(500).json({ error: 'Unsupported document storage path' });

  try {
    const file = await readStoredFile(storageKey);
    const originalBytes = await streamToBuffer(file.body);
    const originalHash = sha256Hex(originalBytes);

    // Append a simple “signature certificate” page to the PDF.
    const pdf = await PDFDocument.load(originalBytes as any);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let signatureFont = await pdf.embedFont(StandardFonts.TimesRomanItalic);
    try {
      const signatureFontBytes = getSignatureFontBytes();
      if (signatureFontBytes) {
        pdf.registerFontkit(fontkit);
        signatureFont = await pdf.embedFont(signatureFontBytes, { subset: true });
      }
    } catch {
      // Fall back to TimesRomanItalic if custom script font fails to load.
    }
    const form = pdf.getForm();

    // Fill AcroForm fields in the original PDF and flatten so they can't be edited after signing.
    try {
      if (recipient) {
        const recipientField = getTextFieldByCandidates(form, ['Recipient', 'Company', 'SignerCompany', 'Signer Company']);
        if (recipientField) recipientField.field.setText(recipient);
      }
      if (name) {
        const nameField = getTextFieldByCandidates(form, ['Name', 'FullName', 'Full Name', 'SignerName', 'Signer Name']);
        if (nameField) nameField.field.setText(name);
      }
      // Always override date with "today" (user requested auto-fill).
      try {
        const dateField = getTextFieldByCandidates(form, ['Date', 'SignedDate', 'Signed Date', 'ExecutionDate', 'Execution Date']);
        if (dateField) dateField.field.setText(date);
      } catch {}
      try {
        const signatureFieldMatch = getFieldByCandidates(form, [
          'Signature_es_:signatureblock',
          'Signature',
          'SignerSignature',
          'Signer Signature',
          'SignedBy',
          'Signed By',
        ]);
        if (!signatureFieldMatch) throw new Error('No signature field found');
        let signatureTextField: any = null;
        try {
          signatureTextField = form.getTextField(signatureFieldMatch.name);
          signatureTextField.setText(sig);
          // Render the signature line with a cursive-style font instead of plain sans-serif text.
          signatureTextField.updateAppearances(signatureFont);
          signatureTextField.setFontSize(18);
        } catch {
          // Signature can be a PDFSignature field; we'll draw visual text directly on its widget rect.
        }
        if (sig) {
          const widgets = ((signatureFieldMatch.field as any)?.acroField?.getWidgets?.() || []) as any[];
          const pages = pdf.getPages();
          const fallbackPage = pages[2] || pages[pages.length - 1];
          for (const widget of widgets) {
            const rect = widget?.getRectangle?.();
            if (!rect) continue;
            const widgetPageRef = widget?.getP?.() || widget?.getOrCreateP?.();
            const page = pages.find((p) => String((p as any)?.ref) === String(widgetPageRef)) || fallbackPage;
            if (!page) continue;
            const fieldHeight = Number(rect.height || 22);
            const size = Math.max(16, Math.min(22, fieldHeight * 0.85));
            const x = Number(rect.x || 80) + 2;
            const y = Number(rect.y || 120) + Math.max(0.5, (fieldHeight - size) * 0.45);
            page.drawText(sig, {
              x,
              y,
              size,
              font: signatureFont,
              color: rgb(0.12, 0.2, 0.45),
              opacity: 0.98,
            });
          }
          if (signatureTextField) signatureTextField.setText('');
        }
      } catch {}
      form.updateFieldAppearances(font);
      form.flatten();
    } catch {
      // If the PDF has an unexpected form structure, keep going with certificate page.
    }

    const signedAtIso = new Date().toISOString();
    const ua = String(req.get('user-agent') || '');
    const ip = String(req.ip || '');
    const stampRef = sha256Hex(`${name}|${sig}|${signedAtIso}|${originalHash}`).slice(0, 12).toUpperCase();

    // Draw a visible, unique signature stamp on each page.
    const stampText = `E-SIGNED ${name} | ${signedAtIso} | REF ${stampRef}`;
    for (const p of pdf.getPages()) {
      const { width } = p.getSize();
      const stampWidth = Math.min(width - 80, 430);
      const stampX = 40;
      const stampY = 16;
      p.drawRectangle({
        x: stampX,
        y: stampY,
        width: stampWidth,
        height: 20,
        color: rgb(0.93, 0.96, 1),
        borderColor: rgb(0.2, 0.35, 0.7),
        borderWidth: 0.8,
        opacity: 0.95,
      });
      p.drawText(stampText.slice(0, 120), {
        x: stampX + 6,
        y: stampY + 6,
        size: 8,
        font: fontBold,
        color: rgb(0.16, 0.28, 0.56),
      });
    }

    const lines = [
      'Signature Certificate',
      '',
      `Document: ${result.doc.name}`,
      `Recipient: ${recipient}`,
      `Signer: ${name}${email ? ` <${email}>` : ''}`,
      ...(fallbackTitle ? [`Title: ${fallbackTitle}`] : []),
      `Date: ${date}`,
      `Signature: ${sig}`,
      `Signature Reference: ${stampRef}`,
      `Signed at (UTC): ${signedAtIso}`,
      `IP: ${ip}`,
      `User-Agent: ${ua}`,
      `Original PDF SHA-256: ${originalHash}`,
    ];

    const page = pdf.addPage();
    const { height } = page.getSize();
    let y = height - 60;
    page.drawText(lines[0], { x: 50, y, size: 18, font: fontBold });
    y -= 30;
    for (const line of lines.slice(1)) {
      page.drawText(line, { x: 50, y, size: 10, font });
      y -= 16;
      if (y < 40) break;
    }

    const executedBytes = Buffer.from(await pdf.save());
    const executedHash = sha256Hex(executedBytes);
    const investorAccessCode = generateInvestorAccessCode(10);
    const investorAccessCodeHash = bcrypt.hashSync(investorAccessCode, 10);
    const stored = await saveUploadedBuffer(
      executedBytes,
      'signed-documents',
      `executed-${result.doc.id}.pdf`,
      'application/pdf'
    );

    const signatureId = await insertDocumentSignature({
      documentId: result.doc.id,
      signingLinkId: result.link.id,
      signerName: name,
      signerEmail: email || null,
      signerCompany: recipient || null,
      signerTitle: fallbackTitle || null,
      signatureText: sig,
      investorGatePasswordHash: investorAccessCodeHash,
      signedIp: ip || null,
      signedUserAgent: ua || null,
      originalPdfSha256: originalHash,
      executedFilePath: stored.filePath,
      executedPdfSha256: executedHash,
    });

    // For reusable links (e.g., NDA signed by many visitors), don't mark the underlying
    // document row as "signed" globally. Keep `signed_at` for single-use workflows only.
    if (result.link.is_single_use) {
      await markDocumentAndLinkUsed(result.doc.id, result.link.id);
    }

    const ndaProofToken = jwt.sign(
      { typ: 'nda_proof', signatureId, documentId: result.doc.id },
      getJwtSecret(),
      { expiresIn: '10m' }
    );

    // Best-effort emails (won't block signing if provider isn't configured).
    try {
      const signerEmail = String(email || '').trim();
      const notify = getNdaNotifyEmails()
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((addr, i, all) => all.findIndex((a) => a.toLowerCase() === addr.toLowerCase()) === i);
      const attachment = {
        filename: `signed-${result.doc.id}.pdf`,
        contentType: 'application/pdf',
        contentBase64: executedBytes.toString('base64'),
      };

      if (notify.length > 0) {
        const subject = `NDA signed: ${result.doc.name}`;
        const text =
          `A new NDA was signed.\n\n` +
          `Recipient (company receiving NDA): ${recipient}\n` +
          `Signer name: ${name}\n` +
          `Signer email: ${email || '(none provided)'}\n` +
          `Investor access code: ${investorAccessCode}\n` +
          `Date (auto-filled): ${date}\n` +
          `Signed at (UTC): ${signedAtIso}\n\n` +
          `Executed PDF path: ${stored.filePath}\n` +
          `Original PDF SHA-256: ${originalHash}\n` +
          `Executed PDF SHA-256: ${executedHash}\n\n` +
          `IP: ${ip}\n` +
          `User-Agent: ${ua}\n`;
        const sent = await sendTransactionalEmail({
          to: 'info@305opportunityfund.com',
          bcc: notify,
          subject,
          text,
          attachments: [attachment],
        });
        if (!sent) {
          console.error(`NDA notification email was not sent for signatureId=${signatureId} docId=${result.doc.id}`);
        }
      }

      if (signerEmail) {
        const subject = `Your signed NDA copy + password - 305 Opportunity Fund`;
        const text =
          `Hi ${name},\n\n` +
          `Thank you for signing the NDA for ${recipient}.\n` +
          `Attached is your signed PDF copy for your records.\n\n` +
          `Your investor access code: ${investorAccessCode}\n` +
          `Use this code on the investor unlock page.\n\n` +
          `Signed at (UTC): ${signedAtIso}\n` +
          `Date shown on document: ${date}\n\n` +
          `If you have any questions, please email lancefraser89@gmail.com and jamesanfossi@hotmail.com.\n\n` +
          `Best regards,\n` +
          `305 Opportunities Fund Team`;
        const sent = await sendTransactionalEmail({
          to: signerEmail,
          subject,
          text,
          attachments: [attachment],
        });
        if (!sent) {
          console.error(`Signer confirmation email was not sent for signatureId=${signatureId} docId=${result.doc.id}`);
        }
      }
    } catch {
      // Ignore notification failures.
    }

    res.json({ success: true, ndaProofToken });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to sign document' });
  }
});

export default router;

