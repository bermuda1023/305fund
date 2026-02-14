import { Router, type Request, type Response } from 'express';
import { requireAuth, requireGP } from '../middleware/auth';
import { getDb } from '../db/database';
import multer from 'multer';
import path from 'path';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { PDFParse } from 'pdf-parse';
import { deleteStoredFile, saveUploadedBuffer } from '../lib/storage';

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
  const shouldApply = !!statementRef || Number(row.reconciled) === 1;
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
      SELECT SUM(amount)
      FROM capital_transactions
      WHERE lp_account_id = lp_accounts.id AND type = 'call'
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

  const shouldSync = row.category === 'capital_call' && !!row.lp_account_id && !!row.capital_call_item_id && row.amount > 0;
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
  }
) {
  const { filename, rows, fileType, status = 'parsed', filePath } = params;

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
    `SELECT id FROM cash_flow_actuals WHERE date = ? AND amount = ? AND description = ? LIMIT 1`
  );

  const upload = db.prepare(`
    INSERT INTO bank_uploads (filename, upload_date, file_type, row_count, status, file_path)
    VALUES (?, datetime('now'), ?, ?, ?, ?)
  `).run(filename, fileType, rows.length, status, filePath || null);

  if (status !== 'parsed') {
    return {
      upload_id: upload.lastInsertRowid,
      rows_imported: 0,
      rows_skipped: 0,
      total_rows: rows.length,
      rows_invalid: 0,
    };
  }

  const insert = db.prepare(`
    INSERT INTO cash_flow_actuals (
      portfolio_unit_id, lp_account_id, capital_call_item_id, date, amount, category, description, source_file, statement_ref, reconciled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      const statementRef = String(row.statement_ref || row.statementRef || '').trim();
      const reconciled = statementRef ? 1 : 0;
      const insertResult = insert.run(unitId, lpAccountId, capitalCallItemId, date, amount, category, desc, filename, statementRef || null, reconciled);
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
router.get('/transactions', (req: Request, res: Response) => {
  const db = getDb();
  const { unit_id, category, reconciled, limit = 100, offset = 0 } = req.query;

  let sql = `SELECT cfa.*, pu.id as portfolio_unit_id, bu.unit_number, lpa.name as lp_name,
      cci.capital_call_id, cc.call_number
    FROM cash_flow_actuals cfa
    LEFT JOIN portfolio_units pu ON cfa.portfolio_unit_id = pu.id
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
  if (category) {
    sql += ` AND cfa.category = ?`;
    params.push(category);
  }
  if (reconciled !== undefined) {
    sql += ` AND cfa.reconciled = ?`;
    params.push(reconciled === 'true' ? 1 : 0);
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

  // OFX/QFX is stored for manual review right now.
  if (fileType === 'ofx') {
    const result = importTransactions(db, {
      filename: file.originalname,
      rows: [],
      fileType: fileType as 'ofx',
      status: 'pending_review',
      filePath: relativePath,
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
      const existing = db.prepare('SELECT id, portfolio_unit_id FROM cash_flow_actuals WHERE id = ?').get(existingTransactionId) as any;
      if (!existing) {
        throw new Error('Transaction not found');
      }
      db.prepare(`
        UPDATE cash_flow_actuals
        SET portfolio_unit_id = COALESCE(portfolio_unit_id, ?),
            source_file = ?,
            receipt_document_id = ?
        WHERE id = ?
      `).run(portfolioUnitId, relativePath, documentId, existingTransactionId);
      transactionId = existingTransactionId;
    } else if (createExpense) {
      const date = parseDateValue(req.body.date);
      const amount = parseAmount(req.body.amount);
      const category = String(req.body.category || 'other').toLowerCase();
      const description = String(req.body.description || '').trim() || 'Receipt expense';
      if (!date || amount === null) {
        throw new Error('Valid date and amount are required to create expense');
      }
      const allowedCats = new Set(['hoa', 'insurance', 'tax', 'repair', 'management_fee', 'fund_expense', 'other']);
      const safeCategory = allowedCats.has(category) ? category : 'other';
      const insertResult = db.prepare(`
        INSERT INTO cash_flow_actuals (
          portfolio_unit_id, date, amount, category, description, source_file, receipt_document_id, reconciled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(portfolioUnitId, date, amount, safeCategory, description, relativePath, documentId);
      transactionId = Number(insertResult.lastInsertRowid);
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
  })().catch((error: any) => {
    res.status(400).json({ error: error?.message || 'Failed to save receipt' });
  });
});

// PUT /api/actuals/transactions/:id - Categorize/reconcile a transaction
router.put('/transactions/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { category, portfolio_unit_id, lp_account_id, capital_call_item_id, reconciled, description, statement_ref } = req.body;
  const before = db.prepare('SELECT * FROM cash_flow_actuals WHERE id = ?').get(Number(id)) as any;
  if (!before) {
    return res.status(404).json({ error: 'Transaction not found' });
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
    if (statement_ref) {
      updates.push('reconciled = ?');
      params.push(1);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const nextCategory = category !== undefined ? String(category) : String(before.category);
  const nextLpAccountId = lp_account_id !== undefined ? (lp_account_id || null) : (before.lp_account_id || null);
  const nextCallItemId = capital_call_item_id !== undefined ? (capital_call_item_id || null) : (before.capital_call_item_id || null);
  const nextPortfolioUnitId = portfolio_unit_id !== undefined ? (portfolio_unit_id || null) : (before.portfolio_unit_id || null);
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
  }

  res.json({ success: true });
});

// GET /api/actuals/variance - Actual vs forecast comparison
router.get('/variance', (req: Request, res: Response) => {
  const db = getDb();

  // Get actuals grouped by category
  const actuals = db.prepare(`
    SELECT category, SUM(amount) as total, COUNT(*) as count
    FROM cash_flow_actuals
    GROUP BY category
    ORDER BY total DESC
  `).all() as any[];

  // Get forecast from portfolio units (monthly projections)
  const portfolio = db.prepare(`
    SELECT
      SUM(monthly_rent) as forecast_rent,
      SUM(monthly_hoa) as forecast_hoa,
      SUM(monthly_insurance) as forecast_insurance,
      SUM(monthly_tax) as forecast_tax
    FROM portfolio_units
  `).get() as any;

  const monthlyForecast = {
    rent: portfolio?.forecast_rent || 0,
    hoa: -(portfolio?.forecast_hoa || 0),
    insurance: -((portfolio?.forecast_insurance || 0) / 12),
    tax: -((portfolio?.forecast_tax || 0) / 12),
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
  });
});

// GET /api/actuals/uploads - List upload history
router.get('/uploads', (req: Request, res: Response) => {
  const db = getDb();
  const uploads = db.prepare('SELECT * FROM bank_uploads ORDER BY upload_date DESC').all();
  res.json(uploads);
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
    // Update existing mapping
    db.prepare(
      `UPDATE learned_mappings SET portfolio_unit_id = ?, category = ? WHERE description_pattern = ?`
    ).run(portfolioUnitId, category || null, pattern);
    return res.json({ success: true, updated: true });
  }

  const result = db.prepare(
    `INSERT INTO learned_mappings (description_pattern, portfolio_unit_id, category) VALUES (?, ?, ?)`
  ).run(pattern, portfolioUnitId, category || null);

  res.json({
    id: result.lastInsertRowid,
    success: true,
  });
});

// DELETE /api/actuals/mappings/:id - Delete a mapping
router.delete('/mappings/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const result = db.prepare(`DELETE FROM learned_mappings WHERE id = ?`).run(Number(id));

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Mapping not found' });
  }

  res.json({ success: true });
});

export default router;
