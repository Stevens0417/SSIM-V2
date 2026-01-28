# Data Shapes (UI Contracts)

This file defines the exact “data shapes” the UI expects from Supabase tables and views. These are the contracts the frontend should rely on. If a table/view changes, update this file.

---

## Pricing Page

### View: `v_pricing_seasons`
**Use:** Build year/season tabs. Default to newest year.

**Shape**
```ts
type PricingSeasonRow = {
  season_year: number;
};
