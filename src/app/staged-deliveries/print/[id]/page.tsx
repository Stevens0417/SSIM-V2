"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import DeliveryPrintView, {
  type DeliveryPrintItem,
  type DeliveryPrintCustomer,
} from "@/components/print/DeliveryPrintView";
import styles from "../print.module.css";

interface StagedRow {
  customer_id: string;
  staged_date: string;
  notes: string | null;
  product_name: string;
  treatment_name: string;
  seed_size: string | null;
  units_staged: number;
}

interface CustomerRow {
  customer_name: string;
  farm_name: string | null;
  tsa_number: string | null;
  phone_number: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
}

interface PrintData {
  deliveryDate: string;
  customer: DeliveryPrintCustomer;
  items: DeliveryPrintItem[];
  notes: string;
}

export default function StagedDeliveryPrintByIdPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setPrintData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = getSupabaseBrowserClient();

      const { data: rows, error: rowsErr } = await supabase
        .from("v_staged_deliveries")
        .select("customer_id, staged_date, notes, product_name, treatment_name, seed_size, units_staged")
        .eq("staged_delivery_id", id);

      if (cancelled) return;
      if (rowsErr || !rows || rows.length === 0) {
        setError("Staged delivery not found or you do not have access to it.");
        return;
      }

      const stagedRows = rows as StagedRow[];
      const anchor = stagedRows[0];

      // Aggregate units by (product_name, treatment_name, seed_size).
      const itemMap = new Map<string, DeliveryPrintItem>();
      for (const row of stagedRows) {
        const key = `${row.product_name}||${row.treatment_name}||${row.seed_size ?? ""}`;
        const existing = itemMap.get(key);
        if (existing) {
          existing.units += row.units_staged;
        } else {
          itemMap.set(key, {
            product: row.product_name,
            treatment: row.treatment_name,
            units: row.units_staged,
          });
        }
      }
      const items = [...itemMap.values()];

      const { data: custRows, error: custErr } = await supabase
        .from("customers")
        .select("customer_name, farm_name, tsa_number, phone_number, address, city, province, postal_code")
        .eq("id", anchor.customer_id)
        .limit(1);

      if (cancelled) return;
      if (custErr || !custRows || custRows.length === 0) {
        setError("Customer information not found.");
        return;
      }

      const cust = custRows[0] as CustomerRow;

      setPrintData({
        deliveryDate: anchor.staged_date,
        customer: {
          name: cust.customer_name,
          farmName: cust.farm_name ?? "",
          tsaNumber: cust.tsa_number ?? "",
          phone: cust.phone_number ?? "",
          address: cust.address ?? "",
          city: cust.city ?? "",
          province: cust.province ?? "",
          postalCode: cust.postal_code ?? "",
        },
        items,
        notes: anchor.notes ?? "",
      });
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load staged delivery data.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const valid = data && data.items.length > 0;

  useEffect(() => {
    if (valid) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [valid]);

  if (error) {
    return (
      <div className={styles.overlay}>
        <div className={styles.noData}>
          <p>{error}</p>
          <button className={styles.backBtn} onClick={() => router.back()}>
            ← Back to Staged Deliveries
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.overlay}>
        <div className={styles.noData}>
          <p>Loading print data…</p>
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
      <DeliveryPrintView
        deliveryDate={data.deliveryDate}
        customer={data.customer}
        items={data.items}
        notes={data.notes}
      />
    </div>
  );
}
