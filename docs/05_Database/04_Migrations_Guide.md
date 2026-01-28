# Migrations Guide (Supabase)

This project uses Supabase Postgres migrations to version and apply all database changes (tables, views, functions, triggers, indexes). Seed data (like yearly pricing) is handled separately so development can be reset quickly and safely.

> Important: Authentication + RLS will be added as the **final step before deployment** to avoid slowing development.

---

## Folder Locations

### Schema changes (migrations)
`/supabase/migrations/`

Use ordered SQL files to create/modify:
- tables
- constraints
- indexes
- views
- functions + triggers

### Seed data (development datasets)
`/supabase/seed/`

Use for:
- pricing lists by season/year
- development-only data resets and imports

---

## File Naming Conventions

### Migrations
Use a numeric prefix + short description:

- `0001_init.sql`
- `0002_core_tables.sql`
- `0003_pricing_seed_2024.sql`
- `0004_views_pricing.sql`
- `0005_orders.sql`
- `0006_deliveries_returns_replants.sql`
- `0007_reconciliation_views.sql`
- `0010_rls_and_auth.sql` (**last**)

### Why numeric prefixes?
- Keeps execution order obvious
- Makes diffs easier to review
- Prevents “random” migration ordering issues

---

## What Belongs in a Migration

### Schema migrations should include
- Table definitions
- Constraints (PK/FK/unique/check)
- Indexes
- Views (`create or replace view`)
- Functions used by triggers
- Triggers (like `updated_at` maintenance)

### Seed scripts should include
- Inserts for dev data (pricing lists)
- Upserts (`insert ... on conflict do update`) so scripts can be re-run

---

## Idempotency Rules (Dev-Friendly)

Use these patterns wherever possible:
- `create table if not exists`
- `create index if not exists`
- `create or replace view`
- `alter table ... add column if not exists`
- `insert ... on conflict do update`

Avoid destructive operations unless clearly intended:
- `drop table`
- `drop column`
- `truncate`

If a destructive change is required, document it at the top of the migration.

---

## Recommended Development Workflow

### Typical change workflow
1. Add/modify schema in a new migration file
2. Update docs:
   - `/docs/05_Database/02_Tables.md` (tables)
   - `/docs/05_Database/03_Views.md` (views)
3. If needed, update seed scripts in `/supabase/seed/`

### Dev reset workflow
Keep lightweight reset helpers in:
`/scripts/dev/`

Examples:
- `reset-db.sql`
- `seed-all.sql`

---

## RLS + Auth (Last Step)

Do not enable RLS during early development. Once Phase 1 and all core event tables/views are stable:
- Create `0010_rls_and_auth.sql`
- Enable RLS table-by-table
- Add policies for:
  - read-only pricing access
  - normal user access to operational tables
  - admin-only inserts/updates for pricing imports (if needed)

---
