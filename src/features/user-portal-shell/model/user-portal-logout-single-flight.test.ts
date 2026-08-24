import assert from "node:assert/strict";
import test from "node:test";

import { createUserPortalLogoutSingleFlight } from "./user-portal-logout-single-flight";

test("logout cierra y delega exactamente una vez frente a doble click", async () => {
  const coordinator = createUserPortalLogoutSingleFlight();
  let closeCalls = 0;
  let logoutCalls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const input = {
    disabled: false,
    onClose: () => { closeCalls += 1; },
    onLogout: () => {
      logoutCalls += 1;
      return pending;
    },
  };

  const first = coordinator.run(input);
  const second = coordinator.run(input);
  assert.equal(await second, false);
  assert.equal(closeCalls, 1);
  assert.equal(logoutCalls, 1);
  release();
  assert.equal(await first, true);
});

test("logout bloquea reentrada recursiva antes de cerrar", async () => {
  const coordinator = createUserPortalLogoutSingleFlight();
  let closeCalls = 0;
  let logoutCalls = 0;
  const input = {
    disabled: false,
    onClose: () => {
      closeCalls += 1;
      void coordinator.run(input);
    },
    onLogout: () => { logoutCalls += 1; },
  };

  assert.equal(await coordinator.run(input), true);
  assert.equal(closeCalls, 1);
  assert.equal(logoutCalls, 1);
});

test("logout respeta disabled y libera el single-flight después de un error", async () => {
  const coordinator = createUserPortalLogoutSingleFlight();
  let logoutCalls = 0;
  assert.equal(await coordinator.run({
    disabled: true,
    onClose: () => assert.fail("disabled no cierra"),
    onLogout: () => assert.fail("disabled no delega"),
  }), false);

  await assert.rejects(coordinator.run({
    disabled: false,
    onClose: () => undefined,
    onLogout: () => {
      logoutCalls += 1;
      throw new Error("fallo esperado");
    },
  }));
  assert.equal(await coordinator.run({
    disabled: false,
    onClose: () => undefined,
    onLogout: () => { logoutCalls += 1; },
  }), true);
  assert.equal(logoutCalls, 2);
});
