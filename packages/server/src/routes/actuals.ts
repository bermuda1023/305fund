import { Router, type Request, type Response } from 'express';
import { requireAuth, requireGP } from '../middleware/auth';
import { getDb } from '../db/database';
import multer from 'multer';
import path from 'path';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import { deleteStoredFile, saveUploadedBuffer } from '../lib/storage';
import { createHash } from 'crypto';
import { writeAuditLog } from '../lib/audit';
import { listActualTransactions } from '../db/repositories/actuals-repository';

const router = Router();
router.use(requireAuth, requireGP);

/* ── Multer config for statement file uploads ─────────────────── */

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/x-ofx',
      'application/ofx',
      'text/ofx',
      'application/vnd.intu.qfx',
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ['.pdf', '.ofx', '.qfx', '.csv', '.xls', '.xlsx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, OFX, CSV, and Excel files are accepted for upload'));
    }
  },
});

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only image receipts are supported (jpg, png, webp, heic).'));
  },
});

/* ── Category auto-mapping patterns ──────────────────────────── */

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\bhoa\b/i, category: 'hoa' },
  { pattern: /\bmaintenance\b/i, category: 'hoa' },
  { pattern: /\bassociation\b/i, category: 'hoa' },
  { pattern: /\brent\b/i, category: 'rent' },
  { pattern: /\blease\b/i, category: 'rent' },
  { pattern: /\btenant\b/i, category: 'rent' },
  { pattern: /\binsurance\b/i, category: 'insurance' },
  { pattern: /\btax\b/i, category: 'tax' },
  { pattern: /\bproperty tax\b/i, category: 'tax' },
  { pattern: /\brepair\b/i, category: 'repair' },
  { pattern: /\bplumb/i, category: 'repair' },
  { pattern: /\belectri/i, category: 'repair' },
  { pattern: /\bhvac\b/i, category: 'repair' },
  { pattern: /\bcapital call\b/i, category: 'capital_call' },
  { pattern: /\bdistribut/i, category: 'distribution' },
  { pattern: /\bmanagement fee\b/i, category: 'management_fee' },
  { pattern: /\bmgmt fee\b/i, category: 'management_fee' },
  { pattern: /\bfund expense\b/i, category: 'fund_expense' },
  { pattern: /\badmin fee\b/i, category: 'fund_expense' },
  { pattern: /\baccounting\b/i, category: 'fund_expense' },
  { pattern: /\blegal\b/i, category: 'fund_expense' },
];

// Unit number extraction pattern (e.g., "Unit 6N", "Unit 12E&F", "12A")
const UNIT_NUMBER_PATTERN = /\b(?:unit\s*)?(\d{1,2}[A-Z](?:&[A-Z])?)\b/i;
const MAX_STATEMENT_ROWS = 5000;
const MAX_STATEMENT_COLS = 60;

function monthKey(dateIso: string): string | null {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function assertPeriodOpen(db: ReturnType<typeof getDb>, dateIso: string) {
  const m = monthKey(dateIso);
  if (!m) return;
  const row = db.prepare(`SELECT status FROM accounting_periods WHERE month = ?`).get(m) as any;
  if (row && String(row.status) === 'closed') {
    const err: any = new Error(`Accounting period ${m} is closed`);
    err.statusCode = 409;
    throw err;
  }
}

function autoMapCategory(description: string, existingCategory?: string): string {
  if (existingCategory && existingCategory !== 'other') return existingCategory;
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(description)) return category;
  }
  return existingCategory || 'other';
}

function autoMapUnit(description: string, unitLookup: Map<string, number>): number | null {
  const match = description.match(UNIT_NUMBER_PATTERN);
  if (match) {
    const unitNum = match[1].toUpperCase();
    return unitLookup.get(unitNum) ?? null;
  }
  return null;
}

/**
 * Check learned mappings for a description match.
 * Returns { portfolio_unit_id, category } if a mapping matches.
 */
function checkLearnedMappings(
  description: string,
  learnedMappings: Array<{ description_pattern: string; portfolio_unit_id: number; category: string | null }>
): { unitId: number | null; category: string | null } {
  const descLower = description.toLowerCase();
  for (const mapping of learnedMappings) {
    if (descLower.includes(mapping.description_pattern.toLowerCase())) {
      return {
        unitId: mapping.portfolio_unit_id,
        category: mapping.category || null,
      };
    }
  }
  return { unitId: null, category: null };
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  const neg = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed
    .replace(/[$,%\s]/g, '')
    .replace(/,/g, '')
    .replace(/[()]/g, '');
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  return neg ? -num : num;
}

function parseDateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date
    const excelEpoch = Date.UTC(1899, 11, 30);
    const millis = excelEpoch + value * 24 * 60 * 60 * 1000;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const date = new Date(s);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  return null;
}

function monthDayFromDate(dateIso: string): { month: number; day: number } | null {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return { month: d.getMonth() + 1, day: d.getDate() };
}

function syncUnitExpenseFromActual(
  db: ReturnType<typeof getDb>,
  row: {
    id: number;
    portfolio_unit_id: number | null;
    date: string;
    amount: number;
    category: string;
    description: string | null;
    source_file: string | null;
    statement_ref?: string | null;
    reconciled: number;
  }
) {
  if (!row.portfolio_unit_id) return;
  if (!['hoa', 'insurance', 'tax', 'repair'].includes(row.category)) return;
  if (row.amount >= 0) return; // Only apply expense outflows.

  const statementRef = String(row.statement_ref || '').trim();
  const fallbackRef = String(row.source_file || '').trim() || String(row.description || '').trim();
  const ref = statementRef || fallbackRef;
  // Only apply model-affecting updates once explicitly reconciled.
  // A statement ref existing just means "imported from a statement", not "reviewed/confirmed".
  const shouldApply = Number(row.reconciled) === 1;
  if (!ref || !shouldApply) return;

  const md = monthDayFromDate(row.date);

  if (row.category === 'hoa') {
    db.prepare(`
      UPDATE portfolio_units
      SET hoa_reconcile_ref = ?
      WHERE id = ?
    `).run(ref, row.portfolio_unit_id);
    return;
  }

  if (row.category === 'insurance') {
    db.prepare(`
      UPDATE portfolio_units
      SET insurance_reconcile_ref = ?,
          insurance_payment_month = COALESCE(?, insurance_payment_month),
          insurance_payment_day = COALESCE(?, insurance_payment_day)
      WHERE id = ?
    `).run(ref, md?.month ?? null, md?.day ?? null, row.portfolio_unit_id);
    return;
  }

  if (row.category === 'tax') {
    db.prepare(`
      UPDATE portfolio_units
      SET tax_reconcile_ref = ?,
          tax_payment_month = COALESCE(?, tax_payment_month),
          tax_payment_day = COALESCE(?, tax_payment_day)
      WHERE id = ?
    `).run(ref, md?.month ?? null, md?.day ?? null, row.portfolio_unit_id);
    return;
  }

  // Attempt to auto-link repair cash out to the most relevant unit renovation.
  if (row.category === 'repair') {
    const reno = db.prepare(`
      SELECT id, COALESCE(actual_cost, estimated_cost, 0) as budget
      FROM unit_renovations
      WHERE portfolio_unit_id = ?
      ORDER BY
        CASE status
          WHEN 'in_progress' THEN 0
          WHEN 'planned' THEN 1
          WHEN 'completed' THEN 2
          ELSE 3
        END ASC,
        ABS(COALESCE(actual_cost, estimated_cost, 0) - ABS(?)) ASC,
        id DESC
      LIMIT 1
    `).get(row.portfolio_unit_id, row.amount) as any;
    if (!reno) return;

    db.prepare(`
      UPDATE unit_renovations
      SET reconcile_ref = ?,
          reconciled = CASE WHEN ? = 1 THEN 1 ELSE reconciled END,
          actual_cost = CASE
            WHEN actual_cost IS NULL OR actual_cost = 0 THEN ABS(?)
            ELSE actual_cost
          END,
          start_date = COALESCE(start_date, ?)
      WHERE id = ?
    `).run(ref, Number(row.reconciled), row.amount, row.date, reno.id);
  }
}

function quarterFromDate(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return '';
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function recalcCapitalCallItemFromTransactions(db: ReturnType<typeof getDb>, itemId: number) {
  const item = db.prepare(`
    SELECT id, capital_call_id, amount
    FROM capital_call_items
    WHERE id = ?
  `).get(itemId) as any;
  if (!item) return null;

  const agg = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_received
    FROM capital_transactions
    WHERE capital_call_item_id = ? AND type = 'call'
  `).get(itemId) as any;
  const totalReceived = Number(agg?.total_received || 0);
  const itemAmount = Number(item.amount || 0);

  if (totalReceived <= 0) {
    db.prepare(`
      UPDATE capital_call_items
      SET status = 'pending',
          received_amount = NULL,
          received_at = NULL
      WHERE id = ?
    `).run(itemId);
  } else {
    const isFullyReceived = totalReceived + 0.0001 >= itemAmount;
    db.prepare(`
      UPDATE capital_call_items
      SET status = ?,
          received_amount = ?,
          received_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(isFullyReceived ? 'received' : 'pending', totalReceived, itemId);
  }

  return Number(item.capital_call_id);
}

function recalcCapitalCallStatus(db: ReturnType<typeof getDb>, callId: number) {
  const agg = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received_count,
      COUNT(*) as total_count
    FROM capital_call_items
    WHERE capital_call_id = ?
  `).get(callId) as any;
  if (!agg) return;

  const nextStatus =
    Number(agg.received_count || 0) === 0 ? 'sent' :
    Number(agg.received_count || 0) < Number(agg.total_count || 0) ? 'partially_received' :
    'completed';
  db.prepare('UPDATE capital_calls SET status = ? WHERE id = ?').run(nextStatus, callId);
}

function recalcLpCalledCapital(db: ReturnType<typeof getDb>, lpAccountId: number) {
  db.prepare(`
    UPDATE lp_accounts
    SET called_capital = COALESCE((
      SELECT SUM(cci.amount)
      FROM capital_call_items cci
      JOIN capital_calls cc ON cc.id = cci.capital_call_id
      WHERE cci.lp_account_id = lp_accounts.id
        AND cc.status IN ('sent', 'partially_received', 'completed')
    ), 0)
    WHERE id = ?
  `).run(lpAccountId);
}

function syncCapitalCallFromActual(
  db: ReturnType<typeof getDb>,
  row: {
    id: number;
    lp_account_id: number | null;
    capital_call_item_id: number | null;
    date: string;
    amount: number;
    category: string;
    reconciled?: number;
  },
  previousLpId?: number | null,
  previousCallItemId?: number | null
) {
  const note = `Actuals capital call txn #${row.id}`;
  const existing = db.prepare(`
    SELECT id, lp_account_id, capital_call_item_id
    FROM capital_transactions
    WHERE notes = ?
    LIMIT 1
  `).get(note) as any;

  // Only treat a bank credit as a "received" capital call once reconciled.
  const shouldSync = row.category === 'capital_call'
    && !!row.lp_account_id
    && !!row.capital_call_item_id
    && row.amount > 0
    && Number(row.reconciled || 0) === 1;
  if (!shouldSync) {
    if (existing) {
      db.prepare(`DELETE FROM capital_transactions WHERE id = ?`).run(existing.id);
      recalcLpCalledCapital(db, Number(existing.lp_account_id));
      if (existing.capital_call_item_id) {
        const callId = recalcCapitalCallItemFromTransactions(db, Number(existing.capital_call_item_id));
        if (callId) recalcCapitalCallStatus(db, callId);
      }
    }
    if (previousLpId && (!existing || Number(existing.lp_account_id) !== Number(previousLpId))) {
      recalcLpCalledCapital(db, Number(previousLpId));
    }
    if (previousCallItemId && (!existing || Number(existing.capital_call_item_id) !== Number(previousCallItemId))) {
      const callId = recalcCapitalCallItemFromTransactions(db, Number(previousCallItemId));
      if (callId) recalcCapitalCallStatus(db, callId);
    }
    return;
  }

  const q = quarterFromDate(row.date);
  if (existing) {
    db.prepare(`
      UPDATE capital_transactions
      SET lp_account_id = ?, capital_call_item_id = ?, type = 'call', amount = ?, date = ?, quarter = ?, notes = ?
      WHERE id = ?
    `).run(row.lp_account_id, row.capital_call_item_id, row.amount, row.date, q || null, note, existing.id);
  } else {
    db.prepare(`
      INSERT INTO capital_transactions (lp_account_id, capital_call_item_id, type, amount, date, quarter, notes)
      VALUES (?, ?, 'call', ?, ?, ?, ?)
    `).run(row.lp_account_id, row.capital_call_item_id, row.amount, row.date, q || null, note);
  }

  recalcLpCalledCapital(db, Number(row.lp_account_id));
  if (row.capital_call_item_id) {
    const callId = recalcCapitalCallItemFromTransactions(db, Number(row.capital_call_item_id));
    if (callId) recalcCapitalCallStatus(db, callId);
  }
  if (existing && Number(existing.lp_account_id) !== Number(row.lp_account_id)) {
    recalcLpCalledCapital(db, Number(existing.lp_account_id));
  }
  if (existing && existing.capital_call_item_id && Number(existing.capital_call_item_id) !== Number(row.capital_call_item_id)) {
    const callId = recalcCapitalCallItemFromTransactions(db, Number(existing.capital_call_item_id));
    if (callId) recalcCapitalCallStatus(db, callId);
  }
  if (previousLpId && Number(previousLpId) !== Number(row.lp_account_id)) {
    recalcLpCalledCapital(db, Number(previousLpId));
  }
  if (previousCallItemId && Number(previousCallItemId) !== Number(row.capital_call_item_id)) {
    const callId = recalcCapitalCallItemFromTransactions(db, Number(previousCallItemId));
    if (callId) recalcCapitalCallStatus(db, callId);
  }
}

function normalizeHeader(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function inferBestColumn(
  headers: string[],
  rows: unknown[][],
  options: { keywords: string[]; validator: (v: unknown) => boolean; exclude?: Set<number> }
): number | null {
  const { keywords, validator, exclude = new Set<number>() } = options;
  const sampleRows = rows.slice(0, 25);
  let bestIndex: number | null = null;
  let bestScore = -1;

  headers.forEach((header, idx) => {
    if (exclude.has(idx)) return;
    let score = 0;
    for (const k of keywords) {
      if (header.includes(k)) score += 5;
    }
    let validCount = 0;
    for (const row of sampleRows) {
      if (validator(row[idx])) validCount++;
    }
    score += validCount;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = idx;
    }
  });

  return bestScore > 0 ? bestIndex : null;
}

function inferStatementRows(rawRows: unknown[][]): Array<{
  date: string;
  amount: number;
  description: string;
  category?: string;
  portfolio_unit_id?: number | null;
}> {
  if (rawRows.length < 2) return [];

  const headerRow = rawRows[0];
  const dataRows = rawRows.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  const headers = headerRow.map(normalizeHeader);

  const used = new Set<number>();
  const dateIdx = inferBestColumn(headers, dataRows, {
    keywords: ['date', 'postdate', 'transactiondate', 'valuedate'],
    validator: (v) => !!parseDateValue(v),
    exclude: used,
  });
  if (dateIdx !== null) used.add(dateIdx);

  const amountIdx = inferBestColumn(headers, dataRows, {
    keywords: ['amount', 'transactionamount', 'amt'],
    validator: (v) => parseAmount(v) !== null,
    exclude: used,
  });
  if (amountIdx !== null) used.add(amountIdx);

  const debitIdx = inferBestColumn(headers, dataRows, {
    keywords: ['debit', 'withdrawal', 'payment'],
    validator: (v) => parseAmount(v) !== null,
    exclude: used,
  });
  if (debitIdx !== null) used.add(debitIdx);

  const creditIdx = inferBestColumn(headers, dataRows, {
    keywords: ['credit', 'deposit'],
    validator: (v) => parseAmount(v) !== null,
    exclude: used,
  });
  if (creditIdx !== null) used.add(creditIdx);

  const descIdx = inferBestColumn(headers, dataRows, {
    keywords: ['description', 'memo', 'details', 'payee', 'narrative', 'transaction'],
    validator: (v) => String(v ?? '').trim().length > 0,
    exclude: used,
  });
  if (descIdx !== null) used.add(descIdx);

  const categoryIdx = inferBestColumn(headers, dataRows, {
    keywords: ['category', 'type', 'class'],
    validator: (v) => String(v ?? '').trim().length > 0,
    exclude: used,
  });

  const parsed: Array<{ date: string; amount: number; description: string; category?: string }> = [];

  for (const row of dataRows) {
    const date = dateIdx !== null ? parseDateValue(row[dateIdx]) : null;
    if (!date) continue;

    let amount: number | null = null;
    if (amountIdx !== null) {
      amount = parseAmount(row[amountIdx]);
    } else if (debitIdx !== null || creditIdx !== null) {
      const debit = debitIdx !== null ? parseAmount(row[debitIdx]) || 0 : 0;
      const credit = creditIdx !== null ? parseAmount(row[creditIdx]) || 0 : 0;
      amount = credit - Math.abs(debit);
    }
    if (amount === null) continue;

    const description = descIdx !== null ? String(row[descIdx] || '').trim() : '';
    const category = categoryIdx !== null ? String(row[categoryIdx] || '').trim().toLowerCase() : undefined;
    parsed.push({ date, amount, description, category });
  }

  return parsed;
}

function clampMatrix(matrix: unknown[][]): unknown[][] {
  return matrix
    .slice(0, MAX_STATEMENT_ROWS)
    .map((row) => row.slice(0, MAX_STATEMENT_COLS));
}

async function matrixFromSpreadsheetBuffer(fileType: string, buffer: Buffer): Promise<unknown[][]> {
  if (fileType === 'csv') {
    const csvText = buffer.toString('utf8');
    const rows = parseCsvSync(csvText, {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as unknown[][];
    return clampMatrix(rows);
  }

  if (fileType === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const matrix: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber > MAX_STATEMENT_ROWS) return;
      const values = (row.values as unknown[]).slice(1, MAX_STATEMENT_COLS + 1).map((v) => {
        if (v == null) return '';
        if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text || '');
        if (typeof v === 'object' && 'result' in (v as any)) return (v as any).result ?? '';
        return v;
      });
      matrix.push(values);
    });
    return clampMatrix(matrix);
  }

  // Legacy .xls is intentionally not auto-parsed due parser security concerns.
  return [];
}

function normalizeLLMJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/```$/, '')
      .trim();
  }
  return trimmed;
}

async function inferTransactionsWithAI(rawText: string, context: 'pdf' | 'sheet'): Promise<Array<{
  date: string;
  amount: number;
  description: string;
  category?: string;
}> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const prompt = context === 'pdf'
    ? `Extract bank transactions from this PDF text. Return ONLY JSON array with objects:
[{ "date":"YYYY-MM-DD", "amount":123.45, "description":"...", "category":"optional" }]
Rules: debits negative, credits positive; skip balances/subtotals; max 500 rows.
Text:
${rawText.slice(0, 120000)}`
    : `Infer transaction rows from a bank statement spreadsheet extract.
Return ONLY JSON array of rows:
[{ "date":"YYYY-MM-DD", "amount":123.45, "description":"...", "category":"optional" }]
Rules: debits negative, credits positive; skip blank/non-transaction rows; max 2000 rows.
Rows:
${rawText.slice(0, 120000)}`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0,
        messages: [
          { role: 'system', content: 'You are a strict transaction parser. Return only valid JSON.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = JSON.parse(normalizeLLMJson(text));
    if (!Array.isArray(parsed)) return null;

    const rows = parsed
      .map((r: any) => ({
        date: parseDateValue(r?.date),
        amount: parseAmount(r?.amount),
        description: String(r?.description || '').trim(),
        category: r?.category ? String(r.category).toLowerCase() : undefined,
      }))
      .filter((r: any) => !!r.date && r.amount !== null)
      .map((r: any) => ({
        date: r.date as string,
        amount: r.amount as number,
        description: r.description,
        category: r.category,
      }));
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

function parsePdfTransactionsHeuristic(rawText: string): Array<{
  date: string;
  amount: number;
  description: string;
}> {
  const rows: Array<{ date: string; amount: number; description: string }> = [];
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lineRegex = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+?)\s+(\(?-?\$?\d[\d,]*\.?\d{0,2}\)?)/;

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (!match) continue;
    const date = parseDateValue(match[1]);
    const amount = parseAmount(match[3]);
    const description = match[2].trim();
    if (!date || amount === null) continue;
    rows.push({ date, amount, description });
  }

  return rows;
}

function importTransactions(
  db: ReturnType<typeof getDb>,
  params: {
    filename: string;
    rows: any[];
    fileType: 'csv' | 'ofx' | 'pdf' | 'manual' | 'xls' | 'xlsx';
    status?: 'parsed' | 'pending_review';
    filePath?: string;
    fileSha256?: string | null;
    uploadedBy?: string | null;
  }
) {
  const { filename, rows, fileType, status = 'parsed', filePath, fileSha256, uploadedBy } = params;

  const unitRows = db.prepare(`
    SELECT pu.id, bu.unit_number
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
  `).all() as any[];
  const unitLookup = new Map<string, number>();
  for (const u of unitRows) unitLookup.set(u.unit_number.toUpperCase(), u.id);

  const learnedMappings = db.prepare(
    `SELECT description_pattern, portfolio_unit_id, category FROM learned_mappings`
  ).all() as Array<{ description_pattern: string; portfolio_unit_id: number; category: string | null }>;

  const checkDupe = db.prepare(
    `SELECT id FROM bank_transactions WHERE date = ? AND amount = ? AND COALESCE(description, '') = ? LIMIT 1`
  );

  const upload = db.prepare(`
    INSERT INTO bank_uploads (filename, upload_date, file_type, row_count, status, file_path, file_sha256, uploaded_by)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)
  `).run(filename, fileType, rows.length, status, filePath || null, fileSha256 || null, uploadedBy || null);

  if (status !== 'parsed') {
    return {
      upload_id: upload.lastInsertRowid,
      rows_imported: 0,
      rows_skipped: 0,
      total_rows: rows.length,
      rows_invalid: 0,
    };
  }

  const insertBank = db.prepare(`
    INSERT INTO bank_transactions (
      bank_upload_id, date, amount, description, source_file, statement_ref
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insert = db.prepare(`
    INSERT INTO cash_flow_actuals (
      bank_transaction_id,
      portfolio_unit_id, entity_id, unit_renovation_id,
      lp_account_id, capital_call_item_id,
      date, amount, category, description, source_file, statement_ref, reconciled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let rowsImported = 0;
  let rowsSkipped = 0;
  let rowsInvalid = 0;

  const insertMany = db.transaction((inputRows: any[]) => {
    for (const row of inputRows) {
      const date = parseDateValue(row.date);
      const amount = parseAmount(row.amount);
      const desc = String(row.description || '').trim();
      if (!date || amount === null) {
        rowsInvalid++;
        continue;
      }
      try {
        assertPeriodOpen(db, date);
      } catch {
        rowsInvalid++;
        continue;
      }

      const existing = checkDupe.get(date, amount, desc);
      if (existing) {
        rowsSkipped++;
        continue;
      }

      let category = autoMapCategory(desc, row.category ? String(row.category) : undefined);
      let unitId = row.portfolio_unit_id ?? row.portfolioUnitId ?? null;
      let lpAccountId = row.lp_account_id ?? row.lpAccountId ?? null;
      let capitalCallItemId = row.capital_call_item_id ?? row.capitalCallItemId ?? null;
      if (!unitId && desc) unitId = autoMapUnit(desc, unitLookup);
      if (category === 'capital_call') {
        unitId = null;
        if (!lpAccountId || !capitalCallItemId) {
          rowsInvalid++;
          continue;
        }
        const item = db.prepare(`
          SELECT id, lp_account_id
          FROM capital_call_items
          WHERE id = ?
        `).get(Number(capitalCallItemId)) as any;
        if (!item || Number(item.lp_account_id) !== Number(lpAccountId)) {
          rowsInvalid++;
          continue;
        }
      } else {
        lpAccountId = null;
        capitalCallItemId = null;
      }

      if (desc) {
        const learned = checkLearnedMappings(desc, learnedMappings);
        if (!unitId && learned.unitId) unitId = learned.unitId;
        if (learned.category && category === 'other') category = learned.category;
      }

      // Keep a stable source reference if present (OFX/QFX often has FITID).
      // Do NOT auto-mark reconciled just because a source ref exists — reconciliation is a user action.
      const rawRef = String(row.statement_ref || row.statementRef || '').trim();
      const statementRef = rawRef || `upload:${upload.lastInsertRowid}:row:${rowsImported + rowsSkipped + rowsInvalid + 1}`;
      const reconciled = Number(row.reconciled ?? 0) === 1 ? 1 : 0;

      const bankResult = insertBank.run(upload.lastInsertRowid, date, amount, desc, filename, statementRef || null);
      const bankTransactionId = Number(bankResult.lastInsertRowid);

      const insertResult = insert.run(
        bankTransactionId,
        unitId, null, null,
        lpAccountId, capitalCallItemId,
        date, amount, category, desc, filename, statementRef || null, reconciled
      );
      const inserted = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(Number(insertResult.lastInsertRowid)) as any;
      if (inserted) {
        syncUnitExpenseFromActual(db, inserted);
        syncCapitalCallFromActual(db, inserted);
      }
      rowsImported++;
    }
  });

  insertMany(rows);

  return {
    upload_id: upload.lastInsertRowid,
    rows_imported: rowsImported,
    rows_skipped: rowsSkipped,
    total_rows: rows.length,
    rows_invalid: rowsInvalid,
  };
}

/* ── Routes ──────────────────────────────────────────────────── */

// GET /api/actuals/transactions - List imported transactions
router.get('/transactions', async (req: Request, res: Response) => {
  const db = getDb();
  const { unit_id, entity_id, category, reconciled, upload_id, limit = 100, offset = 0 } = req.query;
  try {
    const rows = await listActualTransactions({
      unit_id: unit_id ? Number(unit_id) : undefined,
      entity_id: entity_id ? Number(entity_id) : undefined,
      category: category ? String(category) : undefined,
      reconciled: reconciled !== undefined ? reconciled === 'true' : undefined,
      upload_id: upload_id ? Number(upload_id) : undefined,
      limit: Number(limit),
      offset: Number(offset),
    });
    res.json(rows);
    return;
  } catch {
    // Fall through to existing SQLite query path.
  }

  let sql = `SELECT
      cfa.*,
      bt.amount as bank_amount,
      bt.description as bank_description,
      e.name as entity_name,
      ur.description as renovation_description,
      pu.id as portfolio_unit_id,
      bu.unit_number,
      lpa.name as lp_name,
      cci.capital_call_id, cc.call_number
    FROM cash_flow_actuals cfa
    LEFT JOIN bank_transactions bt ON cfa.bank_transaction_id = bt.id
    LEFT JOIN portfolio_units pu ON cfa.portfolio_unit_id = pu.id
    LEFT JOIN entities e ON cfa.entity_id = e.id
    LEFT JOIN unit_renovations ur ON cfa.unit_renovation_id = ur.id
    LEFT JOIN building_units bu ON pu.building_unit_id = bu.id
    LEFT JOIN lp_accounts lpa ON cfa.lp_account_id = lpa.id
    LEFT JOIN capital_call_items cci ON cfa.capital_call_item_id = cci.id
    LEFT JOIN capital_calls cc ON cci.capital_call_id = cc.id
    WHERE 1=1`;
  const params: any[] = [];

  if (unit_id) {
    sql += ` AND cfa.portfolio_unit_id = ?`;
    params.push(Number(unit_id));
  }
  if (entity_id) {
    sql += ` AND cfa.entity_id = ?`;
    params.push(Number(entity_id));
  }
  if (category) {
    sql += ` AND cfa.category = ?`;
    params.push(category);
  }
  if (reconciled !== undefined) {
    sql += ` AND cfa.reconciled = ?`;
    params.push(reconciled === 'true' ? 1 : 0);
  }
  if (upload_id) {
    sql += ` AND bt.bank_upload_id = ?`;
    params.push(Number(upload_id));
  }

  sql += ` ORDER BY cfa.date DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// POST /api/actuals/upload - Upload bank statement (CSV parsing / manual entry)
router.post('/upload', (req: Request, res: Response) => {
  const db = getDb();
  const { filename, rows: csvRows, file_type = 'csv' } = req.body;

  if (!filename || !csvRows || !Array.isArray(csvRows)) {
    return res.status(400).json({ error: 'filename and rows array required' });
  }
  const safeType = ['csv', 'manual', 'ofx', 'pdf', 'xls', 'xlsx'].includes(file_type) ? file_type : 'csv';
  const result = importTransactions(db, {
    filename,
    rows: csvRows,
    fileType: safeType as 'csv' | 'manual' | 'ofx' | 'pdf' | 'xls' | 'xlsx',
    uploadedBy: String((req as any).user?.email || '') || null,
  });
  const upload = db.prepare(`SELECT * FROM bank_uploads WHERE id = ?`).get(Number(result.upload_id));
  writeAuditLog({
    db,
    req,
    action: 'import_statement',
    tableName: 'bank_uploads',
    recordId: result.upload_id as any,
    before: null,
    after: { upload, result },
  });
  res.json(result);
});

// POST /api/actuals/upload-file - Upload statement files as multipart form data
router.post('/upload-file', fileUpload.single('file'), async (req: Request, res: Response) => {
  const db = getDb();
  const file = (req as any).file;

  if (!file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const fileType = ext === 'qfx' ? 'ofx' : ext;
  if (!['csv', 'xls', 'xlsx', 'pdf', 'ofx'].includes(fileType)) {
    res.status(400).json({ error: 'Unsupported file type' });
    return;
  }

  const stored = await saveUploadedBuffer(
    file.buffer,
    'statements',
    file.originalname,
    file.mimetype
  );
  const relativePath = stored.filePath;
  const fileSha256 = createHash('sha256').update(file.buffer).digest('hex');
  const uploadedBy = String((req as any).user?.email || '') || null;

  // OFX/QFX is stored for manual review right now.
  if (fileType === 'ofx') {
    const result = importTransactions(db, {
      filename: file.originalname,
      rows: [],
      fileType: fileType as 'ofx',
      status: 'pending_review',
      filePath: relativePath,
      fileSha256,
      uploadedBy,
    });
    const upload = db.prepare(`SELECT * FROM bank_uploads WHERE id = ?`).get(Number(result.upload_id));
    writeAuditLog({
      db,
      req,
      action: 'upload_statement_file',
      tableName: 'bank_uploads',
      recordId: result.upload_id as any,
      before: null,
      after: { upload, result },
    });

  res.json({
      ...result,
    filename: file.originalname,
    file_type: fileType,
      file_path: relativePath,
    status: 'pending_review',
      message: `${fileType.toUpperCase()} uploaded successfully. It is saved and pending review.`,
    });
    return;
  }

  try {
    if (fileType === 'pdf') {
      const parser = new PDFParse({ data: Uint8Array.from(file.buffer) });
      const textResult = await parser.getText();
      const pdfText = textResult.text || '';
      await parser.destroy();

      let rows = await inferTransactionsWithAI(pdfText, 'pdf');
      if (!rows || rows.length === 0) {
        rows = parsePdfTransactionsHeuristic(pdfText);
      }

      const hasRows = rows.length > 0;
      const result = importTransactions(db, {
        filename: file.originalname,
        rows,
        fileType: 'pdf',
        status: hasRows ? 'parsed' : 'pending_review',
        filePath: relativePath,
        fileSha256,
        uploadedBy,
      });
      const upload = db.prepare(`SELECT * FROM bank_uploads WHERE id = ?`).get(Number(result.upload_id));
      writeAuditLog({
        db,
        req,
        action: 'import_statement_file',
        tableName: 'bank_uploads',
        recordId: result.upload_id as any,
        before: null,
        after: { upload, result, inferred_rows: rows.length },
      });

      res.json({
        ...result,
        filename: file.originalname,
        file_type: fileType,
        file_path: relativePath,
        status: hasRows ? 'parsed' : 'pending_review',
        message: hasRows
          ? `PDF processed with ${process.env.OPENAI_API_KEY ? 'AI-assisted' : 'heuristic'} transaction inference.`
          : 'PDF uploaded but no transactions were confidently detected. Pending manual review.',
      });
      return;
    }

    const matrix = await matrixFromSpreadsheetBuffer(fileType, file.buffer);
    let rows = inferStatementRows(matrix);
    if (rows.length === 0) {
      const sample = matrix.slice(0, 80).map((r) => r.join(' | ')).join('\n');
      const aiRows = await inferTransactionsWithAI(sample, 'sheet');
      if (aiRows && aiRows.length > 0) rows = aiRows;
    }

    const status: 'parsed' | 'pending_review' = fileType === 'xls' ? 'pending_review' : 'parsed';
    const result = importTransactions(db, {
      filename: file.originalname,
      rows,
      fileType: fileType as 'csv' | 'xls' | 'xlsx',
      status,
      filePath: relativePath,
      fileSha256,
      uploadedBy,
    });
    const upload = db.prepare(`SELECT * FROM bank_uploads WHERE id = ?`).get(Number(result.upload_id));
    writeAuditLog({
      db,
      req,
      action: 'import_statement_file',
      tableName: 'bank_uploads',
      recordId: result.upload_id as any,
      before: null,
      after: { upload, result, inferred_rows: rows.length },
    });

    res.json({
      ...result,
      filename: file.originalname,
      file_type: fileType,
      file_path: relativePath,
      status,
      message: fileType === 'xls'
        ? 'XLS uploaded and stored for manual review (legacy parser disabled for security).'
        : `${fileType.toUpperCase()} processed with smart column mapping.`,
    });
  } catch (error: any) {
    await deleteStoredFile(relativePath);
    res.status(400).json({
      error: 'Failed to parse statement file',
      details: error?.message || 'Unknown parse error',
    });
  }
});

// POST /api/actuals/receipt - Capture/upload receipt, link to existing expense or create new
router.post('/receipt', receiptUpload.single('file'), (req: Request, res: Response) => {
  const db = getDb();
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    return res.status(400).json({ error: 'Receipt image is required' });
  }

  const portfolioUnitId = Number(req.body.portfolioUnitId);
  if (!portfolioUnitId) {
    return res.status(400).json({ error: 'portfolioUnitId is required' });
  }
  const unit = db.prepare('SELECT id FROM portfolio_units WHERE id = ?').get(portfolioUnitId);
  if (!unit) {
    return res.status(404).json({ error: 'Portfolio unit not found' });
  }

  (async () => {
    const stored = await saveUploadedBuffer(
      file.buffer,
      'receipts',
      file.originalname || `receipt-${Date.now()}.jpg`,
      file.mimetype
    );
    const relativePath = stored.filePath;
    try {
      const tx = db.transaction(() => {
        const docResult = db.prepare(`
      INSERT INTO documents (parent_id, parent_type, name, category, file_path, file_type, requires_signature, uploaded_by)
      VALUES (?, 'unit', ?, 'financial', ?, ?, 0, ?)
    `).run(
      portfolioUnitId,
      file.originalname || `receipt-${Date.now()}`,
      relativePath,
      file.mimetype,
      (req as any).user?.email || 'unknown',
    );
        const documentId = Number(docResult.lastInsertRowid);

        const existingTransactionId = req.body.transactionId ? Number(req.body.transactionId) : null;
        const createExpense = String(req.body.createExpense || '').toLowerCase() === 'true';

        let transactionId: number | null = null;

        if (existingTransactionId) {
          const before = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(existingTransactionId) as any;
          if (!before) {
            throw new Error('Transaction not found');
          }
          assertPeriodOpen(db, String(before.date));
          db.prepare(`
        UPDATE cash_flow_actuals
        SET portfolio_unit_id = COALESCE(portfolio_unit_id, ?),
            source_file = ?,
            receipt_document_id = ?
        WHERE id = ?
      `).run(portfolioUnitId, relativePath, documentId, existingTransactionId);
          transactionId = existingTransactionId;
          const after = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(existingTransactionId) as any;
          writeAuditLog({
            db,
            req,
            action: 'attach_receipt',
            tableName: 'cash_flow_actuals',
            recordId: existingTransactionId,
            before,
            after,
          });
        } else if (createExpense) {
          const date = parseDateValue(req.body.date);
          const amount = parseAmount(req.body.amount);
          const category = String(req.body.category || 'other').toLowerCase();
          const description = String(req.body.description || '').trim() || 'Receipt expense';
          if (!date || amount === null) {
            throw new Error('Valid date and amount are required to create expense');
          }
          assertPeriodOpen(db, date);
          const allowedCats = new Set(['hoa', 'insurance', 'tax', 'repair', 'management_fee', 'fund_expense', 'other']);
          const safeCategory = allowedCats.has(category) ? category : 'other';
          const insertResult = db.prepare(`
        INSERT INTO cash_flow_actuals (
          portfolio_unit_id, date, amount, category, description, source_file, receipt_document_id, reconciled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(portfolioUnitId, date, amount, safeCategory, description, relativePath, documentId);
          transactionId = Number(insertResult.lastInsertRowid);
          const created = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(transactionId) as any;
          writeAuditLog({
            db,
            req,
            action: 'create_from_receipt',
            tableName: 'cash_flow_actuals',
            recordId: transactionId,
            before: null,
            after: created,
          });
        }

        return { documentId, transactionId, filePath: relativePath };
      });
      const result = tx();
      res.status(201).json({
        success: true,
        document_id: result.documentId,
        transaction_id: result.transactionId,
        file_path: result.filePath,
      });
    } catch (error: any) {
      await deleteStoredFile(relativePath);
      throw error;
    }
  })().catch((error: any) => {
    res.status(400).json({ error: error?.message || 'Failed to save receipt' });
  });
});

// PUT /api/actuals/transactions/:id - Categorize/reconcile a transaction
router.put('/transactions/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const {
    category,
    portfolio_unit_id,
    entity_id,
    unit_renovation_id,
    lp_account_id,
    capital_call_item_id,
    reconciled,
    description,
    statement_ref
  } = req.body;
  const before = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(Number(id)) as any;
  if (!before) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  try {
    assertPeriodOpen(db, String(before.date));
  } catch (error: any) {
    return res.status(error?.statusCode || 409).json({ error: error?.message || 'Accounting period is closed' });
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (category !== undefined) {
    updates.push('category = ?');
    params.push(category);
  }
  if (portfolio_unit_id !== undefined) {
    updates.push('portfolio_unit_id = ?');
    params.push(portfolio_unit_id);
  }
  if (entity_id !== undefined) {
    updates.push('entity_id = ?');
    params.push(entity_id || null);
  }
  if (unit_renovation_id !== undefined) {
    updates.push('unit_renovation_id = ?');
    params.push(unit_renovation_id || null);
  }
  if (lp_account_id !== undefined) {
    updates.push('lp_account_id = ?');
    params.push(lp_account_id || null);
  }
  if (capital_call_item_id !== undefined) {
    updates.push('capital_call_item_id = ?');
    params.push(capital_call_item_id || null);
  }
  if (reconciled !== undefined) {
    updates.push('reconciled = ?');
    params.push(reconciled ? 1 : 0);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }
  if (statement_ref !== undefined) {
    updates.push('statement_ref = ?');
    params.push(statement_ref || null);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const nextCategory = category !== undefined ? String(category) : String(before.category);
  const nextLpAccountId = lp_account_id !== undefined ? (lp_account_id || null) : (before.lp_account_id || null);
  const nextCallItemId = capital_call_item_id !== undefined ? (capital_call_item_id || null) : (before.capital_call_item_id || null);
  const nextPortfolioUnitId = portfolio_unit_id !== undefined ? (portfolio_unit_id || null) : (before.portfolio_unit_id || null);
  const nextEntityId = entity_id !== undefined ? (entity_id || null) : (before.entity_id || null);
  const nextRenoId = unit_renovation_id !== undefined ? (unit_renovation_id || null) : (before.unit_renovation_id || null);

  if (nextPortfolioUnitId && nextEntityId) {
    return res.status(400).json({ error: 'Pick either a Unit or an Entity (not both).' });
  }
  if (nextRenoId && !nextPortfolioUnitId) {
    return res.status(400).json({ error: 'Renovation assignment requires a Unit.' });
  }
  if (nextRenoId && nextPortfolioUnitId) {
    const reno = db.prepare(`SELECT id, portfolio_unit_id FROM unit_renovations WHERE id = ?`).get(Number(nextRenoId)) as any;
    if (!reno) return res.status(400).json({ error: 'Renovation not found.' });
    if (Number(reno.portfolio_unit_id) !== Number(nextPortfolioUnitId)) {
      return res.status(400).json({ error: 'Renovation does not belong to selected Unit.' });
    }
  }
  if (nextCategory === 'capital_call' && (!nextLpAccountId || !nextCallItemId)) {
    return res.status(400).json({ error: 'capital_call transactions must be assigned to an LP account and capital call item' });
  }
  if (nextCategory === 'capital_call') {
    const item = db.prepare(`
      SELECT id, lp_account_id
      FROM capital_call_items
      WHERE id = ?
    `).get(Number(nextCallItemId)) as any;
    if (!item) {
      return res.status(400).json({ error: 'Selected capital call item was not found' });
    }
    if (Number(item.lp_account_id) !== Number(nextLpAccountId)) {
      return res.status(400).json({ error: 'Selected capital call item does not belong to selected LP account' });
    }
    if (nextPortfolioUnitId) {
      if (updates.includes('portfolio_unit_id = ?')) {
        const idx = updates.indexOf('portfolio_unit_id = ?');
        params[idx] = null;
      } else {
        updates.push('portfolio_unit_id = ?');
        params.push(null);
      }
    }
    if (nextEntityId) {
      if (updates.includes('entity_id = ?')) {
        const idx = updates.indexOf('entity_id = ?');
        params[idx] = null;
      } else {
        updates.push('entity_id = ?');
        params.push(null);
      }
    }
    if (nextRenoId) {
      if (updates.includes('unit_renovation_id = ?')) {
        const idx = updates.indexOf('unit_renovation_id = ?');
        params[idx] = null;
      } else {
        updates.push('unit_renovation_id = ?');
        params.push(null);
      }
    }
  } else {
    if (nextLpAccountId) {
      if (updates.includes('lp_account_id = ?')) {
        const idx = updates.indexOf('lp_account_id = ?');
        params[idx] = null;
      } else {
        updates.push('lp_account_id = ?');
        params.push(null);
      }
    }
    if (nextCallItemId) {
      if (updates.includes('capital_call_item_id = ?')) {
        const idx = updates.indexOf('capital_call_item_id = ?');
        params[idx] = null;
      } else {
        updates.push('capital_call_item_id = ?');
        params.push(null);
      }
    }
  }

  params.push(Number(id));
  db.prepare(`UPDATE cash_flow_actuals SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const row = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(Number(id)) as any;
  if (row) {
    syncUnitExpenseFromActual(db, row);
    syncCapitalCallFromActual(db, row, before.lp_account_id || null, before.capital_call_item_id || null);
    writeAuditLog({
      db,
      req,
      action: 'update',
      tableName: 'cash_flow_actuals',
      recordId: row.id,
      before,
      after: row,
    });
  }

  res.json({ success: true });
});

// GET /api/actuals/renovations-options - lightweight list for Actuals allocation dropdowns
router.get('/renovations-options', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      ur.id,
      ur.portfolio_unit_id,
      ur.description,
      ur.status,
      bu.unit_number
    FROM unit_renovations ur
    JOIN portfolio_units pu ON ur.portfolio_unit_id = pu.id
    JOIN building_units bu ON pu.building_unit_id = bu.id
    ORDER BY ur.portfolio_unit_id, ur.id DESC
  `).all();
  res.json(rows);
});

// POST /api/actuals/transactions/:id/split - split one allocation into two
router.post('/transactions/:id/split', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { amount, category, portfolio_unit_id, entity_id, unit_renovation_id, description } = req.body as any;

  const base = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(Number(id)) as any;
  if (!base) return res.status(404).json({ error: 'Transaction not found' });
  try {
    assertPeriodOpen(db, String(base.date));
  } catch (error: any) {
    return res.status(error?.statusCode || 409).json({ error: error?.message || 'Accounting period is closed' });
  }
  if (!base.bank_transaction_id) return res.status(400).json({ error: 'This transaction cannot be split (missing bank_transaction_id).' });

  const splitAmount = Number(amount);
  if (!Number.isFinite(splitAmount) || Math.abs(splitAmount) < 0.0001) {
    return res.status(400).json({ error: 'Split amount is required.' });
  }
  if (splitAmount === 0) return res.status(400).json({ error: 'Split amount cannot be 0.' });
  if ((splitAmount > 0) !== (Number(base.amount) > 0)) {
    return res.status(400).json({ error: 'Split amount must have the same sign as the original amount.' });
  }
  if (Math.abs(splitAmount) >= Math.abs(Number(base.amount))) {
    return res.status(400).json({ error: 'Split amount must be smaller than the original amount.' });
  }

  const nextBaseAmount = Number(base.amount) - splitAmount;

  const tx = db.transaction(() => {
    db.prepare('UPDATE cash_flow_actuals SET amount = ?, reconciled = 0 WHERE id = ?')
      .run(nextBaseAmount, Number(id));

    const result = db.prepare(`
      INSERT INTO cash_flow_actuals (
        bank_transaction_id,
        portfolio_unit_id, entity_id, unit_renovation_id,
        lp_account_id, capital_call_item_id,
        date, amount, category, description, source_file, statement_ref, receipt_document_id, reconciled
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0
      )
    `).run(
      Number(base.bank_transaction_id),
      portfolio_unit_id ?? null,
      entity_id ?? null,
      unit_renovation_id ?? null,
      null,
      null,
      String(base.date),
      splitAmount,
      String(category || base.category),
      String(description || base.description || '').trim() || null,
      String(base.source_file || ''),
      String(base.statement_ref || ''),
      null,
    );

    return Number(result.lastInsertRowid);
  });

  const newId = tx();
  const created = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(newId);
  writeAuditLog({
    db,
    req,
    action: 'split',
    tableName: 'cash_flow_actuals',
    recordId: String(id),
    before: { base },
    after: { createdId: newId, created },
  });
  res.status(201).json({ success: true, id: newId, row: created });
});

// DELETE /api/actuals/transactions/:id - delete one allocation row
router.delete('/transactions/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const before = db.prepare('SELECT id, date FROM cash_flow_actuals WHERE id = ?').get(id) as any;
  if (!before) return res.status(404).json({ error: 'Transaction not found' });
  try {
    assertPeriodOpen(db, String(before.date));
  } catch (error: any) {
    return res.status(error?.statusCode || 409).json({ error: error?.message || 'Accounting period is closed' });
  }
  const fullBefore = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(id) as any;
  db.prepare('DELETE FROM cash_flow_actuals WHERE id = ?').run(id);
  writeAuditLog({
    db,
    req,
    action: 'delete',
    tableName: 'cash_flow_actuals',
    recordId: id,
    before: fullBefore,
    after: null,
  });
  res.json({ success: true });
});

// GET /api/actuals/bank-lines - bank transactions with allocations and delta
router.get('/bank-lines', (req: Request, res: Response) => {
  const db = getDb();
  const { upload_id, month, limit = 200, offset = 0 } = req.query as any;

  let where = 'WHERE 1=1';
  const params: any[] = [];
  if (upload_id) {
    where += ' AND bt.bank_upload_id = ?';
    params.push(Number(upload_id));
  }
  if (month) {
    const m = String(month);
    where += ` AND bt.date >= ? AND bt.date <= ?`;
    params.push(`${m}-01`, `${m}-31`);
  }

  const bankRows = db.prepare(`
    SELECT
      bt.*,
      COALESCE(SUM(cfa.amount), 0) as allocated_total,
      (bt.amount - COALESCE(SUM(cfa.amount), 0)) as delta,
      COALESCE(SUM(CASE WHEN cfa.reconciled = 1 THEN 1 ELSE 0 END), 0) as reconciled_alloc_count,
      COALESCE(COUNT(cfa.id), 0) as alloc_count
    FROM bank_transactions bt
    LEFT JOIN cash_flow_actuals cfa ON cfa.bank_transaction_id = bt.id
    ${where}
    GROUP BY bt.id
    ORDER BY bt.date DESC, bt.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset)) as any[];

  const ids = bankRows.map((r) => r.id);
  if (ids.length === 0) return res.json([]);
  const ph = ids.map(() => '?').join(', ');
  const allocations = db.prepare(`
    SELECT
      cfa.*,
      bu.unit_number,
      e.name as entity_name,
      ur.description as renovation_description
    FROM cash_flow_actuals cfa
    LEFT JOIN portfolio_units pu ON cfa.portfolio_unit_id = pu.id
    LEFT JOIN building_units bu ON pu.building_unit_id = bu.id
    LEFT JOIN entities e ON cfa.entity_id = e.id
    LEFT JOIN unit_renovations ur ON cfa.unit_renovation_id = ur.id
    WHERE cfa.bank_transaction_id IN (${ph})
    ORDER BY cfa.bank_transaction_id, cfa.id
  `).all(...ids) as any[];

  const byBank = new Map<number, any[]>();
  for (const a of allocations) {
    const k = Number(a.bank_transaction_id);
    byBank.set(k, [...(byBank.get(k) || []), a]);
  }

  res.json(bankRows.map((b) => ({
    ...b,
    allocations: byBank.get(Number(b.id)) || [],
  })));
});

// POST /api/actuals/bank-lines/:id/allocations - add a new allocation row under one bank line
router.post('/bank-lines/:id/allocations', (req: Request, res: Response) => {
  const db = getDb();
  const bankId = Number(req.params.id);
  if (!bankId) return res.status(400).json({ error: 'Invalid bank transaction id' });

  const bank = db.prepare(`SELECT * FROM bank_transactions WHERE id = ?`).get(bankId) as any;
  if (!bank) return res.status(404).json({ error: 'Bank transaction not found' });

  try {
    assertPeriodOpen(db, String(bank.date));
  } catch (error: any) {
    return res.status(error?.statusCode || 409).json({ error: error?.message || 'Accounting period is closed' });
  }

  const {
    amount,
    category,
    portfolio_unit_id,
    entity_id,
    unit_renovation_id,
    lp_account_id,
    capital_call_item_id,
    description,
  } = req.body as any;

  const allocAmount = Number(amount);
  if (!Number.isFinite(allocAmount) || allocAmount === 0) {
    return res.status(400).json({ error: 'amount is required' });
  }
  const bankAmt = Number(bank.amount || 0);
  if ((allocAmount > 0) !== (bankAmt > 0)) {
    return res.status(400).json({ error: 'Allocation amount must have the same sign as the bank line amount.' });
  }

  const cat = String(category || '').trim();
  const allowedCats = new Set([
    'rent',
    'hoa',
    'insurance',
    'tax',
    'repair',
    'capital_call',
    'distribution',
    'management_fee',
    'fund_expense',
    'other',
  ]);
  if (!allowedCats.has(cat)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  const unitId = portfolio_unit_id ? Number(portfolio_unit_id) : null;
  const entityId = entity_id ? Number(entity_id) : null;
  const renoId = unit_renovation_id ? Number(unit_renovation_id) : null;

  if (unitId && entityId) {
    return res.status(400).json({ error: 'Pick either a Unit or an Entity (not both).' });
  }
  if (renoId && !unitId) {
    return res.status(400).json({ error: 'Renovation assignment requires a Unit.' });
  }
  if (renoId && unitId) {
    const reno = db.prepare(`SELECT id, portfolio_unit_id FROM unit_renovations WHERE id = ?`).get(renoId) as any;
    if (!reno) return res.status(400).json({ error: 'Renovation not found.' });
    if (Number(reno.portfolio_unit_id) !== Number(unitId)) {
      return res.status(400).json({ error: 'Renovation does not belong to selected Unit.' });
    }
  }

  // Capital call allocations must be tied to LP + call item
  let lpId = lp_account_id ? Number(lp_account_id) : null;
  let callItemId = capital_call_item_id ? Number(capital_call_item_id) : null;
  if (cat === 'capital_call') {
    if (!lpId || !callItemId) {
      return res.status(400).json({ error: 'capital_call allocations must include lp_account_id and capital_call_item_id' });
    }
    // Verify call item belongs to LP
    const item = db.prepare(`SELECT id, lp_account_id FROM capital_call_items WHERE id = ?`).get(callItemId) as any;
    if (!item || Number(item.lp_account_id) !== Number(lpId)) {
      return res.status(400).json({ error: 'Selected capital call item does not belong to selected LP.' });
    }
  } else {
    lpId = null;
    callItemId = null;
  }

  const rowDesc = String(description || bank.description || '').trim() || null;
  const result = db.prepare(`
    INSERT INTO cash_flow_actuals (
      bank_transaction_id,
      portfolio_unit_id, entity_id, unit_renovation_id,
      lp_account_id, capital_call_item_id,
      date, amount, category, description, source_file, statement_ref, reconciled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    bankId,
    unitId,
    entityId,
    renoId,
    lpId,
    callItemId,
    String(bank.date),
    allocAmount,
    cat,
    rowDesc,
    String(bank.source_file || ''),
    String(bank.statement_ref || ''),
  );

  const created = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(Number(result.lastInsertRowid));
  writeAuditLog({
    db,
    req,
    action: 'create',
    tableName: 'cash_flow_actuals',
    recordId: result.lastInsertRowid as any,
    before: null,
    after: created,
  });
  res.status(201).json({ success: true, id: result.lastInsertRowid, row: created });
});

// GET /api/actuals/periods - list closed periods
router.get('/periods', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM accounting_periods ORDER BY month DESC`).all();
  res.json(rows);
});

// POST /api/actuals/periods/:month/close - close a month (all bank lines must be allocated/balanced/reconciled)
router.post('/periods/:month/close', (req: Request, res: Response) => {
  const db = getDb();
  const m = String(req.params.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return res.status(400).json({ error: 'Month must be YYYY-MM' });
  const from = `${m}-01`;
  const to = `${m}-31`;

  const check = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.date >= ? AND bt.date <= ?) as bank_rows,
      (SELECT COUNT(*) FROM bank_transactions bt
        LEFT JOIN cash_flow_actuals cfa ON cfa.bank_transaction_id = bt.id
        WHERE bt.date >= ? AND bt.date <= ?
        GROUP BY bt.id
        HAVING COALESCE(SUM(cfa.amount), 0) = 0
      ) as unallocated_lines,
      (SELECT COUNT(*) FROM bank_transactions bt
        LEFT JOIN cash_flow_actuals cfa ON cfa.bank_transaction_id = bt.id
        WHERE bt.date >= ? AND bt.date <= ?
        GROUP BY bt.id, bt.amount
        HAVING ABS(bt.amount - COALESCE(SUM(cfa.amount), 0)) > 0.005
      ) as out_of_balance_lines,
      (SELECT COUNT(*) FROM cash_flow_actuals cfa
        JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id
        WHERE bt.date >= ? AND bt.date <= ? AND cfa.reconciled = 0
      ) as unreconciled_allocs
  `).get(from, to, from, to, from, to, from, to) as any;

  const bankRows = Number(check?.bank_rows || 0);
  const unallocated = Number(check?.unallocated_lines || 0);
  const outOfBalance = Number(check?.out_of_balance_lines || 0);
  const unreconciledAllocs = Number(check?.unreconciled_allocs || 0);

  if (bankRows > 0 && (unallocated > 0 || outOfBalance > 0 || unreconciledAllocs > 0)) {
    return res.status(400).json({
      error: 'Month is not fully reconciled.',
      details: { month: m, bankRows, unallocated, outOfBalance, unreconciledAllocs },
    });
  }

  const userEmail = String((req as any).user?.email || '');
  db.prepare(`
    INSERT INTO accounting_periods (month, status, closed_at, closed_by)
    VALUES (?, 'closed', datetime('now'), ?)
    ON CONFLICT(month) DO UPDATE SET status='closed', closed_at=datetime('now'), closed_by=excluded.closed_by
  `).run(m, userEmail || null);

  writeAuditLog({
    db,
    req,
    action: 'close_month',
    tableName: 'accounting_periods',
    recordId: m,
    before: null,
    after: { month: m, status: 'closed' },
  });
  res.json({ success: true });
});

// GET /api/actuals/variance - Actual vs forecast comparison
router.get('/variance', (req: Request, res: Response) => {
  const db = getDb();

  // Compare a *real* calendar month (no smoothing of annual items).
  // Default: current month in server time.
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;

  // Get reconciled actuals grouped by category for this month
  const actuals = db.prepare(`
    SELECT category, SUM(amount) as total, COUNT(*) as count
    FROM cash_flow_actuals
    WHERE reconciled = 1
      AND date >= ? AND date <= ?
    GROUP BY category
    ORDER BY total DESC
  `).all(from, to) as any[];

  // Get forecast from portfolio units (month-specific; insurance/tax are annual lumps in their payment month)
  const portfolio = db.prepare(`
    SELECT
      SUM(COALESCE(monthly_rent, 0)) as forecast_rent,
      SUM(COALESCE(monthly_hoa, 0)) as forecast_hoa,
      SUM(CASE WHEN COALESCE(insurance_payment_month, 1) = ? THEN COALESCE(monthly_insurance, 0) ELSE 0 END) as forecast_insurance_lump,
      SUM(CASE WHEN COALESCE(tax_payment_month, 1) = ? THEN COALESCE(monthly_tax, 0) ELSE 0 END) as forecast_tax_lump
    FROM portfolio_units
  `).get(month, month) as any;

  const monthlyForecast = {
    rent: portfolio?.forecast_rent || 0,
    hoa: -(portfolio?.forecast_hoa || 0),
    insurance: -(portfolio?.forecast_insurance_lump || 0),
    tax: -(portfolio?.forecast_tax_lump || 0),
    fund_expense: -(75_000 / 12),
  };

  const actualsByCategory: Record<string, number> = {};
  for (const row of actuals) {
    actualsByCategory[row.category] = row.total;
  }

  const variance = Object.entries(monthlyForecast).map(([category, forecast]) => ({
    category,
    forecast: forecast as number,
    actual: actualsByCategory[category] || 0,
    variance: (actualsByCategory[category] || 0) - (forecast as number),
  }));

  res.json({
    variance,
    actuals_by_category: actuals,
    monthly_forecast: monthlyForecast,
    period: { from, to },
  });
});

// GET /api/actuals/uploads - List upload history
router.get('/uploads', (req: Request, res: Response) => {
  const db = getDb();
  const uploads = db.prepare(`
    SELECT
      u.*,
      COALESCE((
        SELECT COUNT(*) FROM bank_transactions bt
        WHERE bt.bank_upload_id = u.id
      ), 0) as bank_row_count,
      COALESCE((
        SELECT SUM(bt.amount) FROM bank_transactions bt
        WHERE bt.bank_upload_id = u.id
      ), 0) as bank_total_amount,
      COALESCE((
        SELECT COUNT(*) FROM cash_flow_actuals cfa
        JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id
        WHERE bt.bank_upload_id = u.id
      ), 0) as alloc_row_count,
      COALESCE((
        SELECT SUM(cfa.amount) FROM cash_flow_actuals cfa
        JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id
        WHERE bt.bank_upload_id = u.id
      ), 0) as alloc_total_amount,
      COALESCE((
        SELECT COUNT(*) FROM cash_flow_actuals cfa
        JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id
        WHERE bt.bank_upload_id = u.id AND cfa.reconciled = 1
      ), 0) as reconciled_alloc_count,
      COALESCE((
        SELECT SUM(cfa.amount) FROM cash_flow_actuals cfa
        JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id
        WHERE bt.bank_upload_id = u.id AND cfa.reconciled = 1
      ), 0) as reconciled_alloc_total_amount,
      COALESCE((
        SELECT COUNT(*) FROM bank_transactions bt
        LEFT JOIN cash_flow_actuals cfa ON cfa.bank_transaction_id = bt.id
        WHERE bt.bank_upload_id = u.id
        GROUP BY bt.id
        HAVING COALESCE(SUM(cfa.amount), 0) = 0
      ), 0) as unallocated_bank_lines,
      COALESCE((
        SELECT COUNT(*) FROM bank_transactions bt
        LEFT JOIN cash_flow_actuals cfa ON cfa.bank_transaction_id = bt.id
        WHERE bt.bank_upload_id = u.id
        GROUP BY bt.id, bt.amount
        HAVING ABS(bt.amount - COALESCE(SUM(cfa.amount), 0)) > 0.005
      ), 0) as out_of_balance_bank_lines
    FROM bank_uploads u
    ORDER BY u.upload_date DESC
  `).all();
  res.json(uploads);
});

// POST /api/actuals/uploads/:id/close - mark a statement upload reconciled
router.post('/uploads/:id/close', (req: Request, res: Response) => {
  const db = getDb();
  const uploadId = Number(req.params.id);
  if (!uploadId) return res.status(400).json({ error: 'Invalid upload id' });

  const row = db.prepare(`SELECT id, status FROM bank_uploads WHERE id = ?`).get(uploadId) as any;
  if (!row) return res.status(404).json({ error: 'Upload not found' });

  const check = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.bank_upload_id = ?) as bank_rows,
      (SELECT COUNT(*) FROM cash_flow_actuals cfa JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id WHERE bt.bank_upload_id = ? AND cfa.reconciled = 0) as unreconciled_allocs,
      (SELECT COUNT(*) FROM bank_transactions bt
        LEFT JOIN cash_flow_actuals cfa ON cfa.bank_transaction_id = bt.id
        WHERE bt.bank_upload_id = ?
        GROUP BY bt.id
        HAVING COALESCE(SUM(cfa.amount), 0) = 0
      ) as unallocated_lines,
      (SELECT COUNT(*) FROM bank_transactions bt
        LEFT JOIN cash_flow_actuals cfa ON cfa.bank_transaction_id = bt.id
        WHERE bt.bank_upload_id = ?
        GROUP BY bt.id, bt.amount
        HAVING ABS(bt.amount - COALESCE(SUM(cfa.amount), 0)) > 0.005
      ) as out_of_balance_lines
  `).get(uploadId, uploadId, uploadId, uploadId) as any;

  const bankRows = Number(check?.bank_rows || 0);
  const unreconciledAllocs = Number(check?.unreconciled_allocs || 0);
  const unallocated = Number(check?.unallocated_lines || 0);
  const outOfBalance = Number(check?.out_of_balance_lines || 0);

  if (bankRows === 0) {
    return res.status(400).json({ error: 'This upload has no bank transactions.' });
  }
  if (unallocated > 0 || outOfBalance > 0 || unreconciledAllocs > 0) {
    return res.status(400).json({
      error: 'Upload is not fully reconciled.',
      details: { bankRows, unallocated, outOfBalance, unreconciledAllocs },
    });
  }

  const before = db.prepare(`SELECT * FROM bank_uploads WHERE id = ?`).get(uploadId) as any;
  db.prepare(`UPDATE bank_uploads SET status = 'reconciled' WHERE id = ?`).run(uploadId);
  const after = db.prepare(`SELECT * FROM bank_uploads WHERE id = ?`).get(uploadId) as any;
  writeAuditLog({
    db,
    req,
    action: 'close_upload',
    tableName: 'bank_uploads',
    recordId: uploadId,
    before,
    after,
  });
  res.json({ success: true });
});

function csvEscape(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function asMonthRange(month: string): { from: string; toExclusive: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [yStr, mStr] = month.split('-');
  const year = Number(yStr);
  const m0 = Number(mStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(m0) || m0 < 0 || m0 > 11) return null;
  const from = `${yStr}-${mStr}-01`;
  const next = new Date(year, m0 + 1, 1);
  const toExclusive = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return { from, toExclusive };
}

// GET /api/actuals/exports/month/:month?type=allocations|bank_lines|quickbooks_bank|quickbooks_details
router.get('/exports/month/:month', (req: Request, res: Response) => {
  const db = getDb();
  const month = String(req.params.month || '');
  const type = String(req.query.type || 'allocations');
  const range = asMonthRange(month);
  if (!range) return res.status(400).json({ error: 'Invalid month. Expected YYYY-MM.' });

  const { from, toExclusive } = range;

  if (type === 'bank_lines' || type === 'quickbooks_bank') {
    const rows = db.prepare(`
      SELECT
        bt.id as bank_transaction_id,
        bt.date,
        bt.amount,
        bt.description,
        bt.statement_ref,
        bu.filename as upload_filename
      FROM bank_transactions bt
      LEFT JOIN bank_uploads bu ON bu.id = bt.bank_upload_id
      WHERE bt.date >= ? AND bt.date < ?
      ORDER BY bt.date ASC, bt.id ASC
    `).all(from, toExclusive) as any[];

    const header = type === 'quickbooks_bank'
      ? ['Date', 'Description', 'Amount']
      : ['BankTransactionId', 'Date', 'Description', 'Amount', 'StatementRef', 'UploadFilename'];

    const lines = [header.join(',')];
    for (const r of rows) {
      if (type === 'quickbooks_bank') {
        lines.push([r.date, r.description || '', r.amount].map(csvEscape).join(','));
      } else {
        lines.push([r.bank_transaction_id, r.date, r.description || '', r.amount, r.statement_ref || '', r.upload_filename || '']
          .map(csvEscape)
          .join(','));
      }
    }

    const filename = type === 'quickbooks_bank'
      ? `quickbooks-bank-upload-${month}.csv`
      : `bank-lines-${month}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));
    return;
  }

  // allocations / quickbooks_details (both are allocation-level exports, with different columns)
  const allocations = db.prepare(`
    SELECT
      cfa.*,
      bt.amount as bank_amount,
      bt.description as bank_description,
      bt.statement_ref,
      bu.filename as upload_filename,
      e.name as entity_name,
      ur.description as renovation_description,
      bu2.unit_number
    FROM cash_flow_actuals cfa
    LEFT JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id
    LEFT JOIN bank_uploads bu ON bu.id = bt.bank_upload_id
    LEFT JOIN portfolio_units pu ON pu.id = cfa.portfolio_unit_id
    LEFT JOIN building_units bu2 ON bu2.id = pu.building_unit_id
    LEFT JOIN entities e ON e.id = cfa.entity_id
    LEFT JOIN unit_renovations ur ON ur.id = cfa.unit_renovation_id
    WHERE cfa.date >= ? AND cfa.date < ?
    ORDER BY cfa.date ASC, cfa.id ASC
  `).all(from, toExclusive) as any[];

  const header = type === 'quickbooks_details'
    ? [
        'Date',
        'Description',
        'Amount',
        'Category',
        'Unit',
        'Entity',
        'Renovation',
        'StatementRef',
      ]
    : [
        'AllocationId',
        'BankTransactionId',
        'Date',
        'Amount',
        'Category',
        'Description',
        'Unit',
        'Entity',
        'Renovation',
        'UploadFilename',
        'StatementRef',
        'Reconciled',
      ];

  const lines = [header.join(',')];
  for (const a of allocations) {
    if (type === 'quickbooks_details') {
      lines.push([
        a.date,
        a.description || a.bank_description || '',
        a.amount,
        a.category,
        a.unit_number || '',
        a.entity_name || '',
        a.renovation_description || '',
        a.statement_ref || '',
      ].map(csvEscape).join(','));
    } else {
      lines.push([
        a.id,
        a.bank_transaction_id || '',
        a.date,
        a.amount,
        a.category,
        a.description || '',
        a.unit_number || '',
        a.entity_name || '',
        a.renovation_description || '',
        a.upload_filename || '',
        a.statement_ref || '',
        a.reconciled ? 1 : 0,
      ].map(csvEscape).join(','));
    }
  }

  const filename = type === 'quickbooks_details'
    ? `quickbooks-details-${month}.csv`
    : `allocations-${month}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\n'));
});

/* ── Learned Mappings CRUD ───────────────────────────────────── */

// GET /api/actuals/mappings - List all learned description→unit mappings
router.get('/mappings', (req: Request, res: Response) => {
  const db = getDb();
  const mappings = db.prepare(`
    SELECT lm.*, bu.unit_number
    FROM learned_mappings lm
    LEFT JOIN portfolio_units pu ON lm.portfolio_unit_id = pu.id
    LEFT JOIN building_units bu ON pu.building_unit_id = bu.id
    ORDER BY lm.created_at DESC
  `).all();
  res.json(mappings);
});

// POST /api/actuals/mappings - Create a new mapping
router.post('/mappings', (req: Request, res: Response) => {
  const db = getDb();
  const { pattern, portfolioUnitId, category } = req.body;

  if (!pattern || !portfolioUnitId) {
    return res.status(400).json({ error: 'pattern and portfolioUnitId are required' });
  }

  // Check for duplicate pattern
  const existing = db.prepare(
    `SELECT id FROM learned_mappings WHERE description_pattern = ?`
  ).get(pattern);
  if (existing) {
    const before = db.prepare(`SELECT * FROM learned_mappings WHERE id = ?`).get((existing as any).id);
    // Update existing mapping
    db.prepare(
      `UPDATE learned_mappings SET portfolio_unit_id = ?, category = ? WHERE description_pattern = ?`
    ).run(portfolioUnitId, category || null, pattern);
    const after = db.prepare(`SELECT * FROM learned_mappings WHERE id = ?`).get((existing as any).id);
    writeAuditLog({
      db,
      req,
      action: 'upsert',
      tableName: 'learned_mappings',
      recordId: (existing as any).id,
      before,
      after,
    });
    return res.json({ success: true, updated: true });
  }

  const result = db.prepare(
    `INSERT INTO learned_mappings (description_pattern, portfolio_unit_id, category) VALUES (?, ?, ?)`
  ).run(pattern, portfolioUnitId, category || null);
  const created = db.prepare(`SELECT * FROM learned_mappings WHERE id = ?`).get(Number(result.lastInsertRowid));
  writeAuditLog({
    db,
    req,
    action: 'create',
    tableName: 'learned_mappings',
    recordId: result.lastInsertRowid as any,
    before: null,
    after: created,
  });

  res.json({
    id: result.lastInsertRowid,
    success: true,
  });
});

// DELETE /api/actuals/mappings/:id - Delete a mapping
router.delete('/mappings/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const before = db.prepare(`SELECT * FROM learned_mappings WHERE id = ?`).get(Number(id));
  const result = db.prepare(`DELETE FROM learned_mappings WHERE id = ?`).run(Number(id));

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Mapping not found' });
  }
  writeAuditLog({
    db,
    req,
    action: 'delete',
    tableName: 'learned_mappings',
    recordId: String(id),
    before,
    after: null,
  });

  res.json({ success: true });
});

export default router;
