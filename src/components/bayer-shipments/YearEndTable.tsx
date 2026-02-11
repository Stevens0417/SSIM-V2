"use client";

import { useState } from "react";
import type { YearEndTotalRow } from "@/services/bayer-shipment.service";
import styles from "./YearEndTable.module.css";

interface Props {
  rows: YearEndTotalRow[];
  seasons: number[];
  selectedSeason: number | null;
  onSeasonChange: (season: number) => void;
  loading: boolean;
  error: string | null;
  onVerify: (productId: string, treatmentId: string, verified: boolean) => Promise<void>;
}

export default function YearEndTable({
  rows,
  seasons,
  selectedSeason,
  onSeasonChange,
  loading,
  error,
  onVerify,
}: Props) {
  const [pendingVerify, setPendingVerify] = useState<Set<string>>(new Set());
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const handleVerifyToggle = async (row: YearEndTotalRow) => {
    const key = `${row.product_id}::${row.treatment_id}`;
    const newValue = !row.is_verified;

    setPendingVerify((prev) => new Set(prev).add(key));
    setVerifyError(null);

    try {
      await onVerify(row.product_id, row.treatment_id, newValue);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      setVerifyError(
        `Failed to update verification for ${row.product_name}: ${detail}`
      );
    } finally {
      setPendingVerify((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  function fmtDate(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
  }

  return (
    <div>
      {/* ---- Season Selector ---- */}
      {seasons.length > 0 && (
        <div className={styles.seasonBar}>
          <label className={styles.seasonLabel}>Season</label>
          <select
            className={styles.seasonSelect}
            value={selectedSeason ?? ""}
            onChange={(e) => onSeasonChange(Number(e.target.value))}
          >
            {seasons.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className={styles.status}>Loading year-end totals…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.status}>No shipment data for this season.</div>
      ) : (
        <div className={styles.wrapper}>
          {verifyError && (
            <div className={styles.verifyError}>
              {verifyError}
              <button
                className={styles.dismissBtn}
                onClick={() => setVerifyError(null)}
              >
                ×
              </button>
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.center}>Verified</th>
                <th>Product</th>
                <th>Treatment</th>
                <th className={styles.right}>Net Units</th>
                <th>Verified At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.product_id}::${r.treatment_id}`;
                const isPending = pendingVerify.has(key);

                return (
                  <tr
                    key={key}
                    className={r.is_verified ? styles.verifiedRow : ""}
                  >
                    <td className={styles.center}>
                      <input
                        type="checkbox"
                        className={styles.verifyCheckbox}
                        checked={r.is_verified}
                        disabled={isPending}
                        onChange={() => handleVerifyToggle(r)}
                      />
                    </td>
                    <td>{r.product_name}</td>
                    <td>{r.treatment_name}</td>
                    <td className={styles.mono}>{r.net_units}</td>
                    <td>
                      {r.verified_at ? (
                        <span className={styles.verifiedAt}>
                          {fmtDate(r.verified_at)}
                        </span>
                      ) : null}
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
