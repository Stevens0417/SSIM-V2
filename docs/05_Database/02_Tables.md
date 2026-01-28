# Tables

This file documents all core tables for SSIM.

---

## 1) customers
**Purpose:** Stores customer records used across Orders and operational events (Deliveries/Returns/Replants).

**Key columns**
- `id` (uuid, PK)
- `customer_name` (text, unique)  ✅ (replaced “farm name”)
- Contact & address fields (phone, address, etc.)

**Relationships**
- customers → orders (1-to-many)
- customers → deliveries/returns/replants (1-to-many)

**Notes**
- If a user selects Customer on the Order form and the customer does not exist, the UI supports creating a new customer record during order save.

---

## 2) products
**Purpose:** Master list of supported products (Phase 1 focuses on DEKALB only).

**Key columns**
- `id` (uuid, PK)
- `product_name` (text, unique) e.g., "DKC 46-50"
- `crop` (text) e.g., "corn" / "soybean"
- `chu` (int)
- `seed_trait` (text)

**Relationships**
- products → pricing (1-to-many)
- products → order_items (1-to-many)
- products → deliveries/returns/replants (1-to-many)

---

## 3) treatments
**Purpose:** Master list of treatment names used in pricing and order/event capture.

**Key columns**
- `id` (uuid, PK)
- `treatment_name` (text, unique)

**Relationships**
- treatments → pricing (1-to-many)
- treatments → order_items (1-to-many)
- treatments → deliveries/returns/replants (1-to-many)

---

## 4) pricing
**Purpose:** Stores retail pricing for each Product + Treatment combination by season year.
Pricing is **read-only for users** in the UI (admin inserts yearly pricing manually outside the app during Phase 1).

**Key columns**
- `id` (uuid, PK) (if present in your schema) OR composite uniqueness via indexes
- `product_id` (FK → products)
- `treatment_id` (FK → treatments)
- `season_year` (int, required) ✅ used for UI tabs
- `pricing_year` (int, optional) year entered/received (if you keep it)
- `retail_price` (numeric)

**Constraints**
- Unique: `(product_id, treatment_id, season_year)`
- `season_year` between 2000 and 2100
- Retail price numeric constraints handled by type

**Notes**
- Break-even is not stored here; it is computed in views using rules.

---

## 5) orders
**Purpose:** Order header record. Represents a customer’s intent to purchase.
Orders are not guaranteed to match delivery reality (customers can substitute at pickup).

**Key columns (typical)**
- `id` (uuid, PK)
- `order_date` (date)
- `season_year` (int) ✅ strongly recommended for recon
- `customer_id` (FK → customers)
- Optional flags/fields: early payment, notes, etc.

**Relationships**
- orders → order_items (1-to-many)
- orders → deliveries/returns/replants (optional linkage)

---

## 6) order_items
**Purpose:** Order line items (multi-line support). Each line references product+treatment and the units ordered. Additional pricing/discount math can be stored here (you prefer storing totals for dashboard use).

**Key columns (typical)**
- `id` (uuid, PK)
- `order_id` (FK → orders)
- `product_id` (FK → products)
- `treatment_id` (FK → treatments)
- `units` (int)
- Optional: seed size, package type, discounts, computed totals, etc.

**Relationships**
- order_items → deliveries/returns/replants (optional linkage via `order_item_id`)

---

## 7) deliveries
**Purpose:** Operational event table tracking what was actually delivered.
Supports “substitution” deliveries where the customer receives product/treatment they did not order.

**Key columns**
- `id` (uuid, PK)
- `delivery_date` (date)
- `season_year` (int)
- `customer_id` (FK → customers)
- `product_id` (FK → products)
- `treatment_id` (FK → treatments)
- `units_delivered` (int, > 0)
- Optional: `order_id` (FK → orders), `order_item_id` (FK → order_items) for traceability when applicable
- `notes` (text)

**Why order links are optional**
- Customer substitutions at pickup are common; deliveries must be recordable even when no matching order exists.

---

## 8) returns
**Purpose:** Operational event table tracking product returned by a customer.
Mirrors deliveries structure for consistent reporting and reconciliation.

**Key columns**
- `id` (uuid, PK)
- `return_date` (date)
- `season_year` (int)
- `customer_id` (FK → customers)
- `product_id` (FK → products)
- `treatment_id` (FK → treatments)
- `units_returned` (int, > 0)
- Optional: `order_id`, `order_item_id`
- `notes`

---

## 9) replants
**Purpose:** Tracks replants (non-revenue replacements).
Replants must be tracked operationally but should not be treated as revenue events.

**Key columns**
- `id` (uuid, PK)
- `replant_date` (date)
- `season_year` (int)
- `customer_id` (FK → customers)
- `product_id` (FK → products)
- `treatment_id` (FK → treatments)
- `units_replanted` (int, > 0)
- Optional: `order_id`, `order_item_id`
- Optional: `original_delivery_id`, `original_return_id` (links to related events when known)
- `replant_reason`, `notes`

**Notes**
- Replants are excluded from billing reconciliation logic but included in operational tracking.

---
