"use client";

import styles from "./PricingToggle.module.css";

export type PricingMode = "retail" | "breakeven";

interface PricingToggleProps {
  mode: PricingMode;
  onChange: (mode: PricingMode) => void;
}

export default function PricingToggle({ mode, onChange }: PricingToggleProps) {
  return (
    <div className={styles.group}>
      <button
        className={`${styles.btn} ${mode === "retail" ? styles.active : ""}`}
        onClick={() => onChange("retail")}
      >
        Retail
      </button>
      <button
        className={`${styles.btn} ${mode === "breakeven" ? styles.active : ""}`}
        onClick={() => onChange("breakeven")}
      >
        Break-even
      </button>
    </div>
  );
}
