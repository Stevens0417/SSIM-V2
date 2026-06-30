import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

// ============================================================
// Crop Customer Movement Summary
//
// Powers the Corn Summary and Bean Summary tabs on the
// Adjustments page. Movement-only (no orders/pricing) — reads the
// season-level summary view:
//   v_crop_customer_movement_summary
//
// Grain: customer + farm name + package type. Product/variety,
// treatment, and seed size are aggregated away by the view.
//
// The view already:
//   - excludes packaging products (products.crop = 'packaging')
//   - normalizes crop into crop_group ('corn' | 'beans')
//   - computes net_units = delivered + replanted - returned
//
// Tabs filter by crop_group. Totals shown at the top of each tab
// are computed client-side from the (optionally filtered) rows so
// they always match the visible table.
// ============================================================

export type CropGroup = "corn" | "beans";

export interface CropMovementRow {
  user_id: string;
  season_year: number;
  crop_group: string;
  customer_id: string;
  customer_name: string;
  farm_name: string | null;
  package_type: string;
  units_delivered: number;
  units_returned: number;
  units_replanted: number;
  net_units: number;
}

export interface CropMovementTotals {
  totalDelivered: number;
  totalReturned: number;
  totalReplanted: number;
  // netUnits = delivered + replanted - returned
  netUnits: number;
  customerCount: number;
  packageCount: number;
}

/**
 * Sum delivered / returned / replanted units and count distinct
 * customers and package types across the given rows.
 *
 * Computed from whatever rows are passed in (after search filtering)
 * so the KPI cards always match the visible table.
 *
 * Pure function — exported for unit testing.
 */
export function computeCropMovementTotals(
  rows: CropMovementRow[]
): CropMovementTotals {
  let totalDelivered = 0;
  let totalReturned = 0;
  let totalReplanted = 0;
  const customers = new Set<string>();
  const packages = new Set<string>();

  for (const r of rows) {
    totalDelivered += r.units_delivered ?? 0;
    totalReturned += r.units_returned ?? 0;
    totalReplanted += r.units_replanted ?? 0;
    customers.add(r.customer_id);
    packages.add(r.package_type);
  }

  return {
    totalDelivered,
    totalReturned,
    totalReplanted,
    netUnits: totalDelivered + totalReplanted - totalReturned,
    customerCount: customers.size,
    packageCount: packages.size,
  };
}

/**
 * Default sort: customer asc, then farm name asc, then package type asc.
 *
 * Pure function — exported for unit testing.
 */
export function sortCropMovementRows(
  rows: CropMovementRow[]
): CropMovementRow[] {
  return [...rows].sort((a, b) => {
    const c = a.customer_name.localeCompare(b.customer_name);
    if (c !== 0) return c;
    const f = (a.farm_name ?? "").localeCompare(b.farm_name ?? "");
    if (f !== 0) return f;
    return a.package_type.localeCompare(b.package_type);
  });
}

export async function fetchCropMovementSummary(
  seasonYear: number,
  cropGroup: CropGroup
): Promise<CropMovementRow[]> {
  const sb = getSupabaseBrowserClient();

  const { data, error } = await sb
    .from("v_crop_customer_movement_summary")
    .select("*")
    .eq("season_year", seasonYear)
    .eq("crop_group", cropGroup);

  if (error) {
    throw new Error(error.message || "Failed to load crop movement summary");
  }

  return sortCropMovementRows((data ?? []) as CropMovementRow[]);
}
