import { getSupabaseBrowserClient } from "@/lib/supabase";

export async function fetchSeasons(): Promise<number[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_pricing_seasons")
    .select("season_year");

  if (error) throw error;
  return (data ?? []).map((r) => r.season_year as number);
}

export async function fetchNewestSeasonYear(): Promise<number | null> {
  const seasons = await fetchSeasons();
  return seasons.length > 0 ? seasons[0] : null; // already ordered desc
}

export interface PricingOption {
  season_year: number;
  product_id: string;
  product_name: string;
  crop: string;
  chu: string | null;
  seed_trait: string | null;
  treatment_id: string;
  treatment_name: string;
  retail_price: number;
  break_even_price: number | null;
}

export async function fetchPricingOptions(
  seasonYear: number
): Promise<PricingOption[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_pricing_options")
    .select("*")
    .eq("season_year", seasonYear);

  if (error) throw error;
  return (data ?? []) as PricingOption[];
}

export type PricingRow = Record<string, string | number | null>;

export async function fetchPricingWide(
  seasonYear: number
): Promise<PricingRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_pricing_sheet_wide")
    .select("*")
    .eq("season_year", seasonYear);

  if (error) throw error;
  return (data ?? []) as PricingRow[];
}

export async function fetchBreakEvenWide(
  seasonYear: number
): Promise<PricingRow[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("v_pricing_break_even_wide")
    .select("*")
    .eq("season_year", seasonYear);

  if (error) throw error;
  return (data ?? []) as PricingRow[];
}
