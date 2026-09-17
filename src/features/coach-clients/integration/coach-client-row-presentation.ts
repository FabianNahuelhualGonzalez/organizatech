import type { CoachClient } from "../model/coach-client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSessionCount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function getAuthorizedNameInitials(name: string | null): string | null {
  if (name === null) return null;
  // Approved handoff: first character of up to two words, preserving case.
  // Unicode iteration avoids splitting a surrogate pair; whitespace is not a word.
  return name.split(/\s+/u).slice(0, 2).map((word) => [...word][0]).join("");
}

/**
 * Projects one already-authorized read model, not an authorization decision.
 * The caller supplies a label appropriate for the row's consent state, or null.
 * Invalid consumed fields return null; unknown counts remain unknown, not zero.
 * Fields outside the per-state allowlist are ignored, never spread or returned.
 */
export function projectCoachClientRow(client: CoachClient, metaLabel: string | null) {
  if (!isRecord(client) || !isNullableString(metaLabel)) return null;

  const { id, email, state } = client;
  if (!isNonBlankString(id) || !isNonBlankString(email)) return null;

  if (state === "pending") {
    // Do not even read account identity, invitation code or activity on pending.
    return Object.freeze({ id, email, state, metaLabel });
  }
  if (state !== "active" && state !== "inactive") return null;

  const displayName = client.displayName;
  if (!isNullableString(displayName)) return null;
  const name = displayName?.trim() || null;
  const initials = getAuthorizedNameInitials(name);

  if (state === "inactive") {
    // Historical identity only. Do not read a cycle/activity accidentally attached.
    return Object.freeze({ id, email, state, metaLabel, name, initials });
  }

  const cycle = client.cycle;
  let progressRatio: number | null = null;
  if (cycle !== null) {
    if (!isRecord(cycle) || !isNonBlankString(cycle.id) || !isNullableString(cycle.description)) return null;
    const { completedSessions, plannedSessions } = cycle;
    if (!isSessionCount(completedSessions) || !isSessionCount(plannedSessions)) return null;
    if (completedSessions !== null && plannedSessions !== null && plannedSessions > 0) {
      // Geometry only: extra sessions may exceed the target in the domain metric.
      progressRatio = Math.min(1, Math.max(0, completedSessions / plannedSessions));
    }
  }

  return Object.freeze({ id, email, state, metaLabel, name, initials, progressRatio });
}

/** Inferred from concrete allowlists; no second copy of the UI contract. */
export type CoachClientRowPresentation = NonNullable<ReturnType<typeof projectCoachClientRow>>;
