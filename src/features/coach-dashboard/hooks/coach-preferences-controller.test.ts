import assert from "node:assert/strict";
import test from "node:test";
import { createCoachPreferencesController } from "./coach-preferences-controller";
import type { CoachPreferencesSnapshot, CoachPreferencesSource } from "./coach-preferences-controller-contract";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<CoachPreferencesSource> = {}, parseFee = (raw: string) => /^\d+$/.test(raw) ? Number(raw) : null) {
  let current = true;
  const saved: { monthlyFeeClp: number; expectedVersion: number }[] = [];
  const calls = { read: 0, chat: 0 };
  let response: CoachPreferencesSnapshot = { monthlyFeeClp: null, version: 0, chatInterestRegistered: false };
  const source: CoachPreferencesSource = {
    read: () => { calls.read++; return overrides.read?.() ?? Promise.resolve(response); },
    saveFee: (value) => {
      saved.push(value);
      return overrides.saveFee?.(value) ?? Promise.resolve({ monthlyFeeClp: value.monthlyFeeClp, version: value.expectedVersion + 1 });
    },
    registerChatInterest: () => { calls.chat++; return overrides.registerChatInterest?.() ?? Promise.resolve({ chatInterestRegistered: true }); },
  };
  const controller = createCoachPreferencesController({ source, parseFee, isCurrent: () => current });
  return { controller, calls, saved, invalidate: () => { current = false; }, setResponse: (value: CoachPreferencesSnapshot) => { response = value; } };
}

test("unknown preferences cannot open sheets or dispatch writes", async () => {
  const { controller, saved, calls } = setup();
  assert.equal(controller.getSnapshot().confirmed, null);
  assert.equal(controller.openFee(), false);
  assert.equal(controller.openChat(), false);
  assert.equal(await controller.saveFee(), false);
  assert.equal(await controller.registerChatInterest(), false);
  assert.equal(saved.length + calls.chat, 0);
});

test("load is single-flight and does not invent a configured zero", async () => {
  const pending = deferred<CoachPreferencesSnapshot>();
  const { controller, calls } = setup({ read: () => pending.promise });
  const operation = controller.load();
  assert.equal(controller.getSnapshot().pending, "read");
  assert.equal(await controller.load(), false);
  pending.resolve({ monthlyFeeClp: null, version: 0, chatInterestRegistered: false });
  assert.equal(await operation, true);
  assert.equal(calls.read, 1);
  assert.equal(controller.openFee(), true);
  assert.equal(controller.getSnapshot().feeDraft, "");
  assert.equal(controller.canSaveFee(), false);
});

test("cancel restores confirmed fee without persisting the draft", async () => {
  const { controller, saved } = setup();
  await controller.load();
  controller.openFee();
  controller.editFee("35000");
  assert.equal(controller.openChat(), false);
  assert.equal(controller.getSnapshot().confirmed?.monthlyFeeClp, null);
  assert.equal(controller.cancelFee(), true);
  controller.openFee();
  assert.equal(controller.getSnapshot().feeDraft, "");
  assert.deepEqual(saved, []);
});

test("invalid, blank, fractional and unsafe fee values never dispatch", async () => {
  const { controller, saved } = setup({}, (raw) => Number(raw));
  await controller.load();
  controller.openFee();
  for (const raw of ["", " ", "-1", "35.5", "NaN", "Infinity", "9007199254740992"]) {
    controller.editFee(raw);
    assert.equal(controller.canSaveFee(), false, raw);
    assert.equal(await controller.saveFee(), false, raw);
  }
  controller.editFee("0");
  assert.equal(await controller.saveFee(), true);
  assert.deepEqual(saved, [{ monthlyFeeClp: 0, expectedVersion: 0 }]);
});

test("save snapshots its allowlist and closes only on confirmed response", async () => {
  const pending = deferred<{ monthlyFeeClp: number; version: number }>();
  const { controller, saved } = setup({ saveFee: () => pending.promise });
  await controller.load();
  controller.openFee();
  controller.editFee("35000");
  const operation = controller.saveFee();
  assert.equal(controller.getSnapshot().feeDraft, "35000");
  assert.equal(controller.getSnapshot().confirmed?.monthlyFeeClp, null);
  assert.equal(controller.editFee("50000"), false);
  assert.equal(controller.cancelFee(), false);
  assert.equal(await controller.saveFee(), false);
  assert.equal(await controller.load(), false);
  assert.deepEqual(saved, [{ monthlyFeeClp: 35000, expectedVersion: 0 }]);
  pending.resolve({ monthlyFeeClp: 35000, version: 1 });
  assert.equal(await operation, true);
  assert.equal(controller.getSnapshot().feeDraft, null);
  assert.equal(controller.getSnapshot().confirmed?.monthlyFeeClp, 35000);
});

test("write errors preserve the draft and require readback, never an automatic retry", async () => {
  for (const code of ["version_conflict", "timeout", "unavailable", "invalid_response", "invalid_input"]) {
    const { controller, saved, setResponse } = setup({ saveFee: async () => { throw { code, message: "private detail" }; } });
    await controller.load();
    controller.openFee();
    controller.editFee("35000");
    assert.equal(await controller.saveFee(), false);
    assert.equal(controller.getSnapshot().issue, code);
    assert.equal(controller.getSnapshot().needsRefresh, true);
    assert.equal(controller.getSnapshot().feeDraft, "35000");
    assert.equal(controller.getSnapshot().confirmed?.monthlyFeeClp, null);
    assert.equal(await controller.saveFee(), false);
    assert.equal(saved.length, 1);
    setResponse({ monthlyFeeClp: 50000, version: 2, chatInterestRegistered: false });
    assert.equal(await controller.load(), true);
    assert.equal(controller.getSnapshot().feeDraft, "35000");
    assert.equal(controller.getSnapshot().confirmed?.version, 2);
    assert.equal(controller.canSaveFee(), true);
  }
});

test("failed reconciliation does not re-enable a write or expose error messages", async () => {
  let reads = 0;
  const { controller, saved } = setup({
    read: async () => { if (reads++ > 0) throw new Error("private detail"); return { monthlyFeeClp: 100, version: 1, chatInterestRegistered: false }; },
    saveFee: async () => { throw { code: "timeout" }; },
  });
  await controller.load(); controller.openFee(); controller.editFee("200");
  await controller.saveFee();
  assert.equal(await controller.load(), false);
  assert.equal(controller.getSnapshot().issue, "unavailable");
  assert.equal(controller.canSaveFee(), false);
  assert.equal(await controller.saveFee(), false);
  assert.equal(saved.length, 1);
  assert.ok(!JSON.stringify(controller.getSnapshot()).includes("private detail"));
});

test("Chat is confirmed once, without modifying the fee version", async () => {
  const pending = deferred<{ chatInterestRegistered: true }>();
  const { controller, calls } = setup({ registerChatInterest: () => pending.promise });
  await controller.load(); controller.openChat();
  assert.equal(controller.openFee(), false);
  const operation = controller.registerChatInterest();
  assert.equal(controller.getSnapshot().confirmed?.chatInterestRegistered, false);
  assert.equal(controller.cancelChat(), false);
  assert.equal(await controller.registerChatInterest(), false);
  pending.resolve({ chatInterestRegistered: true });
  assert.equal(await operation, true);
  assert.equal(controller.getSnapshot().confirmed?.version, 0);
  assert.equal(controller.getSnapshot().confirmed?.chatInterestRegistered, true);
  assert.equal(await controller.registerChatInterest(), false);
  assert.equal(calls.chat, 1);
  assert.equal(controller.cancelChat(), true);
});

test("Chat timeout is reconciled before allowing another attempt", async () => {
  const { controller, calls, setResponse } = setup({ registerChatInterest: async () => { throw { code: "timeout" }; } });
  await controller.load(); controller.openChat();
  await controller.registerChatInterest();
  assert.equal(controller.getSnapshot().confirmed?.chatInterestRegistered, false);
  assert.equal(await controller.registerChatInterest(), false);
  setResponse({ monthlyFeeClp: null, version: 0, chatInterestRegistered: true });
  await controller.load();
  assert.equal(await controller.registerChatInterest(), false);
  assert.equal(calls.chat, 1);
});

test("identity transition hides data immediately and discards late read success", async () => {
  const pending = deferred<CoachPreferencesSnapshot>();
  const { controller, invalidate } = setup({ read: () => pending.promise });
  const operation = controller.load();
  invalidate();
  assert.equal(controller.getSnapshot().pending, null);
  pending.resolve({ monthlyFeeClp: 35000, version: 1, chatInterestRegistered: true });
  assert.equal(await operation, false);
  assert.equal(controller.getSnapshot().confirmed, null);
  assert.equal(await controller.load(), false);
});

test("dispose clears private state and suppresses late writes and late failures", async () => {
  for (const reject of [false, true]) {
    const pending = deferred<{ monthlyFeeClp: number; version: number }>();
    const { controller } = setup({ saveFee: () => pending.promise });
    await controller.load(); controller.openFee(); controller.editFee("35000");
    const operation = controller.saveFee();
    controller.dispose();
    const closed = controller.getSnapshot();
    if (reject) pending.reject({ code: "timeout" });
    else pending.resolve({ monthlyFeeClp: 35000, version: 1 });
    assert.equal(await operation, false);
    assert.strictEqual(controller.getSnapshot(), closed);
    assert.equal(closed.confirmed, null);
    assert.equal(closed.feeDraft, null);
    assert.equal(await controller.saveFee(), false);
  }
});

test("forbidden or stale replies invalidate the controller without logging out Auth", async () => {
  for (const code of ["forbidden", "operation_stale"]) {
    const { controller, calls } = setup({ read: async () => { throw { code }; } });
    assert.equal(await controller.load(), false);
    assert.equal(controller.getSnapshot().confirmed, null);
    assert.equal(controller.getSnapshot().pending, null);
    assert.equal(controller.getSnapshot().issue, code);
    assert.equal(await controller.load(), false);
    assert.equal(calls.read, 1);
  }
});

test("snapshots are stable, immutable copies and subscriptions can detach", async () => {
  const response = { monthlyFeeClp: 100, version: 1, chatInterestRegistered: false };
  const { controller } = setup({ read: async () => response });
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => { notifications++; });
  await controller.load();
  const snapshot = controller.getSnapshot();
  response.monthlyFeeClp = 999;
  assert.equal(snapshot.confirmed?.monthlyFeeClp, 100);
  assert.strictEqual(snapshot, controller.getSnapshot());
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.confirmed));
  assert.equal(notifications, 2);
  unsubscribe(); controller.openFee();
  assert.equal(notifications, 2);
});

test("owner invalidated by a subscriber prevents dispatch", async () => {
  const { controller, invalidate, calls } = setup();
  controller.subscribe(() => { invalidate(); });
  assert.equal(await controller.load(), false);
  assert.equal(calls.read, 0);
  assert.equal(controller.getSnapshot().confirmed, null);
});

test("a saturated fee version cannot dispatch an unrepresentable next version", async () => {
  const { controller, saved, setResponse } = setup();
  setResponse({ monthlyFeeClp: 100, version: Number.MAX_SAFE_INTEGER, chatInterestRegistered: false });
  await controller.load(); controller.openFee(); controller.editFee("200");
  assert.equal(controller.canSaveFee(), false);
  assert.equal(await controller.saveFee(), false);
  assert.deepEqual(saved, []);
});
