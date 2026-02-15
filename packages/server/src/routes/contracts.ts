/**
 * Contract/consensus tracking routes.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { BUILDING } from '@brickell/shared';
import ExcelJS from 'exceljs';
import multer from 'multer';

const router = Router();
router.use(requireAuth, requireGP);
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function worksheetToMatrix(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    // ExcelJS row.values is 1-indexed, first item is unused.
    rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
}

// GET /api/contracts - All units with consensus/agreement status
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const units = db.prepare(`
    SELECT
      bu.id,
      bu.floor,
      bu.unit_letter,
      bu.unit_number,
      bu.unit_type_id,
      bu.is_fund_owned,
      CASE WHEN bu.is_fund_owned = 1 THEN 'signed' ELSE bu.consensus_status END as consensus_status,
      CASE WHEN bu.is_fund_owned = 1 THEN 'signed' ELSE bu.listing_agreement END as listing_agreement,
      CASE WHEN bu.is_fund_owned = 1 THEN COALESCE(t.name, bu.resident_name) ELSE bu.resident_name END as resident_name,
      CASE WHEN bu.is_fund_owned = 1 THEN 'investment' ELSE bu.resident_type END as resident_type,
      CASE WHEN bu.is_fund_owned = 1 THEN COALESCE(e.name, bu.owner_name) ELSE bu.owner_name END as owner_name,
      bu.owner_email,
      bu.owner_phone,
      CASE WHEN bu.is_fund_owned = 1 THEN COALESCE(e.name, bu.owner_company) ELSE bu.owner_company END as owner_company,
      bu.notes,
      COALESCE(ut.ownership_pct, 0) as ownership_pct, COALESCE(ut.sqft, 0) as sqft, COALESCE(ut.beds, 0) as beds,
      CASE WHEN bu.is_fund_owned THEN 'Fund Owned' ELSE NULL END as fund_status
    FROM building_units bu
    LEFT JOIN unit_types ut ON bu.unit_type_id = ut.id
    LEFT JOIN portfolio_units pu ON pu.building_unit_id = bu.id
    LEFT JOIN entities e ON pu.entity_id = e.id
    LEFT JOIN tenants t ON t.id = (
      SELECT t2.id
      FROM tenants t2
      WHERE t2.portfolio_unit_id = pu.id AND t2.status IN ('active', 'month_to_month')
      ORDER BY t2.id DESC
      LIMIT 1
    )
    ORDER BY bu.floor, bu.unit_letter
  `).all();
  res.json(units);
});

// PUT /api/contracts/:id - Update unit status
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const {
    consensusStatus,
    listingAgreement,
    residentName,
    residentType,
    ownerName,
    ownerEmail,
    ownerPhone,
    ownerCompany,
    notes,
  } = req.body;

  db.prepare(`
    UPDATE building_units SET
      consensus_status = COALESCE(?, consensus_status),
      listing_agreement = COALESCE(?, listing_agreement),
      resident_name = COALESCE(?, resident_name),
      resident_type = COALESCE(?, resident_type),
      owner_name = COALESCE(?, owner_name),
      owner_email = COALESCE(?, owner_email),
      owner_phone = COALESCE(?, owner_phone),
      owner_company = COALESCE(?, owner_company),
      notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(
    consensusStatus,
    listingAgreement,
    residentName,
    residentType,
    ownerName,
    ownerEmail,
    ownerPhone,
    ownerCompany,
    notes,
    id
  );

  res.json({ success: true });
});

// GET /api/contracts/progress - Vote progress
router.get('/progress', (req: Request, res: Response) => {
  const db = getDb();

  // Unit-count based stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE consensus_status END) = 'signed' THEN 1 ELSE 0 END) as signed_consensus,
      SUM(CASE WHEN (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE listing_agreement END) = 'signed' THEN 1 ELSE 0 END) as signed_listing,
      SUM(CASE WHEN (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE consensus_status END) = 'unsigned' THEN 1 ELSE 0 END) as no_votes,
      SUM(CASE WHEN (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE consensus_status END) = 'unknown' THEN 1 ELSE 0 END) as abstain,
      SUM(CASE
        WHEN (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE consensus_status END) = 'unsigned'
          OR (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE listing_agreement END) = 'unsigned'
        THEN 1 ELSE 0 END
      ) as unsigned,
      SUM(CASE
        WHEN (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE consensus_status END) = 'unknown'
         AND (CASE WHEN is_fund_owned = 1 THEN 'signed' ELSE listing_agreement END) = 'unknown'
        THEN 1 ELSE 0 END
      ) as unknown,
      SUM(CASE WHEN is_fund_owned = 1 THEN 1 ELSE 0 END) as fund_owned
    FROM building_units
  `).get() as any;

  // Ownership-weighted stats (join unit_types for ownership_pct)
  const weighted = db.prepare(`
    SELECT
      COALESCE(SUM(COALESCE(ut.ownership_pct, 0)), 0) as total_ownership,
      COALESCE(SUM(CASE
        WHEN (CASE WHEN bu.is_fund_owned = 1 THEN 'signed' ELSE bu.consensus_status END) = 'signed'
        THEN COALESCE(ut.ownership_pct, 0) ELSE 0 END
      ), 0) as yes_ownership,
      COALESCE(SUM(CASE
        WHEN (CASE WHEN bu.is_fund_owned = 1 THEN 'signed' ELSE bu.consensus_status END) = 'unsigned'
        THEN COALESCE(ut.ownership_pct, 0) ELSE 0 END
      ), 0) as no_ownership,
      COALESCE(SUM(CASE WHEN bu.is_fund_owned = 1 THEN COALESCE(ut.ownership_pct, 0) ELSE 0 END), 0) as fund_ownership
    FROM building_units bu
    LEFT JOIN unit_types ut ON bu.unit_type_id = ut.id
  `).get() as any;

  const total = stats.total || BUILDING.totalUnits;
  const neededFor80 = Math.ceil(total * 0.80);
  const signedConsensus = stats.signed_consensus || 0;
  const signedListing = stats.signed_listing || 0;
  const noVotes = stats.no_votes || 0;
  const abstain = stats.abstain || 0;

  const consensusPct = total > 0 ? signedConsensus / total * 100 : 0;
  const listingPct = total > 0 ? signedListing / total * 100 : 0;
  const noVotePct = total > 0 ? noVotes / total * 100 : 0;
  const abstainPct = total > 0 ? abstain / total * 100 : 0;

  // 5% no votes blocks the deal even if 80% yes
  const isBlocked = noVotePct >= 5;
  // Can pass: 80% yes AND not blocked by 5% no threshold
  const canPass = consensusPct >= 80 && !isBlocked;

  res.json({
    totalUnits: total,
    signedConsensus,
    signedListing,
    unsigned: stats.unsigned || 0,
    unknown: stats.unknown || 0,
    consensusPct,
    listingPct,
    neededFor80Pct: neededFor80,
    remainingToReach80: Math.max(0, neededFor80 - signedListing),
    // New voting logic fields
    noVotes,
    noVotePct,
    isBlocked,
    abstain,
    abstainPct,
    canPass,
    // Ownership-weighted percentages
    noVoteOwnershipPct: weighted.no_ownership || 0,
    yesVoteOwnershipPct: weighted.yes_ownership || 0,
    fundOwnedUnits: stats.fund_owned || 0,
    fundOwnershipPct: weighted.fund_ownership || 0,
  });
});

// GET /api/contracts/flagged - Unsigned holdouts
router.get('/flagged', (req: Request, res: Response) => {
  const db = getDb();
  const flagged = db.prepare(`
    SELECT bu.unit_number, bu.resident_name, bu.resident_type, bu.owner_name, bu.owner_email, bu.owner_phone, bu.consensus_status, bu.listing_agreement,
           bu.notes, COALESCE(ut.ownership_pct, 0) as ownership_pct
    FROM building_units bu
    LEFT JOIN unit_types ut ON bu.unit_type_id = ut.id
    WHERE (CASE WHEN bu.is_fund_owned = 1 THEN 'signed' ELSE bu.listing_agreement END) = 'unsigned'
       OR (CASE WHEN bu.is_fund_owned = 1 THEN 'signed' ELSE bu.consensus_status END) = 'unsigned'
    ORDER BY bu.floor, bu.unit_letter
  `).all();
  res.json(flagged);
});

// POST /api/contracts/import-master-list - Import BTH master list Excel
router.post('/import-master-list', importUpload.single('file'), async (req: Request, res: Response) => {
  const db = getDb();
  const { filePath } = req.body as { filePath?: string };
  const uploadFile = (req as any).file as Express.Multer.File | undefined;

  if (!filePath && !uploadFile) {
    return res.status(400).json({ error: 'Provide file upload or filePath' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    if (uploadFile?.buffer) {
      const arrayBuffer = uploadFile.buffer.buffer.slice(
        uploadFile.buffer.byteOffset,
        uploadFile.buffer.byteOffset + uploadFile.buffer.byteLength
      ) as ArrayBuffer;
      await workbook.xlsx.load(arrayBuffer);
    } else if (filePath) {
      await workbook.xlsx.readFile(filePath);
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return res.status(400).json({ error: 'Workbook has no worksheets' });
    }
    const rows = worksheetToMatrix(worksheet) as any[][];

    // Skip header row (row 0)
    const dataRows = rows.slice(1).filter((row) => row[3]); // column D = unit

    // Build unit_number lookup: DB unit_number → id
    const allUnits = db.prepare('SELECT id, unit_number, floor FROM building_units').all() as any[];
    const unitMap = new Map<string, number>();
    for (const u of allUnits) {
      unitMap.set(u.unit_number.toUpperCase(), u.id);
    }

    /**
     * Map Excel unit format to DB unit format:
     * Excel: "02A" → DB: "2A"
     * Excel: "PH-K" → DB: "21K"
     * Excel: "01A" → DB: "1A"
     * Excel: "CU-A1" → DB: "A1" (commercial/ground floor)
     * Excel: "12E" → DB: "12E&F" (combined unit)
     */
    function normalizeUnit(excelUnit: string): string {
      let unit = excelUnit.trim().toUpperCase();
      // Handle PH- prefix -> floor 22
      if (unit.startsWith('PH-')) {
        return '22' + unit.slice(3);
      }
      if (unit.startsWith('PH')) {
        return '22' + unit.slice(2);
      }
      // Handle CU- prefix → ground floor commercial units
      if (unit.startsWith('CU-')) {
        return unit.slice(3);
      }
      // Strip leading zeros from floor number
      const match = unit.match(/^(\d+)(.+)$/);
      if (match) {
        const floor = parseInt(match[1], 10);
        const letter = match[2];
        const normalized = floor + letter;

        // Direct match first
        if (unitMap.has(normalized)) return normalized;

        // Try combined unit formats
        if (floor === 12 && (letter === 'E' || letter === 'F')) return '12E&F';
        if (floor === 19 && (letter === 'E' || letter === 'F')) return '19E&F';
        if (floor === 19 && (letter === 'G' || letter === 'H')) return '19G&H';

        return normalized;
      }
      return unit;
    }

    const update = db.prepare(`
      UPDATE building_units SET
        consensus_status = ?,
        listing_agreement = ?,
        resident_name = ?,
        resident_type = ?,
        owner_name = ?,
        owner_email = ?,
        owner_phone = ?,
        owner_company = ?,
        notes = COALESCE(?, notes)
      WHERE id = ?
    `);

    let matched = 0;
    let skipped = 0;
    const unmatched: string[] = [];

    const importAll = db.transaction(() => {
      for (const row of dataRows) {
        const excelUnit = String(row[3] || '').trim();
        if (!excelUnit) continue;

        const dbUnit = normalizeUnit(excelUnit);
        const unitId = unitMap.get(dbUnit);
        if (!unitId) {
          unmatched.push(`${excelUnit} → ${dbUnit}`);
          skipped++;
          continue;
        }

        const name = String(row[1] || '').trim();
        const company = String(row[2] || '').trim() || null;
        const phone = [row[4], row[5]].filter(Boolean).map(String).join(' / ').trim() || null;
        const email = String(row[6] || '').trim() || null;

        // Determine resident type
        const isResidential = String(row[7] || '').trim().toUpperCase().startsWith('X');
        const isInvestment = String(row[8] || '').trim().toUpperCase().startsWith('X');
        const residentType = isResidential ? 'residential' : isInvestment ? 'investment' : null;

        // Consensus: column J has 'X' if consensus obtained
        const hasConsensus = String(row[9] || '').trim().toUpperCase() === 'X';
        // Sent: column K has 'X' if agreement was sent
        const wasSent = String(row[10] || '').trim().toUpperCase() === 'X';
        // Signed: column L has 'S' if listing agreement signed
        const hasSigned = String(row[11] || '').trim().toUpperCase() === 'S';

        // Map to DB status values
        let consensusStatus: string;
        if (hasConsensus) {
          consensusStatus = 'signed';
        } else if (wasSent) {
          consensusStatus = 'unsigned'; // was sent but didn't sign consensus
        } else {
          consensusStatus = 'unknown';
        }

        let listingAgreement: string;
        if (hasSigned) {
          listingAgreement = 'signed';
        } else if (wasSent) {
          listingAgreement = 'unsigned'; // was sent but not signed
        } else {
          listingAgreement = 'unknown';
        }

        const notes = String(row[12] || '').trim() || null;

        update.run(
          consensusStatus,
          listingAgreement,
          name || null,
          residentType,
          name || null,
          email,
          phone,
          company,
          notes,
          unitId,
        );
        matched++;
      }
    });

    importAll();

    res.json({
      success: true,
      totalRows: dataRows.length,
      matched,
      skipped,
      unmatched: unmatched.slice(0, 20), // Show first 20 unmatched
    });
  } catch (err: any) {
    console.error('Master list import error:', err);
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

export default router;
