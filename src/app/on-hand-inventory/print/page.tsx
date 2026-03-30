"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import InventoryPrintView from "@/components/print/InventoryPrintView";
import type { InventoryPrintRow } from "@/services/inventory.service";
import styles from "./print.module.css";

interface PrintData {
  rows: InventoryPrintRow[];
  printDate: string;
}

export default function InventoryPrintPage() {
  const router = useRouter();
  const [data, setData] = useState<PrintData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-inventory-print-data");
    if (raw) {
      try {
        setData(JSON.parse(raw));
      } catch {
        // invalid data — leave null
      }
    }
  }, []);

  useEffect(() => {
    if (data && data.rows.length > 0) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [data]);

  if (!data) {
    return (
      <div className={styles.overlay}>
        <div className={styles.noData}>
          <p>No inventory data available.</p>
          <button className={styles.backBtn} onClick={() => router.back()}>
            ← Back to Inventory
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.toolbar} no-print`}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          ← Back to Inventory
        </button>
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>
      <InventoryPrintView rows={data.rows} printDate={data.printDate} />
    </div>
  );
}
