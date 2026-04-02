"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BayerShipmentPrintView, {
  type BayerShipmentPrintItem,
} from "@/components/print/BayerShipmentPrintView";
import styles from "./print.module.css";

interface BayerShipmentPrintData {
  shipmentDate: string;
  shipmentNumber: string;
  seasonYear: number;
  items: BayerShipmentPrintItem[];
}

export default function BayerShipmentPrintPage() {
  const router = useRouter();
  const [data, setData] = useState<BayerShipmentPrintData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("ssim-bayer-shipment-print-data");
    if (raw) {
      try {
        setData(JSON.parse(raw));
      } catch {
        // invalid data — leave null
      }
    }
  }, []);

  const valid = data && data.items.length > 0;

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
            ← Back to Shipments
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay}>
      <div className={`${styles.toolbar} no-print`}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          ← Back to Shipments
        </button>
        <button className={styles.printBtn} onClick={() => window.print()}>
          Print
        </button>
      </div>
      <BayerShipmentPrintView
        shipmentDate={data.shipmentDate}
        shipmentNumber={data.shipmentNumber}
        seasonYear={data.seasonYear}
        items={data.items}
      />
    </div>
  );
}
