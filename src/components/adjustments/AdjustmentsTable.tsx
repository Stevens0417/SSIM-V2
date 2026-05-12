"use client";

import { useState, useMemo, useCallback } from "react";
import type { AdjustmentRow } from "@/services/adjustments.service";
import { upsertAdjustmentCheck } from "@/services/adjustments.service";
import SearchableSelect from "@/components/orders/SearchableSelect";
import styles from "./AdjustmentsTable.module.css";

interface Props {
  rows: AdjustmentRow[];
  loading: boolean;
  error: string | null;
  onRowsChange: (rows: AdjustmentRow[]) => void;
}

type EarlyPayFilter = "ALL" | "EARLY_PAY" | "NO_EARLY_PAY" | "UNKNOWN";

function rowKey(r: AdjustmentRow): string {
  return `${r.season_year}-${r.customer_id}-${r.product_id}-${r.treatment_id}-${r.early_pay_bucket}`;
}

export default function AdjustmentsTable({
  rows,
  loading,
  error,
  onRowsChange,
}: Props) {
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [earlyPayFilter, setEarlyPayFilter] = useState<EarlyPayFilter>("ALL");
  const [needsAdjustmentOnly, setNeedsAdjustmentOnly] = useState(false);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

  const customerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.customer_id)) {
        seen.set(r.customer_id, r.customer_name);
      }
    }
    return Array.from(seen, ([value, label]) => ({ value, label })).sort(
      (a, b) => a.label.localeCompare(b.label)
    );
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows;

    if (selectedCustomerId) {
      result = result.filter((r) => r.customer_id === selectedCustomerId);
    }

    if (earlyPayFilter !== "ALL") {
      result = result.filter((r) => r.early_pay_bucket === earlyPayFilter);
    }

    if (needsAdjustmentOnly) {
      result = result.filter((r) => r.net_units !== 0);
    }

    if (incompleteOnly) {
      result = result.filter((r) => !r.is_completed);
    }

    return result;
  }, [rows, selectedCustomerId, earlyPayFilter, needsAdjustmentOnly, incompleteOnly]);

  const handleToggle = useCallback(
    async (row: AdjustmentRow) => {
      const key = rowKey(row);
      const newValue = !row.is_completed;

      // Optimistic update
      const updatedRows = rows.map((r) =>
        rowKey(r) === key
          ? {
              ...r,
              is_completed: newValue,
              completed_at: newValue ? new Date().toISOString() : null,
            }
          : r
      );
      onRowsChange(updatedRows);
      setSaveError(null);
      setSavingKeys((prev) => new Set(prev).add(key));

      try {
        await upsertAdjustmentCheck(
          {
            season_year: row.season_year,
            customer_id: row.customer_id,
            product_id: row.product_id,
            treatment_id: row.treatment_id,
            early_pay_bucket: row.early_pay_bucket,
          },
          newValue
        );
      } catch (err) {
        // Revert on failure
        onRowsChange(rows);
        setSaveError(
          err instanceof Error ? err.message : "Failed to save check"
        );
      } finally {
        setSavingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [rows, onRowsChange]
  );

  if (loading) return <div className={styles.status}>Loading adjustments…</div>;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <div>
      {saveError && <div className={styles.error}>{saveError}</div>}

      {/* ---- Filter Bar ---- */}
      <div className={styles.filterBar}>
        <div className={styles.customerFilter}>
          <SearchableSelect
            options={customerOptions}
            value={selectedCustomerId}
            onChange={setSelectedCustomerId}
            placeholder="Filter by Customer"
          />
          {selectedCustomerId && (
            <button
              className={styles.clearSearchBtn}
              onClick={() => setSelectedCustomerId("")}
            >
              ×
            </button>
          )}
        </div>

        <select
          className={styles.filterSelect}
          value={earlyPayFilter}
          onChange={(e) => setEarlyPayFilter(e.target.value as EarlyPayFilter)}
        >
          <option value="ALL">All Buckets</option>
          <option value="EARLY_PAY">Early Pay</option>
          <option value="NO_EARLY_PAY">No Early Pay</option>
          <option value="UNKNOWN">Unknown</option>
        </select>

        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={needsAdjustmentOnly}
            onChange={(e) => setNeedsAdjustmentOnly(e.target.checked)}
          />
          <span>Needs Adjustment Only</span>
        </label>

        <label className={styles.toggleLabel}>
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(e) => setIncompleteOnly(e.target.checked)}
          />
          <span>Incomplete Only</span>
        </label>

        <span className={styles.resultCount}>
          {filtered.length} of {rows.length} rows
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.status}>
          {rows.length === 0
            ? "No adjustment rows found."
            : "No matching rows."}
        </div>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Product</th>
                <th>Treatment</th>
                <th>Early Pay Bucket</th>
                <th className={styles.right}>Units Ordered</th>
                <th className={styles.right}>Units Delivered</th>
                <th className={styles.right}>Units Returned</th>
                <th className={styles.right}>Net Units</th>
                <th className={styles.center}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const key = rowKey(r);
                const isSaving = savingKeys.has(key);
                return (
                  <tr key={`${key}-${i}`}>
                    <td>{r.customer_name}</td>
                    <td>{r.product_name}</td>
                    <td>{r.treatment_name}</td>
                    <td className={styles.bucket}>
                      {r.early_pay_bucket === "EARLY_PAY"
                        ? `Early Pay (${r.early_pay_pct ?? 0}%)`
                        : r.early_pay_bucket === "NO_EARLY_PAY"
                          ? "No Early Pay"
                          : r.early_pay_bucket}
                    </td>
                    <td className={styles.mono}>{r.units_ordered}</td>
                    <td className={styles.mono}>{r.units_delivered}</td>
                    <td className={styles.mono}>{r.units_returned}</td>
                    <td
                      className={`${styles.mono} ${r.net_units !== 0 ? styles.netHighlight : ""}`}
                    >
                      {r.net_units}
                    </td>
                    <td className={styles.center}>
                      <input
                        type="checkbox"
                        className={styles.completedCheck}
                        checked={r.is_completed}
                        disabled={isSaving}
                        onChange={() => handleToggle(r)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
