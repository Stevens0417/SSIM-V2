"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import OrderPrintView, {
  type PrintItem,
  type PrintTotals,
  type PrintCustomer,
} from "@/components/print/OrderPrintView";
import styles from "./print.module.css";

interface PrintData {
  orderDate: string;
  seasonYear: number | null;
  customer: PrintCustomer;
  notes: string;
  items: PrintItem[];
  brandGrowerPct: number;
  earlyPayPct: number;
  totals: PrintTotals;
}

export default function OrderPrintPage() {
  const router = useRouter();
  const [data, setData] = useState<PrintData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-print-data");
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
            ← Back to Order
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.toolbar} no-print`}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          ← Back to Order
        </button>
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>
      <OrderPrintView
        orderDate={data.orderDate}
        seasonYear={data.seasonYear}
        customer={data.customer}
        notes={data.notes}
        items={data.items}
        brandGrowerPct={data.brandGrowerPct}
        earlyPayPct={data.earlyPayPct}
        totals={data.totals}
      />
    </div>
  );
}
