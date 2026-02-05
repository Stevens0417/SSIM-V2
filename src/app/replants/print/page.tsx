"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReplantPrintView, {
  type ReplantPrintItem,
  type ReplantPrintCustomer,
} from "@/components/print/ReplantPrintView";
import styles from "./print.module.css";

interface ReplantPrintData {
  replantDate: string;
  customer: ReplantPrintCustomer;
  items: ReplantPrintItem[];
  notes: string;
}

export default function ReplantPrintPage() {
  const router = useRouter();
  const [data, setData] = useState<ReplantPrintData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-replant-print-data");
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
            ← Back to Replants
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.toolbar} no-print`}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          ← Back to Replants
        </button>
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>
      <ReplantPrintView
        replantDate={data.replantDate}
        customer={data.customer}
        items={data.items}
        notes={data.notes}
      />
    </div>
  );
}
