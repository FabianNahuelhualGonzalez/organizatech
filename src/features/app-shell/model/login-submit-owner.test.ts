import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { coordinateAuthenticatedSessionEvent } from "./authenticated-session-coordinator";
import {
  createLoginSubmitOwnerController,
  type LoginSubmitStartResult,
} from "./login-submit-owner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function started<T>(result: LoginSubmitStartResult<T>) {
  if (result.kind !== "started") assert.fail("expected login submit to start");
  return result;
}

test("dos submits en el mismo tick ejecutan exactamente un signInWithPassword", async () => {
  const controller = createLoginSubmitOwnerController();
  const auth = deferred<{ userId: string }>();
  let signInWithPasswordCalls = 0;
  const signInWithPassword = () => {
    signInWithPasswordCalls += 1;
    return auth.promise;
  };

  let nestedSubmit: LoginSubmitStartResult<{ userId: string }> | null = null;
  const first = started(controller.start(() => {
    nestedSubmit = controller.start(signInWithPassword);
    return signInWithPassword();
  }));
  const second = controller.start(signInWithPassword);

  assert.deepEqual(nestedSubmit, { kind: "busy" }, "el lock existe antes de invocar la operación");
  assert.deepEqual(second, { kind: "busy" });
  assert.equal(signInWithPasswordCalls, 1);

  auth.resolve({ userId: "user-a" });
  assert.deepEqual(await first.promise, {
    kind: "success",
    value: { userId: "user-a" },
  });
});

test("mutation probe: eliminar lock síncrono admite un submit reentrante", async () => {
  const controller = createLoginSubmitOwnerController();
  const request = deferred<string>();
  let reentrant: LoginSubmitStartResult<string> | null = null;

  const first = started(controller.start(() => {
    reentrant = controller.start(() => Promise.resolve("duplicate"));
    return request.promise;
  }));

  assert.deepEqual(reentrant, { kind: "busy" });
  request.resolve("first");
  assert.deepEqual(await first.promise, { kind: "success", value: "first" });
});

test("mutation probe: admitir segundo submit mientras existe promise duplica auth", async () => {
  const controller = createLoginSubmitOwnerController();
  const request = deferred<string>();
  let calls = 0;
  const operation = () => {
    calls += 1;
    return request.promise;
  };

  const first = started(controller.start(operation));
  assert.deepEqual(controller.start(operation), { kind: "busy" });
  assert.equal(calls, 1);
  assert.equal(controller.isCurrent(first.owner), true);

  request.resolve("session");
  await first.promise;
  assert.equal(controller.isCurrent(first.owner), false);
});

test("mutation probe: conservar lock después de error impide el retry", async () => {
  const controller = createLoginSubmitOwnerController();
  const expectedError = new Error("invalid credentials");
  const first = started(controller.start(() => Promise.reject(expectedError)));

  assert.deepEqual(await first.promise, { kind: "error", error: expectedError });
  const retry = started(controller.start(() => Promise.resolve("session-b")));
  assert.deepEqual(await retry.promise, { kind: "success", value: "session-b" });
});

test("mutation probe: reutilizar owner entre generaciones rompe identidad exclusiva", () => {
  const controller = createLoginSubmitOwnerController();
  const ownerA = controller.acquire();
  assert.ok(ownerA);

  controller.invalidate();
  const ownerB = controller.acquire();
  assert.ok(ownerB);

  assert.notEqual(ownerB, ownerA);
  assert.notEqual(ownerB.generation, ownerA.generation);
  assert.notEqual(ownerB.operationId, ownerA.operationId);
  assert.equal(controller.isCurrent(ownerA), false);
  assert.equal(controller.isCurrent(ownerB), true);
  assert.equal(controller.finalize(ownerA), false);
  assert.equal(controller.isCurrent(ownerB), true);
});

test("mutation probe: finally viejo no libera el owner nuevo", async () => {
  const controller = createLoginSubmitOwnerController();
  const requestA = deferred<string>();
  const requestB = deferred<string>();
  const submitA = started(controller.start(() => requestA.promise));

  controller.invalidate();
  const submitB = started(controller.start(() => requestB.promise));
  requestA.resolve("A");

  assert.deepEqual(await submitA.promise, { kind: "stale" });
  assert.equal(controller.isCurrent(submitB.owner), true);
  assert.deepEqual(controller.start(() => Promise.resolve("duplicate-b")), { kind: "busy" });

  requestB.resolve("B");
  assert.deepEqual(await submitB.promise, { kind: "success", value: "B" });
});

test("error stale libera únicamente su owner y no contamina la generación nueva", async () => {
  const controller = createLoginSubmitOwnerController();
  const requestA = deferred<string>();
  const requestB = deferred<string>();
  const submitA = started(controller.start(() => requestA.promise));

  controller.invalidate();
  const submitB = started(controller.start(() => requestB.promise));
  requestA.reject(new Error("late A"));

  assert.deepEqual(await submitA.promise, { kind: "stale" });
  assert.equal(controller.isCurrent(submitB.owner), true);
  requestB.resolve("B");
  assert.deepEqual(await submitB.promise, { kind: "success", value: "B" });
});

test("A→SIGNED_OUT→B invalida A mediante el seam new-identity de P3-43", async () => {
  const controller = createLoginSubmitOwnerController();
  const requestA = deferred<string>();
  const requestB = deferred<string>();
  const submitA = started(controller.start(() => requestA.promise));

  const eventResult = coordinateAuthenticatedSessionEvent({
    event: "SIGNED_OUT",
    state: {},
    currentIdentity: { userId: "user-a", scope: "supabase:user-a" },
    nextIdentity: { userId: null, scope: null },
    intent: "dashboard",
    hasAuthenticatedSession: false,
  }, {
    applySameIdentitySession: () => assert.fail("SIGNED_OUT no es same-identity"),
    applyNewIdentitySession: () => controller.invalidate(),
    canContinueAfterSessionApplied: () => false,
    continueSession: async () => { throw new Error("unexpected continuation"); },
  });
  assert.equal(eventResult.identity, "new-identity");
  assert.equal(controller.isCurrent(submitA.owner), false);

  const submitB = started(controller.start(() => requestB.promise));
  requestA.resolve("A");
  assert.deepEqual(await submitA.promise, { kind: "stale" });
  assert.equal(controller.isCurrent(submitB.owner), true);

  requestB.resolve("B");
  assert.deepEqual(await submitB.promise, { kind: "success", value: "B" });
});

test("TOKEN_REFRESHED same-identity conserva una operación legítima", async () => {
  const controller = createLoginSubmitOwnerController();
  const request = deferred<string>();
  const submit = started(controller.start(() => request.promise));
  let sameIdentityApplications = 0;

  const eventResult = coordinateAuthenticatedSessionEvent({
    event: "TOKEN_REFRESHED",
    state: {},
    currentIdentity: { userId: "user-a", scope: "supabase:user-a" },
    nextIdentity: { userId: "user-a", scope: "supabase:user-a" },
    intent: "dashboard",
    hasAuthenticatedSession: true,
  }, {
    applySameIdentitySession: () => { sameIdentityApplications += 1; },
    applyNewIdentitySession: () => controller.invalidate(),
    canContinueAfterSessionApplied: () => true,
    continueSession: async () => { throw new Error("unexpected continuation"); },
  });

  assert.equal(eventResult.identity, "same-identity");
  assert.equal(eventResult.continuation, null);
  assert.equal(sameIdentityApplications, 1);
  assert.equal(controller.isCurrent(submit.owner), true);

  request.resolve("session-a");
  assert.deepEqual(await submit.promise, { kind: "success", value: "session-a" });
});

test("instancias independientes no comparten singleton y dispose cierra sólo su instancia", async () => {
  const firstController = createLoginSubmitOwnerController();
  const secondController = createLoginSubmitOwnerController();
  const firstRequest = deferred<string>();
  const first = started(firstController.start(() => firstRequest.promise));
  const second = started(secondController.start(() => Promise.resolve("second")));

  firstController.dispose();
  assert.equal(firstController.isCurrent(first.owner), false);
  assert.deepEqual(firstController.start(() => Promise.resolve("after-dispose")), { kind: "busy" });
  assert.deepEqual(await second.promise, { kind: "success", value: "second" });

  firstRequest.resolve("late-first");
  assert.deepEqual(await first.promise, { kind: "stale" });
});

if (process.env.PERF05B_MUTANT !== "1") {
  const mutations = [
    {
      name: "eliminar lock síncrono",
      apply: (source: string) => source.replace("    currentOwner = owner;\n", ""),
    },
    {
      name: "liberar owner nuevo desde finally viejo",
      apply: (source: string) => source.replace(
        "    if (!isCurrent(owner)) return false;",
        "    if (!isCurrent(owner)) { currentOwner = null; return false; }",
      ),
    },
    {
      name: "reutilizar owner entre generaciones",
      apply: (source: string) => source
        .replace(
          "  let currentOwner: LoginSubmitOwner | null = null;",
          "  let currentOwner: LoginSubmitOwner | null = null;\n  let reusableOwner: LoginSubmitOwner | null = null;",
        )
        .replace(
          `    const owner = Object.freeze({
      generation,
      operationId: ++nextOperationId,
    });
    currentOwner = owner;`,
          `    const owner = reusableOwner ?? Object.freeze({
      generation,
      operationId: ++nextOperationId,
    });
    reusableOwner = owner;
    currentOwner = owner;`,
        ),
    },
    {
      name: "admitir segundo submit mientras existe promise",
      apply: (source: string) => source.replace(
        "    if (disposed || currentOwner) return null;",
        "    if (disposed) return null;",
      ),
    },
    {
      name: "conservar lock después de error",
      apply: (source: string) => source.replace(
        `    const promise = settle(owner, request).finally(() => {
      finalize(owner);
    });`,
        `    const promise = settle(owner, request).then((result) => {
      if (result.kind !== "error") finalize(owner);
      return result;
    });`,
      ),
    },
  ] as const;

  for (const mutation of mutations) {
    test(`mutation probe ejecutable: ${mutation.name}`, () => {
      const ownerSource = readFileSync(
        "src/features/app-shell/model/login-submit-owner.ts",
        "utf8",
      );
      const mutatedOwnerSource = mutation.apply(ownerSource);
      assert.notEqual(mutatedOwnerSource, ownerSource, "la mutación debe modificar el owner");

      const directory = mkdtempSync(join(tmpdir(), "organizatech-perf05b-"));
      const ownerPath = join(directory, "login-submit-owner.ts");
      const testPath = join(directory, "login-submit-owner.test.ts");
      const coordinatorPath = join(directory, "authenticated-session-coordinator.ts");
      try {
        writeFileSync(ownerPath, mutatedOwnerSource, "utf8");
        writeFileSync(
          testPath,
          readFileSync("src/features/app-shell/model/login-submit-owner.test.ts", "utf8"),
          "utf8",
        );
        writeFileSync(
          coordinatorPath,
          readFileSync(
            "src/features/app-shell/model/authenticated-session-coordinator.ts",
            "utf8",
          ),
          "utf8",
        );

        const result = spawnSync(
          join(process.cwd(), "node_modules", ".bin", "tsx"),
          [testPath],
          {
            cwd: process.cwd(),
            encoding: "utf8",
            env: { ...process.env, PERF05B_MUTANT: "1" },
            timeout: 10_000,
          },
        );
        assert.notEqual(
          result.status,
          0,
          `el mutante sobrevivió: ${mutation.name}\n${result.stdout}\n${result.stderr}`,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}
