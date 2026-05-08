# Agent — Inventory Tool Reference

Documents the `get_on_hand_inventory` tool and how the agent surfaces inventory data including staged deliveries.

---

## Inventory Concepts

Inventory has three distinct quantities, all returned by the tool:

| Field | Definition | Use case |
|---|---|---|
| `units_on_hand` | `received − delivered + returned` | Physical stock question |
| `units_staged` | Sum of in_progress staged delivery items | Staged/reserved question |
| `available_units` | `units_on_hand − units_staged` | **Primary operational question** |

**Available units** is the answer to "how many can we still commit to another customer?" and is the headline quantity in agent responses.

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
| `rows[].units_on_hand` | Physical on hand |
| `rows[].units_staged` | Staged/reserved |
| `rows[].available_units` | Available (operational) |
| `total_units_on_hand` | Sum of physical on hand |
| `total_units_staged` | Sum of staged units |
| `total_available_units` | Sum of available units |
| `has_staged_inventory` | true if any units are staged |
| `has_negative_inventory` | true if any units_on_hand < 0 |
| `has_negative_available` | true if any available_units < 0 |
| `negative_rows` | Rows with units_on_hand < 0 |
| `negative_available_rows` | Rows with available_units < 0 |

---

## Response patterns

### Standard inventory question
> "How many units do I have for 099-59?"

Lead with `total_available_units`. If staged, explain the breakdown:
> "You have 80 available units. There are 100 physical units on hand, with 20 currently staged for customers."

### Physical-only question
> "How much physical inventory do I have for 099-59?"

Use `total_units_on_hand` / `units_on_hand`.

### Staged-only question
> "How many units are staged?"

Use `total_units_staged` / `units_staged`.

### Negative available (staged exceeds physical)
> has_negative_available = true

Warn: "Warning: [product] has [N] available units — more has been staged or delivered than is physically on hand."

Do NOT say "no inventory" or "zero units" — explain the situation.

### Negative physical (deliveries exceeded shipments)
> has_negative_inventory = true

Warn separately: "The system shows negative physical inventory for [product] — deliveries or adjustments have exceeded recorded received units."

---

## SQL Fallback — staged delivery queries

`v_agent_staged_deliveries` is an approved view for `run_approved_readonly_query`. Use it when:
- User asks what is staged for a specific customer
- User asks which products are unavailable because they are fully staged

Example queries:
```sql
-- Products with no available units due to staging
SELECT product_name, treatment_name, seed_size, package_type,
       units_on_hand, units_staged, available_units
FROM v_agent_inventory
WHERE units_staged > 0 AND available_units <= 0
LIMIT 50;

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
