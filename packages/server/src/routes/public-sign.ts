/**
 * Public (no-JWT) document signing routes.
 *
 * Intended use:
 * - GP creates a signing link for a PDF document
 * - signer views and signs the PDF via a public URL
 * - server stores an audit record and returns a short-lived ndaProofToken
 */

import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDb } from '../db/database';
import { readStoredFile, saveUploadedBuffer } from '../lib/storage';
import { sendTransactionalEmail } from '../lib/email';

const router = Router();
const DEFAULT_DATE_FIELD_VALUE = () => new Date().toISOString().slice(0, 10);

function getNdaNotifyEmails(): string[] {
  const configured = String(process.env.NDA_SIGN_NOTIFY_EMAILS || '').trim();
  const fallback = 'jamesanfossi@hotmail.com,lancefraser89@gmail.com';
  return (configured || fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

function getValidLinkAndDoc(db: ReturnType<typeof getDb>, rawToken: string) {
  const h = tokenHash(rawToken);
  const link = db.prepare(
    `SELECT * FROM document_signing_links WHERE token_hash = ? LIMIT 1`
  ).get(h) as SigningLinkRow | undefined;
  if (!link) return { error: 'Invalid or expired link' as const };
  if (link.expires_at && isExpired(link.expires_at)) return { error: 'Invalid or expired link' as const };
  if (link.is_single_use && link.used_at) return { error: 'This link has already been used' as const };

  const doc = db.prepare(
    `SELECT id, name, file_path, file_type, requires_signature, signed_at
     FROM documents WHERE id = ? LIMIT 1`
  ).get(link.document_id) as DocumentRow | undefined;
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

function isFullName(value: string): boolean {
  const v = String(value || '').trim();
  return /^[A-Za-z][A-Za-z'`.-]*\s+[A-Za-z][A-Za-z'`.-]*(?:\s+[A-Za-z][A-Za-z'`.-]*)*$/.test(v);
}

// GET /api/public/sign/:token - metadata for signing page
router.get('/:token', (req: Request, res: Response) => {
  const db = getDb();
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = getValidLinkAndDoc(db, token);
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
  const db = getDb();
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = getValidLinkAndDoc(db, token);
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
  const db = getDb();
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = getValidLinkAndDoc(db, token);
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
  const db = getDb();
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

  const name = formValues.Name || fallbackName;
  const recipient = formValues.Recipient || fallbackRecipient || name;
  const sig = formValues['Signature_es_:signatureblock'] || fallbackSig;
  const date = DEFAULT_DATE_FIELD_VALUE(); // always auto-filled
  const email = String(body.signerEmail || '').trim();

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!sig) return res.status(400).json({ error: 'Signature is required' });
  if (!isFullName(sig)) return res.status(400).json({ error: 'Signature must be full name (first and last)' });

  const result = getValidLinkAndDoc(db, token);
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
    const form = pdf.getForm();

    // Fill AcroForm fields in the original PDF and flatten so they can't be edited after signing.
    try {
      if (recipient) form.getTextField('Recipient').setText(recipient);
      if (formValues.Name || fallbackName) form.getTextField('Name').setText(name);
      // Always override date with "today" (user requested auto-fill).
      try { form.getTextField('Date').setText(date); } catch {}
      try { form.getTextField('Signature_es_:signatureblock').setText(sig); } catch {}
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
    const stored = await saveUploadedBuffer(
      executedBytes,
      'signed-documents',
      `executed-${result.doc.id}.pdf`,
      'application/pdf'
    );

    const insert = db.prepare(`
      INSERT INTO document_signatures (
        document_id, signing_link_id,
        signer_name, signer_email, signer_company, signer_title, signature_text,
        signed_ip, signed_user_agent,
        original_pdf_sha256,
        executed_file_path, executed_pdf_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const sigResult = insert.run(
      result.doc.id,
      result.link.id,
      name,
      email || null,
      recipient || null,
      fallbackTitle || null,
      sig,
      ip || null,
      ua || null,
      originalHash,
      stored.filePath,
      executedHash
    );

    // For reusable links (e.g., NDA signed by many visitors), don't mark the underlying
    // document row as "signed" globally. Keep `signed_at` for single-use workflows only.
    if (result.link.is_single_use) {
      db.prepare(`UPDATE documents SET signed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(result.doc.id);
      db.prepare(`UPDATE document_signing_links SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(result.link.id);
    }

    const signatureId = Number(sigResult.lastInsertRowid);
    const ndaProofToken = jwt.sign(
      { typ: 'nda_proof', signatureId, documentId: result.doc.id },
      getJwtSecret(),
      { expiresIn: '10m' }
    );

    // Best-effort email notification (won't block signing if email provider isn't configured).
    try {
      const notify = getNdaNotifyEmails();
      if (notify.length > 0) {
        const to = notify[0]!;
        const bcc = notify.slice(1);
        const subject = `NDA signed: ${result.doc.name}`;
        const text =
          `A new NDA was signed.\n\n` +
          `Recipient (company receiving NDA): ${recipient}\n` +
          `Signer name: ${name}\n` +
          `Signer email: ${email || '(none provided)'}\n` +
          `Date (auto-filled): ${date}\n` +
          `Signed at (UTC): ${signedAtIso}\n\n` +
          `Executed PDF path: ${stored.filePath}\n` +
          `Original PDF SHA-256: ${originalHash}\n` +
          `Executed PDF SHA-256: ${executedHash}\n\n` +
          `IP: ${ip}\n` +
          `User-Agent: ${ua}\n`;
        const sent = await sendTransactionalEmail({ to, bcc: bcc.length > 0 ? bcc : undefined, subject, text });
        if (!sent) {
          console.error(`NDA notification email was not sent for signatureId=${signatureId} docId=${result.doc.id}`);
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

