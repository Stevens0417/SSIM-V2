# Tools Architecture

## Purpose
Tools are the ONLY way the agent accesses user data.

They:
- encapsulate business logic
- enforce user scoping
- simplify complex queries

---

## Rules

1. Tools must:
   - use approved views
   - filter by `user_id`
   - return structured JSON

2. Tools must NOT:
   - expose raw database tables directly
   - allow unrestricted queries
   - bypass RLS/security

---

## Tool Structure

Each tool includes:
- name
- description
- input schema
- backend function
- output format

---

## Example Tool

### get_on_hand_inventory

Description:
Returns on-hand inventory for the current user.

Input:
- product_name (optional)

Output:
- product_name
- treatment_name
- seed_size
- package_type
- units_on_hand

---

## Tool Execution Flow

1. Agent selects tool
2. Backend validates input
3. Backend runs query (view-based)
4. Result returned as JSON
5. Tool call logged
6. Agent explains result

---

## Design Principle

Tools handle:
- common questions
- repetitive queries
- business logic

The agent focuses on:
- understanding the question
- selecting the correct tool
- explaining results