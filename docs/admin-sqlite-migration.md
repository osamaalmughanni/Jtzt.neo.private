# Admin SQLite Migration

The admin migration path now uses one SQLite file per company snapshot.

## What is exported

The exported file is a single `.sqlite` database with:

* All company-scoped tables from the live company schema.
* A single metadata table named `jtzt_migration_metadata`.
* A generated schema document stored in the metadata row.

The file is self-describing. The schema document is generated from the live schema source of truth, not hand-written.

## Schema source of truth

The migration schema endpoint is generated from:

* `backend/db/schema.ts`
* The active table layout discovered from the company database

The schema response includes:

* Package format information.
* The metadata table contract.
* The ordered list of company tables.
* Column definitions, primary keys, foreign keys, and example values.

## Import flow

Import expects exactly one `.sqlite` file.

1. The package metadata is read from `jtzt_migration_metadata`.
2. The package schema hash is compared with the current generated schema document.
3. The target company database is cleared.
4. The package rows are copied into the target company database in schema order.
5. Any `company_id` column is rewritten to the target company id.

## Export flow

Export builds an in-memory SQLite snapshot, copies the company data into it, writes package metadata, and returns the serialized database as base64.

## Notes

* The legacy multi-file package format is gone.
* The migration path is intentionally single-file only.
* The current route implementation is guarded to the Node runtime because the SQLite package handling uses `better-sqlite3`.
