// Approved views the agent SQL fallback may query
const APPROVED_VIEWS = new Set([
  "v_agent_customer_orders",
  "v_agent_order_fulfillment",
  "v_agent_inventory",
  "v_agent_customer_deliveries",
  "v_agent_customer_returns",
  "v_agent_customer_replants",
  "v_agent_bayer_shipments",
  "v_agent_staged_deliveries",
]);

// Keywords forbidden anywhere in the query (checked against non-literal content)
const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "EXECUTE",
  "DO",
  "SECURITY",
  "DEFINER",
  "PG_SLEEP",
  "PG_CANCEL_BACKEND",
  "PG_TERMINATE_BACKEND",
  "DBLINK",
  "PG_READ_FILE",
  "PG_WRITE_FILE",
  "PREPARE",
  "DEALLOCATE",
  "VACUUM",
  "ANALYZE",
  "CLUSTER",
  "REINDEX",
  "COMMIT",
  "ROLLBACK",
  "BEGIN",
  "SAVEPOINT",
  "LOCK",
  "EXPLAIN",
  "CALL",
];

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// Strip single-quoted string literals before keyword/table scanning so
// values like customer_name = 'Smith Farms' don't trigger false positives
// on words that happen to appear inside string values.
function stripStringLiterals(sql: string): string {
  // Handles standard SQL single-quoted strings including escaped quotes ('it''s ok')
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

// Extract CTE names from a SQL string so they can be treated as valid
// FROM/JOIN targets (e.g. WITH monthly AS (...) SELECT * FROM monthly LIMIT 10)
function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  // First CTE: WITH name AS ( or WITH RECURSIVE name AS (
  const firstRe = /\bwith\s+(?:recursive\s+)?(\w+)\s+as\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = firstRe.exec(sql)) !== null) {
    names.add(m[1].toLowerCase());
  }
  // Subsequent CTEs separated by commas: ), next_name AS (
  const contRe = /\)\s*,\s*(\w+)\s+as\s*\(/gi;
  while ((m = contRe.exec(sql)) !== null) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

export function validateApprovedQuery(sql: string): ValidationResult {
  const trimmed = sql.trim();

  // Must start with SELECT or WITH (CTEs)
  const upper = trimmed.toUpperCase();
  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    return { valid: false, reason: "Query must begin with SELECT or WITH" };
  }

  // Strip string literals before remaining checks to avoid false positives
  const stripped = stripStringLiterals(trimmed);

  // Check forbidden keywords against stripped SQL
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(stripped)) {
      return { valid: false, reason: `Forbidden keyword: ${kw}` };
    }
  }

  // Collect CTE names — they are valid FROM/JOIN targets
  const cteNames = extractCteNames(stripped);

  // Every FROM or JOIN target must be an approved view or a CTE name
  const fromJoinRe = /\b(?:from|join)\s+(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = fromJoinRe.exec(stripped)) !== null) {
    const name = m[1].toLowerCase();
    if (!APPROVED_VIEWS.has(name) && !cteNames.has(name)) {
      return {
        valid: false,
        reason: `Unauthorized table/view: "${name}". Only approved agent views are allowed.`,
      };
    }
  }

  // Require a LIMIT clause
  if (!/\blimit\b/i.test(stripped)) {
    return { valid: false, reason: "Query must include a LIMIT clause (maximum 100 rows)" };
  }

  // LIMIT value must not exceed 100
  const limitMatch = /\blimit\s+(\d+)/i.exec(stripped);
  if (limitMatch) {
    const val = parseInt(limitMatch[1], 10);
    if (val > 100) {
      return { valid: false, reason: `LIMIT ${val} exceeds the maximum of 100` };
    }
  }

  return { valid: true };
}
