"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import DeliveryPrintView, {
  type DeliveryPrintItem,
  type DeliveryPrintCustomer,
} from "@/components/print/DeliveryPrintView";
import styles from "../print.module.css";

interface AnchorRow {
  customer_id: string;
  delivery_date: string;
  season_year: number;
  notes: string | null;
  created_at: string;
  delivery_header_id: string | null;
}

interface SiblingRow {
  product_name: string;
  treatment_name: string;
  seed_size: string | null;
  units_delivered: number;
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
  deliveryId: string;
}

export default function DeliveryPrintByIdPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setPrintData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = getSupabaseBrowserClient();

      // 1. Fetch the anchor delivery row from the view (includes product/treatment names)
      const { data: anchorRows, error: anchorErr } = await supabase
        .from("v_deliveries_this_season")
        .select("customer_id, delivery_date, season_year, notes, created_at, delivery_header_id")
        .eq("delivery_id", id)
        .limit(1);

      if (cancelled) return;
      if (anchorErr || !anchorRows || anchorRows.length === 0) {
        setError("Delivery not found or you do not have access to it.");
        return;
      }

      const anchor = anchorRows[0] as AnchorRow;

      // 2. Fetch all rows from the same save batch.
      // New records: group by delivery_header_id (explicit and reliable).
      // Legacy records (delivery_header_id = null): fall back to
      // (customer_id, delivery_date, season_year, notes, created_at) grouping.
      let siblingQuery = supabase
        .from("v_deliveries_this_season")
        .select("product_name, treatment_name, seed_size, units_delivered");

      if (anchor.delivery_header_id) {
        siblingQuery = siblingQuery.eq("delivery_header_id", anchor.delivery_header_id);
      } else {
        siblingQuery = siblingQuery
          .eq("customer_id", anchor.customer_id)
          .eq("delivery_date", anchor.delivery_date)
          .eq("season_year", anchor.season_year)
          .eq("created_at", anchor.created_at);

        if (anchor.notes === null) {
          siblingQuery = siblingQuery.is("notes", null);
        } else {
          siblingQuery = siblingQuery.eq("notes", anchor.notes);
        }
      }

      const { data: siblingRows } = await siblingQuery;
      if (cancelled) return;

      const siblings = (siblingRows ?? []) as SiblingRow[];

      // 3. Aggregate units by (product_name, treatment_name, seed_size).
      // Multiple DB rows for the same product (split across order allocations) become one print line.
      const itemMap = new Map<string, DeliveryPrintItem>();
      for (const row of siblings) {
        const key = `${row.product_name}||${row.treatment_name}||${row.seed_size ?? ""}`;
        const existing = itemMap.get(key);
        if (existing) {
          existing.units += row.units_delivered;
        } else {
          itemMap.set(key, {
            product: row.product_name,
            treatment: row.treatment_name,
            units: row.units_delivered,
          });
        }
      }
      const items = [...itemMap.values()];

      // 4. Fetch customer info
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

      const printCustomer: DeliveryPrintCustomer = {
        name: cust.customer_name,
        farmName: cust.farm_name ?? "",
        tsaNumber: cust.tsa_number ?? "",
        phone: cust.phone_number ?? "",
        address: cust.address ?? "",
        city: cust.city ?? "",
        province: cust.province ?? "",
        postalCode: cust.postal_code ?? "",
      };

      const displayId = anchor.delivery_header_id?.slice(0, 8) ?? id.slice(0, 8);

      setPrintData({
        deliveryDate: anchor.delivery_date,
        customer: printCustomer,
        items,
        notes: anchor.notes ?? "",
        deliveryId: displayId,
      });
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load delivery data.");
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
            ← Back to Deliveries
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
          ← Back to Deliveries
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
        deliveryId={data.deliveryId}
      />
    </div>
  );
}
