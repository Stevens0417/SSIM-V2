"use client";

import { useState, useEffect, useCallback } from "react";
import {
  fetchAdjustments,
  type AdjustmentRow,
} from "@/services/adjustments.service";
import { fetchSeasons } from "@/services/pricing.service";
import AdjustmentsTable from "@/components/adjustments/AdjustmentsTable";
import CustomerReportTab from "@/components/adjustments/CustomerReportTab";
import styles from "./adjustments.module.css";

type ActiveTab = "yearEnd" | "customerReport";

export default function AdjustmentsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("yearEnd");
  const [seasons, setSeasons] = useState<number[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load available seasons on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchSeasons();
        if (cancelled) return;
        setSeasons(s);
        if (s.length > 0) {
          setSelectedSeason(s[0]); // newest first
        } else {
          setLoading(false);
          setError("No seasons found.");
        }
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setError(err instanceof Error ? err.message : "Failed to load seasons");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load adjustments when season changes (year-end tab)
  const loadData = useCallback(async (season: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdjustments(season);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load adjustments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSeason !== null) {
      loadData(selectedSeason);
    }
  }, [selectedSeason, loadData]);

  const headerSubtitle =
    activeTab === "yearEnd"
      ? "Orders vs Deliveries vs Returns reconciliation"
      : "Per-customer detailed adjustment report";

  return (
    <div>
      {/* ---- Header Band ---- */}
      <div className={styles.headerBand} data-adjustments-header>
        <div className={styles.headerText}>
          <div className={styles.headerTitle}>Adjustments</div>
          <div className={styles.headerSub}>{headerSubtitle}</div>
        </div>
      </div>

      {/* ---- Tab Navigation ---- */}
      <div className={styles.tabNav} data-adjustments-tabnav>
        <button
          className={`${styles.tabBtn} ${activeTab === "yearEnd" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("yearEnd")}
        >
          Year-End Adjustments
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === "customerReport" ? styles.tabBtnActive : ""}`}
          onClick={() => setActiveTab("customerReport")}
        >
          Customer Report
        </button>
      </div>

      {/* ---- Year-End Adjustments Tab ---- */}
      {activeTab === "yearEnd" && (
        <>
          {seasons.length > 0 && (
            <div className={styles.seasonBar} data-adjustments-seasonbar>
              <label className={styles.seasonLabel}>Season</label>
              <select
                className={styles.seasonSelect}
                value={selectedSeason ?? ""}
                onChange={(e) => setSelectedSeason(Number(e.target.value))}
              >
                {seasons.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
          <AdjustmentsTable
            rows={rows}
            loading={loading}
            error={error}
            onRowsChange={setRows}
          />
        </>
      )}

      {/* ---- Customer Report Tab ---- */}
      {activeTab === "customerReport" && (
        <CustomerReportTab seasons={seasons} />
      )}
    </div>
  );
}
