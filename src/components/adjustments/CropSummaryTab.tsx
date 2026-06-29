"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  fetchCropMovementSummary,
  computeCropMovementTotals,
  type CropGroup,
  type CropMovementRow,
} from "@/services/cropMovementSummary.service";
import { fmtPackageType } from "@/lib/fmt";
import styles from "./CropSummaryTab.module.css";

interface Props {
  seasons: number[];
  cropGroup: CropGroup;
}

const EMPTY_MESSAGE: Record<CropGroup, string> = {
  corn: "No corn movement found for this season.",
  beans: "No bean movement found for this season.",
};

export default function CropSummaryTab({ seasons, cropGroup }: Props) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(
    seasons.length > 0 ? seasons[0] : null
  );
  const [rows, setRows] = useState<CropMovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Keep selectedSeason in sync when seasons prop arrives
  useEffect(() => {
    if (seasons.length > 0 && selectedSeason === null) {
      setSelectedSeason(seasons[0]);
    }
  }, [seasons, selectedSeason]);

  const loadData = useCallback(
    async (season: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchCropMovementSummary(season, cropGroup);
        setRows(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load summary"
        );
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [cropGroup]
  );

  useEffect(() => {
    if (selectedSeason !== null) {
      loadData(selectedSeason);
    }
  }, [selectedSeason, loadData]);

  // Search filter over customer / product / treatment.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.customer_name.toLowerCase().includes(q) ||
        (r.farm_name ?? "").toLowerCase().includes(q) ||
        r.product_name.toLowerCase().includes(q) ||
        r.treatment_name.toLowerCase().includes(q)
      );
    });
  }, [rows, search]);

  // Totals reflect the visible (filtered) rows.
  const totals = useMemo(
    () => computeCropMovementTotals(filteredRows),
    [filteredRows]
  );

  return (
    <div>
      {/* ---- Controls ---- */}
      <div className={styles.controlsBar}>
        <label className={styles.label}>Season</label>
        <select
          className={styles.select}
          value={selectedSeason ?? ""}
          onChange={(e) => setSelectedSeason(Number(e.target.value))}
        >
          {seasons.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search customer, product, treatment…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ---- Error ---- */}
      {error && <div className={styles.error}>{error}</div>}

      {/* ---- Totals ---- */}
      <div className={styles.kpiRow}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Total Units Delivered</div>
          <div className={styles.kpiValue}>{totals.totalDelivered}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Total Units Returned</div>
          <div className={styles.kpiValue}>{totals.totalReturned}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Total Units Replanted</div>
          <div className={styles.kpiValue}>{totals.totalReplanted}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Net Units</div>
          <div className={styles.kpiValueNet}>{totals.netUnits}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Customers</div>
          <div className={styles.kpiValue}>{totals.customerCount}</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Varieties</div>
          <div className={styles.kpiValue}>{totals.varietyCount}</div>
        </div>
      </div>

      {/* ---- Table / States ---- */}
      {loading ? (
        <div className={styles.loading}>Loading summary…</div>
      ) : filteredRows.length === 0 ? (
        <div className={styles.empty}>{EMPTY_MESSAGE[cropGroup]}</div>
      ) : (
        <div className={styles.wrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Farm Name</th>
                <th>Product / Variety</th>
                <th>Treatment</th>
                <th>Seed Size</th>
                <th>Package Type</th>
                <th className={styles.right}>Units Delivered</th>
                <th className={styles.right}>Units Returned</th>
                <th className={styles.right}>Units Replanted</th>
                <th className={styles.right}>Net Units</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr
                  key={`${r.customer_id}-${r.product_id}-${r.treatment_id}-${r.seed_size ?? ""}-${r.package_type}`}
                >
                  <td>{r.customer_name}</td>
                  <td>{r.farm_name ?? "—"}</td>
                  <td>{r.product_name}</td>
                  <td>{r.treatment_name}</td>
                  <td>{r.seed_size ?? "—"}</td>
                  <td>{fmtPackageType(r.package_type)}</td>
                  <td className={styles.mono}>{r.units_delivered}</td>
                  <td className={styles.mono}>{r.units_returned}</td>
                  <td className={styles.mono}>{r.units_replanted}</td>
                  <td className={styles.mono}>{r.net_units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
