import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface DeliveryInsert {
  delivery_date: string;
  season_year: number;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  units_delivered: number;
  seed_size: string | null;
  package_type: string;
  order_id: string | null;
  order_item_id: string | null;
  notes: string | null;
}

export interface CreateDeliveriesResult {
  ids: string[];
}

export async function createDeliveries(
  rows: DeliveryInsert[]
): Promise<CreateDeliveriesResult> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("deliveries")
    .insert(rows)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  return {
    ids: (data ?? []).map((row: { id: string }) => row.id),
  };
}

/* ---- Fetch deliveries from view ---- */

export interface DeliveryViewRow {
  delivery_id: string;
  delivery_date: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  units_delivered: number;
  seed_size: string | null;
  package_type: string;
  order_id: string | null;
  order_item_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchDeliveriesThisSeason(): Promise<DeliveryViewRow[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_deliveries_this_season")
    .select("*");

  if (error) {
    throw new Error(error.message || "Failed to load deliveries");
  }

  // Sort client-side: delivery_date DESC, then customer_name ASC
  const rows = (data ?? []) as DeliveryViewRow[];
  rows.sort((a, b) => {
    // Date descending
    const dateCompare = b.delivery_date.localeCompare(a.delivery_date);
    if (dateCompare !== 0) return dateCompare;
    // Customer ascending
    return a.customer_name.localeCompare(b.customer_name);
  });

  return rows;
}

/* ---- Update a delivery ---- */

export interface DeliveryUpdate {
  delivery_date: string;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  units_delivered: number;
  seed_size: string | null;
  package_type: string;
  notes: string | null;
}

export async function updateDelivery(
  deliveryId: string,
  updates: DeliveryUpdate
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("deliveries")
    .update(updates)
    .eq("id", deliveryId);

  if (error) {
    throw new Error(error.message || "Failed to update delivery");
  }
}

/* ---- Customer order status view ---- */

export interface CustomerOrderStatusRow {
  order_id: string;
  order_date: string;
  order_item_id: string;
  product_name: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  ordered_units: number;
  delivered_units: number;
  returned_units: number;
  replanted_units: number;
  net_units: number;
  is_complete: boolean;
  customer_id: string;
  season_year: number;
}

export async function fetchCustomerOrderStatus(
  customerId: string,
  seasonYear: number
): Promise<CustomerOrderStatusRow[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_delivery_customer_order_status")
    .select("*")
    .eq("customer_id", customerId)
    .eq("season_year", seasonYear)
    .order("order_date", { ascending: false })
    .order("order_id", { ascending: false })
    .order("product_name", { ascending: true })
    .order("treatment_name", { ascending: true });

  if (error) throw new Error(error.message || "Failed to load order status");
  return (data ?? []) as CustomerOrderStatusRow[];
}

/* ---- Delete a delivery ---- */

export async function deleteDelivery(deliveryId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("deliveries")
    .delete()
    .eq("id", deliveryId);

  if (error) {
    throw new Error(error.message || "Failed to delete delivery");
  }
}
