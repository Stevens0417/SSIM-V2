# Guardrails (Phase 1)

## Allowed

- Tool-based data access
- Read-only operations
- User-scoped queries

---

## Not Allowed

- Raw SQL execution
- Direct table access from agent
- Cross-user queries
- Data modification

---

## Enforcement

All enforcement happens in the backend, not the agent.

The agent instructions alone are NOT sufficient for security.

---

## Future (Phase 3+)

Later phases may introduce:
- SQL proposal + approval system
- Query validation layer
- restricted execution engine