import type { SupabaseClient } from "@supabase/supabase-js";

export type SeasonSource = "explicit" | "active_season" | "latest_user_data" | "none";

export interface DefaultSeasonResult {
  season_year: number | null;
  season_source: Exclude<SeasonSource, "explicit">;
}

/**
 * Returns true only if the user's raw message text contains that specific 4-digit year.
 *
 * Used to reject model-hallucinated seasonYear values: GPT-4o-mini frequently
 * injects a year from its training data (e.g. 2023) even when the user never
 * mentioned one. We only honour the model-provided year when the user's message
 * actually contains it as a standalone 4-digit token.
 */
export function isYearMentionedByUser(userMessage: string, year: number): boolean {
  // Match the year as a whole word / standalone number so "2023" doesn't match "20230"
  return new RegExp(`\\b${year}\\b`).test(userMessage);
}

/**
 * Resolves the default season year for the authenticated user.
 *
 * Priority:
 *   1. Latest season_year the user has orders for (user-scoped via RLS on userClient)
 *   2. Active pricing season from v_pricing_seasons (global, no user scope)
 *   3. null — no season data found at all
 *
 * Why orders first: a user may be entering orders for a new season before
 * pricing data is fully configured, which would cause the pricing-based fallback
 * to return a stale year.
 */
export async function resolveDefaultSeasonForUser(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient
): Promise<DefaultSeasonResult> {
  // 1. Latest season from user's orders — JWT in userClient ensures RLS filters to auth.uid()
  try {
    const { data, error } = await userClient
      .from("orders")
      .select("season_year")
      .order("season_year", { ascending: false })
      .limit(1);
    if (!error) {
      const year = (data as unknown as Array<{ season_year: number }>)?.[0]?.season_year;
      if (year) {
        return { season_year: year, season_source: "latest_user_data" };
      }
    }
  } catch {
    // fall through
  }

  // 2. Active season from global pricing config
  try {
    const { data, error } = await serviceClient
      .from("v_pricing_seasons")
      .select("season_year")
      .limit(1);
    if (!error) {
      const year = (data as unknown as Array<{ season_year: number }>)?.[0]?.season_year;
      if (year) {
        return { season_year: year, season_source: "active_season" };
      }
    }
  } catch {
    // fall through
  }

  return { season_year: null, season_source: "none" };
}
