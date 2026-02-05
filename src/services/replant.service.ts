import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface ReplantInsert {
  return_date: string;
  season_year: number;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  units_returned: number;
  order_id: string | null;
  order_item_id: string | null;
  notes: string | null;
}

export interface CreateReplantsResult {
  ids: string[];
}

export async function createReplants(
  rows: ReplantInsert[]
): Promise<CreateReplantsResult> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("returns")
    .insert(rows)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  return {
    ids: (data ?? []).map((row: { id: string }) => row.id),
  };
}

/* ---- Fetch replants from view ---- */

export interface ReplantViewRow {
  return_id: string;
  return_date: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  units_returned: number;
  order_id: string | null;
  order_item_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchReplantsThisSeason(): Promise<ReplantViewRow[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_returns_this_season")
    .select("*");

  if (error) {
    throw new Error(error.message || "Failed to load replants");
  }

  // Sort client-side: return_date DESC, then customer_name ASC
  const rows = (data ?? []) as ReplantViewRow[];
  rows.sort((a, b) => {
    // Date descending
    const dateCompare = b.return_date.localeCompare(a.return_date);
    if (dateCompare !== 0) return dateCompare;
    // Customer ascending
    return a.customer_name.localeCompare(b.customer_name);
  });

  return rows;
}

/* ---- Update a replant ---- */

export interface ReplantUpdate {
  return_date: string;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  units_returned: number;
  notes: string | null;
}

export async function updateReplant(
  returnId: string,
  updates: ReplantUpdate
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("returns")
    .update(updates)
    .eq("id", returnId);

  if (error) {
    throw new Error(error.message || "Failed to update replant");
  }
}

/* ---- Delete a replant ---- */

export async function deleteReplant(returnId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("returns")
    .delete()
    .eq("id", returnId);

  if (error) {
    throw new Error(error.message || "Failed to delete replant");
  }
}
