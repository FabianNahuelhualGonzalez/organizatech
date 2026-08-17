import assert from "node:assert/strict";
import test from "node:test";

import type { CoachRegistrationPreparationPayload } from "@/features/auth/model/auth-form";
import {
  COACH_REGISTRATION_IDENTITY_SWITCH_MESSAGE,
  COACH_REGISTRATION_REQUIRED_MESSAGE,
  MULTIPORTAL_AUTH_ERROR_MESSAGE,
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

const coachInput: CoachRegistrationPreparationPayload = {
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
  },
};

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
  };
}

function createGateway(
  overrides: Partial<MultiportalAuthGateway<TestAuthState>> = {},
): MultiportalAuthGateway<TestAuthState> {
  return {
    getCurrentIdentity: async () => userA,
    signInForCoachRegistration: async () => assert.fail("signIn inesperado"),
    signUpForCoachRegistration: async () => assert.fail("signUp inesperado"),
    signInForUserRegistration: async () => assert.fail("signIn Usuario inesperado"),
    signUpForUserRegistration: async () => assert.fail("signUp Usuario inesperado"),
    hasUserRegistration: async () => true,
    getCoachRegistration: async () => null,
    createUserRegistration: async (expectedUserId) => ({ userId: expectedUserId }),
    createCoachRegistration: async (payload, expectedUserId) => ({
      userId: expectedUserId,
      createdAt: "2026-08-16T12:00:00.000Z",
      firstName: payload.first_name,
      lastName: payload.last_name,
      birthDate: payload.birth_date,
      gender: payload.gender,
      phoneNumber: payload.phone_number,
      professionalTitle: payload.professional_title,
    }),
    activateCoachRegistrationIdentity: async (identity) => identity,
    activateUserRegistrationIdentity: async (identity) => identity,
    signOut: async (_reason, owner) => owner.isCurrent() ? "signed_out" : "stale",
    signOutForCoachIdentitySwitch: async (_email, owner) => owner.isCurrent() ? "signed_out" : "stale",
    ...overrides,
  };
}

function beginCurrentRegistration(currentUserId: string | null = userA.userId) {
  const owners = createCoachRegistrationOwnerController();
  if (currentUserId) owners.acceptIdentity(currentUserId);
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

test("Usuario autenticado sólo resuelve user_authorized con membresía Usuario", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentResolution();
  let userReads = 0;
  let coachReads = 0;
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
  }));

  assert.deepEqual(result, {
    state: "user_authorized",
    requestedPortal: "usuario",
    userId: "user-a",
  });
  assert.equal(userReads, 1);
  assert.equal(coachReads, 0);
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

test("fallo autoritativo no filtra detalles y también falla cerrado", async () => {
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
  assert.equal(signedOut, true);
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
      async createCoachRegistration(payload, expectedUserId) {
        writes.push(expectedUserId);
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
      async signOut(_reason, owner) {
        signOutAttempts.push(owner.expectedUserId);
        if (!owner.isCurrent() || activeUserId !== owner.expectedUserId) return "stale";
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
  "isolated_sign_in",
  "isolated_sign_up",
  "coach_lookup",
  "atomic_insert",
  "session_activation",
] as const;

for (const awaitPoint of staleRegistrationAwaitPoints) {
  test(`registro A→B queda stale sin efectos posteriores en ${awaitPoint}`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const owners = createCoachRegistrationOwnerController();
    if (["coach_lookup", "atomic_insert", "session_activation"].includes(awaitPoint)) {
      owners.acceptIdentity(userA.userId);
    }
    const ownerA = owners.begin();
    const paused = createDeferred<void>();
    const release = createDeferred<void>();
    const effects = {
      signIns: 0,
      signUps: 0,
      lookups: 0,
      writesA: 0,
      writesB: 0,
      activations: 0,
      navigation: 0,
      messages: 0,
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
        return ["coach_lookup", "atomic_insert", "session_activation"].includes(awaitPoint)
          ? userA
          : null;
      },
      async signInForCoachRegistration() {
        effects.signIns += 1;
        await pause("isolated_sign_in");
        return awaitPoint === "isolated_sign_up"
          ? { kind: "invalid_credentials" as const }
          : { kind: "authenticated" as const, identity: userA };
      },
      async signUpForCoachRegistration() {
        effects.signUps += 1;
        await pause("isolated_sign_up");
        return { kind: "authenticated", identity: userA };
      },
      async getCoachRegistration() {
        effects.lookups += 1;
        await pause("coach_lookup");
        return awaitPoint === "session_activation" ? createCoachRecord() : null;
      },
      async createCoachRegistration(payload, expectedUserId) {
        if (expectedUserId === userA.userId) effects.writesA += 1;
        else effects.writesB += 1;
        await pause("atomic_insert");
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
    if (awaitPoint === "current_identity" || awaitPoint === "isolated_sign_in") {
      owners.invalidate();
    }
    owners.acceptIdentity(userB.userId);
    release.resolve();
    const resultA = await pendingA;
    if (ownerA.isCurrent() && resultA.state !== "stale") {
      effects.messages += resultA.state === "error" ? 1 : 0;
      effects.navigation += resultA.state === "coach_authorized" ? 1 : 0;
      effects.sessionApplications += resultA.state === "coach_authorized" ? 1 : 0;
    }

    assert.deepEqual(resultA, { state: "stale", requestedPortal: "coach" });
    assert.equal(effects.writesB, 0, "datos A nunca se escriben bajo B");
    assert.equal(effects.navigation, 0);
    assert.equal(effects.messages, 0);
    assert.equal(effects.sessionApplications, 0);
    assert.equal(userB.userId, "user-b", "B conserva la identidad esperada");
    if (awaitPoint !== "atomic_insert") {
      assert.equal(effects.writesA, 0, "una operación no despachada no escribe después de quedar stale");
    }
    if (awaitPoint !== "session_activation") {
      assert.equal(effects.activations, 0, "A stale no inicia la aplicación de sesión");
    }
  });
}

test("Coach-only agrega Usuario sobre la misma identidad sin crear Coach", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentUserRegistration();
  let userWrites = 0;
  let coachWrites = 0;
  const result = await controller.registerUser(coachInput.auth, owner, createGateway({
    hasUserRegistration: async () => false,
    createUserRegistration: async (expectedUserId) => {
      userWrites += 1;
      return { userId: expectedUserId };
    },
    createCoachRegistration: async () => {
      coachWrites += 1;
      assert.fail("Registro Usuario no puede crear Coach");
    },
  }));

  assert.deepEqual(result, {
    state: "user_authorized",
    requestedPortal: "usuario",
    userId: userA.userId,
    authState: userA.authState,
  });
  assert.equal(userWrites, 1);
  assert.equal(coachWrites, 0);
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
  const result = await controller.registerUser(coachInput.auth, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForUserRegistration: async () => ({ kind: "invalid_credentials" }),
    signUpForUserRegistration: async () => ({ kind: "confirmation_required" }),
    createUserRegistration: async () => {
      writes += 1;
      assert.fail("sin sesión autenticada no se crea membresía Usuario");
    },
  }));

  assert.deepEqual(result, {
    state: "user_confirmation_required",
    requestedPortal: "usuario",
    message: "Cuenta creada. Revisa tu correo para confirmar el registro.",
  });
  assert.equal(writes, 0);
});

test("repetir Registro Usuario es idempotente y no reescribe la membresía", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentUserRegistration();
  let writes = 0;
  const result = await controller.registerUser(coachInput.auth, owner, createGateway({
    hasUserRegistration: async () => true,
    createUserRegistration: async () => {
      writes += 1;
      assert.fail("membresía Usuario existente no debe reescribirse");
    },
  }));

  assert.equal(result.state, "user_authorized");
  assert.equal(writes, 0);
});

const staleUserRegistrationAwaitPoints = [
  "current_identity",
  "isolated_sign_in",
  "isolated_sign_up",
  "user_lookup",
  "atomic_insert",
  "session_activation",
] as const;
const EXPECTED_STALE_USER_REGISTRATION_AWAIT_POINT_COUNT = 6;
assert.equal(
  staleUserRegistrationAwaitPoints.length,
  EXPECTED_STALE_USER_REGISTRATION_AWAIT_POINT_COUNT,
  "Registro Usuario fija los seis límites async A→SIGNED_OUT→B",
);

for (const awaitPoint of staleUserRegistrationAwaitPoints) {
  test(`Registro Usuario A→SIGNED_OUT→B queda stale en ${awaitPoint}`, async () => {
    const controller = createMultiportalAuthController<TestAuthState>();
    const owners = createUserRegistrationOwnerController();
    if (["user_lookup", "atomic_insert", "session_activation"].includes(awaitPoint)) {
      owners.acceptIdentity(userA.userId);
    }
    const ownerA = owners.begin();
    const paused = createDeferred<void>();
    const release = createDeferred<void>();
    const effects = {
      signOuts: 0,
      userWritesA: 0,
      userWritesB: 0,
      coachWrites: 0,
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
        return ["user_lookup", "atomic_insert", "session_activation"].includes(awaitPoint)
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
        return awaitPoint === "session_activation";
      },
      async createUserRegistration(expectedUserId) {
        if (expectedUserId === userA.userId) effects.userWritesA += 1;
        else effects.userWritesB += 1;
        await pause("atomic_insert");
        return { userId: expectedUserId };
      },
      async activateUserRegistrationIdentity(identity, owner) {
        await pause("session_activation");
        if (!owner.isCurrent()) return null;
        effects.sessionApplications += 1;
        return identity;
      },
      async createCoachRegistration() {
        effects.coachWrites += 1;
        assert.fail("Registro Usuario no escribe Coach");
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
    assert.equal(effects.coachWrites, 0);
    assert.equal(effects.navigation, 0);
    assert.equal(effects.messages, 0);
    assert.equal(effects.authorizations, 0);
    assert.equal(effects.sessionApplications, 0);
    if (awaitPoint !== "atomic_insert") {
      assert.equal(effects.userWritesA, 0, "A stale no inicia un write posterior");
    }
  });
}

test("Usuario existente agrega Coach sobre el mismo correo y auth.uid()", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration();
  let signIns = 0;
  let signups = 0;
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
    createCoachRegistration: async (payload, expectedUserId) => {
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
    createUserRegistration: async () => {
      userMembershipWrites += 1;
      assert.fail("Registro Coach no puede crear membresía Usuario");
    },
  }));

  assert.equal(signIns, 0);
  assert.equal(signups, 0);
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
  let signups = 0;
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => ({ kind: "authenticated", identity: userA }),
    signUpForCoachRegistration: async () => {
      signups += 1;
      return { kind: "authenticated", identity: userA };
    },
  }));

  assert.equal(result.state, "coach_authorized");
  assert.equal(signups, 0);
  if (result.state === "coach_authorized") assert.equal(result.userId, "user-a");
});

test("cuenta Coach nueva sin sesión conserva confirmación y no concede acceso por metadata", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  let writes = 0;
  let signupPayload: unknown;
  const result = await controller.registerCoach(coachInput, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => ({ kind: "invalid_credentials" }),
    signUpForCoachRegistration: async (payload) => {
      signupPayload = payload;
      return { kind: "confirmation_required" };
    },
    createCoachRegistration: async () => {
      writes += 1;
      assert.fail("no debe escribir sin auth.uid() autenticado");
    },
  }));

  assert.equal(result.state, "coach_confirmation_required");
  assert.equal(writes, 0);
  const serialized = JSON.stringify(signupPayload);
  for (const forbidden of ["professional_title", "role", "is_coach", "user_id"] as const) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} no debe concederse por Auth metadata`);
  }
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

test("B existente con contraseña incorrecta no crea Coach y conserva el mensaje aprobado", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  let coachLookups = 0;
  let writes = 0;
  let activations = 0;
  const result = await controller.registerCoach({
    ...coachInput,
    auth: { ...coachInput.auth, email: userB.email! },
  }, owner, createGateway({
    getCurrentIdentity: async () => null,
    signInForCoachRegistration: async () => ({ kind: "invalid_credentials" }),
    signUpForCoachRegistration: async () => ({ kind: "existing_identity" }),
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
  }));

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "coach",
    field: "register-email",
    message: "Este correo ya está registrado. Inicia sesión con esa cuenta para agregar el acceso Coach.",
  });
  assert.equal(coachLookups, 0);
  assert.equal(writes, 0);
  assert.equal(activations, 0);
});

test("B existente con contraseña correcta crea y activa sólo la membresía Coach B", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration(null);
  const inputB: CoachRegistrationPreparationPayload = {
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
    },
  };
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

test("doble submit Coach comparte un owner síncrono", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const { owner } = beginCurrentRegistration();
  let release!: (identity: AuthenticatedPortalIdentity<TestAuthState>) => void;
  const pendingIdentity = new Promise<AuthenticatedPortalIdentity<TestAuthState>>((resolve) => {
    release = resolve;
  });
  let identityReads = 0;
  const gateway = createGateway({
    getCurrentIdentity: async () => {
      identityReads += 1;
      return pendingIdentity;
    },
  });

  const first = controller.registerCoach(coachInput, owner, gateway);
  const second = await controller.registerCoach(coachInput, owner, gateway);
  assert.deepEqual(second, { state: "busy", requestedPortal: "coach" });
  assert.equal(identityReads, 1);

  release(userA);
  assert.equal((await first).state, "coach_authorized");
});

test("nuevo submit invalida al anterior y su finally no libera el owner nuevo", async () => {
  const controller = createMultiportalAuthController<TestAuthState>();
  const owners = createCoachRegistrationOwnerController();
  owners.acceptIdentity(userA.userId);
  const ownerA = owners.begin();
  const firstLookupStarted = createDeferred<void>();
  const firstLookup = createDeferred<AuthenticatedPortalIdentity<TestAuthState> | null>();
  const first = controller.registerCoach(coachInput, ownerA, createGateway({
    getCurrentIdentity: async () => {
      firstLookupStarted.resolve();
      return firstLookup.promise;
    },
  }));
  await firstLookupStarted.promise;

  const ownerReplacement = owners.begin();
  const second = await controller.registerCoach(coachInput, ownerReplacement, createGateway());
  assert.equal(second.state, "coach_authorized");
  assert.equal(ownerReplacement.isCurrent(), true);

  firstLookup.resolve(userA);
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
