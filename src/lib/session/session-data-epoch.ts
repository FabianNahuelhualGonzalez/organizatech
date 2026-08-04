export interface SessionDataIdentity {
  userId: string | null;
  scope: string | null;
}

export interface SessionDataEpoch extends SessionDataIdentity {
  generation: number;
}

export type SessionDataRequestToken = Readonly<SessionDataEpoch>;
export type AuthenticatedRefreshResultKind = "success" | "stale" | "error";

interface AdvanceSessionDataEpochOptions {
  force?: boolean;
}

/**
 * Identifies which user and data scope may receive an async response. Clearing
 * React state on SIGNED_OUT is insufficient because an already-started promise
 * can still resolve afterward, so every user-scoped load must capture and
 * validate this identity after its awaits and before writing state.
 *
 * This is a client-side stale-response guard; it does not replace RLS,
 * ownership checks, operation-specific mutation locks, or latest-request-wins
 * behavior within the same session generation.
 */
export function createSessionDataEpoch(
  identity: SessionDataIdentity = { userId: null, scope: null },
): SessionDataEpoch {
  return {
    generation: 0,
    userId: identity.userId,
    scope: identity.scope,
  };
}

/**
 * Advances only when the effective identity changes, unless an explicit
 * reinitialization requests a forced generation. Multiple requests within the
 * same generation remain valid; this is not a latest-request-wins mechanism.
 */
export function advanceSessionDataEpoch(
  current: SessionDataEpoch,
  identity: SessionDataIdentity,
  options: AdvanceSessionDataEpochOptions = {},
): SessionDataEpoch {
  const identityChanged = current.userId !== identity.userId || current.scope !== identity.scope;
  if (!options.force && !identityChanged) return current;

  return {
    generation: current.generation + 1,
    userId: identity.userId,
    scope: identity.scope,
  };
}

export function captureSessionDataRequestToken(current: SessionDataEpoch): SessionDataRequestToken {
  return Object.freeze({
    generation: current.generation,
    userId: current.userId,
    scope: current.scope,
  });
}

export function isSessionDataRequestTokenCurrent(
  current: SessionDataEpoch,
  token: SessionDataRequestToken,
): boolean {
  return current.generation === token.generation &&
    current.userId === token.userId &&
    current.scope === token.scope;
}

/**
 * An authenticated refresh error means the session was established but its
 * initial data could not be loaded. Only a stale result belongs to an invalid
 * epoch and must stop navigation/publication for the captured identity.
 */
export function shouldContinueAuthenticatedFlowAfterRefresh(
  kind: AuthenticatedRefreshResultKind,
): boolean {
  return kind !== "stale";
}

/**
 * Exposes an authenticated identity only when it belongs to the effective
 * session. A signup response may include a User while email confirmation is
 * still pending; that User is not an authenticated application identity.
 */
export function resolveEffectiveAuthenticatedUser<TUser extends { id: string }>(
  session: { user: TUser } | null,
  candidateUser: TUser | null,
): TUser | null {
  if (!session || !candidateUser || session.user.id !== candidateUser.id) return null;
  return session.user;
}
