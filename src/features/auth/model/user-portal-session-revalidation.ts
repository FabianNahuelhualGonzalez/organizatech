import type { AuthAccountType } from "@/features/auth/model/auth-route";
import {
  hasCurrentUserPortalAuthorization,
  type UserPortalAuthorizationProof,
} from "@/features/auth/model/user-portal-authorization-proof";

export type UserPortalSessionRevalidation =
  | {
      readonly kind: "silent_revalidation";
      readonly authorizationProof: UserPortalAuthorizationProof;
    }
  | {
      readonly kind: "fail_closed";
      readonly authorizationProof: null;
    };

export const FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION: UserPortalSessionRevalidation =
  Object.freeze({
    kind: "fail_closed",
    authorizationProof: null,
  });

export function resolveUserPortalSessionRevalidation(input: {
  readonly event: string;
  readonly authorizationProof: UserPortalAuthorizationProof | null;
  readonly nextSessionUserId: string | null | undefined;
  readonly nextAuthenticatedUserId: string | null | undefined;
  readonly requestedPortal: AuthAccountType;
  readonly isInteractiveAuthAttempt: boolean;
  readonly isPasswordRecoveryBlocked: boolean;
  readonly isLogoutInFlight: boolean;
  readonly hasCoachPortalSession: boolean;
}): UserPortalSessionRevalidation {
  const isRedundantSessionEvent =
    input.event === "SIGNED_IN"
    || input.event === "INITIAL_SESSION"
    || input.event === "TOKEN_REFRESHED";
  const proof = input.authorizationProof;

  if (
    !isRedundantSessionEvent
    || input.requestedPortal !== "usuario"
    || input.isInteractiveAuthAttempt
    || input.isPasswordRecoveryBlocked
    || input.isLogoutInFlight
    || input.hasCoachPortalSession
    || !proof
    || !hasCurrentUserPortalAuthorization({
      authorizationProof: proof,
      sessionUserId: input.nextSessionUserId,
      authenticatedUserId: input.nextAuthenticatedUserId,
    })
  ) return FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION;

  return Object.freeze({
    kind: "silent_revalidation",
    authorizationProof: proof,
  });
}
