import assert from "node:assert/strict";
import test from "node:test";
import { createCoachPreferencesController } from "../hooks/coach-preferences-controller";
import type {
  CoachPreferencesAction,
  CoachPreferencesControllerState,
  CoachPreferencesSnapshot,
} from "../hooks/coach-preferences-controller-contract";
import { projectCoachPreferencesPresentation as project } from "./coach-preferences-presentation";

const confirmed: CoachPreferencesSnapshot = Object.freeze({
  monthlyFeeClp: null, version: 0, chatInterestRegistered: false,
});

function snapshot(patch: Partial<CoachPreferencesControllerState> = {}): CoachPreferencesControllerState {
  return Object.freeze({
    confirmed, feeDraft: null, chatOpen: false, pending: null, issue: null,
    needsRefresh: false, ...patch,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("unknown preferences stay nullable and cannot write even with an inconsistent capability", () => {
  assert.deepEqual(project(snapshot({ confirmed: null, needsRefresh: true }), true), {
    feeOpen: false, feeRaw: null, busy: false, chatOpen: false,
    isRegistered: null, canSave: false, canRegister: false,
  });
  const unknown = project(snapshot({ confirmed: null, feeDraft: "0", chatOpen: true }), true);
  assert.equal(unknown.isRegistered, null);
  assert.equal(unknown.canSave, false);
  assert.equal(unknown.canRegister, false);
});

test("closed null differs from open empty and explicit zero; raw text is never normalized", () => {
  for (const feeDraft of [null, "", "0", "35000", "35.000", " 35.000 ", "35.", "$35.000"]) {
    const view = project(snapshot({ feeDraft }), false);
    assert.equal(view.feeOpen, feeDraft !== null);
    assert.equal(view.feeRaw, feeDraft);
    assert.equal(view.canSave, false);
  }
  for (const monthlyFeeClp of [null, 0, 35000]) {
    const state = snapshot({ confirmed: Object.freeze({ ...confirmed, monthlyFeeClp }), feeDraft: "" });
    assert.equal(project(state, false).feeRaw, "");
    assert.equal(state.confirmed?.monthlyFeeClp, monthlyFeeClp);
  }
});

test("fee syntax and version capacity come only from the supplied controller capability", () => {
  assert.equal(project(snapshot({ feeDraft: "35000" }), false).canSave, false);
  // Deliberately inconsistent input proves this mapper is not another fee parser.
  assert.equal(project(snapshot({ feeDraft: "domain-owned syntax" }), true).canSave, true);
  assert.equal(project(snapshot(), true).canSave, false);
});

test("all pending operations are busy and disable both write capabilities", () => {
  for (const pending of ["read", "save-fee", "register-chat"] satisfies CoachPreferencesAction[]) {
    const view = project(snapshot({ pending, feeDraft: "0", chatOpen: true }), true);
    assert.equal(view.busy, true);
    assert.equal(view.canSave, false);
    assert.equal(view.canRegister, false);
    assert.equal(view.feeRaw, "0");
    assert.equal(view.chatOpen, true);
  }
});

test("refresh requirements disable writes without pretending an operation is busy", () => {
  const state = snapshot({ needsRefresh: true, issue: "timeout", feeDraft: "35.000", chatOpen: true });
  const view = project(state, true);
  assert.equal(view.busy, false);
  assert.equal(view.canSave, false);
  assert.equal(view.canRegister, false);
  assert.equal(view.feeOpen, true);
  assert.equal(view.chatOpen, true);
  assert.equal(view.feeRaw, "35.000");
  assert.equal(view.isRegistered, false);
});

test("Chat registration is enabled only when open, confirmed false and ready", () => {
  assert.equal(project(snapshot(), true).canRegister, false);
  assert.equal(project(snapshot({ chatOpen: true }), false).canRegister, true);
  const registered = snapshot({ chatOpen: true, confirmed: Object.freeze({ ...confirmed, chatInterestRegistered: true }) });
  assert.equal(project(registered, false).isRegistered, true);
  assert.equal(project(registered, false).canRegister, false);
  assert.equal(project({ ...registered, chatOpen: false }, false).isRegistered, true);
});

test("projection is immutable, deterministic and excludes unapproved presentation fields", () => {
  const state = snapshot({ feeDraft: " 35.000 " });
  const before = structuredClone(state);
  const first = project(state, true);
  assert.deepEqual(project(state, true), first);
  assert.deepEqual(state, before);
  assert.equal(state.confirmed, confirmed);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Reflect.set(first, "feeRaw", "0"), false);
  assert.equal(first.feeRaw, " 35.000 ");
  assert.deepEqual(Object.keys(first).sort(), [
    "busy", "canRegister", "canSave", "chatOpen", "feeOpen", "feeRaw", "isRegistered",
  ]);
});

test("projection never invokes the source, parser or subscriptions or changes the controller snapshot", async () => {
  const calls = { read: 0, save: 0, chat: 0, parse: 0, publish: 0 };
  const controller = createCoachPreferencesController({
    isCurrent: () => true,
    parseFee: () => { calls.parse++; return 0; },
    source: {
      read: async () => { calls.read++; return confirmed; },
      saveFee: async () => { calls.save++; return { monthlyFeeClp: 0, version: 1 }; },
      registerChatInterest: async () => { calls.chat++; return { chatInterestRegistered: true }; },
    },
  });
  const unsubscribe = controller.subscribe(() => { calls.publish++; });
  await controller.load(); controller.openFee(); controller.editFee("0");
  const state = controller.getSnapshot();
  const capability = controller.canSaveFee();
  const before = { ...calls };
  for (let count = 0; count < 3; count++) assert.equal(project(state, capability).canSave, true);
  assert.deepEqual(calls, before);
  assert.equal(controller.getSnapshot(), state);
  unsubscribe(); controller.dispose();
});

test("failed fee save preserves raw and only successful explicit readback re-enables saving", async () => {
  const readback = deferred<CoachPreferencesSnapshot>();
  let reads = 0;
  let saves = 0;
  const controller = createCoachPreferencesController({
    isCurrent: () => true, parseFee: () => 35000,
    source: {
      read: async () => ++reads === 1 ? confirmed : readback.promise,
      saveFee: async () => { saves++; throw { code: "version_conflict" }; },
      registerChatInterest: async () => ({ chatInterestRegistered: true }),
    },
  });
  const view = () => project(controller.getSnapshot(), controller.canSaveFee());
  await controller.load(); controller.openFee(); controller.editFee("35.000");
  assert.equal(view().canSave, true);
  assert.equal(await controller.saveFee(), false);
  assert.equal(view().canSave, false);
  assert.equal(view().busy, false);
  assert.equal(view().feeRaw, "35.000");
  const loading = controller.load();
  assert.equal(view().busy, true);
  assert.equal(view().canSave, false);
  readback.resolve({ ...confirmed, monthlyFeeClp: 50000, version: 1 });
  assert.equal(await loading, true);
  assert.equal(view().busy, false);
  assert.equal(view().canSave, true);
  assert.equal(view().feeRaw, "35.000");
  assert.equal(saves, 1);
  assert.equal(reads, 2);
  controller.dispose();
});

test("Chat uncertainty does not claim registration and readback reflects real confirmation", async () => {
  let stored = confirmed;
  let writes = 0;
  const controller = createCoachPreferencesController({
    isCurrent: () => true, parseFee: () => null,
    source: {
      read: async () => stored,
      saveFee: async () => { assert.fail("No fee write expected"); },
      registerChatInterest: async () => { writes++; throw { code: "timeout" }; },
    },
  });
  const view = () => project(controller.getSnapshot(), controller.canSaveFee());
  await controller.load(); controller.openChat();
  assert.equal(view().canRegister, true);
  assert.equal(await controller.registerChatInterest(), false);
  assert.equal(view().isRegistered, false);
  assert.equal(view().canRegister, false);
  assert.equal(view().busy, false);
  stored = Object.freeze({ ...confirmed, chatInterestRegistered: true });
  await controller.load();
  assert.equal(view().isRegistered, true);
  assert.equal(view().canRegister, false);
  assert.equal(view().chatOpen, true);
  assert.equal(writes, 1);
  controller.dispose();
});
