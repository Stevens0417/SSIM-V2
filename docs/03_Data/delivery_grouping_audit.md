# Delivery Grouping Audit

**Status:** Audit complete — fix implemented (migrations 0033, application updated)  
**Date:** 2026-05-18  
**Scope:** How saved deliveries are stored, displayed, edited, and printed

---

## 1. Current Storage Model

Deliveries are stored as individual flat rows in the `deliveries` table. There is **no header table** and **no `delivery_group_id` column**.

When a user submits a multi-line delivery form, `createDeliveries()` (`src/services/delivery.service.ts:21`) does a single atomic `INSERT` of all rows:

```ts
await supabase.from("deliveries").insert(rows).select("id");
```

Because this is one INSERT statement, all rows in the batch share an **identical `created_at` timestamp** (PostgreSQL sets it once for the whole statement). This timestamp is the only implicit grouping key.

The allocation logic in `src/app/deliveries/page.tsx:289–348` can split one user-entered line into **multiple DB rows** (one per matching order allocation, plus an optional unlinked remainder). So a form with N user lines may produce M ≥ N database rows, all sharing the same `created_at`.

### Implicit grouping key

A "delivery form" (what the user thinks of as one submission) is identified by the combination:

```
(customer_id, delivery_date, season_year, notes, created_at)
```

This is exact when rows come from the same `INSERT` statement. It can theoretically collide if two saves for the same customer/date/season/notes happen within the same clock tick — this is unlikely but not impossible.

---

## 2. Display (`ThisSeasonDeliveriesTable`)

`src/components/deliveries/ThisSeasonDeliveriesTable.tsx` reads from `v_deliveries_this_season` and renders **one table row per database row**. A multi-line delivery appears as multiple separate rows in the table.

Each row shows: ID (first 8 chars of UUID), date, customer, product, treatment, size, pkg, units, notes, and Actions (Edit / Print / Delete).

The table is flat — there is no row grouping, no expandable group header, and no indicator that multiple rows belong to the same delivery submission.

---

## 3. Current Edit Behavior — Bug

`startEdit(row)` at `src/components/deliveries/ThisSeasonDeliveriesTable.tsx:112` loads **only the clicked row's fields** into the edit modal:

```ts
setEditingId(row.delivery_id);
setEditForm({
  delivery_date: row.delivery_date,
  customer_id: row.customer_id,
  product_id: row.product_id,
  treatment_id: row.treatment_id,
  units_delivered: row.units_delivered,
  seed_size: row.seed_size ?? "",
  package_type: row.package_type ?? "bag",
  notes: row.notes ?? "",
});
```

`saveEdit()` at line 133 calls `onUpdate(editingId, {...})` which resolves to `updateDelivery(deliveryId, updates)` in `src/services/delivery.service.ts:99` — a single-row `UPDATE` by `id`. The other rows in the same delivery batch are never touched.

**Result:** Editing a row from a 3-line delivery opens a single-product modal, and saving only updates that one DB row. The other two DB rows are unaffected and still displayed separately.

---

## 4. Current Print Behavior — Bug

`handlePrintRow(row)` at `src/components/deliveries/ThisSeasonDeliveriesTable.tsx:184` builds a **single-item array** and writes it to sessionStorage:

```ts
const printItems: DeliveryPrintItem[] = [
  {
    product: row.product_name,
    treatment: row.treatment_name,
    units: row.units_delivered,
  },
];
sessionStorage.setItem("ssim-delivery-print-data", JSON.stringify(printData));
window.open("/deliveries/print", "_blank");
```

This opens `src/app/deliveries/print/page.tsx` (the sessionStorage-based print route), which renders whatever was stored — always exactly one line item.

**Result:** Printing a row from a 3-line delivery produces a print slip with one product line, not three.

---

## 5. The Correct Print Route Already Exists

`src/app/deliveries/print/[id]/page.tsx` already implements correct group-aware printing:

1. Fetches the anchor row by `delivery_id` to get `(customer_id, delivery_date, season_year, notes, created_at)`.
2. Queries all sibling rows matching those five fields from `v_deliveries_this_season`.
3. Aggregates units by `(product_name, treatment_name, seed_size)` to collapse allocation-split rows into one print line.
4. Fetches full customer contact info directly from the `customers` table.
5. Renders `DeliveryPrintView` and triggers `window.print()` automatically.

This route is used by the agent tool (`src/lib/agent/tools/convert-confirmed-staged-delivery.ts`) but **not** by the list table's Print button. The fix for print is a one-line change.

---

## 6. Root Cause Summary

| Issue | Root Cause |
|---|---|
| Print shows only one line | `handlePrintRow` uses sessionStorage + `/deliveries/print` instead of `/deliveries/print/[id]` |
| Edit shows only one line | `startEdit` loads a single `DeliveryViewRow`; no sibling fetch; modal has no multi-row item table |
| No grouping indicator in list | Table renders flat rows with no group header or visual clustering |

---

## 7. Recommended Fix

### 7a. Print fix (trivial — one line change)

Replace the sessionStorage approach in `handlePrintRow` with navigation to the existing grouped route:

```ts
const handlePrintRow = (row: DeliveryViewRow) => {
  window.open(`/deliveries/print/${row.delivery_id}`, "_blank");
};
```

No migration needed. No new API calls needed.

### 7b. Edit fix (moderate — modal redesign)

The edit modal must load all sibling rows and present a multi-row item table. Required changes:

1. **Service layer** — add `fetchDeliveryGroup(deliveryId)` that replicates the sibling query from the `[id]` print route and returns all rows in the group.
2. **State** — replace the single-row `editForm` with a multi-row structure: shared header fields (customer, date, notes) + an array of item rows (product, treatment, units, seed_size, package_type).
3. **Save logic** — since rows may have been split by allocation logic, the safest approach is to update each row individually by its own `delivery_id`. Header fields (customer_id, delivery_date, notes) are updated on all rows in the group.
4. **Modal UI** — replace the single-product dropdowns with an `ItemsTable`-style component (similar to `DeliveryItemsTable`) for multi-row editing.

### 7c. Migration (implemented as 0033)

Migration `0033_delivery_headers.sql` introduced:
- `delivery_headers` table — one row per form submission, with RLS and indexes.
- `deliveries.delivery_header_id` — nullable FK, `NULL` for all pre-0033 rows.
- Rebuilt `v_deliveries_this_season` — now includes `seed_size`, `package_type` (restoring columns that were in the live DB but missing from the migration-tracked definition), and `delivery_header_id`.
- New `v_delivery_headers_this_season` view — one row per header with item count and total units.

**Backward compatibility:** Pre-0033 rows remain with `delivery_header_id = NULL`. The `fetchDeliveryGroup` function and the print route both fall back to `created_at` grouping when `delivery_header_id` is null.

---

## 8. Affected Files

| File | Change | Status |
|---|---|---|
| `supabase/migrations/0033_delivery_headers.sql` | New migration — header table, FK, indexes, RLS, views | ✅ Done |
| `src/services/delivery.service.ts` | Added `createDeliveryWithHeader`, updated `fetchDeliveryGroup` + `applyDeliveryGroupEdits`, added `DeliveryGroup.header_id`, `GroupEditPayload.header_id` | ✅ Done |
| `src/app/deliveries/page.tsx` | Uses `createDeliveryWithHeader` instead of `createDeliveries` | ✅ Done |
| `src/app/deliveries/print/[id]/page.tsx` | Groups siblings by `delivery_header_id` when present; falls back to `created_at` | ✅ Done |
| `src/components/deliveries/ThisSeasonDeliveriesTable.tsx` | `handlePrintRow` uses `/deliveries/print/[id]`; edit modal is group-aware; `editHeaderId` tracked in state | ✅ Done |
| `src/lib/agent/tools/save-confirmed-delivery.ts` | Creates `delivery_headers` row before inserting delivery rows | ✅ Done |
| `src/lib/agent/tools/convert-confirmed-staged-delivery.ts` | Creates `delivery_headers` row before inserting delivery rows | ✅ Done |
| `src/app/deliveries/print/page.tsx` | No change — still used by the "New Delivery" form print button | — |

---

## 9. Test Checklist

**Print fix:**
- [ ] Click Print on a row from a single-line delivery → print slip shows 1 product line
- [ ] Click Print on a row from a 3-line delivery → print slip shows all 3 product lines
- [ ] Click Print on any row from a delivery that was split across order allocations → print slip shows the user's original quantities (aggregated), not the split DB rows
- [ ] Print from the "New Delivery" form (before saving) still works via sessionStorage route
- [ ] Print button in the edit modal opens the correct grouped print slip

**Edit fix:**
- [ ] Click Edit on a row from a single-line delivery → modal shows 1 item row
- [ ] Click Edit on a row from a 3-line delivery → modal shows all 3 item rows
- [ ] Changing the customer or date in the edit modal applies to all rows in the group
- [ ] Changing units on one row does not affect other rows
- [ ] Saving a group edit refreshes the list correctly
- [ ] Corn rows retain seed_size after edit save
- [ ] Validation blocks save if any row is missing required fields (product, treatment, units > 0, seed_size for corn)
- [ ] Delete still operates on individual rows (no change to delete behavior)
