# 01 — Core Tables

Core/master tables that hold reference data shared across the application. These are not user-scoped (no `user_id` column) except for `customers`.

---

## customers

**Purpose:** Master list of seed purchaser customers. Used as the source for customer dropdowns on all order/delivery/return/replant entry forms. Managed via the /customers admin page.

**User-scoped:** Yes — each user maintains their own customer list.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `customer_name` | text | Unique per user. Display name in all dropdowns. |
| `farm_name` | text \| null | Optional farm name |
| `phone_number` | text \| null | Contact phone |
| `address` | text \| null | Street address |
| `city` | text \| null | City |
| `province` | text \| null | Province/state |
| `postal_code` | text \| null | Postal/zip code |
| `tsa_number` | text \| null | TSA (Territory Sales Account) number |
| `user_id` | uuid | Set to `auth.uid()` on insert. RLS-enforced. |
| `created_at` | timestamptz | Auto-set |
| `updated_at` | timestamptz | Auto-updated by trigger |

**Note on live schema:** The original migration (0002) defined the column as `name`. The live schema uses `customer_name`. All service and view code references `customer_name`. Verify in current schema if running fresh migrations.

**Relationships:**
- Referenced by: `orders.customer_id`, `deliveries.customer_id`, `returns.customer_id`, `replants.customer_id`
- `orders` has `ON DELETE RESTRICT` — a customer with existing orders cannot be deleted.

**Business notes:**
- Customer name is unique within each user's account.
- The customer record used in order/delivery/return forms is the same record from this table — not a text copy.
- Deletion is blocked by the FK constraint if any orders reference the customer. The UI surfaces a friendly error in this case.

---

## products

**Purpose:** Master product catalog. Each product is a specific seed variety (e.g., DKC 45-50). Global — shared across all users.

**User-scoped:** No (global, read-only for authenticated users).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `product_name` | text | Unique. Used as the display label everywhere. |
| `crop` | text \| null | `'corn'`, `'soybean'`, or `'packaging'`. Determines seed_size eligibility. |
| `chu` | text \| null | Corn Heat Units (for corn varieties) |
| `seed_trait` | text \| null | Seed genetic trait descriptor |
| `is_active` | boolean | Default true. Inactive products hidden from dropdowns. |
| `created_at` | timestamptz | Auto-set |
| `updated_at` | timestamptz | Auto-updated by trigger |

**Relationships:**
- Referenced by: `pricing`, `order_items`, `deliveries`, `returns`, `replants`, `bayer_shipment_items`

**Business notes:**
- `crop = 'corn'` enables the `seed_size` field on delivery/return/replant forms.
- `crop = 'packaging'` designates non-seed products (e.g., packaging supplies). These use `NO_TREATMENT` treatment and are excluded from most inventory views.
- `crop = 'soybean'` — no seed_size; break-even calculation uses soybean formula.

---

## treatments

**Purpose:** Master list of seed treatment options (e.g., FUNGICIDE, PONCHO). Global — shared across all users.

**User-scoped:** No (global, read-only for authenticated users).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `treatment_name` | text | Unique. Display label in dropdowns and views. |
| `description` | text \| null | Optional description |
| `is_active` | boolean | Default true |
| `created_at` | timestamptz | Auto-set |
| `updated_at` | timestamptz | Auto-updated by trigger |

**Special treatment:** `NO_TREATMENT` — used for packaging products and to mark items with no applied treatment. Views that show "real" inventory typically exclude `NO_TREATMENT` rows.

**Relationships:**
- Referenced by: `pricing`, `order_items`, `deliveries`, `returns`, `replants`, `bayer_shipment_items`

---

## pricing

**Purpose:** Per-season retail and cost pricing for each product + treatment combination. The source of truth for all pricing calculations.

**User-scoped:** No (global, maintained by admin).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `season_year` | integer | e.g., 2024 |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `retail_price` | numeric | Retail price per unit |
| `cost_price` | numeric \| null | Bayer cost price (used for break-even) |
| `created_at` | timestamptz | Auto-set |
| `updated_at` | timestamptz | Auto-updated by trigger |

**Unique constraint:** `(season_year, product_id, treatment_id)`

**Break-even formulas (defined in pricing views):**
- Corn: `retail_price - (0.075 × retail_price) - 56.65`
- Soybean: `retail_price - (0.075 × retail_price) - 10.40`

**Business notes:**
- Adding a new season_year row to pricing activates that year as the current season.
- The `pricing` table determines which season is "current" — all "this season" views use `max(season_year) from pricing`.
- Pricing is set once per season and is not user-specific. All users share the same pricing sheet.

**Cautions:**
- Do not delete pricing rows mid-season — the season boundary logic depends on them.
- Adding a new season year immediately shifts all "this season" views to the new year.

---

## invoice_adjustment_checks

**Purpose:** Tracks whether a user has reviewed and signed off on each year-end invoice adjustment line. Used on the Adjustments page.

**User-scoped:** Yes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Auto-generated |
| `user_id` | uuid | RLS-enforced |
| `season_year` | integer | |
| `customer_id` | uuid FK → customers | |
| `product_id` | uuid FK → products | |
| `treatment_id` | uuid FK → treatments | |
| `early_pay_bucket` | text | `'EARLY_PAY'`, `'NO_EARLY_PAY'`, or `'UNKNOWN'` |
| `is_completed` | boolean | Whether user has checked off this line |
| `completed_at` | timestamptz \| null | When checked |
| `created_at` | timestamptz | Auto-set |

**Business notes:**
- One row per unique (user, season, customer, product, treatment, early_pay_bucket) combination.
- `is_completed` is toggled via the Adjustments page.
- The `v_year_end_adjustments` view left-joins this table to show check status alongside ordered/delivered/returned unit counts.
