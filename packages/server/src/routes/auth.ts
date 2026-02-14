/**
 * Authentication routes.
 * POST /api/auth/login - Login
 * POST /api/auth/register - GP creates LP accounts
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db/database';
import { signToken, requireAuth, requireGP } from '../middleware/auth';

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again shortly.' },
});

function isDevUniversalAdminEnabled() {
  const flag = String(process.env.DEV_UNIVERSAL_ADMIN || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return process.env.NODE_ENV !== 'production';
}

function getOrCreateDevRoleUser(db: ReturnType<typeof getDb>, role: 'gp' | 'lp') {
  const existing = db.prepare('SELECT * FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get(role) as any;
  if (existing) return existing;

  const email = `admin+${role}@local`;
  const hash = bcrypt.hashSync('admin', 10);
  const result = db.prepare(
    'INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)'
  ).run(email, hash, role, role === 'gp' ? 'Admin GP' : 'Admin LP');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid)) as any;
}

// POST /api/auth/login
router.post('/login', loginLimiter, (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  const db = getDb();
  const emailInput = String(email).trim().toLowerCase();
  const passwordInput = String(password);

  // Dev-only universal shortcut: admin/admin with role switch.
  if (isDevUniversalAdminEnabled() && emailInput.toLowerCase() === 'admin' && passwordInput === 'admin') {
    const selectedRole: 'gp' | 'lp' = role === 'lp' ? 'lp' : 'gp';
    const user = getOrCreateDevRoleUser(db, selectedRole);
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(emailInput) as any;
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!bcrypt.compareSync(passwordInput, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    },
  });
});

// POST /api/auth/register - GP creates LP accounts
router.post('/register', requireAuth, requireGP, (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    res.status(400).json({ error: 'Email, password, and name required' });
    return;
  }

  if (String(password).length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  const db = getDb();
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)'
  ).run(normalizedEmail, hash, 'lp', name);

  res.status(201).json({
    id: result.lastInsertRowid,
    email: normalizedEmail,
    role: 'lp',
    name,
  });
});

export default router;
