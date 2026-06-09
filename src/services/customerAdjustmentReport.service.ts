import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface ReportOrderRow {
  user_id: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  order_id: string;
  order_date: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  retail_price_per_unit: number;
  sale_price_per_unit: number;
  units_ordered: number;
  early_pay_discount_pct: number;
  brand_grower_discount_pct: number;
  total_discount_pct: number;
  line_total: number;
  notes: string | null;
}

export interface ReportDeliveryRow {
  user_id: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  delivery_header_id: string | null;
  delivery_id: string;
  delivery_date: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  units_delivered: number;
  notes: string | null;
}

export interface ReportReplantRow {
  user_id: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  replant_id: string;
  replant_date: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  units_replanted: number;
  notes: string | null;
}

export interface ReportReturnRow {
  user_id: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  return_id: string;
  return_date: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  units_returned: number;
  notes: string | null;
}

export interface ReportSummaryRow {
  user_id: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  early_pay_bucket: string;
  units_ordered: number;
  units_delivered: number;
  units_replanted: number;
  units_returned: number;
  net_units: number;
  completed: boolean;
}

export interface PackagingRow {
  user_id: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  product_id: string;
  packaging_item: string;
  units_delivered: number;
  units_returned: number;
  net_outstanding: number;
}

export interface PackagingDetailRow {
  user_id: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  movement_type: string;
  movement_date: string | null;
  movement_id: string;
  packaging_item: string;
  units: number;
  notes: string | null;
}

export interface CustomerAdjustmentReport {
  orders: ReportOrderRow[];
  deliveries: ReportDeliveryRow[];
  replants: ReportReplantRow[];
  returns: ReportReturnRow[];
  summary: ReportSummaryRow[];
  packaging: PackagingRow[];
  packagingDetail: PackagingDetailRow[];
}

export async function fetchCustomerAdjustmentReport(
  seasonYear: number,
  customerId: string
): Promise<CustomerAdjustmentReport> {
  const sb = getSupabaseBrowserClient();

  const [ordersRes, deliveriesRes, replantsRes, returnsRes, summaryRes, packagingRes, packagingDetailRes] =
    await Promise.all([
      sb
        .from("v_customer_adjustment_report_orders")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("customer_id", customerId),
      sb
        .from("v_customer_adjustment_report_deliveries")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("customer_id", customerId),
      sb
        .from("v_customer_adjustment_report_replants")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("customer_id", customerId),
      sb
        .from("v_customer_adjustment_report_returns")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("customer_id", customerId),
      sb
        .from("v_customer_adjustment_report_summary")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("customer_id", customerId),
      sb
        .from("v_customer_adjustment_report_packaging")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("customer_id", customerId),
      sb
        .from("v_customer_adjustment_report_packaging_detail")
        .select("*")
        .eq("season_year", seasonYear)
        .eq("customer_id", customerId)
        .order("movement_date", { ascending: true }),
    ]);

  if (ordersRes.error)
    throw new Error(ordersRes.error.message || "Failed to load orders");
  if (deliveriesRes.error)
    throw new Error(deliveriesRes.error.message || "Failed to load deliveries");
  if (replantsRes.error)
    throw new Error(replantsRes.error.message || "Failed to load replants");
  if (returnsRes.error)
    throw new Error(returnsRes.error.message || "Failed to load returns");
  if (summaryRes.error)
    throw new Error(summaryRes.error.message || "Failed to load summary");
  if (packagingRes.error)
    throw new Error(packagingRes.error.message || "Failed to load packaging");
  if (packagingDetailRes.error)
    throw new Error(packagingDetailRes.error.message || "Failed to load packaging detail");

  const orders = (ordersRes.data ?? []) as ReportOrderRow[];
  orders.sort((a, b) => {
    const d = a.order_date.localeCompare(b.order_date);
    if (d !== 0) return d;
    const p = a.product_name.localeCompare(b.product_name);
    if (p !== 0) return p;
    return a.treatment_name.localeCompare(b.treatment_name);
  });

  const deliveries = (deliveriesRes.data ?? []) as ReportDeliveryRow[];
  deliveries.sort((a, b) => {
    const d = a.delivery_date.localeCompare(b.delivery_date);
    if (d !== 0) return d;
    const p = a.product_name.localeCompare(b.product_name);
    if (p !== 0) return p;
    return a.treatment_name.localeCompare(b.treatment_name);
  });

  const replants = (replantsRes.data ?? []) as ReportReplantRow[];
  replants.sort((a, b) => {
    const d = a.replant_date.localeCompare(b.replant_date);
    if (d !== 0) return d;
    const p = a.product_name.localeCompare(b.product_name);
    if (p !== 0) return p;
    return a.treatment_name.localeCompare(b.treatment_name);
  });

  const returns = (returnsRes.data ?? []) as ReportReturnRow[];
  returns.sort((a, b) => {
    const d = a.return_date.localeCompare(b.return_date);
    if (d !== 0) return d;
    const p = a.product_name.localeCompare(b.product_name);
    if (p !== 0) return p;
    return a.treatment_name.localeCompare(b.treatment_name);
  });

  const summary = (summaryRes.data ?? []) as ReportSummaryRow[];
  summary.sort((a, b) => {
    const p = a.product_name.localeCompare(b.product_name);
    if (p !== 0) return p;
    const t = a.treatment_name.localeCompare(b.treatment_name);
    if (t !== 0) return t;
    const s = (a.seed_size ?? "").localeCompare(b.seed_size ?? "");
    if (s !== 0) return s;
    const pk = a.package_type.localeCompare(b.package_type);
    if (pk !== 0) return pk;
    return a.early_pay_bucket.localeCompare(b.early_pay_bucket);
  });

  const packaging = (packagingRes.data ?? []) as PackagingRow[];
  packaging.sort((a, b) => a.packaging_item.localeCompare(b.packaging_item));

  const packagingDetail = (packagingDetailRes.data ?? []) as PackagingDetailRow[];
  packagingDetail.sort((a, b) => {
    const d = (a.movement_date ?? "").localeCompare(b.movement_date ?? "");
    if (d !== 0) return d;
    return a.packaging_item.localeCompare(b.packaging_item);
  });

  return { orders, deliveries, replants, returns, summary, packaging, packagingDetail };
}
