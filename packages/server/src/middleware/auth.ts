/**
 * JWT authentication and role-based authorization middleware.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

export interface AuthPayload {
  userId: number;
  email: string;
  role: 'gp' | 'lp';
  mustChangePassword?: boolean;
}

type RoleScope = 'accounting' | 'operations' | 'auditor';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.trim().length > 0) return configured;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'dev-secret-change-me';
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, getJwtSecret()) as AuthPayload;
}

/**
 * Require authentication. Extracts user from JWT.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Require GP role.
 */
export function requireGP(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'gp') {
    res.status(403).json({ error: 'GP access required' });
    return;
  }
  next();
}

/**
 * Require either GP or LP role (any authenticated user).
 */
export function requireAnyRole(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/**
 * Optional scoped authorization scaffold beyond GP/LP.
 * GP users are always allowed. For other users, checks user_role_scopes table.
 */
export function requireScope(...scopes: RoleScope[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.role === 'gp') {
      next();
      return;
    }
    if (!scopes.length) {
      next();
      return;
    }
    (async () => {
      try {
        const usePg = isPostgresPrimaryMode() || usePostgresReads();
        const count = usePg
          ? await withPostgresClient(async (client) => {
            const result = await client.query(
              `
              SELECT COUNT(*) as c
              FROM user_role_scopes
              WHERE user_id = $1
                AND scope = ANY($2::text[])
              `,
              [req.user!.userId, scopes]
            );
            return Number(result.rows[0]?.c || 0);
          })
          : (() => {
            const db = getDb();
            const placeholders = scopes.map(() => '?').join(', ');
            const row = db.prepare(`
              SELECT COUNT(*) as c
              FROM user_role_scopes
              WHERE user_id = ?
                AND scope IN (${placeholders})
            `).get(req.user!.userId, ...scopes) as { c?: number } | undefined;
            return Number(row?.c || 0);
          })();
        if (count > 0) {
          next();
          return;
        }
        res.status(403).json({ error: 'Insufficient scope' });
      } catch {
        res.status(403).json({ error: 'Insufficient scope' });
      }
    })();
  };
}
