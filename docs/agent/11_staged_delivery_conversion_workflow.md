# Agent — Staged Delivery Conversion Workflow

Documents the design and planned implementation of the agent-assisted staged delivery conversion workflow. This document drives implementation — no code or migrations are created until after this document is reviewed.

---

## Purpose

Allow users to ask the agent which staged deliveries exist for a customer, select one, confirm the conversion, and have the agent convert that staged delivery into an actual delivery — without writing to the database until the user explicitly approves.

Converting a staged delivery through the agent must produce the same database state as converting one through the existing Staged Deliveries page:
- An actual delivery is created (one or more rows in `deliveries` via order matching).
- The staged delivery header is updated to `status = 'converted'` with a `converted_at` timestamp.
- The staged delivery items are removed from active inventory via the status change (the `staged` CTE in `v_on_hand_inventory` only includes `in_progress` rows).
- Physical inventory is updated: staged units are released and the delivered units are counted against physical on hand.

This workflow uses the existing `get_staged_deliveries` tool (no new retrieval tool required) and adds one new write tool: `convert_confirmed_staged_delivery`.

---

## Critical Safety Rule

**The agent must never convert a staged delivery into an actual delivery without explicit user confirmation.**

The conversion tool accepts a `confirmation_text` parameter and independently checks the user's raw message for confirmation language before writing anything. If either the model's intent or the raw-message check fails, the tool returns a structured error without converting. This is the same non-negotiable constraint applied to all agent write operations (delivery, replant, return, staged delivery creation).

---

## Workflow Overview

```
User: asks what staged deliveries exist for a customer
  ↓
Agent: calls get_staged_deliveries (existing tool)
  ↓
Backend: returns in-progress staged deliveries for the customer
  ↓
Agent: presents the list
  ↓
User: asks to convert one
  ↓
  ├─ Multiple staged deliveries match?
  │     → Agent asks user to choose (by date, product, or ID)
  │     → User selects one
  │
  └─ One staged delivery identified?
        ↓
      Agent: presents full conversion summary
        ↓
      User: confirms (or cancels)
        ↓
      Agent: calls convert_confirmed_staged_delivery
        ↓
      Backend: runs order matching, creates delivery rows,
               marks staged delivery as converted
        ↓
      Agent: confirms, calls get_delivery_print_link
        ↓
      UI: renders Print Delivery Slip button
```

Steps:

1. **Retrieve** — Agent calls `get_staged_deliveries` with the customer name. Returns all in-progress staged deliveries.
2. **Identify** — Agent selects the matching staged delivery from the result. If multiple match the user's description, the agent asks the user to choose.
3. **Summarize** — Agent presents the staged delivery details and states what the conversion will do.
4. **Confirm** — User explicitly approves.
5. **Convert** — `convert_confirmed_staged_delivery` runs order matching, inserts delivery rows, and marks the staged delivery as converted.
6. **Acknowledge** — Agent confirms the conversion was successful.
7. **Print** — Agent immediately calls `get_delivery_print_link` and the UI renders a Print Delivery Slip button.

---

## Example Conversation

```
User: What staged deliveries do you have for Scott?

Agent: [calls get_staged_deliveries(customerName: "Scott")]

Agent: Scott Glasgow (Glasgow Farms) has 1 in-progress staged delivery:

       Staged: May 10, 2026
       Line 1: DKC 100-01 / FUNGICIDE / AR / Bag — 50 units
       Line 2: DKC 135-98 / DIAMIDE / AR / Bag — 25 units

       Total: 75 units staged

User: Convert that staged delivery into an actual delivery.

Agent: I'll convert Scott's staged delivery from May 10, 2026 into an actual
       delivery. Here is what will be created:

       Customer: Scott Glasgow (Glasgow Farms)
       Delivery Date: May 10, 2026

       Line 1: DKC 100-01 / FUNGICIDE / AR / Bag — 50 units
       Line 2: DKC 135-98 / DIAMIDE / AR / Bag — 25 units

       This will create an actual delivery and remove the staged delivery from
       the in-progress list. Order allocation will run automatically.

       Confirm? (yes / no)

User: Yes

Agent: [calls convert_confirmed_staged_delivery]
       [calls get_delivery_print_link]

Agent: Staged delivery converted to delivery (2 lines, 75 units).
       [Print Delivery Slip button rendered by UI]
```

With multiple staged deliveries for the same customer:

```
User: Convert Scott's staged delivery.

Agent: [calls get_staged_deliveries(customerName: "Scott")]

Agent: Scott Glasgow has 2 in-progress staged deliveries. Which one do you
       want to convert?

       1. May 10, 2026 — 75 units (DKC 100-01 Fungicide AR, DKC 135-98 Diamide AR)
       2. May 12, 2026 — 30 units (DKC 094-94 Fungicide AR)

User: The May 10 one.

Agent: I'll convert Scott's staged delivery from May 10, 2026 into an actual
       delivery. Here is what will be created:
       ...
```

---

## Agent Tool Architecture

One new agent tool is required. The retrieval step reuses the existing `get_staged_deliveries` tool — no new retrieval tool is needed.

---

### Existing Tool: `get_staged_deliveries`

Already implemented. The agent calls this to retrieve in-progress staged deliveries for a customer. The tool returns `staged_delivery_id`, all line items, `staged_date`, `customer_name`, `farm_name`, `units_staged`, `notes`, and `status`.

The agent uses this data to:
- Present the list to the user.
- Identify which staged delivery the user wants to convert.
- Build the conversion summary without a separate DB round-trip.

---

### New Tool: `convert_confirmed_staged_delivery`

**Purpose:** Converts a user-identified and user-confirmed in-progress staged delivery into an actual delivery. Runs order matching. Updates the staged delivery status to `'converted'`. Returns the created delivery IDs.

**When called:** Only after the user has explicitly confirmed the conversion in the current conversation turn.

**Tool name:** `convert_confirmed_staged_delivery`

**Input schema:**
```typescript
interface ToolInput {
  staged_delivery_id: string;
  confirmation_text: string;
}
```

**Output schema:**
```typescript
interface ToolOutput {
  success: boolean;
  staged_delivery_id: string;
  delivery_ids: string[];
  delivery_rows_created: number;
  not_confirmed?: boolean;
  tool_error?: boolean;
  tool_error_message?: string;
}
```

**Execute logic (inside execute function):**

1. **Confirmation guard** — check `confirmation_text` against the same `CONFIRM_PATTERNS` used by all save tools ("yes", "confirm", "save it", "looks good", "correct", "go ahead", "do it", "yep", "yup"). Also independently check the raw `userMessage` passed at tool construction time. If neither passes, return `{ success: false, not_confirmed: true }` without writing anything.

2. **Load header** — fetch the `staged_deliveries` row by `id` using `userClient` (RLS enforces ownership). If not found, return `tool_error: true`.

3. **Status guard** — verify `header.status === 'in_progress'`. If not, return `tool_error: true` with a message: `"This staged delivery has already been ${header.status}. Please refresh and try again."` This prevents duplicate conversions even if the model calls the tool twice.

4. **Load items** — fetch `staged_delivery_items` rows for the `staged_delivery_id` using `userClient`. If none found, return `tool_error: true` with "No items found for this staged delivery."

5. **Order matching** — build `LineToMatch[]` from the items and call the server-safe `findOrderLineMatches` logic (same pattern used in `save-confirmed-delivery.ts` — accepts a `SupabaseClient` argument rather than calling `getSupabaseBrowserClient()`).

6. **Build delivery rows** — for each staged item, generate delivery insert rows:
   - If the item has order allocations, generate one row per allocation (`order_id`, `order_item_id`, split `units_delivered`).
   - If allocated units are less than `units_staged`, add one unlinked row for the remainder (`order_id: null`, `order_item_id: null`).
   - If the item has no allocations, generate one unlinked row for the full `units_staged`.
   - All rows use `delivery_date: header.staged_date`, `customer_id: header.customer_id`, `season_year: header.season_year`, `notes: header.notes`.

7. **Insert deliveries** — insert all delivery rows in one batch via `userClient`. If insert fails, the staged delivery remains `in_progress` — return `tool_error: true` without attempting the status update.

8. **Mark as converted** — update `staged_deliveries` via `userClient`:
   ```
   status = 'converted', converted_at = now()
   WHERE id = staged_delivery_id AND status = 'in_progress'
   ```
   The `AND status = 'in_progress'` guard prevents a race condition where the staged delivery was already converted by a concurrent action (Staged Deliveries page). If the update affects 0 rows, return a clear error: "Delivery was created but the staged delivery could not be marked as converted — it may have already been converted. Check the Deliveries page."

9. **Log and return** — log to `agent_tool_calls` and return `{ success: true, staged_delivery_id, delivery_ids, delivery_rows_created }`.

**Logging:**
- `status: "success"` on full success
- `status: "not_confirmed"` if confirmation guard fires
- `status: "error"` on any DB failure

---

## Staged Delivery Selection Rules

The agent selects the staged delivery to convert using the data returned by `get_staged_deliveries`. No additional DB query is needed for selection.

### Single match
If `get_staged_deliveries` returns exactly one `staged_delivery_id` for the customer, the agent uses that one without asking.

### Multiple matches
If `get_staged_deliveries` returns more than one `staged_delivery_id` for the customer, the agent must present all options and ask the user to choose. The agent may not silently pick one.

Present the list as a numbered set with key details per entry: staged date, total units, and a brief product summary (first product name + treatment). The user can choose by number, by date, or by description.

### Selection by staged_delivery_id
If the user states a specific ID (unlikely but possible), the agent uses it directly. The tool will reject it with a clear error if it doesn't belong to the user (RLS enforces this).

### No match
If `get_staged_deliveries` returns zero rows for the customer, the agent reports that no in-progress staged deliveries were found for that customer. The agent must not speculate or guess — it only converts staged deliveries that the tool confirmed exist.

---

## Ambiguity Handling

| Situation | Agent behavior |
|---|---|
| User says "convert Scott's delivery" but Scott has 2 staged deliveries | Present numbered list; ask which one |
| User says "the big one" or "the recent one" | Present the candidates and ask to confirm by date or product |
| User says "convert all of Scott's staged deliveries" | Decline; convert one at a time |
| User names a customer not found | Report no match; do not guess |
| User identifies the wrong staged delivery | Re-present the summary; user can say no and try again |

**The agent must never guess which staged delivery to convert when multiple candidates exist.** Silently picking the wrong one would create an incorrect delivery, which cannot be automatically undone.

---

## Confirmation Requirements

Before calling `convert_confirmed_staged_delivery`, the agent must:

1. Present a complete conversion summary:
   - Customer name and farm name
   - Staged date (which becomes the delivery date)
   - All line items: product / treatment / seed size / package type / units
   - Total units
   - Notes (if any)
   - Explicit statement: "This will create an actual delivery and mark the staged delivery as converted."

2. Ask explicitly: "Confirm? (yes / no)" or equivalent.

3. Wait for the user's response in the next turn.

4. Pass the user's raw response verbatim as `confirmation_text` to the conversion tool. Only proceed if the tool confirms it matches confirmation patterns.

**Approved confirmation phrases** (checked by the tool, not the model): "yes", "confirm", "save it", "looks good", "correct", "go ahead", "do it", "yep", "yup".

**Responses that are NOT confirmation:** "maybe", "ok" (alone), "I think so", "probably", or any ambiguous language. Re-ask if intent is unclear.

**If the user says no or asks to cancel:** Do not convert. Inform the user that the staged delivery remains in-progress. Do not call the conversion tool.

---

## Conversion Rules

The conversion tool must replicate exactly what the manual Staged Deliveries page does via `convertStagedDelivery` in `src/services/staged-delivery.service.ts`:

### Order matching
- Runs `findOrderLineMatches(customer_id, season_year, lines)` server-side (not via browser client).
- Allocation priority: early-pay order lines first, then oldest `order_date`, then `created_at`, then `order_id`.
- Cross-line allocation is tracked in a single pass to prevent the same order item from being allocated to two staged delivery lines.

### Delivery row structure
- `delivery_date` = `staged_deliveries.staged_date` (the date the product was staged, not today)
- `customer_id`, `season_year`, `notes` = from the staged delivery header
- `product_id`, `treatment_id`, `seed_size`, `package_type` = from each staged delivery item
- `units_delivered` = allocated amount (may be split across multiple rows if order matching splits)
- `order_id` / `order_item_id` = from order matching; `null` for any unallocated remainder

### Status update
- `staged_deliveries.status` → `'converted'`
- `staged_deliveries.converted_at` → current timestamp
- This update uses `AND status = 'in_progress'` as a guard to prevent race conditions.

### Inventory effect
When `staged_deliveries.status` changes from `'in_progress'` to `'converted'`:
- The staged units are removed from the `staged` CTE in `v_on_hand_inventory` (it only includes `in_progress` rows).
- The newly created `deliveries` rows are added to the `delivered` CTE.
- Net effect: `units_staged` decreases and `units_delivered` increases by the same amount. `units_on_hand` decreases (physical units have left). `available_units` changes accordingly.

### No partial conversion
The conversion is all-or-nothing: all items in the staged delivery are converted together. The agent cannot convert a subset of lines.

---

## Print-After-Conversion Behavior

After `convert_confirmed_staged_delivery` returns success:

1. The agent **immediately** calls `get_delivery_print_link` with the first delivery ID from `delivery_ids`. This happens without waiting for the user to ask.
2. The route handler extracts the `print_url` from the tool result and stores it in `assistantMetadata.actions` (identical to all other print workflows).
3. The UI renders a **Print Delivery Slip** button below the agent's response.

### Implementation note — multi-row conversions
A single staged delivery can produce multiple delivery rows if order matching splits one item across several order allocations. The delivery print page at `/deliveries/print/[id]` shows one delivery slip per ID. For a conversion that creates 4 delivery rows, passing the first ID will print only one of them.

**This is a known complexity to resolve during implementation.** Options include:
- Passing the first delivery ID and accepting that only one slip prints (simplest; adequate if splits are rare).
- Adding a `staged_delivery_id` FK to the `deliveries` table so a grouped print URL can retrieve all rows from one conversion.
- Creating a new print route that accepts an array of delivery IDs.

Document the chosen approach in the implementation status section before merging.

---

## Audit and Logging Requirements

| Event | `agent_tool_calls` status |
|---|---|
| `get_staged_deliveries` — success | `"success"` |
| `get_staged_deliveries` — DB error | `"error"` |
| `convert_confirmed_staged_delivery` — confirmation guard fired | `"not_confirmed"` |
| `convert_confirmed_staged_delivery` — success | `"success"` |
| `convert_confirmed_staged_delivery` — DB error | `"error"` |
| `get_delivery_print_link` — success | `"success"` |
| `get_delivery_print_link` — not found | `"error"` |

All entries carry: `thread_id`, `user_id`, `tool_name`, `input_json`, `output_json`, `status`, `error_message`.

The `staged_deliveries` table already has `converted_at` and `updated_at` timestamps that record when conversion occurred. The `deliveries` table has `created_at`. No additional audit table is required.

---

## Risks and Cautions

### Confirmation bypass
**Risk:** The model calls `convert_confirmed_staged_delivery` without a genuine user confirmation.
**Mitigation:** The tool independently checks `confirmation_text` against `CONFIRM_PATTERNS` and also checks the raw `userMessage` passed at construction time. If both fail, the tool returns `not_confirmed: true` without writing anything.

### Wrong staged delivery converted
**Risk:** The agent converts a different staged delivery than the user intended, especially when multiple exist for the same customer.
**Mitigation:** When multiple `staged_delivery_id` values are returned for a customer, the agent must present all options and ask the user to choose. It may not silently select one. The conversion summary repeats the date and product details so the user can verify before confirming.

### Duplicate conversion
**Risk:** The model calls the conversion tool twice for the same staged delivery.
**Mitigation:** The tool reads `header.status` before converting. If `status !== 'in_progress'`, it returns `tool_error: true` with a clear message. The `AND status = 'in_progress'` guard on the UPDATE further prevents a race condition.

### Race condition with manual conversion
**Risk:** The user simultaneously converts the same staged delivery from the Staged Deliveries page and from the agent. Both paths call the same service logic.
**Mitigation:** The tool's status check (`status = 'in_progress'`) runs immediately before the insert. The `AND status = 'in_progress'` guard on the UPDATE ensures only one conversion commits. The losing path will find 0 rows updated and return a clear error. Delivery creation could still succeed before the guard fires — the tool explicitly reports this partial state so the user knows to check the Deliveries page.

### Stale staged delivery data in agent context
**Risk:** The user runs `get_staged_deliveries`, the agent presents results, then the user (or another action) cancels or converts the staged delivery outside the agent before the agent calls the conversion tool. The conversion tool then tries to convert a staged delivery that is no longer `in_progress`.
**Mitigation:** The status guard in step 3 of the execute logic catches this. The tool returns a clear error; the agent should tell the user the staged delivery is no longer available and suggest refreshing or running `get_staged_deliveries` again.

### Season year hallucination
**Risk:** The agent invents a season year when calling `get_staged_deliveries`.
**Mitigation:** `get_staged_deliveries` uses the same two-layer season defense as all other tools. The model should only provide `seasonYear` if the user explicitly stated a year. The backend validates via `isYearMentionedByUser()` and falls back to the resolved default season otherwise.

### Order matching over-allocation
**Risk:** Two staged delivery lines claim units from the same order item.
**Mitigation:** The server-safe `findOrderLineMatches` implementation tracks allocated units across all lines in a single pass, matching the same pattern used in `save-confirmed-delivery.ts`. Cross-line over-allocation is impossible within one tool call.

### Partial failure after delivery insert
**Risk:** Delivery rows are created but the status update to `'converted'` fails.
**Mitigation:** The tool reports this partial state explicitly: "Delivery was created but the staged delivery could not be marked as converted — it may have already been converted. Check the Deliveries page." The user is never left uninformed. The Staged Deliveries page will still show the staged delivery as `in_progress` until the status is manually corrected.

### Conversion of a non-existent staged delivery
**Risk:** The model passes a `staged_delivery_id` that doesn't exist or doesn't belong to the user.
**Mitigation:** `userClient` enforces RLS on the `staged_deliveries` table. If the row is not found (wrong ID, wrong user, or deleted), the tool returns `tool_error: true`. The agent must report this to the user and suggest calling `get_staged_deliveries` again.

---

## Relationship to Manual Conversion Behavior

| Aspect | Staged Deliveries page | Agent workflow |
|---|---|---|
| Retrieval | Shows in-progress list visually | `get_staged_deliveries` tool |
| Selection | User clicks a row | Agent identifies from `get_staged_deliveries` result |
| Confirmation | Modal dialog with "Convert" button | Agent summary + user confirmation text |
| Conversion logic | `convertStagedDelivery()` service (browser client) | Server-safe port of same logic (SupabaseClient arg) |
| Order matching | `findOrderLineMatches` | Same function, server-safe variant |
| Delivery rows created | Same per-allocation structure | Identical |
| `staged_deliveries.status` | → `'converted'` | → `'converted'` |
| `converted_at` | Set to `now()` | Set to `now()` |
| Inventory effect | Staged units released; delivered units counted | Identical |
| Print slip | Opens print page via sessionStorage | Print Delivery Slip button from agent response |
| Customer history | Delivery appears in deliveries view | Identical |

Agent-converted staged deliveries appear in the Deliveries page immediately after conversion. They are indistinguishable from manually converted ones — no agent-specific metadata is stored in the `deliveries` table.

---

## Relationship to Staged Delivery Creation

Staged deliveries created through the agent (doc 10) are fully compatible with this conversion workflow:

- They use the same `staged_deliveries` + `staged_delivery_items` table structure.
- They appear in `get_staged_deliveries` results immediately after creation.
- They can be converted here or from the Staged Deliveries page with identical results.
- The print slip after agent creation uses `DeliveryPrintView` (customer-facing delivery slip). The print slip after agent conversion also uses `DeliveryPrintView` via `get_delivery_print_link`. Both are identical in appearance.

---

## File Locations (Planned)

| File | Purpose |
|---|---|
| `src/lib/agent/tools/convert-confirmed-staged-delivery.ts` | Conversion tool factory |
| `src/lib/agent/tools/index.ts` | Add new tool export |
| `src/app/api/agent/chat/route.ts` | Register tool, add SYSTEM_PROMPT section |

No new print page or migration is required — this workflow reuses `get_delivery_print_link` and the existing `/deliveries/print/[id]` page. No new DB columns or views are needed unless the multi-row print decision requires a `staged_delivery_id` FK on `deliveries`.

---

## Implementation Status

- [ ] `convert_confirmed_staged_delivery` — confirmation guard + status guard + server-safe order matching + delivery insert + status update
- [ ] Tool registered in `route.ts` and exported from `tools/index.ts`
- [ ] SYSTEM_PROMPT section added for `convert_confirmed_staged_delivery`
- [ ] Print mechanism decision documented and implemented (single ID vs. grouped)
- [ ] TypeScript clean — `npx tsc --noEmit` passes
