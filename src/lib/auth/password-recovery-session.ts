import type { PasswordRecoveryRouteState } from "@/lib/navigation/app-auth-screen-resolver";
import { normalizePasswordRecoveryUserId } from "@/lib/storage/browser-storage";
import { runSupabasePrincipalIdentityOperation } from "@/lib/supabase/auth-identity-operation";
import type { SupabaseAuthRefreshIdentityScope } from "@/lib/supabase/auth-resilience";

export type PasswordRecoverySessionEvent =
  | "bootstrap"
  | "PASSWORD_RECOVERY"
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "TOKEN_REFRESHED";

export type PasswordRecoverySessionDecision = "none" | "pending" | "confirmed" | "invalid";

export function resolvePasswordRecoverySessionDecision(input: {
  routeState: PasswordRecoveryRouteState;
  event: PasswordRecoverySessionEvent | null;
  sessionLookup: "success" | "error";
  sessionUserId: string | null;
  hasCallbackEvidence: boolean;
  callbackMatchesSession: boolean;
  storedRecoveryStatus: "pending" | "confirmed" | null;
  confirmedRecoveryUserId: string | null;
}): PasswordRecoverySessionDecision {
  const sessionUserId = normalizePasswordRecoveryUserId(input.sessionUserId);
  const confirmedRecoveryUserId = normalizePasswordRecoveryUserId(input.confirmedRecoveryUserId);

  if (input.routeState === "expired") return "invalid";

  if (input.event === "PASSWORD_RECOVERY") {
    return sessionUserId ? "confirmed" : "invalid";
  }

  if (input.routeState !== "active") return "none";

  if (input.event === "bootstrap" && input.sessionLookup === "error") return "pending";

  if (confirmedRecoveryUserId) {
    return sessionUserId && confirmedRecoveryUserId === sessionUserId
      ? "confirmed"
      : "invalid";
  }

  if (input.hasCallbackEvidence) {
    return sessionUserId && input.callbackMatchesSession ? "confirmed" : "pending";
  }

  // A persisted "confirmed" marker deliberately carries no identity. After a reload it cannot
  // authorize a recovery session by itself; only in-memory identity or callback evidence can.
  if (input.storedRecoveryStatus === "confirmed") return "invalid";

  return "pending";
}

export function getPasswordRecoveryClearedHref(href: string): string {
  return new URL(href).pathname;
}

export function hasPasswordRecoveryCallbackError(input: {
  error: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}): boolean {
  return Boolean(input.error || input.errorCode || input.errorDescription);
}

interface RecoverySessionIdentity {
  user: { id: string };
}

interface PasswordRecoveryAuthPort {
  getSession: () => Promise<{
    data: { session: RecoverySessionIdentity | null };
    error: unknown | null;
  }>;
  updateUser: (attributes: { password: string }) => Promise<{ error: unknown | null }>;
  signOut: (
    options: { scope: "local" },
    expectedIdentityScope: SupabaseAuthRefreshIdentityScope,
  ) => Promise<{ error: unknown | null; identityChanged?: boolean }>;
}

export type PasswordRecoveryUpdateResult =
  | { kind: "success" }
  | { kind: "invalid-recovery" }
  | { kind: "stale" }
  | { kind: "update-error"; error: unknown }
  | { kind: "sign-out-error"; error: unknown };

interface PasswordRecoveryUpdateInput {
  password: string;
  confirmedUserId: string | null;
  expectedIdentityScope: SupabaseAuthRefreshIdentityScope | null;
  getCurrentIdentityScope: () => SupabaseAuthRefreshIdentityScope | null;
  auth: PasswordRecoveryAuthPort;
  isRecoveryCurrent: (userId: string) => boolean;
  isOperationCurrent: () => boolean;
  isTerminalOperationCurrent: () => boolean;
  onPasswordUpdated: () => void;
}

export function executePasswordRecoveryUpdate(
  input: PasswordRecoveryUpdateInput,
): Promise<PasswordRecoveryUpdateResult> {
  return runSupabasePrincipalIdentityOperation(() => executeLockedPasswordRecoveryUpdate(input));
}

async function executeLockedPasswordRecoveryUpdate(
  input: PasswordRecoveryUpdateInput,
): Promise<PasswordRecoveryUpdateResult> {
  const confirmedUserId = normalizePasswordRecoveryUserId(input.confirmedUserId);
  if (!input.isOperationCurrent()) return { kind: "stale" };
  if (
    !confirmedUserId
    || normalizePasswordRecoveryUserId(input.expectedIdentityScope?.userId) !== confirmedUserId
    || !isValidIdentityScope(input.expectedIdentityScope)
    || !input.isRecoveryCurrent(confirmedUserId)
  ) {
    return { kind: "invalid-recovery" };
  }
  if (!isSameIdentityScope(input.expectedIdentityScope, input.getCurrentIdentityScope())) {
    return { kind: "stale" };
  }

  const sessionResult = await input.auth.getSession();
  if (
    !input.isOperationCurrent()
    || !isSameIdentityScope(input.expectedIdentityScope, input.getCurrentIdentityScope())
  ) return { kind: "stale" };
  if (sessionResult.error || !sessionResult.data.session) return { kind: "invalid-recovery" };
  if (
    normalizePasswordRecoveryUserId(sessionResult.data.session.user.id) !== confirmedUserId ||
    !input.isRecoveryCurrent(confirmedUserId)
  ) {
    return { kind: "invalid-recovery" };
  }

  const updateResult = await input.auth.updateUser({ password: input.password });
  if (
    !input.isOperationCurrent()
    || !input.isRecoveryCurrent(confirmedUserId)
    || !isSameIdentityScope(input.expectedIdentityScope, input.getCurrentIdentityScope())
  ) {
    return { kind: "stale" };
  }
  if (updateResult.error) return { kind: "update-error", error: updateResult.error };

  input.onPasswordUpdated();
  if (
    !input.isOperationCurrent()
    || !input.isRecoveryCurrent(confirmedUserId)
    || !isSameIdentityScope(input.expectedIdentityScope, input.getCurrentIdentityScope())
  ) {
    return { kind: "stale" };
  }

  const closingSessionResult = await input.auth.getSession();
  if (
    !input.isOperationCurrent()
    || !input.isRecoveryCurrent(confirmedUserId)
    || !isSameIdentityScope(input.expectedIdentityScope, input.getCurrentIdentityScope())
  ) {
    return { kind: "stale" };
  }
  if (
    closingSessionResult.error
    || normalizePasswordRecoveryUserId(closingSessionResult.data.session?.user.id) !== confirmedUserId
  ) {
    return { kind: "stale" };
  }
  if (!isSameIdentityScope(input.expectedIdentityScope, input.getCurrentIdentityScope())) {
    return { kind: "stale" };
  }

  const signOutResult = await input.auth.signOut(
    { scope: "local" },
    input.expectedIdentityScope,
  );
  if (signOutResult.identityChanged) return { kind: "stale" };
  if (!input.isTerminalOperationCurrent()) return { kind: "stale" };
  if (signOutResult.error) return { kind: "sign-out-error", error: signOutResult.error };

  return { kind: "success" };
}

interface PasswordRecoveryLocalSignOutInput {
  expectedIdentityScope: SupabaseAuthRefreshIdentityScope | null;
  getCurrentIdentityScope: () => SupabaseAuthRefreshIdentityScope | null;
  auth: Pick<PasswordRecoveryAuthPort, "getSession" | "signOut">;
}

/**
 * Cierra exclusivamente la sesión de recovery confirmada. La época evita que un callback viejo de
 * A cierre una sesión A2 del mismo usuario después de un refresh o de un nuevo inicio de sesión.
 */
export function signOutPasswordRecoveryIdentityLocally(
  input: PasswordRecoveryLocalSignOutInput,
): Promise<{ error: unknown | null }> {
  return runSupabasePrincipalIdentityOperation(async () => {
    const expectedScope = input.expectedIdentityScope;
    if (!isValidIdentityScope(expectedScope)) {
      return { error: new Error("Recovery identity is unavailable.") };
    }
    if (!isSameIdentityScope(expectedScope, input.getCurrentIdentityScope())) {
      return { error: new Error("Recovery identity changed.") };
    }

    const sessionResult = await input.auth.getSession();
    if (sessionResult.error) return { error: sessionResult.error };
    if (!isSameIdentityScope(expectedScope, input.getCurrentIdentityScope())) {
      return { error: new Error("Recovery identity changed.") };
    }
    if (
      normalizePasswordRecoveryUserId(sessionResult.data.session?.user.id)
      !== normalizePasswordRecoveryUserId(expectedScope.userId)
    ) {
      return { error: new Error("Recovery identity changed.") };
    }
    if (!isSameIdentityScope(expectedScope, input.getCurrentIdentityScope())) {
      return { error: new Error("Recovery identity changed.") };
    }
    const signOutResult = await input.auth.signOut({ scope: "local" }, expectedScope);
    if (signOutResult.identityChanged) {
      return { error: new Error("Recovery identity changed.") };
    }
    return { error: signOutResult.error };
  });
}

function isValidIdentityScope(
  scope: SupabaseAuthRefreshIdentityScope | null,
): scope is SupabaseAuthRefreshIdentityScope {
  return Boolean(
    normalizePasswordRecoveryUserId(scope?.userId)
    && Number.isSafeInteger(scope?.sessionEpoch)
    && (scope?.sessionEpoch ?? 0) > 0,
  );
}

function isSameIdentityScope(
  expected: SupabaseAuthRefreshIdentityScope | null,
  current: SupabaseAuthRefreshIdentityScope | null,
): boolean {
  return isValidIdentityScope(expected)
    && isValidIdentityScope(current)
    && expected.userId.toLowerCase() === current.userId.toLowerCase()
    && expected.sessionEpoch === current.sessionEpoch;
}
