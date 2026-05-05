# 08 — Schema Change Guidelines

Rules and procedures for safely modifying the SSIM database schema.

---

## Core Rules

1. **All schema changes must go through a migration file.** Never alter the live database directly without a corresponding migration. Migrations live in `/supabase/migrations/` and are numbered sequentially (e.g., `0023_description.sql`).

2. **Never modify existing migration files.** Once a migration has been applied, it is immutable history. Create a new migration instead.

3. **Migrations must be idempotent where possible.** Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP INDEX IF EXISTS`, `DROP CONSTRAINT IF EXISTS` to avoid failures on re-run or re-apply.

4. **Test migrations against the live schema before applying.** The live schema may have drifted from migration history (columns added directly, views altered outside migrations). Always inspect the current state before writing a new migration.

---

## View Change Rules

### The CREATE OR REPLACE VIEW Rule

PostgreSQL's `CREATE OR REPLACE VIEW` has strict limitations:

- You **can** add new columns to the end of the column list.
- You **cannot** remove columns, rename columns, change column types, or reorder existing columns.
- Attempting any of the above raises: `ERROR: 42P16: cannot drop columns from view`

**This error occurs even when you think you're not removing columns.** Any existing column that shifts position (due to an insertion before it) triggers the same error.

**Rule:** If you need to change anything other than adding new columns at the end, use `DROP VIEW` + `CREATE VIEW`.

---

### Dropping and Recreating Views with Dependents

Many views in this codebase have dependencies (views that read from other views). You must drop dependents before dropping the base view.

**Dependency chains to be aware of:**

```
v_on_hand_inventory
  ↳ v_on_hand_inventory_wide
  ↳ v_inventory_print_sheet
```

**Drop order (reverse dependency):**
1. `DROP VIEW IF EXISTS public.v_inventory_print_sheet`
2. `DROP VIEW IF EXISTS public.v_on_hand_inventory_wide`
3. `DROP VIEW IF EXISTS public.v_on_hand_inventory`

**Recreate order (forward dependency):**
1. `CREATE VIEW public.v_on_hand_inventory AS ...`
2. `CREATE VIEW public.v_on_hand_inventory_wide AS ...`
3. `CREATE VIEW public.v_inventory_print_sheet AS ...`

Always check for dependent views in the database before dropping: run `\d+ <view_name>` in psql or query `information_schema.view_table_usage`.

---

### Specific Warning: Column Position Changes

> **WARNING:** PostgreSQL does not allow dropping columns from a view with `CREATE OR REPLACE VIEW`. If a view's existing columns are removed, renamed, reordered, or shifted (by inserting a new column before an existing one), the `CREATE OR REPLACE` will fail with `42P16`. Any views that depend on the affected view must also be dropped and recreated in correct dependency order.

This has happened in SSIM development (see migration 0022 comments). When the live database had a `crop` column at position 8 in `v_bayer_shipments` (added directly outside migrations), `CREATE OR REPLACE VIEW` failed because our migration put different columns at that position. The solution was always `DROP VIEW + CREATE VIEW`.

---

## Column and Table Change Rules

### Adding a column

Safe operation. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Existing views and queries are unaffected.

```sql
alter table public.my_table
  add column if not exists my_new_column text null;
```

### Removing a column

**Dangerous.** First verify no view, service, or frontend component queries this column. Update all affected views before running the `DROP COLUMN`. Views that reference a dropped column will error at query time (not at migration time).

### Renaming a column

**Dangerous.** Same precautions as removing a column. Update all view definitions and service layer code before applying.

### Changing a column type

**Dangerous.** Requires verifying all consumers can handle the new type. May silently cast or fail at query time. Test in a branch or staging environment first.

---

## Constraint and Index Rules

### Adding a unique constraint on a table with existing data

Always verify no existing rows would violate the new constraint before adding it. Run a duplicate-check query first:

```sql
SELECT product_id, treatment_id, COUNT(*)
FROM my_table
GROUP BY product_id, treatment_id
HAVING COUNT(*) > 1;
```

### NULLS NOT DISTINCT

When a unique constraint involves nullable columns and you need NULLs to compare as equal (e.g., for upsert conflict detection), use `UNIQUE NULLS NOT DISTINCT`. This requires PostgreSQL 15+, which Supabase supports.

Example from `bayer_year_end_verifications`:
```sql
unique nulls not distinct (user_id, season_year, product_id, treatment_id, seed_size, package_type)
```

Without `NULLS NOT DISTINCT`, two rows with `seed_size = NULL` would not conflict (NULLs are not equal in standard SQL), breaking upsert logic.

---

## Security Rules

### Preserve RLS on all user-scoped tables

Every table with a `user_id` column must have Row Level Security enabled with four policies: SELECT, INSERT, UPDATE, DELETE — all filtered by `user_id = auth.uid()`.

When adding a new user-scoped table:

```sql
alter table public.my_new_table enable row level security;

create policy "Users can read own my_new_table"
  on public.my_new_table for select to authenticated
  using (user_id = auth.uid());

create policy "Users can insert own my_new_table"
  on public.my_new_table for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users can update own my_new_table"
  on public.my_new_table for update to authenticated
  using (user_id = auth.uid());

create policy "Users can delete own my_new_table"
  on public.my_new_table for delete to authenticated
  using (user_id = auth.uid());

alter table public.my_new_table
  alter column user_id set default auth.uid();
```

### Add explicit auth.uid() filters to user-scoped views

Views are often owned by the postgres superuser and bypass table-level RLS. Every user-scoped view must include `WHERE user_id = auth.uid()` (or equivalent CTE filter) in its SQL definition, not just rely on table RLS. See migration 0014 comments for explanation.

### Do not expose the service role key

The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. Only use the server client (service role) in server-side Next.js code (API routes, server actions). Never use it in browser/client code.

---

## Keeping Views Aligned with the Frontend

Before changing any view:

1. **Search the service layer** (`/src/services/`) for all references to the view name.
2. **Check the TypeScript interfaces** (e.g., `DeliveryViewRow`, `CustomerOrderStatusRow`) that map to the view columns.
3. **Verify the UI pages** that call those service functions still work after the column change.
4. **Run `npx tsc --noEmit`** after any column name changes in views to catch TypeScript interface mismatches.

Common risky patterns:
- Renaming a view column → breaks the TypeScript interface silently (runtime error, not compile time, if using string selectors)
- Adding a new NOT NULL column to a view's underlying table without a default → may break inserts from the service layer

---

## After Applying a Migration

1. Update documentation in `/docs/03_Data/` to reflect the schema change.
2. Update the affected TypeScript service interfaces if column names changed.
3. Test every UI page that reads from the affected view or table.
4. Run `npx tsc --noEmit` to confirm no type errors.
5. If the migration modifies a view used by the agent, update `/docs/03_Data/06_agent_approved_views.md`.

---

## Migration File Naming

Format: `NNNN_short_description.sql`

- `NNNN` is a zero-padded 4-digit sequence number, one higher than the previous migration.
- `short_description` uses underscores, lowercase, no special characters.
- Keep descriptions informative: `0023_add_notes_to_bayer_items.sql` is better than `0023_update.sql`.
- Include a comment block at the top of each migration explaining what it changes and why.
