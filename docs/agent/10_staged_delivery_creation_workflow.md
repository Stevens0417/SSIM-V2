# Agent — Staged Delivery Creation Workflow

Documents the design and planned implementation of the agent-assisted staged delivery creation workflow. This document drives implementation — no code or migrations are created until after this document is reviewed.

---

## Purpose

Allow users to describe a staged delivery in natural language, have the agent validate it against real database records, collect any missing information, confirm the details, and save the staged delivery — without ever writing to the database until the user explicitly approves.

A staged delivery is product that has been physically set aside for a customer but has not yet been officially delivered. Creating a staged delivery through the agent must produce the same database state as creating one through the existing Staged Deliveries page: a `staged_deliveries` header row with `status = 'in_progress'` and one or more `staged_delivery_items` rows.

This workflow covers:
- Single-line staged deliveries ("stage 75 units of DKC 100-01 Fungicide AR Bag for Scott")
- Multi-line staged deliveries ("create a staged delivery for Scott today with 10 units of DKC 100-01 Fungicide AF2 Bag and 15 units of DKC 135-98 Diamide AR Bag")

---

## Critical Safety Rule

**The agent must never save a staged delivery without explicit user confirmation.**

The save tool accepts a `confirmation_text` parameter and performs its own independent check on the user's raw message for confirmation language before writing anything to the database. If either the model's intent or the raw-message check fails, the tool returns a structured error without saving. This matches the non-negotiable constraint applied to all agent write operations (delivery, replant, return).

---

## Workflow Overview

```
User: natural language staged delivery description
  ↓
Agent: calls draft_staged_delivery_from_chat tool
  ↓
Backend: resolves customer, product, treatment, seed size, inventory
  ↓
  ├─ Missing/ambiguous fields?
  │     → Agent asks follow-up with DB-backed options
  │     → User provides missing info
  │     → Agent calls draft_staged_delivery_from_chat again
  │
  └─ All fields valid and ready_for_confirmation = true?
        ↓
      Agent: presents full staged delivery summary
        ↓
      User: confirms (or requests changes)
        ↓
      Agent: calls save_confirmed_staged_delivery
        ↓
      Backend: inserts staged_deliveries header + staged_delivery_items rows
        ↓
      Agent: confirms save, automatically calls get_staged_delivery_print_link
        ↓
      UI: renders Print Delivery Slip button
```

Steps:

1. **Extract** — Agent parses the user message and calls `draft_staged_delivery_from_chat`.
2. **Validate** — Backend resolves all fields against live DB records. Does NOT write anything.
3. **Clarify** — If any field is missing or ambiguous, the agent asks with valid options from the DB.
4. **Repeat** — Steps 2–3 repeat until `ready_for_confirmation: true`.
5. **Summarize** — Agent presents the complete staged delivery summary for user review, including any inventory warnings.
6. **Confirm** — User explicitly approves.
7. **Save** — `save_confirmed_staged_delivery` inserts the header and items.
8. **Acknowledge** — Agent confirms the staged delivery was saved.
9. **Print** — Agent immediately calls `get_staged_delivery_print_link` and the UI renders a Print Delivery Slip button.

---

## Example Conversation

```
User: Create a staged delivery for Scott today with 10 units of DKC 100-01
      Fungicide AF2 Bag and 15 units of DKC 135-98 Diamide AR Bag.

Agent: [calls draft_staged_delivery_from_chat]

Agent: Here is the staged delivery I'll prepare:

       Customer: Scott Glasgow (Glasgow Farms)
       Date: May 14, 2026

       Line 1: DKC 100-01 / FUNGICIDE / AF2 / Bag — 10 units
       Line 2: DKC 135-98 / DIAMIDE / AR / Bag — 15 units

       Total: 25 units staged

       Does this look correct? Reply yes to confirm or let me know what to change.

User: Yes

Agent: [calls save_confirmed_staged_delivery]
       [calls get_staged_delivery_print_link]

Agent: Staged delivery saved (2 lines).
       [Print Delivery Slip button rendered by UI]
```

With a missing field:

```
User: Stage 50 units of DKC 135-98 Diamide for Scott.

Agent: [calls draft_staged_delivery_from_chat]

Agent: I can prepare this staged delivery, but I need the seed size for
       DKC 135-98 / DIAMIDE. Available options are: AR, AF2.
       Which seed size?

User: AR

Agent: [calls draft_staged_delivery_from_chat with seed size AR]

Agent: Here is the staged delivery I'll prepare:

       Customer: Scott Glasgow (Glasgow Farms)
       Date: May 14, 2026

       Line 1: DKC 135-98 / DIAMIDE / AR / Bag — 50 units

       ⚠ Warning: only 30 available units of DKC 135-98 / DIAMIDE / AR / Bag.
         This staged delivery would exceed available inventory by 20 units.

       Does this look correct? Reply yes to confirm or let me know what to change.
```

---

## Agent Tool Architecture

Three new agent tools are required. All follow the existing `makeXxxTool(userClient, serviceClient, userId, threadId, userMessage?)` factory pattern.

---

### Tool 1: `draft_staged_delivery_from_chat`

**Purpose:** Resolves and validates a staged delivery draft against live DB records. Returns a validated draft, missing/ambiguous field status, and available options for any unresolved fields. Does NOT write anything.

**When called:**
- After extracting a staged delivery intent from the user message.
- Again each time the user provides a missing field value.
- Again if the user requests changes after the summary.

**Tool name:** `draft_staged_delivery_from_chat`

**Input schema:**
```typescript
interface ToolInput {
  customerName: string;
  stagedDate: string;        // pass verbatim: "today", "yesterday", or YYYY-MM-DD
  seasonYear?: number;       // only if user explicitly stated a year
  items: DraftItemInput[];
  notes?: string;
}

interface DraftItemInput {
  productName: string;
  treatmentName: string;
  units: number;
  seedSize?: string;
  packageType?: string;      // "Bag" or "Seedpak"; default to "Bag" if not mentioned
}
```

**Output schema:**
```typescript
interface ToolOutput {
  draft_id: string | null;          // populated only when ready_for_confirmation: true
  draft_type: "staged_delivery";
  customer: CustomerDraft;
  staged_date: StagedDateDraft;
  season_year: SeasonDraft;
  items: StagedItemDraft[];
  missing_fields: string[];         // human-readable: ["seed size for line 1", "customer"]
  warnings: string[];               // inventory warnings across all lines
  ready_for_confirmation: boolean;  // true only when all items fully resolved, no errors
}
```

**Item-level draft shape:**
```typescript
interface StagedItemDraft {
  line_index: number;
  product: {
    input: string | null;
    resolved_product_id: string | null;
    resolved_product_name: string | null;
    status: "resolved" | "missing" | "ambiguous";
    options: string[];
  };
  treatment: {
    input: string | null;
    resolved_treatment_id: string | null;
    resolved_treatment_name: string | null;
    status: "resolved" | "missing" | "ambiguous";
    options: string[];
  };
  seed_size: {
    input: string | null;
    resolved_seed_size: string | null;
    status: "resolved" | "missing" | "not_required" | "ambiguous";
    options: string[];
  };
  package_type: {
    input: string | null;
    resolved_package_type: string | null;   // DB value: "bag" or "tote"
    status: "resolved" | "missing";
    options: string[];
  };
  units_staged: {
    input: number | null;
    resolved_units: number | null;
    status: "resolved" | "missing" | "invalid";
  };
  warnings: string[];
}
```

**Resolution logic (inside execute function):**

1. **Customer** — three-step match identical to all other agent tools:
   - Exact `customer_name` match (case-insensitive)
   - Exact `farm_name` match
   - Partial ILIKE match
   - If multiple customers match, return all candidates and set `status: "ambiguous"`. The agent must ask the user to choose — it may not pick silently.

2. **Staged date** — same two-layer defense as delivery date resolution:
   - If no date is mentioned in the user's raw message, resolve to today using server time.
   - If "today" / "yesterday" / "tomorrow" is mentioned, resolve using real server time.
   - If an ISO date is stated, use it as-is.
   - Never fabricate a date from training data.

3. **Season year** — same two-layer defense as all seasonal tools:
   - Model provides `seasonYear` only when the user's raw message contains a year.
   - Backend validates via `isYearMentionedByUser()` and discards if false.
   - Fallback: latest season from user's orders, then from `v_pricing_seasons`.

4. **Product** — ILIKE match on `product_name` in `v_pricing_options` for the resolved season. If multiple match, return candidates. If none match, return `status: "missing"`.

5. **Treatment** — validated within the matched product's pricing rows for the season. If the user's treatment name doesn't match, return `status: "ambiguous"` with `options` from available treatment names for that product.

6. **Seed size** — required for corn products (`crop = 'corn'`). Pull valid options from `v_pricing_options` or `v_on_hand_inventory` for the matched product/treatment. For soybean products, return `status: "not_required"`. If missing for corn, return `status: "missing"` with `options`.

7. **Package type** — default to `'bag'` if the user did not specify. Validate that any stated value maps to `'bag'` (Bag) or `'tote'` (Seedpak). Return display names in options: `["Bag", "Seedpak"]`.

8. **Units** — must be a positive integer. Zero and fractional units are `status: "invalid"`.

9. **Inventory check** — query `v_on_hand_inventory` for the resolved product/treatment/seed_size/package_type. Compare `available_units` to `units_staged`. If `units_staged > available_units`, add a warning to the item's `warnings` array and the top-level `warnings` array. Do not set an error — warn, do not block.

10. **draft_id** — when `ready_for_confirmation: true`, the tool's own `agent_tool_calls` log row `id` is used as the `draft_id`. This ID is passed to `save_confirmed_staged_delivery`.

**Logging:**
- `status: "validation_pass"` when `ready_for_confirmation: true`
- `status: "validation_fail"` when `ready_for_confirmation: false`
- `status: "error"` on DB failure
- Full `input_json` and `output_json` stored

---

### Tool 2: `save_confirmed_staged_delivery`

**Purpose:** Saves a fully validated, user-confirmed staged delivery to `staged_deliveries` and `staged_delivery_items`. Returns the staged delivery ID.

**When called:** Only after the user has explicitly confirmed the staged delivery summary in the current conversation turn.

**Tool name:** `save_confirmed_staged_delivery`

**Input schema:**
```typescript
interface ToolInput {
  draft_id: string;           // from draft_staged_delivery_from_chat output
  confirmation_text: string;  // the user's raw confirmation message verbatim
}
```

**Output schema:**
```typescript
interface ToolOutput {
  success: boolean;
  staged_delivery_id: string | null;
  lines_saved: number;
  draft_type: "staged_delivery";
  not_confirmed?: boolean;
  tool_error?: boolean;
  tool_error_message?: string;
}
```

**Save logic (inside execute function):**

1. **Confirmation guard** — check `confirmation_text` against the same `CONFIRM_PATTERNS` used by delivery/replant/return tools ("yes", "confirm", "save it", "save staged delivery", "looks good", "correct", "go ahead", "do it", "yep", "yup"). If none match, return `{ success: false, not_confirmed: true }` without writing anything.

2. **Load draft** — fetch the `agent_tool_calls` row by `draft_id`. Verify `tool_name = "draft_staged_delivery_from_chat"`, `status = "validation_pass"`, and `user_id` matches the calling user. If not found or mismatched, return `tool_error: true`.

3. **Type guard** — verify `draft.draft_type === "staged_delivery"`. If a different draft type is found (delivery, replant, return), return `tool_error: true` with a mismatch message.

4. **Duplicate save guard** — check whether a `save_confirmed_staged_delivery` success row with `created_at > draft.created_at` already exists for this thread. If yes, return `tool_error: true` with "This staged delivery has already been saved."

5. **Insert header** — insert one row into `staged_deliveries`:
   ```
   customer_id, season_year, staged_date, notes, status = 'in_progress'
   ```
   Use `userClient` (user JWT) so `user_id = auth.uid()` is enforced by the DB column default and RLS.

6. **Insert items** — insert N rows into `staged_delivery_items`:
   ```
   staged_delivery_id, product_id, treatment_id, seed_size, package_type, units_staged
   ```
   All items reference the same `staged_delivery_id` from step 5. Use `userClient`.

7. **No order matching** — order matching is NOT performed at staged delivery save time. It only runs when a staged delivery is converted to an actual delivery (existing `convertStagedDelivery` logic). Do not call `findOrderLineMatches` here.

8. **Return** — `{ success: true, staged_delivery_id, lines_saved }`.

**Inventory effect:** Inserting into `staged_delivery_items` with `staged_deliveries.status = 'in_progress'` immediately reduces `available_units` in `v_on_hand_inventory`. The `staged` CTE in that view picks up new rows automatically — no additional action is needed.

**Logging:**
- `status: "success"` on successful save
- `status: "error"` on DB failure
- `status: "not_confirmed"` if confirmation guard fires
- Full `input_json` and `output_json` stored

---

### Tool 3: `get_staged_delivery_print_link`

**Purpose:** Returns a URL-based print link for a saved staged delivery. The print page renders using the standard `DeliveryPrintView` (not `StagedDeliveryPrintView`), because the slip may be given to the customer and must look like a normal delivery form.

**When called:** Automatically, immediately after `save_confirmed_staged_delivery` returns success. The agent does not wait for the user to ask.

**Tool name:** `get_staged_delivery_print_link`

**Input schema:**
```typescript
interface ToolInput {
  staged_delivery_id: string;
}
```

**Output schema:**
```typescript
interface ToolOutput {
  staged_delivery_id: string;
  print_url: string;           // "/staged-deliveries/print/[id]"
  tool_error?: boolean;
  tool_error_message?: string;
}
```

**Execute logic:**
- Verify the staged delivery exists and belongs to the user by querying `staged_deliveries` via `userClient` (RLS enforces ownership).
- If not found, return `tool_error: true`.
- If found, return `print_url: "/staged-deliveries/print/${staged_delivery_id}"`.
- Log to `agent_tool_calls`.

**Print page:** A new URL-based print route at `/staged-deliveries/print/[id]/page.tsx` must be created. It:
- Fetches the staged delivery header and items by ID from `v_staged_deliveries` (filtered to this user via RLS).
- Renders the standard `DeliveryPrintView` component using the staged delivery data (product, treatment, seed size, package type, units, date, customer, notes).
- Auto-triggers `window.print()` after 400ms (same as `/deliveries/print/[id]`).
- Includes a back button "← Back to Staged Deliveries".
- Does NOT render `StagedDeliveryPrintView` or any "staged" / "prepared" label in the print output.

---

## Required Fields

### Staged delivery header

| Field | Required | Source |
|---|---|---|
| `customer_id` | Yes | Resolved from customer name — three-step match |
| `staged_date` | Yes | From user message; "today" → current server date |
| `season_year` | Yes | Resolved by season logic; never guessed |
| `notes` | No | Passed through from user message if stated |
| `status` | Auto | Always `'in_progress'` at creation; not user-controlled |

### Each line item

| Field | Required | Notes |
|---|---|---|
| `product_id` | Yes | Resolved via ILIKE on `v_pricing_options` |
| `treatment_id` | Yes | Validated against product/season pricing rows |
| `units_staged` | Yes | Positive integer; zero and fractional values are errors |
| `seed_size` | Corn only | Required if `crop = 'corn'`; null for soybean/packaging |
| `package_type` | Yes | Default `'bag'`; must be `'bag'` or `'tote'` |

No `order_id` or `order_item_id` fields — order matching is deferred to conversion time, matching the existing Staged Deliveries page behavior.

---

## Multi-Line Staged Delivery Structure

A single agent staged delivery request produces:
- **One `staged_deliveries` row** (header: customer, date, season, notes, status)
- **N `staged_delivery_items` rows** (one per product/treatment/seed_size/package_type line)

Each line is independently validated. Missing field errors are reported per-line so the agent can ask targeted questions ("I need the seed size for line 2 — DKC 135-98 / DIAMIDE").

The `missing_fields` array in the top-level output lists all unresolved fields across all lines, formatted as: `"seed size for line 2"`, `"treatment for line 1"`.

The agent must ask for missing information one field at a time, prioritizing blockers in order: customer ambiguity → product not found → treatment missing → seed size missing → units invalid.

---

## Missing Field Handling

When a required field is absent or ambiguous:

1. `draft_staged_delivery_from_chat` returns `ready_for_confirmation: false` with `missing_fields` populated.
2. For each missing field, the relevant item draft includes a non-empty `options` array drawn from live DB records.
3. The agent constructs a targeted follow-up question using those options — never from training data.
4. After the user responds, the agent calls `draft_staged_delivery_from_chat` again with the updated values.
5. The loop repeats until `ready_for_confirmation: true`.

**Follow-up question format:**
```
I can prepare this staged delivery, but I need [description].
Available options are: [list from tool output].
```

The options list must come directly from tool output — the agent must never generate or guess options.

---

## Confirmation Requirements

Before calling `save_confirmed_staged_delivery`, the agent must:

1. Present a complete summary: customer name, farm name (if applicable), date, season, all lines (product / treatment / seed size / package type / units staged), total units staged, and any inventory warnings.
2. Ask explicitly: "Does this look correct? Reply yes to confirm or let me know what to change."
3. Wait for the user's response in the next message turn.
4. Pass the user's raw response verbatim as `confirmation_text` to the save tool. Only proceed if the tool confirms it matches confirmation patterns.

**Approved confirmation phrases** (checked by the tool, not the model): "yes", "confirm", "save it", "save staged delivery", "looks good", "correct", "go ahead", "do it", "yep", "yup".

**Responses that are NOT confirmation:** "maybe", "ok" (alone), "I think so", "probably", or any ambiguous language. Re-ask if intent is unclear.

**If the user requests changes after the summary:** Do not save. Call `draft_staged_delivery_from_chat` again with the updated fields and restart from the summary step.

---

## Validation Rules

### Hard errors (block `ready_for_confirmation`)

| Check | Response pattern |
|---|---|
| Customer not found | "I couldn't find a customer matching '[name]'. Please check the name." |
| Customer ambiguous | "Multiple customers match '[name]': [list]. Which did you mean?" |
| Product not found | "I couldn't find a product matching '[name]' for the [year] season." |
| Treatment not valid | "Treatment '[name]' is not available for [product]. Available: [list]." |
| Seed size missing (corn) | "I need the seed size for [product] / [treatment]. Options: [list]." |
| Seed size invalid | "[size] is not a valid seed size for [product] / [treatment]. Options: [list]." |
| Package type invalid | "Package type must be Bag or Seedpak." |
| Units not positive | "Units must be a positive whole number." |
| Season unresolvable | "I couldn't determine the season year. Please check your data." |

### Soft warnings (shown in summary — do NOT block)

| Check | Warning pattern |
|---|---|
| Staged units exceed available inventory | "⚠ [product] / [treatment] / [size] / [pkg]: only [N] units available; this staged delivery would exceed by [X] units." |

Inventory warnings are surfaced in the summary before asking for confirmation. The agent must show all warnings prominently. If the user confirms anyway, the save proceeds — the system and existing UI both allow negative available inventory (the same behavior as creating a staged delivery through the Staged Deliveries page).

---

## Save Rules

1. `save_confirmed_staged_delivery` always uses `userClient` (user JWT) — `user_id` is set by the DB column default (`auth.uid()`) and enforced by RLS. Application code never sets `user_id` explicitly.
2. **No order matching at save time.** Order matching runs only at conversion time (`convertStagedDelivery` in `staged-delivery.service.ts`). The agent save replicates what the Staged Deliveries page does: insert header and items, both with `status = 'in_progress'`.
3. **Two-step insert:** header first, then items referencing the returned `staged_delivery_id`. If item insert fails, the tool returns `tool_error: true`. The header row is left orphaned — acceptable because it has no items and will not affect inventory (the staged CTE in `v_on_hand_inventory` joins through `staged_delivery_items`).
4. **No duplicate guard at tool level beyond the draft_id check.** The draft_id check (verifying no prior successful save exists for this draft) is the primary protection. No attempt is made to detect duplicate submissions beyond this.
5. **draft_type guard:** the save tool reads `draft.draft_type` from the stored `agent_tool_calls` row. If it is not `"staged_delivery"`, the save is refused. This prevents accidentally saving a delivery or replant draft through this tool.
6. **Inventory effect is immediate:** inserting `staged_delivery_items` for an `'in_progress'` staged delivery immediately reduces `available_units` via `v_on_hand_inventory`. The new staged delivery will appear on the Staged Deliveries page under In Progress on next load — no additional action needed.

---

## Print-After-Save Behavior

After `save_confirmed_staged_delivery` returns success:

1. The agent **immediately** calls `get_staged_delivery_print_link` with the returned `staged_delivery_id`. This happens in the same response step — the agent does not wait for the user to request printing.
2. `get_staged_delivery_print_link` returns `print_url: "/staged-deliveries/print/${staged_delivery_id}"`.
3. The route handler in `route.ts` extracts the `print_url` from the tool result and stores it in `assistantMetadata.actions` (identical to the delivery/replant/return pattern).
4. The chat UI renders a **Print Delivery Slip** button below the agent's response.
5. The user clicks the button; the browser navigates to the print URL.
6. The print page at `/staged-deliveries/print/[id]` fetches the staged delivery data and renders `DeliveryPrintView`.

### Customer-facing delivery slip requirement

The print slip for an agent-created staged delivery must use `DeliveryPrintView` — the same component used for actual deliveries.

- Do NOT render `StagedDeliveryPrintView`.
- Do NOT render `StagedDeliveryChecklistView`.
- Do NOT label the slip "Staged Delivery", "Prepared Delivery", or any variant.
- The slip may be given directly to the customer, so it must look identical to a normal delivery slip.

The print page maps staged delivery fields to the `DeliveryPrintView` format:
- `deliveryDate` ← `staged_date`
- `customer.name` ← `customer_name`
- `customer.farmName` ← `farm_name`
- `items[]` ← one entry per `staged_delivery_items` row (product, treatment, seed_size, package_type, units_staged → units)
- `notes` ← `notes`

### Print page route

New file: `src/app/staged-deliveries/print/[id]/page.tsx`

- Dynamic segment: `[id]` is the `staged_delivery_id`.
- Client component that fetches from `v_staged_deliveries` (filtered by `staged_delivery_id` and `status = 'in_progress'`).
- Groups all item rows by the shared header (all rows share one `staged_delivery_id`).
- Renders `DeliveryPrintView` with the assembled data.
- Auto-triggers `window.print()` after 400ms.
- Includes a "← Back to Staged Deliveries" back button.

Note: the existing `/staged-deliveries/print/page.tsx` (sessionStorage-based, no ID parameter) is NOT modified. The new URL-based route is an addition, not a replacement.

---

## Pending Draft Injection

After `draft_staged_delivery_from_chat` returns `ready_for_confirmation: true` (logged as `status: "validation_pass"`), the `draft_id` must be injected into the system prompt for the next request so the model can call `save_confirmed_staged_delivery` directly on a user confirmation without re-running the draft tool.

The injection logic in `route.ts` follows the identical pattern as pending delivery, replant, and return drafts:

```
## Pending staged delivery draft

draft_id: <uuid>
Status: awaiting user confirmation

- If the user's current message is a confirmation ("yes", "confirm", ...) — call save_confirmed_staged_delivery IMMEDIATELY with this draft_id. Do NOT call draft_staged_delivery_from_chat again.
- If the user requests changes, call draft_staged_delivery_from_chat with the updated information.
```

The query checks:
- Most recent `draft_staged_delivery_from_chat` with `status = "validation_pass"` in this thread.
- Whether a `save_confirmed_staged_delivery` with `status = "success"` exists with `created_at >` the draft's `created_at`. If yes, the draft is consumed and not injected.

---

## Relationship to Existing Staged Deliveries Page

| Aspect | Staged Deliveries page | Agent workflow |
|---|---|---|
| Tables written | `staged_deliveries` + `staged_delivery_items` | Same |
| `status` on insert | `'in_progress'` | Same |
| Order matching | Not performed at save | Not performed at save |
| Print slip | `StagedDeliveryPrintView` (sessionStorage) | `DeliveryPrintView` (URL-based) |
| Conversion | `convertStagedDelivery()` service | Not touched |
| Cancellation | `cancelStagedDelivery()` service | Not touched |
| In-progress list | Reads `v_staged_deliveries WHERE status = 'in_progress'` | Same rows appear here after agent save |

Agent-created staged deliveries appear in the Staged Deliveries page In Progress list immediately after being saved. They can be converted or cancelled from that page exactly as if they were created there.

---

## Relationship to Available Inventory

When a staged delivery is saved (status = 'in_progress'), `v_on_hand_inventory` immediately reflects the change:

```
available_units = units_on_hand - staged_units
```

The `staged` CTE in `v_on_hand_inventory` includes all `staged_delivery_items` rows whose parent `staged_deliveries.status = 'in_progress'`. Agent-created staged deliveries reduce `available_units` immediately — no delay or additional action required.

The `get_on_hand_inventory` tool and `run_approved_readonly_query` against `v_agent_inventory` will reflect updated availability in the next agent query.

Inventory warnings shown during the draft phase use the availability at the time the draft tool is called. If availability changes between draft and save (another user action on the same account), the save proceeds — there is no re-validation at save time. This matches the existing Staged Deliveries page behavior.

---

## Audit and Logging Requirements

| Event | `agent_tool_calls` status |
|---|---|
| Draft tool — ready for confirmation | `"validation_pass"` |
| Draft tool — missing/invalid fields | `"validation_fail"` |
| Draft tool — DB error | `"error"` |
| Save tool — confirmation guard fired | `"not_confirmed"` |
| Save tool — success | `"success"` |
| Save tool — DB error | `"error"` |
| Print link tool — success | `"success"` |
| Print link tool — not found | `"error"` |

All entries carry: `thread_id`, `user_id`, `tool_name`, `input_json`, `output_json`, `status`, `error_message`.

The `staged_deliveries` and `staged_delivery_items` tables already have `created_at` and `updated_at` timestamps. No additional audit table is required.

---

## Risks and Cautions

### Confirmation bypass
**Risk:** The model calls `save_confirmed_staged_delivery` without a genuine user confirmation.
**Mitigation:** The tool independently checks `confirmation_text` against `CONFIRM_PATTERNS`. If the pattern check fails, the tool returns `not_confirmed: true` without writing anything.

### Customer ambiguity silently resolved
**Risk:** A partial name matches multiple customers and the model picks one without asking.
**Mitigation:** `draft_staged_delivery_from_chat` sets `customer.status: "ambiguous"` and returns all candidates when > 1 customer matches. `ready_for_confirmation` is forced to `false`. The agent must present the candidates and ask the user to choose by name.

### Season year hallucination
**Risk:** The model provides `seasonYear: 2024` when the user never stated a year.
**Mitigation:** Same two-layer defense as all other tools — model schema description prohibits providing `seasonYear` unless the user's message contains a year; backend calls `isYearMentionedByUser()` and discards if false.

### Date hallucination
**Risk:** The model passes "2023-10-06" as `stagedDate` when the user said nothing about a date.
**Mitigation:** Same two-layer defense as delivery date — if no date is detected in the user's raw message, the backend ignores the model's `stagedDate` and substitutes today using real server time. The `stagedDate` schema description instructs the model to pass verbatim ("today", "yesterday", or YYYY-MM-DD), not to convert.

### Seed size invention
**Risk:** The model fills in a seed size from training data ("probably AF2") rather than asking.
**Mitigation:** If seed size is missing for a corn product, the tool returns `status: "missing"` with `ready_for_confirmation: false`. The model must ask the user — it may not invent a seed size.

### Inventory overcommit
**Risk:** User saves a staged delivery that exceeds available inventory.
**Mitigation:** Warn in the summary (do not block). This matches existing Staged Deliveries page behavior — the page also allows staging more units than are on hand, producing negative `available_units`. The warning must be displayed prominently before asking for confirmation.

### Draft-type mismatch
**Risk:** A `draft_id` from a delivery or return draft is passed to `save_confirmed_staged_delivery`.
**Mitigation:** The save tool reads `draft_type` from the stored `agent_tool_calls` row and refuses to save unless it equals `"staged_delivery"`.

### Duplicate save
**Risk:** The model calls `save_confirmed_staged_delivery` twice for the same draft.
**Mitigation:** The save tool checks for an existing `save_confirmed_staged_delivery` success log with `created_at >` the draft's `created_at`. If found, it returns `tool_error: true` with a "already saved" message.

### Print page sessionStorage conflict
**Risk:** Navigating to `/staged-deliveries/print/[id]` clashes with the existing sessionStorage-based print page at `/staged-deliveries/print`.
**Mitigation:** The new route is at `/staged-deliveries/print/[id]` (dynamic segment) — a different URL from the existing `/staged-deliveries/print` (no segment). Next.js routes them independently. The existing page is not modified.

### Conversion of agent-created staged deliveries
**Risk:** Agent-created staged deliveries cannot be converted from the Staged Deliveries page.
**Mitigation:** No risk — the save tool writes the same table structure (`staged_deliveries` + `staged_delivery_items`) as the page. Conversion via `convertStagedDelivery` will work identically.

---

## File Locations (Planned)

| File | Purpose |
|---|---|
| `src/lib/agent/tools/draft-staged-delivery-from-chat.ts` | Draft tool factory |
| `src/lib/agent/tools/save-confirmed-staged-delivery.ts` | Save tool factory |
| `src/lib/agent/tools/get-staged-delivery-print-link.ts` | Print link tool factory |
| `src/lib/agent/tools/index.ts` | Add new tool exports |
| `src/app/api/agent/chat/route.ts` | Register tools, add SYSTEM_PROMPT sections, add pending draft injection |
| `src/app/staged-deliveries/print/[id]/page.tsx` | URL-based print page using DeliveryPrintView |

---

## Implementation Status

- [ ] `draft_staged_delivery_from_chat` — draft and validation tool
- [ ] `save_confirmed_staged_delivery` — confirmation guard + header/items insert
- [ ] `get_staged_delivery_print_link` — verifies ownership, returns print URL
- [ ] Print page at `/staged-deliveries/print/[id]` — fetches data by ID, renders `DeliveryPrintView`
- [ ] All tools registered in `route.ts` and exported from `tools/index.ts`
- [ ] Pending staged delivery draft injection in `route.ts`
- [ ] SYSTEM_PROMPT sections added for all three tools
- [ ] TypeScript clean — `npx tsc --noEmit` passes
