"use client";

import type { InventoryWideRow } from "@/services/inventory.service";
import styles from "./InventoryWideTable.module.css";

interface Props {
  rows: InventoryWideRow[];
  loading: boolean;
  error: string | null;
}

const EXCLUDE_KEYS = new Set(["product_id", "product_name"]);

function formatCell(value: string | number | null): string {
  if (value == null) return "\u2014";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

export default function InventoryWideTable({ rows, loading, error }: Props) {
  if (loading) {
    return <p className={styles.message}>Loading inventory data…</p>;
  }

  if (error) {
    return <p className={styles.message}>{error}</p>;
  }

  if (rows.length === 0) {
    return <p className={styles.message}>No inventory data available.</p>;
  }

  const allKeys = Object.keys(rows[0]);
  const treatmentColumns = allKeys.filter((k) => !EXCLUDE_KEYS.has(k));

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.stickyHeader}>Product</th>
            {treatmentColumns.map((key) => (
              <th key={key} className={styles.header}>
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.product_id ?? i)} className={i % 2 === 0 ? styles.rowEven : undefined}>
              <td className={styles.stickyCell}>
                {String(row.product_name ?? "\u2014")}
              </td>
              {treatmentColumns.map((key) => (
                <td key={key} className={styles.cell}>
                  {formatCell(row[key] as string | number | null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
