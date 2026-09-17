import type { CoachInvitationCreationSnapshot } from "../hooks/coach-invitation-creation-contract";

export type CoachInvitationCreationAction = "submit" | "reconcile" | "retry";

/**
 * Selects one explicit operation without dropping the retained intent. A retry
 * unlocked by a null reconciliation must win over needsRefresh, which remains
 * true until the same immutable command is resolved.
 */
export function resolveCoachInvitationCreationAction(
  snapshot: CoachInvitationCreationSnapshot,
  canSubmit: boolean,
): CoachInvitationCreationAction | null {
  if (snapshot.pending !== null || snapshot.disposed || !snapshot.isOpen) return null;
  if (snapshot.attempt?.retryAllowed === true) return "retry";
  if (snapshot.needsRefresh && snapshot.attempt !== null) return "reconcile";
  return canSubmit ? "submit" : null;
}
