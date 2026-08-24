import type { AuthorizedPortalAccess } from "@/features/auth/model/multiportal-auth-controller";

const USER_PORTAL_AUTHORIZATION_PROOF_BRAND: unique symbol = Symbol(
  "user-portal-authorization-proof",
);

/**
 * Capacidad efímera emitida exclusivamente después de una resolución autoritativa de membresía
 * Usuario. La marca privada impide que presencia de sesión, metadata o estado visual fabriquen la
 * prueba por accidente. No se persiste ni se deriva desde el objeto User de Supabase.
 */
export interface UserPortalAuthorizationProof {
  readonly state: "user_authorized";
  readonly userId: string;
  readonly [USER_PORTAL_AUTHORIZATION_PROOF_BRAND]: true;
}

export function createUserPortalAuthorizationProof(input: {
  readonly access: AuthorizedPortalAccess;
  readonly sessionUserId: string | null | undefined;
  readonly authenticatedUserId: string | null | undefined;
}): UserPortalAuthorizationProof | null {
  if (
    input.access.state !== "user_authorized"
    || input.access.userId.length === 0
    || input.access.userId !== input.sessionUserId
    || input.access.userId !== input.authenticatedUserId
  ) return null;

  return {
    state: input.access.state,
    userId: input.access.userId,
    [USER_PORTAL_AUTHORIZATION_PROOF_BRAND]: true,
  };
}

export function shouldMountAuthorizedUserPortal(input: {
  readonly authorizationProof: UserPortalAuthorizationProof | null;
  readonly sessionUserId: string | null | undefined;
  readonly authenticatedUserId: string | null | undefined;
  readonly hasCoachPortalSession: boolean;
  readonly isAuthLoading: boolean;
  readonly isPasswordRecoveryBlocked: boolean;
  readonly isRenderableScreen: boolean;
}): boolean {
  return hasCurrentUserPortalAuthorization(input)
    && !input.hasCoachPortalSession
    && !input.isAuthLoading
    && !input.isPasswordRecoveryBlocked
    && input.isRenderableScreen;
}

export function hasCurrentUserPortalAuthorization(input: {
  readonly authorizationProof: UserPortalAuthorizationProof | null;
  readonly sessionUserId: string | null | undefined;
  readonly authenticatedUserId: string | null | undefined;
}): boolean {
  const proof = input.authorizationProof;
  return Boolean(
    proof
    && proof[USER_PORTAL_AUTHORIZATION_PROOF_BRAND] === true
    && proof.state === "user_authorized"
    && proof.userId === input.sessionUserId
    && proof.userId === input.authenticatedUserId
  );
}
