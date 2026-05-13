# Agent — Return Creation Workflow

Documents the design and planned implementation of the agent-assisted return creation workflow. No code or migrations exist yet. This document drives implementation.

---

## Purpose

Allow users to describe a seed return in natural language, have the agent validate it against real database records, collect any missing information, confirm the details, and save the return — without ever writing to the database until the user explicitly approves.

This workflow covers:
- Single-line returns ("create a return for Scott today with 10 units of DKC 100-01 Fungicide AF2 Bag")
- Multi-line returns ("create a return for Scott Glasgow with 10 units of DKC 100-01 Fungicide AF2 Bag and 15 units of DKC 135-98 Diamide AR Bag")

---

## Critical Safety Rule

**The agent must never save a return without explicit user confirmation.**

The save tool validates the user's raw message for confirmation language before writing. If either the model-supplied `confirmation_text` or the raw `userMessage` fails to match an explicit approval pattern, the tool returns a structured error without saving anything.

This constraint is non-negotiable and identical in design to the delivery and replant creation workflows.

---

## Relationship to Existing Returns Page

The existing Returns page (`src/app/returns/`) saves returns by writing rows directly to the `returns` table. The `createReplants` function in `src/services/replant.service.ts` (confusingly named) handles this with these fields:

```
return_date, season_year, customer_id, product_id, treatment_id,
units_returned, seed_size, package_type, order_id, order_item_id, notes
```

**The agent workflow must produce the exact same row shape and write to the same `returns` table.** The agent's save tool will use `userClient` (user JWT) so that RLS sets `user_id = auth.uid()` automatically, matching the browser-side behavior.

Order matching — linking return rows to `order_id` / `order_item_id` — uses the same FIFO allocation logic as deliveries and replants: early-pay lines first, then oldest `order_date`, then `created_at`, then `order_id`. Returns without a matching open order line are saved as unlinked rows (`order_id: null`, `order_item_id: null`).

The existing Returns page also supports packaging returns (products like bags/totes with a `NO_TREATMENT` treatment). The agent workflow explicitly excludes packaging returns — it handles only standard seed products from `v_pricing_options`. Packaging returns are complex and uncommon enough that they should remain manual-only.

---

## Workflow Overview

```
User: natural language return description
  ↓
Agent: calls draft_return_from_chat tool
  ↓
Backend: resolves customer, product, treatment, seed size, units
  ↓
  ├─ Missing or ambiguous fields?
  │     → Agent asks follow-up with DB-backed options
  │     ↓
  │   User provides missing info
  │     ↓
  │   Agent: calls draft_return_from_chat again with updated fields
  │
  └─ All fields valid? (ready_for_confirmation: true)
        ↓
      Agent: presents full return summary to user
        ↓
      User: confirms (or requests changes)
        ↓
      Agent: calls save_confirmed_return
        ↓
      Backend: runs order matching, saves rows to returns table, returns IDs
        ↓
      Agent: calls get_return_print_link automatically
        ↓
      Print button appears below agent reply
```

Steps:

1. **Extract** — Agent parses the user message and builds an initial draft.
2. **Validate** — `draft_return_from_chat` checks each field against real DB records.
3. **Clarify** — If any field is missing or ambiguous, the agent asks with valid options from the DB.
4. **Repeat** — Steps 2–3 repeat until the draft passes validation with no missing fields.
5. **Summarize** — Agent presents the complete return summary for user review.
6. **Confirm** — User explicitly approves.
7. **Save** — `save_confirmed_return` runs order matching and writes rows to `returns`.
8. **Print** — `get_return_print_link` is called automatically; print button appears.

---

## Required Fields

### Return header (one per return)

| Field | Required | Notes |
|---|---|---|
| `customer` | Yes | Resolved to `customer_id` via three-step name matching |
| `return_date` | Yes | Resolved by backend using `resolveAgentDate` — never model-generated |
| `season_year` | Yes | Resolved by backend via `resolveDefaultSeasonForUser` unless user explicitly stated a year |

### Per line item (one per product/treatment combination)

| Field | Required | Notes |
|---|---|---|
| `product` | Yes | Resolved via `v_pricing_options` for the resolved season |
| `treatment` | Yes | Resolved against valid treatments for the matched product/season |
| `units_returned` | Yes | Must be a positive whole number |
| `seed_size` | Corn only | Required for corn products; not required for soybeans |
| `package_type` | No | Defaults to `"Bag"` if not stated; stored as `"bag"` or `"tote"` in DB |

### Optional

| Field | Notes |
|---|---|
| `notes` | Free text; stored on every inserted row |

---

## Multi-Line Return Structure

The draft supports one header with one or more item lines, identical in structure to the delivery and replant drafts. Each item line is resolved independently. The model passes an `items` array in the tool input; the backend validates each item and returns per-line validation status.

A return is only `ready_for_confirmation: true` when all header fields AND all item lines are fully resolved with no missing or invalid fields.

---

## Missing Field Behavior

When a required field cannot be resolved:

- **Missing customer**: "I couldn't find a customer matching '[input]'. Please check the name or use the Returns page."
- **Ambiguous customer** (multiple matches): List the candidates by name and ask the user to pick one.
- **Missing product**: "I couldn't find a product matching '[input]' in the current season. Available products include: [list from pricing]."
- **Ambiguous product**: List the matching product names and ask.
- **Missing treatment**: "The treatment '[input]' was not found for [product]. Available treatments are: [list from pricing for that product]."
- **Ambiguous treatment**: List matching treatment names and ask. Exact match wins; fall back to partial only if exact yields nothing.
- **Missing seed size (corn)**: "What seed size should I use for [product] / [treatment]? Options from current inventory: [list]."
- **Invalid units** (not a positive whole number): "Units must be a positive whole number. How many units are being returned?"

All options must come from real database queries — never from model knowledge or training data.

---

## Confirmation Requirements

The save tool must confirm the return before writing. Confirmation is validated on two layers:

1. **Model layer** — `confirmation_text` passed by the model must contain an explicit approval phrase.
2. **Backend layer** — The raw `userMessage` is also checked. If either passes, the confirmation guard is satisfied.

Confirmed phrases: `yes`, `confirm`, `save it`, `save return`, `save this`, `looks good`, `correct`, `go ahead`, `do it`, `yep`, `yup`.

Not confirmed: `ok` alone, `maybe`, `sure?`, any ambiguous or hedging language.

If confirmation is rejected, the tool returns `not_confirmed: true` and no rows are written.

---

## Draft Output Structure

`draft_return_from_chat` returns:

```typescript
{
  draft_type: "return";
  customer: {
    input: string | null;
    resolved_customer_id: string | null;
    resolved_customer_name: string | null;
    farm_name: string | null;
    status: "resolved" | "missing" | "ambiguous";
    candidates?: Array<{ customer_id, customer_name, farm_name }>;
  };
  return_date: {
    input: string | null;
    resolved_date: string;           // always an ISO date from server clock
    date_source: "explicit" | "today_default";
    user_explicitly_requested_date: boolean;
    status: "resolved";
  };
  season_year: {
    resolved_season_year: number | null;
    season_source: SeasonSource;
    status: "resolved" | "missing";
  };
  items: Array<{
    line_index: number;
    product: { ...; status: "resolved" | "missing" | "ambiguous"; options?: string[] };
    treatment: { ...; status: "resolved" | "missing" | "ambiguous"; options?: string[] };
    seed_size: { ...; status: "resolved" | "missing" | "not_required"; options: string[] };
    package_type: { ...; status: "resolved"; options: string[] };
    units_returned: { ...; status: "resolved" | "missing" | "invalid" };
    warnings: string[];
  }>;
  missing_fields: string[];
  warnings: string[];
  ready_for_confirmation: boolean;
  draft_id?: string;                 // only present when ready_for_confirmation: true
  tool_error?: boolean;
  tool_error_message?: string;
}
```

The `draft_id` is the `agent_tool_calls.id` of the logged row. It is passed to `save_confirmed_return` and used to prevent duplicate saves.

---

## Validation Rules

### Customer
- Three-step matching: exact `customer_name` → exact `farm_name` → partial match on either field.
- Exactly one match required for `status: "resolved"`.
- Multiple matches → `status: "ambiguous"`, list candidates.
- No match → `status: "missing"`.

### Product
- Query `v_pricing_options` for `season_year`.
- Exact case-insensitive match first; partial (contains) only if exact yields nothing.
- Unique product required for resolution. Multiple → `status: "ambiguous"`.

### Treatment
- Filtered to the resolved product's rows in `v_pricing_options`.
- Same exact-before-partial matching logic as product.
- `allTreatmentNames` returned as options whenever status is not `resolved`.

### Seed size
- Only required when `crop = 'corn'` for the resolved product.
- Options fetched from `v_on_hand_inventory` filtered by `product_id` and `treatment_id`.
- If user provides a seed size not found in current inventory, emit a warning (not a validation failure).
- Soybean products → `status: "not_required"`, `resolved_seed_size: null`.

### Package type
- Defaults to `"Bag"` (stored as `"bag"`) if not stated.
- Accepted values: `"Bag"` / `"bag"` → stored as `"bag"`; `"Seedpak"` / `"tote"` → stored as `"tote"`.
- Always `status: "resolved"` since a default exists.

### Units
- Must be a positive integer (`Math.floor(units) === units && units > 0`).
- Non-integer or zero → `status: "invalid"`.
- Negative → `status: "invalid"`.
- No maximum check: unlike deliveries, returns increase available inventory, so no "exceeds available" warning is needed.

### Season
- Backend resolves via `resolveDefaultSeasonForUser`. User-stated year is accepted only if the year number appears in the raw user message (`isYearMentionedByUser`). Otherwise the backend ignores the model-supplied `seasonYear` and uses the latest season.

### Date
- Backend resolves via `resolveAgentDate`. Model must pass the user's exact wording ("today", "yesterday", YYYY-MM-DD). Backend converts relative words using real server clock.
- If the user did not mention a date at all, backend defaults to today regardless of any date the model might pass.

---

## Save Rules

`save_confirmed_return` must:

1. Check confirmation guard on both `confirmation_text` and raw `userMessage`.
2. Load the draft from `agent_tool_calls` by `draft_id` using `userClient` (RLS ensures ownership).
3. Verify `draft.draft_type === "return"` — reject delivery or replant drafts.
4. Verify `draft.ready_for_confirmation === true`.
5. **Check for duplicate save**: query `agent_tool_calls` for an existing `save_confirmed_return` success row with `input_json @> { draft_id: '<id>' }`. Reject if found.
6. Build `SaveLine[]` from resolved items.
7. Run `serverFindOrderLineMatches` — same FIFO allocation logic used for deliveries and replants.
8. Build `ReplantInsert[]` rows (using the same interface as the Returns page).
9. Insert rows into `returns` using `userClient`.
10. Log the result to `agent_tool_calls` with `tool_name: "save_confirmed_return"` and `status: "success"`.
11. Return `{ success: true, return_ids: string[], lines_saved: number, unlinked_lines: number }`.

On any failure before the insert: log with `status: "error"`, return `tool_error: true`.

---

## Print-After-Save Behavior

After `save_confirmed_return` succeeds, the agent immediately calls `get_return_print_link` with the first item from `return_ids`. The model does not wait for the user to ask.

`get_return_print_link` must:
1. Verify the return exists in `returns` using `userClient` (RLS ownership check).
2. Return `print_url: /returns/print/${return_id}`.
3. Log to `agent_tool_calls`.

The route `/returns/print/[id]/page.tsx` must be created (does not exist yet). It follows the same pattern as the existing `/deliveries/print/[id]` and `/replants/print/[id]` pages:
- Fetch anchor row from `v_returns_this_season` by `return_id`.
- Fetch all sibling rows sharing the same `(customer_id, return_date, season_year, notes, created_at)`.
- Aggregate units by `(product_name, treatment_name)`.
- Fetch customer info from `customers`.
- Render `ReturnPrintView`.
- Auto-trigger `window.print()` after 400 ms.

The existing `/returns/print` page (sessionStorage-based) is not modified.

The `steps` loop in `route.ts` must handle `get_return_print_link` tool results in addition to the existing delivery and replant handlers, setting `assistantMetadata.actions` with `label: "Print Return Slip"`.

---

## Pending Draft State

After `draft_return_from_chat` logs a `validation_pass` row, `route.ts` injects a `## Pending return draft` section into the system prompt on subsequent turns:

```
## Pending return draft

draft_id: <uuid>
Status: awaiting user confirmation

- If the user's current message is a confirmation — call save_confirmed_return IMMEDIATELY with this draft_id.
- If the user requests changes, call draft_return_from_chat with the updated information.
- If the user asks what was in the draft, remind them and ask if they'd like to confirm or change something.
```

The pending draft section is injected only if no `save_confirmed_return` success row with `created_at > latestReturnDraft.created_at` exists for the thread. This prevents re-injecting after a successful save.

Pending delivery, replant, and return drafts can coexist in the same thread. Each uses a distinct `tool_name` filter for detection and a distinct system prompt heading. The model is instructed never to confuse one draft type with another's save tool.

---

## Audit and Logging

All tool calls log to `agent_tool_calls`:

| Event | `tool_name` | `status` |
|---|---|---|
| Draft attempt (validation pass) | `draft_return_from_chat` | `validation_pass` |
| Draft attempt (validation fail) | `draft_return_from_chat` | `validation_fail` |
| Draft attempt (tool error) | `draft_return_from_chat` | `error` |
| Save attempt (confirmation rejected) | `save_confirmed_return` | `not_confirmed` |
| Save attempt (success) | `save_confirmed_return` | `success` |
| Save attempt (error) | `save_confirmed_return` | `error` |
| Print link (success) | `get_return_print_link` | `success` |
| Print link (error) | `get_return_print_link` | `error` |

The `draft_id` stored in `save_confirmed_return.input_json` is the `agent_tool_calls.id` of the originating `draft_return_from_chat` row, creating a traceable chain from draft to save.

---

## Risks and Cautions

**Duplicate save**: The duplicate save guard (step 5 in save rules) is mandatory. Without it, a model that calls `save_confirmed_return` twice on the same draft would insert duplicate rows into `returns`. The guard uses `@>` JSON containment on `input_json`.

**Draft type confusion**: Three pending draft types can coexist in a thread (delivery, replant, return). The `draft_type` field in the draft output and the `tool_name` filter in `agent_tool_calls` must be used together to prevent the model from calling the wrong save tool.

**Season hallucination**: The model must not pass a `seasonYear` unless the user explicitly stated one. The backend rejects model-guessed years using `isYearMentionedByUser`.

**Date hallucination**: The model must pass the user's exact date wording ("today", "yesterday", etc.). The backend always resolves relative words using server clock, not model knowledge. If the model passes an ISO date the user never stated, the date resolution layer falls back to today.

**No inventory check on returns**: Unlike deliveries, returning seed units increases available inventory. The tool does not check whether units exceed any delivery history or order quantity. This is intentional — returns can sometimes exceed originally-delivered quantities due to packaging differences, adjustments, or manual corrections. If this changes in the future, a warning (not a validation failure) should be added.

**Order matching optional**: Returns are linked to open order lines using the same FIFO logic as deliveries. However, a return without a matching order line is saved as an unlinked row (not rejected). Unlinked returns are normal and expected.

**Packaging returns excluded**: The agent does not support packaging product returns (items with `NO_TREATMENT` treatment from `fetchPackagingProducts`). These must continue to go through the manual Returns page.

---

## Implementation Plan

### Phase 1 — `draft_return_from_chat` tool

File: `src/lib/agent/tools/draft-return-from-chat.ts`

Mirror `draft-replant-from-chat.ts` exactly, with these changes:
- Input field: `returnDate` (not `replantDate`)
- Output top-level date field: `return_date` (not `replant_date`)
- Output item field: `units_returned` (not `units_replanted`)
- `draft_type: "return"` in output
- Tool name in logs: `"draft_return_from_chat"`
- No inventory availability warning (returns do not reduce available stock)

### Phase 2 — `save_confirmed_return` tool

File: `src/lib/agent/tools/save-confirmed-return.ts`

Mirror `save-confirmed-replant.ts` exactly, with these changes:
- Checks `draft.draft_type === "return"` (not `"replant"`)
- Loads item field: `item.units_returned.resolved_units` (not `units_replanted`)
- Uses `ReplantInsert`-compatible row shape from `replant.service.ts`: `return_date`, `units_returned`
- Inserts into `returns` table (not `replants`)
- Tool name in logs: `"save_confirmed_return"`
- Returns `{ success, return_ids, lines_saved, unlinked_lines }`

### Phase 3 — `get_return_print_link` tool

File: `src/lib/agent/tools/get-return-print-link.ts`

Mirror `get-replant-print-link.ts` with:
- Verifies existence in `returns` table
- Returns `print_url: /returns/print/${return_id}`
- Tool name in logs: `"get_return_print_link"`

### Phase 4 — `/returns/print/[id]/page.tsx`

New file: `src/app/returns/print/[id]/page.tsx`

Mirrors `/replants/print/[id]/page.tsx` with:
- Queries `v_returns_this_season` by `return_id`
- Sibling grouping by `(customer_id, return_date, season_year, notes, created_at)`
- Aggregates `units_returned` by `(product_name, treatment_name)`
- Renders `ReturnPrintView` with `returnDate` prop
- Back button: "← Back to Returns"
- Uses `../print.module.css` (existing)

### Phase 5 — Wire into `route.ts`

- Import and add `makeGetReturnPrintLinkTool`, `makeDraftReturnFromChatTool`, `makeSaveConfirmedReturnTool`
- Add to `tools` object
- Add pending return draft detection block (same pattern as delivery and replant)
- Add `pendingReturnDraftSection` to system string
- Add system prompt sections: `draft_return_from_chat`, `save_confirmed_return`, `get_return_print_link`
- Update `save_confirmed_return` system prompt: instruct model to auto-call `get_return_print_link` after success
- Extend `steps` loop to handle `get_return_print_link` → `label: "Print Return Slip"`
- Export new tools from `src/lib/agent/tools/index.ts`

### Phase 6 — TypeScript check

`npx tsc --noEmit` must pass with zero errors before marking implementation complete.
