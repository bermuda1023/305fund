# Deployment Runbook (Production)

This runbook is the exact sequence for shipping this app to production with cheap, reliable infrastructure:

- Backend: Render (Docker)
- Frontend: Vercel (or Render static)
- Database: Postgres (Neon/Supabase/Render Postgres)
- Files: Cloudflare R2 (S3-compatible)

## 1) One-time setup

1. Create Postgres database and copy `DATABASE_URL`.
2. Create R2 bucket and generate API credentials.
3. Configure backend environment variables:
   - `NODE_ENV=production`
   - `PORT=3001`
   - `JWT_SECRET=<strong random>`
   - `CLIENT_URL=https://<frontend-domain>`
   - `DATABASE_URL=<postgres-url>`
   - `DB_PATH` (only needed for migration source)
   - `STORAGE_BACKEND=s3`
   - `S3_BUCKET=<bucket>`
   - `S3_REGION=auto` (R2) or AWS region
   - `S3_ENDPOINT=<r2 endpoint>`
   - `S3_ACCESS_KEY_ID=<key>`
   - `S3_SECRET_ACCESS_KEY=<secret>`
   - `S3_FORCE_PATH_STYLE=true` (for R2 compatibility)
   - `DEV_UNIVERSAL_ADMIN=0`
4. Configure frontend environment/proxy so `/api` targets backend domain.

## 2) Data migration (SQLite -> Postgres)

Run in this order from repo root:

```bash
pnpm db:migrate:pg
pnpm db:sync:pg
```

Notes:
- `db:sync:pg` reads from local SQLite (`DB_PATH`) and upserts full table snapshots into Postgres in dependency-safe order.
- Re-run is safe for refresh cutovers (it truncates target tables first).

## 3) Preflight gate

```bash
pnpm deploy:check
```

Must be all green before shipping.

## 4) Deploy backend

- Deploy via `render.yaml` + `Dockerfile`.
- Confirm health endpoint:
  - `GET https://<api-domain>/api/health`

## 5) Deploy frontend

- Deploy client bundle to Vercel/Render static.
- Set `CLIENT_URL` in backend to this exact domain.
- Validate login flow + dashboard load.

## 6) Post-deploy smoke checklist

- Login as GP
- Portfolio list and add/delete unit
- Actuals table load and add transaction
- LP Admin load and capital call list
- Model run endpoint returns 200
- Document upload + download path works

## 7) Rollback

- Keep last known good Render deploy.
- If cutover issue:
  1. Roll back backend deploy
  2. Point frontend API back to previous backend
  3. Keep Postgres snapshot for forensics
