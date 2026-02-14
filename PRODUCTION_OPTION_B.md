# Production Setup (Option B - Cheap)

This app can now run with cloud object storage using:

- Backend: Render (Starter web service)
- Database: managed Postgres (recommended next migration step)
- File storage: Cloudflare R2 or AWS S3

## 1) Required environment variables

- `NODE_ENV=production`
- `JWT_SECRET=<strong random secret>`
- `CLIENT_URL=https://<your-frontend-domain>`
- `STORAGE_BACKEND=s3`
- `S3_BUCKET=<bucket-name>`
- `S3_REGION=<region>` (e.g. `us-east-1`)
- `S3_ENDPOINT=<endpoint>` (required for Cloudflare R2)
- `S3_ACCESS_KEY_ID=<key>`
- `S3_SECRET_ACCESS_KEY=<secret>`
- `S3_FORCE_PATH_STYLE=true|false` (true for some S3-compatible providers)

## 2) Render deploy

Use the included `render.yaml` blueprint or deploy with Docker using:

```bash
docker build -t brickell-fund-api .
docker run -p 3001:3001 --env-file .env brickell-fund-api
```

## 3) File serving model

- Uploaded docs/statements/receipts are stored in object storage when `STORAGE_BACKEND=s3`.
- API returns file paths like `/api/files/<encoded-key>`.
- Files are streamed through the authenticated backend route, so buckets can remain private.

## 4) Important note on database

The current server still uses SQLite (`better-sqlite3`) in code.
For fully managed DB production, migrate DB access to Postgres before scaling.
