# Agent — Inventory Tool Reference

Documents the `get_on_hand_inventory` tool and how the agent surfaces inventory data including staged deliveries.

---

## Inventory Concepts

Inventory quantities returned by the tool:

| Field | Definition | Use case |
|---|---|---|
| `replanted_units` | Seed handed to customers to re-plant failed fields — already subtracted from physical | Explaining how physical was derived |
| `physical_units_on_hand` | `received − delivered − replanted + returned` — warehouse stock | Physical stock questions only |
| `staged_units` | Sum of in_progress staged delivery items | Staged/reserved questions |
| `available_units` | `physical_units_on_hand − staged_units` | **Primary answer to "how many do I have?"** |

**Available units** is the answer to "how many do I have?" / "how many can I sell?" / "how many are left?". Never report `physical_units_on_hand` for these questions.

**Replanted vs staged — do not confuse them.** Replanted seed has *physically left the warehouse* (handed to the customer to re-plant a failed field), so it reduces `physical_units_on_hand`. Staged seed is *still in the warehouse* but reserved for a customer, so it reduces `available_units` only. Both lower availability, but for different reasons.

---

## Tool: `get_on_hand_inventory`

**Source view:** `v_on_hand_inventory`

**Input filters:**

| Parameter | Type | Description |
|---|---|---|
| `productName` | string? | Partial product name (case-insensitive) |
| `treatmentName` | string? | Partial treatment name |
| `packageType` | string? | `'Bag'` or `'Seedpak'` |
| `seedSize` | string? | Exact seed size (e.g. `'AF'`) |
| `minAvailableUnits` | number? | Minimum available units to include |

**Output fields:**

| Field | Description |
|---|---|
| `rows` | Per-combination detail rows (product/treatment/size/pkg) |
| `rows[].replanted_units` | Seed handed to customers to re-plant failed fields (already subtracted from physical) |
| `rows[].physical_units_on_hand` | Warehouse stock (received − delivered − replanted + returned) |
| `rows[].staged_units` | Reserved in in_progress staged deliveries |
| `rows[].available_units` | What can still be committed (physical − staged) |
| `total_replanted_units` | Sum of replanted units |
| `total_physical_units_on_hand` | Sum of physical warehouse stock |
| `total_staged_units` | Sum of staged/reserved units |
| `total_available_units` | Sum of available units — **primary answer to "how many do I have?"** |
| `has_staged_inventory` | true if any staged_units > 0 |
| `has_negative_physical_inventory` | true if any physical_units_on_hand < 0 |
| `has_negative_available_inventory` | true if any available_units < 0 |
| `negative_available_rows` | Rows with available_units < 0 |

**View column → output field mapping:**

| DB view column (`v_on_hand_inventory`) | Tool output field |
|---|---|
| `units_replanted` | `replanted_units` |
| `units_on_hand` | `physical_units_on_hand` |
| `units_staged` | `staged_units` |
| `available_units` | `available_units` |

---

## Response patterns

### Standard inventory question
> "How many units do I have for 103-93?"

Lead with `total_available_units`. If staged, explain the breakdown:
> "You have 25 available units of DKC 103-93. There are 100 physical units on hand, but 75 are currently staged for delivery."

If not staged:
> "You have 100 available units of DKC 103-93. No units are currently staged."

### Full calculation (include replants)
> "How many units of 100-01 Fungicide AF2 do I have available?"

When showing the math, include every component so the user can audit it:
> "DKC 100-01 / FUNGICIDE / AF2 / Bag has 950 available units: 2,100 received − 1,125 delivered − 100 replanted + 100 returned − 125 staged."

### Why is available lower than physical?
> "Why is my available inventory lower than physical on hand?"

Available is physical minus **staged** — product set aside for a customer but not yet delivered. Explain staged units; do NOT attribute the gap to replants (replants already reduced *physical*, not available):
> "Your available is lower because 125 units are staged for delivery — they're still in the warehouse but reserved, so they're subtracted from available. (Replanted units, by contrast, already left the warehouse and were subtracted from physical on hand.)"

### Physical-only question
> "How much physical inventory do I have for 103-93?"

Use `total_physical_units_on_hand` / `physical_units_on_hand`.

### Staged-only question
> "How many units are staged?"

Use `total_staged_units` / `staged_units`.

### Negative available (staged exceeds physical)
> has_negative_available_inventory = true

Warn: "Warning: [product/treatment/size/pkg] has [N] available units — more has been staged or delivered than is physically on hand."

Do NOT say "no inventory" or "zero units" — explain the situation.

### Negative physical (deliveries exceeded shipments)
> has_negative_physical_inventory = true

Warn separately: "The system shows negative physical inventory for [product] — deliveries or adjustments have exceeded recorded received units."

---

## Staged Delivery Questions — use `get_staged_deliveries` tool

For questions about specific staged deliveries ("what staged deliveries do I have for Scott?", "which customers have staged deliveries?", "how many units are staged for DKC 103-93?"), use the dedicated `get_staged_deliveries` tool rather than the SQL fallback. It handles three-step customer name matching and returns structured output.

## SQL Fallback — staged delivery queries

`v_agent_staged_deliveries` is an approved view for `run_approved_readonly_query`. Use it when:
- User asks which products are unavailable because they are fully staged (cross-view join with inventory)
- User asks cross-domain aggregate questions involving staged deliveries

The `v_agent_inventory` view exposes the DB columns directly: `units_received`, `units_delivered`, `units_replanted`, `units_returned`, `units_on_hand`, `units_staged`, `available_units`. `units_on_hand = received − delivered − replanted + returned`.

Example queries:
```sql
-- Products with no available units due to staging
SELECT product_name, treatment_name, seed_size, package_type,
       units_on_hand, units_staged, available_units
FROM v_agent_inventory
WHERE units_staged > 0 AND available_units <= 0
LIMIT 50;

-- Products with the most replanted units
SELECT product_name, treatment_name, seed_size, package_type, units_replanted
FROM v_agent_inventory
WHERE units_replanted > 0
ORDER BY units_replanted DESC
LIMIT 20;

-- All staged items for a customer
SELECT customer_name, product_name, treatment_name, seed_size,
       package_type, units_staged, staged_date
FROM v_agent_staged_deliveries
WHERE customer_name ILIKE '%smith%'
LIMIT 50;
```

---

## Approved SQL fallback views (complete list)

| View | Purpose |
|---|---|
| `v_agent_customer_orders` | Order line items with pricing/profit |
| `v_agent_order_fulfillment` | Delivery fulfillment status |
| `v_agent_inventory` | On-hand + staged + available inventory |
| `v_agent_customer_deliveries` | Delivery history |
| `v_agent_customer_returns` | Return history |
| `v_agent_customer_replants` | Replant history |
| `v_agent_bayer_shipments` | Bayer shipment detail |
| `v_agent_staged_deliveries` | In-progress staged deliveries |

All views are user-scoped (filtered by `auth.uid()`). The SQL fallback runs as the authenticated user.
