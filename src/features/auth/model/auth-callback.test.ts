import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_CALLBACK_PATH,
  PASSWORD_RECOVERY_FLOW,
  SIGNUP_CONFIRMATION_FLOW,
  buildSameOriginAuthCallbackUrl,
  isCrossedSignupConfirmationCallback,
  isPasswordRecoveryCallbackCompatible,
  parseAuthCallbackEvidence,
  resolveSignupConfirmationRouteState,
  resolveSignupConfirmationSessionDecision,
  type AuthCallbackEvidence,
} from "@/features/auth/model/auth-callback";

const signupEvidence: AuthCallbackEvidence = {
  flow: SIGNUP_CONFIRMATION_FLOW,
  type: "signup",
  accessToken: "callback-token-a",
  hasError: false,
};

test("callbacks Auth usan exclusivamente el origin actual y /login allowlisted", () => {
  for (const origin of [
    "https://deploy-preview-42.example.test/registro/coach?portal=coach",
    "http://localhost:3000/registro/usuario",
  ]) {
    for (const flow of [SIGNUP_CONFIRMATION_FLOW, PASSWORD_RECOVERY_FLOW]) {
      const result = new URL(buildSameOriginAuthCallbackUrl(origin, flow));
      assert.equal(result.origin, new URL(origin).origin);
      assert.equal(result.pathname, AUTH_CALLBACK_PATH);
      assert.equal(result.searchParams.get("flow"), flow);
      assert.equal([...result.searchParams.keys()].length, 1);
      assert.equal(result.hash, "");
    }
  }
});

test("builder rechaza protocolos y credenciales que podrían ocultar un redirect", () => {
  for (const origin of [
    "javascript:alert(1)",
    "ftp://preview.example.test",
    "https://attacker@preview.example.test",
    "https://user:password@preview.example.test",
  ]) {
    assert.throws(
      () => buildSameOriginAuthCallbackUrl(origin, SIGNUP_CONFIRMATION_FLOW),
      /origin is invalid/,
    );
  }
});

test("parser conserva sólo evidencia Auth necesaria y no propaga PII ni portal", () => {
  const evidence = parseAuthCallbackEvidence({
    search: "?flow=signup-confirmation&portal=coach&phone=%2B56912345678&birth_date=1990-01-01",
    hash: "#access_token=callback-token-a&type=signup&professional_title=privado",
  });

  assert.deepEqual(evidence, signupEvidence);
  const serialized = JSON.stringify(evidence);
  for (const forbidden of ["portal", "phone", "birth_date", "professional_title", "+569"] as const) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} no entra a la evidencia`);
  }
});

test("ruta signup se activa sólo para /login, flow cerrado y type compatible", () => {
  assert.equal(resolveSignupConfirmationRouteState({
    pathname: "/login",
    evidence: signupEvidence,
  }), "active");
  assert.equal(resolveSignupConfirmationRouteState({
    pathname: "/login",
    evidence: { ...signupEvidence, type: null },
  }), "active");

  for (const candidate of [
    { pathname: "/", evidence: signupEvidence, expected: "none" },
    {
      pathname: "/login",
      evidence: { ...signupEvidence, flow: PASSWORD_RECOVERY_FLOW },
      expected: "none",
    },
    {
      pathname: "/login",
      evidence: { ...signupEvidence, type: "recovery" },
      expected: "invalid",
    },
    {
      pathname: "/login",
      evidence: { ...signupEvidence, hasError: true },
      expected: "invalid",
    },
  ] as const) {
    assert.equal(resolveSignupConfirmationRouteState(candidate), candidate.expected);
  }
});

test("SIGNED_IN e INITIAL_SESSION completan en ambos órdenes con la misma evidencia A", () => {
  const eventOrders = [
    ["SIGNED_IN", "INITIAL_SESSION"],
    ["INITIAL_SESSION", "SIGNED_IN"],
  ] as const;

  for (const events of eventOrders) {
    assert.deepEqual(events.map((event) => resolveSignupConfirmationSessionDecision({
      routeState: "active",
      event,
      callbackAccessToken: "callback-token-a",
      sessionAccessToken: "callback-token-a",
      sessionUserId: "user-a",
    })), ["complete", "complete"]);
  }
});

test("callback A nunca se acepta para una sesión B ni sin evidencia completa", () => {
  const base = {
    routeState: "active" as const,
    event: "SIGNED_IN" as const,
    callbackAccessToken: "callback-token-a",
    sessionAccessToken: "callback-token-a",
    sessionUserId: "user-a",
  };
  for (const candidate of [
    { ...base, sessionAccessToken: "session-token-b", sessionUserId: "user-b" },
    { ...base, callbackAccessToken: null },
    { ...base, sessionAccessToken: null },
    { ...base, sessionUserId: null },
    { ...base, routeState: "invalid" as const },
  ]) {
    assert.equal(resolveSignupConfirmationSessionDecision(candidate), "invalid");
  }
  assert.equal(resolveSignupConfirmationSessionDecision({
    ...base,
    routeState: "none",
  }), "none");
});

test("PASSWORD_RECOVERY y confirmación signup permanecen separados", () => {
  assert.equal(resolveSignupConfirmationSessionDecision({
    routeState: "active",
    event: "PASSWORD_RECOVERY",
    callbackAccessToken: "same-token",
    sessionAccessToken: "same-token",
    sessionUserId: "user-a",
  }), "invalid");

  assert.equal(isPasswordRecoveryCallbackCompatible({
    flow: PASSWORD_RECOVERY_FLOW,
    type: "recovery",
    accessToken: "recovery-token",
    hasError: false,
  }), true);
  assert.equal(isPasswordRecoveryCallbackCompatible(signupEvidence), false);
  assert.equal(isPasswordRecoveryCallbackCompatible({
    ...signupEvidence,
    flow: PASSWORD_RECOVERY_FLOW,
  }), false);
  assert.equal(isCrossedSignupConfirmationCallback({
    ...signupEvidence,
    type: "recovery",
  }), true);
  assert.equal(isCrossedSignupConfirmationCallback(signupEvidence), false);
});

test("errores usados, vencidos o inválidos se detectan sin exponer su descripción", () => {
  const evidence = parseAuthCallbackEvidence({
    search: "?flow=signup-confirmation&error=access_denied&error_code=otp_expired&error_description=detalle-privado",
    hash: "",
  });
  assert.equal(evidence.hasError, true);
  assert.equal(resolveSignupConfirmationRouteState({
    pathname: "/login",
    evidence,
  }), "invalid");
  assert.equal(JSON.stringify(evidence).includes("detalle-privado"), false);
});
