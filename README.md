# Jtzt

Jtzt is a multi-tenant employee working-hours tracker built with React, Vite, TypeScript, Hono, and SQLite.

## Stack

- Frontend: React + Vite + TypeScript
- UI: TailwindCSS with shadcn-style components
- Backend: Hono + TypeScript
- Database: local SQLite via `better-sqlite3`

## Local layout

```text
frontend/
backend/
shared/
data/
docs/
```

- `data/system.db` is the system database.
- `data/companies/*.sqlite` stores one SQLite database per company.
- Company import/export uses single-file SQLite migration packages.

## Default admin

- Username: `admin`
- Password: whatever you set in `.env` as `ADMIN_BOOTSTRAP_PASSWORD`

## Scripts

```bash
npm install
npm run dev
npm run db:generate
npm run db:migrate
```

- Frontend runs on `http://localhost:5173`
- Backend runs on `http://localhost:3000`

Deployment runs through `.deploy.py` and targets the Hetzner host and domain configured in `.env`.

Useful commands:

```bash
python .deploy.py
python .deploy.py doctor
python .deploy.py bootstrap
python .deploy.py typecheck
python .deploy.py build
python .deploy.py deploy
python .deploy.py status
python .deploy.py rollback
python .deploy.py logs
python .deploy.py full
```

## Deployment model

- The live app runs on a single Debian host.
- SQLite files live outside the release directory, so deploys do not overwrite databases.
- Releases are versioned and switched by symlink.
- `.deploy.py` fingerprints the release payload, hashes managed setup files, and caches `node_modules` by lockfile hash so unchanged deploys skip reinstalling the same server setup and dependency tree.
- Running `python .deploy.py` now does the full smart path and ends with one combined report.
- A systemd unit keeps the backend running and restarting on failure.
- Caddy terminates HTTPS on the public domain and renews Let's Encrypt certificates automatically.
- Deploys take a backup of the SQLite data directory before the release switch.

## Environment

Recommended `.env` values:

- `DEPLOY_DOMAIN=app.jtzt.com`
- `DEPLOY_HOST=91.99.214.245`
- `DEPLOY_USER=root`
- `DEPLOY_PORT=22`
- `JWT_SECRET=<strong secret>`
- `ADMIN_ACCESS_TOKEN=<strong secret>`
- `APP_ENV=development`
- `PORT=3000`

The script will generate strong values for `JWT_SECRET` and `ADMIN_ACCESS_TOKEN` if they are missing or placeholders. Changing `DEPLOY_DOMAIN` and rerunning deploy rewrites the Caddy config automatically.
