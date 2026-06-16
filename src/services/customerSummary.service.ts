import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import type {
  ReportDeliveryRow,
  ReportReplantRow,
  ReportReturnRow,
  PackagingRow,
} from "./customerAdjustmentReport.service";

// ============================================================
// Customer Summary report
//
// A simplified, customer-facing/internal view of physical product
// activity (deliveries, returns, replants) for a customer + season.
// No orders or pricing.
//
// Reuses the existing Customer Adjustment Report views — the seed
// detail views already exclude packaging (products.crop = 'packaging'),
// and the packaging view tracks pallets/seedpaks separately:
//   v_customer_adjustment_report_deliveries
//   v_customer_adjustment_report_returns
//   v_customer_adjustment_report_replants
//   v_customer_adjustment_report_packaging
//
// The Movement Summary by Product (Section 6) and Summary Totals
// (Section 2) are aggregated client-side from the detail rows — no
// extra view/migration is required.
// ============================================================

export interface CustomerSummaryReport {
  deliveries: ReportDeliveryRow[];
  returns: ReportReturnRow[];
  replants: ReportReplantRow[];
  packaging: PackagingRow[];
}

/** One grouped row in the Movement Summary by Product (seed products only). */
export interface MovementSummaryRow {
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  units_delivered: number;
  units_returned: number;
  units_replanted: number;
  // net_physical_units = units_delivered + units_replanted - units_returned
  net_physical_units: number;
}

export interface SummaryTotals {
  totalDelivered: number;
  totalReturned: number;
  totalReplanted: number;
  // netPhysical = delivered + replanted - returned
  netPhysical: number;
}

function sortByDateThenProduct<T extends { product_name: string }>(
  rows: T[],
  dateKey: keyof T
): T[] {
  return [...rows].sort((a, b) => {
    const d = String(a[dateKey] ?? "").localeCompare(String(b[dateKey] ?? ""));
    if (d !== 0) return d;
    return a.product_name.localeCompare(b.product_name);
  });
}

/**
 * Group deliveries, returns, and replants by
 * product + treatment + seed_size + package_type and compute
 * net_physical_units for each group.
 *
 * Pure function — exported for unit testing.
 */
export function buildMovementSummary(
  deliveries: ReportDeliveryRow[],
  returns: ReportReturnRow[],
  replants: ReportReplantRow[]
): MovementSummaryRow[] {
  const map = new Map<string, MovementSummaryRow>();

  const keyOf = (r: {
    product_id: string;
    treatment_id: string;
    seed_size: string | null;
    package_type: string;
  }) => `${r.product_id}|${r.treatment_id}|${r.seed_size ?? ""}|${r.package_type}`;

  const ensure = (r: {
    product_id: string;
    product_name: string;
    treatment_id: string;
    treatment_name: string;
    seed_size: string | null;
    package_type: string;
  }): MovementSummaryRow => {
    const key = keyOf(r);
    let row = map.get(key);
    if (!row) {
      row = {
        product_id: r.product_id,
        product_name: r.product_name,
        treatment_id: r.treatment_id,
        treatment_name: r.treatment_name,
        seed_size: r.seed_size,
        package_type: r.package_type,
        units_delivered: 0,
        units_returned: 0,
        units_replanted: 0,
        net_physical_units: 0,
      };
      map.set(key, row);
    }
    return row;
  };

  for (const d of deliveries) {
    ensure(d).units_delivered += d.units_delivered ?? 0;
  }
  for (const r of returns) {
    ensure(r).units_returned += r.units_returned ?? 0;
  }
  for (const rp of replants) {
    ensure(rp).units_replanted += rp.units_replanted ?? 0;
  }

  const rows = Array.from(map.values());
  for (const row of rows) {
    row.net_physical_units =
      row.units_delivered + row.units_replanted - row.units_returned;
  }

  // Sort: product_name asc, treatment_name asc, seed_size asc, package_type asc
  rows.sort((a, b) => {
    const p = a.product_name.localeCompare(b.product_name);
    if (p !== 0) return p;
    const t = a.treatment_name.localeCompare(b.treatment_name);
    if (t !== 0) return t;
    const s = (a.seed_size ?? "").localeCompare(b.seed_size ?? "");
    if (s !== 0) return s;
    return a.package_type.localeCompare(b.package_type);
  });

  return rows;
}

/**
 * Sum delivered / returned / replanted units across all seed detail rows.
 *
 * Pure function — exported for unit testing.
 */
export function computeSummaryTotals(
  deliveries: ReportDeliveryRow[],
  returns: ReportReturnRow[],
  replants: ReportReplantRow[]
): SummaryTotals {
  const totalDelivered = deliveries.reduce((s, r) => s + (r.units_delivered ?? 0), 0);
  const totalReturned = returns.reduce((s, r) => s + (r.units_returned ?? 0), 0);
  const totalReplanted = replants.reduce((s, r) => s + (r.units_replanted ?? 0), 0);
  return {
    totalDelivered,
    totalReturned,
    totalReplanted,
    netPhysical: totalDelivered + totalReplanted - totalReturned,
  };
}

export async function fetchCustomerSummaryReport(
  seasonYear: number,
  customerId: string
): Promise<CustomerSummaryReport> {
  const sb = getSupabaseBrowserClient();

  const [deliveriesRes, returnsRes, replantsRes, packagingRes] = await Promise.all([
    sb
      .from("v_customer_adjustment_report_deliveries")
      .select("*")
      .eq("season_year", seasonYear)
      .eq("customer_id", customerId),
    sb
      .from("v_customer_adjustment_report_returns")
      .select("*")
      .eq("season_year", seasonYear)
      .eq("customer_id", customerId),
    sb
      .from("v_customer_adjustment_report_replants")
      .select("*")
      .eq("season_year", seasonYear)
      .eq("customer_id", customerId),
    sb
      .from("v_customer_adjustment_report_packaging")
      .select("*")
      .eq("season_year", seasonYear)
      .eq("customer_id", customerId),
  ]);

  if (deliveriesRes.error)
    throw new Error(deliveriesRes.error.message || "Failed to load deliveries");
  if (returnsRes.error)
    throw new Error(returnsRes.error.message || "Failed to load returns");
  if (replantsRes.error)
    throw new Error(replantsRes.error.message || "Failed to load replants");
  if (packagingRes.error)
    throw new Error(packagingRes.error.message || "Failed to load packaging");

  const deliveries = sortByDateThenProduct(
    (deliveriesRes.data ?? []) as ReportDeliveryRow[],
    "delivery_date"
  );
  const returns = sortByDateThenProduct(
    (returnsRes.data ?? []) as ReportReturnRow[],
    "return_date"
  );
  const replants = sortByDateThenProduct(
    (replantsRes.data ?? []) as ReportReplantRow[],
    "replant_date"
  );

  const packaging = ((packagingRes.data ?? []) as PackagingRow[]).sort((a, b) =>
    a.packaging_item.localeCompare(b.packaging_item)
  );

  return { deliveries, returns, replants, packaging };
}
