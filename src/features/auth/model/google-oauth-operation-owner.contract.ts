import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleOAuthOperationOwnerController,
  createGoogleOAuthSingleFlight,
  createGoogleOAuthStartController,
  transferGoogleOAuthAndNavigate,
} from "./google-oauth-operation-owner";

test("Strict Mode replay conserva owner si el efecto remonta antes del microtask", () => {
  const scheduled: Array<() => void> = [];
  const controller = createGoogleOAuthOperationOwnerController();
  controller.mount();
  const owner = controller.begin();
  assert.equal(owner.bindExpectedUserId("user-a"), true);
  controller.scheduleUnmount((callback) => scheduled.push(callback));
  controller.mount();
  scheduled.shift()?.();
  assert.equal(owner.isCurrent(), true);
});

test("unmount real y cambio A→B invalidan antes de writes o transferencias", () => {
  const scheduled: Array<() => void> = [];
  const controller = createGoogleOAuthOperationOwnerController();
  controller.mount();
  const ownerA = controller.begin();
  ownerA.bindExpectedUserId("user-a");
  controller.acceptPrincipalIdentity("user-b");
  assert.equal(ownerA.isCurrent(), false);

  const ownerB = controller.begin();
  ownerB.bindExpectedUserId("user-b");
  controller.scheduleUnmount((callback) => scheduled.push(callback));
  scheduled.shift()?.();
  assert.equal(ownerB.isCurrent(), false);
});

test("single-flight comparte exactamente una operación concurrente", async () => {
  const singleFlight = createGoogleOAuthSingleFlight();
  let executions = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const first = singleFlight.run("submit-a", async () => {
    executions += 1;
    await barrier;
    return "done";
  });
  const second = singleFlight.run("submit-a", async () => {
    executions += 1;
    return "duplicate";
  });
  assert.equal(first, second);
  assert.equal(executions, 1);
  release();
  assert.equal(await second, "done");
});

test("single-flight adquiere antes del callback y deduplica reentrada síncrona", async () => {
  const singleFlight = createGoogleOAuthSingleFlight();
  let executions = 0;
  let reentrant: Promise<string> | null = null;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });

  const first = singleFlight.run("start-google", async () => {
    executions += 1;
    reentrant = singleFlight.run("start-google", async () => {
      executions += 1;
      return "duplicate";
    });
    await barrier;
    return "started";
  });

  assert.equal(reentrant, first);
  assert.equal(executions, 1);
  release();
  assert.equal(await first, "started");
});

test("wiring start comparte Promise y ejecuta una sola salida OAuth concurrente y reentrante", async () => {
  const controller = createGoogleOAuthStartController();
  assert.equal("clear" in controller, false);
  let starts = 0;
  let reentrant: Promise<void> | null = null;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const executeStart = async () => {
    starts += 1;
    reentrant = controller.start("login:usuario", executeStart);
    await barrier;
  };

  const first = controller.start("login:usuario", executeStart);
  const concurrent = controller.start("login:usuario", executeStart);
  assert.equal(concurrent, first);
  assert.equal(reentrant, first);
  assert.equal(starts, 1);
  release();
  await first;
});

test("late A→B después de transferir conserva navegación en cero", async () => {
  let current = true;
  let navigations = 0;
  const navigated = await transferGoogleOAuthAndNavigate({
    transfer: async () => { current = false; },
    guard: { isCurrent: () => current },
    navigate: () => { navigations += 1; },
  });

  assert.equal(navigated, false);
  assert.equal(navigations, 0);
});
