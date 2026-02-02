"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import SeasonTabs from "@/components/pricing/SeasonTabs";
import PricingToggle, {
  type PricingMode,
} from "@/components/pricing/PricingToggle";
import PricingTable from "@/components/pricing/PricingTable";
import {
  fetchSeasons,
  fetchPricingWide,
  fetchBreakEvenWide,
  type PricingRow,
} from "@/services/pricing.service";
import styles from "./pricing.module.css";

/** Keys on each row that are searchable (product info, not prices). */
const SEARCH_KEYS = ["product", "crop", "chu", "seed_trait"];

/** Sort priority: DKC first, DKB second, everything else alphabetical. */
function sortPricingRows(rows: PricingRow[]): PricingRow[] {
  return [...rows].sort((a, b) => {
    const nameA = String(a.product ?? "").toUpperCase();
    const nameB = String(b.product ?? "").toUpperCase();
    const rankA = nameA.startsWith("DKC") ? 0 : nameA.startsWith("DKB") ? 1 : 2;
    const rankB = nameB.startsWith("DKC") ? 0 : nameB.startsWith("DKB") ? 1 : 2;
    if (rankA !== rankB) return rankA - rankB;
    return nameA.localeCompare(nameB);
  });
}

export default function PricingPage() {
  const [seasons, setSeasons] = useState<number[]>([]);
  const [activeSeason, setActiveSeason] = useState<number>(0);
  const [mode, setMode] = useState<PricingMode>("retail");
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Load seasons on mount
  useEffect(() => {
    let cancelled = false;
    fetchSeasons()
      .then((s) => {
        if (cancelled) return;
        setSeasons(s);
        if (s.length > 0) setActiveSeason(s[0]); // newest first
      })
      .catch((err) => {
        if (!cancelled) setError(String(err.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch pricing data when season or mode changes
  const loadData = useCallback(async (season: number, m: PricingMode) => {
    if (!season) return;
    setLoading(true);
    setError(null);
    try {
      const fetcher = m === "retail" ? fetchPricingWide : fetchBreakEvenWide;
      const data = await fetcher(season);
      setRows(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSeason) loadData(activeSeason, mode);
  }, [activeSeason, mode, loadData]);

  const handleSeasonChange = (year: number) => {
    setActiveSeason(year);
    setSearch("");
  };
  const handleModeChange = (m: PricingMode) => setMode(m);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sortPricingRows(rows);

    return sortPricingRows(rows.filter((row) => {
      const keys =
        SEARCH_KEYS.filter((k) => k in row).length > 0
          ? SEARCH_KEYS
          : Object.keys(row);

      return keys.some((k) => {
        const v = row[k];
        return v != null && String(v).toLowerCase().includes(term);
      });
    }));
  }, [rows, search]);

  return (
    <div>
      <h1 className={styles.heading}>Pricing</h1>

      {error && <p className={styles.error}>{error}</p>}

      <SeasonTabs
        seasons={seasons}
        active={activeSeason}
        onChange={handleSeasonChange}
      />

      <PricingToggle mode={mode} onChange={handleModeChange} />

      <input
        className={styles.search}
        type="text"
        placeholder="Search products…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <PricingTable rows={filteredRows} loading={loading} />
    </div>
  );
}
