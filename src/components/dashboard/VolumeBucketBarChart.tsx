"use client";

import { useState } from "react";
import type { VolumeBucketRow } from "@/services/dashboard.service";
import { fmtCurrency } from "@/lib/fmt";
import styles from "./VolumeBucketBarChart.module.css";

type BarMetric = "bucket_total_sales" | "avg_price_per_unit" | "bucket_total_profit";

const BAR_LABELS: Record<BarMetric, string> = {
  bucket_total_sales: "Total Sales",
  avg_price_per_unit: "Avg Price / Unit",
  bucket_total_profit: "Total Profit",
};

interface Props {
  rows: VolumeBucketRow[];
}

export default function VolumeBucketBarChart({ rows }: Props) {
  const [metric, setMetric] = useState<BarMetric>("bucket_total_sales");

  const values = rows.map((r) => r[metric]);
  const maxVal = Math.max(...values, 1);

  return (
    <>
      <div className={styles.toggle}>
        {(Object.keys(BAR_LABELS) as BarMetric[]).map((key) => (
          <button
            key={key}
            className={`${styles.toggleBtn} ${metric === key ? styles.toggleActive : ""}`}
            onClick={() => setMetric(key)}
          >
            {BAR_LABELS[key]}
          </button>
        ))}
      </div>
      <div className={styles.chart}>
        {rows.map((r, i) => {
          const pct = (values[i] / maxVal) * 100;
          return (
            <div key={r.volume_bucket} className={styles.chartCol}>
              <div className={styles.barValue}>{fmtCurrency(values[i])}</div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ height: `${pct}%` }}
                />
              </div>
              <div className={styles.barLabel}>{r.volume_bucket.replace(/^\d+:\s*/, "")}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
