import assert from "node:assert/strict";
import test from "node:test";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import {
  AUTH_REGISTRATION_PORTAL_METADATA_KEY,
  type CoachRegistrationPreparationPayload,
  type CoachRegistrationWritePayload,
  type ConfirmationRegistrationSignupPayload,
  type UserSignupPayload,
} from "@/features/auth/model/auth-form";
import {
  createSupabaseMultiportalAuthGateway,
} from "@/features/auth/data/supabase-multiportal-auth-gateway";
import {
  createMultiportalAuthController,
  MULTIPORTAL_AUTH_ERROR_MESSAGE,
  MULTIPORTAL_AUTH_RETRYABLE_MESSAGE,
} from "@/features/auth/model/multiportal-auth-controller";
import {
  createCoachRegistrationOwnerController,
  createPortalResolutionOwnerController,
  createUserRegistrationOwnerController,
} from "@/features/auth/model/portal-resolution-owner";
import {
  getInitialSupabaseSession,
  type SupabaseSessionState,
} from "@/lib/supabase/session";
import {
  SupabasePrincipalIdentityCoordinationUnavailableError,
  runSupabasePrincipalIdentityOperation,
} from "@/lib/supabase/auth-identity-operation";
import { initializeSupabaseBrowserAuthIfCoordinated } from "@/lib/supabase/client";

const users = {
  "user-a": { id: "user-a", email: "coach-a@example.com" } as User,
  "user-b": { id: "user-b", email: "coach-b@example.com" } as User,
} as const;

type TestUserId = keyof typeof users;

const registration: CoachRegistrationWritePayload = {
  first_name: "Coach",
  last_name: "Uno",
  birth_date: "1990-01-01",
  gender: "male",
  phone_number: "+56912345678",
  professional_title: "Preparador físico",
  contact_email: "contacto-usuario@example.net",
};

const signupPayload: UserSignupPayload = {
  email: "coach-a@example.com",
  password: "segura123",
  options: {
    data: {
      display_name: "Coach Uno",
      first_name: registration.first_name,
      last_name: registration.last_name,
      birth_date: registration.birth_date,
      gender: registration.gender,
      phone_number: registration.phone_number,
    },
  },
};

const coachSignupPayload: CoachRegistrationPreparationPayload = {
  auth: signupPayload,
  registration,
};

function registrationRow(userId: TestUserId, suffix: string) {
  return {
    user_id: userId,
    created_at: `2026-08-16T12:00:0${suffix === "A" ? "1" : "2"}.000Z`,
    first_name: `Coach ${suffix}`,
    last_name: `Apellido ${suffix}`,
    birth_date: "1990-01-01",
    gender: "male",
    phone_number: `+5690000000${suffix}`,
    professional_title: `Título ${suffix}`,
    contact_email: `contacto-${suffix.toLowerCase()}@example.net`,
  };
}

function mappedRegistrationRow(row: ReturnType<typeof registrationRow>) {
  return {
    userId: row.user_id,
    createdAt: row.created_at,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    gender: row.gender,
    phoneNumber: row.phone_number,
    professionalTitle: row.professional_title,
    contactEmail: row.contact_email,
  };
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

interface StatefulFakeInput {
  activeUserId?: TestUserId | null;
  rows?: ReadonlyArray<ReturnType<typeof registrationRow>>;
  userRows?: ReadonlyArray<{ user_id: TestUserId }>;
  beforeGetUser?(): void | Promise<void>;
  beforeGetSession?(): void | Promise<void>;
  beforeRpc?(): void | Promise<void>;
  onFilterAttempt?(): void;
  selectError?: unknown;
  selectedRowOverride?: unknown;
  coachRpcRowOverride?: unknown;
  signOutError?: unknown;
}

function createStatefulFakeClient(input: StatefulFakeInput = {}) {
  let activeUserId: TestUserId | null = input.activeUserId ?? "user-a";
  const rows = new Map<TestUserId, ReturnType<typeof registrationRow>>(
    (input.rows ?? []).map((row) => [row.user_id, row]),
  );
  const userRows = new Map<TestUserId, { user_id: TestUserId }>(
    (input.userRows ?? []).map((row) => [row.user_id, row]),
  );
  const insertedPayloads: unknown[] = [];
  const insertedUserIds: TestUserId[] = [];
  const readOwners: Array<TestUserId | null> = [];
  const signOutOptions: unknown[] = [];
  const rpcPayloads: unknown[] = [];
  let relationReads = 0;
  let identityReads = 0;
  let sessionReads = 0;
  let rpcAttempts = 0;
  let setSessionAttempts = 0;
  const setSessionUserIds: TestUserId[] = [];

  function currentUser() {
    return activeUserId ? users[activeUserId] : null;
  }

  const auth = {
    getUser: async () => {
      identityReads += 1;
      await input.beforeGetUser?.();
      return { data: { user: currentUser() }, error: null };
    },
    getSession: async () => {
      sessionReads += 1;
      await input.beforeGetSession?.();
      const user = currentUser();
      const session = user
        ? { user, access_token: `test-${user.id}`, refresh_token: `test-${user.id}` } as Session
        : null;
      return { data: { session }, error: null };
    },
    signInWithPassword: async () => assert.fail("signIn inesperado"),
    signUp: async () => assert.fail("signUp inesperado"),
    setSession: async ({ access_token }: { access_token: string }) => {
      setSessionAttempts += 1;
      const nextUserId: TestUserId = access_token.endsWith("user-a") ? "user-a" : "user-b";
      setSessionUserIds.push(nextUserId);
      activeUserId = nextUserId;
      const user = users[nextUserId];
      return {
        data: {
          user,
          session: {
            user,
            access_token: `test-${nextUserId}`,
            refresh_token: `test-${nextUserId}`,
          } as Session,
        },
        error: null,
      };
    },
    signOut: async (options: unknown) => {
      signOutOptions.push(options);
      if (input.signOutError) return { error: input.signOutError };
      activeUserId = null;
      return { error: null };
    },
  };

  const from = (relation: string) => {
    assert.ok(
      relation === "coach_registrations" || relation === "user_registrations",
      `relación Auth inesperada: ${relation}`,
    );
    relationReads += 1;
    const selectedRows = relation === "coach_registrations" ? rows : userRows;
    return {
      select: () => ({
        eq: () => {
          input.onFilterAttempt?.();
          return {
            maybeSingle: async () => ({
              data: activeUserId ? selectedRows.get(activeUserId) ?? null : null,
              error: null,
            }),
          };
        },
        maybeSingle: async () => {
          readOwners.push(activeUserId);
          return {
            data: input.selectedRowOverride !== undefined
              ? input.selectedRowOverride
              : activeUserId ? selectedRows.get(activeUserId) ?? null : null,
            error: input.selectError ?? null,
          };
        },
      }),
    };
  };

  const rpc = async (functionName: string, payload: Record<string, unknown> = {}) => {
    assert.ok(
      functionName === "register_own_coach" || functionName === "register_own_user",
      `RPC Auth inesperada: ${functionName}`,
    );
    rpcAttempts += 1;
    rpcPayloads.push(payload);
    const jwtUserId = activeUserId;
    await input.beforeRpc?.();
    if (functionName === "register_own_user") {
      if (!jwtUserId || Object.keys(payload).length > 0) {
        return { data: null, error: { code: "42501", message: "RLS/ACL" } };
      }
      const existingUserRegistration = userRows.get(jwtUserId);
      if (existingUserRegistration) return { data: existingUserRegistration, error: null };
      const row = { user_id: jwtUserId };
      insertedUserIds.push(jwtUserId);
      userRows.set(jwtUserId, row);
      return { data: row, error: null };
    }
    const expectedKeys = [
      "p_first_name",
      "p_last_name",
      "p_birth_date",
      "p_gender",
      "p_phone_number",
      "p_professional_title",
      "p_contact_email",
    ];
    if (
      !jwtUserId
      || !userRows.has(jwtUserId)
      || Object.keys(payload).length !== expectedKeys.length
      || Object.keys(payload).some((key) => !expectedKeys.includes(key))
    ) {
      return { data: null, error: { code: "42501", message: "RLS/ACL" } };
    }
    if (input.coachRpcRowOverride !== undefined) {
      return { data: input.coachRpcRowOverride, error: null };
    }
    const existing = rows.get(jwtUserId);
    if (existing) return { data: existing, error: null };
    const writePayload: CoachRegistrationWritePayload = {
      first_name: String(payload.p_first_name),
      last_name: String(payload.p_last_name),
      birth_date: String(payload.p_birth_date),
      gender: payload.p_gender as CoachRegistrationWritePayload["gender"],
      phone_number: String(payload.p_phone_number),
      professional_title: String(payload.p_professional_title),
      contact_email: String(payload.p_contact_email),
    };
    insertedPayloads.push(writePayload);
    const row = {
      user_id: jwtUserId,
      created_at: "2026-08-16T12:00:00.000Z",
      ...writePayload,
    };
    rows.set(jwtUserId, row);
    return { data: row, error: null };
  };

  return {
    client: { auth, from, rpc } as unknown as SupabaseClient,
    get activeUserId() {
      return activeUserId;
    },
    setActiveUserId(userId: TestUserId | null) {
      activeUserId = userId;
    },
    rows,
    userRows,
    insertedPayloads,
    insertedUserIds,
    readOwners,
    signOutOptions,
    rpcPayloads,
    get relationReads() {
      return relationReads;
    },
    get identityReads() {
      return identityReads;
    },
    get sessionReads() {
      return sessionReads;
    },
    get rpcAttempts() {
      return rpcAttempts;
    },
    get setSessionAttempts() {
      return setSessionAttempts;
    },
    setSessionUserIds,
  };
}

function beginRegistrationOwner(userId: TestUserId | null) {
  const owners = createCoachRegistrationOwnerController();
  if (userId) owners.acceptIdentity(userId);
  return { owners, owner: owners.begin() };
}

function beginUserRegistrationOwner(userId: TestUserId | null) {
  const owners = createUserRegistrationOwnerController();
  if (userId) owners.acceptIdentity(userId);
  return { owners, owner: owners.begin() };
}

function beginPortalOwner(userId: TestUserId) {
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity(userId);
  return { owners, owner: owners.begin(userId) };
}

function createPortalAuthFailureClient(input: {
  failureSource: "getUser" | "getSession";
  status: number;
  localUserId?: TestUserId | null;
}) {
  let localUserId: TestUserId | null = input.localUserId ?? "user-a";
  let getUserCalls = 0;
  let getSessionCalls = 0;
  const signOutOptions: unknown[] = [];
  const terminalError = Object.assign(new Error(`Auth ${input.status}`), {
    status: input.status,
  });

  const auth = {
    getUser: async () => {
      getUserCalls += 1;
      if (input.failureSource === "getUser" && getUserCalls === 1) {
        return { data: { user: null }, error: terminalError };
      }
      return {
        data: { user: localUserId ? users[localUserId] : null },
        error: null,
      };
    },
    getSession: async () => {
      getSessionCalls += 1;
      if (input.failureSource === "getSession" && getSessionCalls === 1) {
        return { data: { session: null }, error: terminalError };
      }
      const user = localUserId ? users[localUserId] : null;
      return {
        data: {
          session: user
            ? {
              user,
              access_token: `local-${user.id}`,
              refresh_token: `local-refresh-${user.id}`,
            } as Session
            : null,
        },
        error: null,
      };
    },
    signOut: async (options: unknown) => {
      signOutOptions.push(options);
      localUserId = null;
      return { error: null };
    },
  };

  return {
    client: { auth } as unknown as SupabaseClient,
    signOutOptions,
    get getUserCalls() {
      return getUserCalls;
    },
    get getSessionCalls() {
      return getSessionCalls;
    },
    get localUserId() {
      return localUserId;
    },
  };
}

test("payload Coach focal conserva sólo datos profesionales allowlisted", () => {
  assert.deepEqual(Object.keys(registration), [
    "first_name",
    "last_name",
    "birth_date",
    "gender",
    "phone_number",
    "professional_title",
    "contact_email",
  ]);
});

test("fake stateful A/B materializa lectura own-only y bloquea selección cruzada", async () => {
  let filterAttempts = 0;
  const fake = createStatefulFakeClient({
    rows: [registrationRow("user-a", "A"), registrationRow("user-b", "B")],
    onFilterAttempt: () => { filterAttempts += 1; },
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);

  fake.setActiveUserId("user-a");
  assert.deepEqual(
    await gateway.getCoachRegistration("user-a"),
    mappedRegistrationRow(registrationRow("user-a", "A")),
  );
  assert.deepEqual(fake.readOwners, ["user-a"]);

  fake.setActiveUserId("user-b");
  assert.deepEqual(
    await gateway.getCoachRegistration("user-b"),
    mappedRegistrationRow(registrationRow("user-b", "B")),
  );
  assert.deepEqual(fake.readOwners, ["user-a", "user-b"]);

  const readsBeforeCrossAttempt = fake.relationReads;
  await assert.rejects(
    gateway.getCoachRegistration("user-a"),
    /identidad autenticada cambió/,
  );
  assert.equal(fake.relationReads, readsBeforeCrossAttempt, "B no alcanza SELECT al declarar expectedUserId A");
  assert.equal(filterAttempts, 0, "el cliente no controla user_id mediante filtros");
});

test("membresía Usuario se lee own-only y profiles no participa de la autorización", async () => {
  let filterAttempts = 0;
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    userRows: [{ user_id: "user-a" }],
    onFilterAttempt: () => { filterAttempts += 1; },
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);

  assert.equal(await gateway.hasUserRegistration("user-a"), true);
  assert.deepEqual(fake.readOwners, ["user-a"]);
  assert.equal(fake.relationReads, 1);

  fake.setActiveUserId("user-b");
  assert.equal(await gateway.hasUserRegistration("user-b"), false);
  assert.deepEqual(fake.readOwners, ["user-a", "user-b"]);
  await assert.rejects(
    gateway.hasUserRegistration("user-a"),
    /identidad autenticada cambió/,
  );
  assert.equal(filterAttempts, 0, "el cliente no puede elegir user_id mediante filtros");
});

test("RPC Usuario deriva ownership del JWT, no recibe payload y es idempotente", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-b" });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginUserRegistrationOwner("user-b");

  const first = await gateway.createUserRegistration("user-b", owner);
  const second = await gateway.createUserRegistration("user-b", owner);

  assert.deepEqual(first, { userId: "user-b" });
  assert.deepEqual(second, first);
  assert.deepEqual(fake.insertedUserIds, ["user-b"]);
  assert.deepEqual(fake.rpcPayloads, [{}, {}], "el cliente no envía user_id ni otro ownership");
  assert.equal(fake.userRows.size, 1);
  assert.equal(fake.rows.size, 0, "Registro Usuario no crea membresía Coach");

  await assert.rejects(
    gateway.createUserRegistration("user-a", owner),
    /operación de registro ya no está vigente/,
  );
  assert.equal(fake.userRows.has("user-a"), false, "B nunca puede crear la fila Usuario de A");
});

test("signIn Usuario aislado tardío no reemplaza la sesión global B", async () => {
  const main = createStatefulFakeClient({ activeUserId: "user-b" });
  const isolated = createStatefulFakeClient({ activeUserId: null });
  const signInStarted = createDeferred<void>();
  const signInResult = createDeferred<{
    data: { user: User; session: Session };
    error: null;
  }>();
  (isolated.client.auth as unknown as {
    signInWithPassword: () => Promise<{
      data: { user: User; session: Session };
      error: null;
    }>;
  }).signInWithPassword = async () => {
    signInStarted.resolve();
    return signInResult.promise;
  };
  const owners = createUserRegistrationOwnerController();
  const ownerA = owners.begin();
  const gateway = createSupabaseMultiportalAuthGateway(main.client, {
    createRegistrationClient: () => isolated.client,
  });

  const pending = gateway.signInForUserRegistration({
    email: users["user-a"].email!,
    password: "segura123",
  }, ownerA);
  await signInStarted.promise;
  owners.acceptIdentity("user-b");
  isolated.setActiveUserId("user-a");
  signInResult.resolve({
    data: {
      user: users["user-a"],
      session: {
        user: users["user-a"],
        access_token: "test-user-a",
        refresh_token: "test-user-a",
      } as Session,
    },
    error: null,
  });

  assert.deepEqual(await pending, { kind: "stale" });
  assert.equal(main.activeUserId, "user-b");
  assert.equal(main.rpcAttempts, 0);
});

test("H1 · identidad Usuario aislada A no reemplaza una sesión global B vigente", async () => {
  const main = createStatefulFakeClient({ activeUserId: "user-b" });
  const gateway = createSupabaseMultiportalAuthGateway(main.client);
  const owners = createUserRegistrationOwnerController();
  const ownerA = owners.begin();
  assert.equal(ownerA.bindExpectedUserId("user-a"), true);

  const isolatedSessionA = {
    user: users["user-a"],
    access_token: "test-user-a",
    refresh_token: "test-user-a",
  } as Session;
  const isolatedIdentityA = {
    userId: "user-a",
    email: users["user-a"].email ?? null,
    authState: {
      isConfigured: true,
      dataMode: "supabase" as const,
      session: isolatedSessionA,
      user: users["user-a"],
    },
  };
  const globalIdentityBefore = await gateway.getCurrentIdentity("user-b");
  const activatedIdentity = await gateway.activateUserRegistrationIdentity(
    isolatedIdentityA,
    ownerA,
  );
  const consumerEffects = {
    navigation: 0,
    messages: 0,
    authorizations: 0,
    publications: 0,
  };
  if (activatedIdentity) {
    consumerEffects.navigation += 1;
    consumerEffects.authorizations += 1;
    consumerEffects.publications += 1;
  }
  const globalIdentityAfter = await gateway.getCurrentIdentity("user-b");

  assert.deepEqual(
    {
      globalUserBefore: globalIdentityBefore?.userId ?? null,
      isolatedUser: isolatedIdentityA.userId,
      activation: activatedIdentity,
      setSessionAttempts: main.setSessionAttempts,
      setSessionUserIds: main.setSessionUserIds,
      activeGlobalUserAfter: main.activeUserId,
      globalUserAfter: globalIdentityAfter?.userId ?? null,
      consumerEffects,
      userMembershipAppliedByA: main.userRows.has("user-a"),
      coachMembershipAppliedByA: main.rows.has("user-a"),
    },
    {
      globalUserBefore: "user-b",
      isolatedUser: "user-a",
      activation: null,
      setSessionAttempts: 0,
      setSessionUserIds: [],
      activeGlobalUserAfter: "user-b",
      globalUserAfter: "user-b",
      consumerEffects: {
        navigation: 0,
        messages: 0,
        authorizations: 0,
        publications: 0,
      },
      userMembershipAppliedByA: false,
      coachMembershipAppliedByA: false,
    },
    "[AUTH-COACH-01.USER.H1.global-session-preserved]",
  );
});

test("H2 · owner Usuario stale no inicia write y B completa después su propio flujo", async () => {
  const main = createStatefulFakeClient({ activeUserId: "user-b" });
  const gateway = createSupabaseMultiportalAuthGateway(main.client);
  const controller = createMultiportalAuthController<SupabaseSessionState>();
  const owners = createUserRegistrationOwnerController();
  owners.acceptIdentity("user-a");
  const ownerA = owners.begin();
  owners.acceptIdentity("user-b");
  const ownerWasStaleBeforeWrite = !ownerA.isCurrent();

  let staleWriteError: unknown = null;
  try {
    await gateway.createUserRegistration("user-a", ownerA);
  } catch (error) {
    staleWriteError = error;
  }
  const rpcAttemptsAfterA = main.rpcAttempts;
  const userRowsAfterA = [...main.userRows.keys()];

  const ownerB = owners.begin();
  const resultB = await controller.registerUser({
    email: users["user-b"].email!,
    password: "segura123",
    options: {
      data: {
        display_name: "Usuario B",
        first_name: "Usuario",
        last_name: "B",
        birth_date: "1990-01-01",
        gender: "prefer_not_to_say",
        phone_number: "+56900000002",
      },
    },
  }, ownerB, gateway);

  assert.deepEqual(
    {
      ownerWasStaleBeforeWrite,
      staleWriteError: staleWriteError instanceof Error
        ? { name: staleWriteError.name, message: staleWriteError.message }
        : null,
      rpcAttemptsAfterA,
      userRowsAfterA,
      aEffects: {
        writes: rpcAttemptsAfterA,
        navigation: 0,
        messages: 0,
        publications: 0,
        authorizations: 0,
      },
      resultB: resultB.state === "user_authorized"
        ? { state: resultB.state, userId: resultB.userId }
        : { state: resultB.state, userId: null },
      finalActiveUser: main.activeUserId,
      finalUserRows: [...main.userRows.keys()],
      totalRpcAttempts: main.rpcAttempts,
      setSessionAttempts: main.setSessionAttempts,
    },
    {
      ownerWasStaleBeforeWrite: true,
      staleWriteError: {
        name: "MultiportalAuthRepositoryError",
        message: "La operación de registro ya no está vigente.",
      },
      rpcAttemptsAfterA: 0,
      userRowsAfterA: [],
      aEffects: {
        writes: 0,
        navigation: 0,
        messages: 0,
        publications: 0,
        authorizations: 0,
      },
      resultB: { state: "user_authorized", userId: "user-b" },
      finalActiveUser: "user-b",
      finalUserRows: ["user-b"],
      totalRpcAttempts: 1,
      setSessionAttempts: 0,
    },
    "[AUTH-COACH-01.USER.H2.stale-owner-prewrite]",
  );
});

test("H3 · fila Usuario cruzada B al solicitar A falla cerrada y sanitizada", async () => {
  const direct = createStatefulFakeClient({
    activeUserId: "user-a",
    selectedRowOverride: { user_id: "user-b" },
  });
  const directGateway = createSupabaseMultiportalAuthGateway(direct.client);
  const directOwner = beginPortalOwner("user-a").owner;
  let directValue: boolean | null = null;
  let directError: unknown = null;
  try {
    directValue = await directGateway.hasUserRegistration("user-a", directOwner);
  } catch (error) {
    directError = error;
  }

  const flow = createStatefulFakeClient({
    activeUserId: "user-a",
    selectedRowOverride: { user_id: "user-b" },
  });
  const flowGateway = createSupabaseMultiportalAuthGateway(flow.client);
  const flowOwner = beginPortalOwner("user-a").owner;
  const result = await createMultiportalAuthController<SupabaseSessionState>().resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: "user-a",
    owner: flowOwner,
  }, flowGateway);
  const accessEffects = {
    authorizations: 0,
    publications: 0,
    navigation: 0,
    stateA: 0,
    stateB: 0,
  };
  if (result.state === "user_authorized") {
    accessEffects.authorizations += 1;
    accessEffects.publications += 1;
    accessEffects.navigation += 1;
    if (result.userId === "user-a") accessEffects.stateA += 1;
    if (result.userId === "user-b") accessEffects.stateB += 1;
  }
  const directErrorMessage = directError instanceof Error ? directError.message : null;

  assert.deepEqual(
    {
      requestedUser: "user-a",
      backendRowUser: "user-b",
      directValue,
      directError: directError instanceof Error
        ? { name: directError.name, message: directError.message }
        : null,
      leakedInternalDetail: directErrorMessage === null
        || /user-[ab]|user_registrations|pgrst|postgres|select\s|rpc/i.test(directErrorMessage),
      result: result.state === "error"
        ? { state: result.state, message: result.message }
        : { state: result.state, message: null },
      accessEffects,
      signOuts: flow.signOutOptions,
      activeUserAfterRejection: flow.activeUserId,
      writes: flow.rpcAttempts,
    },
    {
      requestedUser: "user-a",
      backendRowUser: "user-b",
      directValue: null,
      directError: {
        name: "MultiportalAuthRepositoryError",
        message: "La autorización Usuario no pertenece a la sesión.",
      },
      leakedInternalDetail: false,
      result: { state: "error", message: MULTIPORTAL_AUTH_ERROR_MESSAGE },
      accessEffects: {
        authorizations: 0,
        publications: 0,
        navigation: 0,
        stateA: 0,
        stateB: 0,
      },
      signOuts: [{ scope: "local" }],
      activeUserAfterRejection: null,
      writes: 0,
    },
    "[AUTH-COACH-01.USER.H3.crossed-row-rejected]",
  );
});

test("E9 · forma productiva con owner vigente retorna la fila sólo después del SELECT propio", async () => {
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    rows: [registrationRow("user-a", "A")],
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginPortalOwner("user-a");

  assert.deepEqual(
    await gateway.getCoachRegistration("user-a", owner),
    mappedRegistrationRow(registrationRow("user-a", "A")),
    "[AUTH-COACH-01.E9.owner-select-runtime] owner vigente sólo autoriza con fila SELECT propia",
  );
  assert.equal(
    fake.relationReads,
    1,
    "[AUTH-COACH-01.E9.owner-select-runtime] true no puede anticiparse a la lectura autoritativa",
  );
  assert.deepEqual(fake.readOwners, ["user-a"]);
  assert.equal(fake.identityReads, 2, "la identidad se valida antes y después del SELECT");
  assert.equal(fake.sessionReads, 2, "la sesión se valida antes y después del SELECT");
});

test("E9 · forma productiva con owner vigente retorna null cuando no existe fila", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a", rows: [] });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginPortalOwner("user-a");

  assert.equal(
    await gateway.getCoachRegistration("user-a", owner),
    null,
    "[AUTH-COACH-01.E9.owner-select-runtime] owner por sí solo nunca concede acceso Coach",
  );
  assert.equal(fake.relationReads, 1, "E9 ejecuta exactamente el SELECT own-only");
  assert.deepEqual(fake.readOwners, ["user-a"]);
});

test("E9 · owner stale falla cerrado antes de lecturas o efectos", async () => {
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    rows: [registrationRow("user-a", "A")],
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owners, owner } = beginPortalOwner("user-a");
  owners.invalidate();

  await assert.rejects(
    gateway.getCoachRegistration("user-a", owner),
    /identidad autenticada cambió/,
    "[AUTH-COACH-01.E9.stale-owner-runtime] un owner stale no autoriza",
  );
  assert.equal(fake.identityReads, 0, "owner stale no alcanza getUser");
  assert.equal(fake.sessionReads, 0, "owner stale no alcanza getSession");
  assert.equal(fake.relationReads, 0, "owner stale no alcanza SELECT");
  assert.equal(fake.rpcAttempts, 0, "owner stale no alcanza writes");
  assert.deepEqual(fake.insertedPayloads, []);
  assert.deepEqual(fake.signOutOptions, []);
});

test("E9 · expectedUserId distinto de la sesión falla cerrado antes del SELECT", async () => {
  const fake = createStatefulFakeClient({
    activeUserId: "user-b",
    rows: [registrationRow("user-a", "A"), registrationRow("user-b", "B")],
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginPortalOwner("user-a");

  await assert.rejects(
    gateway.getCoachRegistration("user-a", owner),
    /identidad autenticada cambió/,
    "[AUTH-COACH-01.E9.identity-mismatch-runtime] expectedUserId ajeno no autoriza",
  );
  assert.equal(fake.identityReads, 1);
  assert.equal(fake.sessionReads, 0);
  assert.equal(fake.relationReads, 0, "la identidad cruzada no alcanza SELECT");
});

test("E9 · respuesta SELECT errónea, cruzada o malformada falla cerrado con owner vigente", async () => {
  const cases = [
    {
      name: "error backend",
      fake: createStatefulFakeClient({ activeUserId: "user-a", selectError: { code: "XX000" } }),
    },
    {
      name: "fila malformada",
      fake: createStatefulFakeClient({
        activeUserId: "user-a",
        selectedRowOverride: { user_id: "user-a" },
      }),
    },
    {
      name: "fila sin correo de contacto",
      fake: createStatefulFakeClient({
        activeUserId: "user-a",
        selectedRowOverride: {
          ...registrationRow("user-a", "A"),
          contact_email: undefined,
        },
      }),
    },
    {
      name: "fila de otro owner",
      fake: createStatefulFakeClient({
        activeUserId: "user-a",
        selectedRowOverride: registrationRow("user-b", "B"),
      }),
    },
  ] as const;
  assert.equal(cases.length, 4, "E9 fija error, respuestas malformadas y respuesta cruzada");

  for (const { name, fake } of cases) {
    const gateway = createSupabaseMultiportalAuthGateway(fake.client);
    const { owner } = beginPortalOwner("user-a");
    await assert.rejects(
      gateway.getCoachRegistration("user-a", owner),
      `[AUTH-COACH-01.E9.invalid-response-runtime] ${name} debe fallar cerrado`,
    );
    assert.equal(fake.relationReads, 1, `${name} sí materializa el SELECT autoritativo`);
  }
});

/* AUTH-SEPARATE-01 removes the browser Coach write/sign-in ports exercised by
 * the historical tests below. Executable replacement follows this block.
test("límite atómico simulado separa JWT efectivo de expectedUserId", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const ownerA = beginRegistrationOwner("user-a").owner;

  const rowA = await gateway.createCoachRegistration(registration, "user-a", ownerA);
  assert.equal(rowA.userId, "user-a", "JWT A + expected A permitido");

  fake.setActiveUserId("user-b");
  await assert.rejects(
    gateway.createCoachRegistration(registration, "user-a", ownerA),
    /registrar el acceso Coach/,
    "JWT B + expected A es rechazado por la RPC sin INSERT B",
  );
  assert.equal(fake.rows.has("user-b"), false);

  const ownerB = beginRegistrationOwner("user-b").owner;
  const rowB = await gateway.createCoachRegistration(registration, "user-b", ownerB);
  assert.equal(rowB.userId, "user-b", "JWT B + expected B permitido");
  assert.deepEqual(fake.insertedPayloads, [registration, registration]);

  const duplicateB = await gateway.createCoachRegistration(registration, "user-b", ownerB);
  assert.deepEqual(duplicateB, rowB, "duplicado propio es idempotente");
  assert.equal(fake.rows.size, 2, "duplicado cruzado es imposible");

  fake.setActiveUserId(null);
  const noJwtOwner = beginRegistrationOwner("user-b").owner;
  await assert.rejects(
    gateway.createCoachRegistration(registration, "user-b", noJwtOwner),
    /registrar el acceso Coach/,
    "sin JWT se rechaza",
  );

  const directBackdoor = {
    ...toCoachRegistrationRpcPayload(registration, "user-b"),
    user_id: "user-a",
  };
  fake.setActiveUserId("user-b");
  const directResult = await (fake.client.rpc as unknown as (
    name: string,
    payload: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>)("register_own_coach", directBackdoor);
  assert.notEqual(directResult.error, null, "user_id inyectado es rechazado por ACL simulada");
});

test("signIn Coach aislado no reemplaza la sesión global B cuando A queda stale", async () => {
  const main = createStatefulFakeClient({ activeUserId: "user-b" });
  const isolated = createStatefulFakeClient({ activeUserId: null });
  const signInStarted = createDeferred<void>();
  const signInResult = createDeferred<{
    data: { user: User; session: Session };
    error: null;
  }>();
  (isolated.client.auth as unknown as {
    signInWithPassword: () => Promise<{
      data: { user: User; session: Session };
      error: null;
    }>;
  }).signInWithPassword = async () => {
    signInStarted.resolve();
    return signInResult.promise;
  };
  const owners = createCoachRegistrationOwnerController();
  const ownerA = owners.begin();
  const gateway = createSupabaseMultiportalAuthGateway(main.client, {
    createRegistrationClient: () => isolated.client,
  });

  const pending = gateway.signInForCoachRegistration({
    email: users["user-a"].email!,
    password: "segura123",
  }, ownerA);
  await signInStarted.promise;
  owners.acceptIdentity("user-b");
  isolated.setActiveUserId("user-a");
  signInResult.resolve({
    data: {
      user: users["user-a"],
      session: {
        user: users["user-a"],
        access_token: "test-user-a",
        refresh_token: "test-user-a",
      } as Session,
    },
    error: null,
  });

  assert.deepEqual(await pending, { kind: "stale" });
  assert.equal(main.activeUserId, "user-b", "la autenticación aislada de A no toca B");
  assert.equal(main.rpcAttempts, 0);
});

test("insert de B deriva ownership de la identidad autoritativa y nunca del formulario", async () => {
  const rowA = registrationRow("user-a", "A");
  const fake = createStatefulFakeClient({ activeUserId: "user-b", rows: [rowA] });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginRegistrationOwner("user-b");
  const malicious = {
    ...registration,
    user_id: "user-a",
    owner_id: "user-a",
    profile_id: "user-a",
    roles: ["admin"],
    privileges: ["all"],
  } as CoachRegistrationWritePayload;

  const result = await gateway.createCoachRegistration(malicious, "user-b", owner);
  assert.deepEqual(fake.insertedPayloads, [registration]);
  assert.equal(result.userId, "user-b");
  assert.equal(fake.rows.get("user-b")?.user_id, "user-b");
  assert.deepEqual(fake.rows.get("user-a"), rowA, "la fila A queda intacta");

  const insertsBeforeCrossAttempt = fake.rpcAttempts;
  await assert.rejects(
    gateway.createCoachRegistration(malicious, "user-a", owner),
    /operación de registro ya no está vigente/,
  );
  assert.equal(fake.rpcAttempts, insertsBeforeCrossAttempt, "B no alcanza RPC declarando ownership A");
});

test("duplicar el registro de B conserva idempotencia y relee sólo la fila B", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-b" });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginRegistrationOwner("user-b");

  const first = await gateway.createCoachRegistration(registration, "user-b", owner);
  const second = await gateway.createCoachRegistration(registration, "user-b", owner);

  assert.equal(first.userId, "user-b");
  assert.deepEqual(second, first);
  assert.equal(fake.rpcAttempts, 2);
  assert.deepEqual(fake.readOwners, [], "la RPC idempotente devuelve la fila propia en la misma operación");
  assert.equal(fake.rows.size, 1);
});

for (const operation of ["read", "write"] as const) {
  test(`cambio de identidad A→B durante ${operation} bloquea ownership A antes del efecto`, async () => {
    const lookupStarted = createDeferred<void>();
    const releaseLookup = createDeferred<void>();
    let shouldPause = true;
    const fake = createStatefulFakeClient({
      activeUserId: "user-a",
      rows: [registrationRow("user-a", "A"), registrationRow("user-b", "B")],
      async beforeGetUser() {
        if (operation !== "read") return;
        if (!shouldPause) return;
        shouldPause = false;
        lookupStarted.resolve(undefined);
        await releaseLookup.promise;
      },
      async beforeRpc() {
        if (operation !== "write" || !shouldPause) return;
        shouldPause = false;
        lookupStarted.resolve(undefined);
        await releaseLookup.promise;
      },
    });
    const gateway = createSupabaseMultiportalAuthGateway(fake.client);
    const { owners, owner } = beginRegistrationOwner("user-a");
    const pending = operation === "read"
      ? gateway.getCoachRegistration("user-a")
      : gateway.createCoachRegistration(registration, "user-a", owner);

    await lookupStarted.promise;
    fake.setActiveUserId("user-b");
    owners.acceptIdentity("user-b");
    releaseLookup.resolve(undefined);

    await assert.rejects(pending, /identidad autenticada cambió|operación de registro ya no está vigente/);
    if (operation === "read") {
      assert.equal(fake.relationReads, 0, "la operación A no alcanza la relación después del cambio");
      assert.equal(fake.rpcAttempts, 0, "la operación no despachada no alcanza la RPC");
    } else {
      assert.equal(fake.rpcAttempts, 1, "la RPC ya despachada conserva el JWT A capturado");
      assert.equal(fake.rows.get("user-a")?.user_id, "user-a");
      assert.equal(fake.rows.get("user-b")?.user_id, "user-b");
    }
    assert.equal(fake.activeUserId, "user-b");
  });
}

*/

test("gateway Coach expone signUp separado y activación compartida, nunca signIn previo", () => {
  const gateway = createSupabaseMultiportalAuthGateway({} as SupabaseClient);
  assert.equal("signInForCoachRegistration" in gateway, false);
  assert.equal("createCoachRegistration" in gateway, false);
  assert.equal("signUpForCoachRegistration" in gateway, true);
  assert.equal("createSharedCoachRegistration" in gateway, true);
});

test("activación Coach compartida envía allowlist exacta sin ownership y es idempotente", async () => {
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    userRows: [{ user_id: "user-a" }],
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginRegistrationOwner("user-a");
  const malicious = {
    ...registration,
    contact_email: users["user-a"].email!,
    user_id: "user-b",
    owner_id: "user-b",
    profile_id: "user-b",
    role: "admin",
  } as CoachRegistrationWritePayload;

  const first = await gateway.createSharedCoachRegistration(malicious, "user-a", owner);
  const second = await gateway.createSharedCoachRegistration(malicious, "user-a", owner);

  assert.equal(first.userId, "user-a");
  assert.deepEqual(second, first);
  assert.deepEqual(fake.rpcPayloads, [
    {
      p_first_name: registration.first_name,
      p_last_name: registration.last_name,
      p_birth_date: registration.birth_date,
      p_gender: registration.gender,
      p_phone_number: registration.phone_number,
      p_professional_title: registration.professional_title,
      p_contact_email: users["user-a"].email,
    },
    {
      p_first_name: registration.first_name,
      p_last_name: registration.last_name,
      p_birth_date: registration.birth_date,
      p_gender: registration.gender,
      p_phone_number: registration.phone_number,
      p_professional_title: registration.professional_title,
      p_contact_email: users["user-a"].email,
    },
  ]);
  assert.equal(JSON.stringify(fake.rpcPayloads).includes("user_id"), false);
  assert.equal(JSON.stringify(fake.rpcPayloads).includes("owner_id"), false);
  assert.equal(JSON.stringify(fake.rpcPayloads).includes("profile_id"), false);
  assert.equal(JSON.stringify(fake.rpcPayloads).includes("role"), false);
  assert.equal(fake.rows.size, 1);
});

test("activación compartida falla cerrada sin membresía Usuario", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginRegistrationOwner("user-a");

  await assert.rejects(
    gateway.createSharedCoachRegistration(registration, "user-a", owner),
    /activar el acceso Coach/,
  );
  assert.equal(fake.rows.size, 0);
  assert.equal(fake.rpcAttempts, 1);
});

test("activación compartida no despacha RPC para expectedUserId ajeno", async () => {
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    userRows: [{ user_id: "user-a" }],
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginRegistrationOwner("user-a");

  await assert.rejects(
    gateway.createSharedCoachRegistration(registration, "user-b", owner),
    /operación de registro ya no está vigente/,
  );
  assert.equal(fake.rpcAttempts, 0);
});

test("activación compartida rechaza una fila RPC de otra identidad", async () => {
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    userRows: [{ user_id: "user-a" }],
    coachRpcRowOverride: registrationRow("user-b", "B"),
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginRegistrationOwner("user-a");

  await assert.rejects(
    gateway.createSharedCoachRegistration(registration, "user-a", owner),
    /confirmar el registro Coach/,
  );
  assert.equal(fake.rows.size, 0);
});

test("signOut vigente revalida A y cierra exactamente una sesión local", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity("user-a");
  const ownerA = owners.begin("user-a");
  const reasons: string[] = [];
  const gateway = createSupabaseMultiportalAuthGateway(fake.client, {
    onBeforeSignOut: (reason) => reasons.push(reason),
  });

  assert.equal(await gateway.signOut("coach_registration_required", ownerA), "signed_out");
  assert.deepEqual(fake.signOutOptions, [{ scope: "local" }]);
  assert.deepEqual(reasons, ["coach_registration_required"]);
});

test("signOut stale de A no toca la sesión vigente de B ni publica motivo", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity("user-a");
  const ownerA = owners.begin("user-a");
  owners.invalidate();
  fake.setActiveUserId("user-b");
  owners.acceptIdentity("user-b");
  const reasons: string[] = [];
  const gateway = createSupabaseMultiportalAuthGateway(fake.client, {
    onBeforeSignOut: (reason) => reasons.push(reason),
  });

  assert.equal(await gateway.signOut("coach_registration_required", ownerA), "stale");
  assert.deepEqual(fake.signOutOptions, []);
  assert.deepEqual(reasons, []);
  assert.equal(fake.activeUserId, "user-b");
});

test("rechazos Auth 401/403 cierran localmente sólo la identidad esperada", async (context) => {
  for (const candidate of [
    { name: "getUser 401", failureSource: "getUser", status: 401 },
    { name: "getSession 403", failureSource: "getSession", status: 403 },
  ] as const) {
    await context.test(candidate.name, async () => {
      const fake = createPortalAuthFailureClient(candidate);
      const gateway = createSupabaseMultiportalAuthGateway(fake.client);
      const controller = createMultiportalAuthController<SupabaseSessionState>();
      const { owner } = beginPortalOwner("user-a");

      const result = await controller.resolvePortalAccess({
        requestedPortal: "usuario",
        expectedUserId: "user-a",
        owner,
      }, gateway);

      assert.deepEqual(result, {
        state: "error",
        requestedPortal: "usuario",
        message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
      });
      assert.deepEqual(fake.signOutOptions, [{ scope: "local" }]);
      assert.equal(fake.localUserId, null);
      assert.equal(fake.getUserCalls, 1, "el rechazo terminal no se consulta de nuevo");
      assert.equal(
        fake.getSessionCalls,
        candidate.failureSource === "getSession" ? 2 : 1,
        "el cierre revalida únicamente la sesión local actual",
      );
    });
  }
});

test("fallo Auth 503 conserva la sesión y nunca invoca signOut", async () => {
  const fake = createPortalAuthFailureClient({
    failureSource: "getUser",
    status: 503,
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const controller = createMultiportalAuthController<SupabaseSessionState>();
  const { owner } = beginPortalOwner("user-a");

  const result = await controller.resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: "user-a",
    owner,
  }, gateway);

  assert.deepEqual(result, {
    state: "error",
    requestedPortal: "usuario",
    message: MULTIPORTAL_AUTH_RETRYABLE_MESSAGE,
    retryable: true,
  });
  assert.deepEqual(fake.signOutOptions, []);
  assert.equal(fake.localUserId, "user-a");
  assert.equal(fake.getSessionCalls, 0);
});

test("rechazo Auth tardío de A nunca cierra la sesión local de B", async () => {
  const fake = createPortalAuthFailureClient({
    failureSource: "getUser",
    status: 401,
    localUserId: "user-b",
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const controller = createMultiportalAuthController<SupabaseSessionState>();
  const { owner } = beginPortalOwner("user-a");

  const result = await controller.resolvePortalAccess({
    requestedPortal: "usuario",
    expectedUserId: "user-a",
    owner,
  }, gateway);

  assert.deepEqual(result, { state: "stale", requestedPortal: "usuario" });
  assert.deepEqual(fake.signOutOptions, []);
  assert.equal(fake.localUserId, "user-b");
  assert.equal(fake.getSessionCalls, 1);
});

test("signOut con owner Coach vigente revalida A y cierra exactamente la sesión local", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const { owner } = beginRegistrationOwner("user-a");
  const reasons: string[] = [];
  const gateway = createSupabaseMultiportalAuthGateway(fake.client, {
    onBeforeSignOut: (reason) => reasons.push(reason),
  });

  assert.equal(await gateway.signOut("authorization_error", owner), "signed_out");
  assert.deepEqual(fake.signOutOptions, [{ scope: "local" }]);
  assert.deepEqual(reasons, ["authorization_error"]);
  assert.equal(fake.identityReads, 0);
  assert.equal(fake.sessionReads, 1);
  assert.equal(fake.activeUserId, null);
});

test("signOut Coach exige expectedUserId no nulo antes de consultar o cerrar", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const { owner } = beginRegistrationOwner(null);
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);

  assert.equal(await gateway.signOut("authorization_error", owner), "stale");
  assert.equal(fake.identityReads, 0);
  assert.equal(fake.sessionReads, 0);
  assert.deepEqual(fake.signOutOptions, []);
  assert.equal(fake.activeUserId, "user-a");
});

test("signOut Coach tardío de A nunca cierra la sesión vigente B", async () => {
  const identityReadStarted = createDeferred<void>();
  const releaseIdentityRead = createDeferred<void>();
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    beforeGetSession: async () => {
      identityReadStarted.resolve();
      await releaseIdentityRead.promise;
    },
  });
  const { owners, owner: ownerA } = beginRegistrationOwner("user-a");
  const reasons: string[] = [];
  const gateway = createSupabaseMultiportalAuthGateway(fake.client, {
    onBeforeSignOut: (reason) => reasons.push(reason),
  });

  const pendingSignOut = gateway.signOut("authorization_error", ownerA);
  await identityReadStarted.promise;
  fake.setActiveUserId("user-b");
  owners.acceptIdentity("user-b");
  releaseIdentityRead.resolve();

  assert.equal(await pendingSignOut, "stale");
  assert.deepEqual(fake.signOutOptions, []);
  assert.deepEqual(reasons, []);
  assert.equal(fake.activeUserId, "user-b");
});

test("TOCTOU A→B: login B espera la revalidación y cierre atómico de A", async () => {
  const sessionReadStarted = createDeferred<void>();
  const releaseSessionRead = createDeferred<void>();
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    beforeGetSession: async () => {
      sessionReadStarted.resolve();
      await releaseSessionRead.promise;
    },
  });
  const { owner } = beginRegistrationOwner("user-a");
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);

  const pendingSignOutA = gateway.signOut("authorization_error", owner);
  await sessionReadStarted.promise;

  let loginBEntered = false;
  const pendingLoginB = runSupabasePrincipalIdentityOperation(async () => {
    loginBEntered = true;
    fake.setActiveUserId("user-b");
  });
  await Promise.resolve();
  assert.equal(loginBEntered, false, "B no puede entrar entre getSession(A) y signOut(A)");

  releaseSessionRead.resolve();
  assert.equal(await pendingSignOutA, "signed_out");
  await pendingLoginB;

  assert.equal(loginBEntered, true);
  assert.equal(fake.activeUserId, "user-b", "B inicia después y nunca es revocada por A");
  assert.deepEqual(fake.signOutOptions, [{ scope: "local" }]);
});

test("browser sin Web Locks falla cerrado antes de cualquier mutación de identidad", async () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let operationCalls = 0;
  let authInitializationCalls = 0;
  let storageReads = 0;
  let refreshStarts = 0;
  let bootstrapSessionReads = 0;
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });

    const client = initializeSupabaseBrowserAuthIfCoordinated(() => {
      authInitializationCalls += 1;
      storageReads += 1;
      refreshStarts += 1;
      return {
        auth: {
          getSession: async () => {
            bootstrapSessionReads += 1;
            return { data: { session: null }, error: null };
          },
        },
      };
    });
    assert.equal(client, null);

    await assert.rejects(
      getInitialSupabaseSession({
        configured: () => true,
        getBrowserClient: () => null,
      }),
      SupabasePrincipalIdentityCoordinationUnavailableError,
    );

    await assert.rejects(
      runSupabasePrincipalIdentityOperation(async () => {
        operationCalls += 1;
      }),
      SupabasePrincipalIdentityCoordinationUnavailableError,
    );
    assert.equal(operationCalls, 0);
    assert.deepEqual({ authInitializationCalls, storageReads, refreshStarts, bootstrapSessionReads }, {
      authInitializationCalls: 0,
      storageReads: 0,
      refreshStarts: 0,
      bootstrapSessionReads: 0,
    });
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("fallo de signOut Coach local no declara éxito y conserva la sesión", async () => {
  const signOutError = new Error("local signout failed");
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    signOutError,
  });
  const { owner } = beginRegistrationOwner("user-a");
  const callbacks: string[] = [];
  const gateway = createSupabaseMultiportalAuthGateway(fake.client, {
    onBeforeSignOut: (reason) => callbacks.push(`before:${reason}`),
    onSignOutError: (reason) => callbacks.push(`error:${reason}`),
  });

  await assert.rejects(
    gateway.signOut("authorization_error", owner),
    (error: unknown) => (
      error instanceof Error
      && error.message === "No pudimos cerrar la sesión."
      && "cause" in error
      && error.cause === signOutError
    ),
  );
  assert.deepEqual(fake.signOutOptions, [{ scope: "local" }]);
  assert.deepEqual(callbacks, [
    "before:authorization_error",
    "error:authorization_error",
  ]);
  assert.equal(fake.activeUserId, "user-a");
});

test("signup Coach usa sólo Auth signUp con metadata allowlisted y redirect cerrado", async () => {
  let rpcCalls = 0;
  const signupCalls: unknown[] = [];
  const isolatedClient = {
    rpc: async () => {
      rpcCalls += 1;
      assert.fail("signup no debe preparar PII mediante RPC");
    },
    auth: {
      signUp: async (payload: unknown) => {
        signupCalls.push(payload);
        return {
          data: { user: { identities: [{ id: "identity-a" }] }, session: null },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;
  const gateway = createSupabaseMultiportalAuthGateway({} as SupabaseClient, {
    createRegistrationClient: () => isolatedClient,
  });
  const { owner } = beginRegistrationOwner(null);

  assert.deepEqual(await gateway.signUpForCoachRegistration(coachSignupPayload, owner), {
    kind: "confirmation_required",
  });
  assert.equal(rpcCalls, 0);
  assert.equal(signupCalls.length, 1);
  const signup = signupCalls[0] as ConfirmationRegistrationSignupPayload;
  assert.equal(signup.email, signupPayload.email);
  assert.equal(signup.password, signupPayload.password);
  assert.equal(signup.options.data[AUTH_REGISTRATION_PORTAL_METADATA_KEY], "coach");
  assert.equal(
    "professional_title" in signup.options.data
      ? signup.options.data.professional_title
      : null,
    registration.professional_title,
  );
  assert.equal(
    "contact_email" in signup.options.data
      ? signup.options.data.contact_email
      : null,
    registration.contact_email,
  );
  assert.equal(
    signup.options.emailRedirectTo,
    "https://organizatech.cl/login?flow=signup-confirmation",
  );
  for (const forbidden of [
    "organizatech_registration_intent_id",
    "user_id",
    "owner_id",
    "profile_id",
    "role",
  ] as const) {
    assert.equal(JSON.stringify(signup).includes(forbidden), false);
  }
});

test("signup Usuario omite professional_title y también usa una sola llamada Auth", async () => {
  const signupCalls: unknown[] = [];
  const isolatedClient = {
    auth: {
      signUp: async (payload: unknown) => {
        signupCalls.push(payload);
        return { data: { user: { identities: [{ id: "identity-a" }] }, session: null }, error: null };
      },
    },
  } as unknown as SupabaseClient;
  const gateway = createSupabaseMultiportalAuthGateway({} as SupabaseClient, {
    createRegistrationClient: () => isolatedClient,
  });
  const { owner } = beginUserRegistrationOwner(null);

  const result = await gateway.signUpForUserRegistration(signupPayload, owner);
  assert.deepEqual(result, { kind: "confirmation_required" });
  assert.equal(signupCalls.length, 1);
  const signup = signupCalls[0] as ConfirmationRegistrationSignupPayload;
  assert.equal(signup.options.data[AUTH_REGISTRATION_PORTAL_METADATA_KEY], "usuario");
  assert.equal("professional_title" in signup.options.data, false);
  assert.equal("contact_email" in signup.options.data, false);
});

test("respuesta ofuscada de un segundo signUp se clasifica sin escribir PII fuera de Auth", async () => {
  let signupAttempts = 0;
  const isolatedClient = {
    auth: {
      signUp: async () => {
        signupAttempts += 1;
        return {
          data: { user: { identities: [] }, session: null },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;
  const gateway = createSupabaseMultiportalAuthGateway({} as SupabaseClient, {
    createRegistrationClient: () => isolatedClient,
  });

  const first = await gateway.signUpForCoachRegistration(
    coachSignupPayload,
    beginRegistrationOwner(null).owner,
  );
  const second = await gateway.signUpForUserRegistration(
    signupPayload,
    beginUserRegistrationOwner(null).owner,
  );

  assert.deepEqual(first, { kind: "existing_identity" });
  assert.deepEqual(second, { kind: "existing_identity" });
  assert.equal(signupAttempts, 2);
});

test("errores explícitos de identidad existente se clasifican antes del copy público en Usuario y Coach", async () => {
  const cases = [
    {
      name: "code estable",
      error: {
        code: "user_already_exists",
        message: "An identity with this email already exists",
      },
      expected: { kind: "existing_identity" },
    },
    {
      name: "code equivalente",
      error: {
        code: "email_exists",
        message: "Email address is unavailable",
      },
      expected: { kind: "existing_identity" },
    },
    {
      name: "fallback mínimo al mensaje conocido",
      error: {
        code: "unexpected_failure",
        message: "User already registered",
      },
      expected: { kind: "existing_identity" },
    },
    {
      name: "control inocente no-identidad",
      error: {
        code: "over_email_send_rate_limit",
        message: "Email rate limit exceeded",
      },
      expected: {
        kind: "error",
        message: "Se alcanzó el límite de intentos por ahora. Espera unos minutos e intenta nuevamente.",
      },
    },
  ] as const;

  for (const portal of ["coach", "usuario"] as const) {
    for (const { name, error, expected } of cases) {
      const isolatedClient = {
        auth: {
          signUp: async () => ({ data: { user: null, session: null }, error }),
        },
      } as unknown as SupabaseClient;
      const gateway = createSupabaseMultiportalAuthGateway({} as SupabaseClient, {
        createRegistrationClient: () => isolatedClient,
      });
      const result = portal === "coach"
        ? await gateway.signUpForCoachRegistration(
          coachSignupPayload,
          beginRegistrationOwner(null).owner,
        )
        : await gateway.signUpForUserRegistration(
          signupPayload,
          beginUserRegistrationOwner(null).owner,
        );

      assert.deepEqual(result, expected, `${portal}: ${name}`);
      if (result.kind === "error") {
        assert.doesNotMatch(result.message, /registrad[oa]/i, `${portal}: copy neutral`);
      }
    }
  }
});

test("confirmación propia usa RPC sin argumentos y revalida identidad antes y después", async () => {
  let identityReads = 0;
  let sessionReads = 0;
  const rpcCalls: unknown[][] = [];
  const user = users["user-a"];
  const session = {
    user,
    access_token: "callback-token-a",
    refresh_token: "refresh-a",
  } as Session;
  const client = {
    auth: {
      getUser: async () => {
        identityReads += 1;
        return { data: { user }, error: null };
      },
      getSession: async () => {
        sessionReads += 1;
        return { data: { session }, error: null };
      },
    },
    rpc: async (...args: unknown[]) => {
      rpcCalls.push(args);
      return {
        data: [{ status: "confirmed", portal: "coach" }],
        error: null,
      };
    },
  } as unknown as SupabaseClient;
  const gateway = createSupabaseMultiportalAuthGateway(client);
  const { owner } = beginPortalOwner("user-a");

  assert.deepEqual(await gateway.getOwnSignupConfirmation("user-a", owner), {
    status: "confirmed",
    portal: "coach",
  });
  assert.deepEqual(rpcCalls, [["get_own_auth_registration_confirmation"]]);
  assert.equal(identityReads, 2);
  assert.equal(sessionReads, 2);
});

test("bienvenida usa Edge autenticada con body vacío y su fallo es best-effort", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const invokeCalls: unknown[][] = [];
  Object.assign(fake.client, {
    functions: {
      invoke: async (...args: unknown[]) => {
        invokeCalls.push(args);
        throw new Error("Edge no disponible");
      },
    },
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owners, owner } = beginPortalOwner("user-a");

  await assert.doesNotReject(gateway.requestWelcomeEmail("user-a", owner));
  assert.equal(invokeCalls.length, 1);
  assert.equal(invokeCalls[0]?.[0], "send-welcome-email");
  const welcomeOptions = invokeCalls[0]?.[1] as { body?: unknown; signal?: unknown };
  assert.deepEqual(welcomeOptions.body, {});
  assert.ok(welcomeOptions.signal instanceof AbortSignal);
  const serializedCall = JSON.stringify(invokeCalls);
  for (const forbidden of [
    "user-a",
    users["user-a"].email!,
    registration.contact_email,
    "user_id",
    "owner_id",
    "profile_id",
    "portal",
  ]) {
    assert.equal(serializedCall.includes(forbidden), false, `${forbidden} no sale en el request`);
  }

  owners.invalidate();
  await gateway.requestWelcomeEmail("user-a", owner);
  assert.equal(invokeCalls.length, 1, "owner stale no vuelve a invocar la Edge Function");
});

test("respuesta tardía A no se acepta si la identidad global cambió a B", async () => {
  let activeUserId: TestUserId = "user-a";
  const rpcStarted = createDeferred<void>();
  const releaseRpc = createDeferred<void>();
  const client = {
    auth: {
      getUser: async () => ({ data: { user: users[activeUserId] }, error: null }),
      getSession: async () => ({
        data: {
          session: {
            user: users[activeUserId],
            access_token: `token-${activeUserId}`,
            refresh_token: `refresh-${activeUserId}`,
          } as Session,
        },
        error: null,
      }),
    },
    rpc: async () => {
      rpcStarted.resolve();
      await releaseRpc.promise;
      return { data: [{ status: "confirmed", portal: "coach" }], error: null };
    },
  } as unknown as SupabaseClient;
  const gateway = createSupabaseMultiportalAuthGateway(client);
  const { owner } = beginPortalOwner("user-a");
  const pending = gateway.getOwnSignupConfirmation("user-a", owner);
  await rpcStarted.promise;
  activeUserId = "user-b";
  releaseRpc.resolve();

  await assert.rejects(pending, /identidad autenticada cambió/i);
});

test("signOut de confirmación revalida owner y cierra sólo la sesión local", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a" });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginPortalOwner("user-a");

  assert.equal(await gateway.signOutAfterSignupConfirmation("user-a", owner), "signed_out");
  assert.deepEqual(fake.signOutOptions, [{ scope: "local" }]);
  assert.equal(fake.activeUserId, null);
});

test("signOut tardío de confirmación A nunca cierra una sesión B", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-b" });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginPortalOwner("user-a");

  assert.equal(await gateway.signOutAfterSignupConfirmation("user-a", owner), "stale");
  assert.deepEqual(fake.signOutOptions, []);
  assert.equal(fake.activeUserId, "user-b");
});
