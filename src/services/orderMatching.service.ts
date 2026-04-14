import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface LineToMatch {
  product_id: string;
  treatment_id: string;
  seed_size: string | null;
  package_type: string;
  units: number;
}

export interface OrderLineAllocation {
  order_id: string;
  order_item_id: string;
  units: number;
}

/**
 * For each delivery line, allocates units across matching open order lines.
 * Priority: early-pay order lines first, then oldest order first
 * (order_date ASC, created_at ASC, order_id ASC).
 *
 * Returns an array of linked allocations per input line. If the full
 * quantity cannot be covered by open order lines, the remainder is
 * NOT included — the caller should create an unlinked delivery row
 * for any shortfall.
 *
 * Open quantities are tracked across all lines within a single call
 * to prevent over-allocating the same order line.
 */
export async function findOrderLineMatches(
  customerId: string,
  seasonYear: number,
  lines: LineToMatch[]
): Promise<OrderLineAllocation[][]> {
  const supabase = getSupabaseBrowserClient();

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, order_date, created_at, early_pay_pct")
    .eq("customer_id", customerId)
    .eq("season_year", seasonYear);

  if (ordersError)
    throw new Error(ordersError.message || "Failed to fetch orders for matching");

  const orderList = (orders ?? []) as Array<{
    id: string;
    order_date: string;
    created_at: string;
    early_pay_pct: number | null;
  }>;

  if (orderList.length === 0) {
    return lines.map(() => []);
  }

  const orderIds = orderList.map((o) => o.id);
  const orderMeta = new Map(orderList.map((o) => [o.id, o]));

  // Fetch current open quantities from the order status view
  const { data: statusRows, error: statusError } = await supabase
    .from("v_delivery_customer_order_status")
    .select(
      "order_id, order_item_id, product_id, treatment_id, seed_size, package_type, net_units"
    )
    .in("order_id", orderIds);

  if (statusError)
    throw new Error(statusError.message || "Failed to fetch order status for matching");

  type StatusRow = {
    order_id: string;
    order_item_id: string;
    product_id: string;
    treatment_id: string;
    seed_size: string | null;
    package_type: string | null;
    net_units: number;
  };

  const statusList = (statusRows ?? []) as StatusRow[];

  // Mutable open-unit tracker shared across all lines to prevent over-allocation
  const openUnits = new Map<string, number>(
    statusList.map((r) => [r.order_item_id, Math.max(0, r.net_units)])
  );

  function prioritySort(a: StatusRow, b: StatusRow): number {
    const am = orderMeta.get(a.order_id)!;
    const bm = orderMeta.get(b.order_id)!;
    // Early-pay lines first
    const aEarly = (am.early_pay_pct ?? 0) > 0 ? 1 : 0;
    const bEarly = (bm.early_pay_pct ?? 0) > 0 ? 1 : 0;
    if (bEarly !== aEarly) return bEarly - aEarly;
    // Oldest order_date first
    if (am.order_date !== bm.order_date)
      return am.order_date < bm.order_date ? -1 : 1;
    // Then earliest created_at
    if (am.created_at !== bm.created_at)
      return am.created_at < bm.created_at ? -1 : 1;
    // Stable tiebreak by order_id
    return a.order_id < b.order_id ? -1 : 1;
  }

  return lines.map((line) => {
    const candidates = statusList
      .filter(
        (r) =>
          r.product_id === line.product_id &&
          r.treatment_id === line.treatment_id &&
          (r.seed_size ?? null) === (line.seed_size ?? null) &&
          (r.package_type ?? "bag") === line.package_type &&
          (openUnits.get(r.order_item_id) ?? 0) > 0
      )
      .sort(prioritySort);

    if (candidates.length === 0) return [];

    const allocations: OrderLineAllocation[] = [];
    let remaining = line.units;

    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const available = openUnits.get(candidate.order_item_id) ?? 0;
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      allocations.push({
        order_id: candidate.order_id,
        order_item_id: candidate.order_item_id,
        units: take,
      });
      openUnits.set(candidate.order_item_id, available - take);
      remaining -= take;
    }

    return allocations;
  });
}
