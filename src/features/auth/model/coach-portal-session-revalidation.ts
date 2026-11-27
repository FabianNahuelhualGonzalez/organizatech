import type { AuthAccountType } from "./auth-route";

export function canRetainAuthorizedCoachSession(input: {
  event: string;
  requestedPortal: AuthAccountType;
  authorizedUserId: string | null | undefined;
  sessionUserId: string | null | undefined;
  authenticatedUserId: string | null | undefined;
  interactiveAttempt: boolean;
  logoutInFlight: boolean;
  passwordRecoveryBlocked: boolean;
}) {
  return input.requestedPortal === "coach"
    && (input.event === "SIGNED_IN" || input.event === "INITIAL_SESSION" || input.event === "TOKEN_REFRESHED")
    && !input.interactiveAttempt && !input.logoutInFlight && !input.passwordRecoveryBlocked
    && Boolean(input.authorizedUserId)
    && input.authorizedUserId === input.sessionUserId
    && input.authorizedUserId === input.authenticatedUserId;
}
