# Replant Inventory Audit

**Status:** ✅ Implemented in migration `0037_on_hand_inventory_subtract_replants.sql`.
**Date:** 2026-06-10
**Author:** Engineering

> **Implementation note (0037):** Took the recommended DROP + CREATE chain. `v_on_hand_inventory` now has a `replanted` CTE and a `units_replanted` column (positioned between `units_delivered` and `units_returned`); `units_on_hand` and `available_units` subtract replants. Dependents (`v_on_hand_inventory_wide`, `v_inventory_print_sheet`, `v_agent_inventory`) were recreated and inherit the corrected values. Frontend: `InventoryDetailRow.units_replanted` + a **Replanted** column in the detail table. Agent: `get_on_hand_inventory` now selects `units_replanted`, exposes it as `replanted_units`, and its description/comments use the corrected formula. The print sheet keeps its results-only layout (Physical/Staged/Available) which now include replants. Reconciliation views were left untouched (no double-counting).

## Goal

Determine every view, UI surface, and agent tool that must change so that **replants subtract from on-hand inventory**. Replanted seed physically leaves the warehouse (it is handed to the customer to re-plant a failed field), so it must reduce physical stock — even though the customer is not invoiced for it.

### Target formulas

```
Physical On Hand = Bayer Shipments − Deliveries − Replants + Returns
Available        = Physical On Hand − Staged Deliveries
```

---

## 1. Current inventory formula

The base view `v_on_hand_inventory` (current definition in [`0029_fix_inventory_received_seed_size.sql`](../../supabase/migrations/0029_fix_inventory_received_seed_size.sql)) computes:

```
units_on_hand   = units_received − units_delivered + units_returned
available_units = units_received − units_delivered + units_returned − units_staged
```

It is built from four CTEs: `received` (bayer_shipment_items), `delivered` (deliveries), `returned` (returns), and `staged` (in-progress staged_delivery_items). **There is no `replanted` CTE.**

## 2. Are replants currently included?

**No.** Replants are not referenced anywhere in `v_on_hand_inventory` or any view derived from it. The `replants` table is read by reconciliation/sales views only (`v_year_end_adjustments`, the customer adjustment report views, `v_customer_order_status`), never by physical inventory.

This is the **root cause**: replanted units are physical product that left the warehouse but are silently treated as if still in stock. Physical On Hand and Available are both overstated by the total replanted quantity per (product, treatment, seed_size, package_type).

> Note: The `replants` table already carries the exact grain inventory needs — `product_id`, `treatment_id`, `seed_size`, `package_type`, `units_replanted`, `user_id` — so a `replanted` CTE mirrors the existing `delivered`/`returned` CTEs one-for-one.

## 3. Which views need replants added?

| View | Current source | Change required |
|---|---|---|
| `v_on_hand_inventory` | base view (0029) | **Yes — primary fix.** Add a `replanted` CTE; subtract `units_replanted` in both `units_on_hand` and `available_units`; add a `units_replanted` output column; add replant keys to the `keys` union. |
| `v_on_hand_inventory_wide` | pivots `available_units` from base (0027) | **No structural change.** Pivots `available_units`, which inherits the corrected value automatically. Recreated only if a DROP+CREATE strategy is used for the base view (dependency). |
| `v_inventory_print_sheet` | selects from base (0027) | **No structural change required** to be correct (`units_on_hand`/`available_units` inherit the fix). **Optional:** add a `units_replanted` column for transparency on the printed sheet. |
| `v_agent_inventory` | `select * from v_on_hand_inventory` (0027) | **No code change.** Inherits the new `units_replanted` column and corrected totals automatically. |

All consumer views derive (directly or transitively) from `v_on_hand_inventory`, so the corrected Physical/Available numbers propagate automatically. The only deliberate additions are: (a) the new `units_replanted` column on the base view, and (b) surfacing that column in the UI/print where desired.

### Views that must NOT change (avoid double-counting)

- `v_year_end_adjustments`, `v_customer_adjustment_report_summary`, `v_customer_order_status` — these already net replants into **sales/settlement** math (`net_units = ordered − delivered − replanted + returned`). That is a separate axis (what the customer owes / supplier credit) from **physical stock**. They do not read `v_on_hand_inventory` and need no change.

## 4. Which UI columns need to change?

**On-Hand Inventory — Detail view** ([`InventoryDetailTable.tsx`](../../src/components/inventory/InventoryDetailTable.tsx)):
- Add a **Replanted** column between **Returned** and **Physical On Hand**.
- Add `units_replanted: number` to the `InventoryDetailRow` interface in [`inventory.service.ts`](../../src/services/inventory.service.ts).
- KPI cards on [`on-hand-inventory/page.tsx`](../../src/app/on-hand-inventory/page.tsx) sum `units_on_hand` / `units_staged` / `available_units` — **no formula change**, but the displayed totals will (correctly) drop by the replanted quantity once the base view is fixed.

**On-Hand Inventory — Wide view** ([`InventoryWideTable`](../../src/components/inventory/InventoryWideTable.tsx)):
- **No column change.** The wide view shows per-treatment Available only; it inherits the corrected numbers.

## 5. Does the print sheet need to show replanted units?

**Not required for correctness** — the print sheet shows Physical, Staged, Available, all of which inherit the corrected formula. **Recommended (optional):** add a **Replanted** column to [`InventoryPrintView.tsx`](../../src/components/print/InventoryPrintView.tsx) and `InventoryPrintRow` so the printed sheet is self-explaining (otherwise a lower Physical number has no visible cause on paper). Decision deferred to product; default recommendation is to add it for auditability.

## 6. Do the agent inventory tools need updates?

| File | Reads | Impact |
|---|---|---|
| [`get-on-hand-inventory.ts`](../../src/lib/agent/tools/get-on-hand-inventory.ts) | `units_on_hand`, `units_staged`, `available_units` | **Functionally automatic** — totals correct themselves. **Doc/comment update required:** the tool `description`, the `InventoryRow` comments, and the output-field comments all state `physical_units_on_hand = received − delivered + returned`. Update to `received − delivered − replanted + returned`. Optionally map a new `replanted_units` field into the output. |
| [`draft-delivery-from-chat.ts`](../../src/lib/agent/tools/draft-delivery-from-chat.ts) | `available_units` (over-delivery warning) + `seed_size` options | **No code change.** The availability warning becomes more accurate (replanted stock no longer counted as available). Behavior shift is desirable. |
| [`draft-replant-from-chat.ts`](../../src/lib/agent/tools/draft-replant-from-chat.ts) | `seed_size` options only | **No change.** Does not read availability. |

**SQL fallback ([`validate-approved-query.ts`](../../src/lib/agent/sql/validate-approved-query.ts)):** allow-list is **view-level**, not column-level. `v_agent_inventory` is already approved. Adding a `units_replanted` column needs **no** allow-list change.

## 7. Do dashboard views need updates?

**No dashboard exists** in the codebase (`src/app/dashboard` not present; no inventory-KPI view outside the On-Hand Inventory page). Nothing to change.

## 8. Migration strategy

**Recommended: single migration `0037_on_hand_inventory_subtract_replants.sql`, DROP + CREATE chain** (mirrors the precedent set by [`0027_staged_deliveries.sql`](../../supabase/migrations/0027_staged_deliveries.sql), which dropped and recreated the same view family to insert the `staged` column mid-list).

Why DROP+CREATE rather than CREATE OR REPLACE: Postgres `CREATE OR REPLACE VIEW` can only **append** columns at the end and cannot reorder existing ones. To place `units_replanted` logically between `units_returned` and `units_on_hand`, the base view must be dropped. Dependents (`_wide`, `_inventory_print_sheet`, `_agent_inventory`) depend on it and must be dropped/recreated in the same migration.

Order of operations:
1. `drop view` the three dependents, then `v_on_hand_inventory` (or `drop ... cascade`).
2. Recreate `v_on_hand_inventory` with the `replanted` CTE and corrected formulas.
3. Recreate `v_on_hand_inventory_wide`, `v_inventory_print_sheet`, `v_agent_inventory` verbatim from their 0027 definitions (plus an optional `units_replanted` column on the print sheet).

**Alternative (smaller, if column position is not a concern):** `CREATE OR REPLACE VIEW v_on_hand_inventory` that (a) changes the `units_on_hand`/`available_units` expressions to subtract replants and (b) appends `units_replanted` as the **last** column. Dependents need no recreation because they reference columns by name and don't use `units_replanted`. This avoids the drop chain entirely. Frontend maps columns by name, so trailing position is harmless. Trade-off: column order in the detail view is less tidy.

### Recommended SQL changes (shape, not final)

Add to `v_on_hand_inventory`:

```sql
replanted as (
  select rp.product_id,
         rp.treatment_id,
         rp.seed_size,
         rp.package_type,
         sum(rp.units_replanted)::integer as units_replanted
    from replants rp
   where rp.user_id = auth.uid()
   group by rp.product_id, rp.treatment_id, rp.seed_size, rp.package_type
)
```

- Add `replanted` to the `keys` UNION (so replant-only combinations still appear).
- `left join replanted rp` using `IS NOT DISTINCT FROM` on `seed_size` and `package_type` (consistent with the other CTE joins).
- New column: `coalesce(rpl.units_replanted, 0) as units_replanted`.
- `units_on_hand   = received − delivered − replanted + returned`
- `available_units = received − delivered − replanted + returned − staged`

## Affected files summary

**SQL (new migration):**
- `supabase/migrations/0037_on_hand_inventory_subtract_replants.sql` *(to be created)* — rewrites `v_on_hand_inventory`; recreates `v_on_hand_inventory_wide`, `v_inventory_print_sheet`, `v_agent_inventory` if DROP+CREATE path is taken.

**Frontend:**
- `src/services/inventory.service.ts` — add `units_replanted` to `InventoryDetailRow` (and `InventoryPrintRow` if print column added).
- `src/components/inventory/InventoryDetailTable.tsx` — add **Replanted** column.
- `src/components/print/InventoryPrintView.tsx` — add **Replanted** column *(optional)*.
- `src/app/on-hand-inventory/page.tsx` — no logic change; verify KPI totals read corrected values.

**Agent:**
- `src/lib/agent/tools/get-on-hand-inventory.ts` — update formula comments/description; optionally expose `replanted_units` in output.
- `src/lib/agent/tools/draft-delivery-from-chat.ts` — no change (improved warning accuracy).
- `src/lib/agent/tools/draft-replant-from-chat.ts` — no change.

**Docs to update (state the old formula):**
- `docs/03_Data/04_inventory_views.md` (lines ~12, 22, 66, 146)
- `docs/03_Data/07_business_definitions.md` (line ~145 formula; line ~149 **"Replanted units do not affect on-hand inventory" becomes false** and must be rewritten)
- `docs/03_Data/06_agent_approved_views.md` (line ~61)
- `docs/agent/inventory-tool.md` (lines ~13, 40)

## Validation checklist

- [ ] `v_on_hand_inventory.units_on_hand` = received − delivered − replanted + returned for a known (product, treatment, seed_size, package_type).
- [ ] `available_units` = that value − staged.
- [ ] A product with replants but no deliveries/returns shows Physical reduced by exactly the replanted quantity.
- [ ] A replant-only combination (no received/delivered/returned/staged) still appears as a row (keys UNION includes replanted) with negative Physical.
- [ ] `v_on_hand_inventory_wide` Available per treatment drops by the replanted amount.
- [ ] `v_inventory_print_sheet` Physical/Available reflect the fix; Replanted column (if added) matches the base view.
- [ ] `v_agent_inventory` exposes `units_replanted` and corrected totals via `select *`.
- [ ] Detail-view **Replanted** column renders; KPI "Total Physical On Hand" and "Total Available" drop accordingly.
- [ ] Agent `get_on_hand_inventory` totals match the UI; description no longer claims replants are excluded.
- [ ] `draft-delivery-from-chat` over-delivery warning fires when replants have reduced availability below the requested units.
- [ ] Seed-size is matched NULL-safely (`IS NOT DISTINCT FROM`) — corn AF2 replants reduce the AF2 row, not a null-size row.
- [ ] No regression in reconciliation views (`v_year_end_adjustments`, customer adjustment report) — replants must not be double-subtracted there; confirm those views are untouched.
- [ ] `npm run build` / `tsc --noEmit` clean; agent SQL fallback still accepts `v_agent_inventory` queries.
