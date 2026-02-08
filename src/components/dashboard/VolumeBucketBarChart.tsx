"use client";

import { useState } from "react";
import type { VolumeBucketRow } from "@/services/dashboard.service";
import { fmtCurrency } from "@/lib/fmt";
import styles from "./VolumeBucketBarChart.module.css";

type BarMetric = "total_sales" | "avg_price_per_unit" | "avg_profit_per_unit";

const BAR_LABELS: Record<BarMetric, string> = {
  total_sales: "Total Sales",
  avg_price_per_unit: "Avg Price / Unit",
  avg_profit_per_unit: "Avg Profit / Unit",
};

interface Props {
  rows: VolumeBucketRow[];
}

export default function VolumeBucketBarChart({ rows }: Props) {
  const [metric, setMetric] = useState<BarMetric>("total_sales");

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
            <div key={r.bucket_idx} className={styles.chartCol}>
              <div className={styles.barValue}>{fmtCurrency(values[i])}</div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ height: `${pct}%` }}
                />
              </div>
              <div className={styles.barLabel}>{r.bucket_label}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
