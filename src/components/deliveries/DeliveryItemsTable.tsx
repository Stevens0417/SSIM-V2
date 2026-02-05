"use client";

import { useMemo } from "react";
import type { PricingOption } from "@/services/pricing.service";
import SearchableSelect, { type SelectOption } from "../orders/SearchableSelect";
import styles from "./DeliveryItemsTable.module.css";

export interface DeliveryItem {
  id: string;
  productId: string;
  treatmentId: string;
  product: string;
  treatment: string;
  units: number;
}

export interface RowErrors {
  [rowId: string]: {
    product?: boolean;
    treatment?: boolean;
    units?: boolean;
  };
}

export function createEmptyDeliveryItem(): DeliveryItem {
  return {
    id: crypto.randomUUID(),
    productId: "",
    treatmentId: "",
    product: "",
    treatment: "",
    units: 0,
  };
}

function productSortRank(name: string): number {
  const upper = name.toUpperCase();
  if (upper.startsWith("DKC")) return 0;
  if (upper.startsWith("DKB")) return 1;
  return 2;
}

interface Props {
  items: DeliveryItem[];
  onChange: (items: DeliveryItem[]) => void;
  pricingOptions: PricingOption[];
  rowErrors?: RowErrors;
  disabled?: boolean;
}

export default function DeliveryItemsTable({
  items,
  onChange,
  pricingOptions,
  rowErrors = {},
  disabled = false,
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

  const updateItem = (index: number, patch: Partial<DeliveryItem>) => {
    if (disabled) return;
    const next = items.map((it, i) => (i === index ? { ...it, ...patch } : it));
    onChange(next);
  };

  const handleProductChange = (index: number, productId: string) => {
    if (disabled) return;
    const opt = pricingOptions.find((o) => o.product_id === productId);
    const productName = opt?.product_name ?? "";

    // Auto-select treatment if only one
    const treatments = treatmentSelectByProduct.get(productId) ?? [];
    let treatmentId = "";
    let treatmentName = "";
    if (treatments.length === 1) {
      treatmentId = treatments[0].value;
      treatmentName = treatments[0].label;
    }

    updateItem(index, {
      productId,
      product: productName,
      treatmentId,
      treatment: treatmentName,
    });
  };

  const handleTreatmentChange = (index: number, treatmentId: string) => {
    if (disabled) return;
    const opt = pricingOptions.find((o) => o.treatment_id === treatmentId);
    updateItem(index, {
      treatmentId,
      treatment: opt?.treatment_name ?? "",
    });
  };

  const addRow = () => {
    if (disabled) return;
    onChange([...items, createEmptyDeliveryItem()]);
  };

  const removeRow = (index: number) => {
    if (disabled) return;
    if (items.length <= 1) {
      onChange([createEmptyDeliveryItem()]);
      return;
    }
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <>
      {/* ---- Desktop: table layout ---- */}
      <div className={styles.wrapper}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: "38%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Product</th>
              <th className={styles.colTreatment}>Treatment</th>
              <th className={styles.colNum}>Units Delivered</th>
              <th className={styles.colAction}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const treatmentOptions =
                treatmentSelectByProduct.get(item.productId) ?? [];
              const errors = rowErrors[item.id] ?? {};
              return (
                <tr key={item.id}>
                  <td>
                    <div className={errors.product ? styles.errorWrap : ""}>
                      <SearchableSelect
                        options={productSelectOptions}
                        value={item.productId}
                        onChange={(v) => handleProductChange(i, v)}
                        placeholder="Select product…"
                        disabled={disabled}
                      />
                    </div>
                  </td>
                  <td>
                    <div className={errors.treatment ? styles.errorWrap : ""}>
                      <SearchableSelect
                        options={treatmentOptions}
                        value={item.treatmentId}
                        onChange={(v) => handleTreatmentChange(i, v)}
                        placeholder="Select treatment…"
                        disabled={disabled || !item.productId}
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      className={`${styles.numInput} ${errors.units ? styles.inputError : ""}`}
                      type="number"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min={0}
                      value={item.units || ""}
                      placeholder="0"
                      disabled={disabled}
                      onChange={(e) =>
                        updateItem(i, {
                          units: Math.max(0, parseInt(e.target.value) || 0),
                        })
                      }
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeRow(i)}
                      title="Remove row"
                      disabled={disabled}
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

      {/* ---- Mobile: card layout ---- */}
      <div className={styles.cardList}>
        {items.map((item, i) => {
          const treatmentOptions =
            treatmentSelectByProduct.get(item.productId) ?? [];
          const errors = rowErrors[item.id] ?? {};
          return (
            <div key={item.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardIndex}>Item {i + 1}</span>
                <button
                  className={styles.cardRemoveBtn}
                  onClick={() => removeRow(i)}
                  title="Remove row"
                  disabled={disabled}
                >
                  ×
                </button>
              </div>
              <div className={styles.cardField}>
                <label className={styles.cardLabel}>Product</label>
                <div className={errors.product ? styles.errorWrap : ""}>
                  <SearchableSelect
                    options={productSelectOptions}
                    value={item.productId}
                    onChange={(v) => handleProductChange(i, v)}
                    placeholder="Select product…"
                    disabled={disabled}
                  />
                </div>
                {errors.product && (
                  <span className={styles.errorText}>Select a product</span>
                )}
              </div>
              <div className={styles.cardField}>
                <label className={styles.cardLabel}>Treatment</label>
                <div className={errors.treatment ? styles.errorWrap : ""}>
                  <SearchableSelect
                    options={treatmentOptions}
                    value={item.treatmentId}
                    onChange={(v) => handleTreatmentChange(i, v)}
                    placeholder="Select treatment…"
                    disabled={disabled || !item.productId}
                  />
                </div>
                {errors.treatment && (
                  <span className={styles.errorText}>Select a treatment</span>
                )}
              </div>
              <div className={styles.cardField}>
                <label className={styles.cardLabel}>Units Delivered</label>
                <input
                  className={`${styles.cardNumInput} ${errors.units ? styles.inputError : ""}`}
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={0}
                  value={item.units || ""}
                  placeholder="Units delivered"
                  disabled={disabled}
                  onChange={(e) =>
                    updateItem(i, {
                      units: Math.max(0, parseInt(e.target.value) || 0),
                    })
                  }
                />
                {errors.units && (
                  <span className={styles.errorText}>Enter units &gt; 0</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button className={styles.addBtn} onClick={addRow} disabled={disabled}>
        + Add Row
      </button>
    </>
  );
}
