import assert from "node:assert/strict";
import test from "node:test";

import {
  createUserPortalAuthorizationProof,
  hasCurrentUserPortalAuthorization,
  shouldMountAuthorizedUserPortal,
  type UserPortalAuthorizationProof,
} from "@/features/auth/model/user-portal-authorization-proof";
import {
  FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION,
  resolveUserPortalSessionRevalidation,
} from "@/features/auth/model/user-portal-session-revalidation";
import type { AuthorizedPortalAccess } from "@/features/auth/model/multiportal-auth-controller";

const USER_ID = "user-a";
const USER_ACCESS: AuthorizedPortalAccess = {
  state: "user_authorized",
  requestedPortal: "usuario",
  userId: USER_ID,
};
const COACH_ACCESS: AuthorizedPortalAccess = {
  state: "coach_authorized",
  requestedPortal: "coach",
  userId: USER_ID,
  coach: {
    userId: USER_ID,
    createdAt: "2026-08-23T00:00:00.000Z",
    firstName: "Ada",
    lastName: "Lovelace",
    birthDate: "1815-12-10",
    gender: "otro",
    phoneNumber: "+56000000000",
    professionalTitle: "Coach",
  },
};

function mountInput(authorizationProof: UserPortalAuthorizationProof | null) {
  return {
    authorizationProof,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
    hasCoachPortalSession: false,
    isAuthLoading: false,
    isPasswordRecoveryBlocked: false,
    isRenderableScreen: true,
  };
}

function revalidationInput(
  authorizationProof: UserPortalAuthorizationProof | null,
  overrides: Partial<Parameters<typeof resolveUserPortalSessionRevalidation>[0]> = {},
) {
  return {
    event: "SIGNED_IN",
    authorizationProof,
    nextSessionUserId: USER_ID,
    nextAuthenticatedUserId: USER_ID,
    requestedPortal: "usuario" as const,
    isInteractiveAuthAttempt: false,
    isPasswordRecoveryBlocked: false,
    isLogoutInFlight: false,
    hasCoachPortalSession: false,
    ...overrides,
  };
}

test("sólo user_authorized emite una prueba para la misma identidad efectiva", () => {
  const proof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(proof);
  assert.equal(hasCurrentUserPortalAuthorization({
    authorizationProof: proof,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  }), true);
  assert.equal(shouldMountAuthorizedUserPortal(mountInput(proof)), true);

  assert.equal(createUserPortalAuthorizationProof({
    access: COACH_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  }), null, "una autorización Coach no emite prueba Usuario");
  assert.equal(createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: "user-b",
    authenticatedUserId: "user-b",
  }), null, "A→B no reutiliza la autorización de A");
  assert.equal(createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: "user-b",
  }), null, "una sesión y un User divergentes no son identidad efectiva");
});

test("la matriz user-only, dual, coach-only y entrada elegida respeta la autorización resuelta", () => {
  const userProof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(userProof);

  assert.equal(shouldMountAuthorizedUserPortal(mountInput(userProof)), true, "user-only por Usuario");
  assert.equal(shouldMountAuthorizedUserPortal(mountInput(userProof)), true, "dual por Usuario");
  assert.equal(shouldMountAuthorizedUserPortal({
    ...mountInput(null),
    hasCoachPortalSession: true,
  }), false, "coach-only por Coach");
  assert.equal(shouldMountAuthorizedUserPortal({
    ...mountInput(null),
    hasCoachPortalSession: true,
  }), false, "dual por Coach conserva sólo Coach");
});

test("logout, recovery, loading, pantalla no productiva y reemplazo A→B desmontan el portal", () => {
  const proof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(proof);

  assert.equal(shouldMountAuthorizedUserPortal(mountInput(null)), false, "logout limpia la prueba");
  assert.equal(shouldMountAuthorizedUserPortal({
    ...mountInput(proof),
    isPasswordRecoveryBlocked: true,
  }), false);
  assert.equal(hasCurrentUserPortalAuthorization({
    authorizationProof: proof,
    sessionUserId: "user-b",
    authenticatedUserId: "user-b",
  }), false, "el fallback tampoco acepta una prueba de A bajo B");
  assert.equal(shouldMountAuthorizedUserPortal({ ...mountInput(proof), isAuthLoading: true }), false);
  assert.equal(shouldMountAuthorizedUserPortal({
    ...mountInput(proof),
    isRenderableScreen: false,
  }), false);
  assert.equal(shouldMountAuthorizedUserPortal({
    ...mountInput(proof),
    sessionUserId: "user-b",
    authenticatedUserId: "user-b",
  }), false);
});

test("metadata, email y objetos sin la marca privada no conceden membresía", () => {
  const forgedFromMetadata = {
    state: "user_authorized",
    userId: USER_ID,
    userMetadata: { portal: "usuario", role: "user" },
    email: "usuario@example.com",
  } as unknown as UserPortalAuthorizationProof;

  assert.equal(shouldMountAuthorizedUserPortal(mountInput(forgedFromMetadata)), false);
  assert.equal(hasCurrentUserPortalAuthorization({
    authorizationProof: forgedFromMetadata,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  }), false);
});

test("SIGNED_IN, INITIAL_SESSION y TOKEN_REFRESHED de la misma identidad conservan la prueba", () => {
  const proof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(proof);

  for (const event of ["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED"] as const) {
    const decision = resolveUserPortalSessionRevalidation(revalidationInput(proof, { event }));
    assert.equal(decision.kind, "silent_revalidation", event);
    assert.equal(decision.authorizationProof, proof, `${event}: conserva la capacidad efímera`);
  }
});

test("eventos redundantes y en ráfaga conservan exactamente la misma capacidad en memoria", () => {
  const proof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(proof);

  const events = [
    "SIGNED_IN",
    "SIGNED_IN",
    "INITIAL_SESSION",
    "TOKEN_REFRESHED",
    "SIGNED_IN",
  ] as const;
  for (const event of events) {
    const decision = resolveUserPortalSessionRevalidation(revalidationInput(proof, { event }));
    assert.equal(decision.kind, "silent_revalidation");
    assert.equal(decision.authorizationProof, proof);
  }
});

test("resultado autoritativo válido renueva la prueba e inválido bloquea el portal", () => {
  const currentProof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(currentProof);
  assert.equal(
    resolveUserPortalSessionRevalidation(revalidationInput(currentProof)).authorizationProof,
    currentProof,
    "la prueba sigue montada mientras la resolución está pendiente",
  );

  const renewedProof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(renewedProof);
  assert.equal(shouldMountAuthorizedUserPortal(mountInput(renewedProof)), true);

  const rejectedProof = createUserPortalAuthorizationProof({
    access: COACH_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.equal(rejectedProof, null);
  assert.equal(shouldMountAuthorizedUserPortal(mountInput(rejectedProof)), false);
});

test("bootstrap, identidad nueva y condiciones de seguridad fallan cerradas", () => {
  const proof = createUserPortalAuthorizationProof({
    access: USER_ACCESS,
    sessionUserId: USER_ID,
    authenticatedUserId: USER_ID,
  });
  assert.ok(proof);

  const failClosedCases: Array<{
    name: string;
    input: Parameters<typeof resolveUserPortalSessionRevalidation>[0];
  }> = [
    { name: "primer bootstrap sin prueba", input: revalidationInput(null, { event: "INITIAL_SESSION" }) },
    { name: "sesión ausente", input: revalidationInput(proof, { nextSessionUserId: null }) },
    { name: "usuario efectivo ausente", input: revalidationInput(proof, { nextAuthenticatedUserId: null }) },
    { name: "A→B", input: revalidationInput(proof, { nextSessionUserId: "user-b", nextAuthenticatedUserId: "user-b" }) },
    { name: "mismatch sesión/usuario", input: revalidationInput(proof, { nextAuthenticatedUserId: "user-b" }) },
    { name: "recovery", input: revalidationInput(proof, { isPasswordRecoveryBlocked: true }) },
    { name: "logout", input: revalidationInput(proof, { event: "SIGNED_OUT", isLogoutInFlight: true }) },
    { name: "Coach activo", input: revalidationInput(proof, { hasCoachPortalSession: true }) },
    { name: "resolución Coach solicitada", input: revalidationInput(proof, { requestedPortal: "coach" }) },
    { name: "login explícito", input: revalidationInput(proof, { isInteractiveAuthAttempt: true }) },
    { name: "evento no permitido", input: revalidationInput(proof, { event: "USER_UPDATED" }) },
  ];

  assert.equal(failClosedCases.length, 11);
  for (const candidate of failClosedCases) {
    assert.equal(
      resolveUserPortalSessionRevalidation(candidate.input),
      FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION,
      candidate.name,
    );
  }
});
