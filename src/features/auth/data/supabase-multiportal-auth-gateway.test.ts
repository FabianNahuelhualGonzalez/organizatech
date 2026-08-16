import assert from "node:assert/strict";
import test from "node:test";

import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

import type { CoachRegistrationWritePayload } from "@/features/auth/model/auth-form";
import {
  createSupabaseMultiportalAuthGateway,
  toCoachRegistrationInsertPayload,
  toCoachRegistrationRpcPayload,
} from "@/features/auth/data/supabase-multiportal-auth-gateway";
import {
  createCoachRegistrationOwnerController,
  createPortalResolutionOwnerController,
} from "@/features/auth/model/portal-resolution-owner";

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
};

function registrationRow(userId: TestUserId, suffix: string) {
  return {
    user_id: userId,
    first_name: `Coach ${suffix}`,
    last_name: `Apellido ${suffix}`,
    birth_date: "1990-01-01",
    gender: "male",
    phone_number: `+5690000000${suffix}`,
    professional_title: `Título ${suffix}`,
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
  beforeGetUser?(): void | Promise<void>;
  beforeRpc?(): void | Promise<void>;
  onFilterAttempt?(): void;
  selectError?: unknown;
  selectedRowOverride?: unknown;
}

function createStatefulFakeClient(input: StatefulFakeInput = {}) {
  let activeUserId: TestUserId | null = input.activeUserId ?? "user-a";
  const rows = new Map<TestUserId, ReturnType<typeof registrationRow>>(
    (input.rows ?? []).map((row) => [row.user_id, row]),
  );
  const insertedPayloads: unknown[] = [];
  const readOwners: Array<TestUserId | null> = [];
  const signOutOptions: unknown[] = [];
  const rpcPayloads: unknown[] = [];
  let relationReads = 0;
  let identityReads = 0;
  let sessionReads = 0;
  let rpcAttempts = 0;

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
      const user = currentUser();
      const session = user
        ? { user, access_token: `test-${user.id}`, refresh_token: `test-${user.id}` } as Session
        : null;
      return { data: { session }, error: null };
    },
    signInWithPassword: async () => assert.fail("signIn inesperado"),
    signUp: async () => assert.fail("signUp inesperado"),
    setSession: async ({ access_token }: { access_token: string }) => {
      const nextUserId: TestUserId = access_token.endsWith("user-a") ? "user-a" : "user-b";
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
      activeUserId = null;
      return { error: null };
    },
  };

  const from = (relation: string) => {
    assert.equal(relation, "coach_registrations");
    relationReads += 1;
    return {
      select: () => ({
        eq: () => {
          input.onFilterAttempt?.();
          return {
            maybeSingle: async () => ({
              data: activeUserId ? rows.get(activeUserId) ?? null : null,
              error: null,
            }),
          };
        },
        maybeSingle: async () => {
          readOwners.push(activeUserId);
          return {
            data: input.selectedRowOverride !== undefined
              ? input.selectedRowOverride
              : activeUserId ? rows.get(activeUserId) ?? null : null,
            error: input.selectError ?? null,
          };
        },
      }),
    };
  };

  const rpc = async (functionName: string, payload: Record<string, unknown>) => {
    assert.equal(functionName, "register_own_coach");
    rpcAttempts += 1;
    rpcPayloads.push(payload);
    const jwtUserId = activeUserId;
    await input.beforeRpc?.();
    const expectedKeys = [
      "p_expected_user_id",
      "p_first_name",
      "p_last_name",
      "p_birth_date",
      "p_gender",
      "p_phone_number",
      "p_professional_title",
    ];
    if (!jwtUserId || Object.keys(payload).some((key) => !expectedKeys.includes(key))) {
      return { data: null, error: { code: "42501", message: "RLS/ACL" } };
    }
    if (payload.p_expected_user_id !== jwtUserId) {
      return { data: null, error: { code: "42501", message: "identity mismatch" } };
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
    };
    insertedPayloads.push(writePayload);
    const row = { user_id: jwtUserId, ...writePayload };
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
    insertedPayloads,
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
  };
}

function beginRegistrationOwner(userId: TestUserId | null) {
  const owners = createCoachRegistrationOwnerController();
  if (userId) owners.acceptIdentity(userId);
  return { owners, owner: owners.begin() };
}

function beginPortalOwner(userId: TestUserId) {
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity(userId);
  return { owners, owner: owners.begin(userId) };
}

test("allowlist repository descarta ownership, roles, privilegios y campos Auth", () => {
  const malicious = {
    ...registration,
    user_id: "user-a",
    owner_id: "user-a",
    profile_id: "user-a",
    role: "admin",
    roles: ["admin", "coach"],
    privileges: ["cross-account-read"],
    email: "victim@example.com",
    password: "not-a-real-secret",
    age: 36,
  } as CoachRegistrationWritePayload;

  assert.deepEqual(toCoachRegistrationInsertPayload(malicious), registration);
  assert.deepEqual(Object.keys(toCoachRegistrationInsertPayload(malicious)), [
    "first_name",
    "last_name",
    "birth_date",
    "gender",
    "phone_number",
    "professional_title",
  ]);
  assert.deepEqual(Object.keys(toCoachRegistrationRpcPayload(malicious, "user-b")), [
    "p_expected_user_id",
    "p_first_name",
    "p_last_name",
    "p_birth_date",
    "p_gender",
    "p_phone_number",
    "p_professional_title",
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
  assert.equal(await gateway.hasCoachRegistration("user-a"), true);
  assert.deepEqual(fake.readOwners, ["user-a"]);

  fake.setActiveUserId("user-b");
  assert.equal(await gateway.hasCoachRegistration("user-b"), true);
  assert.deepEqual(fake.readOwners, ["user-a", "user-b"]);

  const readsBeforeCrossAttempt = fake.relationReads;
  await assert.rejects(
    gateway.hasCoachRegistration("user-a"),
    /identidad autenticada cambió/,
  );
  assert.equal(fake.relationReads, readsBeforeCrossAttempt, "B no alcanza SELECT al declarar expectedUserId A");
  assert.equal(filterAttempts, 0, "el cliente no controla user_id mediante filtros");
});

test("E9 · forma productiva con owner vigente retorna true sólo después del SELECT propio", async () => {
  const fake = createStatefulFakeClient({
    activeUserId: "user-a",
    rows: [registrationRow("user-a", "A")],
  });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginPortalOwner("user-a");

  assert.equal(
    await gateway.hasCoachRegistration("user-a", owner),
    true,
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

test("E9 · forma productiva con owner vigente retorna false cuando no existe fila", async () => {
  const fake = createStatefulFakeClient({ activeUserId: "user-a", rows: [] });
  const gateway = createSupabaseMultiportalAuthGateway(fake.client);
  const { owner } = beginPortalOwner("user-a");

  assert.equal(
    await gateway.hasCoachRegistration("user-a", owner),
    false,
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
    gateway.hasCoachRegistration("user-a", owner),
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
    gateway.hasCoachRegistration("user-a", owner),
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
      name: "fila de otro owner",
      fake: createStatefulFakeClient({
        activeUserId: "user-a",
        selectedRowOverride: registrationRow("user-b", "B"),
      }),
    },
  ] as const;
  assert.equal(cases.length, 3, "E9 fija error, respuesta malformada y respuesta cruzada");

  for (const { name, fake } of cases) {
    const gateway = createSupabaseMultiportalAuthGateway(fake.client);
    const { owner } = beginPortalOwner("user-a");
    await assert.rejects(
      gateway.hasCoachRegistration("user-a", owner),
      `[AUTH-COACH-01.E9.invalid-response-runtime] ${name} debe fallar cerrado`,
    );
    assert.equal(fake.relationReads, 1, `${name} sí materializa el SELECT autoritativo`);
  }
});

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
      ? gateway.hasCoachRegistration("user-a")
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
