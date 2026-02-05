"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReturnPrintView, {
  type ReturnPrintItem,
  type ReturnPrintCustomer,
} from "@/components/print/ReturnPrintView";
import styles from "./print.module.css";

interface ReturnPrintData {
  returnDate: string;
  customer: ReturnPrintCustomer;
  items: ReturnPrintItem[];
  notes: string;
}

export default function ReturnPrintPage() {
  const router = useRouter();
  const [data, setData] = useState<ReturnPrintData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-return-print-data");
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
            ← Back to Returns
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.toolbar} no-print`}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          ← Back to Returns
        </button>
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>
      <ReturnPrintView
        returnDate={data.returnDate}
        customer={data.customer}
        items={data.items}
        notes={data.notes}
      />
    </div>
  );
}
