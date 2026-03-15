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

- `data/system.db` stores global admins and company records.
- Each company gets its own SQLite file such as `data/company_acme.db`.

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
