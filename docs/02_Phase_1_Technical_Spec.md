# Phase 1 Technical Specification – SSIM

## Phase Objective

Phase 1 establishes the **foundation** of SSIM:
- Pricing visibility
- Order capture
- Core relational database design

No authentication, RLS, or dashboards are included in this phase.

---

## Phase 1 Scope (In)

### Pages
- Pricing Page (read-only)
- Orders Page (create orders + order line items)

### Database
- Customers
- Products
- Treatments
- Pricing
- Orders
- Order Items
- Pricing-related views

---

## Phase 1 Scope (Out)

- Deliveries
- Returns
- Replants
- Reconciliation
- Dashboards
- Authentication / RLS

(These are planned for later phases and already considered in schema design.)

---

## Pricing Page

### Requirements
- Display pricing by **season year**
- Tabs for each season year
- Default to the newest season
- Excel-like layout:
  - rows = products
  - columns = treatments
- Toggle:
  - Retail price
  - Break-even price

### Data Source
- `v_pricing_seasons`
- `v_pricing_sheet_wide`
- `v_pricing_break_even_wide`

### Permissions
- Read-only for all users
- Pricing data is inserted manually via SQL outside the app

---

## Orders Page

### Requirements
- Create an order for a customer
- Support multiple order line items
- Allow customer creation inline if customer does not exist
- Auto-fill product details and pricing based on:
  - season year
  - product
  - treatment

### Order Line Item Fields (Initial)
- Product
- Treatment
- Units
- Unit price (auto-filled)
- Optional fields for future expansion:
  - seed size
  - package type
  - discounts

### Data Source
- Tables:
  - `customers`
  - `orders`
  - `order_items`
- View:
  - `v_pricing_options`

---

## Database Design Principles (Phase 1)

- All tables use UUID primary keys
- Foreign keys enforce relationships
- Pricing is normalized (product + treatment)
- Pricing is read-only in UI
- Season year is explicit to support early pricing

---

## Deferred Decisions (Intentional)

The following are intentionally deferred:
- RLS and user roles
- Company-level multi-tenancy
- Invoice generation
- Inventory depletion logic

Schema decisions in Phase 1 are made to **not block** these features later.

---

## Phase 1 Exit Criteria

Phase 1 is complete when:
- Pricing page renders correctly for multiple seasons
- Orders can be created with multiple line items
- Customers can be added inline
- Database schema is stable and documented
- UI uses views (not raw tables) where appropriate

Once complete, development proceeds to Phase 2.
