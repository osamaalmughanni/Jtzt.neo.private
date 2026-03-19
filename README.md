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
- `.env` is the single source of truth for local Node dev, local Wrangler dev, and Cloudflare deployment.
- `cloudflare/.dev.vars` is generated from `.env` and should not be edited manually.

## Recommended Setup

```bash
cp .env.example .env
```

Fill these in `.env`:

- `JWT_SECRET`: required in all environments.
- `CLOUDFLARE_D1_DATABASE_ID`: required for config, migrations, and remote deploys after `python .deploy.py d1-create`.
- `CLOUDFLARE_WORKER_NAME`: required for deployment.
- `ADMIN_BOOTSTRAP_PASSWORD`: strongly recommended to change for any non-demo environment.
- `CLOUDFLARE_ACCOUNT_ID`: optional, but recommended.
- `CLOUDFLARE_CUSTOM_DOMAIN`: optional.

Recommended sequence:

```bash
python .deploy.py doctor
python .deploy.py prepare-dev
python .deploy.py login
python .deploy.py d1-create
# paste the returned database id into .env
python .deploy.py write-config
python .deploy.py migrate-local
python .deploy.py migrate-remote
python .deploy.py set-secret
python .deploy.py deploy
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
python .deploy.py full
```
