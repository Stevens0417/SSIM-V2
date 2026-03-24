import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface ReplantEntryInsert {
  replant_date: string;
  season_year: number;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  units_replanted: number;
  seed_size: string | null;
  package_type: string;
  order_id: string | null;
  order_item_id: string | null;
  notes: string | null;
}

export interface CreateReplantEntriesResult {
  ids: string[];
}

export async function createReplantEntries(
  rows: ReplantEntryInsert[]
): Promise<CreateReplantEntriesResult> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("replants")
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
  replant_id: string;
  replant_date: string;
  season_year: number;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  units_replanted: number;
  seed_size: string | null;
  package_type: string;
  order_id: string | null;
  order_item_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchReplantsThisSeason(): Promise<ReplantViewRow[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_replants_this_season")
    .select("*");

  if (error) {
    throw new Error(error.message || "Failed to load replants");
  }

  // Sort client-side: replant_date DESC, then customer_name ASC
  const rows = (data ?? []) as ReplantViewRow[];
  rows.sort((a, b) => {
    const dateCompare = b.replant_date.localeCompare(a.replant_date);
    if (dateCompare !== 0) return dateCompare;
    return a.customer_name.localeCompare(b.customer_name);
  });

  return rows;
}

/* ---- Update a replant ---- */

export interface ReplantEntryUpdate {
  replant_date: string;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  units_replanted: number;
  seed_size: string | null;
  package_type: string;
  notes: string | null;
}

export async function updateReplantEntry(
  replantId: string,
  updates: ReplantEntryUpdate
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("replants")
    .update(updates)
    .eq("id", replantId);

  if (error) {
    throw new Error(error.message || "Failed to update replant");
  }
}

/* ---- Delete a replant ---- */

export async function deleteReplantEntry(replantId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("replants")
    .delete()
    .eq("id", replantId);

  if (error) {
    throw new Error(error.message || "Failed to delete replant");
  }
}
