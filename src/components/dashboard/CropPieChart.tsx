"use client";

import { useState } from "react";
import type { TreatmentMixRow } from "@/services/dashboard.service";
import styles from "./CropPieChart.module.css";

type PieMetric = "total_units" | "total_sales" | "total_profit";

const PIE_LABELS: Record<PieMetric, string> = {
  total_units: "Total Units",
  total_sales: "Total Revenue",
  total_profit: "Total Profit",
};

const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

const LABEL_R_PCT = 0.30;

interface Props {
  rows: TreatmentMixRow[];
}

export default function CropPieChart({ rows }: Props) {
  const [metric, setMetric] = useState<PieMetric>("total_units");

  const total = rows.reduce((s, r) => s + r[metric], 0);
  const slices = rows.map((r, i) => ({
    name: r.treatment_name,
    value: r[metric],
    pct: total > 0 ? (r[metric] / total) * 100 : 0,
    color: COLORS[i % COLORS.length],
  }));

  // Build conic-gradient
  let gradientStops = "";
  let cumPct = 0;
  const slicePositions: { midPct: number; pct: number; name: string }[] = [];
  slices.forEach((s) => {
    gradientStops += `${s.color} ${cumPct}% ${cumPct + s.pct}%, `;
    slicePositions.push({ midPct: cumPct + s.pct / 2, pct: s.pct, name: s.name });
    cumPct += s.pct;
  });
  gradientStops = gradientStops.replace(/, $/, "");

  return (
    <>
      <div className={styles.toggle}>
        {(Object.keys(PIE_LABELS) as PieMetric[]).map((key) => (
          <button
            key={key}
            className={`${styles.toggleBtn} ${metric === key ? styles.toggleActive : ""}`}
            onClick={() => setMetric(key)}
          >
            {PIE_LABELS[key]}
          </button>
        ))}
      </div>
      <div className={styles.pieWrapper}>
        <div
          className={styles.pieChart}
          style={{ background: total > 0 ? `conic-gradient(${gradientStops})` : undefined }}
        >
          {/* SVG overlay for slice border lines */}
          {total > 0 && (
            <svg className={styles.borderOverlay} viewBox="0 0 100 100">
              {(() => {
                let cum = 0;
                return slices.map((s, i) => {
                  const startAngle = (cum / 100) * 2 * Math.PI - Math.PI / 2;
                  cum += s.pct;
                  const x = 50 + 50 * Math.cos(startAngle);
                  const y = 50 + 50 * Math.sin(startAngle);
                  return (
                    <line
                      key={i}
                      x1="50" y1="50"
                      x2={x} y2={y}
                      stroke="#000" strokeWidth="0.8"
                    />
                  );
                });
              })()}
              <circle cx="50" cy="50" r="49.5" fill="none" stroke="#000" strokeWidth="0.8" />
            </svg>
          )}
          {slicePositions.map((sp) => {
            if (sp.pct < 6) return null;
            const angle = (sp.midPct / 100) * 2 * Math.PI;
            const leftPct = 50 + LABEL_R_PCT * 100 * Math.sin(angle);
            const topPct = 50 - LABEL_R_PCT * 100 * Math.cos(angle);
            return (
              <div
                key={sp.name}
                className={styles.sliceLabel}
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              >
                <span className={styles.sliceName}>{sp.name}</span>
                <span className={styles.slicePct}>{sp.pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
