import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface PackagingProduct {
  id: string;
  product_name: string;
}

export async function fetchPackagingProducts(): Promise<PackagingProduct[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, product_name")
    .eq("crop", "packaging")
    .order("product_name");

  if (error) throw new Error(error.message || "Failed to load packaging products");
  return (data ?? []) as PackagingProduct[];
}

export async function fetchNoTreatmentId(): Promise<string | null> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("treatments")
    .select("id")
    .eq("treatment_name", "NO_TREATMENT")
    .maybeSingle();

  if (error) {
    console.error("[fetchNoTreatmentId] Supabase error:", error.message);
    return null;
  }
  return data?.id ?? null;
}
