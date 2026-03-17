import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export type InventoryWideRow = Record<string, string | number | null>;

export interface InventoryDetailRow {
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  seed_size: string | null;
  units_received: number;
  units_delivered: number;
  units_returned: number;
  units_on_hand: number;
}

export async function fetchInventoryWide(): Promise<InventoryWideRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_on_hand_inventory_wide")
    .select("*");

  if (error) throw new Error(error.message || "Failed to load inventory");
  return (data ?? []) as InventoryWideRow[];
}

export async function fetchInventoryDetail(): Promise<InventoryDetailRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_on_hand_inventory")
    .select("*");

  if (error) throw new Error(error.message || "Failed to load inventory detail");

  const rows = (data ?? []) as InventoryDetailRow[];
  rows.sort((a, b) => {
    const p = a.product_name.localeCompare(b.product_name);
    if (p !== 0) return p;
    const t = a.treatment_name.localeCompare(b.treatment_name);
    if (t !== 0) return t;
    return (a.seed_size ?? "").localeCompare(b.seed_size ?? "");
  });
  return rows;
}
