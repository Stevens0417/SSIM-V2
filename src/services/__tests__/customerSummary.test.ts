import { describe, it, expect } from "vitest";
import {
  buildMovementSummary,
  computeSummaryTotals,
} from "../customerSummary.service";
import type {
  ReportDeliveryRow,
  ReportReplantRow,
  ReportReturnRow,
} from "../customerAdjustmentReport.service";

const BASE = {
  user_id: "u1",
  season_year: 2025,
  customer_id: "c1",
  customer_name: "Acme Farms",
  farm_name: "North Field",
};

function delivery(o: Partial<ReportDeliveryRow>): ReportDeliveryRow {
  return {
    ...BASE,
    delivery_header_id: null,
    delivery_id: "d1",
    delivery_date: "2025-04-01",
    product_id: "p1",
    product_name: "Corn A",
    treatment_id: "t1",
    treatment_name: "Untreated",
    seed_size: "AR",
    package_type: "bag",
    units_delivered: 0,
    notes: null,
    ...o,
  };
}

function ret(o: Partial<ReportReturnRow>): ReportReturnRow {
  return {
    ...BASE,
    return_id: "r1",
    return_date: "2025-05-01",
    product_id: "p1",
    product_name: "Corn A",
    treatment_id: "t1",
    treatment_name: "Untreated",
    seed_size: "AR",
    package_type: "bag",
    units_returned: 0,
    notes: null,
    ...o,
  };
}

function replant(o: Partial<ReportReplantRow>): ReportReplantRow {
  return {
    ...BASE,
    replant_id: "rp1",
    replant_date: "2025-06-01",
    product_id: "p1",
    product_name: "Corn A",
    treatment_id: "t1",
    treatment_name: "Untreated",
    seed_size: "AR",
    package_type: "bag",
    units_replanted: 0,
    notes: null,
    ...o,
  };
}

describe("computeSummaryTotals", () => {
  it("Test 1: deliveries only — net = delivered, returns/replants empty", () => {
    const totals = computeSummaryTotals(
      [delivery({ units_delivered: 100 }), delivery({ delivery_id: "d2", units_delivered: 50 })],
      [],
      []
    );
    expect(totals.totalDelivered).toBe(150);
    expect(totals.totalReturned).toBe(0);
    expect(totals.totalReplanted).toBe(0);
    expect(totals.netPhysical).toBe(150);
  });

  it("Test 2: deliveries and returns — net = delivered - returned", () => {
    const totals = computeSummaryTotals(
      [delivery({ units_delivered: 100 })],
      [ret({ units_returned: 30 })],
      []
    );
    expect(totals.totalDelivered).toBe(100);
    expect(totals.totalReturned).toBe(30);
    expect(totals.netPhysical).toBe(70);
  });

  it("Test 3: deliveries, returns, replants — net = delivered + replanted - returned", () => {
    const totals = computeSummaryTotals(
      [delivery({ units_delivered: 100 })],
      [ret({ units_returned: 30 })],
      [replant({ units_replanted: 10 })]
    );
    expect(totals.totalDelivered).toBe(100);
    expect(totals.totalReturned).toBe(30);
    expect(totals.totalReplanted).toBe(10);
    expect(totals.netPhysical).toBe(80); // 100 + 10 - 30
  });
});

describe("buildMovementSummary", () => {
  it("Test 4: groups by product + treatment + seed_size + package_type", () => {
    const rows = buildMovementSummary(
      [
        delivery({ delivery_id: "d1", units_delivered: 40 }),
        // same group — should merge
        delivery({ delivery_id: "d2", units_delivered: 60 }),
        // different seed_size — separate group
        delivery({ delivery_id: "d3", seed_size: "AF", units_delivered: 25 }),
        // different package_type — separate group
        delivery({ delivery_id: "d4", package_type: "tote", units_delivered: 5 }),
      ],
      [ret({ units_returned: 10 })],
      [replant({ units_replanted: 3 })]
    );

    // 3 distinct groups: (AR,bag), (AF,bag), (AR,tote)
    expect(rows).toHaveLength(3);

    const arBag = rows.find((r) => r.seed_size === "AR" && r.package_type === "bag");
    expect(arBag).toBeDefined();
    expect(arBag!.units_delivered).toBe(100); // 40 + 60
    expect(arBag!.units_returned).toBe(10);
    expect(arBag!.units_replanted).toBe(3);
    expect(arBag!.net_physical_units).toBe(93); // 100 + 3 - 10

    const afBag = rows.find((r) => r.seed_size === "AF");
    expect(afBag!.units_delivered).toBe(25);
    expect(afBag!.net_physical_units).toBe(25);

    const arTote = rows.find((r) => r.package_type === "tote");
    expect(arTote!.units_delivered).toBe(5);
    expect(arTote!.net_physical_units).toBe(5);
  });

  it("includes a group with only returns or only replants (no delivery)", () => {
    const rows = buildMovementSummary(
      [],
      [ret({ product_id: "p2", product_name: "Corn B", units_returned: 8 })],
      [replant({ product_id: "p3", product_name: "Corn C", units_replanted: 4 })]
    );
    expect(rows).toHaveLength(2);
    const cornB = rows.find((r) => r.product_name === "Corn B");
    expect(cornB!.net_physical_units).toBe(-8); // 0 + 0 - 8
    const cornC = rows.find((r) => r.product_name === "Corn C");
    expect(cornC!.net_physical_units).toBe(4); // 0 + 4 - 0
  });

  it("sorts by product_name, treatment_name, seed_size, package_type", () => {
    const rows = buildMovementSummary(
      [
        delivery({ delivery_id: "d1", product_name: "Soybean Z", seed_size: null, units_delivered: 1 }),
        delivery({ delivery_id: "d2", product_name: "Corn A", seed_size: "AR", units_delivered: 1 }),
        delivery({ delivery_id: "d3", product_name: "Corn A", seed_size: "AF", units_delivered: 1 }),
      ],
      [],
      []
    );
    expect(rows.map((r) => `${r.product_name}/${r.seed_size}`)).toEqual([
      "Corn A/AF",
      "Corn A/AR",
      "Soybean Z/null",
    ]);
  });

  it("returns an empty array when there is no activity", () => {
    expect(buildMovementSummary([], [], [])).toEqual([]);
  });
});
