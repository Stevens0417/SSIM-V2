import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface AdjustmentRow {
  season_year: number;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  treatment_id: string;
  treatment_name: string;
  early_pay_bucket: string;
  early_pay_pct: number | null;
  units_ordered: number;
  units_delivered: number;
  units_returned: number;
  net_units: number;
  is_completed: boolean;
  completed_at: string | null;
}

export async function fetchAdjustments(
  seasonYear: number
): Promise<AdjustmentRow[]> {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase
    .from("v_year_end_adjustments")
    .select("*")
    .eq("season_year", seasonYear);

  if (error) {
    throw new Error(error.message || "Failed to load adjustments");
  }

  const rows = (data ?? []) as AdjustmentRow[];
  rows.sort((a, b) => {
    const cust = a.customer_name.localeCompare(b.customer_name);
    if (cust !== 0) return cust;
    const prod = a.product_name.localeCompare(b.product_name);
    if (prod !== 0) return prod;
    return a.treatment_name.localeCompare(b.treatment_name);
  });

  return rows;
}

export interface AdjustmentCheckKey {
  season_year: number;
  customer_id: string;
  product_id: string;
  treatment_id: string;
  early_pay_bucket: string;
}

export async function upsertAdjustmentCheck(
  key: AdjustmentCheckKey,
  isCompleted: boolean
): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const { error } = await supabase
    .from("invoice_adjustment_checks")
    .upsert(
      {
        ...key,
        is_completed: isCompleted,
        completed_at: isCompleted ? new Date().toISOString() : null,
      },
      {
        onConflict:
          "season_year,customer_id,product_id,treatment_id,early_pay_bucket",
      }
    );

  if (error) {
    throw new Error(error.message || "Failed to save adjustment check");
  }
}
