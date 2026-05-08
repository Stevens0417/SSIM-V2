import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";
import {
  findOrderLineMatches,
  type LineToMatch,
} from "@/services/orderMatching.service";
import {
  createDeliveries,
  type DeliveryInsert,
} from "@/services/delivery.service";

export interface StagedDeliveryItemInsert {
  product_id: string;
  treatment_id: string;
  seed_size: string | null;
  package_type: string;
  units_staged: number;
}

export interface CreateStagedDeliveryResult {
  id: string;
}

export async function createStagedDelivery(
  header: {
    customer_id: string;
    season_year: number;
    staged_date: string;
    notes: string | null;
  },
  items: StagedDeliveryItemInsert[]
): Promise<CreateStagedDeliveryResult> {
  const supabase = getSupabaseBrowserClient();

  const { data: headerData, error: headerError } = await supabase
    .from("staged_deliveries")
    .insert(header)
    .select("id")
    .single();

  if (headerError || !headerData) {
    throw new Error(headerError?.message || "Failed to create staged delivery");
  }

  const itemRows = items.map((item) => ({
    staged_delivery_id: headerData.id,
    product_id: item.product_id,
    treatment_id: item.treatment_id,
    seed_size: item.seed_size,
    package_type: item.package_type,
    units_staged: item.units_staged,
  }));

  const { error: itemsError } = await supabase
    .from("staged_delivery_items")
    .insert(itemRows);

  if (itemsError) {
    throw new Error(itemsError.message || "Failed to create staged delivery items");
  }

  return { id: headerData.id };
}

export interface StagedDeliveryRow {
  staged_delivery_id: string;
  staged_delivery_item_id: string;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  season_year: number;
  staged_date: string;
  notes: string | null;
  status: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  package_type: string;
  units_staged: number;
  created_at: string;
}

export async function fetchStagedDeliveries(): Promise<StagedDeliveryRow[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_staged_deliveries")
    .select("*")
    .eq("status", "in_progress")
    .order("staged_date", { ascending: false })
    .order("customer_name", { ascending: true });

  if (error) throw new Error(error.message || "Failed to load staged deliveries");
  return (data ?? []) as StagedDeliveryRow[];
}

export async function cancelStagedDelivery(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("staged_deliveries")
    .update({ status: "cancelled" })
    .eq("id", id);

  if (error) throw new Error(error.message || "Failed to cancel staged delivery");
}

export interface ConvertStagedDeliveryResult {
  deliveryRowsCreated: number;
}

export async function convertStagedDelivery(
  stagedDeliveryId: string
): Promise<ConvertStagedDeliveryResult> {
  const supabase = getSupabaseBrowserClient();

  // Re-fetch header to prevent duplicate conversion
  const { data: header, error: headerError } = await supabase
    .from("staged_deliveries")
    .select("id, customer_id, season_year, staged_date, notes, status")
    .eq("id", stagedDeliveryId)
    .single();

  if (headerError || !header) {
    throw new Error(headerError?.message || "Staged delivery not found");
  }
  if (header.status !== "in_progress") {
    throw new Error(
      `This staged delivery has already been ${header.status}. Please refresh the list.`
    );
  }

  // Fetch items fresh from DB
  const { data: items, error: itemsError } = await supabase
    .from("staged_delivery_items")
    .select("product_id, treatment_id, seed_size, package_type, units_staged")
    .eq("staged_delivery_id", stagedDeliveryId);

  if (itemsError) throw new Error(itemsError.message || "Failed to fetch staged items");
  if (!items || items.length === 0) throw new Error("No items found for this staged delivery");

  // Build lines for order matching (same allocation as delivery page)
  const lines: LineToMatch[] = items.map((item) => ({
    product_id: item.product_id as string,
    treatment_id: item.treatment_id as string,
    seed_size: (item.seed_size as string | null) ?? null,
    package_type: item.package_type as string,
    units: item.units_staged as number,
  }));

  const allocationsPerLine = await findOrderLineMatches(
    header.customer_id as string,
    header.season_year as number,
    lines
  );

  // Build delivery insert rows — linked allocations first, remainder unlinked
  const deliveryRows: DeliveryInsert[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const allocations = allocationsPerLine[i];
    const shared = {
      delivery_date: header.staged_date as string,
      season_year: header.season_year as number,
      customer_id: header.customer_id as string,
      product_id: item.product_id as string,
      treatment_id: item.treatment_id as string,
      seed_size: (item.seed_size as string | null) ?? null,
      package_type: item.package_type as string,
      notes: (header.notes as string | null) ?? null,
    };

    if (allocations.length === 0) {
      deliveryRows.push({ ...shared, units_delivered: item.units_staged as number, order_id: null, order_item_id: null });
    } else {
      let allocated = 0;
      for (const alloc of allocations) {
        deliveryRows.push({ ...shared, units_delivered: alloc.units, order_id: alloc.order_id, order_item_id: alloc.order_item_id });
        allocated += alloc.units;
      }
      const remainder = (item.units_staged as number) - allocated;
      if (remainder > 0) {
        deliveryRows.push({ ...shared, units_delivered: remainder, order_id: null, order_item_id: null });
      }
    }
  }

  // Create actual deliveries — if this fails, staged delivery stays in_progress
  const result = await createDeliveries(deliveryRows);

  // Mark as converted — if this fails after delivery creation, report the state clearly
  const { error: updateError } = await supabase
    .from("staged_deliveries")
    .update({ status: "converted", converted_at: new Date().toISOString() })
    .eq("id", stagedDeliveryId)
    .eq("status", "in_progress");

  if (updateError) {
    throw new Error(
      "Delivery was created but could not be marked as converted. " +
      "Check the Deliveries page and refresh this list."
    );
  }

  return { deliveryRowsCreated: result.ids.length };
}
