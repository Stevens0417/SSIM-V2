"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import InventoryWideTable from "@/components/inventory/InventoryWideTable";
import InventoryDetailTable from "@/components/inventory/InventoryDetailTable";
import {
  fetchInventoryWide,
  fetchInventoryDetail,
  type InventoryWideRow,
  type InventoryDetailRow,
} from "@/services/inventory.service";
import styles from "./on-hand-inventory.module.css";

type View = "wide" | "detail";

export default function OnHandInventoryPage() {
  const [view, setView] = useState<View>("wide");

  // Wide view state
  const [wideRows, setWideRows] = useState<InventoryWideRow[]>([]);
  const [wideLoading, setWideLoading] = useState(false);
  const [wideError, setWideError] = useState<string | null>(null);

  // Detail view state
  const [detailRows, setDetailRows] = useState<InventoryDetailRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Filtered detail rows (updated by child component)
  const [filteredDetailRows, setFilteredDetailRows] = useState<InventoryDetailRow[]>([]);

  const loadWide = useCallback(async () => {
    setWideLoading(true);
    setWideError(null);
    try {
      const data = await fetchInventoryWide();
      setWideRows(data);
    } catch (err) {
      setWideError(err instanceof Error ? err.message : "Failed to load inventory");
    } finally {
      setWideLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async () => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const data = await fetchInventoryDetail();
      setDetailRows(data);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load inventory detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Load both on mount
  useEffect(() => {
    loadWide();
    loadDetail();
  }, [loadWide, loadDetail]);

  // KPI source: in detail view use filtered rows, in wide view use all detail rows
  const kpiRows = view === "detail" ? filteredDetailRows : detailRows;

  const kpis = useMemo(() => {
    const totalOnHand = kpiRows.reduce((sum, r) => sum + r.units_on_hand, 0);
    const negativeCount = kpiRows.filter((r) => r.units_on_hand < 0).length;
    const zeroCount = kpiRows.filter((r) => r.units_on_hand === 0).length;
    return { totalOnHand, negativeCount, zeroCount };
  }, [kpiRows]);

  const handleFilteredChange = useCallback((rows: InventoryDetailRow[]) => {
    setFilteredDetailRows(rows);
  }, []);

  return (
    <div>
      {/* ---- Header Band ---- */}
      <div className={styles.headerBand}>
        <div className={styles.headerText}>
          <div className={styles.headerTitle}>On-Hand Inventory</div>
          <div className={styles.headerSub}>
            Shipments &minus; Deliveries + Returns
          </div>
        </div>
      </div>

      {/* ---- Toolbar ---- */}
      <div className={styles.toolbar}>
        <div className={styles.viewToggle}>
          <button
            className={`${styles.toggleBtn} ${view === "wide" ? styles.toggleActive : ""}`}
            onClick={() => setView("wide")}
          >
            Wide View
          </button>
          <button
            className={`${styles.toggleBtn} ${view === "detail" ? styles.toggleActive : ""}`}
            onClick={() => setView("detail")}
          >
            Detail View
          </button>
        </div>
        <button
          className={styles.refreshBtn}
          disabled={wideLoading || detailLoading}
          onClick={() => {
            loadWide();
            loadDetail();
          }}
        >
          {wideLoading || detailLoading ? "Refreshing\u2026" : "Refresh"}
        </button>
      </div>

      {/* ---- KPI Cards ---- */}
      {detailRows.length > 0 && (
        <div className={styles.kpiRow}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiValue}>{kpis.totalOnHand.toLocaleString()}</div>
            <div className={styles.kpiLabel}>Total Units On Hand</div>
          </div>
          <div className={`${styles.kpiCard} ${kpis.negativeCount > 0 ? styles.kpiNegative : ""}`}>
            <div className={styles.kpiValue}>{kpis.negativeCount}</div>
            <div className={styles.kpiLabel}>Negative On-Hand</div>
          </div>
          <div className={styles.kpiCard}>
            <div className={styles.kpiValue}>{kpis.zeroCount}</div>
            <div className={styles.kpiLabel}>Zero On-Hand</div>
          </div>
        </div>
      )}

      {/* ---- Content ---- */}
      {view === "wide" ? (
        <InventoryWideTable rows={wideRows} loading={wideLoading} error={wideError} />
      ) : (
        <InventoryDetailTable
          rows={detailRows}
          loading={detailLoading}
          error={detailError}
          onFilteredChange={handleFilteredChange}
        />
      )}
    </div>
  );
}
