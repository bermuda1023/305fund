/**
 * Entity/LLC management routes.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

const router = Router();
router.use(requireAuth, requireGP);
const usePostgresEntities = () => isPostgresPrimaryMode() || usePostgresReads();

// GET /api/entities
router.get('/', async (req: Request, res: Response) => {
  const entities = usePostgresEntities()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(`
        SELECT e.*,
          (SELECT COUNT(*) FROM portfolio_units pu WHERE pu.entity_id = e.id) as unit_count
        FROM entities e
        ORDER BY e.name
      `);
      return result.rows;
    })
    : getDb().prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM portfolio_units pu WHERE pu.entity_id = e.id) as unit_count
      FROM entities e
      ORDER BY e.name
    `).all();
  res.json(entities);
});

// POST /api/entities
router.post('/', async (req: Request, res: Response) => {
  const { name, type = 'llc', stateOfFormation, ein, registeredAgent, formationDate, notes } = req.body;

  const createdId = usePostgresEntities()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO entities (name, type, state_of_formation, ein, registered_agent, formation_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [name, type, stateOfFormation, ein, registeredAgent, formationDate, notes]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO entities (name, type, state_of_formation, ein, registered_agent, formation_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(name, type, stateOfFormation, ein, registeredAgent, formationDate, notes).lastInsertRowid
    );

  res.status(201).json({ id: createdId });
});

// PUT /api/entities/:id
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, type, stateOfFormation, ein, registeredAgent, formationDate, status, notes } = req.body;

  if (usePostgresEntities()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE entities SET
           name = COALESCE($1, name),
           type = COALESCE($2, type),
           state_of_formation = COALESCE($3, state_of_formation),
           ein = COALESCE($4, ein),
           registered_agent = COALESCE($5, registered_agent),
           formation_date = COALESCE($6, formation_date),
           status = COALESCE($7, status),
           notes = COALESCE($8, notes)
         WHERE id = $9`,
        [name, type, stateOfFormation, ein, registeredAgent, formationDate, status, notes, id]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      UPDATE entities SET
        name = COALESCE(?, name),
        type = COALESCE(?, type),
        state_of_formation = COALESCE(?, state_of_formation),
        ein = COALESCE(?, ein),
        registered_agent = COALESCE(?, registered_agent),
        formation_date = COALESCE(?, formation_date),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(name, type, stateOfFormation, ein, registeredAgent, formationDate, status, notes, id);
  }

  res.json({ success: true });
});

// GET /api/entities/:id/documents
router.get('/:id/documents', async (req: Request, res: Response) => {
  const docs = usePostgresEntities()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        "SELECT * FROM documents WHERE parent_type = 'entity' AND parent_id = $1 ORDER BY uploaded_at DESC",
        [req.params.id]
      );
      return result.rows;
    })
    : getDb().prepare(
      "SELECT * FROM documents WHERE parent_type = 'entity' AND parent_id = ? ORDER BY uploaded_at DESC"
    ).all(req.params.id);
  res.json(docs);
});

export default router;
