import { tool, jsonSchema } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDefaultSeasonForUser,
  isYearMentionedByUser,
  type SeasonSource,
} from "./resolve-season";
import {
  resolveAgentDate,
  type DateSource,
} from "./resolve-date";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDbPackageType(input: string): string {
  const lc = input.toLowerCase().trim();
  if (lc === "seedpak" || lc === "tote") return "tote";
  return "bag";
}

function toDisplayPackageType(db: string): string {
  return db === "tote" ? "Seedpak" : "Bag";
}

// ─── Input types ──────────────────────────────────────────────────────────────

interface DraftItemInput {
  productName: string;
  treatmentName: string;
  units: number;
  seedSize?: string;
  packageType?: string;
}

interface ToolInput {
  customerName: string;
  deliveryDate: string;
  seasonYear?: number;
  items: DraftItemInput[];
  notes?: string;
}

// ─── Output types ─────────────────────────────────────────────────────────────

interface CustomerDraft {
  input: string | null;
  resolved_customer_id: string | null;
  resolved_customer_name: string | null;
  farm_name: string | null;
  status: "resolved" | "missing" | "ambiguous";
  candidates?: Array<{
    customer_id: string;
    customer_name: string;
    farm_name: string | null;
  }>;
}

interface DateDraft {
  input: string | null;
  resolved_date: string;
  date_source: DateSource;
  user_explicitly_requested_date: boolean;
  status: "resolved" | "missing";
}

interface SeasonDraft {
  resolved_season_year: number | null;
  season_source: SeasonSource;
  status: "resolved" | "missing";
}

interface ProductDraft {
  input: string | null;
  resolved_product_id: string | null;
  resolved_product_name: string | null;
  status: "resolved" | "missing" | "ambiguous";
  options?: string[];
}

interface TreatmentDraft {
  input: string | null;
  resolved_treatment_id: string | null;
  resolved_treatment_name: string | null;
  status: "resolved" | "missing" | "ambiguous";
  options?: string[];
}

interface SeedSizeDraft {
  input: string | null;
  resolved_seed_size: string | null;
  status: "resolved" | "missing" | "not_required" | "ambiguous";
  options: string[];
}

interface PackageTypeDraft {
  input: string | null;
  resolved_package_type: string | null;
  status: "resolved" | "missing" | "ambiguous";
  options: string[];
}

interface UnitsDraft {
  input: number | null;
  resolved_units: number | null;
  status: "resolved" | "missing" | "invalid";
}

interface ResolvedItem {
  line_index: number;
  product: ProductDraft;
  treatment: TreatmentDraft;
  seed_size: SeedSizeDraft;
  package_type: PackageTypeDraft;
  units_delivered: UnitsDraft;
  warnings: string[];
}

interface ToolOutput {
  customer: CustomerDraft;
  delivery_date: DateDraft;
  season_year: SeasonDraft;
  items: ResolvedItem[];
  missing_fields: string[];
  warnings: string[];
  ready_for_confirmation: boolean;
  draft_id?: string;
  tool_error?: boolean;
  tool_error_message?: string;
}

// Internal pricing row shape from v_pricing_options
interface PricingRow {
  product_id: string;
  product_name: string;
  crop: string;
  treatment_id: string;
  treatment_name: string;
}

// ─── Customer resolution (three-step matching) ────────────────────────────────

type CustomerRow = { id: string; customer_name: string; farm_name: string | null };

function candidatesFromRows(
  input: string,
  rows: CustomerRow[]
): CustomerDraft {
  if (rows.length === 1) {
    return {
      input,
      resolved_customer_id: rows[0].id,
      resolved_customer_name: rows[0].customer_name,
      farm_name: rows[0].farm_name,
      status: "resolved",
    };
  }
  return {
    input,
    resolved_customer_id: null,
    resolved_customer_name: null,
    farm_name: null,
    status: "ambiguous",
    candidates: rows.map((r) => ({
      customer_id: r.id,
      customer_name: r.customer_name,
      farm_name: r.farm_name,
    })),
  };
}

async function resolveCustomer(
  userClient: SupabaseClient,
  customerName: string
): Promise<CustomerDraft> {
  const SELECT = "id, customer_name, farm_name";

  // Step 1 — exact customer_name (ILIKE without wildcards = case-insensitive exact)
  const { data: d1, error: e1 } = await userClient
    .from("customers")
    .select(SELECT)
    .ilike("customer_name", customerName);
  if (e1) throw new Error(e1.message);
  const r1 = (d1 ?? []) as CustomerRow[];
  if (r1.length >= 1) return candidatesFromRows(customerName, r1);

  // Step 2 — exact farm_name
  const { data: d2, error: e2 } = await userClient
    .from("customers")
    .select(SELECT)
    .ilike("farm_name", customerName);
  if (e2) throw new Error(e2.message);
  const r2 = (d2 ?? []) as CustomerRow[];
  if (r2.length >= 1) return candidatesFromRows(customerName, r2);

  // Step 3 — partial match on either field
  const { data: d3, error: e3 } = await userClient
    .from("customers")
    .select(SELECT)
    .or(`customer_name.ilike.%${customerName}%,farm_name.ilike.%${customerName}%`);
  if (e3) throw new Error(e3.message);
  const r3 = (d3 ?? []) as CustomerRow[];
  if (r3.length >= 1) return candidatesFromRows(customerName, r3);

  return {
    input: customerName,
    resolved_customer_id: null,
    resolved_customer_name: null,
    farm_name: null,
    status: "missing",
  };
}

// ─── Per-item resolution ──────────────────────────────────────────────────────

async function resolveItem(
  userClient: SupabaseClient,
  pricingRows: PricingRow[],
  item: DraftItemInput,
  lineIndex: number
): Promise<ResolvedItem> {
  const warnings: string[] = [];
  const PACKAGE_OPTIONS = ["Bag", "Seedpak"];

  // ── Product ──────────────────────────────────────────────────────────────
  const lowerProduct = item.productName.toLowerCase();
  const matchingProductRows = pricingRows.filter((r) =>
    r.product_name.toLowerCase().includes(lowerProduct)
  );

  const productMap = new Map<string, PricingRow>();
  for (const r of matchingProductRows) {
    if (!productMap.has(r.product_id)) productMap.set(r.product_id, r);
  }
  const uniqueProducts = [...productMap.values()];

  let productDraft: ProductDraft;
  let resolvedProductId: string | null = null;
  let resolvedCrop: string | null = null;

  if (uniqueProducts.length === 1) {
    productDraft = {
      input: item.productName,
      resolved_product_id: uniqueProducts[0].product_id,
      resolved_product_name: uniqueProducts[0].product_name,
      status: "resolved",
    };
    resolvedProductId = uniqueProducts[0].product_id;
    resolvedCrop = uniqueProducts[0].crop;
  } else if (uniqueProducts.length === 0) {
    productDraft = {
      input: item.productName,
      resolved_product_id: null,
      resolved_product_name: null,
      status: "missing",
    };
  } else {
    productDraft = {
      input: item.productName,
      resolved_product_id: null,
      resolved_product_name: null,
      status: "ambiguous",
      options: uniqueProducts.map((p) => p.product_name),
    };
  }

  // ── Treatment ─────────────────────────────────────────────────────────────
  let treatmentDraft: TreatmentDraft;
  let resolvedTreatmentId: string | null = null;
  let resolvedTreatmentName: string | null = null;

  if (resolvedProductId !== null) {
    const productPricingRows = pricingRows.filter(
      (r) => r.product_id === resolvedProductId
    );
    const allTreatmentNames = [
      ...new Set(productPricingRows.map((r) => r.treatment_name)),
    ].sort();

    const lowerTreatment = item.treatmentName.toLowerCase();
    const matchingTreatmentRows = productPricingRows.filter((r) =>
      r.treatment_name.toLowerCase().includes(lowerTreatment)
    );

    const treatmentMap = new Map<string, PricingRow>();
    for (const r of matchingTreatmentRows) {
      if (!treatmentMap.has(r.treatment_id)) treatmentMap.set(r.treatment_id, r);
    }
    const uniqueTreatments = [...treatmentMap.values()];

    if (uniqueTreatments.length === 1) {
      treatmentDraft = {
        input: item.treatmentName,
        resolved_treatment_id: uniqueTreatments[0].treatment_id,
        resolved_treatment_name: uniqueTreatments[0].treatment_name,
        status: "resolved",
      };
      resolvedTreatmentId = uniqueTreatments[0].treatment_id;
      resolvedTreatmentName = uniqueTreatments[0].treatment_name;
    } else if (uniqueTreatments.length === 0) {
      treatmentDraft = {
        input: item.treatmentName,
        resolved_treatment_id: null,
        resolved_treatment_name: null,
        status: "missing",
        options: allTreatmentNames,
      };
    } else {
      treatmentDraft = {
        input: item.treatmentName,
        resolved_treatment_id: null,
        resolved_treatment_name: null,
        status: "ambiguous",
        options: uniqueTreatments.map((t) => t.treatment_name),
      };
    }
  } else {
    treatmentDraft = {
      input: item.treatmentName,
      resolved_treatment_id: null,
      resolved_treatment_name: null,
      status: "missing",
    };
  }

  // ── Seed size ─────────────────────────────────────────────────────────────
  let seedSizeDraft: SeedSizeDraft;
  const isCorn = resolvedCrop?.toLowerCase() === "corn";

  if (!isCorn) {
    // Soybean and other non-corn products — seed size not required
    seedSizeDraft = {
      input: item.seedSize ?? null,
      resolved_seed_size: null,
      status: "not_required",
      options: [],
    };
  } else if (resolvedProductId === null || resolvedTreatmentId === null) {
    // Can't determine seed size options without a resolved product/treatment
    seedSizeDraft = {
      input: item.seedSize ?? null,
      resolved_seed_size: null,
      status: item.seedSize ? "resolved" : "missing",
      options: [],
    };
    if (item.seedSize) {
      (seedSizeDraft as SeedSizeDraft).resolved_seed_size =
        item.seedSize.toUpperCase().trim();
    }
  } else {
    // Corn with resolved product/treatment — fetch seed size options from inventory
    const { data: invSizes } = await userClient
      .from("v_on_hand_inventory")
      .select("seed_size")
      .eq("product_id", resolvedProductId)
      .eq("treatment_id", resolvedTreatmentId);

    const seedSizeOptions = [
      ...new Set(
        ((invSizes ?? []) as Array<{ seed_size: string | null }>)
          .map((r) => r.seed_size)
          .filter((s): s is string => s !== null && s.trim() !== "")
      ),
    ].sort();

    if (!item.seedSize) {
      seedSizeDraft = {
        input: null,
        resolved_seed_size: null,
        status: "missing",
        options: seedSizeOptions,
      };
    } else {
      const normalizedSize = item.seedSize.toUpperCase().trim();
      seedSizeDraft = {
        input: item.seedSize,
        resolved_seed_size: normalizedSize,
        status: "resolved",
        options: seedSizeOptions,
      };
      // Soft warning if size not found in current inventory
      if (seedSizeOptions.length > 0 && !seedSizeOptions.includes(normalizedSize)) {
        warnings.push(
          `Seed size "${normalizedSize}" for ${productDraft.resolved_product_name ?? item.productName} / ${resolvedTreatmentName ?? item.treatmentName} was not found in current inventory. Known sizes: ${seedSizeOptions.join(", ")}.`
        );
      }
    }
  }

  // ── Package type ──────────────────────────────────────────────────────────
  let packageTypeDraft: PackageTypeDraft;

  if (!item.packageType) {
    // Default to Bag when not specified
    packageTypeDraft = {
      input: null,
      resolved_package_type: "Bag",
      status: "resolved",
      options: PACKAGE_OPTIONS,
    };
  } else {
    const dbPkg = toDbPackageType(item.packageType);
    const displayPkg = toDisplayPackageType(dbPkg);
    packageTypeDraft = {
      input: item.packageType,
      resolved_package_type: displayPkg,
      status: "resolved",
      options: PACKAGE_OPTIONS,
    };
  }

  // ── Units ─────────────────────────────────────────────────────────────────
  let unitsDraft: UnitsDraft;

  if (item.units === null || item.units === undefined) {
    unitsDraft = { input: null, resolved_units: null, status: "missing" };
  } else if (Math.floor(item.units) !== item.units || item.units <= 0) {
    unitsDraft = { input: item.units, resolved_units: null, status: "invalid" };
  } else {
    unitsDraft = { input: item.units, resolved_units: item.units, status: "resolved" };
  }

  // ── Inventory availability check ──────────────────────────────────────────
  if (
    resolvedProductId !== null &&
    resolvedTreatmentId !== null &&
    unitsDraft.status === "resolved" &&
    unitsDraft.resolved_units !== null &&
    packageTypeDraft.resolved_package_type !== null
  ) {
    const dbPkg = toDbPackageType(packageTypeDraft.resolved_package_type);
    const resolvedSeedSize = seedSizeDraft.resolved_seed_size ?? null;

    // Build query — must match the exact (product, treatment, seed_size, package_type) key
    // that v_on_hand_inventory uses, including NULL seed_size via IS NULL
    let invAvailQuery = userClient
      .from("v_on_hand_inventory")
      .select("available_units")
      .eq("product_id", resolvedProductId)
      .eq("treatment_id", resolvedTreatmentId)
      .eq("package_type", dbPkg);

    if (resolvedSeedSize !== null) {
      invAvailQuery = invAvailQuery.eq("seed_size", resolvedSeedSize);
    } else {
      invAvailQuery = invAvailQuery.is("seed_size", null);
    }

    const { data: avail } = await invAvailQuery;
    const availableUnits = (
      (avail ?? []) as Array<{ available_units: number }>
    ).reduce((sum, r) => sum + (r.available_units ?? 0), 0);

    if (unitsDraft.resolved_units > availableUnits) {
      const over = unitsDraft.resolved_units - availableUnits;
      const productLabel = productDraft.resolved_product_name ?? item.productName;
      const treatLabel = resolvedTreatmentName ?? item.treatmentName;
      const sizeLabel = resolvedSeedSize ? ` / ${resolvedSeedSize}` : "";
      warnings.push(
        `Only ${availableUnits} available units for ${productLabel} / ${treatLabel}${sizeLabel} / ${packageTypeDraft.resolved_package_type} — delivery would exceed available inventory by ${over} units.`
      );
    }
  }

  return {
    line_index: lineIndex,
    product: productDraft,
    treatment: treatmentDraft,
    seed_size: seedSizeDraft,
    package_type: packageTypeDraft,
    units_delivered: unitsDraft,
    warnings,
  };
}

// ─── Logging helper ───────────────────────────────────────────────────────────

async function logCall(
  serviceClient: SupabaseClient,
  threadId: string,
  userId: string,
  input: ToolInput,
  output: ToolOutput,
  status: string,
  errorMessage: string | null
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from("agent_tool_calls")
    .insert({
      thread_id: threadId,
      message_id: null,
      user_id: userId,
      tool_name: "draft_delivery_from_chat",
      input_json: input,
      output_json: output,
      status,
      error_message: errorMessage,
    })
    .select("id")
    .single();
  if (error) return null;
  return (data as { id: string } | null)?.id ?? null;
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

export function makeDraftDeliveryFromChatTool(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  userId: string,
  threadId: string,
  userMessage: string
) {
  return tool<ToolInput, ToolOutput>({
    description:
      "Extracts a delivery from the user's natural language, resolves all fields " +
      "(customer, product, treatment, seed size, package type, units) against live database records, " +
      "and returns a structured draft with validation status and options for any missing fields. " +
      "Supports multiple delivery lines in a single call. " +
      "Does NOT save — use this tool to build and validate the draft, then present it to the user " +
      "for confirmation. Saving is a separate step.",
    inputSchema: jsonSchema<ToolInput>({
      type: "object",
      properties: {
        customerName: {
          type: "string",
          description:
            "Customer name or farm/business name as stated by the user. Partial names are accepted. Required.",
        },
        deliveryDate: {
          type: "string",
          description:
            'Pass the date exactly as the user stated it: "today", "yesterday", "tomorrow", or a specific date as YYYY-MM-DD. ' +
            'Do NOT convert relative words to ISO dates yourself — the backend resolves them using real server time. ' +
            'If the user gave no date, pass "today". Required.',
        },
        seasonYear: {
          type: "number",
          description:
            "Only provide if the user explicitly stated a year number in their message. Do not guess — omit and the backend resolves the season automatically.",
        },
        items: {
          type: "array",
          description:
            "One entry per delivery line. Multi-line deliveries are fully supported.",
          items: {
            type: "object",
            properties: {
              productName: {
                type: "string",
                description:
                  'Product name or variety as mentioned. Examples: "DKC 100-01", "103-93", "94-94".',
              },
              treatmentName: {
                type: "string",
                description:
                  'Treatment as mentioned. Examples: "Fungicide", "DIAMIDE", "PONCHO".',
              },
              units: {
                type: "number",
                description: "Number of units to deliver. Must be a positive whole number.",
              },
              seedSize: {
                type: "string",
                description:
                  'Seed size only if stated by the user. Examples: "AR", "AF2", "P26". Omit if not mentioned.',
              },
              packageType: {
                type: "string",
                description:
                  'Package type only if stated: "Bag" or "Seedpak". Omit if not mentioned (tool defaults to Bag).',
              },
            },
            required: ["productName", "treatmentName", "units"],
            additionalProperties: false,
          },
        },
        notes: {
          type: "string",
          description: "Any notes or comments the user mentioned for this delivery.",
        },
      },
      required: ["customerName", "deliveryDate", "items"],
      additionalProperties: false,
    }),

    execute: async (input: ToolInput): Promise<ToolOutput> => {
      // ── 1. Delivery date ────────────────────────────────────────────────
      const dateResolution = resolveAgentDate(userMessage, input.deliveryDate);
      const deliveryDateDraft: DateDraft = {
        input: input.deliveryDate,
        resolved_date: dateResolution.resolved_date,
        date_source: dateResolution.date_source,
        user_explicitly_requested_date: dateResolution.user_explicitly_requested_date,
        status: "resolved",
      };

      // ── 2. Season year ──────────────────────────────────────────────────
      const requestedYear = input.seasonYear ?? null;
      const userExplicitYear =
        requestedYear !== null && isYearMentionedByUser(userMessage, requestedYear);

      let resolvedSeasonYear: number | null;
      let seasonSource: SeasonSource;

      if (userExplicitYear && requestedYear !== null) {
        resolvedSeasonYear = requestedYear;
        seasonSource = "explicit";
      } else {
        const fallback = await resolveDefaultSeasonForUser(userClient, serviceClient);
        resolvedSeasonYear = fallback.season_year;
        seasonSource = fallback.season_source;
      }

      const seasonDraft: SeasonDraft = {
        resolved_season_year: resolvedSeasonYear,
        season_source: seasonSource,
        status: resolvedSeasonYear !== null ? "resolved" : "missing",
      };

      // ── 3. Customer ─────────────────────────────────────────────────────
      let customerDraft: CustomerDraft;
      try {
        customerDraft = await resolveCustomer(userClient, input.customerName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Customer lookup failed";
        const errorOutput: ToolOutput = {
          customer: {
            input: input.customerName,
            resolved_customer_id: null,
            resolved_customer_name: null,
            farm_name: null,
            status: "missing",
          },
          delivery_date: deliveryDateDraft,
          season_year: seasonDraft,
          items: [],
          missing_fields: ["customer name"],
          warnings: [],
          ready_for_confirmation: false,
          tool_error: true,
          tool_error_message: msg,
        };
        await logCall(serviceClient, threadId, userId, input, errorOutput, "error", msg);
        return errorOutput;
      }

      // ── 4. Pricing options for the resolved season ──────────────────────
      let pricingRows: PricingRow[] = [];
      if (resolvedSeasonYear !== null) {
        const { data: pd } = await serviceClient
          .from("v_pricing_options")
          .select("product_id, product_name, crop, treatment_id, treatment_name")
          .eq("season_year", resolvedSeasonYear);
        pricingRows = (pd ?? []) as PricingRow[];
      }

      // ── 5. Resolve each item ────────────────────────────────────────────
      const resolvedItems: ResolvedItem[] = [];
      for (let idx = 0; idx < input.items.length; idx++) {
        const ri = await resolveItem(userClient, pricingRows, input.items[idx], idx);
        resolvedItems.push(ri);
      }

      // ── 6. Aggregate missing_fields and warnings ────────────────────────
      const missingFields: string[] = [];
      const allWarnings: string[] = [];

      // Header-level missing
      if (customerDraft.status === "ambiguous") {
        const names = (customerDraft.candidates ?? [])
          .map((c) => c.customer_name)
          .join(", ");
        missingFields.push(`customer — multiple matches: ${names}`);
      } else if (customerDraft.status === "missing") {
        missingFields.push("customer name");
      }

      if (deliveryDateDraft.status !== "resolved") {
        missingFields.push("delivery date");
      }
      if (seasonDraft.status !== "resolved") {
        missingFields.push("season year");
      }

      // Item-level missing
      for (const ri of resolvedItems) {
        const lbl = `line ${ri.line_index + 1}`;

        if (ri.product.status !== "resolved") {
          missingFields.push(
            ri.product.status === "ambiguous"
              ? `product for ${lbl} — ambiguous: ${(ri.product.options ?? []).join(", ")}`
              : `product for ${lbl}`
          );
        }
        // Only report treatment as missing if product is resolved (otherwise product is the blocker)
        if (ri.product.status === "resolved" && ri.treatment.status !== "resolved") {
          missingFields.push(
            ri.treatment.status === "ambiguous"
              ? `treatment for ${lbl} — ambiguous: ${(ri.treatment.options ?? []).join(", ")}`
              : `treatment for ${lbl} (available: ${(ri.treatment.options ?? []).join(", ")})`
          );
        }
        if (ri.seed_size.status === "missing") {
          const opts =
            ri.seed_size.options.length > 0
              ? ` — options: ${ri.seed_size.options.join(", ")}`
              : "";
          missingFields.push(`seed size for ${lbl}${opts}`);
        }
        if (ri.units_delivered.status !== "resolved") {
          missingFields.push(
            ri.units_delivered.status === "invalid"
              ? `units for ${lbl} must be a positive whole number`
              : `units for ${lbl}`
          );
        }

        allWarnings.push(...ri.warnings);
      }

      const ready_for_confirmation = missingFields.length === 0;

      const output: ToolOutput = {
        customer: customerDraft,
        delivery_date: deliveryDateDraft,
        season_year: seasonDraft,
        items: resolvedItems,
        missing_fields: missingFields,
        warnings: allWarnings,
        ready_for_confirmation,
      };

      const status = ready_for_confirmation ? "validation_pass" : "validation_fail";
      const logId = await logCall(serviceClient, threadId, userId, input, output, status, null);

      // Expose the tool-call row ID as draft_id so the model can pass it to
      // save_confirmed_delivery without re-describing the full draft.
      if (ready_for_confirmation && logId !== null) {
        output.draft_id = logId;
      }

      return output;
    },
  });
}
