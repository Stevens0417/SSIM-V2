import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface LineToMatch {
  product_id: string;
  treatment_id: string;
  seed_size: string | null;
  package_type: string;
}

export type OrderMatchResult =
  | { order_id: string; order_item_id: string }
  | null
  | "ambiguous";

/**
 * For each line, finds the matching order item for the given customer + season.
 * Returns:
 *   { order_id, order_item_id } — exactly one match, link will be saved
 *   null                        — no match, save proceeds without a link
 *   "ambiguous"                 — multiple matches, caller must block save
 */
export async function findOrderLineMatches(
  customerId: string,
  seasonYear: number,
  lines: LineToMatch[]
): Promise<OrderMatchResult[]> {
  const supabase = getSupabaseBrowserClient();

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id")
    .eq("customer_id", customerId)
    .eq("season_year", seasonYear);

  if (ordersError)
    throw new Error(ordersError.message || "Failed to fetch orders for matching");

  const orderIds = (orders ?? []).map((o: { id: string }) => o.id);

  if (orderIds.length === 0) {
    return lines.map(() => null);
  }

  const { data: orderItems, error: itemsError } = await supabase
    .from("order_items")
    .select("id, order_id, product_id, treatment_id, seed_size, package_type")
    .in("order_id", orderIds);

  if (itemsError)
    throw new Error(itemsError.message || "Failed to fetch order items for matching");

  const items = (orderItems ?? []) as Array<{
    id: string;
    order_id: string;
    product_id: string;
    treatment_id: string;
    seed_size: string | null;
    package_type: string;
  }>;

  return lines.map((line) => {
    const matches = items.filter(
      (item) =>
        item.product_id === line.product_id &&
        item.treatment_id === line.treatment_id &&
        (item.seed_size ?? null) === (line.seed_size ?? null) &&
        item.package_type === line.package_type
    );

    if (matches.length === 0) return null;
    if (matches.length === 1)
      return { order_id: matches[0].order_id, order_item_id: matches[0].id };
    return "ambiguous";
  });
}
