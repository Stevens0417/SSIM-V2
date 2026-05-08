"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import StagedDeliveryPrintView, {
  type StagedDeliveryPrintItem,
  type StagedDeliveryPrintCustomer,
} from "@/components/print/StagedDeliveryPrintView";
import styles from "./print.module.css";

interface StagedDeliveryPrintData {
  deliveryDate: string;
  customer: StagedDeliveryPrintCustomer;
  items: StagedDeliveryPrintItem[];
  notes: string;
}

export default function StagedDeliveryPrintPage() {
  const router = useRouter();
  const [data, setData] = useState<StagedDeliveryPrintData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-staged-delivery-print-data");
    if (raw) {
      try {
        setData(JSON.parse(raw));
      } catch {
        // invalid data — leave null
      }
    }
  }, []);

  const valid = data && data.items.length > 0 && data.customer.name;

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
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>
      <StagedDeliveryPrintView
        stagedDate={data.deliveryDate}
        customer={data.customer}
        items={data.items}
        notes={data.notes}
      />
    </div>
  );
}
