# Seed Size Validation Audit

**Date:** 2026-05-15  
**Scope:** All forms and save paths where corn products can currently be saved without `seed_size`.  
**Status:** Frontend validation implemented (Task 7). Database trigger enforcement implemented (Task 8 — migration `0032_seed_size_required_for_corn.sql`).

---

## Business Rule

Corn products (`products.crop = 'corn'`) require a `seed_size` value (AR, AR2, AF, AF2, P26).  
Soybean products and packaging products do not use `seed_size` — it must be `null` for them.

---

## Summary of Gaps

| Form / Path | Table Written | Frontend enforced? | DB enforced? |
|---|---|---|---|
| Orders page | `order_items` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Deliveries page (new) | `deliveries` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Deliveries page (edit) | `deliveries` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Returns page | `returns` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Returns page (edit) | `returns` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Replants page | `replants` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Replants page (edit) | `replants` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Bayer Shipments page | `bayer_shipment_items` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Bayer Shipments page (edit) | `bayer_shipment_items` | ✅ Yes (Task 7) | ✅ Yes (trigger, 0032) |
| Staged Deliveries page | `staged_delivery_items` | ⚠️ Partial (item table) | ✅ Yes (trigger, 0032) |
| Agent: save_confirmed_delivery | `deliveries` | ❌ No frontend check | ✅ Yes (trigger, 0032) |
| Agent: save_confirmed_return | `returns` | ❌ No frontend check | ✅ Yes (trigger, 0032) |
| Agent: save_confirmed_replant | `replants` | ❌ No frontend check | ✅ Yes (trigger, 0032) |
| Agent: convert_confirmed_staged_delivery | `deliveries` | ❌ No frontend check | ✅ Yes (trigger, 0032) |
| Database (all tables) | — | — | ✅ `validate_required_seed_size_for_corn()` trigger |

---

## Form-by-Form Findings

### 1. Orders Page (`src/app/orders/page.tsx`)

**`validLines` filter (button-enable check):**
```ts
items.filter((it) => it.productId && it.treatmentId && it.units > 0)
```
No `seedSize` check — Save Order button enables even for corn rows with blank seed size.

**`validateForm()` (on-save validation):**
Per-row checks: `productId`, `treatmentId`, `units`. No `seedSize` check.

**Insert payload (`src/services/order.service.ts`):**
```ts
seed_size: it.seedSize || null   // null if user left it blank
```

**UI component (`src/components/orders/OrderItemsTable.tsx`):**
- Size dropdown renders for corn rows (detected via `cropByProduct.get(item.productId) === 'corn'`).
- First option is `<option value="">—</option>` — user can leave it blank.
- No visual error state for missing seed_size on corn rows.
- No save-block.

**DB column (`order_items`):** `seed_size text null` — no CHECK constraint.

---

### 2. Deliveries Page (`src/app/deliveries/page.tsx`)

**`validLines` filter:**
```ts
items.filter((it) => it.productId && it.treatmentId && it.units > 0)
```

**`validateForm()`:**
Per-row: `productId`, `treatmentId`, `units > 0 && isInteger`. No `seedSize` check.

**Insert payload:**
```ts
seed_size: row.seedSize || null
```

**Edit path (`handleUpdateDelivery`):**
Passes `seed_size: string | null` from the in-place edit row; no validation in the update handler.

**UI component (`src/components/deliveries/DeliveryItemsTable.tsx`):**
- Size dropdown shown for corn (both desktop table and mobile card layout).
- Default option `<option value="">—</option>` — submittable blank.
- No error state or save-block for missing seed_size.

**DB column (`deliveries`):** `seed_size text null` — no constraint.

---

### 3. Returns Page (`src/app/returns/page.tsx`)

The Returns page saves to the `returns` table via `src/services/replant.service.ts` (`createReplants`, `updateReplant`).

**`validLines` / `validateForm()`:** Same pattern as Deliveries — checks `productId`, `treatmentId`, `units > 0 && isInteger`. No `seedSize`.

**Insert payload:**
```ts
seed_size: row.seedSize || null
```

**Edit path:** `handleUpdateReplant` passes `seed_size: string | null`; no validation.

**UI component (`src/components/returns/ReturnItemsTable.tsx`):**
- Identical pattern to `DeliveryItemsTable` — size dropdown for corn, blank default, no enforcement.

**DB column (`returns`):** `seed_size text null` — no constraint.

---

### 4. Replants Page (`src/app/replants/page.tsx`)

The Replants page saves to the `replants` table via `src/services/replants.service.ts` (`createReplantEntries`, `updateReplantEntry`).

**`validLines` / `validateForm()`:** Checks `productId`, `treatmentId`, `units > 0 && isInteger`. No `seedSize`.

**Insert payload:**
```ts
seed_size: row.seedSize || null
```

**Edit path:** `handleUpdateReplant` passes `seed_size: string | null`; no validation.

**UI component (`src/components/replants/ReplantItemsTable.tsx`):**
- Same pattern — size dropdown for corn (via `cropByProduct`), blank default, no enforcement.
- Does NOT accept `packagingProducts` prop — corn detection only from `pricingOptions`.

**DB column (`replants`):** `seed_size text null` — no constraint.

---

### 5. Bayer Shipments Page (`src/app/bayer-shipments/page.tsx`)

**`validLines` / `canSave`:** Only checks `productId`, `treatmentId`, `units !== 0`.

**`validateForm()`:** Has corn-aware **duplicate detection** (includes `seedSize` in the lineKey for corn rows), but does NOT validate that `seedSize` is non-empty for corn. A single corn row with blank seed size passes validation.

**Insert payload:**
```ts
seed_size: isCorn ? (row.seedSize || null) : null
```
Correctly nulls out for non-corn, but allows `null` for corn.

**Edit path (`handleEdit` → save):** Reloads shipment into form; same validation path on re-save.

**UI component (`src/components/bayer-shipments/ShipmentItemsTable.tsx`):**
- Size dropdown shown for corn, blank default `—`, no enforcement.
- Corn detection via `cropByProduct.get(item.productId) === 'corn'`.

**DB column (`bayer_shipment_items`):** `seed_size text null`. Unique index includes `COALESCE(seed_size, '')` (from migration `0022_package_type_aware_inventory.sql`) — this prevents exact-duplicate rows but does not require a non-null value.

---

### 6. Agent Tools

**`save_confirmed_delivery` (`src/lib/agent/tools/save-confirmed-delivery.ts`):**
Inherits the same `findOrderLineMatches` and insert logic as the Deliveries page. `seed_size: string | null` in the payload — no corn-specific enforcement.

**`save_confirmed_return` (`src/lib/agent/tools/save-confirmed-return.ts`):**
Same pattern — `seed_size` passed from the agent draft, no validation.

**`save_confirmed_replant` (`src/lib/agent/tools/save-confirmed-replant.ts`):**
Same pattern.

**`convert_confirmed_staged_delivery` (`src/lib/agent/tools/convert-confirmed-staged-delivery.ts`):**
Reads `seed_size` from `v_staged_deliveries` and passes it through to `deliveries`. If the staged delivery item had a null seed_size for a corn product, the resulting delivery row will also have null. There is no re-validation of seed_size during conversion.

---

## Database Schema

As of migration `0032_seed_size_required_for_corn.sql`, a BEFORE INSERT OR UPDATE trigger enforces `seed_size IS NOT NULL` (and non-empty/non-whitespace) for corn products on all six affected tables. The `seed_size` columns remain `text null` at the DDL level — enforcement is via the trigger function `validate_required_seed_size_for_corn()`.

| Table | Column | Type | Constraint |
|---|---|---|---|
| `order_items` | `seed_size` | `text` | `null` — enforced by trigger `trg_order_items_seed_size_corn` |
| `deliveries` | `seed_size` | `text` | `null` — enforced by trigger `trg_deliveries_seed_size_corn` |
| `returns` | `seed_size` | `text` | `null` — enforced by trigger `trg_returns_seed_size_corn` |
| `replants` | `seed_size` | `text` | `null` — enforced by trigger `trg_replants_seed_size_corn` |
| `bayer_shipment_items` | `seed_size` | `text` | `null` — unique index uses `COALESCE(seed_size,'')` + enforced by trigger `trg_bayer_shipment_items_seed_size_corn` |
| `staged_delivery_items` | `seed_size` | `text` | `null` — enforced by trigger `trg_staged_delivery_items_seed_size_corn` |

---

## Existing Infrastructure (Can Reuse)

- **Corn detection at the component level** works correctly in all five item-table components via `cropByProduct.get(productId) === 'corn'`. This map is built from `pricingOptions` which include the `crop` field from `products`.
- **Bayer Shipments** already uses `isCorn` in the save handler to null out `seed_size` for non-corn rows — a correct pattern to extend.
- **Bayer Shipments** already uses `isCorn` in `validateForm` for duplicate detection — demonstrates the approach for adding a seed_size validation branch.
- **`RowErrors` interface** in every item table component includes `product?`, `treatment?`, `units?`. A `seedSize?` field could be added to surface per-row seed_size errors using the existing error display mechanism.

---

## Recommended Frontend Validation Approach

Add a `seedSize?` boolean to `RowErrors` in each item table's interface, then:

1. In `validateForm()` on each page, after the existing per-row checks, add:
   ```ts
   const isCorn = cropByProduct.get(row.productId) === 'corn';
   if (isCorn && !row.seedSize) {
     rowErr.seedSize = true;
     ok = false;
   }
   ```
2. In each item table component, show an error state on the size `<select>` when `errors.seedSize` is true (same pattern as `errors.product` / `errors.treatment`).
3. No changes needed to the `cropByProduct` map — it already exists in every component.

For the `validLines` / `canSave` button-enable check: the current fast check (`productId && treatmentId && units > 0`) intentionally stays loose. Full validation happens in `validateForm()`. Do not change the button-enable logic — the error display on attempted save is sufficient.

---

## Recommended Backend / Database Validation Approach

A PostgreSQL `CHECK` constraint cannot reference another table, so a simple check is insufficient. Options:

**Implemented (migration `0032`):** `validate_required_seed_size_for_corn()` — a BEFORE INSERT OR UPDATE trigger function that joins `products` and raises `check_violation` when `lower(crop) = 'corn' AND trim(coalesce(seed_size, '')) = ''`. Applied to all six affected tables. Existing rows are not retroactively checked (triggers fire on future writes only). A diagnostic query is included in the migration as a comment for manually identifying existing bad rows.

**Option B: Leave enforcement at the frontend only** — not chosen. Agent tools, direct Supabase API calls, and future code paths would bypass frontend validation.

---

## Inventory Impact of Missing Seed Size

`v_on_hand_inventory` groups by `(product_id, treatment_id, seed_size, package_type)`. A delivery recorded with `seed_size = null` appears as a separate inventory row from the same product with `seed_size = 'AR'`. This means:

- Received units (AR) are not offset by delivered units (null) — the AR row looks over-received.
- The null row shows a delivered count with no received inventory.
- Order matching (`serverFindOrderLineMatches` / `findOrderLineMatches`) joins on `seed_size` with NULL-safe comparison — a delivery with null seed_size will match order items that also have null seed_size, which may not be the intended match.

---

## Implementation Risks

| Risk | Severity | Notes |
|---|---|---|
| Existing data: rows already saved with null seed_size for corn | Medium | A backfill strategy would be needed if adding a DB NOT NULL constraint retroactively. Frontend-only enforcement avoids this. |
| Edit flow on list pages | Medium | The edit dialog for deliveries, returns, replants, and shipments loads existing rows. If a row has null seed_size (from old data), the edit form must surface the gap without blocking the save of other fields. |
| Agent draft ↔ save round-trip | Low | Agent tools (`save_confirmed_delivery`, etc.) accept `seedSize` in the draft object passed from the chat. If the agent produces a draft without seed_size for corn, the save tool will insert null. Agent system prompt updates would also be needed. |
| `staged_delivery_items.seed_size` | Low | If a staged delivery item was saved with null seed_size (the staged delivery forms have the same gap), then conversion via `convert_confirmed_staged_delivery` will propagate null to `deliveries`. |

---

## Testing Checklist

- [ ] Orders: Save an order with a corn product and blank seed size — expect validation error.
- [ ] Orders: Save an order with a soybean product — seed_size must be null (no error).
- [ ] Orders: Save an order with a corn product and a valid seed size — expect success.
- [ ] Deliveries (new): Same three cases as Orders.
- [ ] Deliveries (edit): Edit an existing delivery, change product to corn, leave size blank — expect error on save.
- [ ] Returns: Same three cases.
- [ ] Returns (edit): Same edit-path test.
- [ ] Replants: Same three cases.
- [ ] Replants (edit): Same edit-path test.
- [ ] Bayer Shipments: Save a shipment with a corn item and blank size — expect error.
- [ ] Bayer Shipments: Duplicate detection still works for corn rows that DO have seed_size.
- [ ] Bayer Shipments: Non-corn rows are not affected (no size dropdown, passes validation).
- [ ] Mobile card layout: Verify error state displays on the size field card for each form.
- [ ] Inventory: After adding seed-size-enforced delivery, verify `v_on_hand_inventory` row groups correctly.
