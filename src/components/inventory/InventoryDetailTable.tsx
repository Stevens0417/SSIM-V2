"use client";

import { useState, useMemo, useEffect } from "react";
import type { InventoryDetailRow } from "@/services/inventory.service";
import { fmtPackageType } from "@/lib/fmt";
import styles from "./InventoryDetailTable.module.css";

interface Props {
  rows: InventoryDetailRow[];
  loading: boolean;
  error: string | null;
  onFilteredChange?: (filtered: InventoryDetailRow[]) => void;
}

export default function InventoryDetailTable({ rows, loading, error, onFilteredChange }: Props) {
  const [search, setSearch] = useState("");
  const [treatmentFilter, setTreatmentFilter] = useState("");
  const [negativeOnly, setNegativeOnly] = useState(false);

  // Derive unique treatments for dropdown
  const treatments = useMemo(() => {
    const set = new Set(rows.map((r) => r.treatment_name));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows;

    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter((r) =>
        r.product_name.toLowerCase().includes(term)
      );
    }

    if (treatmentFilter) {
      result = result.filter((r) => r.treatment_name === treatmentFilter);
    }

    if (negativeOnly) {
      result = result.filter((r) => r.available_units < 0);
    }

    return result;
  }, [rows, search, treatmentFilter, negativeOnly]);

  useEffect(() => {
    onFilteredChange?.(filtered);
  }, [filtered, onFilteredChange]);

  if (loading) {
    return <div className={styles.status}>Loading inventory detail…</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  return (
    <div>
      {/* ---- Filters ---- */}
      <div className={styles.filterBar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search product…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={styles.treatmentSelect}
          value={treatmentFilter}
          onChange={(e) => setTreatmentFilter(e.target.value)}
        >
          <option value="">All Treatments</option>
          {treatments.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={negativeOnly}
            onChange={(e) => setNegativeOnly(e.target.checked)}
          />
          Negative available only
        </label>
      </div>

      {/* ---- Table ---- */}
      {filtered.length === 0 ? (
        <div className={styles.status}>
          {rows.length === 0
            ? "No inventory data available."
            : "No matching rows."}
        </div>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Treatment</th>
                <th className={styles.center}>Size</th>
                <th className={styles.center}>Pkg</th>
                <th className={styles.right}>Received</th>
                <th className={styles.right}>Delivered</th>
                <th className={styles.right}>Returned</th>
                <th className={styles.right}>Physical On Hand</th>
                <th className={styles.right}>Staged</th>
                <th className={styles.right}>Available</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.product_id}-${r.treatment_id}-${r.seed_size ?? ""}-${r.package_type ?? ""}`}>
                  <td>{r.product_name}</td>
                  <td>{r.treatment_name}</td>
                  <td className={styles.center}>{r.seed_size || "\u2014"}</td>
                  <td className={styles.center}>{fmtPackageType(r.package_type)}</td>
                  <td className={styles.mono}>{r.units_received}</td>
                  <td className={styles.mono}>{r.units_delivered}</td>
                  <td className={styles.mono}>{r.units_returned}</td>
                  <td className={styles.mono}>{r.units_on_hand}</td>
                  <td className={styles.mono}>{r.units_staged}</td>
                  <td
                    className={`${styles.mono} ${r.available_units < 0 ? styles.negative : ""}`}
                  >
                    {r.available_units}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
