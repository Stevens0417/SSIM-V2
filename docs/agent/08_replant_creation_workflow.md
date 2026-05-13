# Agent — Replant Creation Workflow

Documents the design and planned implementation of the agent-assisted replant creation workflow. No code or migrations exist yet. This document drives implementation.

---

## Purpose

Allow users to describe a replant in natural language, have the agent validate it against real database records, collect any missing information, confirm the details, and save the replant — without ever writing to the database until the user explicitly approves.

This workflow covers:
- Single-line replants ("replant 10 units of DKC 100-01 Fungicide AF2 for Scott today")
- Multi-line replants ("create a replant for Scott with 10 units of DKC 100-01 Fungicide AF2 and 15 units of DKC 135-98 Diamide AR")

---

## Critical Safety Rule

**The agent must never save a replant without explicit user confirmation.**

The save tool accepts a `confirmed: boolean` parameter. The system prompt prohibits setting `confirmed: true` unless the user's most recent message is an unambiguous approval ("yes", "confirm", "save it", "looks good", etc.). The tool's `execute` function also validates the user's raw message for confirmation language before writing. If either check fails, the tool returns a structured error instead of saving.

This constraint is non-negotiable and identical in design to the delivery creation workflow.

---

## Relationship to Existing Replant Page

The existing Replants page (`src/app/replants/`) saves replants by writing rows to the `returns` table with `is_replant = true`. The `createReplants` function in `src/services/replant.service.ts` performs a direct `returns` insert with fields:

```
return_date, season_year, customer_id, product_id, treatment_id,
units_returned, seed_size, package_type, order_id, order_item_id, notes
```

**The agent workflow must produce the same row shape and use the same table.** The agent's save tool will call a server-side equivalent of `createReplants` using the `userClient` (user JWT) so that RLS sets `user_id = auth.uid()` automatically.

Order matching (linking replant rows to `order_id` / `order_item_id`) uses the same FIFO allocation logic as deliveries: early-pay lines first, then oldest order, then `created_at`, then `order_id`. Replants without a matching open order line are saved as unlinked rows (`order_id: null`, `order_item_id: null`).

---

## Workflow Overview

```
User: natural language replant description
  ↓
Agent: calls draft_replant_from_chat tool
  ↓
Backend: resolves customer, product, treatment, seed size, units
  ↓
  ├─ Missing or ambiguous fields?
  │     → Agent asks follow-up with DB-backed options
  │     ↓
  │   User provides missing info
  │     ↓
  │   Agent: calls draft_replant_from_chat again with updated draft
  │
  └─ All fields valid? (ready_for_confirmation: true)
        ↓
      Agent: presents full replant summary to user
        ↓
      User: confirms (or requests changes)
        ↓
      Agent: calls save_confirmed_replant (confirmed: true)
        ↓
      Backend: runs order matching, saves rows to returns table, returns replant IDs
        ↓
      Agent: confirms save, offers to print the replant slip
```

Steps:

1. **Extract** — Agent parses the user message and builds an initial draft.
2. **Validate** — `draft_replant_from_chat` tool checks the draft against real DB records.
3. **Clarify** — If any field is missing or ambiguous, the agent asks with valid options from the DB.
4. **Repeat** — Steps 2–3 repeat until the draft passes validation with no missing fields.
5. **Summarize** — Agent presents the complete replant for user review.
6. **Confirm** — User explicitly approves.
7. **Save** — `save_confirmed_replant` tool runs order matching and writes rows to `returns`.
8. **Acknowledge** — Agent confirms the replant was saved.
9. **Print offer** — Agent offers to print the replant slip.

---

## Example Conversation

```
User: Create a replant for Scott Glasgow today with 10 units of DKC 100-01
      Fungicide AF2 and 15 units of DKC 135-98 Diamide.

Agent: [calls draft_replant_from_chat]

Agent: I can prepare this replant, but I need the seed size for
       DKC 135-98 / DIAMIDE. Available options are: AR, AF2.
       What seed size is being replanted?

User: AR

Agent: [calls draft_replant_from_chat with updated draft]

Agent: Here is the replant I'll save:

       Customer: Scott Glasgow (Glasgow Farms)
       Date: May 12, 2026

       Line 1: DKC 100-01 / FUNGICIDE / AF2 / Bag — 10 units
       Line 2: DKC 135-98 / DIAMIDE / AR / Bag — 15 units

       Total: 25 units

       ⚠ Note: Scott Glasgow has no open order for DKC 135-98 / DIAMIDE
         this season. Line 2 will be saved as an unlinked replant.

       Shall I save this replant? (yes/no)

User: Yes

Agent: [calls save_confirmed_replant]

Agent: Replant saved (2 lines). Would you like me to open the print slip?
```

---

## Agent Tool Architecture

Two new agent tools are required. Both follow the existing `makeXxxTool(userClient, serviceClient, userId, threadId, userMessage)` factory pattern used by all agent tools.

### Tool 1: `draft_replant_from_chat`

**Purpose:** Resolves and validates a draft replant against live DB records. Returns a validated draft, any validation errors, and available options for missing or ambiguous fields. Does NOT write anything.

**When called:** After extracting a draft from the user message. Called again each time the user provides missing information, or if the user requests changes to a previously summarized draft.

**Mirrors:** `draft_delivery_from_chat` in structure and resolution logic.

**Inputs:**
```typescript
interface DraftReplantInput {
  customerName: string;        // partial name OK — three-step matching
  replantDate: string;         // pass exactly as user said ("today", "yesterday", or YYYY-MM-DD)
  seasonYear?: number;         // only if user explicitly states a year
  lines: DraftReplantLine[];
  notes?: string;
}

interface DraftReplantLine {
  productName: string;         // partial name OK
  treatmentName: string;       // partial name OK
  units: number;               // units replanted
  seedSize?: string;           // null/omitted if user didn't specify
  packageType?: string;        // 'Bag' or 'Seedpak'; default to 'Bag' if not mentioned
}
```

**Outputs:**
```typescript
interface DraftReplantOutput {
  // Overall status
  ready_for_confirmation: boolean;   // true only when all lines are fully resolved
  draft_id: string;                  // UUID — passed to save_confirmed_replant

  // Header resolution
  resolved_customer_id?: string;
  resolved_customer_name?: string;
  resolved_farm_name?: string;
  resolved_date: string;             // server-resolved ISO date
  date_source: "explicit" | "today_default";
  resolved_season_year?: number;
  season_source: "explicit" | "active_season" | "latest_user_data" | "none";

  // Customer match metadata
  customer: {
    status: "resolved" | "ambiguous" | "missing";
    resolved_customer_name?: string;
    candidates?: { customer_id: string; customer_name: string; farm_name: string | null }[];
  };

  // Per-line resolution
  missing_fields: string[];          // human-readable: ["seed size for line 2"]
  warnings: string[];                // inventory warnings: ["line 2 will be unlinked — no open order found"]
  lines: ResolvedReplantLine[];

  tool_error?: boolean;
  tool_error_message?: string;
}

interface ResolvedReplantLine {
  line_index: number;
  status: "resolved" | "ambiguous" | "missing_fields" | "error";

  // Resolved values (present when status = "resolved")
  product_id?: string;
  product_name?: string;
  treatment_id?: string;
  treatment_name?: string;
  seed_size?: string | null;
  package_type?: string;          // display: 'Bag' or 'Seedpak'
  units: number;

  // Validation issues
  missing_fields: string[];        // e.g. ["seed_size"]
  errors: string[];                // e.g. ["product not found for season"]
  warnings: string[];              // e.g. ["no open order — will be unlinked"]

  // Available options for follow-up questions
  available_seed_sizes?: string[];
  available_treatments?: string[];
  available_package_types?: string[];
}
```

**Resolution logic (inside execute):**

1. **Customer** — three-step match: exact `customer_name` → exact `farm_name` → partial OR both fields (same pattern as `get_customer_current_season_orders`). If multiple customers match a partial name, return all candidates and mark the draft invalid — the agent must ask the user to clarify. Never guess.
2. **Replant date** — use `resolveAgentDate()` from `resolve-date.ts` (same module as delivery workflow). If the user said no date, default to server today. Never use model training-data dates.
3. **Season year** — two-layer defence identical to delivery workflow: model provides `seasonYear` only if the user's message contains a year; backend validates via `isYearMentionedByUser()` and ignores if not. Fallback: latest season from user's orders, then `v_pricing_seasons`.
4. **Product** — ILIKE match on `product_name` against `v_pricing_options` for the resolved season. If multiple products match, return candidates; mark line status `"ambiguous"`.
5. **Treatment** — match within the resolved product's pricing rows for the season. If the user's treatment doesn't match, return `available_treatments` from the product's pricing rows.
6. **Seed size** — required for corn products (`crop = 'corn'`). Pull valid options from `v_pricing_options` for the matched product/treatment. If not provided or invalid, return `available_seed_sizes`.
7. **Package type** — default to `'Bag'` (`'bag'`) if not mentioned. Validate against `'bag'` / `'tote'`. Return `available_package_types` if invalid.
8. **Units** — must be a positive integer. Fractional or zero units are hard errors.
9. **Order match check** — query `v_agent_customer_orders` (or `order_items` directly) for open lines matching this customer/product/treatment/seed_size/package_type. If no open order line exists, add a soft warning: "No open order found — this line will be saved as unlinked." Do not block.
10. **`draft_id`** — generate a UUID per draft call. Store the resolved draft in `agent_tool_calls` as a `validation_pass` record so the pending-draft injection mechanism in `route.ts` can surface it in subsequent turns.

**Logging:** All calls logged to `agent_tool_calls` with status `"validation_pass"` (ready), `"validation_fail"` (missing fields), or `"error"` (DB failure).

---

### Tool 2: `save_confirmed_replant`

**Purpose:** Saves a fully validated and user-confirmed replant to the `returns` table. Runs order matching before insert. Returns the saved replant IDs.

**When called:** Only after the user has explicitly confirmed the replant summary in the current conversation turn.

**Mirrors:** `save_confirmed_delivery` in safety logic and order matching pattern.

**Inputs:**
```typescript
interface SaveConfirmedReplantInput {
  confirmed: boolean;          // MUST be true — see safety rule
  draft_id: string;            // from draft_replant_from_chat output
  confirmation_text: string;   // user's exact confirmation message — for secondary validation
}
```

**Outputs:**
```typescript
interface SaveConfirmedReplantOutput {
  success: boolean;
  replant_ids: string[];       // IDs of the created returns rows
  lines_saved: number;
  unlinked_lines: number;      // lines saved without order_id linkage

  // Error states
  not_confirmed?: boolean;     // true if confirmation guard failed
  tool_error?: boolean;
  tool_error_message?: string;
}
```

**Save logic (inside execute):**

1. **Confirmation guard** — if `confirmed !== true` OR `confirmation_text` does not contain recognition language ("yes", "confirm", "save it", "looks good", "go ahead", "correct", "do it", "yep"), return `{ success: false, not_confirmed: true }` without writing anything.
2. **Draft lookup** — fetch the `validation_pass` record matching `draft_id` from `agent_tool_calls`. If not found or already saved (a later `save_confirmed_replant` success log exists for this `draft_id`), return an error.
3. **Order matching** — for each resolved line, find open `order_items` for this customer/season/product/treatment/seed_size/package_type with remaining `net_units > 0`. Allocate early-pay lines first, then oldest `order_date`, then `created_at`, then `order_id`. Share a mutable open-unit count across all lines (prevent cross-line over-allocation).
4. **Build insert rows** — construct `ReplantInsert[]` rows matching the shape in `replant.service.ts`:
   ```
   return_date, season_year, customer_id, product_id, treatment_id,
   units_returned, seed_size, package_type, order_id, order_item_id, notes
   ```
   Units here represent units replanted (same field as returns — the `returns` table is shared between returns and replants, distinguished by `is_replant` flag if present, or by context).
5. **Insert** — write all rows via `userClient` in a single batch insert against `returns` table. Failure returns `tool_error: true`; no partial save occurs.
6. **Return** — replant IDs and counts.

**Logging:** Logged to `agent_tool_calls` with full input/output JSON and status `"success"`, `"not_confirmed"`, or `"error"`.

---

## Required Fields

### Replant header

| Field | Required | Source |
|---|---|---|
| `customer_id` | Yes | Resolved from customer name via three-step match |
| `replant_date` (→ `return_date`) | Yes | From user message; "today" → current server date via `resolveAgentDate()` |
| `season_year` | Yes | Resolved by season resolution logic; never guessed |

### Each line item

| Field | Required | Notes |
|---|---|---|
| `product_id` | Yes | Resolved via ILIKE on `v_pricing_options` for resolved season |
| `treatment_id` | Yes | Validated against product/season pricing rows |
| `units_returned` | Yes | Must be a positive integer; represents units replanted |
| `seed_size` | Corn only | Required when `crop = 'corn'`; options from `v_pricing_options` |
| `package_type` | Yes | Default `'bag'`; must be `'bag'` or `'tote'` |
| `order_id` | No | Assigned at save time by order matching logic; null = unlinked |
| `order_item_id` | No | Assigned at save time by order matching logic; null = unlinked |
| `notes` | No | Optional; passed through to the row |

---

## Multi-Line Replant Structure

A single replant creation request produces:
- **One replant date / customer / season** (shared across all lines)
- **N rows** in the `returns` table (one per product/treatment/seed_size/package_type combination)

Each line is independently validated. Missing field errors are reported per-line so the agent can ask targeted questions ("I need the seed size for line 2 — DKC 135-98 / DIAMIDE").

Order matching runs across all lines in a single pass to prevent over-allocating the same order item to two replant lines.

This mirrors the existing Replants page multi-line form behavior.

---

## Missing Field Handling

When a required field is absent or ambiguous:

1. `draft_replant_from_chat` returns `ready_for_confirmation: false` with `missing_fields` populated per line.
2. For each missing field, the tool also returns valid options from the DB (`available_seed_sizes`, `available_treatments`, `available_package_types`).
3. The agent uses those options to construct a targeted follow-up question. The options must come directly from tool output — never from model training data.
4. The agent asks for ONE blocking piece of information at a time, in priority order: customer ambiguity → product not found → treatment invalid → seed size missing → units invalid.
5. The agent calls `draft_replant_from_chat` again with the user's answer before re-summarizing.

**Follow-up question format:**
```
I can prepare this replant, but I need [description of missing field].
Available options are: [list from tool output].
```

The options list must come from the tool output. The agent must never generate options from its training data.

---

## Confirmation Requirements

Before calling `save_confirmed_replant`, the agent must:

1. Present a complete replant summary: customer name, farm name (if applicable), replant date, season, all lines (product / treatment / seed size / package type / units), total units, and any warnings.
2. Ask explicitly: "Shall I save this replant?"
3. Wait for the user's response in the current conversation turn.
4. Only set `confirmed: true` if the user's response is an unambiguous approval.

**Approved confirmation phrases** (model-interpreted, not exhaustive): "yes", "confirm", "save it", "go ahead", "looks good", "do it", "correct", "yep", "yup".

**Responses that are NOT confirmation:** "maybe", "I think so", "probably", "let me check", or any non-committing language. The agent should re-ask if intent is unclear.

**If the user requests changes after the summary:** Do not save. Re-extract the updated draft, call `draft_replant_from_chat` again, and restart from step 5.

---

## Pending Draft Injection

The existing pending draft mechanism in `route.ts` queries `agent_tool_calls` for the latest `validation_pass` record with no subsequent successful save in the same thread. The replant workflow will reuse this mechanism.

When `draft_replant_from_chat` returns `ready_for_confirmation: true`, it logs the call with status `"validation_pass"`. The next request to `route.ts` detects this pending draft and injects the `draft_id` into the system prompt, enabling `save_confirmed_replant` to be called directly on a user confirmation without re-running the draft tool.

This is the same cross-turn state design as the delivery workflow.

**Scope consideration:** Both delivery and replant pending drafts share the `agent_tool_calls` table. The route.ts pending-draft query filters by `tool_name`. The replant implementation must use `tool_name: "draft_replant_from_chat"` and the injection block must separately check for pending replant drafts, emitting a distinct "## Pending replant draft" section in the system prompt.

---

## Validation Rules

### Hard errors (block save)

| Check | Error message pattern |
|---|---|
| Customer not found | "I couldn't find a customer matching '[name]'. Please check the name and try again." |
| Customer ambiguous | "Multiple customers match '[name]': [list]. Which did you mean?" |
| Product not found for season | "I couldn't find '[name]' in the [year] season pricing." |
| Treatment not valid for product | "Treatment '[name]' is not available for [product]. Available treatments: [list]." |
| Seed size required but missing | "I need the seed size for [product] / [treatment]. Options: [list]." |
| Seed size not valid | "'[size]' is not a valid seed size for [product] / [treatment]. Options: [list]." |
| Package type invalid | "Package type must be Bag or Seedpak." |
| Units not positive | "Units must be a positive whole number." |
| Season cannot be resolved | "I couldn't determine the season year. Please check your pricing data." |

### Soft warnings (shown in summary, do not block)

| Check | Warning message pattern |
|---|---|
| No open order for product | "⚠ [customer] has no open order for [product] / [treatment] — this line will be saved as an unlinked replant." |
| Multiple customers — user must choose | "Multiple customers matched '[name]'. Which did you mean: [list]?" (hard error until resolved) |

---

## Save Rules

1. `save_confirmed_replant` always uses `userClient` (user JWT) so `user_id = auth.uid()` is set by RLS, not application code.
2. **Order matching** runs before insert. Logic mirrors the delivery workflow's `findOrderLineMatches` pattern:
   - For each line, find open `order_items` matching (customer_id, product_id, treatment_id, seed_size, package_type, season_year) with remaining net_units > 0.
   - Allocate early-pay lines first, then oldest `order_date`, then `created_at`, then `order_id`.
   - Track open-unit counts across all lines in a single pass (prevents cross-line over-allocation).
3. **Unlinked rows:** rows with `order_id = null` and `order_item_id = null` are valid and match existing UI behavior.
4. **Atomic insert:** all rows are inserted in a single batch call against the `returns` table. If any row fails, no rows are written.
5. **No duplicate guard at tool level:** the tool does not attempt to detect duplicate replants. The user is responsible for confirming correct details.
6. **`draft_id` consumed:** after a successful save, log to `agent_tool_calls` with status `"success"`. The pending-draft injection logic will then see a successful save after the `validation_pass` record and stop injecting the draft.

---

## Print-After-Save Behavior

After a successful save, the agent:

1. Confirms: "Replant saved ([N] lines, [total_units] units)."
2. Automatically calls a `get_replant_print_link` tool (or equivalent) to retrieve a print URL, mirroring the `get_delivery_print_link` behavior.
3. A "Print Replant Slip" button is rendered below the agent response from the print URL in the tool output — the agent does not embed the URL in text.
4. If the print link tool fails, the agent says: "You can also print from the Replants page."

The print URL format should follow the same pattern as deliveries: `/replants/print/[id]`.

> **Dependency:** A replant print page and a `get_replant_print_link` tool must be created as part of the implementation. The print page renders the same data as the existing Replants page detail view.

---

## Audit and Logging Requirements

| Event | Logged to | Status value |
|---|---|---|
| `draft_replant_from_chat` — all fields resolved | `agent_tool_calls` | `"validation_pass"` |
| `draft_replant_from_chat` — missing or ambiguous fields | `agent_tool_calls` | `"validation_fail"` |
| `draft_replant_from_chat` — DB error | `agent_tool_calls` | `"error"` |
| `save_confirmed_replant` — confirmation guard triggered | `agent_tool_calls` | `"not_confirmed"` |
| `save_confirmed_replant` — rows written | `agent_tool_calls` | `"success"` |
| `save_confirmed_replant` — DB error | `agent_tool_calls` | `"error"` |
| `get_replant_print_link` — success | `agent_tool_calls` | `"success"` |
| `get_replant_print_link` — error | `agent_tool_calls` | `"error"` |

All log entries include: `thread_id`, `user_id`, `tool_name`, `input_json`, `output_json`, `status`, `error_message`.

The `returns` table already carries `created_at` and `updated_at`. No additional audit table is required.

---

## Risks and Cautions

### Confirmation bypass
**Risk:** The model sets `confirmed: true` without actual user approval.
**Mitigation:** `save_confirmed_replant` performs a secondary check on the raw `confirmation_text` for confirmation language, independent of the `confirmed` flag. Both must pass. If either fails, nothing is written.

### Replant vs return confusion
**Risk:** The `returns` table stores both returns and replants. If the save tool inserts without the correct `is_replant` flag (if one is used), records may appear on the wrong page.
**Mitigation:** Verify the exact schema field that distinguishes replants from returns in the `returns` table before implementation. If no such flag exists, confirm with the existing service logic (`replant.service.ts`) how replants are differentiated — and replicate that exactly.

### Customer ambiguity
**Risk:** A partial name like "Scott" matches multiple customers.
**Mitigation:** `draft_replant_from_chat` returns all candidates when a partial match hits > 1 customer, marks the draft `ready_for_confirmation: false`, and the agent must ask the user to choose by exact name.

### Season year hallucination
**Risk:** The model injects a year from its training data (e.g. 2023) when the user never mentioned one.
**Mitigation:** Two-layer defence: model schema description prohibits providing `seasonYear` unless the user's message contains a year; backend calls `isYearMentionedByUser()` and discards if false. Same pattern as all other seasonal tools.

### Date hallucination
**Risk:** The model converts "today" to a date from its training data cutoff.
**Mitigation:** `replantDate` schema description instructs the model to pass the value exactly as the user said it ("today", "yesterday", YYYY-MM-DD). Backend resolves via `resolveAgentDate()` from `resolve-date.ts`. Model never converts date words to ISO strings.

### Seed size invention
**Risk:** The model guesses a seed size and passes it as if the user confirmed it.
**Mitigation:** If seed size is missing, `draft_replant_from_chat` returns `ready_for_confirmation: false` with `missing_fields` and `available_seed_sizes`. The model must ask the user — it may not fill in the seed size itself.

### Pending draft collision with delivery drafts
**Risk:** A pending delivery draft and a pending replant draft both exist in the same thread. The route.ts injection logic injects both, and the model calls the wrong save tool.
**Mitigation:** The system prompt sections for pending delivery and pending replant drafts must be clearly labeled ("## Pending delivery draft" vs "## Pending replant draft") with unambiguous save tool names. The pending-draft queries in `route.ts` must separately filter by `tool_name = "draft_delivery_from_chat"` and `tool_name = "draft_replant_from_chat"`.

### Partial save on batch insert failure
**Risk:** Supabase `.insert()` fails partway through a multi-row batch.
**Mitigation:** A single `.insert(rows)` call on the `returns` table is atomic at the Postgres level. If the call returns an error, no rows are written. The tool returns `tool_error: true` and the user is told to try again.

### Order matching over-allocation across lines
**Risk:** Two replant lines in the same request both claim units from the same order item.
**Mitigation:** Order matching runs in a single pass with a shared mutable open-units map, the same pattern as the delivery workflow. Cross-line over-allocation is impossible within one tool call.

---

## Implementation Status

Phases 1 and 2 are complete.

- [x] `draft_replant_from_chat` — server-side resolution and validation, no DB writes (`src/lib/agent/tools/draft-replant-from-chat.ts`)
- [x] `save_confirmed_replant` — confirmation guard + order matching + `replants` insert (`src/lib/agent/tools/save-confirmed-replant.ts`)
- [x] Both tools registered in `src/app/api/agent/chat/route.ts` and exported from `src/lib/agent/tools/index.ts`
- [x] Pending replant draft injection in `route.ts` — detects `validation_pass` drafts not yet saved and injects `draft_id` into system prompt
- [x] Duplicate save guard — checks for existing `save_confirmed_replant` success log before writing
- [x] `draft_type: "replant"` field in draft output — save tool verifies this before writing

Pending (not yet implemented):
- [ ] `get_replant_print_link` tool — requires a URL-based replant print page; existing print page uses sessionStorage (not agent-compatible)
- [ ] `/replants/print/[id]` page — needed to enable deep-linked print from agent response

Note: The workflow doc referenced `returns` table and `units_returned`. The actual canonical save uses the `replants` table with `units_replanted` (from `replants.service.ts`). The implementation follows the actual service.

See [07_delivery_creation_workflow.md](07_delivery_creation_workflow.md) for the delivery workflow implementation, which this design mirrors closely.
