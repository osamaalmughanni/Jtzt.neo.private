# Jtzt

Jtzt is a multi-tenant employee working-hours tracker built with React, Vite, TypeScript, Hono, and SQLite.

## Stack

- Frontend: React + Vite + TypeScript
- UI: TailwindCSS with shadcn-style components
- Backend: Hono + TypeScript
- Database: SQLite via `better-sqlite3`

## Structure

```text
frontend/
backend/
shared/
data/
```

- `data/app.db` is the single application database.
- Every company-owned row is scoped by `company_id`, which is a GUID.
- Admin import/export uses portable JSON company snapshots instead of raw SQLite files.

## Default admin

- Username: `admin`
- Password: whatever you set in `.env` as `ADMIN_BOOTSTRAP_PASSWORD`

## Scripts

```bash
npm install
npm run dev
```

- Frontend runs on `http://localhost:5173`
- Backend runs on `http://localhost:3000`
- Native Cloudflare Worker dev: `npm run cf:dev`

## Cloudflare

- `.deploy.py` is the single deployment entrypoint for Wrangler config generation, D1 setup, migrations, Cloudflare dev var generation, frontend builds, and Worker deploys.
- `cloudflare/d1/migrations/0001_initial_schema.sql` is the D1 bootstrap schema.
- `cloudflare/worker/index.ts` runs the backend API natively on Workers and serves the SPA assets from the same deployment.
- `.env` is the only env file you manage. It is the single source of truth for local Node dev, local Wrangler dev, and Cloudflare deployment.
- `cloudflare/.dev.vars` is generated from `.env` and should not be edited manually.

## Required `.env` Values

- `CLOUDFLARE_API_TOKEN`: required for fully automated Cloudflare API access.
- `CLOUDFLARE_ACCOUNT_ID`: required for non-interactive Wrangler operations.
- `JWT_SECRET`: required in all environments.
- `CLOUDFLARE_WORKER_NAME`: required for deployment.
- `CLOUDFLARE_D1_DATABASE_NAME`: required for D1 provisioning.
- `CLOUDFLARE_D1_DATABASE_ID`: can stay as a placeholder; deployment commands will create D1 and write it into `.env` automatically if needed.
- `ADMIN_BOOTSTRAP_PASSWORD`: strongly recommended to change for any non-demo environment.
- `CLOUDFLARE_CUSTOM_DOMAIN`: optional.

Recommended API token scope:

- Workers Scripts: edit
- D1: edit
- Account Settings or account read scope needed by Wrangler
- Zone permissions only if you plan to attach a custom domain/route

Recommended sequence:

```bash
python .deploy.py doctor
python .deploy.py prepare-dev
python .deploy.py full
```

Fast path after `.env` is fully filled:

```bash
python .deploy.py full
```

Useful commands:

```bash
python .deploy.py doctor
python .deploy.py prepare-dev
python .deploy.py write-config
python .deploy.py d1-create
python .deploy.py migrate-local
python .deploy.py migrate-remote
python .deploy.py set-secret
python .deploy.py deploy
python .deploy.py full
```
