import { getSupabaseBrowserClient } from "@/lib/supabase/browserClient";

export interface CustomerOption {
  id: string;
  customer_name: string;
  farm_name: string | null;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  tsa_number: string | null;
}

export async function fetchCustomers(): Promise<CustomerOption[]> {
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("customers")
    .select("id, customer_name, farm_name, phone_number, address, city, province, postal_code, tsa_number")
    .order("customer_name", { ascending: true });

  if (error) throw new Error(error.message || "Failed to load customers");
  return (data ?? []) as CustomerOption[];
}

export interface InsertCustomerPayload {
  customer_name: string;
  phone_number: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  farm_name?: string;
  tsa_number?: string;
}

export interface InsertedCustomer {
  id: string;
  customer_name: string;
}

export async function insertCustomer(
  payload: InsertCustomerPayload
): Promise<InsertedCustomer> {
  const sb = getSupabaseBrowserClient();

  const row: Record<string, string> = {
    customer_name: payload.customer_name.trim(),
    phone_number: payload.phone_number.trim(),
    address: payload.address.trim(),
    city: payload.city.trim(),
    province: payload.province.trim(),
    postal_code: payload.postal_code.trim(),
  };
  if (payload.farm_name?.trim()) row.farm_name = payload.farm_name.trim();
  if (payload.tsa_number?.trim()) row.tsa_number = payload.tsa_number.trim();

  const { data, error } = await sb
    .from("customers")
    .insert(row)
    .select("id, customer_name")
    .single();

  if (error) {
    if (
      error.code === "23505" ||
      error.message?.toLowerCase().includes("unique") ||
      error.message?.toLowerCase().includes("duplicate")
    ) {
      throw new Error("Customer name already exists");
    }
    throw new Error(error.message || "Failed to save customer");
  }

  return data as InsertedCustomer;
}
