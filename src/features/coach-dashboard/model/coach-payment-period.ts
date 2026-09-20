/** Read facts confirmed manually by the Coach; this model never records a payment. */
export interface CoachPaidPeriod {
  /** Stable persisted identity: editing dates must not mint another period id. */
  readonly id: string;
  readonly linkEpisodeId: string;
  readonly start: string;
  readonly end: string;
}

export interface CoachPaymentLink {
  /** A new accepted relationship must have a new episode id. */
  readonly episodeId: string;
  readonly state: "active" | "pending" | "inactive";
}

export type CoachPaymentStatus =
  | "not-recorded"
  | "current"
  | "expiring"
  | "expires-today"
  | "pending-confirmation";

export type CoachPaymentMilestone = "three-days-before" | "expires-today" | "one-day-after";

/** A due candidate, NOT a delivery receipt or a request to email anyone. */
export interface CoachPaymentDueEvent {
  readonly eventKey: string;
  readonly milestone: CoachPaymentMilestone;
  readonly dueOn: string;
  readonly recipients: readonly ["coach", "student"];
}

export type CoachPaymentPeriodView = {
  readonly dueEvents: readonly CoachPaymentDueEvent[];
} & (
  | { readonly kind: "available"; readonly status: CoachPaymentStatus; readonly daysUntilEnd: number | null }
  | { readonly kind: "not-applicable"; readonly reason: "link-not-active" | "period-not-started" }
  | { readonly kind: "unavailable"; readonly reason: "invalid-today" | "invalid-link" | "invalid-period" | "period-link-mismatch" }
);

const NO_EVENTS: readonly CoachPaymentDueEvent[] = Object.freeze([]);
const RECIPIENTS = Object.freeze(["coach", "student"] as const);

/** Strict Gregorian civil ordinal; no timestamps, timezone conversion or ambient clock. */
function civilDay(value: string): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLength = month === 2 ? (leap ? 29 : 28) : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (day < 1 || day > monthLength) return null;
  const previousYear = year - 1;
  const beforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][month - 1];
  return 365 * previousYear + Math.floor(previousYear / 4) - Math.floor(previousYear / 100)
    + Math.floor(previousYear / 400) + beforeMonth + (leap && month > 2 ? 1 : 0) + day;
}

function validIdentity(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

/**
 * Consumer: the existing Coach renewal detail's stateLabel/stateCaption/endsOnLabel
 * projection. Its integrator must map this independently from training-cycle facts.
 * today is an explicit YYYY-MM-DD civil date in the product's agreed timezone.
 * period is a confirmed read fact, never an unconfirmed renewal editing buffer.
 *
 * recordedEventKeys is supplied by the authoritative event ledger. A dispatcher
 * must atomically deduplicate eventKey and fan out per recipient/channel; this pure
 * projection cannot claim concurrency-safe delivery or persist that ledger.
 */
export function deriveCoachPaymentPeriod(input: {
  readonly link: CoachPaymentLink | null;
  readonly period: CoachPaidPeriod | null;
  readonly today: string;
  readonly recordedEventKeys: ReadonlySet<string>;
}): CoachPaymentPeriodView {
  const { link, period, today } = input;
  if (link === null || link.state !== "active") {
    return Object.freeze({ kind: "not-applicable", reason: "link-not-active", dueEvents: NO_EVENTS });
  }
  if (!validIdentity(link.episodeId)) {
    return Object.freeze({ kind: "unavailable", reason: "invalid-link", dueEvents: NO_EVENTS });
  }
  const currentDay = civilDay(today);
  if (currentDay === null) {
    return Object.freeze({ kind: "unavailable", reason: "invalid-today", dueEvents: NO_EVENTS });
  }
  if (period === null) {
    return Object.freeze({ kind: "available", status: "not-recorded", daysUntilEnd: null, dueEvents: NO_EVENTS });
  }
  if (period.linkEpisodeId !== link.episodeId) {
    return Object.freeze({ kind: "unavailable", reason: "period-link-mismatch", dueEvents: NO_EVENTS });
  }
  const start = civilDay(period.start);
  const end = civilDay(period.end);
  if (!validIdentity(period.id) || start === null || end === null || end <= start) {
    return Object.freeze({ kind: "unavailable", reason: "invalid-period", dueEvents: NO_EVENTS });
  }
  // A future paid period is not current yet. Do not invent a visible business state.
  if (currentDay < start) {
    return Object.freeze({ kind: "not-applicable", reason: "period-not-started", dueEvents: NO_EVENTS });
  }
  const daysUntilEnd = end - currentDay;
  const status: CoachPaymentStatus = daysUntilEnd < 0 ? "pending-confirmation"
    : daysUntilEnd === 0 ? "expires-today" : daysUntilEnd <= 3 ? "expiring" : "current";
  const milestone: CoachPaymentMilestone | null = daysUntilEnd === 3 ? "three-days-before"
    : daysUntilEnd === 0 ? "expires-today" : daysUntilEnd === -1 ? "one-day-after" : null;
  let dueEvents = NO_EVENTS;
  if (milestone !== null) {
    // Tuple encoding prevents delimiter collisions. Dates/version/today are deliberately
    // absent: revisiting or correcting the same logical period cannot create a new event.
    const eventKey = JSON.stringify(["coach-payment-period", link.episodeId, period.id, milestone]);
    if (!input.recordedEventKeys.has(eventKey)) {
      dueEvents = Object.freeze([Object.freeze({ eventKey, milestone, dueOn: today, recipients: RECIPIENTS })]);
    }
  }
  return Object.freeze({ kind: "available", status, daysUntilEnd, dueEvents });
}
