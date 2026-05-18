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
  delivery_header_id?: string | null;
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

/* ---- Create a delivery header + linked delivery rows ---- */

export interface DeliveryHeaderInsert {
  customer_id: string;
  delivery_date: string;
  season_year: number;
  notes: string | null;
}

export interface CreateDeliveryWithHeaderResult {
  header_id: string;
  ids: string[];
}

export async function createDeliveryWithHeader(
  header: DeliveryHeaderInsert,
  rows: DeliveryInsert[]
): Promise<CreateDeliveryWithHeaderResult> {
  const supabase = getSupabaseBrowserClient();

  // Insert the header row first
  const { data: headerData, error: headerErr } = await supabase
    .from("delivery_headers")
    .insert(header)
    .select("id")
    .single();

  if (headerErr || !headerData) {
    throw new Error(headerErr?.message ?? "Failed to create delivery header");
  }

  const headerId = (headerData as { id: string }).id;

  // Attach header_id to every delivery row then insert
  const rowsWithHeader = rows.map((r) => ({ ...r, delivery_header_id: headerId }));

  const { data: insertedRows, error: rowsErr } = await supabase
    .from("deliveries")
    .insert(rowsWithHeader)
    .select("id");

  if (rowsErr || !insertedRows) {
    throw new Error(rowsErr?.message ?? "Failed to insert delivery rows");
  }

  return {
    header_id: headerId,
    ids: (insertedRows as Array<{ id: string }>).map((r) => r.id),
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
  delivery_header_id: string | null;
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
    const dateCompare = b.delivery_date.localeCompare(a.delivery_date);
    if (dateCompare !== 0) return dateCompare;
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

/* ---- Fetch all rows belonging to the same save batch ---- */

export interface DeliveryGroupItem {
  delivery_id: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  units_delivered: number;
  seed_size: string | null;
  package_type: string;
}

export interface DeliveryGroup {
  header_id: string | null;
  customer_id: string;
  delivery_date: string;
  season_year: number;
  notes: string | null;
  items: DeliveryGroupItem[];
}

export async function fetchDeliveryGroup(deliveryId: string): Promise<DeliveryGroup | null> {
  const supabase = getSupabaseBrowserClient();

  const { data: anchorRows, error: anchorErr } = await supabase
    .from("v_deliveries_this_season")
    .select("customer_id, delivery_date, season_year, notes, created_at, delivery_header_id")
    .eq("delivery_id", deliveryId)
    .limit(1);

  if (anchorErr || !anchorRows || anchorRows.length === 0) return null;

  const anchor = anchorRows[0] as {
    customer_id: string;
    delivery_date: string;
    season_year: number;
    notes: string | null;
    created_at: string;
    delivery_header_id: string | null;
  };

  const headerId = anchor.delivery_header_id;

  // Build sibling query: use header_id when present, fall back to created_at for legacy rows
  let q = supabase
    .from("v_deliveries_this_season")
    .select("delivery_id, product_id, product_name, treatment_id, treatment_name, units_delivered, seed_size, package_type");

  if (headerId) {
    q = q.eq("delivery_header_id", headerId);
  } else {
    q = q
      .eq("customer_id", anchor.customer_id)
      .eq("delivery_date", anchor.delivery_date)
      .eq("season_year", anchor.season_year)
      .eq("created_at", anchor.created_at);

    if (anchor.notes === null) {
      q = q.is("notes", null);
    } else {
      q = q.eq("notes", anchor.notes);
    }
  }

  const { data: siblings, error: sibErr } = await q;
  if (sibErr || !siblings) return null;

  return {
    header_id: headerId,
    customer_id: anchor.customer_id,
    delivery_date: anchor.delivery_date,
    season_year: anchor.season_year,
    notes: anchor.notes,
    items: siblings as DeliveryGroupItem[],
  };
}

/* ---- Apply group-level edits (updates + deletes + inserts) ---- */

export interface GroupEditPayload {
  header_id: string | null;
  updates: Array<{ id: string; data: DeliveryUpdate }>;
  deletes: string[];
  inserts: DeliveryInsert[];
}

export async function applyDeliveryGroupEdits(payload: GroupEditPayload): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  // Update the header record when this is a headed delivery
  if (payload.header_id) {
    const rep = payload.updates[0]?.data ?? payload.inserts[0];
    if (rep) {
      const { error } = await supabase
        .from("delivery_headers")
        .update({
          customer_id: rep.customer_id ?? (rep as DeliveryUpdate).customer_id,
          delivery_date: rep.delivery_date,
          notes: rep.notes ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.header_id);
      if (error) throw new Error(error.message || "Failed to update delivery header");
    }
  }

  for (const id of payload.deletes) {
    const { error } = await supabase.from("deliveries").delete().eq("id", id);
    if (error) throw new Error(error.message || "Failed to delete delivery row");
  }

  for (const { id, data } of payload.updates) {
    const { error } = await supabase.from("deliveries").update(data).eq("id", id);
    if (error) throw new Error(error.message || "Failed to update delivery row");
  }

  if (payload.inserts.length > 0) {
    const inserts = payload.header_id
      ? payload.inserts.map((r) => ({ ...r, delivery_header_id: payload.header_id }))
      : payload.inserts;
    const { error } = await supabase.from("deliveries").insert(inserts);
    if (error) throw new Error(error.message || "Failed to insert delivery rows");
  }
}
