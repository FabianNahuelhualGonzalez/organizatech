import type { PasswordRecoveryRouteState } from "@/lib/navigation/app-auth-screen-resolver";
import { normalizePasswordRecoveryUserId } from "@/lib/storage/browser-storage";

export type PasswordRecoverySessionEvent =
  | "bootstrap"
  | "PASSWORD_RECOVERY"
  | "INITIAL_SESSION"
  | "SIGNED_IN";

export type PasswordRecoverySessionDecision = "none" | "pending" | "confirmed" | "invalid";

export function resolvePasswordRecoverySessionDecision(input: {
  routeState: PasswordRecoveryRouteState;
  event: PasswordRecoverySessionEvent | null;
  sessionLookup: "success" | "error";
  sessionUserId: string | null;
  hasCallbackEvidence: boolean;
  callbackMatchesSession: boolean;
  storedRecoveryStatus: "pending" | "confirmed" | null;
  storedRecoveryUserId: string | null;
}): PasswordRecoverySessionDecision {
  const sessionUserId = normalizePasswordRecoveryUserId(input.sessionUserId);
  const storedRecoveryUserId = normalizePasswordRecoveryUserId(input.storedRecoveryUserId);

  if (input.routeState === "expired") return "invalid";

  if (input.event === "PASSWORD_RECOVERY") {
    return sessionUserId ? "confirmed" : "invalid";
  }

  if (input.routeState !== "active") return "none";

  if (input.event === "bootstrap" && input.sessionLookup === "error") return "pending";

  if (input.storedRecoveryStatus === "confirmed") {
    return sessionUserId && storedRecoveryUserId === sessionUserId
      ? "confirmed"
      : "invalid";
  }

  if (input.hasCallbackEvidence) {
    return sessionUserId && input.callbackMatchesSession ? "confirmed" : "invalid";
  }

  if (input.event === "bootstrap" || input.event === "INITIAL_SESSION" || input.event === "SIGNED_IN") {
    return "invalid";
  }

  return "pending";
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
  signOut: () => Promise<{ error: unknown | null }>;
}

export type PasswordRecoveryUpdateResult =
  | { kind: "success" }
  | { kind: "invalid-recovery" }
  | { kind: "stale" }
  | { kind: "update-error"; error: unknown }
  | { kind: "sign-out-error"; error: unknown };

export async function executePasswordRecoveryUpdate(input: {
  password: string;
  confirmedUserId: string | null;
  auth: PasswordRecoveryAuthPort;
  isRecoveryCurrent: (userId: string) => boolean;
  isOperationCurrent: () => boolean;
  isTerminalOperationCurrent: () => boolean;
  onPasswordUpdated: () => void;
}): Promise<PasswordRecoveryUpdateResult> {
  const confirmedUserId = normalizePasswordRecoveryUserId(input.confirmedUserId);
  if (!input.isOperationCurrent()) return { kind: "stale" };
  if (!confirmedUserId || !input.isRecoveryCurrent(confirmedUserId)) {
    return { kind: "invalid-recovery" };
  }

  const sessionResult = await input.auth.getSession();
  if (!input.isOperationCurrent()) return { kind: "stale" };
  if (sessionResult.error || !sessionResult.data.session) return { kind: "invalid-recovery" };
  if (
    normalizePasswordRecoveryUserId(sessionResult.data.session.user.id) !== confirmedUserId ||
    !input.isRecoveryCurrent(confirmedUserId)
  ) {
    return { kind: "invalid-recovery" };
  }

  const updateResult = await input.auth.updateUser({ password: input.password });
  if (!input.isOperationCurrent() || !input.isRecoveryCurrent(confirmedUserId)) {
    return { kind: "stale" };
  }
  if (updateResult.error) return { kind: "update-error", error: updateResult.error };

  input.onPasswordUpdated();
  if (!input.isOperationCurrent() || !input.isRecoveryCurrent(confirmedUserId)) {
    return { kind: "stale" };
  }

  const signOutResult = await input.auth.signOut();
  if (!input.isTerminalOperationCurrent()) return { kind: "stale" };
  if (signOutResult.error) return { kind: "sign-out-error", error: signOutResult.error };

  return { kind: "success" };
}
