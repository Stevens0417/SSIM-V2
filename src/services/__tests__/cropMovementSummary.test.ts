import { describe, it, expect } from "vitest";
import {
  computeCropMovementTotals,
  sortCropMovementRows,
  type CropMovementRow,
} from "../cropMovementSummary.service";

function row(o: Partial<CropMovementRow>): CropMovementRow {
  return {
    user_id: "u1",
    season_year: 2025,
    crop_group: "corn",
    customer_id: "c1",
    customer_name: "Acme Farms",
    farm_name: "North Field",
    package_type: "bag",
    units_delivered: 0,
    units_returned: 0,
    units_replanted: 0,
    net_units: 0,
    ...o,
  };
}

describe("computeCropMovementTotals", () => {
  it("sums delivered/returned/replanted and applies net = delivered + replanted - returned", () => {
    const rows = [
      row({ units_delivered: 100, units_returned: 10, units_replanted: 5 }),
      row({
        package_type: "tote",
        units_delivered: 50,
        units_returned: 0,
        units_replanted: 3,
      }),
    ];
    const t = computeCropMovementTotals(rows);
    expect(t.totalDelivered).toBe(150);
    expect(t.totalReturned).toBe(10);
    expect(t.totalReplanted).toBe(8);
    // 150 + 8 - 10
    expect(t.netUnits).toBe(148);
  });

  it("counts distinct customers and package types", () => {
    const rows = [
      row({ customer_id: "c1", package_type: "bag" }),
      row({ customer_id: "c1", package_type: "tote" }),
      row({ customer_id: "c2", package_type: "bag" }),
    ];
    const t = computeCropMovementTotals(rows);
    expect(t.customerCount).toBe(2);
    expect(t.packageCount).toBe(2);
  });

  it("returns zeroes for an empty set", () => {
    const t = computeCropMovementTotals([]);
    expect(t).toEqual({
      totalDelivered: 0,
      totalReturned: 0,
      totalReplanted: 0,
      netUnits: 0,
      customerCount: 0,
      packageCount: 0,
    });
  });

  it("handles return-only and replant-only rows", () => {
    const rows = [
      row({ units_returned: 7, net_units: -7 }),
      row({ package_type: "tote", units_replanted: 3, net_units: 3 }),
    ];
    const t = computeCropMovementTotals(rows);
    expect(t.totalReturned).toBe(7);
    expect(t.totalReplanted).toBe(3);
    // 0 + 3 - 7
    expect(t.netUnits).toBe(-4);
  });
});

describe("sortCropMovementRows", () => {
  it("sorts by customer, then package type", () => {
    const rows = [
      row({ customer_name: "Bravo", package_type: "bag" }),
      row({ customer_name: "Alpha", package_type: "tote" }),
      row({ customer_name: "Alpha", package_type: "bag" }),
    ];
    const sorted = sortCropMovementRows(rows);
    expect(sorted.map((r) => [r.customer_name, r.package_type])).toEqual([
      ["Alpha", "bag"],
      ["Alpha", "tote"],
      ["Bravo", "bag"],
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ customer_name: "B" }), row({ customer_name: "A" })];
    const copy = [...rows];
    sortCropMovementRows(rows);
    expect(rows).toEqual(copy);
  });
});
