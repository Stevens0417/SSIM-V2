"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  fetchDashboardSeasons,
  fetchDashboardKpis,
  fetchCropKpis,
  fetchTreatmentMix,
  fetchVolumeBuckets,
  type DashboardKpis,
  type CropKpis,
  type TreatmentMixRow,
  type VolumeBucketRow,
} from "@/services/dashboard.service";
import { fmtCurrency } from "@/lib/fmt";
import CropPieChart from "@/components/dashboard/CropPieChart";
import VolumeBucketBarChart from "@/components/dashboard/VolumeBucketBarChart";
import styles from "./dashboard.module.css";

export default function DashboardPage() {
  const [seasons, setSeasons] = useState<number[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [cropKpiRows, setCropKpiRows] = useState<CropKpis[]>([]);
  const [treatmentRows, setTreatmentRows] = useState<TreatmentMixRow[]>([]);
  const [bucketRows, setBucketRows] = useState<VolumeBucketRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cropFilter, setCropFilter] = useState("corn");

  // Load seasons on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchDashboardSeasons();
        if (cancelled) return;
        setSeasons(s);
        if (s.length > 0) {
          setSelectedSeason(s[0]);
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

  // Load dashboard data when season changes
  const loadData = useCallback(async (season: number) => {
    setLoading(true);
    setError(null);
    try {
      const [k, ck, t, b] = await Promise.all([
        fetchDashboardKpis(season),
        fetchCropKpis(season),
        fetchTreatmentMix(season),
        fetchVolumeBuckets(season),
      ]);
      setKpis(k);
      setCropKpiRows(ck);
      setTreatmentRows(t);
      setBucketRows(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSeason !== null) {
      loadData(selectedSeason);
    }
  }, [selectedSeason, loadData]);

  const cornKpis = cropKpiRows.find((r) => r.crop.toLowerCase() === "corn");
  const beanKpis = cropKpiRows.find((r) => r.crop.toLowerCase() === "soybean");

  const filteredBuckets = useMemo(
    () => bucketRows.filter((r) => r.crop.toLowerCase() === cropFilter),
    [bucketRows, cropFilter]
  );

  const filteredTreatments = useMemo(
    () => treatmentRows.filter((r) => r.crop.toLowerCase() === cropFilter),
    [treatmentRows, cropFilter]
  );

  return (
    <div>
      {/* ---- Header Band ---- */}
      <div className={styles.headerBand}>
        <div className={styles.headerText}>
          <div className={styles.headerTitle}>Dashboard</div>
          <div className={styles.headerSub}>
            Season overview &mdash; Sales, Profit &amp; Volume
          </div>
        </div>
      </div>

      {/* ---- Season Selector ---- */}
      {seasons.length > 0 && (
        <div className={styles.seasonBar}>
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

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.status}>Loading dashboard…</div>
      ) : (
        <>
          {/* ---- Top KPI Cards ---- */}
          {kpis && (
            <div className={styles.kpiRow}>
              <div className={styles.kpiCard}>
                <div className={styles.kpiValue}>{fmtCurrency(kpis.total_sales)}</div>
                <div className={styles.kpiLabel}>Total Sales</div>
              </div>
              <div className={styles.kpiCard}>
                <div className={styles.kpiValue}>{fmtCurrency(kpis.total_profit)}</div>
                <div className={styles.kpiLabel}>Total Profit</div>
              </div>
              <div className={styles.kpiCard}>
                <div className={styles.kpiValue}>{fmtCurrency(kpis.total_discounts_given)}</div>
                <div className={styles.kpiLabel}>Total Discounts Given</div>
              </div>
            </div>
          )}

          {!kpis && (
            <div className={styles.status}>No order data for this season.</div>
          )}

          {/* ---- Crop KPI Cards ---- */}
          {(cornKpis || beanKpis) && (
            <div className={styles.cropKpiRow}>
              {cornKpis && (
                <div className={styles.cropKpiGroup}>
                  <div className={styles.cropKpiTitle}>Corn</div>
                  <div className={styles.cropKpiCards}>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiValue}>{cornKpis.total_units_sold.toLocaleString()}</div>
                      <div className={styles.kpiLabel}>Units Sold</div>
                    </div>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiValue}>{fmtCurrency(cornKpis.avg_price_per_unit)}</div>
                      <div className={styles.kpiLabel}>Avg Price / Unit</div>
                    </div>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiValue}>{fmtCurrency(cornKpis.avg_profit_per_unit)}</div>
                      <div className={styles.kpiLabel}>Avg Profit / Unit</div>
                    </div>
                  </div>
                </div>
              )}
              {beanKpis && (
                <div className={styles.cropKpiGroup}>
                  <div className={styles.cropKpiTitle}>Beans</div>
                  <div className={styles.cropKpiCards}>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiValue}>{beanKpis.total_units_sold.toLocaleString()}</div>
                      <div className={styles.kpiLabel}>Units Sold</div>
                    </div>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiValue}>{fmtCurrency(beanKpis.avg_price_per_unit)}</div>
                      <div className={styles.kpiLabel}>Avg Price / Unit</div>
                    </div>
                    <div className={styles.kpiCard}>
                      <div className={styles.kpiValue}>{fmtCurrency(beanKpis.avg_profit_per_unit)}</div>
                      <div className={styles.kpiLabel}>Avg Profit / Unit</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Crop Filter for Bar Chart ---- */}
          {bucketRows.length > 0 && (
            <div className={styles.cropFilterBar}>
              <span className={styles.cropFilterLabel}>Volume by</span>
              <div className={styles.cropFilterToggle}>
                <button
                  className={`${styles.cropFilterBtn} ${cropFilter === "corn" ? styles.cropFilterActive : ""}`}
                  onClick={() => setCropFilter("corn")}
                >
                  Corn
                </button>
                <button
                  className={`${styles.cropFilterBtn} ${cropFilter === "soybean" ? styles.cropFilterActive : ""}`}
                  onClick={() => setCropFilter("soybean")}
                >
                  Beans
                </button>
              </div>
            </div>
          )}

          {/* ---- Charts Row (bar 2/3 + pie 1/3) ---- */}
          {(filteredBuckets.length > 0 || filteredTreatments.length > 0) && (
            <div className={styles.chartsRow}>
              {filteredBuckets.length > 0 && (
                <div className={styles.chartPrimary}>
                  <div className={styles.sectionTitle}>Customer Volume Distribution</div>
                  <VolumeBucketBarChart rows={filteredBuckets} />
                </div>
              )}
              {filteredTreatments.length > 0 && (
                <div className={styles.chartSecondary}>
                  <div className={styles.sectionTitle}>Treatment Mix</div>
                  <CropPieChart rows={filteredTreatments} />
                </div>
              )}
            </div>
          )}

          {/* ---- Customer Volume Buckets Table ---- */}
          {filteredBuckets.length > 0 && (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Units Range</th>
                    <th className={styles.right}>Customers</th>
                    <th className={styles.right}>Total Units</th>
                    <th className={styles.right}>Total Sales</th>
                    <th className={styles.right}>Total Profit</th>
                    <th className={styles.right}>Avg Price/Unit</th>
                    <th className={styles.right}>Avg Profit/Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBuckets.map((r) => (
                    <tr key={r.bucket_idx}>
                      <td>{r.bucket_label}</td>
                      <td className={styles.mono}>{r.customer_count}</td>
                      <td className={styles.mono}>{r.total_units.toLocaleString()}</td>
                      <td className={styles.mono}>{fmtCurrency(r.total_sales)}</td>
                      <td className={styles.mono}>{fmtCurrency(r.total_profit)}</td>
                      <td className={styles.mono}>{fmtCurrency(r.avg_price_per_unit)}</td>
                      <td className={styles.mono}>{fmtCurrency(r.avg_profit_per_unit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
