# Agent — Delivery Creation Workflow

Documents the design and planned implementation of the agent-assisted delivery creation workflow. No code or migrations exist yet. This document drives implementation.

---

## Purpose

Allow users to describe a delivery in natural language, have the agent validate it against real database records, collect any missing information, confirm the details, and save the delivery — without ever writing to the database until the user explicitly approves.

This workflow covers:
- Single-line deliveries ("deliver 100 units of DKC 094-94 FUNGICIDE to Scott")
- Multi-line deliveries ("create a delivery for Scott with 55 units of 100-01 Fungicide AR and 75 units of 135-98 Diamide")

---

## Critical Safety Rule

**The agent must never save a delivery without explicit user confirmation.**

The save tool accepts a `confirmed: boolean` parameter. The system prompt prohibits setting `confirmed: true` unless the user's most recent message is an unambiguous approval ("yes", "confirm", "save it", "looks good", etc.). The tool's execute function also validates the user's raw message for confirmation language before writing. If either check fails, the tool returns a structured error instead of saving.

This is the same non-negotiable constraint that applies to all agent write operations.

---

## Workflow Overview

```
User: natural language delivery description
  ↓
Agent: calls validate_delivery_draft tool
  ↓
Backend: resolves customer, product, treatment, seed size, inventory
  ↓
  ├─ Missing fields? → Agent asks follow-up with DB-backed options
  │     ↓
  │   User provides missing info
  │     ↓
  │   Agent: calls validate_delivery_draft again with updated draft
  │
  └─ All fields valid?
        ↓
      Agent: presents full delivery summary to user
        ↓
      User: confirms (or requests changes)
        ↓
      Agent: calls save_confirmed_delivery (confirmed: true)
        ↓
      Backend: runs order matching, saves rows, returns delivery IDs
        ↓
      Agent: confirms save, offers to print the delivery slip
```

Steps:

1. **Extract** — Agent parses the user message and builds an initial draft.
2. **Validate** — `validate_delivery_draft` tool checks the draft against real DB records.
3. **Clarify** — If any field is missing or ambiguous, the agent asks with valid options from the DB.
4. **Repeat** — Steps 2–3 repeat until the draft passes validation with no missing fields.
5. **Summarize** — Agent presents the complete delivery for user review.
6. **Confirm** — User explicitly approves.
7. **Save** — `save_confirmed_delivery` tool runs order matching and writes delivery rows.
8. **Acknowledge** — Agent confirms the delivery was saved.
9. **Print offer** — Agent offers to print the delivery slip.

---

## Example Conversation

```
User: Create a delivery for Scott Glasgow today with 55 units of DKC 100-01
      Fungicide AR and 75 units of DKC 135-98 Diamide.

Agent: [calls validate_delivery_draft]

Agent: I can prepare this delivery, but I need the seed size for
       DKC 135-98 / DIAMIDE. Available options are: AR, AF2.
       What seed size was delivered?

User: AR

Agent: [calls validate_delivery_draft with complete draft]

Agent: Here is the delivery I'll save:

       Customer: Scott Glasgow (Glasgow Farms)
       Date: May 11, 2026

       Line 1: DKC 100-01 / FUNGICIDE / AR / Bag — 55 units
       Line 2: DKC 135-98 / DIAMIDE / AR / Bag — 75 units

       Total: 130 units

       ⚠ Note: You have 60 available units of DKC 135-98 / DIAMIDE /
         AR / Bag. This delivery would exceed available inventory by 15 units.

       Shall I save this delivery? (yes/no)

User: Yes

Agent: [calls save_confirmed_delivery]

Agent: Delivery saved (2 lines). Would you like me to open the print slip?
```

---

## Agent Tool Architecture

Two new agent tools are required. Both follow the existing `makeXxxTool(userClient, serviceClient, userId, threadId, userMessage)` factory pattern.

### Tool 1: `validate_delivery_draft`

**Purpose:** Resolves and validates a draft delivery against live DB records. Returns a validated draft, any validation errors, and available options for missing or ambiguous fields. Does NOT write anything.

**When called:** After extracting a draft from the user message. Called again each time the user provides missing information. Also called if the user requests changes to a previously confirmed draft.

**Inputs:**
```typescript
interface ValidateDeliveryDraftInput {
  customerName: string;          // partial name OK — same three-step matching as other tools
  deliveryDate: string;          // ISO date string (YYYY-MM-DD); use today if user says "today"
  seasonYear?: number;           // only if user explicitly states a year
  lines: DraftLine[];
  notes?: string;
}

interface DraftLine {
  productName: string;           // partial name OK
  treatmentName: string;         // partial name OK
  units: number;
  seedSize?: string;             // null/omitted if user didn't specify
  packageType?: string;          // 'Bag' or 'Seedpak'; default to 'Bag' if not mentioned
}
```

**Outputs:**
```typescript
interface ValidateDeliveryDraftOutput {
  // Overall status
  valid: boolean;                // true only if all lines are fully resolved and valid
  missing_fields: string[];      // human-readable list: ["seed size for line 2"]
  errors: string[];              // hard errors: ["customer not found", "units must be positive"]
  warnings: string[];            // soft warnings: ["line 2 exceeds available inventory by 15 units"]

  // Resolved header
  resolved_customer_id?: string;
  resolved_customer_name?: string;
  resolved_farm_name?: string;
  resolved_season_year?: number;
  season_source?: string;

  // Customer match metadata (same pattern as other tools)
  matched_by?: string;           // "customer_name" | "farm_name" | "partial"
  matched_customer_count?: number;
  customer_candidates?: { customer_id: string; customer_name: string; farm_name: string | null }[];

  // Resolved line items
  resolved_lines: ResolvedLine[];

  // tool_error for DB failures
  tool_error?: boolean;
  tool_error_message?: string;
}

interface ResolvedLine {
  line_index: number;
  valid: boolean;
  missing_fields: string[];       // e.g. ["seed_size"]
  errors: string[];               // e.g. ["product not found"]
  warnings: string[];             // e.g. ["exceeds available inventory"]

  // Resolved product/treatment (null if not resolved)
  product_id?: string;
  product_name?: string;
  treatment_id?: string;
  treatment_name?: string;
  seed_size?: string | null;
  package_type?: string;          // display value: 'Bag' or 'Seedpak'
  units: number;

  // Available options (for follow-up questions)
  available_seed_sizes?: string[];   // from v_pricing_options or v_on_hand_inventory
  available_treatments?: string[];   // for the matched product, this season
  available_package_types?: string[];
  available_inventory?: number;      // total_available_units for this product/treatment/size/pkg
}
```

**Resolution logic (inside the tool's execute function):**
1. **Customer** — three-step match: exact `customer_name` → exact `farm_name` → partial. If multiple customers match a partial name, return all candidates and mark `valid: false` with an error asking the user to clarify. Do not guess.
2. **Season year** — same two-layer defence as other seasonal tools: model provides `seasonYear` only if the user's message contains a year; backend validates via `isYearMentionedByUser()`. Fallback: latest season from user's orders, then from `v_pricing_seasons`.
3. **Product** — ILIKE match on `product_name` in `v_pricing_options` for the resolved season. If multiple products match, return candidates and ask the user to clarify.
4. **Treatment** — match within the resolved product's pricing rows. If the user's treatment name doesn't match any valid treatment for the product/season, return available treatments.
5. **Seed size** — for corn products (crop = 'corn'), seed size is required. Pull valid options from `v_pricing_options` or `v_on_hand_inventory` for the matched product/treatment. If not provided or not valid, return `available_seed_sizes`.
6. **Package type** — default to 'Bag' ('bag') if not specified. Validate against 'bag' / 'tote'.
7. **Units** — must be a positive integer. Fractional units and zero are validation errors.
8. **Inventory check** — query `v_on_hand_inventory` for the resolved product/treatment/seed_size/package_type. Compare `available_units` to `units`. Warn (not block) if delivery would exceed available.
9. **Delivery date** — must be a valid ISO date. If the user says "today", backend substitutes the current server date.

**Logging:** All calls logged to `agent_tool_calls` with status `"validation_pass"`, `"validation_fail"`, or `"error"`.

---

### Tool 2: `save_confirmed_delivery`

**Purpose:** Saves a fully validated and user-confirmed delivery to the `deliveries` table. Runs order matching before insert. Returns the saved delivery IDs.

**When called:** Only after the user has explicitly confirmed the delivery summary in the current conversation turn.

**Inputs:**
```typescript
interface SaveConfirmedDeliveryInput {
  confirmed: boolean;            // MUST be true — see safety rule
  customer_id: string;           // from validate_delivery_draft output
  delivery_date: string;         // ISO date
  season_year: number;           // resolved season
  lines: SaveDeliveryLine[];
  notes?: string;
}

interface SaveDeliveryLine {
  product_id: string;
  treatment_id: string;
  units: number;
  seed_size: string | null;
  package_type: string;          // DB value: 'bag' or 'tote'
}
```

**Outputs:**
```typescript
interface SaveConfirmedDeliveryOutput {
  success: boolean;
  delivery_ids: string[];        // IDs of the created delivery rows
  lines_saved: number;
  unmatched_lines: number;       // lines saved without order_id linkage
  // Error states
  not_confirmed?: boolean;       // true if confirmed !== true or user message doesn't confirm
  tool_error?: boolean;
  tool_error_message?: string;
}
```

**Save logic (inside execute):**
1. **Confirmation guard** — if `confirmed !== true` OR the user's raw message (passed in at tool construction time) does not contain confirmation language, return `{ success: false, not_confirmed: true }` without writing anything.
2. **Order matching** — call the existing `findOrderLineMatches` logic (port to server-side): for each line, find open order items for this customer/season that match product/treatment/seed_size/package_type. Allocate units to early-pay lines first, then oldest order. Track remaining units across all lines to prevent over-allocation.
3. **Build insert rows** — for each allocation, one `DeliveryInsert` row with `order_id` and `order_item_id` set. For any unmatched remaining units, one unlinked row with `order_id: null, order_item_id: null`.
4. **Insert** — write all rows via `userClient` (user JWT → RLS → `user_id = auth.uid()`). Use a single batch insert so partial saves cannot occur.
5. **Return** — delivery IDs and counts.

**Logging:** Logged to `agent_tool_calls` with full input/output JSON and status `"success"` or `"error"`.

---

## Required Fields

### Delivery header

| Field | Required | Source |
|---|---|---|
| `customer_id` | Yes | Resolved from customer name via three-step match |
| `delivery_date` | Yes | From user message; "today" → current server date |
| `season_year` | Yes | Resolved by season resolution logic; not guessed |

### Each line item

| Field | Required | Notes |
|---|---|---|
| `product_id` | Yes | Resolved via ILIKE on `v_pricing_options` |
| `treatment_id` | Yes | Validated against product/season pricing rows |
| `units_delivered` | Yes | Must be a positive integer |
| `seed_size` | Corn only | Required if `crop = 'corn'`; options from pricing/inventory |
| `package_type` | Yes | Default `'bag'`; must be `'bag'` or `'tote'` |
| `order_id` | No | Assigned at save time by order matching logic |
| `order_item_id` | No | Assigned at save time by order matching logic |
| `notes` | No | Passed through to the header-level notes field |

---

## Multi-Line Delivery Structure

A single delivery creation request produces:
- **One delivery date / customer / season** (header-level)
- **N delivery rows** in the `deliveries` table (one per product/treatment/seed_size/package_type combination)

Each line is independently validated for product, treatment, seed size, and units. Missing field errors are reported per-line so the agent can ask targeted questions ("I need the seed size for line 2 — DKC 135-98 / DIAMIDE").

Order matching runs across all lines in a single call to prevent over-allocating the same order line to two delivery lines.

---

## Missing Field Handling

When a required field is absent or ambiguous:

1. The `validate_delivery_draft` tool returns `valid: false` with `missing_fields` and `errors` populated.
2. For each missing field, the tool also returns the valid options available from the DB (`available_seed_sizes`, `available_treatments`, etc.).
3. The agent uses those options to construct a targeted follow-up question — never guessing or inventing options.
4. The agent asks for ONE piece of missing information at a time, prioritizing blockers in order: customer ambiguity → product not found → treatment not valid → seed size missing → units invalid.
5. The agent calls `validate_delivery_draft` again with the user's answer before proceeding.

**Follow-up question format:**
```
I can prepare this delivery, but I need [description of missing field].
Available options are: [list from tool output].
```

The options list must come directly from tool output. The agent must never generate options from its training data.

---

## Confirmation Requirements

Before calling `save_confirmed_delivery`, the agent must:

1. Present a complete delivery summary: customer, farm, date, season, all lines (product / treatment / seed size / package type / units), total units, and any warnings.
2. Ask explicitly: "Shall I save this delivery?"
3. Wait for a user response in the current turn.
4. Only set `confirmed: true` in the save tool call if the user's response is an unambiguous approval.

**Approved confirmation phrases** (model-interpreted, not exhaustive): "yes", "confirm", "save it", "go ahead", "looks good", "do it", "correct".

**Responses that are NOT confirmation:** "maybe", "I think so", "probably", "let me check", or any non-committing language. The agent should re-ask if the user's intent is unclear.

**If the user requests changes after the summary:** Do not save. Re-extract the updated draft, call `validate_delivery_draft` again, and restart from step 5.

---

## Validation Rules

### Hard errors (block save)

| Check | Error message pattern |
|---|---|
| Customer not found | "I couldn't find a customer matching '[name]'. Please check the name and try again." |
| Customer ambiguous (multiple partial matches) | "Multiple customers match '[name]': [list]. Which did you mean?" |
| Product not found for season | "I couldn't find a product matching '[name]' for the [year] season." |
| Treatment not valid for product | "Treatment '[name]' is not available for [product]. Available treatments: [list]." |
| Seed size required but missing | "I need the seed size for [product] / [treatment]. Options: [list]." |
| Seed size not valid | "[size] is not a valid seed size for [product] / [treatment]. Options: [list]." |
| Package type invalid | "Package type must be Bag or Seedpak." |
| Units not positive | "Units must be a positive whole number." |
| Season cannot be resolved | "I couldn't determine the season year. Please check your data." |

### Soft warnings (shown in summary, do not block)

| Check | Warning message pattern |
|---|---|
| Delivery exceeds available inventory | "⚠ [product] / [treatment] / [size] / [pkg]: only [N] available units; this delivery would exceed by [X] units." |
| Customer has no open order lines for product | "Note: [customer] has no open order for [product] / [treatment] this season — this delivery will be unlinked." |

---

## Save Rules

1. `save_confirmed_delivery` always uses the `userClient` (user JWT) so `user_id = auth.uid()` is set by RLS, not application code.
2. **Order matching** runs before insert. Logic mirrors `findOrderLineMatches` in `src/services/orderMatching.service.ts`:
   - For each line, find open `order_items` matching (product_id, treatment_id, seed_size, package_type) with remaining net_units > 0.
   - Allocate early-pay order lines first, then oldest order_date, then created_at, then order_id.
   - Track open-unit counts across all lines in a single pass to prevent over-allocation.
3. **Split rows:** if a line's units exceed a single order item's remaining units, create multiple delivery rows — one per allocated order item, plus one unlinked row for any remainder.
4. **Unlinked rows:** delivery rows with `order_id = null` and `order_item_id = null` are valid. The system already supports them (the fulfillment view filters by `order_item_id IS NOT NULL` for linked status).
5. **Atomic insert:** all rows for the delivery are inserted in a single batch. If any row fails, the entire delivery is rolled back (Supabase insert + error → no partial save).
6. **No duplicate guard at tool level:** the tool does not attempt to detect duplicate deliveries. The user is responsible for confirming the correct details.

---

## Print-After-Save Behavior

After a successful save, the agent:
1. Confirms: "Delivery saved ([N] lines, [total_units] units)."
2. Offers: "Would you like me to open the print slip?"
3. If the user says yes, the agent instructs the user how to open the print view, or links to the delivery print URL. (The print page is a separate client-side route at `/deliveries/print`; the agent cannot directly open browser windows. The agent can tell the user to go to the Deliveries page and click Print on the new record.)

> **Future enhancement:** deep-link the print URL from the agent response using the saved delivery IDs.

---

## Audit and Logging Requirements

| Event | Logged to |
|---|---|
| `validate_delivery_draft` call (pass) | `agent_tool_calls` — status: `"validation_pass"` |
| `validate_delivery_draft` call (fail) | `agent_tool_calls` — status: `"validation_fail"` |
| `validate_delivery_draft` DB error | `agent_tool_calls` — status: `"error"` |
| `save_confirmed_delivery` call (not confirmed guard triggered) | `agent_tool_calls` — status: `"not_confirmed"` |
| `save_confirmed_delivery` success | `agent_tool_calls` — status: `"success"` |
| `save_confirmed_delivery` DB error | `agent_tool_calls` — status: `"error"` |

All log entries include: `thread_id`, `user_id`, `tool_name`, `input_json`, `output_json`, `status`, `error_message`.

The `deliveries` table already carries `created_at` and `updated_at` timestamps. No additional audit table is required for the initial implementation.

---

## Risks and Cautions

### Confirmation bypass
**Risk:** The model sets `confirmed: true` without an actual user confirmation (e.g., the user said "I'm not sure" but the model misclassified it).
**Mitigation:** The `save_confirmed_delivery` tool's `execute` function performs a secondary check on the raw user message string for confirmation language, independent of the model's `confirmed` flag. If both fail, the delivery is not saved.

### Customer ambiguity
**Risk:** A partial name like "Glasgow" matches multiple customers. The model picks one silently.
**Mitigation:** `validate_delivery_draft` returns all candidates when a partial match hits > 1 customer, marks the draft invalid, and the agent must ask the user to choose by name.

### Season year hallucination
**Risk:** The model provides `seasonYear: 2024` when the user said nothing about a year.
**Mitigation:** Same two-layer defence as other tools — model schema description prohibits providing `seasonYear` unless the user's message contains a year; backend calls `isYearMentionedByUser()` and discards if false.

### Seed size invention
**Risk:** The model guesses a seed size ("probably AF2") and passes it as if confirmed.
**Mitigation:** If seed size is missing, `validate_delivery_draft` returns `valid: false` with `missing_fields` and `available_seed_sizes`. The model must ask the user — it may not fill in the seed size itself.

### Inventory overcommit
**Risk:** User saves a delivery that exceeds available inventory.
**Mitigation:** Warn in the summary (not block). The existing delivery system and UI allow over-delivery; the agent matches the same behaviour. The warning is surfaced prominently in the confirmation summary.

### Partial save on batch insert failure
**Risk:** Supabase `.insert()` fails partway through a multi-row batch.
**Mitigation:** A single `.insert(rows)` call on the `deliveries` table is atomic at the Postgres level for the same statement. If the call returns an error, no rows are written. The tool returns `tool_error: true` and the user is told to try again.

### Order matching over-allocation
**Risk:** Two delivery lines in the same request both claim units from the same order item.
**Mitigation:** Order matching runs in a single pass with a shared mutable `openUnits` map, the same pattern as `findOrderLineMatches` in the UI service. Cross-line over-allocation is impossible within one tool call.

### Write tool discoverability
**Risk:** The model calls `save_confirmed_delivery` for non-delivery questions or speculatively.
**Mitigation:** The tool description explicitly states it is only for saving a delivery that has already been validated and confirmed. The system prompt prohibits calling it unless `confirmed: true` and the confirmation happened in the current turn.

---

## Date Resolution Design

The agent must never guess or invent the current date. This is enforced with a two-layer defense identical in structure to `isYearMentionedByUser()` in `resolve-season.ts`.

### Helper module: `src/lib/agent/tools/resolve-date.ts`

Exports:
- `isDateMentionedByUser(userMessage: string): boolean` — returns true if the raw user message contains any recognisable date reference (today/yesterday/tomorrow, ISO format, numeric slash, written month + day, weekday references).
- `todayISO()`, `yesterdayISO()`, `tomorrowISO()` — server-side date helpers using `new Date()`.
- `resolveAgentDate(userMessage, requestedDate?): DateResolution` — main entry point.

### `resolveAgentDate` logic

| Condition | resolved_date | date_source | user_explicitly_requested_date |
|---|---|---|---|
| No date in user message | `todayISO()` | `"today_default"` | `false` |
| User mentioned date + "today"/"now" | `todayISO()` | `"explicit"` | `true` |
| User mentioned date + "yesterday" | `yesterdayISO()` | `"explicit"` | `true` |
| User mentioned date + "tomorrow" | `tomorrowISO()` | `"explicit"` | `true` |
| User mentioned date + valid ISO string | ISO string as-is | `"explicit"` | `true` |
| User mentioned date + unparseable value | `todayISO()` | `"today_default"` | `true` |

**Layer 1** — if `!isDateMentionedByUser(userMessage)`, always return server today. The model's `deliveryDate` value is ignored entirely. This prevents hallucinated dates from training data (e.g. "2023-10-06") being accepted when the user never mentioned a date.

**Layer 2** — if the user did mention a date, interpret the model's `requestedDate` using real server time ("today" → `new Date()`, not the model's training-data date).

### Schema instruction change

The `deliveryDate` field description in `draft_delivery_from_chat`'s input schema was changed from:
> *"Convert 'today' to today's ISO date..."* (caused model to convert using its training-data date)

To:
> *"Pass the date exactly as the user stated it: 'today', 'yesterday', 'tomorrow', or YYYY-MM-DD. Do NOT convert relative words to ISO dates yourself — the backend resolves them using real server time."*

### System prompt addition

A new **"Date handling — critical rules"** section in the system prompt prohibits the model from guessing the current date or fabricating an ISO date from training data.

---

## Implementation Status

Phases 1, 2, 3, and the date fix are complete.

- [x] `draft_delivery_from_chat` — server-side resolution and validation, no DB writes (`src/lib/agent/tools/draft-delivery-from-chat.ts`)
- [x] `save_confirmed_delivery` — confirmation guard + order matching + `deliveries` insert (`src/lib/agent/tools/save-confirmed-delivery.ts`)
- [x] `get_delivery_print_link` — verifies delivery ownership, returns print URL (`src/lib/agent/tools/get-delivery-print-link.ts`)
- [x] Print page at `/deliveries/print/[id]` — fetches delivery data client-side, renders `DeliveryPrintView`, auto-prints
- [x] All tools registered in `src/app/api/agent/chat/route.ts` and exported from `src/lib/agent/tools/index.ts`
- [x] `draft_id` returned in `draft_delivery_from_chat` output when `ready_for_confirmation: true`
- [x] Order matching ported to server-safe helper in `save-confirmed-delivery.ts` (accepts `SupabaseClient` instead of calling browser client)
- [x] `resolve-date.ts` — two-layer date hallucination defense (`isDateMentionedByUser`, `resolveAgentDate`)
- [x] `draft_delivery_from_chat` uses `resolveAgentDate`; `deliveryDate` schema description updated
- [x] System prompt: `deliveryDate` instruction updated + global "Date handling — critical rules" section added
- [x] TypeScript clean — `npx tsc --noEmit` passes

Note: The two-tool design in this document uses `validate_delivery_draft` + `save_confirmed_delivery`. The implementation used `draft_delivery_from_chat` for Phase 1 (validate + draft), which serves the same purpose. `save_confirmed_delivery` matches the design exactly.
