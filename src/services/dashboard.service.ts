import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

/* ---- Seasons ---- */

export async function fetchDashboardSeasons(): Promise<number[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_all_seasons")
    .select("season_year");

  if (error) throw new Error(error.message || "Failed to load seasons");
  return (data ?? []).map((r) => r.season_year as number);
}

/* ---- KPIs ---- */

export interface DashboardKpis {
  season_year: number;
  total_units_sold: number;
  total_sales: number;
  total_profit: number;
  total_discounts_given: number;
  avg_price_per_unit: number;
  avg_profit_per_unit: number;
}

export async function fetchDashboardKpis(
  seasonYear: number
): Promise<DashboardKpis | null> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_dashboard_kpis_by_season")
    .select("*")
    .eq("season_year", seasonYear)
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to load KPIs");
  return (data as DashboardKpis) ?? null;
}

/* ---- KPIs by Crop ---- */

export interface CropKpis {
  season_year: number;
  crop: string;
  total_units_sold: number;
  total_sales: number;
  total_profit: number;
  total_discounts_given: number;
  avg_price_per_unit: number;
  avg_profit_per_unit: number;
}

export async function fetchCropKpis(
  seasonYear: number
): Promise<CropKpis[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_dashboard_kpis_by_season_crop")
    .select("*")
    .eq("season_year", seasonYear);

  if (error) throw new Error(error.message || "Failed to load crop KPIs");
  return (data ?? []) as CropKpis[];
}

/* ---- Treatment Mix by Crop ---- */

export interface TreatmentMixRow {
  season_year: number;
  crop: string;
  treatment_name: string;
  total_units: number;
  total_sales: number;
  total_profit: number;
}

export async function fetchTreatmentMix(
  seasonYear: number
): Promise<TreatmentMixRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_dashboard_treatment_mix_by_season_crop")
    .select("*")
    .eq("season_year", seasonYear);

  if (error) throw new Error(error.message || "Failed to load treatment mix");
  return (data ?? []) as TreatmentMixRow[];
}

/* ---- Customer Volume Buckets ---- */

export interface VolumeBucketRow {
  season_year: number;
  crop: string;
  volume_bucket: string;
  customer_count: number;
  bucket_total_units: number;
  bucket_total_sales: number;
  avg_price_per_unit: number;
  bucket_total_profit: number;
}

export async function fetchVolumeBuckets(
  seasonYear: number
): Promise<VolumeBucketRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_dashboard_customer_volume_buckets_by_season_crop")
    .select("*")
    .eq("season_year", seasonYear)
    .order("volume_bucket", { ascending: true });

  if (error) throw new Error(error.message || "Failed to load volume buckets");
  return (data ?? []) as VolumeBucketRow[];
}
