import { describe, it, expect } from "vitest";
import {
  recalcLine,
  recalcAllItems,
  createEmptyItem,
  type OrderItem,
} from "../OrderItemsTable";

function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return { ...createEmptyItem(), ...overrides };
}

describe("recalcLine", () => {
  it("computes a standard line with brand grower + early pay", () => {
    const item = makeItem({
      units: 10,
      retailPricePerUnit: 100,
      breakEvenPricePerUnit: 80,
      toteBulkDiscountPerUnit: 0,
    });
    const result = recalcLine(item, 5, 3);

    expect(result.lineSubtotalBeforeDiscounts).toBe(1000); // 10 * 100
    expect(result.brandGrowerDiscountAmount).toBe(50); // 1000 * 5%
    expect(result.toteBulkDiscountAmount).toBe(0);
    expect(result.lineTotalAfterDiscountsBeforeEarlyPay).toBe(950); // 1000 - 50
    expect(result.earlyPayDiscountAmount).toBe(28.5); // 950 * 3%
    expect(result.lineTotalAfterAllDiscounts).toBe(921.5); // 950 - 28.5
    expect(result.netPricePerUnit).toBe(92.15); // 921.5 / 10
    // profit uses pre-early-pay: 950/10 - 80 = 15
    expect(result.profitPerUnit).toBe(15);
    expect(result.totalProfit).toBe(150); // 10 * 15
  });

  it("early pay at 0% produces zero early-pay discount", () => {
    const item = makeItem({
      units: 5,
      retailPricePerUnit: 200,
      breakEvenPricePerUnit: 150,
    });
    const result = recalcLine(item, 0, 0);

    expect(result.earlyPayDiscountAmount).toBe(0);
    expect(result.lineTotalAfterAllDiscounts).toBe(1000);
  });

  it("early pay at 2.5% works with decimals", () => {
    const item = makeItem({
      units: 4,
      retailPricePerUnit: 100,
      breakEvenPricePerUnit: 80,
    });
    const result = recalcLine(item, 0, 2.5);

    expect(result.lineSubtotalBeforeDiscounts).toBe(400);
    expect(result.earlyPayDiscountAmount).toBe(10); // 400 * 2.5%
    expect(result.lineTotalAfterAllDiscounts).toBe(390);
  });

  it("handles NaN earlyPayPct as 0", () => {
    const item = makeItem({
      units: 2,
      retailPricePerUnit: 50,
      breakEvenPricePerUnit: 40,
    });
    const result = recalcLine(item, 0, NaN);

    expect(result.earlyPayDiscountAmount).toBe(0);
    expect(result.lineTotalAfterAllDiscounts).toBe(100);
  });

  it("handles NaN brandGrowerPct as 0", () => {
    const item = makeItem({
      units: 2,
      retailPricePerUnit: 50,
      breakEvenPricePerUnit: 40,
    });
    const result = recalcLine(item, NaN, 5);

    expect(result.brandGrowerDiscountAmount).toBe(0);
    expect(result.earlyPayDiscountAmount).toBe(5); // 100 * 5%
  });

  it("clamps negative pct to 0", () => {
    const item = makeItem({
      units: 1,
      retailPricePerUnit: 100,
      breakEvenPricePerUnit: 80,
    });
    const result = recalcLine(item, -10, -5);

    expect(result.brandGrowerDiscountAmount).toBe(0);
    expect(result.earlyPayDiscountAmount).toBe(0);
  });

  it("clamps pct above 100 to 100", () => {
    const item = makeItem({
      units: 1,
      retailPricePerUnit: 100,
      breakEvenPricePerUnit: 80,
    });
    const result = recalcLine(item, 200, 0);

    // 100% brand grower = full subtotal as discount
    expect(result.brandGrowerDiscountAmount).toBe(100);
    expect(result.lineTotalAfterDiscountsBeforeEarlyPay).toBe(0);
  });

  it("handles zero units without division errors", () => {
    const item = makeItem({
      units: 0,
      retailPricePerUnit: 100,
      breakEvenPricePerUnit: 80,
    });
    const result = recalcLine(item, 5, 5);

    expect(result.netPricePerUnit).toBe(0);
    expect(result.profitPerUnit).toBe(0);
    expect(result.totalProfit).toBe(0);
  });

  it("includes tote/bulk discount in the flow", () => {
    const item = makeItem({
      units: 10,
      retailPricePerUnit: 100,
      breakEvenPricePerUnit: 80,
      toteBulkDiscountPerUnit: 5,
    });
    const result = recalcLine(item, 10, 5);

    expect(result.lineSubtotalBeforeDiscounts).toBe(1000);
    expect(result.brandGrowerDiscountAmount).toBe(100); // 1000 * 10%
    expect(result.toteBulkDiscountAmount).toBe(50); // 10 * 5
    expect(result.lineTotalAfterDiscountsBeforeEarlyPay).toBe(850); // 1000 - 100 - 50
    expect(result.earlyPayDiscountAmount).toBe(42.5); // 850 * 5%
    expect(result.lineTotalAfterAllDiscounts).toBe(807.5);
  });

  it("profit is NOT affected by early pay", () => {
    const item = makeItem({
      units: 10,
      retailPricePerUnit: 100,
      breakEvenPricePerUnit: 90,
    });
    const withEarlyPay = recalcLine(item, 0, 10);
    const withoutEarlyPay = recalcLine(item, 0, 0);

    // Profit should be identical — early pay doesn't affect it
    expect(withEarlyPay.profitPerUnit).toBe(withoutEarlyPay.profitPerUnit);
    expect(withEarlyPay.totalProfit).toBe(withoutEarlyPay.totalProfit);
  });
});

describe("recalcAllItems", () => {
  it("recalculates all items with consistent totals", () => {
    const items = [
      makeItem({ units: 5, retailPricePerUnit: 100, breakEvenPricePerUnit: 80 }),
      makeItem({ units: 3, retailPricePerUnit: 200, breakEvenPricePerUnit: 150 }),
    ];
    const result = recalcAllItems(items, 5, 3);

    // Verify each line was recalculated
    expect(result[0].lineSubtotalBeforeDiscounts).toBe(500);
    expect(result[1].lineSubtotalBeforeDiscounts).toBe(600);

    // Verify order-level totals sum correctly
    const totalAfterAll = result.reduce(
      (s, it) => s + it.lineTotalAfterAllDiscounts,
      0
    );
    const sumSubtotal = result.reduce(
      (s, it) => s + it.lineSubtotalBeforeDiscounts,
      0
    );
    const sumBG = result.reduce(
      (s, it) => s + it.brandGrowerDiscountAmount,
      0
    );
    const sumEP = result.reduce(
      (s, it) => s + it.earlyPayDiscountAmount,
      0
    );

    expect(sumSubtotal).toBe(1100);
    expect(sumBG).toBe(55); // 1100 * 5%
    // early pay on each line's post-discount subtotal
    expect(totalAfterAll).toBeCloseTo(sumSubtotal - sumBG - sumEP, 2);
  });
});
