# SSIM – Seed Sales & Inventory Management

SSIM is a web-based internal tool designed to support agricultural seed sales operations, with an initial focus on **pricing visibility and order capture**, followed by **delivery tracking, reconciliation, and reporting**.

This repository contains:
- Application source code (Next.js + Supabase)
- Database schema and migrations
- Technical specifications and documentation used to guide development

This project is being built in **phases** to ensure correctness, flexibility, and ease of future expansion.

---

## Project Goals

SSIM is designed to:
- Replace spreadsheet-based pricing and order tracking
- Provide a simple, fast UI for sales and operational staff
- Accurately track what was:
  - ordered
  - delivered
  - returned
  - replanted
- Support clean **year-end reconciliation**
- Serve as a foundation for dashboards and analytics later

---

## Development Philosophy

### 1) Database-first design
Business logic that determines:
- pricing
- aggregation
- reconciliation
is handled in **Postgres views** where possible, not duplicated in the UI.

### 2) Simple UI, strong backend
The UI should:
- be easy to use under time pressure
- avoid forcing users to “fix data” in the moment
- reflect real-world workflows (substitutions, replants, late changes)

### 3) Auth + RLS last
Authentication and Row Level Security (RLS) are intentionally deferred until the final phase before deployment.
This avoids slowing development and allows rapid iteration while schema and workflows are still evolving.

---

## Project Structure (High Level)

- `/src` – Application code (Next.js)
- `/supabase` – Database migrations, seed scripts, and policies
- `/docs` – Technical specifications, database documentation, and build plans
- `/scripts` – Development helpers (reset/seed scripts)

Each folder contains its own README or documentation where appropriate.

---

## Current Status

- Phase 1 planning complete
- Core database schema designed
- Pricing, Orders, Deliveries, Returns, and Replants defined
- UI development has not yet started

See `docs/02_Phase_1_Technical_Spec.md` for details.
