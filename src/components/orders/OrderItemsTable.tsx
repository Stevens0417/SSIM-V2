"use client";

import { useMemo } from "react";
import type { PricingOption } from "@/services/pricing.service";
import SearchableSelect, { type SelectOption } from "./SearchableSelect";
import styles from "./OrderItemsTable.module.css";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface OrderItem {
  id: string;
  productId: string;
  treatmentId: string;
  product: string;
  treatment: string;
  packageType: "bag" | "tote";
  seedSize: string;
  units: number;
  toteBulkDiscountPerUnit: number;
  retailPricePerUnit: number;
  breakEvenPricePerUnit: number;
  // Computed
  lineSubtotalBeforeDiscounts: number;
  brandGrowerDiscountAmount: number;
  toteBulkDiscountAmount: number;
  lineTotalAfterDiscountsBeforeEarlyPay: number;
  earlyPayDiscountAmount: number;
  lineTotalAfterAllDiscounts: number;
  netPricePerUnit: number;
  profitPerUnit: number;
  totalProfit: number;
}

export function createEmptyItem(): OrderItem {
  return {
    id: crypto.randomUUID(),
    productId: "",
    treatmentId: "",
    product: "",
    treatment: "",
    packageType: "bag",
    seedSize: "",
    units: 0,
    toteBulkDiscountPerUnit: 0,
    retailPricePerUnit: 0,
    breakEvenPricePerUnit: 0,
    lineSubtotalBeforeDiscounts: 0,
    brandGrowerDiscountAmount: 0,
    toteBulkDiscountAmount: 0,
    lineTotalAfterDiscountsBeforeEarlyPay: 0,
    earlyPayDiscountAmount: 0,
    lineTotalAfterAllDiscounts: 0,
    netPricePerUnit: 0,
    profitPerUnit: 0,
    totalProfit: 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Recalculation helpers (exported for use by parent)                 */
/* ------------------------------------------------------------------ */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function recalcLine(
  item: OrderItem,
  brandGrowerPct: number,
  earlyPayPct: number
): OrderItem {
  const lineSubtotalBeforeDiscounts = round2(
    item.units * item.retailPricePerUnit
  );
  const brandGrowerDiscountAmount = round2(
    lineSubtotalBeforeDiscounts * (brandGrowerPct / 100)
  );
  const toteBulkDiscountAmount = round2(
    item.units * item.toteBulkDiscountPerUnit
  );
  const lineTotalAfterDiscountsBeforeEarlyPay = round2(
    lineSubtotalBeforeDiscounts -
      brandGrowerDiscountAmount -
      toteBulkDiscountAmount
  );
  const earlyPayDiscountAmount = round2(
    lineTotalAfterDiscountsBeforeEarlyPay * (earlyPayPct / 100)
  );
  const lineTotalAfterAllDiscounts = round2(
    lineTotalAfterDiscountsBeforeEarlyPay - earlyPayDiscountAmount
  );
  const netPricePerUnit =
    item.units > 0
      ? round2(lineTotalAfterAllDiscounts / item.units)
      : 0;
  const profitPerUnit =
    item.units > 0
      ? round2(
          lineTotalAfterDiscountsBeforeEarlyPay / item.units -
            item.breakEvenPricePerUnit
        )
      : 0;
  const totalProfit = round2(item.units * profitPerUnit);

  return {
    ...item,
    lineSubtotalBeforeDiscounts,
    brandGrowerDiscountAmount,
    toteBulkDiscountAmount,
    lineTotalAfterDiscountsBeforeEarlyPay,
    earlyPayDiscountAmount,
    lineTotalAfterAllDiscounts,
    netPricePerUnit,
    profitPerUnit,
    totalProfit,
  };
}

export function recalcAllItems(
  items: OrderItem[],
  brandGrowerPct: number,
  earlyPayPct: number
): OrderItem[] {
  return items.map((item) => recalcLine(item, brandGrowerPct, earlyPayPct));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmt(n: number): string {
  return n.toFixed(2);
}

function productSortRank(name: string): number {
  const upper = name.toUpperCase();
  if (upper.startsWith("DKC")) return 0;
  if (upper.startsWith("DKB")) return 1;
  return 2;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
  pricingOptions: PricingOption[];
}

export default function OrderItemsTable({
  items,
  onChange,
  pricingOptions,
}: Props) {
  const productSelectOptions = useMemo<SelectOption[]>(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const o of pricingOptions) {
      if (!seen.has(o.product_id)) {
        seen.set(o.product_id, { id: o.product_id, name: o.product_name });
      }
    }
    return Array.from(seen.values())
      .sort((a, b) => {
        const ra = productSortRank(a.name);
        const rb = productSortRank(b.name);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      })
      .map((p) => ({ value: p.id, label: p.name }));
  }, [pricingOptions]);

  const treatmentSelectByProduct = useMemo(() => {
    const map = new Map<string, SelectOption[]>();
    for (const o of pricingOptions) {
      if (!map.has(o.product_id)) map.set(o.product_id, []);
      const arr = map.get(o.product_id)!;
      if (!arr.some((t) => t.value === o.treatment_id)) {
        arr.push({ value: o.treatment_id, label: o.treatment_name });
      }
    }
    return map;
  }, [pricingOptions]);

  const pricingLookup = useMemo(() => {
    const map = new Map<string, PricingOption>();
    for (const o of pricingOptions) {
      map.set(`${o.product_id}|${o.treatment_id}`, o);
    }
    return map;
  }, [pricingOptions]);

  const cropByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of pricingOptions) {
      if (!map.has(o.product_id)) {
        map.set(o.product_id, o.crop.toLowerCase());
      }
    }
    return map;
  }, [pricingOptions]);

  // Raw patch — parent recalculates all computed fields
  const update = (idx: number, patch: Partial<OrderItem>) => {
    const next = items.map((item, i) =>
      i === idx ? { ...item, ...patch } : item
    );
    onChange(next);
  };

  const handleProductChange = (idx: number, productId: string) => {
    const opt = pricingOptions.find((o) => o.product_id === productId);
    const crop = cropByProduct.get(productId) ?? "";
    update(idx, {
      productId,
      product: opt?.product_name ?? "",
      treatmentId: "",
      treatment: "",
      retailPricePerUnit: 0,
      breakEvenPricePerUnit: 0,
      seedSize: crop === "corn" ? items[idx].seedSize : "",
    });
  };

  const handleTreatmentChange = (
    idx: number,
    treatmentId: string,
    productId: string
  ) => {
    const po = pricingLookup.get(`${productId}|${treatmentId}`);
    const tOpt = treatmentSelectByProduct
      .get(productId)
      ?.find((t) => t.value === treatmentId);
    update(idx, {
      treatmentId,
      treatment: tOpt?.label ?? "",
      retailPricePerUnit: po?.retail_price ?? 0,
      breakEvenPricePerUnit: po?.break_even_price ?? 0,
    });
  };

  const addRow = () => onChange([...items, createEmptyItem()]);

  const removeRow = (idx: number) => {
    if (items.length <= 1) return;
    onChange(items.filter((_, i) => i !== idx));
  };

  const disabled = pricingOptions.length === 0;

  return (
    <>
      <div className={styles.wrapper}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: 150 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 52 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 82 }} />
            <col style={{ width: 26 }} />
          </colgroup>
          <thead>
            <tr>
              <th className={styles.colProduct}>Product</th>
              <th className={styles.colTreatment}>Treatment</th>
              <th className={styles.colPkg}>Pkg</th>
              <th className={styles.colSize}>Size</th>
              <th className={styles.colNum}>Units</th>
              <th className={styles.colMoney}>Retail $/U</th>
              <th className={styles.colMoney}>Net $/U</th>
              <th className={styles.colMoney}>BE $/U</th>
              <th className={styles.colMoney}>Profit $/U</th>
              <th className={styles.colTotal}>Line Total</th>
              <th className={styles.colAction} />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const treatmentOpts =
                treatmentSelectByProduct.get(item.productId) ?? [];
              return (
                <tr key={item.id}>
                  <td>
                    <SearchableSelect
                      options={productSelectOptions}
                      value={item.productId}
                      onChange={(val) => handleProductChange(i, val)}
                      placeholder="Product…"
                      disabled={disabled}
                    />
                  </td>
                  <td>
                    <SearchableSelect
                      options={treatmentOpts}
                      value={item.treatmentId}
                      onChange={(val) =>
                        handleTreatmentChange(i, val, item.productId)
                      }
                      placeholder="Treatment…"
                      disabled={disabled || !item.productId}
                    />
                  </td>
                  <td>
                    <select
                      className={styles.pkgSelect}
                      value={item.packageType}
                      onChange={(e) =>
                        update(i, {
                          packageType: e.target.value as "bag" | "tote",
                        })
                      }
                    >
                      <option value="bag">Bag</option>
                      <option value="tote">Tote</option>
                    </select>
                  </td>
                  <td>
                    {cropByProduct.get(item.productId) === "corn" ? (
                      <select
                        className={styles.sizeSelect}
                        value={item.seedSize}
                        onChange={(e) =>
                          update(i, { seedSize: e.target.value })
                        }
                      >
                        <option value="">—</option>
                        <option value="AR">AR</option>
                        <option value="AR2">AR2</option>
                        <option value="AF">AF</option>
                        <option value="AF2">AF2</option>
                        <option value="P26">P26</option>
                      </select>
                    ) : (
                      <select
                        className={styles.sizeSelect}
                        disabled
                        value=""
                      >
                        <option value="">—</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <input
                      className={styles.numInput}
                      type="number"
                      min={0}
                      step={1}
                      value={item.units || ""}
                      placeholder="0"
                      onChange={(e) =>
                        update(i, {
                          units: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </td>
                  <td>
                    <span className={styles.moneyCell}>
                      ${fmt(item.retailPricePerUnit)}
                    </span>
                  </td>
                  <td>
                    <span className={styles.moneyCell}>
                      ${fmt(item.netPricePerUnit)}
                    </span>
                  </td>
                  <td>
                    <span className={styles.moneyCell}>
                      ${fmt(item.breakEvenPricePerUnit)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`${styles.moneyCell} ${
                        item.profitPerUnit > 0
                          ? styles.positive
                          : item.profitPerUnit < 0
                          ? styles.negative
                          : ""
                      }`}
                    >
                      ${fmt(item.profitPerUnit)}
                    </span>
                  </td>
                  <td>
                    <span className={styles.moneyCell}>
                      ${fmt(item.lineTotalAfterAllDiscounts)}
                    </span>
                  </td>
                  <td>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeRow(i)}
                      disabled={items.length <= 1}
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button className={styles.addBtn} onClick={addRow}>
        + Add Row
      </button>
    </>
  );
}
