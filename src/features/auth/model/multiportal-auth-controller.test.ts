import assert from "node:assert/strict";
import test from "node:test";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import type { CoachRegistrationSubmission } from "@/features/auth/model/auth-form";
import { createAuthRegistrationFormController } from "@/features/auth/model/auth-registration-form-controller";
import {
  COACH_REGISTRATION_CONFIRMED_MESSAGE,
  COACH_REGISTRATION_CONFIRMATION_MESSAGE,
  COACH_REGISTRATION_REQUIRED_MESSAGE,
  MULTIPORTAL_AUTH_ERROR_MESSAGE,
  MULTIPORTAL_AUTH_RETRYABLE_MESSAGE,
  SIGNUP_CONFIRMATION_INVALID_MESSAGE,
  USER_REGISTRATION_CONFIRMATION_MESSAGE,
  USER_REGISTRATION_CONFIRMED_MESSAGE,
  USER_REGISTRATION_REQUIRED_MESSAGE,
  createMultiportalAuthController,
  type AuthenticatedPortalIdentity,
  type CoachRegistrationRecord,
  type MultiportalAuthGateway,
} from "@/features/auth/model/multiportal-auth-controller";
import {
  createCoachRegistrationOwnerController,
  createPortalResolutionOwnerController,
  createSinglePublicationNoticeController,
  createUserRegistrationOwnerController,
} from "@/features/auth/model/portal-resolution-owner";
import {
  SupabaseAuthReadTimeoutError,
  SupabaseAuthRefreshTransportError,
  createResilientSupabaseAuthFetch,
  isAuthoritativeSupabaseAuthRejection,
  isTransientSupabaseAuthError,
  runIdempotentAuthReadWithSingleRetry,
  type SupabaseAuthRefreshIdentityScope,
} from "@/lib/supabase/auth-resilience";
import {
  consumeAuthoritativeRefreshRejection,
  getActiveSupabaseAuthIdentityScope,
  readStoredSupabaseAuthIdentity,
  recordAuthoritativeRefreshRejection,
  recordSupabaseAuthIdentity,
  seedSupabaseAuthIdentityFromStorage,
} from "@/lib/supabase/client";
import { readInitialSupabaseSession } from "@/lib/supabase/session";
import { resolveSignedOutSessionPolicy } from "@/features/app-shell/model/signed-out-session-policy";

interface TestAuthState {
  sessionId: string;
}

const userA: AuthenticatedPortalIdentity<TestAuthState> = {
  userId: "user-a",
  email: "coach@example.com",
  authState: { sessionId: "session-a" },
};
const userB: AuthenticatedPortalIdentity<TestAuthState> = {
  userId: "user-b",
  email: "coach-b@example.com",
  authState: { sessionId: "session-b" },
};

const coachInput = {
  flow: "separate",
  auth: {
    email: "coach@example.com",
    password: "segura123",
    options: {
      data: {
        display_name: "Coach Uno",
        first_name: "Coach",
        last_name: "Uno",
        birth_date: "1990-01-01",
        gender: "prefer_not_to_say",
        phone_number: "+56912345678",
      },
    },
  },
  registration: {
    first_name: "Coach",
    last_name: "Uno",
    birth_date: "1990-01-01",
    gender: "prefer_not_to_say",
    phone_number: "+56912345678",
    professional_title: "Preparador físico",
    contact_email: "contacto-usuario@example.net",
  },
} satisfies CoachRegistrationSubmission;

const sharedCoachInput = {
  flow: "shared",
  registration: coachInput.registration,
} satisfies CoachRegistrationSubmission;

function createCoachInputB(): Extract<CoachRegistrationSubmission, { flow: "separate" }> {
  return {
    flow: "separate",
    auth: {
      ...coachInput.auth,
      email: userB.email!,
      options: {
        data: {
          ...coachInput.auth.options.data,
          display_name: "Coach B",
          first_name: "Coach B",
          last_name: "Apellido B",
        },
      },
    },
    registration: {
      ...coachInput.registration,
      first_name: "Coach B",
      last_name: "Apellido B",
      professional_title: "Título B",
      contact_email: "coach-contact@example.net",
    },
  };
}

function createCoachRecord(userId = userA.userId): CoachRegistrationRecord {
  return {
    userId,
    createdAt: "2026-08-16T12:00:00.000Z",
    firstName: coachInput.registration.first_name,
    lastName: coachInput.registration.last_name,
    birthDate: coachInput.registration.birth_date,
    gender: coachInput.registration.gender,
    phoneNumber: coachInput.registration.phone_number,
    professionalTitle: coachInput.registration.professional_title,
    contactEmail: coachInput.registration.contact_email,
  };
}

function createGateway(
  overrides: Partial<MultiportalAuthGateway<TestAuthState>> = {},
): MultiportalAuthGateway<TestAuthState> {
  return {
    getCurrentIdentity: async () => userA,
    signUpForCoachRegistration: async () => assert.fail("signUp inesperado"),
    createSharedCoachRegistration: async () => assert.fail("activación compartida inesperada"),
    signInForUserRegistration: async () => assert.fail("signIn Usuario inesperado"),
    signUpForUserRegistration: async () => assert.fail("signUp Usuario inesperado"),
    getOwnSignupConfirmation: async () => ({ status: "confirmed", portal: "usuario" }),
    requestWelcomeEmail: async () => undefined,
    signOutAfterSignupConfirmation: async (_expectedUserId, owner) => (
      owner.isCurrent() ? "signed_out" : "stale"
    ),
    hasUserRegistration: async () => true,
    getCoachRegistration: async () => null,
    createUserRegistration: async (expectedUserId) => ({ userId: expectedUserId }),
    activateCoachRegistrationIdentity: async (identity) => identity,
    activateUserRegistrationIdentity: async (identity) => identity,
    signOut: async (_reason, owner) => owner.isCurrent() ? "signed_out" : "stale",
    ...overrides,
  };
}

function beginCurrentRegistration(currentUserId: string | null = userA.userId) {
  const owners = createCoachRegistrationOwnerController();
  if (currentUserId) owners.acceptIdentity(currentUserId);
  return { owners, owner: owners.begin({ independentIdentity: true }) };
}

function beginCurrentSharedRegistration(currentUserId = userA.userId) {
  const owners = createCoachRegistrationOwnerController();
  owners.acceptIdentity(currentUserId);
  return { owners, owner: owners.begin() };
}

function beginCurrentUserRegistration(currentUserId: string | null = userA.userId) {
  const owners = createUserRegistrationOwnerController();
  if (currentUserId) owners.acceptIdentity(currentUserId);
  return { owners, owner: owners.begin() };
}

function beginCurrentResolution(expectedUserId = userA.userId) {
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity(expectedUserId);
  return { owners, owner: owners.begin(expectedUserId) };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createTestAuthStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    has(key: string) {
      return values.has(key);
    },
  };
}

function createTestSession(expiresAt: number, suffix = "a"): Session {
  return {
    access_token: `test-access-${suffix}`,
    refresh_token: `test-refresh-${suffix}`,
    expires_in: 3600,
    expires_at: expiresAt,
    token_type: "bearer",
    user: {
      id: `test-user-${suffix}`,
      aud: "authenticated",
      role: "authenticated",
      email: `test-${suffix}@example.test`,
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-09-01T00:00:00.000Z",
    },
  };
}

function createRefreshSuccessResponse(suffix = "refreshed") {
  return new Response(JSON.stringify(createTestSession(
    Math.floor(Date.now() / 1000) + 3_600,
    suffix,
  )), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createAuthErrorResponse(status: number) {
  return new Response(JSON.stringify({
    code: status === 401 ? "refresh_token_not_found" : "temporarily_unavailable",
    msg: status === 401 ? "Invalid Refresh Token" : "Temporary failure",
    message: status === 401 ? "Invalid Refresh Token" : "Temporary failure",
  }), {
    status,
    headers: {
      "content-type": "application/json",
      "x-supabase-api-version": "2024-01-01",
    },
  });
}

function registrationStateSnapshot(
  form: ReturnType<typeof createAuthRegistrationFormController>,
) {
  return JSON.stringify(form.getState());
}

test("bootstrap Auth: una lectura colgada termina sin iniciar otro getSession bajo el mismo lock", async () => {
  let attempts = 0;
  const never = new Promise<never>(() => undefined);

  await assert.rejects(
    runIdempotentAuthReadWithSingleRetry(
      () => {
        attempts += 1;
        return never;
      },
      {
        timeoutMilliseconds: 5,
        retryDelayMilliseconds: 0,
        sleep: async () => undefined,
      },
    ),
    SupabaseAuthReadTimeoutError,
  );

  assert.equal(attempts, 1, "un timeout no debe encolar otro getSession bajo el mismo lock");
});

test("bootstrap Auth: un fallo transitorio reintenta una vez y publica el éxito", async () => {
  let attempts = 0;
  const result = await runIdempotentAuthReadWithSingleRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("Failed to fetch"), { status: 503 });
      }
      return "session-a";
    },
    {
      timeoutMilliseconds: 25,
      retryDelayMilliseconds: 0,
      sleep: async () => undefined,
    },
  );

  assert.equal(result, "session-a");
  assert.equal(attempts, 2);
});

test("bootstrap Auth: un rechazo 401 no se reclasifica como reintento de red", async () => {
  let attempts = 0;

  await assert.rejects(
    runIdempotentAuthReadWithSingleRetry(async () => {
      attempts += 1;
      throw Object.assign(new Error("Invalid JWT"), { status: 401, code: "bad_jwt" });
    }, {
      timeoutMilliseconds: 25,
      retryDelayMilliseconds: 0,
      sleep: async () => undefined,
    }),
    /Invalid JWT/,
  );

  assert.equal(attempts, 1);
});

test("bootstrap Auth: clasifica sólo fallos transitorios y rechazos marcados", () => {
  for (const error of [
    new TypeError("Load failed"),
    Object.assign(new Error("rate limited"), { status: 429 }),
    Object.assign(new Error("upstream"), { statusCode: 502 }),
    new Error("repository", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) }),
  ]) {
    assert.equal(isTransientSupabaseAuthError(error), true);
  }

  assert.equal(
    isTransientSupabaseAuthError(Object.assign(new Error("Invalid JWT"), { status: 401 })),
    false,
  );
  assert.equal(
    isTransientSupabaseAuthError(Object.assign(new Error("invalid status"), { status: 600 })),
    false,
  );
  assert.equal(
    isAuthoritativeSupabaseAuthRejection({
      message: "crossed row",
      authFailureKind: "authoritative_rejection",
    }),
    true,
  );
  assert.equal(isAuthoritativeSupabaseAuthRejection(new Error("authorization failed")), false);
});

test("bootstrap Auth: getSession transitorio recupera la sesión en el segundo intento", async () => {
  type SessionLookupResult = Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>;
  let attempts = 0;
  const session = { user: { id: "user-a" } } as Session;

  const result = await readInitialSupabaseSession(async () => {
    attempts += 1;
    return attempts === 1
      ? {
        data: { session: null },
        error: Object.assign(new Error("Service unavailable"), { status: 503 }),
      } as SessionLookupResult
      : { data: { session }, error: null } as SessionLookupResult;
  }, {
    timeoutMilliseconds: 25,
    retryDelayMilliseconds: 0,
    sleep: async () => undefined,
  });

  assert.equal(result, session);
  assert.equal(attempts, 2);
});

test("bootstrap Auth: getSession colgado respeta el presupuesto total acotado", async () => {
  type SessionLookupResult = Awaited<ReturnType<SupabaseClient["auth"]["getSession"]>>;
  let attempts = 0;
  const never = new Promise<SessionLookupResult>(() => undefined);

  await assert.rejects(
    readInitialSupabaseSession(() => {
      attempts += 1;
      return never;
    }, {
      timeoutMilliseconds: 5,
      retryDelayMilliseconds: 0,
      sleep: async () => undefined,
    }),
    /no respondió dentro de 5 ms/,
  );

  assert.equal(attempts, 1);
});

test("transporte Auth: sólo intercepta refresh y conserva intactos los rechazos terminales", async () => {
  const terminalStatuses: number[] = [];
  const responses = [400, 401, 403];
  let responseIndex = 0;
  const resilientFetch = createResilientSupabaseAuthFetch({
    timeoutMilliseconds: 25,
    onTerminalRefreshRejection: (status) => terminalStatuses.push(status),
    fetch: async () => createAuthErrorResponse(responses[responseIndex++]!),
  });

  for (const status of responses) {
    const response = await resilientFetch(
      "https://auth-resilience.test.supabase.co/auth/v1/token?grant_type=refresh_token",
      { method: "POST" },
    );
    assert.equal(response.status, status);
  }
  assert.deepEqual(terminalStatuses, responses);

  const untouched = createResilientSupabaseAuthFetch({
    authOrigin: "https://auth-resilience.test.supabase.co",
    fetch: async () => new Response(null, { status: 500 }),
  });
  const response = await untouched(
    "https://auth-resilience.test.supabase.co/rest/v1/profile",
    { method: "GET" },
  );
  assert.equal(response.status, 500, "otros productos Supabase no pasan por este transporte Auth");

  const foreignRefresh = await untouched(
    "https://other-project.test.supabase.co/auth/v1/token?grant_type=refresh_token",
    { method: "POST" },
  );
  assert.equal(foreignRefresh.status, 500, "el transporte sólo intercepta el origen Auth configurado");
});

test("refresh terminal A conserva el scope capturado aunque B se active antes de responder", async () => {
  const response = createDeferred<Response>();
  const scopeA: SupabaseAuthRefreshIdentityScope = { userId: "user-a", sessionEpoch: 11 };
  const scopeB: SupabaseAuthRefreshIdentityScope = { userId: "user-b", sessionEpoch: 12 };
  let activeScope = scopeA;
  const terminal: Array<{ status: number; scope: SupabaseAuthRefreshIdentityScope | null }> = [];
  const fetch = createResilientSupabaseAuthFetch({
    captureRefreshIdentityScope: () => activeScope,
    onTerminalRefreshRejection: (status, scope) => terminal.push({ status, scope }),
    fetch: async () => response.promise,
  });

  const pendingA = fetch(
    "https://auth-resilience.test.supabase.co/auth/v1/token?grant_type=refresh_token",
    { method: "POST" },
  );
  activeScope = scopeB;
  response.resolve(createAuthErrorResponse(401));

  assert.equal((await pendingA).status, 401);
  assert.deepEqual(terminal, [{ status: 401, scope: scopeA }]);
});

test("scope Auth avanza aun cuando la nueva sesión pertenece al mismo usuario", () => {
  const first = recordSupabaseAuthIdentity({
    user: { id: "user-a" } as Session["user"],
    refresh_token: "refresh-a-1",
  });
  const same = recordSupabaseAuthIdentity({
    user: { id: "user-a" } as Session["user"],
    refresh_token: "refresh-a-1",
  });
  const replacement = recordSupabaseAuthIdentity({
    user: { id: "user-a" } as Session["user"],
    refresh_token: "refresh-a-2",
  });

  assert.deepEqual(same, first);
  assert.equal(replacement?.userId, "user-a");
  assert.ok((replacement?.sessionEpoch ?? 0) > (first?.sessionEpoch ?? 0));
  recordSupabaseAuthIdentity(null);
});

test("marcadores terminales A/B coexisten y un mismatch no consume otra identidad", () => {
  const scopeA = { userId: "user-a", sessionEpoch: 101 };
  const scopeB = { userId: "user-b", sessionEpoch: 102 };
  const mismatch = { userId: "user-c", sessionEpoch: 103 };
  const newerScopeA = { userId: "user-a", sessionEpoch: 104 };
  const expiresAt = Date.now() + 60_000;

  recordAuthoritativeRefreshRejection(scopeA, expiresAt);
  recordAuthoritativeRefreshRejection(scopeB, expiresAt);
  recordAuthoritativeRefreshRejection(newerScopeA, expiresAt);

  assert.equal(consumeAuthoritativeRefreshRejection(mismatch), false);
  assert.equal(consumeAuthoritativeRefreshRejection(scopeB), true);
  assert.equal(consumeAuthoritativeRefreshRejection(newerScopeA), true);
  assert.equal(consumeAuthoritativeRefreshRejection(scopeA), true);
  assert.equal(consumeAuthoritativeRefreshRejection(scopeB), false);
});

test("bootstrap 401 usa identidad durable acotada y purga sólo su scope exacto", async () => {
  const supabaseUrl = "https://fjjebhaqtrdbpxzxztmh.supabase.co";
  const userAId = "11111111-1111-4111-8111-111111111111";
  const userBId = "22222222-2222-4222-8222-222222222222";
  const storage = {
    getItem(key: string) {
      assert.equal(key, "sb-fjjebhaqtrdbpxzxztmh-auth-token");
      return JSON.stringify({
        refresh_token: "refresh-bootstrap-a",
        user: { id: userAId },
      });
    },
  };

  recordSupabaseAuthIdentity(null);
  const scopeA = seedSupabaseAuthIdentityFromStorage(supabaseUrl, storage);
  assert.equal(scopeA?.userId, userAId);
  assert.deepEqual(getActiveSupabaseAuthIdentityScope(), scopeA);

  const refresh = createResilientSupabaseAuthFetch({
    authOrigin: supabaseUrl,
    captureRefreshIdentityScope: getActiveSupabaseAuthIdentityScope,
    onTerminalRefreshRejection: (_status, scope) => {
      if (scope) recordAuthoritativeRefreshRejection(scope);
    },
    fetch: async () => createAuthErrorResponse(401),
  });
  assert.equal((await refresh(
    `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    { method: "POST" },
  )).status, 401);

  const scopeB = recordSupabaseAuthIdentity({
    user: { id: userBId } as Session["user"],
    refresh_token: "refresh-bootstrap-b",
  });
  assert.ok(scopeA && scopeB);
  assert.equal(consumeAuthoritativeRefreshRejection(scopeB), false);
  assert.equal(resolveSignedOutSessionPolicy({
    isExplicitLogoutInFlight: false,
    hasAuthoritativeRefreshRejection: false,
  }).purgeDurableStorage, false);
  assert.equal(resolveSignedOutSessionPolicy({
    isExplicitLogoutInFlight: false,
    hasAuthoritativeRefreshRejection: consumeAuthoritativeRefreshRejection(scopeA),
  }).purgeDurableStorage, true);

  assert.equal(readStoredSupabaseAuthIdentity(supabaseUrl, {
    getItem: () => "{malformed",
  }), null);
  assert.equal(readStoredSupabaseAuthIdentity(supabaseUrl, {
    getItem: () => JSON.stringify({ refresh_token: "refresh-a", user: { id: "not-a-uuid" } }),
  }), null);
  assert.equal(readStoredSupabaseAuthIdentity(supabaseUrl, {
    getItem: () => "x".repeat((128 * 1024) + 1),
  }), null);
  recordSupabaseAuthIdentity(null);
});

test("transporte Auth: timeout real aborta aunque el fetch subyacente no termine", async () => {
  const resilientFetch = createResilientSupabaseAuthFetch({
    timeoutMilliseconds: 5,
    fetch: async () => new Promise<Response>(() => undefined),
  });

  await assert.rejects(
    resilientFetch(
      "https://auth-resilience.test.supabase.co/auth/v1/token?grant_type=refresh_token",
      { method: "POST" },
    ),
    (error: unknown) => error instanceof SupabaseAuthRefreshTransportError
      && error.status === 408,
  );
});

test("cliente Supabase real: cerrar y reabrir restaura la sesión durable", async () => {
  const storageKey = "auth-resilience-reopen";
  const originalSession = createTestSession(Math.floor(Date.now() / 1000) + 3_600);
  const storage = createTestAuthStorage({
    [storageKey]: JSON.stringify(originalSession),
  });
  let fetchCalls = 0;
  const fetch = async () => {
    fetchCalls += 1;
    return new Response(null, { status: 500 });
  };
  const options = {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey,
      storage,
    },
    global: { fetch },
  };

  const firstClient = createClient(
    "https://auth-resilience-reopen.test.supabase.co",
    "test-anon-key",
    options,
  );
  const first = await firstClient.auth.getSession();
  firstClient.auth.stopAutoRefresh();

  const reopenedClient = createClient(
    "https://auth-resilience-reopen.test.supabase.co",
    "test-anon-key",
    options,
  );
  const reopened = await reopenedClient.auth.getSession();
  reopenedClient.auth.stopAutoRefresh();

  assert.equal(first.error, null);
  assert.equal(reopened.error, null);
  assert.equal(first.data.session?.user.id, originalSession.user.id);
  assert.equal(reopened.data.session?.user.id, originalSession.user.id);
  assert.equal(storage.has(storageKey), true);
  assert.equal(fetchCalls, 0, "una sesión vigente se restaura sin red ni refresh innecesario");
});

test("cliente Supabase real: DNS, abort, 429 y 5xx conservan storage y nunca emiten SIGNED_OUT", async (context) => {
  const failures: ReadonlyArray<{
    name: string;
    respond(): Promise<Response>;
  }> = [
    {
      name: "DNS",
      respond: async () => {
        throw new TypeError("Failed to fetch");
      },
    },
    {
      name: "abort",
      respond: async () => new Promise<Response>(() => undefined),
    },
    ...[429, 500, 503].map((status) => ({
      name: String(status),
      respond: async () => createAuthErrorResponse(status),
    })),
  ];

  for (const failure of failures) {
    await context.test(failure.name, async () => {
      const storageKey = `auth-resilience-${failure.name}`;
      const storage = createTestAuthStorage({
        [storageKey]: JSON.stringify(createTestSession(1, failure.name)),
      });
      const events: string[] = [];
      let fetchCalls = 0;
      const fetch = createResilientSupabaseAuthFetch({
        timeoutMilliseconds: 5,
        fetch: async () => {
          fetchCalls += 1;
          if (fetchCalls === 1) return failure.respond();
          assert.equal(storage.has(storageKey), true, "el primer fallo no puede purgar storage");
          return createRefreshSuccessResponse(failure.name);
        },
      });
      const client = createClient(
        `https://auth-resilience-${failure.name.toLowerCase()}.test.supabase.co`,
        "test-anon-key",
        {
          auth: {
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey,
            storage,
          },
          global: { fetch },
        },
      );
      const subscription = client.auth.onAuthStateChange((event) => events.push(event));

      const result = await client.auth.getSession();
      subscription.data.subscription.unsubscribe();
      client.auth.stopAutoRefresh();

      assert.equal(result.error, null);
      assert.ok(result.data.session);
      assert.equal(storage.has(storageKey), true);
      assert.equal(events.includes("SIGNED_OUT"), false);
      assert.equal(fetchCalls, 2, "Auth debe recuperar el primer fallo con un único retry exitoso");
    });
  }
});

test("cliente Supabase real: un 401 terminal elimina Auth storage y emite SIGNED_OUT", async () => {
  const storageKey = "auth-resilience-terminal-401";
  const storage = createTestAuthStorage({
    [storageKey]: JSON.stringify(createTestSession(1, "terminal")),
  });
  const events: string[] = [];
  const terminalStatuses: number[] = [];
  const fetch = createResilientSupabaseAuthFetch({
    onTerminalRefreshRejection: (status) => terminalStatuses.push(status),
    fetch: async () => createAuthErrorResponse(401),
  });
  const client = createClient(
    "https://auth-resilience-terminal.test.supabase.co",
    "test-anon-key",
    {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey,
        storage,
      },
      global: { fetch },
    },
  );
  const subscription = client.auth.onAuthStateChange((event) => events.push(event));

  const result = await client.auth.getSession();
  subscription.data.subscription.unsubscribe();
  client.auth.stopAutoRefresh();

  assert.ok(result.error);
  assert.equal(result.data.session, null);
  assert.equal(storage.has(storageKey), false);
  assert.equal(events.includes("SIGNED_OUT"), true);
  assert.deepEqual(terminalStatuses, [401]);
});

test("H3 · captura vigente shared autoriza únicamente la identidad esperada", () => {
  const form = createAuthRegistrationFormController();
  form.edit("firstName", "Nombre conservado");
  const capture = form.selectCoachFlow("shared", userA.userId);
  const revisionBeforeCompletion = form.getState().revision;

  assert.equal(Object.isFrozen(capture), true);
  assert.equal(capture.expectedUserId, userA.userId);
  assert.equal(
    form.completeSharedCoachEligibility(capture, {
      state: "authorized",
      userId: userA.userId,
    }),
    true,
  );
  assert.equal(form.getState().revision, revisionBeforeCompletion + 1);
  assert.equal(form.getState().coachFlow, "shared");
  assert.deepEqual(form.getState().sharedCoachEligibility, {
    state: "authorized",
    userId: userA.userId,
  });
  assert.equal(form.getState().values.firstName, "Nombre conservado");
  assert.equal(form.getState().sharedCoachLoginPending, false);
});

test("H3 · captura vigente shared completa sign_in_required", () => {
  const form = createAuthRegistrationFormController();
  const capture = form.selectCoachFlow("shared", null);
  const revisionBeforeCompletion = form.getState().revision;

  assert.equal(
    form.completeSharedCoachEligibility(capture, { state: "sign_in_required" }),
    true,
  );
  assert.equal(form.getState().revision, revisionBeforeCompletion + 1);
  assert.equal(form.getState().coachFlow, "shared");
  assert.deepEqual(form.getState().sharedCoachEligibility, { state: "sign_in_required" });
  assert.equal(form.getState().sharedCoachLoginPending, false);
});

test("H3 · revisión cambiada antes de completar descarta la respuesta", () => {
  const form = createAuthRegistrationFormController();
  const capture = form.selectCoachFlow("shared", userA.userId);
  form.edit("contactEmail", "edicion-b@example.com");
  const snapshot = registrationStateSnapshot(form);
  let notifications = 0;
  const unsubscribe = form.subscribe(() => {
    notifications += 1;
  });

  assert.equal(
    form.completeSharedCoachEligibility(capture, { state: "sign_in_required" }),
    false,
  );
  unsubscribe();
  assert.equal(registrationStateSnapshot(form), snapshot);
  assert.equal(notifications, 0);
});

test("H3 · cambio shared a separate descarta la respuesta pendiente", () => {
  const form = createAuthRegistrationFormController();
  const sharedCapture = form.selectCoachFlow("shared", userA.userId);
  const separateCapture = form.selectCoachFlow("separate", null);
  const snapshot = registrationStateSnapshot(form);

  assert.equal(
    form.completeSharedCoachEligibility(sharedCapture, {
      state: "authorized",
      userId: userA.userId,
    }),
    false,
  );
  assert.equal(registrationStateSnapshot(form), snapshot);
  assert.equal(
    form.completeSharedCoachEligibility(separateCapture, { state: "sign_in_required" }),
    false,
  );
  assert.equal(registrationStateSnapshot(form), snapshot);
});

test("H3 · respuesta tardía A no pisa una nueva captura B", () => {
  const form = createAuthRegistrationFormController();
  const captureA = form.selectCoachFlow("shared", userA.userId);
  const captureB = form.selectCoachFlow("shared", userB.userId);
  const snapshotB = registrationStateSnapshot(form);

  assert.equal(
    form.completeSharedCoachEligibility(captureA, {
      state: "authorized",
      userId: userA.userId,
    }),
    false,
  );
  assert.equal(registrationStateSnapshot(form), snapshotB);
  assert.equal(
    form.completeSharedCoachEligibility(captureB, {
      state: "authorized",
      userId: userB.userId,
    }),
    true,
  );
  assert.deepEqual(form.getState().sharedCoachEligibility, {
    state: "authorized",
    userId: userB.userId,
  });
});

test("H3 · identidad autorizada distinta de expectedUserId falla cerrada", () => {
  const form = createAuthRegistrationFormController();
  const capture = form.selectCoachFlow("shared", userA.userId);
  const snapshot = registrationStateSnapshot(form);
  let notifications = 0;
  const unsubscribe = form.subscribe(() => {
    notifications += 1;
  });

  assert.equal(
    form.completeSharedCoachEligibility(capture, {
      state: "authorized",
      userId: userB.userId,
    }),
    false,
  );
  unsubscribe();
  assert.equal(registrationStateSnapshot(form), snapshot);
  assert.deepEqual(form.getState().sharedCoachEligibility, { state: "checking" });
  assert.equal(notifications, 0);
});

test("H3 · respuesta stale conserva todo el estado feature-owned", () => {
  const form = createAuthRegistrationFormController();
  const staleCaptureA = form.selectCoachFlow("shared", userA.userId);
  const captureB = form.selectCoachFlow("shared", userB.userId);
  assert.equal(
    form.completeSharedCoachEligibility(captureB, {
      state: "authorized",
      userId: userB.userId,
    }),
    true,
  );
  for (const [field, value] of Object.entries({
    firstName: "Nombre B",
    lastName: "Apellido B",
    birthDate: "1991-02-03",
    gender: "female",
    phoneNumber: "+56911112222",
    professionalTitle: "Coach B",
    contactEmail: "contacto-b@example.com",
    email: "acceso-b@example.com",
    password: "secreta-b",
    confirmPassword: "secreta-b",
  }) as Array<[keyof ReturnType<typeof form.getState>["values"], string]>) {
    form.edit(field, value);
  }
  form.setFieldError("register-contact-email", "error contacto B");
  form.setFieldError("register-password", "error password B");
  form.togglePasswordVisibility("password");
  form.togglePasswordVisibility("confirmPassword");
  const snapshot = registrationStateSnapshot(form);
  let notifications = 0;
  const unsubscribe = form.subscribe(() => {
    notifications += 1;
  });

  assert.equal(form.getState().coachFlow, "shared");
  assert.deepEqual(form.getState().sharedCoachEligibility, {
    state: "authorized",
    userId: userB.userId,
  });
  assert.equal(form.getState().showPassword, true);
  assert.equal(form.getState().showConfirmPassword, true);
  assert.equal(
    form.completeSharedCoachEligibility(staleCaptureA, {
      state: "authorized",
      userId: userA.userId,
    }),
    false,
  );
  unsubscribe();
  assert.equal(registrationStateSnapshot(form), snapshot);
  assert.equal(notifications, 0);
});

for (const resetCase of [
  {
    portal: "Usuario",
    laterEdits: [
      ["firstName", "Edición B Usuario"],
      ["lastName", "Apellido B Usuario"],
    ],
  },
  {
    portal: "Coach",
    laterEdits: [
      ["email", "coach-b@example.com"],
      ["contactEmail", "contacto-b@example.com"],
    ],
  },
] as const) {
  test(`${resetCase.portal}: submit A + edición B + respuesta A conserva B`, async () => {
    const form = createAuthRegistrationFormController();
    form.edit("firstName", "Valor A");
    form.edit("lastName", "Apellido A");
    form.edit("email", "cuenta-a@example.com");
    form.edit("contactEmail", "contacto-a@example.com");
    const capturedRevision = form.captureRevision();
    const responseA = createDeferred<void>();
    const resetAfterResponse = responseA.promise.then(() => (
      form.resetIfCurrent(capturedRevision)
    ));

    for (const [field, value] of resetCase.laterEdits) form.edit(field, value);
    responseA.resolve();

    assert.equal(await resetAfterResponse, false);
    for (const [field, value] of resetCase.laterEdits) {
      assert.equal(form.getState().values[field], value);
    }
  });
}

test("respuesta vigente limpia todos los campos, errores y visibilidad del registro", async () => {
  const form = createAuthRegistrationFormController();
  for (const [field, value] of Object.entries({
    firstName: "Nombre",
    lastName: "Apellido",
    birthDate: "1990-01-01",
    gender: "prefer_not_to_say",
    phoneNumber: "+56912345678",
    professionalTitle: "Preparador físico",
    contactEmail: "contacto@example.com",
    email: "acceso@example.com",
    password: "secreta123",
    confirmPassword: "secreta123",
  }) as Array<[keyof ReturnType<typeof form.getState>["values"], string]>) {
    form.edit(field, value);
  }
  form.setFieldError("register-contact-email", "error controlado");
  form.togglePasswordVisibility("password");
  form.togglePasswordVisibility("confirmPassword");
  const capturedRevision = form.captureRevision();
  const response = createDeferred<void>();
  const resetAfterResponse = response.promise.then(() => form.resetIfCurrent(capturedRevision));
  response.resolve();

  assert.equal(await resetAfterResponse, true);
  assert.deepEqual(Object.values(form.getState().values), Array(10).fill(""));
  assert.deepEqual(form.getState().fieldErrors, {});
  assert.equal(form.getState().showPassword, false);
  assert.equal(form.getState().showConfirmPassword, false);
});

test("copy público de signup es neutral y común a Usuario y Coach", () => {
  assert.equal(
    USER_REGISTRATION_CONFIRMATION_MESSAGE,
    "Si corresponde, completa la confirmación desde tu correo. También puedes iniciar sesión, recuperar tu contraseña o usar otro correo de acceso.",
  );
  assert.equal(COACH_REGISTRATION_CONFIRMATION_MESSAGE, USER_REGISTRATION_CONFIRMATION_MESSAGE);
  assert.doesNotMatch(
    USER_REGISTRATION_CONFIRMATION_MESSAGE,
    /existe|registrad[oa]|encontramos|enviad[oa]|cuenta creada|Usuario|Coach/i,
  );
});

test("Usuario autenticado sólo resuelve user_authorized con membresía Usuario", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  let userReads = 0;
  let coachReads = 0;
  let welcomeRequests = 0;
  const result = await controller.resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: "user-a",
    owner,
  }, createGateway({
    hasUserRegistration: async () => {
      userReads += 1;
      return true;
    },
    getCoachRegistration: async () => {
      coachReads += 1;
      return createCoachRecord();
    },
    requestWelcomeEmail: async () => {
      welcomeRequests += 1;
    },
  }));

  assert.deepEqual(result, {
    state: "user_authorized",
    requestedPortal: "usuario",
    userId: "user-a",
  });
  assert.equal(userReads, 1);
  assert.equal(coachReads, 0);
  assert.equal(welcomeRequests, 0, "login sólo autoriza y nunca solicita bienvenida");
});

test("Coach-only es rechazado del portal Usuario con el mensaje aprobado", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  const order: string[] = [];
  const result = await controller.resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: userA.userId,
    owner,
  }, createGateway({
    hasUserRegistration: async () => {
      order.push("user_lookup");
      return false;
    },
    getCoachRegistration: async () => {
      order.push("coach_lookup");
      return createCoachRecord();
    },
    signOut: async (reason) => {
      order.push(`sign_out:${reason}`);
      return "signed_out";
    },
  }));

  assert.deepEqual(order, ["user_lookup", "sign_out:user_registration_required"]);
  assert.deepEqual(result, {
    state: "user_registration_required",
    requestedPortal: "usuario",
    message: USER_REGISTRATION_REQUIRED_MESSAGE,
  });
});

test("metadata, email, parámetros, roles y profiles no conceden Usuario", async () => {
  const untrustedCases = [
    { identity: { email: "usuario@organizatech.cl" }, input: {} },
    { identity: { user_metadata: { role: "usuario" } }, input: {} },
    { identity: { app_metadata: { role: "usuario" }, claims: { usuario: true } }, input: {} },
    { identity: {}, input: { accountType: "usuario" } },
    { identity: {}, input: { query: { tipo: "usuario" }, searchParams: "tipo=usuario" } },
    { identity: { roles: ["usuario", "admin"] }, input: { profileExists: true } },
  ] as const;
  assert.equal(untrustedCases.length, 6, "Usuario fija seis clases de señales no autoritativas");

  for (const [index, candidate] of untrustedCases.entries()) {
    const controller = createMultiportalAuthController<TestAuthState>();
    const { owner } = beginCurrentResolution();
    let userReads = 0;
    let signOuts = 0;
    const result = await controller.resolvePortalAccess({
      requestedPortal: "usuario",
      expectedUserId: userA.userId,
      owner,
      ...candidate.input,
    } as Parameters<typeof controller.resolvePortalAccess>[0], createGateway({
      getCurrentIdentity: async () => ({
        ...userA,
        ...candidate.identity,
      } as AuthenticatedPortalIdentity<TestAuthState>),
      hasUserRegistration: async () => {
        userReads += 1;
        return false;
      },
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }));

    assert.equal(
      result.state,
      "user_registration_required",
      `[AUTH-COACH-01.USER.untrusted-signals-runtime.${index}] señal cliente no concede Usuario`,
    );
    assert.equal(userReads, 1);
    assert.equal(signOuts, 1);
  }
});

test("misma identidad Usuario + Coach resuelve coach_authorized", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  const result = await controller.resolvePortalAccess({
    requestedPortal: "coach",
    expectedUserId: "user-a",
    owner,
  }, createGateway({
    getCoachRegistration: async (userId) => userId === "user-a" ? createCoachRecord(userId) : null,
  }));

  assert.deepEqual(result, {
    state: "coach_authorized",
    requestedPortal: "coach",
    userId: "user-a",
    coach: createCoachRecord(),
  });
});

test("Usuario sin registro Coach se autentica, se consulta y luego se cierra la sesión", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  let sessionOpen = true;
  const order: string[] = [];
  const result = await controller.resolvePortalAccess({
    requestedPortal: "coach",
    expectedUserId: "user-a",
    owner,
  }, createGateway({
    getCurrentIdentity: async () => {
      order.push("authenticated");
      return userA;
    },
    getCoachRegistration: async () => {
      order.push("coach_lookup");
      return null;
    },
    signOut: async (reason) => {
      order.push(`sign_out:${reason}`);
      sessionOpen = false;
      return "signed_out";
    },
  }));

  assert.deepEqual(order, [
    "authenticated",
    "coach_lookup",
    "sign_out:coach_registration_required",
  ]);
  assert.equal(sessionOpen, false);
  assert.deepEqual(result, {
    state: "coach_registration_required",
    requestedPortal: "coach",
    message: COACH_REGISTRATION_REQUIRED_MESSAGE,
  });
});

test("correo, metadata, accountType, query, roles y privilegios nunca reemplazan la fila Coach", async () => {
  const untrustedSignalCases: ReadonlyArray<{
    name: string;
    identity: Record<string, unknown>;
    input: Record<string, unknown>;
    expectedFailure: string;
  }> = [
    {
      name: "correo y dominio",
      identity: { email: "coach@organizatech.cl" },
      input: {},
      expectedFailure: "[AUTH-COACH-01.E7.domain-runtime]",
    },
    {
      name: "user_metadata",
      identity: { user_metadata: { role: "coach", is_coach: true } },
      input: {},
      expectedFailure: "[AUTH-COACH-01.E7.untrusted-signals-runtime]",
    },
    {
      name: "app_metadata y claims",
      identity: {
        app_metadata: { role: "coach", account_type: "coach" },
        claims: { coach: true },
      },
      input: {},
      expectedFailure: "[AUTH-COACH-01.E7.untrusted-signals-runtime]",
    },
    {
      name: "accountType cliente",
      identity: {},
      input: { accountType: "coach" },
      expectedFailure: "[AUTH-COACH-01.E7.untrusted-signals-runtime]",
    },
    {
      name: "query params cliente",
      identity: {},
      input: {
        query: { tipo: "coach", role: "admin" },
        searchParams: new URLSearchParams("portal=coach&role=admin"),
      },
      expectedFailure: "[AUTH-COACH-01.E7.untrusted-signals-runtime]",
    },
    {
      name: "roles y privilegios cliente",
      identity: { role: "coach", roles: ["coach", "admin"], privileges: ["coach:access"] },
      input: { role: "coach", roles: ["coach"], privileges: ["coach:access"] },
      expectedFailure: "[AUTH-COACH-01.E7.untrusted-signals-runtime]",
    },
  ];
  assert.equal(untrustedSignalCases.length, 6, "E7 fija las seis clases de señales no autoritativas");

  for (const candidate of untrustedSignalCases) {
    const controller = createMultiportalAuthController<TestAuthState>();
    const { owner } = beginCurrentResolution();
    const manipulatedIdentity = {
      ...userA,
      ...candidate.identity,
    } as unknown as AuthenticatedPortalIdentity<TestAuthState>;
    let coachReads = 0;
    let signOuts = 0;
    const request = {
      requestedPortal: "coach",
      expectedUserId: "user-a",
      owner,
      ...candidate.input,
    } as Parameters<typeof controller.resolvePortalAccess>[0];
    const result = await controller.resolvePortalAccess(request, createGateway({
      getCurrentIdentity: async () => manipulatedIdentity,
      getCoachRegistration: async () => {
        coachReads += 1;
        return null;
      },
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }));

    assert.equal(
      result.state,
      "coach_registration_required",
      `${candidate.expectedFailure} ${candidate.name} no puede conceder acceso Coach`,
    );
    assert.equal(coachReads, 1, `${candidate.name} no evita la consulta Coach`);
    assert.equal(signOuts, 1, `${candidate.name} termina en rechazo seguro`);
  }
});

test("excepción autoritativa no filtra detalles, falla cerrada y conserva la sesión", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  let signedOut = false;
  const result = await controller.resolvePortalAccess({
    requestedPortal: "coach",
    expectedUserId: "user-a",
    owner,
  }, createGateway({
    getCoachRegistration: async () => {
      throw new Error("relation coach_registrations leaked-detail does not exist");
    },
    signOut: async () => {
      signedOut = true;
      return "signed_out";
    },
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(JSON.stringify(result).includes("leaked-detail"), false);
  assert.equal(signedOut, false, "una excepción no demuestra identidad o membresía inválida");
});

test("fallo transitorio de portal conserva la sesión y queda marcado para reintentar", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  let signOuts = 0;
  const result = await controller.resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: userA.userId,
    owner,
  }, createGateway({
    getCurrentIdentity: async () => {
      throw new Error("repository", {
        cause: Object.assign(new Error("Failed to fetch"), { status: 503 }),
      });
    },
    signOut: async () => {
      signOuts += 1;
      return "signed_out";
    },
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "usuario",
    message: MULTIPORTAL_AUTH_RETRYABLE_MESSAGE,
    retryable: true,
  });
  assert.equal(signOuts, 0);
});

test("ausencia autoritativa de identidad mantiene el rechazo con signOut", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  let signOuts = 0;
  const result = await controller.resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: userA.userId,
    owner,
  }, createGateway({
    getCurrentIdentity: async () => null,
    signOut: async () => {
      signOuts += 1;
      return "signed_out";
    },
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "usuario",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(signOuts, 1);
});

test("no declara rechazo Coach seguro si signOut falla", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  const result = await controller.resolvePortalAccess({
    requestedPortal: "coach",
    expectedUserId: "user-a",
    owner,
  }, createGateway({
    getCoachRegistration: async () => null,
    signOut: async () => { throw new Error("signout failed"); },
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
});

const staleLookupVariants = [
  "coach_inexistente",
  "gateway_error",
  "identidad_cruzada",
  "coach_exitoso_tardio",
] as const;
const EXPECTED_STALE_LOOKUP_VARIANT_COUNT = 4;

assert.equal(
  staleLookupVariants.length,
  EXPECTED_STALE_LOOKUP_VARIANT_COUNT,
  "AUTH-COACH-01 conserva las cuatro variantes stale A→SIGNED_OUT→B",
);

for (const variant of staleLookupVariants) {
  test(`A→SIGNED_OUT→B descarta sin efectos el lookup tardío: ${variant}`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const owners = createPortalResolutionOwnerController();
    let activeUserId: string | null = userA.userId;
    owners.acceptIdentity(userA.userId);
    const ownerA = owners.begin(userA.userId);
    const lookupStarted = createDeferred<void>();
    const identityLookup = createDeferred<AuthenticatedPortalIdentity<TestAuthState> | null>();
    const coachLookup = createDeferred<CoachRegistrationRecord | null>();
    const signOutAttempts: string[] = [];
    const writes: string[] = [];
    const publications = {
      navigation: 0,
      messages: 0,
      states: 0,
      sessionMutations: 0,
      accessGrants: 0,
    };

    const gateway = createGateway({
      async getCurrentIdentity(expectedUserId) {
        if (expectedUserId === userA.userId && variant === "identidad_cruzada") {
          lookupStarted.resolve();
          return identityLookup.promise;
        }
        if (expectedUserId !== activeUserId) return null;
        return expectedUserId === userA.userId ? userA : userB;
      },
      async getCoachRegistration(expectedUserId) {
        if (expectedUserId === userA.userId) {
          lookupStarted.resolve();
          return coachLookup.promise;
        }
        return expectedUserId === userB.userId ? createCoachRecord(userB.userId) : null;
      },
      async signOut(_reason, owner) {
        const expectedUserId = owner.expectedUserId;
        assert.ok(expectedUserId);
        signOutAttempts.push(expectedUserId);
        if (!owner.isCurrent() || activeUserId !== expectedUserId) return "stale";
        activeUserId = null;
        return "signed_out";
      },
    });

    const resolutionA = controller.resolvePortalAccess({
      requestedPortal: "coach",
      expectedUserId: userA.userId,
      owner: ownerA,
    }, gateway);
    await lookupStarted.promise;

    activeUserId = null;
    owners.invalidate();
    activeUserId = userB.userId;
    owners.acceptIdentity(userB.userId);
    const ownerB = owners.begin(userB.userId);

    switch (variant) {
      case "coach_inexistente":
        coachLookup.resolve(null);
        break;
      case "gateway_error":
        coachLookup.reject(new Error("lookup A tardío"));
        break;
      case "identidad_cruzada":
        identityLookup.resolve(userB);
        break;
      case "coach_exitoso_tardio":
        coachLookup.resolve(createCoachRecord());
        break;
    }

    const resultA = await resolutionA;
    if (resultA.state !== "stale" && ownerA.isCurrent()) {
      publications.states += 1;
      if (resultA.state === "user_authorized" || resultA.state === "coach_authorized") {
        publications.navigation += 1;
        publications.sessionMutations += 1;
        publications.accessGrants += 1;
      } else {
        publications.messages += 1;
      }
    }

    assert.deepEqual(resultA, { state: "stale", requestedPortal: "coach" });
    assert.deepEqual(signOutAttempts, [], "A stale no debe invocar siquiera el puerto signOut");
    assert.deepEqual(writes, [], "A stale no debe iniciar writes");
    assert.deepEqual(publications, {
      navigation: 0,
      messages: 0,
      states: 0,
      sessionMutations: 0,
      accessGrants: 0,
    });
    assert.equal(activeUserId, userB.userId, "B conserva su sesión vigente");

    const resultB = await controller.resolvePortalAccess({
      requestedPortal: "coach",
      expectedUserId: userB.userId,
      owner: ownerB,
    }, gateway);
    assert.deepEqual(resultB, {
      state: "coach_authorized",
      requestedPortal: "coach",
      userId: userB.userId,
      coach: createCoachRecord(userB.userId),
    });
    assert.equal(ownerB.isCurrent(), true, "la invalidación de A no bloquea a B");
    assert.equal(activeUserId, userB.userId);
  });
}

test("E7 · dominios generados no conceden Coach sin fila autoritativa", async () => {
  const generatedEmails = Array.from({ length: 7 }, (_, index) => (
    `candidate-${index}-${(index * 7919).toString(36)}@domain-${index}.example`
  ));
  for (const [index, email] of generatedEmails.entries()) {
    const userId = `generated-user-${index}-${(index * 104729).toString(36)}`;
    const owners = createPortalResolutionOwnerController();
    owners.acceptIdentity(userId);
    const owner = owners.begin(userId);
    let signOuts = 0;
    const result = await createMultiportalAuthController<TestAuthState>().resolvePortalAccess({
      requestedPortal: "coach",
      expectedUserId: userId,
      owner,
    }, createGateway({
      getCurrentIdentity: async () => ({
        userId,
        email,
        authState: { sessionId: `session-${index}` },
      }),
      getCoachRegistration: async () => null,
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }));
    assert.equal(
      result.state,
      "coach_registration_required",
      "[AUTH-COACH-01.E7.domain-runtime] ningún dominio concede Coach sin fila backend",
    );
    assert.equal(signOuts, 1);
  }
});

test("E8 · ID hardcodeado e IDs generados no conceden Coach mediante allowlist local", async () => {
  const generatedUserIds = [
    "usuario-autorizado",
    ...Array.from({ length: 7 }, (_, index) => (
      `${(index + 1).toString(16).padStart(8, "0")}-1111-4111-8111-${(index * 65537 + 17).toString(16).padStart(12, "0")}`
    )),
  ];
  assert.equal(generatedUserIds.length, 8, "E8 fija el ID hardcodeado y siete IDs opacos");
  for (const [index, userId] of generatedUserIds.entries()) {
    const owners = createPortalResolutionOwnerController();
    owners.acceptIdentity(userId);
    const owner = owners.begin(userId);
    const result = await createMultiportalAuthController<TestAuthState>().resolvePortalAccess({
      requestedPortal: "coach",
      expectedUserId: userId,
      owner,
    }, createGateway({
      getCurrentIdentity: async () => ({
        userId,
        email: `generated-${index}@example.net`,
        authState: { sessionId: `session-${index}` },
      }),
      getCoachRegistration: async () => null,
      signOut: async () => "signed_out",
    }));
    assert.equal(
      result.state,
      "coach_registration_required",
      "[AUTH-COACH-01.E8.user-id-runtime] ningún ID local concede Coach sin fila backend",
    );
  }
});

for (const order of ["event_before_resolution", "resolution_before_event"] as const) {
  test(`mensaje Coach se publica una vez con orden ${order}`, () => {
    const notices = createSinglePublicationNoticeController<"coach_registration_required">();
    const publications: Array<{ message: string; tone: "error" }> = [];
    const consumeEvent = () => {
      const reason = notices.consumeEvent();
      publications.push({
        message: reason ? COACH_REGISTRATION_REQUIRED_MESSAGE : "Sesión cerrada correctamente.",
        tone: "error",
      });
    };
    const settle = () => {
      const reason = notices.settle();
      if (reason) publications.push({ message: COACH_REGISTRATION_REQUIRED_MESSAGE, tone: "error" });
    };

    notices.begin("coach_registration_required");
    if (order === "event_before_resolution") {
      consumeEvent();
      settle();
    } else {
      settle();
      consumeEvent();
    }

    assert.deepEqual(publications, [{
      message: COACH_REGISTRATION_REQUIRED_MESSAGE,
      tone: "error",
    }]);
  });
}

for (const order of ["event_before_resolution", "resolution_before_event"] as const) {
  test(`mensaje Usuario se publica exactamente una vez con orden ${order}`, () => {
    const notices = createSinglePublicationNoticeController<"user_registration_required">();
    const publications: string[] = [];
    const consumeEvent = () => {
      const reason = notices.consumeEvent();
      if (reason) publications.push(USER_REGISTRATION_REQUIRED_MESSAGE);
    };
    const settle = () => {
      const reason = notices.settle();
      if (reason) publications.push(USER_REGISTRATION_REQUIRED_MESSAGE);
    };

    notices.begin("user_registration_required");
    if (order === "event_before_resolution") {
      consumeEvent();
      settle();
    } else {
      settle();
      consumeEvent();
    }

    assert.deepEqual(publications, [USER_REGISTRATION_REQUIRED_MESSAGE]);
  });
}

test("fallo de signOut conserva el rechazo genérico y no declara cierre Coach seguro", () => {
  const notices = createSinglePublicationNoticeController<"coach_registration_required">();
  notices.begin("coach_registration_required");
  notices.fail();

  const failedReason = notices.settle();
  const message = failedReason ? MULTIPORTAL_AUTH_ERROR_MESSAGE : null;
  assert.equal(message, MULTIPORTAL_AUTH_ERROR_MESSAGE);
  assert.equal(notices.consumeEvent(), null, "el notice fallido y resuelto queda consumido");
});

const staleRegistrationAwaitPoints = [
  "current_identity",
  "isolated_sign_up",
  "coach_lookup",
  "welcome_email",
  "session_activation",
] as const;

for (const awaitPoint of staleRegistrationAwaitPoints) {
  test(`registro Coach separado A→B queda stale sin activar sesión en ${awaitPoint}`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const owners = createCoachRegistrationOwnerController();
    const ownerA = owners.begin();
    const paused = createDeferred<void>();
    const release = createDeferred<void>();
    const effects = {
      signUps: 0,
      lookups: 0,
      activations: 0,
      sessionApplications: 0,
    };
    const pause = async (point: typeof awaitPoint) => {
      if (point !== awaitPoint) return;
      paused.resolve();
      await release.promise;
    };
    const gateway = createGateway({
      async getCurrentIdentity() {
        await pause("current_identity");
        return null;
      },
      async signUpForCoachRegistration() {
        effects.signUps += 1;
        await pause("isolated_sign_up");
        return { kind: "authenticated", identity: userA };
      },
      async getCoachRegistration() {
        effects.lookups += 1;
        await pause("coach_lookup");
        return createCoachRecord();
      },
      async requestWelcomeEmail() {
        await pause("welcome_email");
      },
      async activateCoachRegistrationIdentity(identity, owner) {
        effects.activations += 1;
        await pause("session_activation");
        if (!owner.isCurrent()) return null;
        effects.sessionApplications += 1;
        return identity;
      },
    });

    const pendingA = controller.registerCoach(coachInput, ownerA, gateway);
    await paused.promise;
    owners.acceptIdentity(userB.userId);
    release.resolve();

    assert.deepEqual(await pendingA, { state: "stale", requestedPortal: "coach" });
    assert.equal(effects.sessionApplications, 0);
    if (awaitPoint !== "session_activation") assert.equal(effects.activations, 0);
  });
}

test("Coach-only no obtiene Usuario cuando el backend exige identidad separada", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentUserRegistration();
  let userWrites = 0;
  const result = await controller.registerUser(coachInput.auth, owner, createGateway({
    hasUserRegistration: async () => false,
    createUserRegistration: async () => {
      userWrites += 1;
      throw new Error("user registration requires a separate auth identity");
    },
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "usuario",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(userWrites, 1);
});

test("Usuario existente sin sesión reutiliza Auth y no crea segunda identidad", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentUserRegistration(null);
  let signups = 0;
  const result = await controller.registerUser(coachInput.auth, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForUserRegistration: async () => ({ kind: "authenticated", identity: userA }),
    signUpForUserRegistration: async () => {
      signups += 1;
      return { kind: "authenticated", identity: userA };
    },
    hasUserRegistration: async () => false,
  }));

  assert.equal(result.state, "user_authorized");
  assert.equal(signups, 0);
});

test("Registro Usuario con confirmación pendiente no concede membresía sin sesión", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentUserRegistration(null);
  let writes = 0;
  let welcomeRequests = 0;
  const order: string[] = [];
  let signupPayload: unknown;
  const result = await controller.registerUser(coachInput.auth, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForUserRegistration: async () => {
      order.push("sign_in_miss");
      return { kind: "invalid_credentials" };
    },
    signUpForUserRegistration: async (payload) => {
      order.push("sign_up");
      signupPayload = payload;
      return { kind: "confirmation_required" };
    },
    createUserRegistration: async () => {
      writes += 1;
      assert.fail("sin sesión autenticada no se crea membresía Usuario");
    },
    requestWelcomeEmail: async () => {
      welcomeRequests += 1;
    },
  }));

  assert.deepEqual(result, {
    state: "user_confirmation_required",
    requestedPortal: "usuario",
    message: USER_REGISTRATION_CONFIRMATION_MESSAGE,
  });
  assert.deepEqual(order, ["sign_in_miss", "sign_up"]);
  assert.deepEqual(signupPayload, coachInput.auth);
  assert.equal(writes, 0);
  assert.equal(welcomeRequests, 0);
});

test("existing_identity y confirmation_required Usuario son públicamente indistinguibles", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const outcomes = [];
  const visibleEffects = [];

  for (const kind of ["confirmation_required", "existing_identity"] as const) {
    const { owner } = beginCurrentUserRegistration(null);
    const effects = { membershipReads: 0, creates: 0, activations: 0, signOuts: 0 };
    const result = await controller.registerUser(coachInput.auth, owner, createGateway({
      getCurrentIdentity: async () => null,
      signInForUserRegistration: async () => ({ kind: "invalid_credentials" }),
      signUpForUserRegistration: async () => ({ kind }),
      hasUserRegistration: async () => {
        effects.membershipReads += 1;
        return false;
      },
      createUserRegistration: async () => {
        effects.creates += 1;
        assert.fail("un signup sin sesión no crea membresía Usuario");
      },
      activateUserRegistrationIdentity: async (identity) => {
        effects.activations += 1;
        return identity;
      },
      signOut: async () => {
        effects.signOuts += 1;
        return "signed_out";
      },
    }));
    outcomes.push(result);
    visibleEffects.push(effects);
  }

  assert.deepEqual(outcomes[0], {
    state: "user_confirmation_required",
    requestedPortal: "usuario",
    message: USER_REGISTRATION_CONFIRMATION_MESSAGE,
  });
  assert.deepEqual(outcomes[1], outcomes[0]);
  assert.deepEqual(visibleEffects, [
    { membershipReads: 0, creates: 0, activations: 0, signOuts: 0 },
    { membershipReads: 0, creates: 0, activations: 0, signOuts: 0 },
  ]);
});

test("repetir Registro Usuario es idempotente y no reescribe la membresía", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentUserRegistration();
  let writes = 0;
  const welcomeUserIds: string[] = [];
  const result = await controller.registerUser(coachInput.auth, owner, createGateway({
    hasUserRegistration: async () => true,
    createUserRegistration: async () => {
      writes += 1;
      assert.fail("membresía Usuario existente no debe reescribirse");
    },
    requestWelcomeEmail: async (expectedUserId) => {
      welcomeUserIds.push(expectedUserId);
      throw new Error("proveedor no disponible");
    },
  }));

  assert.equal(result.state, "user_authorized");
  assert.equal(writes, 0);
  assert.deepEqual(welcomeUserIds, [userA.userId]);
});

const staleUserRegistrationAwaitPoints = [
  "current_identity",
  "isolated_sign_in",
  "isolated_sign_up",
  "user_lookup",
  "atomic_insert",
  "welcome_email",
  "session_activation",
] as const;
const EXPECTED_STALE_USER_REGISTRATION_AWAIT_POINT_COUNT = 7;
assert.equal(
  staleUserRegistrationAwaitPoints.length,
  EXPECTED_STALE_USER_REGISTRATION_AWAIT_POINT_COUNT,
  "Registro Usuario fija los siete límites async A→SIGNED_OUT→B",
);

for (const awaitPoint of staleUserRegistrationAwaitPoints) {
  test(`Registro Usuario A→SIGNED_OUT→B queda stale en ${awaitPoint}`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const owners = createUserRegistrationOwnerController();
    if (["user_lookup", "atomic_insert", "welcome_email", "session_activation"].includes(awaitPoint)) {
      owners.acceptIdentity(userA.userId);
    }
    const ownerA = owners.begin();
    const paused = createDeferred<void>();
    const release = createDeferred<void>();
    const effects = {
      signOuts: 0,
      userWritesA: 0,
      userWritesB: 0,
      navigation: 0,
      messages: 0,
      authorizations: 0,
      sessionApplications: 0,
    };
    const pause = async (point: typeof awaitPoint) => {
      if (point !== awaitPoint) return;
      paused.resolve();
      await release.promise;
    };
    const gateway = createGateway({
      async getCurrentIdentity() {
        await pause("current_identity");
        return ["user_lookup", "atomic_insert", "welcome_email", "session_activation"].includes(awaitPoint)
          ? userA
          : null;
      },
      async signInForUserRegistration() {
        await pause("isolated_sign_in");
        return awaitPoint === "isolated_sign_up"
          ? { kind: "invalid_credentials" as const }
          : { kind: "authenticated" as const, identity: userA };
      },
      async signUpForUserRegistration() {
        await pause("isolated_sign_up");
        return { kind: "authenticated", identity: userA };
      },
      async hasUserRegistration() {
        await pause("user_lookup");
        return ["welcome_email", "session_activation"].includes(awaitPoint);
      },
      async createUserRegistration(expectedUserId) {
        if (expectedUserId === userA.userId) effects.userWritesA += 1;
        else effects.userWritesB += 1;
        await pause("atomic_insert");
        return { userId: expectedUserId };
      },
      async requestWelcomeEmail() {
        await pause("welcome_email");
      },
      async activateUserRegistrationIdentity(identity, owner) {
        await pause("session_activation");
        if (!owner.isCurrent()) return null;
        effects.sessionApplications += 1;
        return identity;
      },
      async signOut() {
        effects.signOuts += 1;
        return "signed_out";
      },
    });

    const pendingA = controller.registerUser(coachInput.auth, ownerA, gateway);
    await paused.promise;
    if (awaitPoint === "current_identity" || awaitPoint === "isolated_sign_in") {
      owners.invalidate();
    }
    owners.acceptIdentity(userB.userId);
    release.resolve();
    const resultA = await pendingA;
    if (ownerA.isCurrent() && resultA.state !== "stale") {
      effects.messages += resultA.state === "error" ? 1 : 0;
      effects.navigation += resultA.state === "user_authorized" ? 1 : 0;
      effects.authorizations += resultA.state === "user_authorized" ? 1 : 0;
    }

    assert.deepEqual(resultA, { state: "stale", requestedPortal: "usuario" });
    assert.equal(effects.signOuts, 0);
    assert.equal(effects.userWritesB, 0, "datos A nunca se escriben bajo B");
    assert.equal(effects.navigation, 0);
    assert.equal(effects.messages, 0);
    assert.equal(effects.authorizations, 0);
    assert.equal(effects.sessionApplications, 0);
    if (awaitPoint !== "atomic_insert") {
      assert.equal(effects.userWritesA, 0, "A stale no inicia un write posterior");
    }
  });
}

/* AUTH-SEPARATE-01 supersedes the historical shared-identity registration
 * scenarios below. They remain here temporarily as readable evidence of the
 * behavior this change intentionally removes; executable replacements follow
 * the block and assert the independent-identity model.
const duplicateCoachAuthenticationCases = [
  { name: "sesión activa del mismo correo", hasActiveSession: true },
  { name: "sin sesión y contraseña correcta", hasActiveSession: false },
] as const;
const EXPECTED_DUPLICATE_COACH_AUTHENTICATION_CASE_COUNT = 2;

assert.equal(
  duplicateCoachAuthenticationCases.length,
  EXPECTED_DUPLICATE_COACH_AUTHENTICATION_CASE_COUNT,
  "AC-039 fija las dos rutas de autenticación autoritativa antes del rechazo",
);

for (const authenticationCase of duplicateCoachAuthenticationCases) {
  test(`AC-039 rechaza Crear cuenta Coach duplicado con ${authenticationCase.name}`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const { owner } = beginCurrentRegistration(
      authenticationCase.hasActiveSession ? userA.userId : null,
    );
    const existingCoach = {
      ...createCoachRecord(),
      professionalTitle: "Título anterior preservado",
    };
    const existingCoachBytes = JSON.stringify(existingCoach);
    const duplicateInput: CoachRegistrationPreparationPayload = {
      ...coachInput,
      registration: {
        ...coachInput.registration,
        professional_title: "Título nuevo descartado",
      },
    };
    const order: string[] = [];
    const effects = {
      identityReads: 0,
      signIns: 0,
      signUps: 0,
      lookups: 0,
      creates: 0,
      activations: 0,
      signOuts: 0,
      identitySwitchSignOuts: 0,
      authorizedPublications: 0,
      navigation: 0,
    };

    const result = await controller.registerCoach(duplicateInput, owner, createGateway({
      getCurrentIdentity: async () => {
        effects.identityReads += 1;
        order.push("current_identity");
        return authenticationCase.hasActiveSession ? userA : null;
      },
      signInForCoachRegistration: async () => {
        effects.signIns += 1;
        order.push("password_sign_in");
        return { kind: "authenticated", identity: userA };
      },
      signUpForCoachRegistration: async () => {
        effects.signUps += 1;
        order.push("sign_up");
        return { kind: "authenticated", identity: userA };
      },
      getCoachRegistration: async (expectedUserId) => {
        effects.lookups += 1;
        order.push("own_coach_lookup");
        assert.equal(expectedUserId, userA.userId);
        return existingCoach;
      },
      createCoachRegistration: async (payload, expectedUserId) => {
        effects.creates += 1;
        order.push("coach_create");
        return {
          userId: expectedUserId,
          createdAt: "2026-08-19T12:00:00.000Z",
          firstName: payload.first_name,
          lastName: payload.last_name,
          birthDate: payload.birth_date,
          gender: payload.gender,
          phoneNumber: payload.phone_number,
          professionalTitle: payload.professional_title,
        };
      },
      activateCoachRegistrationIdentity: async (identity) => {
        effects.activations += 1;
        order.push("coach_activation");
        return identity;
      },
      signOut: async () => {
        effects.signOuts += 1;
        order.push("sign_out");
        return "signed_out";
      },
      signOutForCoachIdentitySwitch: async () => {
        effects.identitySwitchSignOuts += 1;
        order.push("identity_switch_sign_out");
        return "signed_out";
      },
    }));

    if (result.state === "coach_authorized") {
      effects.authorizedPublications += 1;
      effects.navigation += 1;
    }

    assert.deepEqual(result, {
      state: "error",
      requestedPortal: "coach",
      field: "register-email",
      message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
    });
    assert.deepEqual(order, authenticationCase.hasActiveSession
      ? ["current_identity", "own_coach_lookup"]
      : ["current_identity", "password_sign_in", "own_coach_lookup"]);
    assert.equal(effects.identityReads, 1);
    assert.equal(effects.signIns, authenticationCase.hasActiveSession ? 0 : 1);
    assert.equal(effects.lookups, 1);
    assert.equal(effects.signUps, 0, "el duplicado autenticado no emite correo Auth");
    assert.equal(effects.creates, 0);
    assert.equal(effects.activations, 0);
    assert.equal(effects.signOuts, 0);
    assert.equal(effects.identitySwitchSignOuts, 0);
    assert.equal(effects.authorizedPublications, 0);
    assert.equal(effects.navigation, 0);
    assert.equal(JSON.stringify(existingCoach), existingCoachBytes);
    assert.equal(existingCoach.professionalTitle, "Título anterior preservado");
    assert.equal("coach" in result, false);
    assert.equal("authState" in result, false);
    assert.equal("userId" in result, false);
    assert.equal(JSON.stringify(result).includes("Título nuevo descartado"), false);
  });
}

test("Usuario existente agrega Coach sobre el mismo correo y auth.uid()", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration();
  let signIns = 0;
  let signups = 0;
  let coachLookups = 0;
  let coachWrites = 0;
  let activations = 0;
  let signOuts = 0;
  let writeUserId = "";
  let userMembershipWrites = 0;
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    signInForCoachRegistration: async () => {
      signIns += 1;
      return { kind: "authenticated", identity: userA };
    },
    signUpForCoachRegistration: async () => {
      signups += 1;
      return { kind: "authenticated", identity: userA };
    },
    getCoachRegistration: async () => {
      coachLookups += 1;
      return null;
    },
    createCoachRegistration: async (payload, expectedUserId) => {
      coachWrites += 1;
      writeUserId = expectedUserId;
      assert.deepEqual(payload, coachInput.registration);
      return {
        userId: expectedUserId,
        createdAt: "2026-08-16T12:00:00.000Z",
        firstName: payload.first_name,
        lastName: payload.last_name,
        birthDate: payload.birth_date,
        gender: payload.gender,
        phoneNumber: payload.phone_number,
        professionalTitle: payload.professional_title,
      };
    },
    activateCoachRegistrationIdentity: async (identity) => {
      activations += 1;
      return identity;
    },
    signOut: async () => {
      signOuts += 1;
      return "signed_out";
    },
    createUserRegistration: async () => {
      userMembershipWrites += 1;
      assert.fail("Registro Coach no puede crear membresía Usuario");
    },
  }));

  assert.equal(signIns, 0);
  assert.equal(signups, 0);
  assert.equal(coachLookups, 1);
  assert.equal(coachWrites, 1);
  assert.equal(activations, 1);
  assert.equal(signOuts, 0);
  assert.equal(writeUserId, "user-a");
  assert.equal(userMembershipWrites, 0);
  assert.deepEqual(result, {
    state: "coach_authorized",
    requestedPortal: "coach",
    userId: "user-a",
    coach: createCoachRecord(),
    authState: { sessionId: "session-a" },
  });
});

test("Usuario existente sin sesión se autentica y no crea segunda identidad", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  let signIns = 0;
  let signups = 0;
  let coachLookups = 0;
  let coachWrites = 0;
  let activations = 0;
  let signOuts = 0;
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => {
      signIns += 1;
      return { kind: "authenticated", identity: userA };
    },
    signUpForCoachRegistration: async () => {
      signups += 1;
      return { kind: "authenticated", identity: userA };
    },
    getCoachRegistration: async () => {
      coachLookups += 1;
      return null;
    },
    createCoachRegistration: async (_payload, expectedUserId) => {
      coachWrites += 1;
      return createCoachRecord(expectedUserId);
    },
    activateCoachRegistrationIdentity: async (identity) => {
      activations += 1;
      return identity;
    },
    signOut: async () => {
      signOuts += 1;
      return "signed_out";
    },
  }));

  assert.equal(result.state, "coach_authorized");
  assert.equal(signIns, 1);
  assert.equal(signups, 0);
  assert.equal(coachLookups, 1);
  assert.equal(coachWrites, 1);
  assert.equal(activations, 1);
  assert.equal(signOuts, 0);
  if (result.state === "coach_authorized") assert.equal(result.userId, "user-a");
});

test("cuenta Coach nueva sin sesión conserva confirmación y no concede acceso por metadata", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  let writes = 0;
  let signups = 0;
  let coachLookups = 0;
  let activations = 0;
  let signOuts = 0;
  let signupPayload: unknown;
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => ({ kind: "invalid_credentials" }),
    signUpForCoachRegistration: async (payload) => {
      signups += 1;
      signupPayload = payload;
      return { kind: "confirmation_required" };
    },
    getCoachRegistration: async () => {
      coachLookups += 1;
      return null;
    },
    createCoachRegistration: async () => {
      writes += 1;
      assert.fail("no debe escribir sin auth.uid() autenticado");
    },
    activateCoachRegistrationIdentity: async (identity) => {
      activations += 1;
      return identity;
    },
    signOut: async () => {
      signOuts += 1;
      return "signed_out";
    },
  }));

  assert.deepEqual(result, {
    state: "coach_confirmation_required",
    requestedPortal: "coach",
    message: COACH_REGISTRATION_CONFIRMATION_MESSAGE,
  });
  assert.equal(JSON.stringify(result).includes(MULTIPORTAL_AUTH_ERROR_MESSAGE), false);
  assert.equal(signups, 1);
  assert.equal(coachLookups, 0);
  assert.equal(writes, 0);
  assert.equal(activations, 0);
  assert.equal(signOuts, 0);
  assert.deepEqual(signupPayload, coachInput);
});

test("cuenta Coach nueva con sesión crea la fila sólo después de Auth", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  const order: string[] = [];
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => {
      order.push("sign_in_miss");
      return { kind: "invalid_credentials" };
    },
    signUpForCoachRegistration: async () => {
      order.push("sign_up_authenticated");
      return { kind: "authenticated", identity: userA };
    },
    createCoachRegistration: async (payload, expectedUserId) => {
      order.push(`coach_insert:${expectedUserId}`);
      return {
        userId: expectedUserId,
        createdAt: "2026-08-16T12:00:00.000Z",
        firstName: payload.first_name,
        lastName: payload.last_name,
        birthDate: payload.birth_date,
        gender: payload.gender,
        phoneNumber: payload.phone_number,
        professionalTitle: payload.professional_title,
      };
    },
  }));

  assert.deepEqual(order, [
    "sign_in_miss",
    "sign_up_authenticated",
    "coach_insert:user-a",
  ]);
  assert.equal(result.state, "coach_authorized");
});

test("sesión A + formulario Coach B exige cambio tipado antes de lookup o write", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration();
  let coachLookups = 0;
  let writes = 0;
  let activations = 0;
  const result = await controller.registerCoach({
    ...coachInput,
    auth: { ...coachInput.auth, email: userB.email! },
  }, owner, createGateway({
    getCoachRegistration: async () => {
      coachLookups += 1;
      return createCoachRecord(userA.userId);
    },
    createCoachRegistration: async () => {
      writes += 1;
      assert.fail("write inesperado");
    },
    activateCoachRegistrationIdentity: async (identity) => {
      activations += 1;
      return identity;
    },
  }));

  assert.deepEqual(result, {
    state: "identity_switch_required",
    requestedPortal: "coach",
    message: COACH_REGISTRATION_IDENTITY_SWITCH_MESSAGE,
  });
  assert.equal(coachLookups, 0);
  assert.equal(writes, 0);
  assert.equal(activations, 0);
});

test("existing_identity Coach devuelve el copy ambiguo sin efectos autorizados", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  let signIns = 0;
  let signups = 0;
  let coachLookups = 0;
  let writes = 0;
  let activations = 0;
  let signOuts = 0;
  let authorizedPublications = 0;
  let navigation = 0;
  const result = await controller.registerCoach({
    ...coachInput,
    auth: { ...coachInput.auth, email: userB.email! },
  }, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => {
      signIns += 1;
      return { kind: "invalid_credentials" };
    },
    signUpForCoachRegistration: async () => {
      signups += 1;
      return { kind: "existing_identity" };
    },
    getCoachRegistration: async () => {
      coachLookups += 1;
      return null;
    },
    createCoachRegistration: async () => {
      writes += 1;
      assert.fail("una contraseña incorrecta no crea Coach");
    },
    activateCoachRegistrationIdentity: async (identity) => {
      activations += 1;
      return identity;
    },
    signOut: async () => {
      signOuts += 1;
      return "signed_out";
    },
  }));

  if (result.state === "coach_authorized") {
    authorizedPublications += 1;
    navigation += 1;
  }
  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "coach",
    message: REGISTRATION_EXISTING_IDENTITY_MESSAGE,
  });
  assert.equal(signIns, 1);
  assert.equal(signups, 1);
  assert.equal(coachLookups, 0);
  assert.equal(writes, 0);
  assert.equal(activations, 0);
  assert.equal(signOuts, 0);
  assert.equal(authorizedPublications, 0);
  assert.equal(navigation, 0);
  const publicMessage = result.state === "error" ? result.message : "";
  assert.equal(publicMessage.includes("ya está registrado"), false);
  assert.doesNotMatch(publicMessage, /correo enviado|cuenta creada|Usuario|Coach/i);
  assert.equal("coach" in result, false);
  assert.equal("authState" in result, false);
  assert.equal("userId" in result, false);
});

test("B existente con contraseña correcta crea y activa sólo la membresía Coach B", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  const inputB = createCoachInputB();
  const writes: string[] = [];
  const activations: string[] = [];
  const result = await controller.registerCoach(inputB, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => ({ kind: "authenticated", identity: userB }),
    getCoachRegistration: async (expectedUserId) => {
      assert.equal(expectedUserId, userB.userId);
      return null;
    },
    createCoachRegistration: async (payload, expectedUserId) => {
      writes.push(expectedUserId);
      return {
        userId: expectedUserId,
        createdAt: "2026-08-16T12:00:02.000Z",
        firstName: payload.first_name,
        lastName: payload.last_name,
        birthDate: payload.birth_date,
        gender: payload.gender,
        phoneNumber: payload.phone_number,
        professionalTitle: payload.professional_title,
      };
    },
    activateCoachRegistrationIdentity: async (identity) => {
      activations.push(identity.userId);
      return identity;
    },
  }));

  assert.equal(result.state, "coach_authorized");
  if (result.state === "coach_authorized") {
    assert.equal(result.userId, userB.userId);
    assert.equal(result.coach.userId, userB.userId);
    assert.equal(result.coach.firstName, "Coach B");
    assert.equal(result.coach.professionalTitle, "Título B");
  }
  assert.deepEqual(writes, [userB.userId]);
  assert.deepEqual(activations, [userB.userId]);
});

const postIdentitySwitchCoachCases = [
  { name: "B ya es Coach", hasCoachRegistration: true },
  { name: "B es Usuario-only", hasCoachRegistration: false },
] as const;
const EXPECTED_POST_IDENTITY_SWITCH_COACH_CASE_COUNT = 2;

assert.equal(
  postIdentitySwitchCoachCases.length,
  EXPECTED_POST_IDENTITY_SWITCH_COACH_CASE_COUNT,
  "AC-039 fija los dos resultados de reenvío manual después de A→B",
);

for (const postSwitchCase of postIdentitySwitchCoachCases) {
  test(`A→B conserva precedencia y el reenvío manual resuelve ${postSwitchCase.name}`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const owners = createCoachRegistrationOwnerController();
    owners.acceptIdentity(userA.userId);
    const ownerA = owners.begin();
    const inputB = createCoachInputB();
    const lookups: string[] = [];
    const writes: string[] = [];
    const activations: string[] = [];
    let signOuts = 0;

    const mismatchResult = await controller.registerCoach(inputB, ownerA, createGateway({
      getCurrentIdentity: async () => userA,
      getCoachRegistration: async (expectedUserId) => {
        lookups.push(expectedUserId);
        return createCoachRecord(expectedUserId);
      },
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }));

    assert.deepEqual(mismatchResult, {
      state: "identity_switch_required",
      requestedPortal: "coach",
      message: COACH_REGISTRATION_IDENTITY_SWITCH_MESSAGE,
    });
    assert.equal(lookups.length, 0, "A→B se detecta antes del lookup Coach");

    owners.invalidate();
    owners.acceptIdentity(userB.userId);
    const ownerB = owners.begin();
    const existingCoachB = {
      ...createCoachRecord(userB.userId),
      professionalTitle: "Título B anterior",
    };
    const resultB = await controller.registerCoach(inputB, ownerB, createGateway({
      getCurrentIdentity: async () => userB,
      getCoachRegistration: async (expectedUserId) => {
        lookups.push(expectedUserId);
        return postSwitchCase.hasCoachRegistration ? existingCoachB : null;
      },
      createCoachRegistration: async (payload, expectedUserId) => {
        writes.push(expectedUserId);
        return {
          userId: expectedUserId,
          createdAt: "2026-08-19T12:00:00.000Z",
          firstName: payload.first_name,
          lastName: payload.last_name,
          birthDate: payload.birth_date,
          gender: payload.gender,
          phoneNumber: payload.phone_number,
          professionalTitle: payload.professional_title,
        };
      },
      activateCoachRegistrationIdentity: async (identity) => {
        activations.push(identity.userId);
        return identity;
      },
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }));

    assert.deepEqual(lookups, [userB.userId]);
    assert.equal(signOuts, 0, "registerCoach nunca cierra A ni B");
    if (postSwitchCase.hasCoachRegistration) {
      assert.deepEqual(resultB, {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
      });
      assert.deepEqual(writes, []);
      assert.deepEqual(activations, []);
      assert.equal(existingCoachB.professionalTitle, "Título B anterior");
    } else {
      assert.equal(resultB.state, "coach_authorized");
      if (resultB.state === "coach_authorized") {
        assert.equal(resultB.userId, userB.userId);
        assert.equal(resultB.coach.userId, userB.userId);
        assert.equal(resultB.coach.professionalTitle, "Título B");
      }
      assert.deepEqual(writes, [userB.userId]);
      assert.deepEqual(activations, [userB.userId]);
    }
  });
}

test("fila Coach cruzada en el lookup falla cerrada y no se presenta como duplicado", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration();
  let writes = 0;
  let activations = 0;
  let signOuts = 0;
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCoachRegistration: async () => createCoachRecord(userB.userId),
    createCoachRegistration: async (_payload, expectedUserId) => {
      writes += 1;
      return createCoachRecord(expectedUserId);
    },
    activateCoachRegistrationIdentity: async (identity) => {
      activations += 1;
      return identity;
    },
    signOut: async () => {
      signOuts += 1;
      return "signed_out";
    },
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(JSON.stringify(result).includes(COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE), false);
  assert.equal(writes, 0);
  assert.equal(activations, 0);
  assert.equal(signOuts, 0);
});

test("owner stale después del lookup duplicado produce cero efectos y cero publicación", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owners, owner } = beginCurrentRegistration();
  const lookupStarted = createDeferred<void>();
  const coachLookup = createDeferred<CoachRegistrationRecord | null>();
  const effects = {
    writes: 0,
    activations: 0,
    signOuts: 0,
    messages: 0,
    authorizedPublications: 0,
  };
  const pending = controller.registerCoach(coachInput, owner, createGateway({
    getCoachRegistration: async () => {
      lookupStarted.resolve();
      return coachLookup.promise;
    },
    createCoachRegistration: async (_payload, expectedUserId) => {
      effects.writes += 1;
      return createCoachRecord(expectedUserId);
    },
    activateCoachRegistrationIdentity: async (identity) => {
      effects.activations += 1;
      return identity;
    },
    signOut: async () => {
      effects.signOuts += 1;
      return "signed_out";
    },
  }));

  await lookupStarted.promise;
  owners.invalidate();
  owners.acceptIdentity(userB.userId);
  coachLookup.resolve(createCoachRecord(userA.userId));
  const result = await pending;
  if (owner.isCurrent() && result.state !== "stale") {
    effects.messages += result.state === "error" ? 1 : 0;
    effects.authorizedPublications += result.state === "coach_authorized" ? 1 : 0;
  }

  assert.deepEqual(result, { state: "stale", requestedPortal: "coach" });
  assert.deepEqual(effects, {
    writes: 0,
    activations: 0,
    signOuts: 0,
    messages: 0,
    authorizedPublications: 0,
  });
});

test("dos dispositivos conservan Login Usuario y Login Coach ante registro Coach duplicado", async () => {
  const userController = createMultiportalAuthController<TestAuthState>();
  const coachController = createMultiportalAuthController<TestAuthState>();
  const duplicateController = createMultiportalAuthController<TestAuthState>();
  const { owner: userOwner } = beginCurrentResolution();
  const { owner: coachOwner } = beginCurrentResolution();
  const { owner: duplicateOwner } = beginCurrentRegistration();
  const activeDeviceSessions = new Set(["usuario-device", "coach-device"]);
  let signOuts = 0;
  const ownCoach = createCoachRecord();
  const sessionPreservingGateway = createGateway({
    getCurrentIdentity: async () => userA,
    hasUserRegistration: async () => true,
    getCoachRegistration: async () => ownCoach,
    signOut: async () => {
      signOuts += 1;
      activeDeviceSessions.clear();
      return "signed_out";
    },
  });

  const userLogin = await userController.resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: userA.userId,
    owner: userOwner,
  }, sessionPreservingGateway);
  const coachLogin = await coachController.resolvePortalAccess({
    requestedPortal: "coach",
    expectedUserId: userA.userId,
    owner: coachOwner,
  }, sessionPreservingGateway);
  const duplicateRegistration = await duplicateController.registerCoach(
    coachInput,
    duplicateOwner,
    sessionPreservingGateway,
  );

  assert.deepEqual(userLogin, {
    state: "user_authorized",
    requestedPortal: "usuario",
    userId: userA.userId,
  });
  assert.deepEqual(coachLogin, {
    state: "coach_authorized",
    requestedPortal: "coach",
    userId: userA.userId,
    coach: ownCoach,
  });
  assert.deepEqual(duplicateRegistration, {
    state: "error",
    requestedPortal: "coach",
    field: "register-email",
    message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
  });
  assert.equal(signOuts, 0);
  assert.deepEqual([...activeDeviceSessions].sort(), ["coach-device", "usuario-device"]);
});

test("ownership cruzado en la respuesta falla cerrado", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration();
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    createCoachRegistration: async (payload) => ({
      userId: "user-b",
      createdAt: "2026-08-16T12:00:00.000Z",
      firstName: payload.first_name,
      lastName: payload.last_name,
      birthDate: payload.birth_date,
      gender: payload.gender,
      phoneNumber: payload.phone_number,
      professionalTitle: payload.professional_title,
    }),
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
});

*/

test("Usuario autenticado prepara activación Coach sólo con membresía Usuario", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentSharedRegistration();
  let membershipReads = 0;
  const result = await controller.prepareSharedCoachRegistration(
    userA.userId,
    owner,
    createGateway({
      getCurrentIdentity: async () => userA,
      hasUserRegistration: async () => {
        membershipReads += 1;
        return true;
      },
    }),
  );

  assert.deepEqual(result, {
    state: "authorized",
    userId: userA.userId,
    authState: userA.authState,
  });
  assert.equal(membershipReads, 1);
});

test("activación Coach compartida sin sesión exige login antes de continuar", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const owners = createCoachRegistrationOwnerController();
  const owner = owners.begin();
  let membershipReads = 0;
  const result = await controller.prepareSharedCoachRegistration(
    undefined,
    owner,
    createGateway({
      getCurrentIdentity: async () => null,
      hasUserRegistration: async () => {
        membershipReads += 1;
        return true;
      },
    }),
  );

  assert.deepEqual(result, { state: "sign_in_required" });
  assert.equal(membershipReads, 0);
});

test("login Coach compartido autorizado conserva la sesión y no ejecuta signOut", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentSharedRegistration();
  let signOuts = 0;
  const result = await controller.completeSharedCoachLogin(
    userA.userId,
    owner,
    createGateway({
      getCurrentIdentity: async () => userA,
      hasUserRegistration: async () => true,
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }),
  );

  assert.deepEqual(result, {
    state: "authorized",
    userId: userA.userId,
    authState: userA.authState,
  });
  assert.equal(signOuts, 0);
});

test("capturar elegibilidad post-login conserva pending hasta resolver o cerrar sesión", () => {
  const form = createAuthRegistrationFormController();
  form.selectCoachFlow("shared", null);
  form.beginSharedCoachLogin();
  const beforeCapture = JSON.stringify(form.getState());
  const capture = form.captureSharedCoachEligibility(userA.userId);

  assert.equal(Object.isFrozen(capture), true);
  assert.equal(JSON.stringify(form.getState()), beforeCapture);
  assert.equal(form.getState().sharedCoachLoginPending, true);
  assert.equal(form.completeSharedCoachEligibility(capture, {
    state: "authorized",
    userId: userA.userId,
  }), true);
  assert.equal(form.getState().sharedCoachLoginPending, false);
});

for (const rejectionCase of ["sign_in_required", "error"] as const) {
  test(`login Coach compartido ${rejectionCase} cierra localmente una sola vez`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const { owner } = beginCurrentSharedRegistration();
    let signOuts = 0;
    const result = await controller.completeSharedCoachLogin(
      userA.userId,
      owner,
      createGateway({
        getCurrentIdentity: rejectionCase === "error"
          ? async () => { throw new Error("private membership failure"); }
          : async () => userA,
        hasUserRegistration: async () => false,
        signOut: async (reason, currentOwner) => {
          signOuts += 1;
          assert.equal(reason, "authorization_error");
          assert.equal(currentOwner, owner);
          return "signed_out";
        },
      }),
    );

    assert.deepEqual(result, {
      state: "rejected",
      message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
    });
    assert.equal(signOuts, 1);
  });
}

test("owner stale de login Coach compartido no invoca signOut", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owners, owner } = beginCurrentSharedRegistration();
  owners.invalidate();
  let signOuts = 0;

  const result = await controller.completeSharedCoachLogin(
    userA.userId,
    owner,
    createGateway({
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }),
  );

  assert.deepEqual(result, { state: "stale" });
  assert.equal(signOuts, 0);
});

test("respuesta tardía A de login Coach compartido nunca cierra la sesión B", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owners, owner } = beginCurrentSharedRegistration();
  const membershipStarted = createDeferred<void>();
  const membership = createDeferred<boolean>();
  let signOuts = 0;
  const pending = controller.completeSharedCoachLogin(
    userA.userId,
    owner,
    createGateway({
      getCurrentIdentity: async () => userA,
      hasUserRegistration: async () => {
        membershipStarted.resolve();
        return membership.promise;
      },
      signOut: async () => {
        signOuts += 1;
        return "signed_out";
      },
    }),
  );

  await membershipStarted.promise;
  owners.acceptIdentity(userB.userId);
  membership.resolve(false);

  assert.deepEqual(await pending, { state: "stale" });
  assert.equal(signOuts, 0);
});

test("fallo de signOut compartido publica sólo error neutral y nunca autorización", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentSharedRegistration();
  const result = await controller.completeSharedCoachLogin(
    userA.userId,
    owner,
    createGateway({
      getCurrentIdentity: async () => userA,
      hasUserRegistration: async () => false,
      signOut: async () => {
        throw new Error("private signout failure for user-a@example.test");
      },
    }),
  );

  assert.deepEqual(result, {
    state: "error",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.notEqual(result.state, "authorized");
});

test("doble completion compartida concurrente ejecuta un solo signOut", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentSharedRegistration();
  const signOut = createDeferred<"signed_out">();
  let signOuts = 0;
  const gateway = createGateway({
    getCurrentIdentity: async () => userA,
    hasUserRegistration: async () => false,
    signOut: async () => {
      signOuts += 1;
      return signOut.promise;
    },
  });

  const first = controller.completeSharedCoachLogin(userA.userId, owner, gateway);
  const second = controller.completeSharedCoachLogin(userA.userId, owner, gateway);
  assert.deepEqual(await second, { state: "busy" });
  signOut.resolve("signed_out");
  assert.deepEqual(await first, {
    state: "rejected",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(signOuts, 1);
});

test("Auth sin membresía Usuario no puede preparar ni escribir activación Coach compartida", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const preparationOwner = beginCurrentSharedRegistration().owner;
  const preparation = await controller.prepareSharedCoachRegistration(
    userA.userId,
    preparationOwner,
    createGateway({
      getCurrentIdentity: async () => userA,
      hasUserRegistration: async () => false,
    }),
  );
  assert.deepEqual(preparation, { state: "sign_in_required" });

  const registrationOwner = beginCurrentSharedRegistration().owner;
  let writes = 0;
  const registration = await controller.registerCoach(
    sharedCoachInput,
    registrationOwner,
    createGateway({
      getCurrentIdentity: async () => userA,
      hasUserRegistration: async () => false,
      createSharedCoachRegistration: async () => {
        writes += 1;
        return createCoachRecord();
      },
    }),
  );
  assert.deepEqual(registration, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(writes, 0);
});

test("cuenta compartida activa Coach sobre auth.uid sin signUp ni cambio de sesión", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentSharedRegistration();
  const effects = { signUps: 0, writes: 0, welcomes: 0, activations: 0 };
  const result = await controller.registerCoach(sharedCoachInput, owner, createGateway({
    getCurrentIdentity: async () => userA,
    signUpForCoachRegistration: async () => {
      effects.signUps += 1;
      assert.fail("la cuenta compartida no ejecuta signUp");
    },
    hasUserRegistration: async () => true,
    createSharedCoachRegistration: async (payload, expectedUserId) => {
      effects.writes += 1;
      assert.deepEqual(payload, coachInput.registration);
      assert.equal(expectedUserId, userA.userId);
      return createCoachRecord(expectedUserId);
    },
    requestWelcomeEmail: async (expectedUserId) => {
      effects.welcomes += 1;
      assert.equal(expectedUserId, userA.userId);
      throw new Error("proveedor no disponible");
    },
    activateCoachRegistrationIdentity: async () => {
      effects.activations += 1;
      assert.fail("la sesión compartida ya está activa");
    },
  }));

  assert.deepEqual(result, {
    state: "coach_authorized",
    requestedPortal: "coach",
    userId: userA.userId,
    coach: createCoachRecord(),
    authState: userA.authState,
  });
  assert.deepEqual(effects, { signUps: 0, writes: 1, welcomes: 1, activations: 0 });
});

test("cuenta compartida invalidada durante bienvenida queda stale sin autorizar B", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owners, owner } = beginCurrentSharedRegistration();
  const welcomeStarted = createDeferred<void>();
  const releaseWelcome = createDeferred<void>();
  let writes = 0;
  const pending = controller.registerCoach(sharedCoachInput, owner, createGateway({
    getCurrentIdentity: async () => userA,
    hasUserRegistration: async () => true,
    createSharedCoachRegistration: async () => {
      writes += 1;
      return createCoachRecord(userA.userId);
    },
    requestWelcomeEmail: async () => {
      welcomeStarted.resolve();
      await releaseWelcome.promise;
    },
  }));

  await welcomeStarted.promise;
  owners.acceptIdentity(userB.userId);
  releaseWelcome.resolve();

  assert.deepEqual(await pending, { state: "stale", requestedPortal: "coach" });
  assert.equal(writes, 1, "la membresía A ya materializada no se atribuye a B");
});

test("activación Coach compartida es idempotente y nunca acepta respuesta cruzada", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentSharedRegistration();
  let writes = 0;
  const gateway = createGateway({
    getCurrentIdentity: async () => userA,
    hasUserRegistration: async () => true,
    createSharedCoachRegistration: async (_payload, expectedUserId) => {
      writes += 1;
      return createCoachRecord(expectedUserId);
    },
  });

  assert.equal((await controller.registerCoach(sharedCoachInput, owner, gateway)).state, "coach_authorized");
  assert.equal((await controller.registerCoach(sharedCoachInput, owner, gateway)).state, "coach_authorized");
  assert.equal(writes, 2, "cada intento usa la RPC idempotente y nunca un write directo");

  const crossOwner = beginCurrentSharedRegistration().owner;
  const cross = await controller.registerCoach(sharedCoachInput, crossOwner, createGateway({
    getCurrentIdentity: async () => userA,
    hasUserRegistration: async () => true,
    createSharedCoachRegistration: async () => createCoachRecord(userB.userId),
  }));
  assert.deepEqual(cross, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
});

test("cuenta Coach separada usa signUp aislado y nunca reutiliza la sesión Usuario activa", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration();
  let signups = 0;
  let membershipReads = 0;
  let activations = 0;
  const result = await controller.registerCoach(createCoachInputB(), owner, createGateway({
    getCurrentIdentity: async () => userA,
    signUpForCoachRegistration: async () => {
      signups += 1;
      return { kind: "authenticated", identity: userB };
    },
    getCoachRegistration: async () => {
      membershipReads += 1;
      return createCoachRecord(userB.userId);
    },
    activateCoachRegistrationIdentity: async () => {
      activations += 1;
      assert.fail("la sesión Usuario no puede reemplazarse silenciosamente");
    },
  }));

  assert.deepEqual(result, {
    state: "coach_confirmation_required",
    requestedPortal: "coach",
    message: COACH_REGISTRATION_CONFIRMATION_MESSAGE,
  });
  assert.equal(signups, 1);
  assert.equal(membershipReads, 1);
  assert.equal(activations, 0);
});

test("Usuario A y Coach B usan identidades y contraseñas independientes", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  const inputB = createCoachInputB();
  inputB.auth.password = "password-coach-b-789";
  inputB.registration.contact_email = userA.email!;
  const calls: string[] = [];
  const result = await controller.registerCoach(inputB, owner, createGateway({
    getCurrentIdentity: async () => {
      calls.push("current_identity:none");
      return null;
    },
    signUpForCoachRegistration: async (payload) => {
      calls.push(`signup:${payload.auth.email}`);
      assert.equal(payload.auth.password, "password-coach-b-789");
      assert.equal(payload.registration.contact_email, userA.email);
      return { kind: "authenticated", identity: userB };
    },
    getCoachRegistration: async (expectedUserId) => {
      calls.push(`membership:${expectedUserId}`);
      return createCoachRecord(userB.userId);
    },
    requestWelcomeEmail: async (expectedUserId) => {
      calls.push(`welcome:${expectedUserId}`);
      throw new Error("proveedor no disponible");
    },
    activateCoachRegistrationIdentity: async (identity) => {
      calls.push(`activate:${identity.userId}`);
      return identity;
    },
    createUserRegistration: async () => assert.fail("Coach nuevo no crea Usuario"),
  }));

  assert.equal(result.state, "coach_authorized");
  if (result.state === "coach_authorized") {
    assert.equal(result.userId, userB.userId);
    assert.notEqual(result.userId, userA.userId);
  }
  assert.deepEqual(calls, [
    `signup:${userB.email}`,
    `membership:${userB.userId}`,
    `welcome:${userB.userId}`,
    "current_identity:none",
    `activate:${userB.userId}`,
  ]);
});

test("signup Coach pendiente no consulta ni crea membresía desde el cliente", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  let signups = 0;
  let membershipReads = 0;
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCurrentIdentity: async () => null,
    signUpForCoachRegistration: async () => {
      signups += 1;
      return { kind: "confirmation_required" };
    },
    getCoachRegistration: async () => {
      membershipReads += 1;
      return null;
    },
  }));

  assert.deepEqual(result, {
    state: "coach_confirmation_required",
    requestedPortal: "coach",
    message: COACH_REGISTRATION_CONFIRMATION_MESSAGE,
  });
  assert.equal(signups, 1);
  assert.equal(membershipReads, 0);
});

test("existing_identity y confirmation_required Coach son públicamente indistinguibles", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const outcomes = [];
  const visibleEffects = [];

  for (const kind of ["confirmation_required", "existing_identity"] as const) {
    const { owner } = beginCurrentRegistration(null);
    const effects = { membershipReads: 0, activations: 0, signOuts: 0 };
    const result = await controller.registerCoach(coachInput, owner, createGateway({
      getCurrentIdentity: async () => null,
      signUpForCoachRegistration: async () => ({ kind }),
      getCoachRegistration: async () => {
        effects.membershipReads += 1;
        return createCoachRecord();
      },
      activateCoachRegistrationIdentity: async (identity) => {
        effects.activations += 1;
        return identity;
      },
      signOut: async () => {
        effects.signOuts += 1;
        return "signed_out";
      },
    }));
    outcomes.push(result);
    visibleEffects.push(effects);
  }

  assert.deepEqual(outcomes[0], {
    state: "coach_confirmation_required",
    requestedPortal: "coach",
    message: COACH_REGISTRATION_CONFIRMATION_MESSAGE,
  });
  assert.deepEqual(outcomes[1], outcomes[0]);
  assert.deepEqual(visibleEffects, [
    { membershipReads: 0, activations: 0, signOuts: 0 },
    { membershipReads: 0, activations: 0, signOuts: 0 },
  ]);
});

test("autoconfirm sólo continúa si el backend ya creó la membresía Coach propia", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const successOwner = beginCurrentRegistration(null).owner;
  const success = await controller.registerCoach(coachInput, successOwner, createGateway({
    getCurrentIdentity: async () => null,
    signUpForCoachRegistration: async () => ({ kind: "authenticated", identity: userA }),
    getCoachRegistration: async () => createCoachRecord(),
  }));
  assert.equal(success.state, "coach_authorized");

  const failureOwner = beginCurrentRegistration(null).owner;
  const missingMembership = await controller.registerCoach(coachInput, failureOwner, createGateway({
    getCurrentIdentity: async () => null,
    signUpForCoachRegistration: async () => ({ kind: "authenticated", identity: userA }),
    getCoachRegistration: async () => null,
  }));
  assert.deepEqual(missingMembership, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
});

test("error Auth Coach se sanitiza y no filtra detalles backend", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCurrentIdentity: async () => null,
    signUpForCoachRegistration: async () => ({
      kind: "error",
      message: "duplicate auth.users coach@example.com uuid-secret",
    }),
  }));
  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "coach",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
});

test("doble submit Coach comparte un owner síncrono", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  let release!: (result: { kind: "confirmation_required" }) => void;
  const pendingSignup = new Promise<{ kind: "confirmation_required" }>((resolve) => {
    release = resolve;
  });
  let signUps = 0;
  const gateway = createGateway({
    signUpForCoachRegistration: async () => {
      signUps += 1;
      return pendingSignup;
    },
  });

  const first = controller.registerCoach(coachInput, owner, gateway);
  const second = await controller.registerCoach(coachInput, owner, gateway);
  assert.deepEqual(second, { state: "busy", requestedPortal: "coach" });
  assert.equal(signUps, 1);

  release({ kind: "confirmation_required" });
  assert.equal((await first).state, "coach_confirmation_required");
});

test("nuevo submit invalida al anterior y su finally no libera el owner nuevo", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const owners = createCoachRegistrationOwnerController();
  const ownerA = owners.begin({ independentIdentity: true });
  const firstSignupStarted = createDeferred<void>();
  const firstSignup = createDeferred<{ kind: "confirmation_required" }>();
  const first = controller.registerCoach(coachInput, ownerA, createGateway({
    signUpForCoachRegistration: async () => {
      firstSignupStarted.resolve();
      return firstSignup.promise;
    },
  }));
  await firstSignupStarted.promise;

  const ownerReplacement = owners.begin({ independentIdentity: true });
  const second = await controller.registerCoach(coachInput, ownerReplacement, createGateway({
    signUpForCoachRegistration: async () => ({ kind: "confirmation_required" }),
  }));
  assert.equal(second.state, "coach_confirmation_required");
  assert.equal(ownerReplacement.isCurrent(), true);

  firstSignup.resolve({ kind: "confirmation_required" });
  assert.deepEqual(await first, { state: "stale", requestedPortal: "coach" });
  assert.equal(ownerReplacement.isCurrent(), true, "el finally anterior no finaliza el owner nuevo");
});

test("owner Coach vincula expectedUserId y SIGNED_OUT/cambio directo lo invalidan", () => {
  const owners = createCoachRegistrationOwnerController();
  const ownerA = owners.begin();
  assert.equal(Object.isFrozen(ownerA), true);
  assert.equal(ownerA.expectedUserId, null);
  assert.equal(ownerA.bindExpectedUserId(userA.userId), true);
  assert.equal(ownerA.expectedUserId, userA.userId);

  owners.invalidate();
  assert.equal(ownerA.isCurrent(), false);
  owners.acceptIdentity(userB.userId);
  const ownerB = owners.begin();
  assert.equal(ownerB.expectedUserId, userB.userId);
  assert.equal(ownerB.isCurrent(), true);
  owners.end(ownerA);
  assert.equal(ownerB.isCurrent(), true);

  assert.equal(owners.acceptIdentity(userA.userId), true);
  assert.equal(ownerB.isCurrent(), false);
});

test("SIGNED_OUT invalida owners de resolución y un finally antiguo no libera el nuevo", () => {
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity(userA.userId);
  const ownerA = owners.begin(userA.userId);
  const ownerASecondReader = owners.begin(userA.userId);
  assert.equal(owners.hasPending(), true);
  assert.equal(owners.isCurrent(ownerA), true);
  assert.equal(owners.isCurrent(ownerASecondReader), true);

  owners.invalidate();
  assert.equal(owners.hasPending(), false);
  assert.equal(owners.isCurrent(ownerA), false);
  assert.equal(owners.isCurrent(ownerASecondReader), false);

  owners.acceptIdentity(userB.userId);
  const ownerB = owners.begin(userB.userId);
  owners.end(ownerA);
  assert.equal(owners.isCurrent(ownerB), true);
  owners.end(ownerB);
  assert.equal(owners.isCurrent(ownerB), false);
});

test("un cambio directo A→B invalida A antes de aceptar el owner inmutable de B", () => {
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity(userA.userId);
  const ownerA = owners.begin(userA.userId);

  assert.equal(Object.isFrozen(ownerA), true);
  assert.equal(ownerA.expectedUserId, userA.userId);
  assert.equal(ownerA.isCurrent(), true);

  assert.equal(owners.acceptIdentity(userB.userId), true);
  assert.equal(ownerA.isCurrent(), false);
  const ownerB = owners.begin(userB.userId);
  assert.equal(Object.isFrozen(ownerB), true);
  assert.equal(ownerB.expectedUserId, userB.userId);
  assert.equal(ownerB.isCurrent(), true);
});

test("confirmación resuelve el portal exclusivamente desde el resultado backend propio", async () => {
  const cases = [
    {
      portal: "usuario" as const,
      message: USER_REGISTRATION_CONFIRMED_MESSAGE,
    },
    {
      portal: "coach" as const,
      message: COACH_REGISTRATION_CONFIRMED_MESSAGE,
    },
  ];

  for (const candidate of cases) {
    const controller = createMultiportalAuthController<TestAuthState>();
    const { owner } = beginCurrentResolution();
    const requestedIds: string[] = [];
    const welcomeUserIds: string[] = [];
    const result = await controller.resolveSignupConfirmation({
      expectedUserId: userA.userId,
      owner,
    }, createGateway({
      getOwnSignupConfirmation: async (expectedUserId) => {
        requestedIds.push(expectedUserId);
        return { status: "confirmed", portal: candidate.portal };
      },
      requestWelcomeEmail: async (expectedUserId) => {
        welcomeUserIds.push(expectedUserId);
        throw new Error("proveedor no disponible");
      },
    }));

    assert.deepEqual(result, {
      state: "confirmed",
      requestedPortal: candidate.portal,
      message: candidate.message,
    });
    assert.deepEqual(requestedIds, [userA.userId]);
    assert.deepEqual(welcomeUserIds, [userA.userId]);
  }
});

test("portal cliente, metadata, roles y correo nunca reemplazan el portal confirmado backend", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  const manipulatedIdentity = {
    ...userA,
    email: "coach@attacker.test",
    user_metadata: { portal: "usuario", role: "admin" },
    app_metadata: { portal: "usuario" },
  } as unknown as AuthenticatedPortalIdentity<TestAuthState>;
  const result = await controller.resolveSignupConfirmation({
    expectedUserId: userA.userId,
    owner,
    requestedPortal: "usuario",
    query: { portal: "usuario" },
  } as Parameters<typeof controller.resolveSignupConfirmation>[0], createGateway({
    getCurrentIdentity: async () => manipulatedIdentity,
    getOwnSignupConfirmation: async () => ({ status: "confirmed", portal: "coach" }),
  }));

  assert.deepEqual(result, {
    state: "confirmed",
    requestedPortal: "coach",
    message: COACH_REGISTRATION_CONFIRMED_MESSAGE,
  });
});

test("confirmación vencida, inválida o reutilizada falla cerrada con copy controlado", async () => {
  for (const status of ["expired", "invalid"] as const) {
    const controller = createMultiportalAuthController<TestAuthState>();
    const { owner } = beginCurrentResolution();
    let welcomeRequests = 0;
    const result = await controller.resolveSignupConfirmation({
      expectedUserId: userA.userId,
      owner,
    }, createGateway({
      getOwnSignupConfirmation: async () => ({ status, portal: "coach" }),
      requestWelcomeEmail: async () => {
        welcomeRequests += 1;
      },
    }));
    assert.deepEqual(result, {
      state: "invalid",
      requestedPortal: "coach",
      message: SIGNUP_CONFIRMATION_INVALID_MESSAGE,
    });
    assert.equal(welcomeRequests, 0);
  }
});

test("confirmación A tardía queda stale después de SIGNED_OUT→B y no publica portal A", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity(userA.userId);
  const ownerA = owners.begin(userA.userId);
  const lookupStarted = createDeferred<void>();
  const backendResult = createDeferred<{
    status: "confirmed";
    portal: "coach";
  }>();
  const resolutionA = controller.resolveSignupConfirmation({
    expectedUserId: userA.userId,
    owner: ownerA,
  }, createGateway({
    getOwnSignupConfirmation: async () => {
      lookupStarted.resolve();
      return backendResult.promise;
    },
  }));
  await lookupStarted.promise;

  owners.invalidate();
  owners.acceptIdentity(userB.userId);
  const ownerB = owners.begin(userB.userId);
  backendResult.resolve({ status: "confirmed", portal: "coach" });

  assert.deepEqual(await resolutionA, {
    state: "stale",
    requestedPortal: "usuario",
  });
  assert.equal(ownerA.isCurrent(), false);
  assert.equal(ownerB.isCurrent(), true);
});

test("confirmación invalidada durante bienvenida queda stale antes del signOut", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity(userA.userId);
  const ownerA = owners.begin(userA.userId);
  const welcomeStarted = createDeferred<void>();
  const releaseWelcome = createDeferred<void>();
  const resolutionA = controller.resolveSignupConfirmation({
    expectedUserId: userA.userId,
    owner: ownerA,
  }, createGateway({
    getOwnSignupConfirmation: async () => ({ status: "confirmed", portal: "usuario" }),
    requestWelcomeEmail: async () => {
      welcomeStarted.resolve();
      await releaseWelcome.promise;
    },
  }));

  await welcomeStarted.promise;
  owners.invalidate();
  owners.acceptIdentity(userB.userId);
  releaseWelcome.resolve();

  assert.deepEqual(await resolutionA, {
    state: "stale",
    requestedPortal: "usuario",
  });
});

test("identidad A→B directa antes del RPC no consulta ni publica confirmación cruzada", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution(userA.userId);
  let confirmationReads = 0;
  const result = await controller.resolveSignupConfirmation({
    expectedUserId: userA.userId,
    owner,
  }, createGateway({
    getCurrentIdentity: async () => userB,
    getOwnSignupConfirmation: async () => {
      confirmationReads += 1;
      return { status: "confirmed", portal: "coach" };
    },
  }));

  assert.deepEqual(result, {
    state: "stale",
    requestedPortal: "usuario",
  });
  assert.equal(confirmationReads, 0);
});

test("error backend de confirmación se sanitiza y falla cerrado", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  const result = await controller.resolveSignupConfirmation({
    expectedUserId: userA.userId,
    owner,
  }, createGateway({
    getOwnSignupConfirmation: async () => {
      throw new Error("private.auth_registration_pending_memberships secret-detail");
    },
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "usuario",
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  });
  assert.equal(JSON.stringify(result).includes("secret-detail"), false);
});
