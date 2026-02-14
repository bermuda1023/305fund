/**
 * Entity/LLC management routes.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireGP);

// GET /api/entities
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const entities = db.prepare(`
    SELECT e.*,
      (SELECT COUNT(*) FROM portfolio_units pu WHERE pu.entity_id = e.id) as unit_count
    FROM entities e
    ORDER BY e.name
  `).all();
  res.json(entities);
});

// POST /api/entities
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, type = 'llc', stateOfFormation, ein, registeredAgent, formationDate, notes } = req.body;

  const result = db.prepare(`
    INSERT INTO entities (name, type, state_of_formation, ein, registered_agent, formation_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, type, stateOfFormation, ein, registeredAgent, formationDate, notes);

  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/entities/:id
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { name, type, stateOfFormation, ein, registeredAgent, formationDate, status, notes } = req.body;

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

  res.json({ success: true });
});

// GET /api/entities/:id/documents
router.get('/:id/documents', (req: Request, res: Response) => {
  const db = getDb();
  const docs = db.prepare(
    "SELECT * FROM documents WHERE parent_type = 'entity' AND parent_id = ? ORDER BY uploaded_at DESC"
  ).all(req.params.id);
  res.json(docs);
});

export default router;
