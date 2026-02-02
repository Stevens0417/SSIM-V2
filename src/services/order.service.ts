import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface OrderPayload {
  order_date: string;
  customer_id: string;
  season_year: number;
  brand_grower_pct: number;
  early_pay_pct: number;
  subtotal_before_discounts: number;
  brand_grower_discount_total: number;
  tote_bulk_discount_total: number;
  subtotal_after_discounts_before_early_pay: number;
  early_pay_discount_total: number;
  total_after_all_discounts: number;
  total_profit: number;
  avg_profit_per_unit: number;
  total_units: number;
}

export interface OrderItemPayload {
  order_id: string;
  product_id: string;
  treatment_id: string;
  seed_size: string | null;
  package_type: string;
  units: number;
  retail_price_per_unit: number;
  tote_bulk_discount_per_unit: number;
  line_subtotal_before_discounts: number;
  brand_grower_discount_amount: number;
  tote_bulk_discount_amount: number;
  line_total_after_discounts_before_early_pay: number;
  early_pay_discount_amount: number;
  line_total_after_all_discounts: number;
  break_even_price_per_unit: number;
  profit_per_unit: number;
  total_profit: number;
}

export async function saveOrder(
  order: OrderPayload,
  items: OrderItemPayload[]
): Promise<string> {
  const sb = getSupabaseBrowserClient();

  // 1) Insert order header
  const { data: orderRow, error: orderError } = await sb
    .from("orders")
    .insert(order)
    .select("id")
    .single();

  if (orderError) {
    throw new Error(orderError.message || "Failed to save order");
  }

  const orderId = (orderRow as { id: string }).id;

  // 2) Insert order items
  const itemsWithOrderId = items.map((item) => ({
    ...item,
    order_id: orderId,
  }));

  const { error: itemsError } = await sb
    .from("order_items")
    .insert(itemsWithOrderId);

  if (itemsError) {
    // Rollback: delete the orphan order header
    await sb.from("orders").delete().eq("id", orderId);
    throw new Error(itemsError.message || "Failed to save order items");
  }

  return orderId;
}

/* ---- List orders for a season ---- */

export interface OrderSummaryRow {
  id: string;
  order_date: string;
  customer_name: string;
  total_units: number;
  total_after_all_discounts: number;
  total_profit: number;
  brand_grower_pct: number;
  early_pay_pct: number;
}

export async function fetchOrdersBySeason(
  seasonYear: number
): Promise<OrderSummaryRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("orders")
    .select("id, order_date, customer_id, total_units, total_after_all_discounts, total_profit, brand_grower_pct, early_pay_pct, customers(customer_name)")
    .eq("season_year", seasonYear)
    .order("order_date", { ascending: false });

  if (error) throw new Error(error.message || "Failed to load orders");

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    order_date: row.order_date as string,
    customer_name: ((row.customers as Record<string, string>) ?? {}).customer_name ?? "Unknown",
    total_units: row.total_units as number,
    total_after_all_discounts: row.total_after_all_discounts as number,
    total_profit: row.total_profit as number,
    brand_grower_pct: row.brand_grower_pct as number,
    early_pay_pct: row.early_pay_pct as number,
  }));
}

/* ---- Fetch single order + items for editing ---- */

export interface OrderWithItems {
  id: string;
  order_date: string;
  customer_id: string;
  season_year: number;
  brand_grower_pct: number;
  early_pay_pct: number;
  notes: string | null;
  items: OrderItemPayload[];
}

export async function fetchOrderWithItems(
  orderId: string
): Promise<OrderWithItems> {
  const sb = getSupabaseBrowserClient();

  const { data: order, error: orderError } = await sb
    .from("orders")
    .select("id, order_date, customer_id, season_year, brand_grower_pct, early_pay_pct")
    .eq("id", orderId)
    .single();

  if (orderError) throw new Error(orderError.message || "Failed to load order");

  const { data: items, error: itemsError } = await sb
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);

  if (itemsError) throw new Error(itemsError.message || "Failed to load order items");

  return {
    ...(order as Omit<OrderWithItems, "items" | "notes">),
    notes: null,
    items: (items ?? []) as OrderItemPayload[],
  };
}

/* ---- Update existing order (delete old items, re-insert) ---- */

export async function updateOrder(
  orderId: string,
  order: OrderPayload,
  items: OrderItemPayload[]
): Promise<void> {
  const sb = getSupabaseBrowserClient();

  // 1) Delete old items
  const { error: deleteError } = await sb
    .from("order_items")
    .delete()
    .eq("order_id", orderId);

  if (deleteError) throw new Error(deleteError.message || "Failed to update order items");

  // 2) Update order header
  const { error: orderError } = await sb
    .from("orders")
    .update(order)
    .eq("id", orderId);

  if (orderError) throw new Error(orderError.message || "Failed to update order");

  // 3) Insert new items
  const itemsWithOrderId = items.map((item) => ({
    ...item,
    order_id: orderId,
  }));

  const { error: itemsError } = await sb
    .from("order_items")
    .insert(itemsWithOrderId);

  if (itemsError) throw new Error(itemsError.message || "Failed to save order items");
}

/* ---- Fetch line items from v_order_items_this_season ---- */

export interface OrderItemViewRow {
  order_item_id: string;
  order_id: string;
  order_date: string;
  customer_name: string;
  product_name: string;
  treatment_name: string;
  units: number;
  retail_price_per_unit: number;
  brand_grower_pct: number;
  early_pay_pct: number;
  line_total_after_all_discounts: number;
  line_total_profit: number;
}

export async function fetchOrderItemsThisSeason(): Promise<OrderItemViewRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_order_items_this_season")
    .select("order_item_id, order_id, order_date, customer_name, product_name, treatment_name, units, retail_price_per_unit, brand_grower_pct, early_pay_pct, line_total_after_all_discounts, line_total_profit")
    .order("order_date", { ascending: false })
    .order("customer_name", { ascending: true })
    .order("product_name", { ascending: true })
    .order("treatment_name", { ascending: true })
    .order("units", { ascending: false });

  if (error) throw new Error(error.message || "Failed to load order items");
  return (data ?? []) as OrderItemViewRow[];
}

/* ---- Delete order (cascade deletes order_items) ---- */

export async function deleteOrder(orderId: string): Promise<void> {
  const sb = getSupabaseBrowserClient();
  const { error } = await sb
    .from("orders")
    .delete()
    .eq("id", orderId);

  if (error) throw new Error(error.message || "Failed to delete order");
}
