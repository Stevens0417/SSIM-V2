"use client";

import styles from "./PricingTable.module.css";

interface PricingTableProps {
  rows: Record<string, string | number | null>[];
  loading: boolean;
}

/** Columns pinned on the left side of the table */
const STICKY_KEYS = ["product", "crop", "chu", "seed_trait"];

/** Sticky columns hidden on small screens */
const COLLAPSIBLE_KEYS = new Set(["chu", "seed_trait"]);

/** Keys excluded from data columns (metadata / sticky) */
const EXCLUDE_KEYS = new Set(["season_year", ...STICKY_KEYS]);

function formatHeader(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCell(value: string | number | null): string {
  if (value == null) return "—";
  if (typeof value === "number") {
    return value.toLocaleString("en-CA", {
      style: "currency",
      currency: "CAD",
      minimumFractionDigits: 2,
    });
  }
  return String(value);
}

export default function PricingTable({ rows, loading }: PricingTableProps) {
  if (loading) {
    return <p className={styles.message}>Loading pricing data…</p>;
  }

  if (rows.length === 0) {
    return <p className={styles.message}>No pricing data for this season.</p>;
  }

  // Derive treatment columns dynamically from the first row
  const allKeys = Object.keys(rows[0]);
  const stickyColumns = STICKY_KEYS.filter((k) => allKeys.includes(k));
  const treatmentColumns = allKeys.filter((k) => !EXCLUDE_KEYS.has(k));

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {stickyColumns.map((key) => (
              <th
                key={key}
                className={`${styles.stickyHeader} ${COLLAPSIBLE_KEYS.has(key) ? styles.collapsible : ""}`}
              >
                {formatHeader(key)}
              </th>
            ))}
            {treatmentColumns.map((key) => (
              <th key={key} className={styles.header}>
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? styles.rowEven : undefined}>
              {stickyColumns.map((key) => (
                <td
                  key={key}
                  className={`${styles.stickyCell} ${COLLAPSIBLE_KEYS.has(key) ? styles.collapsible : ""}`}
                >
                  {String(row[key] ?? "—")}
                </td>
              ))}
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
