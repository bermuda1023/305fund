/**
 * Authentication routes.
 * POST /api/auth/login - Login
 * POST /api/auth/register - GP creates LP accounts
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db/database';
import { signToken, requireAuth, requireGP } from '../middleware/auth';
import { sendTransactionalEmail } from '../lib/email';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again shortly.' },
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Please try again shortly.' },
});

function isDevUniversalAdminEnabled() {
  const flag = String(process.env.DEV_UNIVERSAL_ADMIN || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;
  return process.env.NODE_ENV !== 'production';
}

function usePostgresAuth() {
  return isPostgresPrimaryMode() || usePostgresReads();
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

async function getOrCreateDevRoleUserPg(role: 'gp' | 'lp') {
  return withPostgresClient(async (client) => {
    const existing = await client.query('SELECT * FROM users WHERE role = $1 ORDER BY id ASC LIMIT 1', [role]);
    if (existing.rows[0]) return existing.rows[0] as any;
    const email = `admin+${role}@local`;
    const hash = bcrypt.hashSync('admin', 10);
    const created = await client.query(
      'INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING *',
      [email, hash, role, role === 'gp' ? 'Admin GP' : 'Admin LP']
    );
    return created.rows[0] as any;
  });
}

function hashResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function buildResetLink(token: string) {
  const base = String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0]?.trim() || 'http://localhost:5173';
  const normalizedBase = base.replace(/\/+$/, '');
  return `${normalizedBase}/reset-password?token=${encodeURIComponent(token)}`;
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  const emailInput = String(email).trim().toLowerCase();
  const passwordInput = String(password);

  // Dev-only universal shortcut: admin/admin with role switch.
  if (isDevUniversalAdminEnabled() && emailInput.toLowerCase() === 'admin' && passwordInput === 'admin') {
    const selectedRole: 'gp' | 'lp' = role === 'lp' ? 'lp' : 'gp';
    const user = usePostgresAuth()
      ? await getOrCreateDevRoleUserPg(selectedRole)
      : getOrCreateDevRoleUser(getDb(), selectedRole);
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    res.json({
      token,
      user: {
        id: Number(user.id),
        email: user.email,
        role: user.role,
        name: user.name,
        mustChangePassword: false,
      },
    });
    return;
  }

  const user = usePostgresAuth()
    ? (await withPostgresClient(async (client) => {
      const result = await client.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [emailInput]);
      return (result.rows[0] || null) as any;
    }))
    : (getDb().prepare('SELECT * FROM users WHERE email = ?').get(emailInput) as any);
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (user.role === 'lp') {
    const lpAccount = usePostgresAuth()
      ? (await withPostgresClient(async (client) => {
        const result = await client.query('SELECT status FROM lp_accounts WHERE user_id = $1 LIMIT 1', [user.id]);
        return (result.rows[0] || null) as any;
      }))
      : (getDb().prepare('SELECT status FROM lp_accounts WHERE user_id = ?').get(user.id) as any);
    if (lpAccount && String(lpAccount.status || '').toLowerCase() === 'inactive') {
      res.status(403).json({ error: 'This LP account has been deactivated. Please contact support.' });
      return;
    }
  }

  if (!bcrypt.compareSync(passwordInput, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: !!user.must_change_password,
  });

  res.json({
    token,
    user: {
      id: Number(user.id),
      email: user.email,
      role: user.role,
      name: user.name,
      mustChangePassword: !!user.must_change_password,
    },
  });
});

// POST /api/auth/forgot-password - request reset link
router.post('/forgot-password', forgotPasswordLimiter, async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const user = usePostgresAuth()
    ? (await withPostgresClient(async (client) => {
      const result = await client.query('SELECT id, email, name FROM users WHERE email = $1 LIMIT 1', [email]);
      return (result.rows[0] || null) as any;
    }))
    : (getDb().prepare('SELECT id, email, name FROM users WHERE email = ?').get(email) as any);
  if (user) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    if (usePostgresAuth()) {
      await withPostgresClient(async (client) => {
        await client.query(
          `UPDATE users
           SET reset_password_token_hash = $1, reset_password_expires_at = $2
           WHERE id = $3`,
          [tokenHash, expiresAt, user.id]
        );
      });
    } else {
      const db = getDb();
      db.prepare(`
        UPDATE users
        SET reset_password_token_hash = ?, reset_password_expires_at = ?
        WHERE id = ?
      `).run(tokenHash, expiresAt, user.id);
    }

    const resetLink = buildResetLink(rawToken);
    await sendTransactionalEmail({
      to: user.email,
      subject: 'Reset your password',
      text:
        `Hi ${user.name || 'there'},\n\n` +
        `We received a request to reset your password.\n` +
        `Use this link to set a new password (valid for 1 hour):\n\n` +
        `${resetLink}\n\n` +
        `If you did not request this, you can ignore this email.`,
    });
  }

  // Always return success to avoid disclosing whether an email exists.
  res.json({
    success: true,
    message: 'If that email is registered, a password reset link has been sent.',
  });
});

// POST /api/auth/reset-password - set new password via token
router.post('/reset-password', async (req: Request, res: Response) => {
  const token = String(req.body?.token || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  if (!token || !newPassword) {
    res.status(400).json({ error: 'Token and newPassword are required' });
    return;
  }
  if (newPassword.length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  const tokenHash = hashResetToken(token);
  const user = usePostgresAuth()
    ? (await withPostgresClient(async (client) => {
      const result = await client.query(
        `SELECT id, reset_password_expires_at
         FROM users
         WHERE reset_password_token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );
      return (result.rows[0] || null) as any;
    }))
    : (getDb().prepare(`
      SELECT id, reset_password_expires_at
      FROM users
      WHERE reset_password_token_hash = ?
      LIMIT 1
    `).get(tokenHash) as any);
  if (!user) {
    res.status(400).json({ error: 'Invalid or expired reset link' });
    return;
  }

  const expiresAt = user.reset_password_expires_at ? new Date(user.reset_password_expires_at).getTime() : 0;
  if (!expiresAt || expiresAt < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired reset link' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  if (usePostgresAuth()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             must_change_password = 0,
             reset_password_token_hash = NULL,
             reset_password_expires_at = NULL
         WHERE id = $2`,
        [hash, user.id]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          must_change_password = 0,
          reset_password_token_hash = NULL,
          reset_password_expires_at = NULL
      WHERE id = ?
    `).run(hash, user.id);
  }

  res.json({ success: true });
});

// POST /api/auth/change-password - authenticated password change
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required' });
    return;
  }
  if (newPassword.length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  const user = usePostgresAuth()
    ? (await withPostgresClient(async (client) => {
      const result = await client.query(
        'SELECT id, email, role, name, password_hash FROM users WHERE id = $1 LIMIT 1',
        [req.user!.userId]
      );
      return (result.rows[0] || null) as any;
    }))
    : (getDb().prepare('SELECT id, email, role, name, password_hash FROM users WHERE id = ?').get(req.user!.userId) as any);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  if (usePostgresAuth()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $1,
             must_change_password = 0,
             reset_password_token_hash = NULL,
             reset_password_expires_at = NULL
         WHERE id = $2`,
        [hash, user.id]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          must_change_password = 0,
          reset_password_token_hash = NULL,
          reset_password_expires_at = NULL
      WHERE id = ?
    `).run(hash, user.id);
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: false,
  });

  res.json({
    success: true,
    token,
    user: {
      id: Number(user.id),
      email: user.email,
      role: user.role,
      name: user.name,
      mustChangePassword: false,
    },
  });
});

// POST /api/auth/register - GP creates LP accounts
router.post('/register', requireAuth, requireGP, async (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    res.status(400).json({ error: 'Email, password, and name required' });
    return;
  }

  if (String(password).length < 12) {
    res.status(400).json({ error: 'Password must be at least 12 characters' });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = usePostgresAuth()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [normalizedEmail]);
      return result.rows[0] || null;
    })
    : getDb().prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const insertedId = usePostgresAuth()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        'INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id',
        [normalizedEmail, hash, 'lp', name]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(
        'INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)'
      ).run(normalizedEmail, hash, 'lp', name).lastInsertRowid
    );

  res.status(201).json({
    id: insertedId,
    email: normalizedEmail,
    role: 'lp',
    name,
  });
});

export default router;
