export type DateSource = "explicit" | "today_default";

export interface DateResolution {
  resolved_date: string;
  date_source: DateSource;
  user_explicitly_requested_date: boolean;
}

// Patterns that indicate the user actually mentioned a date in their message.
// Mirrors the approach in resolve-season.ts (isYearMentionedByUser) but for dates.
const DATE_MENTION_PATTERNS: RegExp[] = [
  /\btoday\b/i,
  /\byesterday\b/i,
  /\btomorrow\b/i,
  // ISO format: 2026-05-11
  /\b\d{4}-\d{2}-\d{2}\b/,
  // Numeric slash date: 5/11 or 5/11/26 or 5/11/2026
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  // "May 11" / "November 3"
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i,
  // "May. 11" / abbreviated month
  /\b(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s+\d{1,2}\b/i,
  // "11th of May" / "3rd November"
  /\b\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  // "last Monday", "this Friday", "next Wednesday"
  /\b(?:last|this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  // "on Monday", "on Thursday"
  /\bon\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
];

/**
 * Returns true if the user's raw message text contains any recognisable date reference.
 * Used to reject model-hallucinated deliveryDate values: the model sometimes injects
 * a date from its training data (e.g. 2023-10-06) when the user never mentioned a date.
 */
export function isDateMentionedByUser(userMessage: string): boolean {
  return DATE_MENTION_PATTERNS.some((p) => p.test(userMessage));
}

export function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

export function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Resolves the agent delivery date with a two-layer defense against hallucination:
 *
 *   Layer 1 — user message check: if the user's message contains no date reference,
 *             always use server today regardless of what requestedDate the model passed.
 *
 *   Layer 2 — relative word handling: if the user did mention a date, interpret the
 *             model's requestedDate value using real server time ("today" → server today,
 *             "yesterday" → server yesterday). Fall back to server today if the model
 *             passed an unparseable value.
 */
export function resolveAgentDate(
  userMessage: string,
  requestedDate?: string
): DateResolution {
  if (!isDateMentionedByUser(userMessage)) {
    return {
      resolved_date: todayISO(),
      date_source: "today_default",
      user_explicitly_requested_date: false,
    };
  }

  const raw = (requestedDate ?? "").trim().toLowerCase();

  if (raw === "today" || raw === "now") {
    return {
      resolved_date: todayISO(),
      date_source: "explicit",
      user_explicitly_requested_date: true,
    };
  }

  if (raw === "yesterday") {
    return {
      resolved_date: yesterdayISO(),
      date_source: "explicit",
      user_explicitly_requested_date: true,
    };
  }

  if (raw === "tomorrow") {
    return {
      resolved_date: tomorrowISO(),
      date_source: "explicit",
      user_explicitly_requested_date: true,
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "")) {
    return {
      resolved_date: requestedDate!,
      date_source: "explicit",
      user_explicitly_requested_date: true,
    };
  }

  // User mentioned a date but the model's value is unparseable — safe fallback.
  return {
    resolved_date: todayISO(),
    date_source: "today_default",
    user_explicitly_requested_date: true,
  };
}
