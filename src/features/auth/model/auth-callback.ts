export const SIGNUP_CONFIRMATION_FLOW = "signup-confirmation" as const;
export const PASSWORD_RECOVERY_FLOW = "password-recovery" as const;
export const AUTH_CALLBACK_PATH = "/login" as const;

export type AuthCallbackFlow =
  | typeof SIGNUP_CONFIRMATION_FLOW
  | typeof PASSWORD_RECOVERY_FLOW;

export interface AuthCallbackEvidence {
  flow: string | null;
  type: string | null;
  accessToken: string | null;
  hasError: boolean;
}

export type SignupConfirmationRouteState = "none" | "active" | "invalid";

export type SignupConfirmationSessionDecision =
  | "none"
  | "complete"
  | "invalid";

export function buildSameOriginAuthCallbackUrl(
  currentOrigin: string,
  flow: AuthCallbackFlow,
): string {
  const source = new URL(currentOrigin);
  if (
    (source.protocol !== "https:" && source.protocol !== "http:")
    || source.username
    || source.password
  ) {
    throw new Error("Auth callback origin is invalid.");
  }

  const target = new URL(AUTH_CALLBACK_PATH, source.origin);
  target.searchParams.set("flow", flow);
  if (target.origin !== source.origin || target.pathname !== AUTH_CALLBACK_PATH) {
    throw new Error("Auth callback must remain same-origin.");
  }
  return target.toString();
}

export function getBrowserAuthCallbackUrl(flow: AuthCallbackFlow): string {
  const origin = typeof window === "undefined"
    ? "https://organizatech.cl"
    : window.location.origin;
  return buildSameOriginAuthCallbackUrl(origin, flow);
}

export function parseAuthCallbackEvidence(input: {
  search: string;
  hash: string;
}): AuthCallbackEvidence {
  const searchParams = new URLSearchParams(stripPrefix(input.search, "?"));
  const hashParams = new URLSearchParams(stripPrefix(input.hash, "#"));
  const error = searchParams.get("error") ?? hashParams.get("error");
  const errorCode = searchParams.get("error_code") ?? hashParams.get("error_code");
  const errorDescription = searchParams.get("error_description")
    ?? hashParams.get("error_description");

  return {
    flow: searchParams.get("flow"),
    type: searchParams.get("type") ?? hashParams.get("type"),
    accessToken: hashParams.get("access_token"),
    hasError: Boolean(error || errorCode || errorDescription),
  };
}

export function resolveSignupConfirmationRouteState(input: {
  pathname: string;
  evidence: AuthCallbackEvidence;
}): SignupConfirmationRouteState {
  if (
    input.pathname !== AUTH_CALLBACK_PATH
    || input.evidence.flow !== SIGNUP_CONFIRMATION_FLOW
  ) {
    return "none";
  }
  if (
    input.evidence.hasError
    || (
      input.evidence.type !== null
      && input.evidence.type !== "signup"
    )
  ) {
    return "invalid";
  }
  return "active";
}

export function resolveSignupConfirmationSessionDecision(input: {
  routeState: SignupConfirmationRouteState;
  event: "bootstrap" | "SIGNED_IN" | "INITIAL_SESSION" | "PASSWORD_RECOVERY";
  callbackAccessToken: string | null;
  sessionAccessToken: string | null;
  sessionUserId: string | null;
}): SignupConfirmationSessionDecision {
  if (input.routeState === "none") return "none";
  if (input.routeState === "invalid" || input.event === "PASSWORD_RECOVERY") {
    return "invalid";
  }
  if (
    !input.callbackAccessToken
    || !input.sessionAccessToken
    || !input.sessionUserId
    || input.callbackAccessToken !== input.sessionAccessToken
  ) {
    return "invalid";
  }
  return "complete";
}

export function isPasswordRecoveryCallbackCompatible(
  evidence: AuthCallbackEvidence,
): boolean {
  return evidence.flow === PASSWORD_RECOVERY_FLOW
    && (evidence.type === null || evidence.type === "recovery");
}

export function isCrossedSignupConfirmationCallback(
  evidence: AuthCallbackEvidence,
): boolean {
  return evidence.flow === SIGNUP_CONFIRMATION_FLOW
    && evidence.type !== null
    && evidence.type !== "signup";
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
