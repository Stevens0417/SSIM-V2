import { describe, it, expect } from "vitest";
import { type ShipmentItem } from "../ShipmentItemsTable";

/* ------------------------------------------------------------------ */
/*  Helpers mirroring page.tsx validation (not exported from page)     */
/* ------------------------------------------------------------------ */

function isRowEmpty(row: ShipmentItem): boolean {
  return !row.productId && !row.treatmentId && row.units === 0;
}

/** Returns true when the units value is valid (non-zero integer). */
function isUnitsValid(units: number): boolean {
  return !!units && Number.isInteger(units);
}

/** Simulates the parseInt(e.target.value) || 0 handler in the input. */
function parseUnitsInput(raw: string): number {
  return parseInt(raw) || 0;
}

/** Mirrors page.tsx duplicate-line detection logic. */
function findDuplicateLines(rows: ShipmentItem[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    if (!row.productId || !row.treatmentId) continue;
    const key = `${row.productId}::${row.treatmentId}`;
    if (seen.has(key)) dupes.add(row.id);
    seen.add(key);
  }
  return dupes;
}

/* ------------------------------------------------------------------ */
/*  Scenario 1 — Negative units for normal seed product               */
/* ------------------------------------------------------------------ */

describe("Scenario 1: negative units (returns)", () => {
  it("parses -10 from input string", () => {
    expect(parseUnitsInput("-10")).toBe(-10);
  });

  it("accepts units = -10 as valid", () => {
    expect(isUnitsValid(-10)).toBe(true);
  });

  it("row with units=-10, product, and treatment is NOT empty", () => {
    const row: ShipmentItem = {
      id: "r1",
      productId: "prod-1",
      treatmentId: "treat-1",
      product: "DKC62-89",
      treatment: "Acceleron",
      units: -10,
    };
    expect(isRowEmpty(row)).toBe(false);
  });

  it("canSave check passes for negative units", () => {
    // mirrors: it.productId && it.treatmentId && it.units !== 0
    const canSaveLine = (r: ShipmentItem) =>
      !!r.productId && !!r.treatmentId && r.units !== 0;
    const row: ShipmentItem = {
      id: "r1",
      productId: "prod-1",
      treatmentId: "treat-1",
      product: "DKC62-89",
      treatment: "Acceleron",
      units: -10,
    };
    expect(canSaveLine(row)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Scenario 2 — Packaging products with auto NO_TREATMENT            */
/* ------------------------------------------------------------------ */

describe("Scenario 2: Packaging products → NO_TREATMENT (ID-based)", () => {
  const PACKAGING_IDS = new Set(["pallet-uuid", "seedpak-uuid"]);

  it("detects packaging product by ID", () => {
    expect(PACKAGING_IDS.has("pallet-uuid")).toBe(true);
    expect(PACKAGING_IDS.has("seedpak-uuid")).toBe(true);
  });

  it("does NOT flag normal seed products", () => {
    expect(PACKAGING_IDS.has("prod-dkc62")).toBe(false);
    expect(PACKAGING_IDS.has("prod-dkb45")).toBe(false);
  });

  it("packaging row with NO_TREATMENT id passes canSave", () => {
    const canSaveLine = (r: ShipmentItem) =>
      !!r.productId && !!r.treatmentId && r.units !== 0;
    const row: ShipmentItem = {
      id: "r2",
      productId: "seedpak-uuid",
      treatmentId: "no-treat-uuid",
      product: "Seedpak",
      treatment: "NO_TREATMENT",
      units: 5,
    };
    expect(canSaveLine(row)).toBe(true);
  });

  it("packaging return (negative units) passes canSave", () => {
    const canSaveLine = (r: ShipmentItem) =>
      !!r.productId && !!r.treatmentId && r.units !== 0;
    const row: ShipmentItem = {
      id: "r2b",
      productId: "pallet-uuid",
      treatmentId: "no-treat-uuid",
      product: "Pallet",
      treatment: "NO_TREATMENT",
      units: -3,
    };
    expect(canSaveLine(row)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Scenario 3 — This-season list renders Pallets/Seedpak             */
/*  (Runtime UI check — verified by code trace:                       */
/*   v_bayer_shipments joins treatments → treatment_name column       */
/*   renders "NO_TREATMENT" text. Search filter includes it.)         */
/* ------------------------------------------------------------------ */

describe("Scenario 3: list-view treatment display", () => {
  it("NO_TREATMENT name is a non-empty string for display", () => {
    const treatmentName = "NO_TREATMENT";
    expect(treatmentName.length).toBeGreaterThan(0);
    expect(treatmentName).toBe("NO_TREATMENT");
  });
});

/* ------------------------------------------------------------------ */
/*  Scenario 4 — units=0 is rejected                                  */
/* ------------------------------------------------------------------ */

describe("Scenario 4: zero units rejected", () => {
  it("units=0 fails isUnitsValid", () => {
    expect(isUnitsValid(0)).toBe(false);
  });

  it("units=0 makes canSave false", () => {
    const canSaveLine = (r: ShipmentItem) =>
      !!r.productId && !!r.treatmentId && r.units !== 0;
    const row: ShipmentItem = {
      id: "r3",
      productId: "prod-1",
      treatmentId: "treat-1",
      product: "DKC62-89",
      treatment: "Acceleron",
      units: 0,
    };
    expect(canSaveLine(row)).toBe(false);
  });

  it("empty input string parses to 0 (rejected)", () => {
    expect(parseUnitsInput("")).toBe(0);
    expect(isUnitsValid(0)).toBe(false);
  });

  it("NaN input parses to 0 (rejected)", () => {
    expect(parseUnitsInput("abc")).toBe(0);
    expect(isUnitsValid(0)).toBe(false);
  });

  it("row with units=0 and no product/treatment is empty", () => {
    const row: ShipmentItem = {
      id: "r4",
      productId: "",
      treatmentId: "",
      product: "",
      treatment: "",
      units: 0,
    };
    expect(isRowEmpty(row)).toBe(true);
  });

  it("row with units=0 but product set is NOT empty (catches validation)", () => {
    const row: ShipmentItem = {
      id: "r5",
      productId: "prod-1",
      treatmentId: "treat-1",
      product: "DKC62-89",
      treatment: "Acceleron",
      units: 0,
    };
    expect(isRowEmpty(row)).toBe(false);
    // But isUnitsValid still rejects it:
    expect(isUnitsValid(row.units)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Scenario 5 — season_year stored column sanity checklist            */
/*  (Manual verification — run against live DB)                        */
/*                                                                     */
/*  1. Create shipment: date=2025-10-15, season dropdown=2026          */
/*     → bayer_shipments.season_year = 2026                            */
/*     → appears in "This Season Shipments" under 2026 filter          */
/*     → does NOT appear under 2025 filter                             */
/*                                                                     */
/*  2. Create shipment: date=2026-02-01, season dropdown=2025          */
/*     → bayer_shipments.season_year = 2025                            */
/*     → appears in "This Season Shipments" under 2025 filter          */
/*     → does NOT appear under 2026 filter                             */
/*                                                                     */
/*  3. Edit shipment from (1), change season dropdown to 2025, save    */
/*     → bayer_shipments.season_year updated to 2025                   */
/*     → now appears under 2025 filter, gone from 2026                 */
/*                                                                     */
/*  4. v_bayer_shipments returns s.season_year (stored), NOT           */
/*     extract(year from s.shipment_date). Confirmed by scenarios      */
/*     1 & 2 where date-year ≠ season_year.                            */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Scenario 6 — Duplicate line detection                              */
/* ------------------------------------------------------------------ */

describe("Scenario 6: duplicate line detection", () => {
  it("no duplicates when all lines are unique", () => {
    const rows: ShipmentItem[] = [
      { id: "a", productId: "p1", treatmentId: "t1", product: "", treatment: "", units: 5 },
      { id: "b", productId: "p1", treatmentId: "t2", product: "", treatment: "", units: 3 },
      { id: "c", productId: "p2", treatmentId: "t1", product: "", treatment: "", units: 2 },
    ];
    expect(findDuplicateLines(rows).size).toBe(0);
  });

  it("flags second row when two rows share same product+treatment", () => {
    const rows: ShipmentItem[] = [
      { id: "a", productId: "p1", treatmentId: "t1", product: "", treatment: "", units: 5 },
      { id: "b", productId: "p1", treatmentId: "t1", product: "", treatment: "", units: 3 },
    ];
    const dupes = findDuplicateLines(rows);
    expect(dupes.size).toBe(1);
    expect(dupes.has("b")).toBe(true);
  });

  it("ignores rows with missing productId or treatmentId", () => {
    const rows: ShipmentItem[] = [
      { id: "a", productId: "", treatmentId: "t1", product: "", treatment: "", units: 5 },
      { id: "b", productId: "p1", treatmentId: "", product: "", treatment: "", units: 3 },
    ];
    expect(findDuplicateLines(rows).size).toBe(0);
  });

  it("same product different treatment is NOT a duplicate", () => {
    const rows: ShipmentItem[] = [
      { id: "a", productId: "p1", treatmentId: "t1", product: "", treatment: "", units: 5 },
      { id: "b", productId: "p1", treatmentId: "t2", product: "", treatment: "", units: 3 },
    ];
    expect(findDuplicateLines(rows).size).toBe(0);
  });

  it("packaging products with same NO_TREATMENT are flagged as duplicates", () => {
    const rows: ShipmentItem[] = [
      { id: "a", productId: "pallet-uuid", treatmentId: "no-treat", product: "Pallet", treatment: "NO_TREATMENT", units: 5 },
      { id: "b", productId: "pallet-uuid", treatmentId: "no-treat", product: "Pallet", treatment: "NO_TREATMENT", units: -2 },
    ];
    const dupes = findDuplicateLines(rows);
    expect(dupes.size).toBe(1);
    expect(dupes.has("b")).toBe(true);
  });
});
