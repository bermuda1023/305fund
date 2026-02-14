# What I Need From You

To complete final production cutover, I need:

## Required credentials

- `DATABASE_URL` for production Postgres
- `JWT_SECRET` (strong random secret)
- `CLIENT_URL` (final frontend URL)
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT` (required for Cloudflare R2)
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE` (`true` for many S3-compatible providers)

## Optional but recommended

- `OPENAI_API_KEY` (statement/receipt AI parsing)
- `OPENAI_MODEL` (default is set)
- `RESEND_API_KEY` or `SENDGRID_API_KEY`
- `FROM_EMAIL`
- `FRED_API_KEY`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (for bank feed integrations)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (SMS reminders)

## Decisions needed

- Backend host: Render or Railway
- Frontend host: Vercel or Render static
- File retention policy (e.g., 7 years / forever)
- Backup policy (RPO/RTO targets)

## Confirmation needed before go-live

- Approve disabling dev universal login in prod (`DEV_UNIVERSAL_ADMIN=0`)
- Approve running:
  - `pnpm db:migrate:pg`
  - `pnpm db:sync:pg`
  - `pnpm deploy:check`
