// Model identifiers sourced from environment variables so they can be changed
// without code deploys. Never import these on the client — server-only.
export const AGENT_MAIN_MODEL = process.env.AGENT_MAIN_MODEL ?? "gpt-4o-mini";
export const AGENT_SQL_MODEL = process.env.AGENT_SQL_MODEL ?? "gpt-4o";
