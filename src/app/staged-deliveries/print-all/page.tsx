"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import StagedDeliveryChecklistView, {
  type ChecklistData,
} from "@/components/print/StagedDeliveryChecklistView";
import styles from "./print-all.module.css";

export default function StagedDeliveryPrintAllPage() {
  const router = useRouter();
  const [data, setData] = useState<ChecklistData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-staged-delivery-print-all-data");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) {
          setData(parsed as ChecklistData);
        }
      } catch {
        // invalid data — leave null
      }
    }
  }, []);

  const valid = data && data.rows.length > 0;

  useEffect(() => {
    if (valid) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [valid]);

  if (!data) {
    return (
      <div className={styles.overlay}>
        <div className={styles.noData}>
          <p>No print data available.</p>
          <button className={styles.backBtn} onClick={() => router.back()}>
            ← Back to Staged Deliveries
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.toolbar} no-print`}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          ← Back to Staged Deliveries
        </button>
        <span className={styles.count}>
          {data.totalDeliveries} staged{" "}
          {data.totalDeliveries === 1 ? "delivery" : "deliveries"} —{" "}
          {data.totalUnits} total units
        </span>
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className={styles.pages}>
        <StagedDeliveryChecklistView data={data} />
      </div>
    </div>
  );
}
