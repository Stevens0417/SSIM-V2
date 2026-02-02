# Build Plan – SSIM

This document outlines the step-by-step build plan for SSIM, starting from initial database setup through Phase 1 UI development and into later phases.  
It is intended to be followed sequentially.

---

## Guiding Principles

- Database-first development
- Views handle aggregation and business logic
- UI remains simple and fast for users
- Authentication and RLS are added last
- Each phase produces a usable, stable system

---

## Phase 0 – Project Setup (One-Time)

### 0.1 Repository & Tooling
- Initialize Git repository
- Set up Next.js project
- Install dependencies:
  - Supabase client
  - UI library (e.g., shadcn/ui)
- Create base folder structure:
  - `/src`
  - `/supabase`
  - `/docs`
  - `/scripts`

### 0.2 Environment Configuration
- Create `.env.example`
- Add Supabase credentials:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Verify Supabase connection from app

---

## Phase 1 – Core Pricing & Orders (Current Phase)

### 1.1 Database Foundations
**Goal:** Establish stable core schema with no auth/RLS.

#### Migrations
Create and apply migrations in this order:
1. `0001_init.sql`
   - Extensions
   - Utility functions (e.g., `set_updated_at`)
2. `0002_core_tables.sql`
   - customers
   - products
   - treatments
   - pricing (with `season_year`)
3. `0003_pricing_seed_2024.sql`
   - Seed pricing data for development
4. `0004_views_pricing.sql`
   - `v_pricing_seasons`
   - `v_pricing_sheet_wide`
   - `v_pricing_break_even_wide`
   - `v_pricing_options`
5. `0005_orders.sql`
   - orders
   - order_items

#### Validation
- Confirm all foreign keys work
- Confirm pricing views return correct data
- Confirm break-even calculations are correct

---

### 1.2 Pricing Page (UI)

**Goal:** Read-only pricing visibility.

#### Features
- Tabs by `season_year`
- Default to newest season
- Toggle:
  - Retail
  - Break-even
- Excel-like table layout

#### Data Sources
- `v_pricing_seasons`
- `v_pricing_sheet_wide`
- `v_pricing_break_even_wide`

#### UI Tasks
- Build season tabs component
- Build pricing table component
- Implement toggle logic
- Handle sorting in UI (crop → product)

---

### 1.3 Orders Page (UI)

**Goal:** Capture customer purchase intent quickly.

#### Features
- Create new order
- Add multiple order line items
- Inline customer creation if customer does not exist
- Auto-fill pricing based on product + treatment + season

#### Data Sources
- Tables:
  - customers
  - orders
  - order_items
- View:
  - `v_pricing_options`

#### UI Tasks
- Customer selector with “Add new customer” flow
- Product dropdown (filtered by season)
- Treatment dropdown (filtered by product)
- Unit price auto-fill
- Save order + line items transactionally

---

### 1.4 Phase 1 Validation Checklist
Phase 1 is complete when:
- Pricing page renders correctly for multiple seasons
- Orders can be created with multiple line items
- Customers can be added inline
- No business logic is duplicated in UI
- Database documentation is up to date

---

## Phase 2 – Operational Events & Reconciliation

### 2.1 Event Tables
Create migration:
- `0006_deliveries_returns_replants.sql`

Includes:
- deliveries
- returns
- replants
- season_year support
- optional links to orders/order_items

### 2.2 Event Entry UI
Create pages:
- `/deliveries`
- `/returns`
- `/replants`

Each page:
- Customer selection
- Product + treatment selection
- Units + date
- Optional notes
- No requirement to match an order

---

### 2.3 Reconciliation Views
Create migration:
- `0007_reconciliation_views.sql`

Views include:
- Line-level reconciliation:
  - ordered vs delivered vs returned
- Customer totals per season
- Replants tracked separately (non-revenue)

---

### 2.4 Reconciliation UI
Create page:
- `/reconciliation`

Features:
- Season tabs
- Customer-level summary rows
- Expandable product-level detail
- Indicators:
  - over-delivered (charge)
  - under-delivered (credit)
  - replants (informational)

---

## Phase 3 – Dashboards & Reporting

### 3.1 Dashboard Views
- Sales totals by season
- Profit by product/treatment
- Replants frequency
- Delivery vs order variance

### 3.2 Dashboard UI
- KPI cards
- Tables
- Charts
- Export support (CSV)

---

## Phase 4 – Auth, RLS, Deployment (Final Phase)

### 4.1 Authentication
- Enable Supabase auth
- Define roles:
  - admin
  - standard user (read/write operational data)

### 4.2 Row Level Security
Create migration:
- `0010_rls_and_auth.sql`

Policies:
- Pricing: read-only
- Orders/events: role-based access
- Admin-only pricing updates

### 4.3 Production Readiness
- Lock migrations
- Final seed scripts
- Deployment configuration
- Backup strategy

---

## Ongoing Maintenance

- New pricing years → new seed scripts
- Schema changes → new migrations only
- Docs updated alongside schema changes

---

## End State Vision

When complete, SSIM will:
- Replace spreadsheets
- Provide a clear operational audit trail
- Enable fast reconciliation
- Support dashboards and analytics
- Scale cleanly with minimal rework
