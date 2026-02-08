import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface ShipmentHeaderInsert {
  shipment_date: string;
  shipment_number: string;
}

export interface ShipmentItemInsert {
  shipment_id: string;
  product_id: string;
  treatment_id: string;
  units_received: number;
}

export interface CreateShipmentResult {
  shipmentId: string;
  itemCount: number;
}

export async function createBayerShipment(
  header: ShipmentHeaderInsert,
  items: Omit<ShipmentItemInsert, "shipment_id">[]
): Promise<CreateShipmentResult> {
  const supabase = getSupabaseBrowserClient();

  // 1) Insert shipment header
  const { data: shipmentData, error: shipmentError } = await supabase
    .from("bayer_shipments")
    .insert({
      shipment_date: header.shipment_date,
      shipment_number: header.shipment_number,
    })
    .select("id")
    .single();

  if (shipmentError) {
    throw new Error(shipmentError.message || "Failed to create shipment");
  }

  const shipmentId = shipmentData.id as string;

  // 2) Insert shipment items
  const itemRows: ShipmentItemInsert[] = items.map((it) => ({
    shipment_id: shipmentId,
    product_id: it.product_id,
    treatment_id: it.treatment_id,
    units_received: it.units_received,
  }));

  const { error: itemsError } = await supabase
    .from("bayer_shipment_items")
    .insert(itemRows);

  if (itemsError) {
    throw new Error(itemsError.message || "Failed to create shipment items");
  }

  return { shipmentId, itemCount: itemRows.length };
}

/* ---- Fetch seasons from v_all_seasons ---- */

export async function fetchShipmentSeasons(): Promise<number[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_all_seasons")
    .select("season_year");

  if (error) throw new Error(error.message || "Failed to load seasons");
  return (data ?? []).map((r) => r.season_year as number);
}

/* ---- Fetch shipments from view ---- */

export interface ShipmentViewRow {
  shipment_id: string;
  shipment_date: string;
  season_year: number;
  shipment_number: string;
  shipment_item_id: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  units_received: number;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchBayerShipments(
  seasonYear: number
): Promise<ShipmentViewRow[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_bayer_shipments")
    .select("*")
    .eq("season_year", seasonYear);

  if (error) {
    throw new Error(error.message || "Failed to load shipments");
  }

  const rows = (data ?? []) as ShipmentViewRow[];
  rows.sort((a, b) => {
    const dateCompare = b.shipment_date.localeCompare(a.shipment_date);
    if (dateCompare !== 0) return dateCompare;
    return a.shipment_number.localeCompare(b.shipment_number);
  });

  return rows;
}

/* ---- Update a shipment (header + replace items) ---- */

export async function updateBayerShipment(
  shipmentId: string,
  header: ShipmentHeaderInsert,
  items: Omit<ShipmentItemInsert, "shipment_id">[]
): Promise<CreateShipmentResult> {
  const supabase = getSupabaseBrowserClient();

  // 1) Update shipment header
  const { error: headerError } = await supabase
    .from("bayer_shipments")
    .update({
      shipment_date: header.shipment_date,
      shipment_number: header.shipment_number,
    })
    .eq("id", shipmentId);

  if (headerError) {
    throw new Error(headerError.message || "Failed to update shipment");
  }

  // 2) Delete existing items
  const { error: deleteError } = await supabase
    .from("bayer_shipment_items")
    .delete()
    .eq("shipment_id", shipmentId);

  if (deleteError) {
    throw new Error(deleteError.message || "Failed to replace shipment items");
  }

  // 3) Insert fresh items
  const itemRows: ShipmentItemInsert[] = items.map((it) => ({
    shipment_id: shipmentId,
    product_id: it.product_id,
    treatment_id: it.treatment_id,
    units_received: it.units_received,
  }));

  const { error: itemsError } = await supabase
    .from("bayer_shipment_items")
    .insert(itemRows);

  if (itemsError) {
    throw new Error(itemsError.message || "Failed to insert shipment items");
  }

  return { shipmentId, itemCount: itemRows.length };
}

/* ---- Delete a shipment (cascade deletes items) ---- */

export async function deleteBayerShipment(
  shipmentId: string
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("bayer_shipments")
    .delete()
    .eq("id", shipmentId);

  if (error) {
    throw new Error(error.message || "Failed to delete shipment");
  }
}

/* ---- Toggle verification on a shipment item ---- */

export async function verifyShipmentItem(
  shipmentItemId: string,
  verified: boolean
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  // Only send is_verified — the DB trigger
  // (trg_bayer_shipment_items_verified_meta) auto-sets
  // verified_at and verified_by (uuid FK to auth.users).
  const { error } = await supabase
    .from("bayer_shipment_items")
    .update({ is_verified: verified })
    .eq("id", shipmentItemId);

  if (error) {
    console.error("[verifyShipmentItem] Supabase error:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      shipmentItemId,
      verified,
    });
    throw new Error(
      error.message || "Failed to update verification status"
    );
  }
}
