# Drizzle Migration Workflow

Drizzle is now the only schema and migration workflow for the SQLite databases in this repo.

## Schema sources

- `backend/db/schema/system.ts`
- `backend/db/schema/company.ts`

These files are the source of truth.

## Generate migrations

After editing schema files:

```bash
npm run db:generate
```

Or target one side only:

```bash
npm run db:generate:system
npm run db:generate:company
```

Generated SQL lands in:

- `backend/db/migrations/system`
- `backend/db/migrations/company`

## Apply migrations

Apply both system and company migrations:

```bash
npm run db:migrate
```

Or target one side only:

```bash
npm run db:migrate:system
npm run db:migrate:companies
```

## Runtime behavior

- Opening a system or company SQLite database runs the Drizzle migration set automatically.
- Existing legacy databases are bridged into `__drizzle_migrations` once so the baseline migration is not replayed.
- Old `jtzt_*_migrations` tables are removed automatically after the Drizzle runner succeeds.
