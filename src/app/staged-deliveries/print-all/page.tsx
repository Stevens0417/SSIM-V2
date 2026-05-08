"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import StagedDeliveryPrintView, {
  type StagedDeliveryPrintItem,
  type StagedDeliveryPrintCustomer,
} from "@/components/print/StagedDeliveryPrintView";
import styles from "./print-all.module.css";

interface SinglePrintData {
  deliveryDate: string;
  customer: StagedDeliveryPrintCustomer;
  items: StagedDeliveryPrintItem[];
  notes: string;
}

export default function StagedDeliveryPrintAllPage() {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<SinglePrintData[] | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-staged-delivery-print-all-data");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setDeliveries(parsed as SinglePrintData[]);
        }
      } catch {
        // invalid data — leave null
      }
    }
  }, []);

  const valid = deliveries && deliveries.length > 0;

  useEffect(() => {
    if (valid) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [valid]);

  if (!deliveries) {
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
          {deliveries.length} staged{" "}
          {deliveries.length === 1 ? "delivery" : "deliveries"}
        </span>
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print All
        </button>
      </div>

      <div className={styles.pages}>
        {deliveries.map((d, i) => (
          <div
            key={i}
            className={i < deliveries.length - 1 ? styles.pageBreak : undefined}
          >
            <StagedDeliveryPrintView
              stagedDate={d.deliveryDate}
              customer={d.customer}
              items={d.items}
              notes={d.notes}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
