import type { CoachInvitationActionsSnapshot } from "../hooks/coach-invitation-actions-contract";

export type CoachInvitationDetailAction = "resend" | "regenerate" | "reconcile" | "retry";

export function resolveCoachInvitationDetailAction(
  snapshot: CoachInvitationActionsSnapshot,
  capabilities: { readonly canResend: boolean; readonly canRegenerate: boolean },
): CoachInvitationDetailAction | null {
  if (snapshot.pending !== null || snapshot.disposed) return null;
  if (snapshot.attempt?.retryAllowed === true) return "retry";
  if (snapshot.needsRefresh && snapshot.attempt !== null) return "reconcile";
  if (capabilities.canResend) return "resend";
  if (capabilities.canRegenerate) return "regenerate";
  return null;
}

export function hasUnresolvedCoachInvitationAction(snapshot: CoachInvitationActionsSnapshot): boolean {
  return snapshot.attempt !== null
    && snapshot.attempt.phase !== "resolved"
    && snapshot.attempt.phase !== "rejected";
}
