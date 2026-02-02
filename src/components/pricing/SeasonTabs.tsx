"use client";

import styles from "./SeasonTabs.module.css";

interface SeasonTabsProps {
  seasons: number[];
  active: number;
  onChange: (year: number) => void;
}

export default function SeasonTabs({
  seasons,
  active,
  onChange,
}: SeasonTabsProps) {
  if (seasons.length === 0) return null;

  return (
    <div className={styles.tabs}>
      {seasons.map((year) => (
        <button
          key={year}
          className={`${styles.tab} ${year === active ? styles.active : ""}`}
          onClick={() => onChange(year)}
        >
          {year}
        </button>
      ))}
    </div>
  );
}
