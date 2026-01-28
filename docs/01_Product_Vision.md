# Product Vision – SSIM

## Overview

SSIM (Seed Sales & Inventory Management) is an internal system built to modernize how seed pricing, orders, and fulfillment are tracked throughout a growing season.

The system reflects **how the business actually operates**, rather than enforcing rigid workflows that slow users down.

---

## The Problem

Current workflows rely heavily on:
- spreadsheets
- manual reconciliation
- tribal knowledge

These approaches make it difficult to:
- know what customers actually received
- reconcile discrepancies at year end
- support reporting or dashboards
- scale processes consistently

Real-world issues include:
- customers changing products at pickup
- partial deliveries
- returns and replants
- pricing received well before the selling season

---

## The Solution

SSIM provides:
- A **read-only pricing sheet** for sales staff
- A **simple order form** for capturing intent
- **Operational event tracking** (deliveries, returns, replants)
- Clear **reconciliation views** to identify:
  - over-deliveries (extra charges)
  - under-deliveries (credits)
  - non-revenue activity (replants)

---

## Core Design Principles

### Reflect reality, don’t fight it
Orders do not always match deliveries.
SSIM tracks both independently so discrepancies can be resolved later.

### Minimize friction at the point of action
Users should never be blocked because:
- a customer ordered the “wrong” product earlier
- an order wasn’t updated in time

### Separate revenue from logistics
- Orders → revenue intent
- Deliveries / Returns → physical movement
- Replants → tracked but non-revenue

---

## Target Users

- Sales staff
- Operations / logistics staff
- Management (reporting & reconciliation)

This is not a customer-facing system.

---

## Phased Roadmap (High Level)

### Phase 1 (Current)
- Pricing page
- Order entry
- Core database schema
- Pricing views

### Phase 2
- Deliveries
- Returns
- Replants
- Reconciliation views
- Customer reconciliation UI

### Phase 3+
- Dashboards
- Advanced reporting
- Auth + RLS
- Deployment & production hardening

---

## Success Criteria

SSIM is successful if:
- Pricing is always visible and trusted
- Orders are quick to enter
- Deliveries can be recorded without friction
- Year-end reconciliation is clear and auditable
