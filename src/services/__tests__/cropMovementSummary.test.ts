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
    crop: "corn",
    crop_group: "corn",
    customer_id: "c1",
    customer_name: "Acme Farms",
    farm_name: "North Field",
    product_id: "p1",
    product_name: "Corn A",
    treatment_id: "t1",
    treatment_name: "Untreated",
    seed_size: "AR",
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
        product_id: "p2",
        product_name: "Corn B",
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

  it("counts distinct customers and varieties", () => {
    const rows = [
      row({ customer_id: "c1", product_id: "p1" }),
      row({ customer_id: "c1", product_id: "p2" }),
      row({ customer_id: "c2", product_id: "p1" }),
    ];
    const t = computeCropMovementTotals(rows);
    expect(t.customerCount).toBe(2);
    expect(t.varietyCount).toBe(2);
  });

  it("returns zeroes for an empty set", () => {
    const t = computeCropMovementTotals([]);
    expect(t).toEqual({
      totalDelivered: 0,
      totalReturned: 0,
      totalReplanted: 0,
      netUnits: 0,
      customerCount: 0,
      varietyCount: 0,
    });
  });

  it("handles return-only and replant-only rows", () => {
    const rows = [
      row({ units_returned: 7, net_units: -7 }),
      row({ product_id: "p2", units_replanted: 3, net_units: 3 }),
    ];
    const t = computeCropMovementTotals(rows);
    expect(t.totalReturned).toBe(7);
    expect(t.totalReplanted).toBe(3);
    // 0 + 3 - 7
    expect(t.netUnits).toBe(-4);
  });
});

describe("sortCropMovementRows", () => {
  it("sorts by customer, then product, then treatment, then seed size", () => {
    const rows = [
      row({ customer_name: "Bravo", product_name: "Corn A" }),
      row({ customer_name: "Alpha", product_name: "Corn B" }),
      row({ customer_name: "Alpha", product_name: "Corn A", treatment_name: "Poncho" }),
      row({ customer_name: "Alpha", product_name: "Corn A", treatment_name: "Cruiser" }),
      row({ customer_name: "Alpha", product_name: "Corn A", treatment_name: "Cruiser", seed_size: "AF" }),
    ];
    const sorted = sortCropMovementRows(rows);
    expect(sorted.map((r) => [r.customer_name, r.product_name, r.treatment_name, r.seed_size])).toEqual([
      ["Alpha", "Corn A", "Cruiser", "AF"],
      ["Alpha", "Corn A", "Cruiser", "AR"],
      ["Alpha", "Corn A", "Poncho", "AR"],
      ["Alpha", "Corn B", "Untreated", "AR"],
      ["Bravo", "Corn A", "Untreated", "AR"],
    ]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ customer_name: "B" }), row({ customer_name: "A" })];
    const copy = [...rows];
    sortCropMovementRows(rows);
    expect(rows).toEqual(copy);
  });
});
