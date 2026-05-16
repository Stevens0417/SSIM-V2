"use client";

import { useMemo } from "react";
import type { PricingOption } from "@/services/pricing.service";
import type { PackagingProduct } from "@/services/bayer-shipment.service";
import SearchableSelect, { type SelectOption } from "../orders/SearchableSelect";
import styles from "./ShipmentItemsTable.module.css";

export interface ShipmentItem {
  id: string;
  productId: string;
  treatmentId: string;
  product: string;
  treatment: string;
  units: number;
  seedSize: string;
  packageType: "bag" | "tote";
}

export interface RowErrors {
  [rowId: string]: {
    product?: boolean;
    treatment?: boolean;
    units?: boolean;
    seedSize?: boolean;
  };
}

export function createEmptyShipmentItem(): ShipmentItem {
  return {
    id: crypto.randomUUID(),
    productId: "",
    treatmentId: "",
    product: "",
    treatment: "",
    units: 0,
    seedSize: "",
    packageType: "bag",
  };
}

function productSortRank(name: string): number {
  const upper = name.toUpperCase();
  if (upper.startsWith("DKC")) return 0;
  if (upper.startsWith("DKB")) return 1;
  if (upper === "PALLET" || upper === "SEEDPAK") return 3;
  return 2;
}

interface Props {
  items: ShipmentItem[];
  onChange: (items: ShipmentItem[]) => void;
  pricingOptions: PricingOption[];
  packagingProducts: PackagingProduct[];
  noTreatmentId: string | null;
  rowErrors?: RowErrors;
  disabled?: boolean;
}

export default function ShipmentItemsTable({
  items,
  onChange,
  pricingOptions,
  packagingProducts,
  noTreatmentId,
  rowErrors = {},
  disabled = false,
}: Props) {
  const cropByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of pricingOptions) {
      if (!map.has(o.product_id)) {
        map.set(o.product_id, o.crop.toLowerCase());
      }
    }
    return map;
  }, [pricingOptions]);

  // Set of packaging product IDs for fast lookup
  const packagingIds = useMemo(
    () => new Set(packagingProducts.map((p) => p.id)),
    [packagingProducts]
  );

  const productSelectOptions = useMemo<SelectOption[]>(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const o of pricingOptions) {
      if (!seen.has(o.product_id)) {
        seen.set(o.product_id, { id: o.product_id, name: o.product_name });
      }
    }
    // Merge packaging products (not in pricing table)
    for (const p of packagingProducts) {
      if (!seen.has(p.id)) {
        seen.set(p.id, { id: p.id, name: p.product_name });
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
  }, [pricingOptions, packagingProducts]);

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

  // NO_TREATMENT name constant for display (id comes from prop)
  const NO_TREATMENT_NAME = "NO_TREATMENT";

  const updateItem = (index: number, patch: Partial<ShipmentItem>) => {
    if (disabled) return;
    const next = items.map((it, i) => (i === index ? { ...it, ...patch } : it));
    onChange(next);
  };

  const handleProductChange = (index: number, productId: string) => {
    if (disabled) return;

    // Look up product name from pricing options OR packaging products
    let productName = "";
    const pricingOpt = pricingOptions.find((o) => o.product_id === productId);
    if (pricingOpt) {
      productName = pricingOpt.product_name;
    } else {
      const pkgOpt = packagingProducts.find((p) => p.id === productId);
      if (pkgOpt) productName = pkgOpt.product_name;
    }

    let treatmentId = "";
    let treatmentName = "";

    if (packagingIds.has(productId) && noTreatmentId) {
      // Packaging product → auto-assign NO_TREATMENT
      treatmentId = noTreatmentId;
      treatmentName = NO_TREATMENT_NAME;
    } else {
      // Normal seed product — auto-select if only one treatment
      const treatments = treatmentSelectByProduct.get(productId) ?? [];
      if (treatments.length === 1) {
        treatmentId = treatments[0].value;
        treatmentName = treatments[0].label;
      }
    }

    const crop = cropByProduct.get(productId) ?? "";
    updateItem(index, {
      productId,
      product: productName,
      treatmentId,
      treatment: treatmentName,
      seedSize: crop === "corn" ? items[index].seedSize : "",
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
    onChange([...items, createEmptyShipmentItem()]);
  };

  const removeRow = (index: number) => {
    if (disabled) return;
    if (items.length <= 1) {
      onChange([createEmptyShipmentItem()]);
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
            <col style={{ width: "28%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Product</th>
              <th className={styles.colTreatment}>Treatment</th>
              <th className={styles.colNum}>Units</th>
              <th className={styles.colTreatment}>Size</th>
              <th className={styles.colTreatment}>Pkg</th>
              <th className={styles.colAction}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const treatmentOptions =
                treatmentSelectByProduct.get(item.productId) ?? [];
              const errors = rowErrors[item.id] ?? {};
              const noTreat = packagingIds.has(item.productId);
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
                    {noTreat ? (
                      <span className={styles.naText}>N/A</span>
                    ) : (
                      <div className={errors.treatment ? styles.errorWrap : ""}>
                        <SearchableSelect
                          options={treatmentOptions}
                          value={item.treatmentId}
                          onChange={(v) => handleTreatmentChange(i, v)}
                          placeholder="Select treatment…"
                          disabled={disabled || !item.productId}
                        />
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      className={`${styles.numInput} ${errors.units ? styles.inputError : ""}`}
                      type="number"
                      step={1}
                      value={item.units || ""}
                      placeholder="0"
                      disabled={disabled}
                      onChange={(e) =>
                        updateItem(i, {
                          units: parseInt(e.target.value) || 0,
                        })
                      }
                    />
                  </td>
                  <td>
                    {cropByProduct.get(item.productId) === "corn" ? (
                      <select
                        className={`${styles.sizeSelect} ${errors.seedSize ? styles.inputError : ""}`}
                        value={item.seedSize}
                        disabled={disabled}
                        onChange={(e) => updateItem(i, { seedSize: e.target.value })}
                      >
                        <option value="">—</option>
                        <option value="AR">AR</option>
                        <option value="AR2">AR2</option>
                        <option value="AF">AF</option>
                        <option value="AF2">AF2</option>
                        <option value="P26">P26</option>
                      </select>
                    ) : (
                      <select className={styles.sizeSelect} disabled value=""><option value="">—</option></select>
                    )}
                  </td>
                  <td>
                    <select
                      className={styles.sizeSelect}
                      value={item.packageType}
                      disabled={disabled}
                      onChange={(e) => updateItem(i, { packageType: e.target.value as "bag" | "tote" })}
                    >
                      <option value="bag">Bag</option>
                      <option value="tote">Seedpak</option>
                    </select>
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
          const noTreat = packagingIds.has(item.productId);
          const isCornMobile = cropByProduct.get(item.productId) === "corn";
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
              {noTreat ? null : (
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
              )}
              <div className={styles.cardField}>
                <label className={styles.cardLabel}>Units</label>
                <input
                  className={`${styles.cardNumInput} ${errors.units ? styles.inputError : ""}`}
                  type="number"
                  step={1}
                  value={item.units || ""}
                  placeholder="Units"
                  disabled={disabled}
                  onChange={(e) =>
                    updateItem(i, {
                      units: parseInt(e.target.value) || 0,
                    })
                  }
                />
                {errors.units && (
                  <span className={styles.errorText}>Enter a non-zero integer</span>
                )}
              </div>
              {isCornMobile && (
                <div className={styles.cardField}>
                  <label className={styles.cardLabel}>Seed Size</label>
                  <select
                    className={`${styles.cardSizeSelect} ${errors.seedSize ? styles.inputError : ""}`}
                    value={item.seedSize}
                    disabled={disabled}
                    onChange={(e) => updateItem(i, { seedSize: e.target.value })}
                  >
                    <option value="">—</option>
                    <option value="AR">AR</option>
                    <option value="AR2">AR2</option>
                    <option value="AF">AF</option>
                    <option value="AF2">AF2</option>
                    <option value="P26">P26</option>
                  </select>
                  {errors.seedSize && (
                    <span className={styles.errorText}>Seed size required for corn</span>
                  )}
                </div>
              )}
              <div className={styles.cardField}>
                <label className={styles.cardLabel}>Package Type</label>
                <select
                  className={styles.cardSizeSelect}
                  value={item.packageType}
                  disabled={disabled}
                  onChange={(e) => updateItem(i, { packageType: e.target.value as "bag" | "tote" })}
                >
                  <option value="bag">Bag</option>
                  <option value="tote">Seedpak</option>
                </select>
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
