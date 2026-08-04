import type {
  AuthenticatedRefreshResultKind,
  SessionDataRequestToken,
} from "@/lib/session/session-data-epoch";

export type AuthenticatedSessionIntent = "dashboard" | "restore-active-flow";

export type AuthenticatedSessionContinuationResult =
  | { kind: "completed"; refreshKind: "success" | "error" }
  | { kind: "same-identity" }
  | { kind: "stale" };

export interface AuthenticatedSessionContinuationPorts {
  refresh(): Promise<{ kind: AuthenticatedRefreshResultKind }>;
  isCurrent(token: SessionDataRequestToken): boolean;
  onStart(): void;
  onComplete(
    intent: AuthenticatedSessionIntent,
    refreshKind: "success" | "error",
  ): void;
}

export interface AuthenticatedSessionCoordinator {
  continueSession(
    token: SessionDataRequestToken,
    intent: AuthenticatedSessionIntent,
    ports: AuthenticatedSessionContinuationPorts,
  ): Promise<AuthenticatedSessionContinuationResult>;
  reset(): void;
}

export interface AuthenticatedSessionEventInput<TState> {
  event: string;
  state: TState;
  currentIdentity: { userId: string | null; scope: string | null };
  nextIdentity: { userId: string | null; scope: string | null };
  intent: AuthenticatedSessionIntent;
  hasAuthenticatedSession: boolean;
}

export interface AuthenticatedSessionEventPorts<TState> {
  applySameIdentitySession(state: TState): void;
  applyNewIdentitySession(state: TState): void;
  canContinueAfterSessionApplied(): boolean;
  continueSession(
    state: TState,
    intent: AuthenticatedSessionIntent,
  ): Promise<AuthenticatedSessionContinuationResult>;
}

export interface AuthenticatedSessionEventResult {
  identity: "same-identity" | "new-identity";
  proceedAfterSessionApplied: boolean;
  continuation: Promise<AuthenticatedSessionContinuationResult> | null;
}

interface InFlightContinuation {
  key: string;
  intent: AuthenticatedSessionIntent;
  promise: Promise<AuthenticatedSessionContinuationResult>;
}

function getTokenKey(token: SessionDataRequestToken) {
  return `${token.generation}:${token.userId ?? "anonymous"}:${token.scope ?? "none"}`;
}

export function createAuthenticatedSessionCoordinator(): AuthenticatedSessionCoordinator {
  let establishedKey: string | null = null;
  let inFlight: InFlightContinuation | null = null;
  let revision = 0;

  return {
    continueSession(token, intent, ports) {
      if (!token.userId || !token.scope || !ports.isCurrent(token)) {
        return Promise.resolve({ kind: "stale" });
      }
      const key = getTokenKey(token);
      if (establishedKey === key) {
        return Promise.resolve({ kind: "same-identity" });
      }
      if (inFlight?.key === key) {
        if (intent === "dashboard") inFlight.intent = "dashboard";
        return inFlight.promise;
      }

      const operation: InFlightContinuation = {
        key,
        intent,
        promise: Promise.resolve({ kind: "stale" }),
      };
      const operationRevision = revision;
      inFlight = operation;
      ports.onStart();
      operation.promise = (async () => {
        try {
          const refreshResult = await ports.refresh();
          if (
            operationRevision !== revision ||
            refreshResult.kind === "stale" ||
            !ports.isCurrent(token)
          ) {
            return { kind: "stale" };
          }
          ports.onComplete(operation.intent, refreshResult.kind);
          if (operationRevision !== revision) return { kind: "stale" };
          establishedKey = key;
          return { kind: "completed", refreshKind: refreshResult.kind };
        } finally {
          if (inFlight === operation) inFlight = null;
        }
      })();
      return operation.promise;
    },

    reset() {
      revision += 1;
      establishedKey = null;
      inFlight = null;
    },
  };
}

export function coordinateAuthenticatedSessionEvent<TState>(
  input: AuthenticatedSessionEventInput<TState>,
  ports: AuthenticatedSessionEventPorts<TState>,
): AuthenticatedSessionEventResult {
  const isSameIdentity =
    input.currentIdentity.userId === input.nextIdentity.userId &&
    input.currentIdentity.scope === input.nextIdentity.scope;

  if (isSameIdentity) {
    ports.applySameIdentitySession(input.state);
  } else {
    ports.applyNewIdentitySession(input.state);
  }

  const proceedAfterSessionApplied = ports.canContinueAfterSessionApplied();
  const shouldContinue =
    proceedAfterSessionApplied &&
    input.hasAuthenticatedSession &&
    (input.event === "SIGNED_IN" || input.event === "INITIAL_SESSION");

  return {
    identity: isSameIdentity ? "same-identity" : "new-identity",
    proceedAfterSessionApplied,
    continuation: shouldContinue
      ? ports.continueSession(input.state, input.intent)
      : null,
  };
}
