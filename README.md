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
- Password: `admin123`

## Scripts

```bash
npm install
npm run dev
```

- Frontend runs on `http://localhost:5173`
- Backend runs on `http://localhost:3000`
