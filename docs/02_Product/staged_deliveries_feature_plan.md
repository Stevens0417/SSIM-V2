# Staged Deliveries — Feature Plan

> **Status: Implemented** (migrations 0026–0027, Tasks 6–9). Sections below reflect the original design intent. Where the actual implementation diverged from the plan, corrections are noted inline in **[ACTUAL: …]** callouts.

## Business Purpose

The On-Hand Inventory page computes units on hand as:

```
units_on_hand = received - delivered + returned
```

This formula does not account for product that has been **physically set aside for a customer** but not yet entered as a delivered order. When a salesperson stages 20 units for a customer pickup, the system still shows those 20 units as available — potentially causing double-sell or over-commitment errors.

**Staged Deliveries** solve this by introducing a pre-delivery holding state. Product is reserved the moment it is staged. The inventory page will show both the physical stock and the net available stock after staged commitments are subtracted.

---

## Terminology

| Term | Definition |
|---|---|
| **Staged Delivery** | A prepared delivery that has been physically set aside for a customer but not yet recorded as an actual delivery. |
| **Physical On Hand** | `received - delivered + returned` — the existing formula, unchanged. |
| **Staged / Reserved Units** | Units currently held in staged deliveries that have not yet been converted to actual deliveries. |
| **Available Units** | `physical_on_hand - staged_units` — the operationally meaningful quantity; what can still be sold or staged for another customer. |

Use **"Staged Deliveries"** in all UI labels and documentation. Do not use "Premade Orders."

---

## Data Model Plan

### New table: `staged_deliveries` (header)

Represents one staged delivery event — one customer, one delivery date, one set of line items.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | FK → `auth.users`, RLS-enforced, default `auth.uid()` |
| `customer_id` | uuid NOT NULL | FK → `customers` |
| `season_year` | int NOT NULL | Season year at time of staging |
| `staged_date` | date NOT NULL | Date product was physically set aside (**[ACTUAL: column is `staged_date`, not `delivery_date`]**) |
| `notes` | text NULL | Optional notes |
| `status` | text NOT NULL | `'in_progress'`, `'converted'`, or `'cancelled'` (**[ACTUAL: `status` enum replaces planned `is_converted boolean`]**) |
| `converted_at` | timestamptz NULL | Timestamp of conversion |
| `created_at` | timestamptz NOT NULL DEFAULT now() |  |
| `updated_at` | timestamptz NOT NULL DEFAULT now() |  |

**Design rationale:** Header + items model (mirroring orders → order_items) because:
- A staged delivery is one conceptual transaction for one customer
- The list view needs one row per staged delivery, not one row per item
- Conversion creates multiple delivery rows via the existing auto-allocation engine

**[ACTUAL: Status enum instead of boolean]** Converted/cancelled staged deliveries use `status = 'converted'` or `status = 'cancelled'` rather than a boolean `is_converted`. The inventory view filters `WHERE status = 'in_progress'` for reservation calculations.

---

### New table: `staged_delivery_items` (line items)

One row per product+treatment+seed_size+package_type within a staged delivery.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `staged_delivery_id` | uuid NOT NULL | FK → `staged_deliveries(id)` ON DELETE CASCADE |
| `user_id` | uuid NOT NULL | FK → `auth.users`, RLS-enforced, default `auth.uid()` |
| `product_id` | uuid NOT NULL | FK → `products` |
| `treatment_id` | uuid NOT NULL | FK → `treatments` |
| `seed_size` | text NULL | Corn only |
| `package_type` | text NOT NULL DEFAULT 'bag' | 'bag' or 'tote' |
| `units_staged` | integer NOT NULL CHECK (units_staged > 0) |  |
| `created_at` | timestamptz NOT NULL DEFAULT now() |  |

**Grain:** Same as `deliveries` — one row per product+treatment+seed_size+package_type combination. This matches the inventory view grain so staged units can be subtracted directly.

---

### New view: `v_staged_deliveries`

**[ACTUAL: Grain changed — per item, not per header]** The implemented view is a flat per-item view (not the aggregated per-header design in this plan). `v_staged_delivery_items` was not created as a separate view; instead `v_staged_deliveries` serves both roles.

**Actual grain:** One row per `staged_delivery_item`.

**Key columns:** `staged_delivery_id`, `staged_delivery_item_id`, `customer_id`, `customer_name`, `farm_name`, `season_year`, `staged_date`, `notes`, `status`, `converted_at`, `product_id`, `product_name`, `treatment_id`, `treatment_name`, `seed_size`, `package_type`, `units_staged`

**Filter:** `WHERE sd.user_id = auth.uid()` — shows all statuses; filter by `status` in queries.

**`v_agent_staged_deliveries`** wraps this view with `WHERE status = 'in_progress'` for the SQL fallback tool.

---

### Updated view: `v_on_hand_inventory`

The existing view gains three new computed columns. The `keys` CTE must also union staged delivery items to ensure combinations that only appear in staged deliveries show up.

**New columns:**

| Column | Formula |
|---|---|
| `units_staged` | `SUM(sdi.units_staged)` grouped by product+treatment+seed_size+package_type where `status = 'in_progress'` (**[ACTUAL: column name is `units_staged`, not `staged_units`]**) |
| `available_units` | `units_on_hand - units_staged` |

**Updated formula summary:**

```
physical_on_hand  = received - delivered + returned   (unchanged)
units_staged      = sum of staged_delivery_items where parent status = 'in_progress'
available_units   = physical_on_hand - units_staged
```

**Migration note:** This view has **three** dependent views (`v_on_hand_inventory_wide`, `v_inventory_print_sheet`, and `v_agent_inventory`) that must be dropped before this view is dropped and recreated. Drop order: `v_agent_inventory` → `v_inventory_print_sheet` → `v_on_hand_inventory_wide` → `v_on_hand_inventory`. Recreate in reverse.

---

### Updated view: `v_on_hand_inventory_wide`

The wide view currently pivots `units_on_hand` per treatment column. After the update, pivot `available_units` instead so the wide view shows operationally meaningful quantities.

**Design decision:** Show `available_units` (not `physical_on_hand`) in the wide view because the wide view is the primary at-a-glance summary — available is the number that matters operationally.

---

## UI Plan

### New page: Staged Deliveries (`src/app/staged-deliveries/page.tsx`)

**Two view toggle** (matching the Deliveries page pattern):

**View 1 — New Staged Delivery:**
- Header band: DEKALB logo, "Staged Delivery Form", Stevens Seeds — {season}
- Customer selector (`SearchableSelect` — reused)
- Delivery Date field (date input — reused)
- Season badge (read-only — reused)
- Delivery Items table (`DeliveryItemsTable` — **fully reused**, same `DeliveryItem` interface)
- Notes textarea
- Customer Order Status sub-table (`CustomerOrderStatusTable` — **fully reused**)
- Action buttons: **Save Staged Delivery**, New Staged Delivery, **Print Staged Delivery**
- Mobile sticky action bar (same pattern)

**View 2 — Staged Deliveries (list):**
- New `StagedDeliveriesTable` component showing pending staged deliveries
- Columns: Date, Customer, Products (summary), Total Units, Notes, Actions
- Per-row actions: **Print**, **Convert to Delivery**, **Delete**
- No edit-in-place (delete and re-create is simpler and safer)

**Navigation:** Add "Staged Deliveries" to the app sidebar/navigation alongside Deliveries.

---

### On-Hand Inventory page changes

**Detail View (`InventoryDetailTable`):**
- Add two new columns after "Units On Hand":
  - **Staged Units** — `staged_units` from view (0 if no staged deliveries for that row)
  - **Available Units** — `available_units` from view, highlighted red if negative

**Wide View (`InventoryWideTable`):**
- Treatment columns now show `available_units` (not `units_on_hand`)
- Update column header tooltip or sub-label to clarify: "Available (after staged)"

**KPI cards:**
- "Total Units On Hand" → rename to **"Total Available Units"** (`SUM(available_units)` across positive rows)
- Add new KPI: **"Staged / Reserved"** showing total staged units across all products
- Keep: "Negative On-Hand" (based on `available_units < 0`)

**Header sub-line** (currently reads "Shipments − Deliveries + Returns"):
- Update to: "Shipments − Deliveries + Returns − Staged"

---

## Conversion Workflow

When user clicks **"Convert to Delivery"** on a staged delivery in the list view:

1. **Load** the staged delivery header + all items from `staged_delivery_items`.
2. **Confirm** — show a confirmation dialog: "Convert [N] units for [Customer] to an actual delivery? This cannot be undone."
3. **Auto-allocate** — call `findOrderLineMatches()` (existing service, unchanged) with the staged items to resolve `order_id` / `order_item_id` links.
4. **Create delivery rows** — call `createDeliveries()` (existing service, unchanged) exactly as the regular delivery save does.
5. **Mark converted** — `UPDATE staged_deliveries SET status='converted', converted_at=now() WHERE id={id} AND status='in_progress'` (**[ACTUAL: `status` column, not `is_converted`; extra `AND status='in_progress'` guard prevents double-conversion]**).
6. **Refresh** — reload the staged deliveries list; the converted record disappears from `v_agent_staged_deliveries` (filtered to `status='in_progress'`).
7. **Notify** — success banner: "Converted to delivery (N rows created)."

**Atomicity note (actual implementation):** Two-step UI approach — `createDeliveries()` runs first; if it fails, staged delivery stays `in_progress`. If delivery creation succeeds but status update fails, a descriptive error is shown advising the user to check the Deliveries page. RPC transaction not implemented.

**Order matching timing:** Auto-allocation runs at conversion time against the current order status — not at staging time. If another delivery occurred between staging and conversion, the allocation result may differ from what was expected at staging. This is acceptable and mirrors how the regular delivery form works.

---

## Print Workflow

**[ACTUAL: Dedicated StagedDeliveryPrintView created — not identical to DeliveryPrintView]**

A dedicated `StagedDeliveryPrintView` component was created at `src/components/print/StagedDeliveryPrintView.tsx`. It shares CSS with `DeliveryPrintView` but has distinct UI differences:
- Title: **"Prepared Delivery Form"** (not "Delivery Form")
- Items column header: **"Units Staged"** (not "Units Delivered")
- Defines its own `StagedDeliveryPrintItem` and `StagedDeliveryPrintCustomer` types

**sessionStorage keys** (separate, no collision):
- Single staged delivery: `ssim-staged-delivery-print-data` → `/staged-deliveries/print`
- All in-progress (batch): `ssim-staged-delivery-print-all-data` → `/staged-deliveries/print-all`
- Regular deliveries: `ssim-delivery-print-data` → `/deliveries/print`

---

## Inventory Calculation Plan

### Detail view formula (per product+treatment+seed_size+package_type row):

```
physical_on_hand  = units_received - units_delivered + units_returned
staged_units      = SUM(staged_delivery_items.units_staged)
                    WHERE parent staged_delivery is not converted
                    AND matches product_id, treatment_id,
                        seed_size IS NOT DISTINCT FROM,
                        package_type IS NOT DISTINCT FROM
available_units   = physical_on_hand - staged_units
```

### Wide view formula (per product, aggregated across all seed sizes + package types):

```
available_units (per treatment column)
  = SUM(available_units) across all rows for that product+treatment
```

### Keys CTE update:

The `keys` CTE in `v_on_hand_inventory` unions `received UNION delivered UNION returned`. It must also union `staged_delivery_items` (filtered to unconverted) so that product+treatment+seed_size+package_type combinations that only exist in staged deliveries appear in the view.

### NULL handling:

- `staged_units` defaults to 0 via `COALESCE` when no staged items match (same pattern as existing CTEs)
- `seed_size IS NOT DISTINCT FROM` handles NULL seed sizes correctly (existing pattern from migration 0022)

---

## Reusable Components

| Component / Service | Reuse in Staged Deliveries | Notes |
|---|---|---|
| `DeliveryItemsTable` | **Full reuse** | Same `DeliveryItem` type, same props |
| `DeliveryPrintView` | **Not reused** | Dedicated `StagedDeliveryPrintView` created with distinct title and column header; shares CSS only |
| `SearchableSelect` | **Full reuse** | Same component |
| `CustomerOrderStatusTable` | **Full reuse** | Same component, same data fetch |
| `findOrderLineMatches()` | **Full reuse** | Called at conversion time |
| `createDeliveries()` | **Full reuse** | Called at conversion time |
| `fetchCustomers()` | **Full reuse** | Same service |
| `fetchPricingOptions()` | **Full reuse** | Same service |
| `fetchPackagingProducts()` | **Full reuse** | Same service |
| `ThisSeasonDeliveriesTable` | **Not reused** | Too delivery-specific; build `StagedDeliveriesTable` |
| `inventory.service.ts` | **Extend** | Add `fetchInventoryDetail()` shape for new columns |

---

## Agent Impact

### `get_on_hand_inventory` tool

Update the tool output to include new inventory columns:

**[ACTUAL: Field names differ from plan — use these actual names]**

```typescript
interface InventoryRow {
  product_name: string;
  treatment_name: string | null;
  seed_size: string | null;
  package_type: string | null;
  units_on_hand: number;         // physical on hand
  units_staged: number;          // reserved in staged deliveries (was `staged_units` in plan)
  available_units: number;       // units_on_hand - units_staged
}

interface ToolOutput {
  rows: InventoryRow[];
  total_units_on_hand: number;
  total_positive_units_on_hand: number;
  total_negative_units_on_hand: number;
  has_negative_inventory: boolean;
  negative_rows: InventoryRow[];
  total_units_staged: number;           // (was `total_staged_units` in plan)
  has_staged_inventory: boolean;
  total_available_units: number;
  has_negative_available: boolean;      // NEW — not in original plan
  negative_available_rows: InventoryRow[]; // NEW — not in original plan
  row_count: number;
  truncated?: boolean;
}
```

**System prompt:** Updated in `src/app/api/agent/chat/route.ts` — leads responses with `available_units`, explains all three quantities, handles negative-available and negative-physical separately.

### New approved view: `v_agent_staged_deliveries`

Add to migration 0026 (or a new migration 0027) as a thin wrapper around `v_staged_delivery_items` for the SQL fallback tool. Columns: `staged_delivery_id`, `delivery_date`, `season_year`, `customer_name`, `farm_name`, `product_name`, `treatment_name`, `seed_size`, `package_type`, `units_staged`.

Add `v_agent_staged_deliveries` to the TypeScript validator's `APPROVED_VIEWS` set in `src/lib/agent/sql/validate-approved-query.ts`.

**Agent use cases via SQL fallback:**
- "Which customers have staged deliveries this season?"
- "How many units are staged for DKC 45-50?"
- "Show me all staged deliveries for Smith Farms"

### `v_agent_inventory` view

This view wraps `v_on_hand_inventory` (`SELECT * FROM public.v_on_hand_inventory`). When the base view gains `staged_units` and `available_units` columns, `v_agent_inventory` automatically exposes them — no migration change required for the wrapper itself.

Update `docs/03_Data/06_agent_approved_views.md` to document the new columns.

---

## Implementation Phases

### Phase 1 — Core staged deliveries (table, form, list, print, delete)

1. **Migration A:** `staged_deliveries` + `staged_delivery_items` tables with RLS (matching existing user-scoped pattern from migration 0013)
2. **Migration A:** `v_staged_deliveries` + `v_staged_delivery_items` views
3. **`staged-delivery.service.ts`:** `createStagedDelivery()`, `fetchStagedDeliveries()`, `deleteStagedDelivery()`
4. **`StagedDeliveriesTable` component:** list view with Print + Delete actions (no Convert yet)
5. **`src/app/staged-deliveries/page.tsx`:** New Staged Delivery form + list toggle
6. **`src/app/staged-deliveries/print/page.tsx`:** Print page (renders `DeliveryPrintView`)
7. Add to app navigation

### Phase 2 — Conversion to actual delivery

1. **`staged-delivery.service.ts`:** `convertStagedDelivery()` — auto-allocates, creates delivery rows, marks converted
2. **Convert button + confirmation dialog** in `StagedDeliveriesTable`
3. **Conversion transaction strategy:** decide between UI-level two-step or Supabase RPC
4. Smoke-test: converted staged delivery disappears from list, appears on Deliveries → This Season Deliveries

### Phase 3 — Inventory view updates

1. **Migration B:** Rebuild `v_on_hand_inventory` to add staged CTE and `staged_units` / `available_units` columns (must DROP dependents first: `v_inventory_print_sheet` → `v_on_hand_inventory_wide` → `v_on_hand_inventory`)
2. **Migration B:** Rebuild `v_on_hand_inventory_wide` to pivot `available_units`
3. **Migration B:** Rebuild `v_inventory_print_sheet` (no column change — just re-create after dependency drop)
4. **`inventory.service.ts`:** Extend `InventoryDetailRow` with `staged_units` and `available_units`
5. **`InventoryDetailTable`:** Add Staged Units and Available Units columns
6. **`InventoryWideTable`:** Column values now represent available units; update header tooltip
7. **On-Hand Inventory page:** Update KPI cards and header subtitle

### Phase 4 — Agent updates

1. **Migration C:** `v_agent_staged_deliveries` view (new)
2. **`validate-approved-query.ts`:** Add `v_agent_staged_deliveries` to `APPROVED_VIEWS`
3. **`get-on-hand-inventory.ts`:** Add `staged_units`, `available_units`, `total_staged_units`, `total_available_units`, `has_staged_inventory` to output
4. **`route.ts` system prompt:** Update inventory section to explain physical vs. available distinction
5. **`docs/03_Data/06_agent_approved_views.md`:** Document new columns and new view
6. **`docs/03_Data/04_inventory_views.md`:** Update inventory formula section

---

## Risks and Cautions

| Risk | Mitigation |
|---|---|
| **View dependency chain** | `v_on_hand_inventory_wide`, `v_inventory_print_sheet`, and `v_agent_inventory` all depend on `v_on_hand_inventory`. Rebuild migration must follow strict DROP order (Phase 3). Test against a Supabase branch before applying to production. |
| **Wide view semantic change** | Pivoting `available_units` instead of `units_on_hand` in the wide view is a breaking visual change for any user who expects raw physical stock. Update KPI labels and page subtitle to make the shift clear. Consider a transition period showing both. |
| **Conversion atomicity** | If delivery creation succeeds but `status='converted'` update fails, the staged delivery remains visible but delivery rows exist in the `deliveries` table. Mitigated by two-step approach with clear error messaging, plus `AND status='in_progress'` guard. RPC transaction not implemented. |
| **NULL seed_size join** | Staged delivery items may have NULL seed_size (soybeans). The inventory CTE join must use `IS NOT DISTINCT FROM` (existing pattern from migration 0022) — not `=`. |
| **Keys CTE expansion** | Adding staged_delivery_items to the keys CTE means combinations that only exist in staged deliveries will now appear in the inventory view. These will show `units_on_hand = 0` and `staged_units > 0`, making `available_units` negative. This is correct and expected — surface it clearly in the UI. |
| **Print page sessionStorage collision** | If the user has the Deliveries and Staged Deliveries pages open simultaneously and both write to the same sessionStorage key, the most recent write wins. Use separate keys (`ssim-delivery-print-data` vs. `ssim-staged-delivery-print-data`) and separate print pages to avoid this. |
| **Order matching at conversion time** | The auto-allocation engine uses current order status, not status at staging time. A delivery made after staging but before conversion may consume order lines that the staged delivery expected. This is operationally acceptable but should be noted in user documentation. |
| **Existing delivery table unchanged** | The `deliveries` table is never modified by this feature. Staged deliveries live in their own tables and are only moved to `deliveries` via the explicit conversion action. This is a hard constraint. |
