# Database Overview (SSIM)

## Goal
SSIM uses a relational database (Supabase Postgres) to support:
- Pricing Sheet (read-only for users)
- Orders (order header + line items)
- Deliveries, Returns, and Replants (operational events)
- End-of-season reconciliation (ordered vs delivered vs returned; replants tracked separately)

Authentication + RLS will be added **last** (final step before deployment). During development, tables/views are built without RLS to avoid blocking iteration.

---

## Key Concepts

### Product + Treatment is the key pairing
Pricing and operational activity are driven by a unique combination of:
- `product_id` (Products)
- `treatment_id` (Treatments)

### Pricing year vs Season year
We track season/year explicitly because pricing timing can lead the season:
- `pricing_year`: year the price list was received/entered (optional usage)
- `season_year`: year the pricing applies to for selling/planting season (used by UI tabs)

Example: pricing entered in **2026** for **2027** season → `season_year = 2027`.

### Orders vs Events (Deliveries/Returns/Replants)
- Orders represent what customers *intended* to buy.
- Deliveries represent what was *actually delivered* (can differ from orders).
- Returns represent product sent back.
- Replants represent non-revenue replacements (tracked separately).

This separation allows accurate reconciliation at year-end:
- Delivered but not ordered → extra charge
- Ordered but not delivered → credit
- Replants do not generate revenue, but are tracked for operational reporting.

---

## Entity Relationship Summary (high level)
- `customers` (1) → (many) `orders`
- `orders` (1) → (many) `order_items`
- `products` (1) → (many) `pricing`, `order_items`, `deliveries`, `returns`, `replants`
- `treatments` (1) → (many) `pricing`, `order_items`, `deliveries`, `returns`, `replants`
- `pricing` is unique per (product, treatment, season_year)
- Deliveries/Returns/Replants can optionally link back to the original order line (`order_item_id`), but they never require it.

---

## UI Dependencies
Pricing page:
- Uses wide pricing views (Excel-like layout)
- Tabs by `season_year`
- Toggle: retail vs break-even (view-based)

Order form:
- Uses pricing helper view to populate:
  - product dropdown
  - treatment dropdown filtered by product
  - auto-fill retail price (and break-even if needed)

---

## Notes
- All tables use UUID primary keys
- `updated_at` is maintained via a trigger using `public.set_updated_at()` (assumed to exist from your base migrations)
