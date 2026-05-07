# Logging and Traceability

## Purpose

Every data-related action must be traceable.

---

## What is logged

### Messages
- all user + assistant messages

### Tool Calls
- tool name
- inputs
- outputs
- success/failure

---

## Why this matters

- debugging incorrect answers
- auditing system behavior
- improving tools
- understanding usage patterns

---

## Principle

If the agent used data, we must be able to answer:
- what data
- how it was retrieved
- why that answer was given