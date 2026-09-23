import type { CoachLinkActiveState } from "@/features/coach-linking/model/coach-linking";
import type { Screen } from "@/lib/navigation/app-navigation";

export interface EvaluationOpenRequest {
  readonly ownerUserId: string;
  readonly assignmentId: string | null;
  readonly sequence: number;
}

export function canAccessStudentEvaluations(input: {
  readonly expectedUserId: string | null;
  readonly activeCoachLinkState: CoachLinkActiveState;
  readonly activeCoachLinkIdentityKey: string | null;
  readonly isCoachPortal: boolean;
}): boolean {
  return input.expectedUserId !== null
    && !input.isCoachPortal
    && input.activeCoachLinkState === "linked"
    && input.activeCoachLinkIdentityKey === input.expectedUserId;
}

export function resolveStudentEvaluationScreenTarget(
  requestedScreen: Screen,
  hasAccess: boolean,
): Screen {
  return requestedScreen === "evaluaciones" && !hasAccess ? "dashboard" : requestedScreen;
}

export function resolveStudentEvaluationNotificationTarget(
  hasAccess: boolean,
): "evaluaciones" | "dashboard" {
  return hasAccess ? "evaluaciones" : "dashboard";
}

export function createEvaluationOpenRequest(
  current: EvaluationOpenRequest | null,
  ownerUserId: string,
  assignmentId: string | null,
): EvaluationOpenRequest {
  return {
    ownerUserId,
    assignmentId,
    sequence: current?.ownerUserId === ownerUserId ? current.sequence + 1 : 1,
  };
}
