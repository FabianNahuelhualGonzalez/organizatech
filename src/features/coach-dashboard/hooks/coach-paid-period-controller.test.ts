import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveCoachPaymentPeriod } from "../model/coach-payment-period";
import type { CoachRenewalBaseline, CoachRenewalCivilDateValidation, CoachRenewalPeriodTarget } from "../model/coach-renewal-draft";
import { createCoachPaidPeriodController } from "./coach-paid-period-controller";
import type { CoachPaidPeriodConfirmRequest, CoachPaidPeriodCorrectRequest, CoachPaidPeriodOperationReceipt,
  CoachPaidPeriodRead, CoachPaidPeriodRecordedResult, CoachPaidPeriodSource } from "./coach-paid-period-controller-contract";

const validation: CoachRenewalCivilDateValidation = { isValidDateKey: (today) => deriveCoachPaymentPeriod({
  today, link: { episodeId: "parser-only", state: "active" }, period: null, recordedEventKeys: new Set(),
}).kind === "available" };
const nextDates = Object.freeze({ start: "2026-09-01", end: "2026-09-30" });
const prior: CoachPaidPeriodRead = Object.freeze({ linkEpisodeId: "episode-A", version: "opaque-v1", period: Object.freeze({
  id: "period-existing", linkEpisodeId: "episode-A", start: "2026-08-01", end: "2026-08-31",
}) });
const empty: CoachPaidPeriodRead = Object.freeze({ linkEpisodeId: "episode-A", version: "opaque-empty", period: null });

function baseline(read: CoachPaidPeriodRead): CoachRenewalBaseline {
  return { id: "renewal-A", version: read.version, state: read.period ? "renewed" : "pending",
    source: "caller-provenance", currentPaidPeriodEndsOn: read.period?.end ?? null,
    dates: read.period ? { start: read.period.start, end: read.period.end } : null };
}

function receipt(request: CoachPaidPeriodConfirmRequest | CoachPaidPeriodCorrectRequest,
  action: "confirm" | "correct"): CoachPaidPeriodOperationReceipt {
  return { requestId: request.requestId, action, period: {
    id: "periodId" in request ? request.periodId : `new-${request.requestId}`, linkEpisodeId: request.episodeId,
    start: request.start, end: request.end,
  }, version: `opaque-${request.requestId}`, recordedAt: "2026-09-01T03:00:00Z" };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function harness(initial: CoachPaidPeriodRead = empty, factory?: () => string) {
  const calls: { method: string; input: unknown; signal: AbortSignal | undefined }[] = [];
  const identity = { userId: "coach-A", generation: 1 };
  const backend = { read: initial, operation: null as CoachPaidPeriodOperationReceipt | null };
  const ids = { count: 0 };
  const record = (request: CoachPaidPeriodConfirmRequest | CoachPaidPeriodCorrectRequest, action: "confirm" | "correct") => {
    const operation = receipt(request, action);
    backend.read = { linkEpisodeId: operation.period.linkEpisodeId, version: operation.version, period: operation.period };
    backend.operation = operation;
    return { status: "recorded" as const, operation };
  };
  const handlers: CoachPaidPeriodSource = {
    readPeriod: async () => backend.read,
    confirmPeriod: async (request) => record(request, "confirm"),
    correctPeriod: async (request) => record(request, "correct"),
    readOwnOperation: async () => backend.operation,
  };
  const source: CoachPaidPeriodSource = {
    readPeriod: (input, options) => { calls.push({ method: "read", input, signal: options?.signal }); return handlers.readPeriod(input, options); },
    confirmPeriod: (input, options) => { calls.push({ method: "confirm", input, signal: options?.signal }); return handlers.confirmPeriod(input, options); },
    correctPeriod: (input, options) => { calls.push({ method: "correct", input, signal: options?.signal }); return handlers.correctPeriod(input, options); },
    readOwnOperation: (input, options) => { calls.push({ method: "operation", input, signal: options?.signal }); return handlers.readOwnOperation(input, options); },
  };
  const selection = { renewalId: "renewal-A", episodeId: "episode-A" };
  const controller = createCoachPaidPeriodController({ selection, source, validation,
    isCurrent: () => identity.userId === "coach-A" && identity.generation === 1,
    createRequestId: () => { ids.count += 1; return factory ? factory() : `request-${ids.count}`; },
  });
  return { controller, backend, handlers, calls, identity, ids, selection };
}

async function ready(h: ReturnType<typeof harness>, target: CoachRenewalPeriodTarget = { action: "confirm" }) {
  assert.equal(await h.controller.load(), true);
  assert.equal(h.controller.open(baseline(h.backend.read), target), true);
  assert.equal(h.controller.openDates(nextDates), true);
  assert.equal(h.controller.editDates(nextDates), true);
  assert.equal(h.controller.acceptDates(), true);
  assert.equal(h.controller.canSave(), true);
}

test("construction, subscription and opening without facts perform no I/O or request generation", () => {
  const h = harness();
  const snapshot = h.controller.getSnapshot();
  const unsubscribe = h.controller.subscribe(() => undefined);
  assert.equal(h.controller.getSnapshot(), snapshot);
  assert.equal(snapshot.confirmed, null);
  assert.equal(snapshot.needsRefresh, true);
  assert.equal(h.controller.open(baseline(empty), { action: "confirm" }), false);
  assert.equal(h.controller.canSave(), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.ids.count, 0);
  unsubscribe();
});

test("failed/malformed reads never fabricate no period or an initial version", async () => {
  for (const value of [null, {}, { ...empty, version: "" }, { ...empty, linkEpisodeId: "other-episode" },
    { ...prior, period: { ...prior.period!, start: "2026-02-30" } }]) {
    const h = harness();
    h.handlers.readPeriod = async () => value as CoachPaidPeriodRead;
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.canSave(), false);
  }
  const h = harness(prior);
  assert.equal(await h.controller.load(), true);
  const saved = h.controller.getSnapshot().confirmed;
  h.handlers.readPeriod = async () => { throw { code: "unavailable" }; };
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.getSnapshot().confirmed, saved);
  assert.equal(h.controller.getSnapshot().needsRefresh, true);
  assert.equal(h.controller.open(baseline(prior), { action: "confirm" }), false);
});

test("open checks the explicit renewal/episode mapping, version, end and correct target/dates", async () => {
  const h = harness(prior);
  await h.controller.load();
  for (const value of [
    { ...baseline(prior), id: "episode-A" }, { ...baseline(prior), version: "wrong" },
    { ...baseline(prior), currentPaidPeriodEndsOn: null },
    { ...baseline(prior), currentPaidPeriodEndsOn: "2026-08-30" },
    { ...baseline(prior), dates: nextDates }, { ...baseline(prior), state: "invented" },
    null,
  ]) {
    assert.equal(h.controller.open(value as CoachRenewalBaseline, { action: "correct", periodId: "period-existing" }), false);
    assert.equal(h.controller.getSnapshot().draft, null);
  }
  for (const target of [{ action: "correct", periodId: "renewal-A" }, { action: "correct", periodId: "" },
    { action: "confirm", periodId: "period-existing" }, { action: "invalid" }, null]) {
    assert.equal(h.controller.open(baseline(prior), target as CoachRenewalPeriodTarget), false);
  }
  assert.equal(h.controller.open({ ...baseline(prior), dates: null }, { action: "correct", periodId: "period-existing" }), false);
  assert.equal(h.controller.open(baseline(prior), { action: "correct", periodId: "period-existing" }), true);
  assert.equal(h.controller.getSnapshot().draft?.baseline.source, "caller-provenance");
  assert.equal(h.controller.getSnapshot().draft?.baseline.id, "renewal-A");
  assert.equal(h.calls.length, 1);
  const first = harness();
  await first.controller.load();
  assert.equal(first.controller.open(baseline(empty), { action: "correct", periodId: "not-recorded" }), false);
});

test("confirm dispatches only the canonical five fields and closes only its matching draft after latest read", async () => {
  const h = harness();
  await ready(h);
  h.selection.episodeId = "mutated-caller-selection";
  assert.equal(await h.controller.save(), true);
  const write = h.calls.find((call) => call.method === "confirm")!;
  assert.deepEqual(write.input, { episodeId: "episode-A", start: nextDates.start, end: nextDates.end,
    expectedVersion: "opaque-empty", requestId: "request-1" });
  assert.equal(Object.isFrozen(write.input), true);
  assert.equal(h.controller.getSnapshot().attempt?.command.action, "confirm");
  assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
  assert.equal(h.controller.getSnapshot().confirmed?.version, "opaque-request-1");
  assert.equal(h.controller.getSnapshot().draft?.detailOpen, false);
  assert.equal(h.ids.count, 1);
});

test("correct reuses the recorded period id and existing local undo, never a renewal row id", async () => {
  const h = harness(prior);
  await h.controller.load();
  assert.equal(h.controller.open(baseline(prior), { action: "correct", periodId: "period-existing" }), true);
  const original = h.controller.getSnapshot().draft;
  assert.equal(h.controller.openDates(nextDates), true);
  assert.equal(h.controller.editDates({ start: "2026-08-02", end: "2026-08-29" }), true);
  assert.equal(h.controller.cancelDates(), true);
  assert.equal(h.controller.getSnapshot().draft?.override, original?.override);
  assert.equal(h.calls.length, 1);
  h.controller.openDates(nextDates);
  h.controller.editDates({ start: "2026-08-02", end: "2026-08-29" });
  assert.equal(h.controller.acceptDates(), true);
  assert.equal(h.calls.length, 1);
  assert.equal(await h.controller.save(), true);
  assert.deepEqual(h.calls.find((call) => call.method === "correct")?.input, {
    episodeId: "episode-A", periodId: "period-existing", start: "2026-08-02", end: "2026-08-29",
    expectedVersion: "opaque-v1", requestId: "request-1",
  });
  assert.equal(h.controller.getSnapshot().draft?.baseline.currentPaidPeriodEndsOn, "2026-08-31");
});

test("accept, nested cancel, commercial choices and detail cancel are local and never persist pending/declined", async () => {
  const h = harness();
  await ready(h);
  for (const state of ["pending", "declined"] as const) {
    h.controller.selectState(state);
    assert.equal(h.controller.canSave(), false);
    assert.equal(await h.controller.save(), false);
    h.controller.openDates(nextDates);
    h.controller.cancelDates();
    assert.equal(h.controller.getSnapshot().draft?.override?.state, state);
    h.controller.openDates(nextDates);
    h.controller.acceptDates();
  }
  h.controller.openDates(nextDates);
  h.controller.editDates({ start: "2026-02-30", end: "2026-03-30" });
  assert.equal(h.controller.acceptDates(), false);
  assert.equal(h.controller.canSave(), false);
  h.controller.cancelDetail();
  assert.equal(await h.controller.save(), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.ids.count, 0);
});

test("double click is single-flight, including id generation", async () => {
  const h = harness();
  await ready(h);
  const pending = deferred<CoachPaidPeriodRecordedResult>();
  h.handlers.confirmPeriod = () => pending.promise;
  const first = h.controller.save();
  assert.equal(await h.controller.save(), false);
  assert.equal(await h.controller.load(), false);
  assert.equal(h.calls.filter((call) => call.method === "confirm").length, 1);
  assert.equal(h.ids.count, 1);
  const operation = receipt(h.calls[1].input as CoachPaidPeriodConfirmRequest, "confirm");
  h.backend.read = { linkEpisodeId: "episode-A", version: operation.version, period: operation.period };
  pending.resolve({ status: "recorded", operation });
  assert.equal(await first, true);
});

test("cancel during dispatch keeps independent tracking and cannot release a second write", async () => {
  const h = harness();
  await ready(h);
  const pending = deferred<CoachPaidPeriodRecordedResult>();
  h.handlers.confirmPeriod = () => pending.promise;
  const saving = h.controller.save();
  assert.equal(h.controller.cancelDetail(), true);
  const closed = h.controller.getSnapshot().draft;
  assert.equal(h.controller.getSnapshot().attempt?.phase, "in-flight");
  assert.equal(h.controller.open(baseline(empty), { action: "confirm" }), false);
  pending.reject({ code: "timeout" });
  assert.equal(await saving, false);
  assert.equal(h.controller.getSnapshot().draft, closed);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(await h.controller.save(), false);
  assert.equal(h.ids.count, 1);
});

test("a successful response never clears edits made after the sent snapshot", async () => {
  const h = harness();
  await ready(h);
  const pending = deferred<CoachPaidPeriodRecordedResult>();
  h.handlers.confirmPeriod = () => pending.promise;
  const saving = h.controller.save();
  h.controller.openDates(nextDates);
  h.controller.editDates({ start: "2026-10-01", end: "2026-10-31" });
  h.controller.acceptDates();
  const newerDraft = h.controller.getSnapshot().draft;
  const operation = receipt(h.calls[1].input as CoachPaidPeriodConfirmRequest, "confirm");
  h.backend.read = { linkEpisodeId: "episode-A", version: operation.version, period: operation.period };
  pending.resolve({ status: "recorded", operation });
  assert.equal(await saving, true);
  assert.equal(h.controller.getSnapshot().draft, newerDraft);
  assert.equal(h.controller.getSnapshot().draft?.detailOpen, true);
  assert.deepEqual(h.controller.getSnapshot().attempt?.command.dates, nextDates);
  assert.equal(h.controller.canSave(), false);
});

test("synchronous listener invalidation before dispatch stops I/O, permanently, at both publication points", async () => {
  for (const when of ["pending", "attempt"]) {
    const h = harness();
    await ready(h);
    h.controller.subscribe((snapshot) => {
      if (snapshot.pending === "save" && (when === "pending" || snapshot.attempt !== null)) h.identity.generation = 2;
    });
    assert.equal(await h.controller.save(), false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.controller.getSnapshot().disposed, true);
    h.identity.generation = 1;
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().draft, null);
    assert.equal(h.controller.getSnapshot().attempt, null);
  }
});

test("a synchronous cancel before first dispatch does not save or create uncertainty", async () => {
  const h = harness();
  await ready(h);
  h.controller.subscribe((snapshot) => { if (snapshot.pending === "save" && snapshot.draft?.detailOpen) h.controller.cancelDetail(); });
  assert.equal(await h.controller.save(), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.getSnapshot().attempt, null);
  assert.equal(h.controller.getSnapshot().pending, null);
  assert.equal(h.controller.getSnapshot().issue, "draft_changed");
});

test("same-user generation change invalidates and aborts late reads/writes without reactivation", async () => {
  const h = harness();
  const pending = deferred<CoachPaidPeriodRead>();
  h.handlers.readPeriod = () => pending.promise;
  const loading = h.controller.load();
  h.identity.generation = 2;
  assert.equal(h.controller.getSnapshot().disposed, true);
  assert.equal(h.calls[0].signal?.aborted, true);
  h.identity.generation = 1;
  pending.resolve(prior);
  assert.equal(await loading, false);
  assert.equal(h.controller.getSnapshot().confirmed, null);
  const writing = harness();
  await ready(writing);
  const write = deferred<CoachPaidPeriodRecordedResult>();
  writing.handlers.confirmPeriod = () => write.promise;
  const saving = writing.controller.save();
  writing.identity.userId = "coach-B";
  writing.controller.getSnapshot();
  assert.equal(writing.calls[1].signal?.aborted, true);
  write.resolve({ status: "recorded", operation: receipt(writing.calls[1].input as CoachPaidPeriodConfirmRequest, "confirm") });
  assert.equal(await saving, false);
  assert.equal(writing.calls.filter((call) => call.method === "read").length, 1);
});

test("timeout/abort/unavailable/invalid response keep the exact uncertain attempt with no automatic retry", async () => {
  for (const code of ["timeout", "aborted", "unavailable", "invalid_response"]) {
    const h = harness();
    await ready(h);
    h.handlers.confirmPeriod = async () => { throw { code }; };
    assert.equal(await h.controller.save(), false);
    const attempt = h.controller.getSnapshot().attempt;
    assert.equal(attempt?.phase, "uncertain");
    assert.equal(attempt?.retryAllowed, false);
    assert.equal(await h.controller.save(), false);
    assert.equal(await h.controller.retry(), false);
    assert.equal(await h.controller.load(), true);
    assert.equal(h.controller.getSnapshot().attempt, attempt);
    assert.equal(h.controller.canSave(), false);
    assert.equal(h.ids.count, 1);
    assert.equal(h.calls.filter((call) => call.method === "confirm").length, 1);
  }
});

test("receipt reconciliation rejects request/action/episode/known-period/date mismatches", async () => {
  const mutations: ((value: CoachPaidPeriodOperationReceipt) => CoachPaidPeriodOperationReceipt)[] = [
    (value) => ({ ...value, requestId: "other-request" }), (value) => ({ ...value, action: "confirm" }),
    (value) => ({ ...value, period: { ...value.period, linkEpisodeId: "other-episode" } }),
    (value) => ({ ...value, period: { ...value.period, id: "other-period" } }),
    (value) => ({ ...value, period: { ...value.period, start: "2026-09-02" } }),
    (value) => ({ ...value, period: { ...value.period, end: "2026-10-01" } }),
    (value) => ({ ...value, version: "" }), (value) => ({ ...value, recordedAt: "" }),
  ];
  for (const mutate of mutations) {
    const h = harness(prior);
    await ready(h, { action: "correct", periodId: "period-existing" });
    h.handlers.correctPeriod = async () => { throw { code: "timeout" }; };
    await h.controller.save();
    h.backend.operation = mutate(receipt(h.calls[1].input as CoachPaidPeriodCorrectRequest, "correct"));
    assert.equal(await h.controller.reconcile(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
    assert.equal(h.calls.filter((call) => call.method === "read").length, 1);
  }
});

test("confirm receipt cannot reuse the previously known period id; malformed direct responses stay uncertain", async () => {
  for (const malformed of ["same-period", "missing-wrapper", "wrong-action"]) {
    const h = harness(prior);
    await ready(h);
    h.handlers.confirmPeriod = async (request) => {
      const operation = receipt(request, "confirm");
      if (malformed === "same-period") return { status: "recorded", operation: { ...operation, period: { ...operation.period, id: "period-existing" } } };
      if (malformed === "wrong-action") return { status: "recorded", operation: { ...operation, action: "correct" } };
      return operation as unknown as CoachPaidPeriodRecordedResult;
    };
    assert.equal(await h.controller.save(), false);
    assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
  }
});

test("null receipt is not absence proof: only explicit retry reuses exact original payload/id despite newer edits", async () => {
  const h = harness();
  await ready(h);
  const normal = h.handlers.confirmPeriod;
  h.handlers.confirmPeriod = async () => { throw { code: "timeout" }; };
  await h.controller.save();
  const original = h.calls[1].input;
  h.controller.openDates(nextDates);
  h.controller.editDates({ start: "2026-11-01", end: "2026-11-30" });
  h.controller.acceptDates();
  const newer = h.controller.getSnapshot().draft;
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(h.calls.at(-1)?.input, "request-1");
  assert.equal(h.controller.getSnapshot().attempt?.retryAllowed, true);
  assert.equal(h.controller.canSave(), false);
  assert.equal(await h.controller.save(), false);
  h.handlers.confirmPeriod = normal;
  assert.equal(await h.controller.retry(), true);
  assert.deepEqual(h.calls.filter((call) => call.method === "confirm")[1].input, original);
  assert.equal(h.ids.count, 1);
  assert.equal(h.controller.getSnapshot().draft, newer);
});

test("a CAS rejection of an explicit retry cannot settle the earlier uncertain dispatch", async () => {
  const h = harness();
  await ready(h);
  h.handlers.confirmPeriod = async () => { throw { code: "timeout" }; };
  await h.controller.save();
  await h.controller.reconcile();
  h.handlers.confirmPeriod = async () => { throw { code: "version_conflict" }; };
  assert.equal(await h.controller.retry(), false);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(h.controller.getSnapshot().attempt?.retryAllowed, false);
  assert.equal(h.controller.canSave(), false);
  assert.equal(h.ids.count, 1);
});

test("a matching historical receipt is distinct from the separately read latest period/version", async () => {
  const h = harness();
  await ready(h);
  h.handlers.confirmPeriod = async () => { throw { code: "timeout" }; };
  await h.controller.save();
  h.backend.operation = receipt(h.calls[1].input as CoachPaidPeriodConfirmRequest, "confirm");
  h.backend.read = { linkEpisodeId: "episode-A", version: "opaque-later-version", period: {
    id: "newer-period", linkEpisodeId: "episode-A", start: "2026-10-01", end: "2026-10-31",
  } };
  assert.equal(await h.controller.reconcile(), true);
  assert.equal(h.controller.getSnapshot().attempt?.receipt?.period.id, "new-request-1");
  assert.equal(h.controller.getSnapshot().attempt?.receipt?.version, "opaque-request-1");
  assert.equal(h.controller.getSnapshot().confirmed?.period?.id, "newer-period");
  assert.equal(h.controller.getSnapshot().confirmed?.version, "opaque-later-version");
  assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
});

test("a recorded receipt survives latest-read failure; reconcile refreshes facts without dispatching again", async () => {
  const h = harness();
  await ready(h);
  const read = h.handlers.readPeriod;
  h.handlers.readPeriod = async () => { throw { code: "unavailable" }; };
  assert.equal(await h.controller.save(), false);
  const snapshot = h.controller.getSnapshot();
  assert.equal(snapshot.attempt?.phase, "recorded");
  assert.equal(snapshot.draft?.detailOpen, true);
  assert.equal(snapshot.confirmed?.version, "opaque-empty");
  assert.equal(await h.controller.retry(), false);
  h.handlers.readPeriod = read;
  assert.equal(await h.controller.reconcile(), true);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
  assert.equal(h.calls.filter((call) => call.method === "confirm").length, 1);
  assert.equal(h.calls.filter((call) => call.method === "operation").length, 0);
});

test("first-dispatch CAS refreshes facts without rebase, draft replacement or automatic resend", async () => {
  const h = harness();
  await ready(h);
  const original = h.controller.getSnapshot().draft;
  h.handlers.confirmPeriod = async () => { h.backend.read = prior; throw { code: "version_conflict" }; };
  assert.equal(await h.controller.save(), false);
  assert.equal(h.controller.getSnapshot().confirmed?.version, "opaque-v1");
  assert.equal(h.controller.getSnapshot().draft, original);
  assert.equal(h.controller.getSnapshot().draft?.baseline.version, "opaque-empty");
  assert.equal(h.controller.getSnapshot().attempt?.phase, "rejected");
  assert.equal(h.controller.getSnapshot().issue, "version_conflict");
  assert.equal(h.controller.canSave(), false);
  assert.equal(h.ids.count, 1);
  assert.equal(h.calls.filter((call) => call.method === "confirm").length, 1);
  h.controller.cancelDetail();
  assert.equal(h.controller.open(baseline(prior), { action: "confirm" }), true);
  h.controller.openDates(nextDates);
  h.controller.editDates(nextDates);
  h.controller.acceptDates();
  assert.equal(h.controller.canSave(), true);
});

test("reconcile and retry are single-flight; null never starts a retry by itself", async () => {
  const h = harness();
  await ready(h);
  h.handlers.confirmPeriod = async () => { throw { code: "timeout" }; };
  await h.controller.save();
  const pending = deferred<CoachPaidPeriodOperationReceipt | null>();
  h.handlers.readOwnOperation = () => pending.promise;
  const checking = h.controller.reconcile();
  assert.equal(await h.controller.reconcile(), false);
  assert.equal(await h.controller.retry(), false);
  pending.resolve(null);
  assert.equal(await checking, false);
  assert.equal(h.calls.filter((call) => call.method === "confirm").length, 1);
  assert.equal(h.calls.filter((call) => call.method === "operation").length, 1);
});

test("subscriber exceptions never become transport errors or false uncertainty, including dispose", async () => {
  const h = harness();
  await ready(h);
  h.controller.subscribe(() => { throw new Error("synthetic listener"); });
  let notified = 0;
  h.controller.subscribe(() => { notified += 1; });
  assert.equal(await h.controller.save(), true);
  assert.equal(h.controller.getSnapshot().issue, null);
  assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
  assert.ok(notified > 0);
  assert.doesNotThrow(() => h.controller.dispose());
});

test("dispose aborts pending reconciliation, clears data and ignores every late outcome", async () => {
  const h = harness();
  await ready(h);
  h.handlers.confirmPeriod = async () => { throw { code: "timeout" }; };
  await h.controller.save();
  const pending = deferred<CoachPaidPeriodOperationReceipt | null>();
  h.handlers.readOwnOperation = () => pending.promise;
  const checking = h.controller.reconcile();
  const signal = h.calls.at(-1)?.signal;
  h.controller.dispose();
  assert.equal(signal?.aborted, true);
  assert.deepEqual(h.controller.getSnapshot(), { confirmed: null, draft: null, pending: null, attempt: null,
    issue: null, needsRefresh: true, disposed: true });
  pending.resolve(receipt(h.calls[1].input as CoachPaidPeriodConfirmRequest, "confirm"));
  assert.equal(await checking, false);
  assert.equal(await h.controller.save(), false);
  assert.equal(await h.controller.retry(), false);
  assert.equal(await h.controller.load(), false);
  assert.equal(h.controller.cancelDetail(), false);
});

test("invalid request id factories and repeated ids do not dispatch or leave a pending operation", async () => {
  for (const factory of [() => "", () => " \n", () => { throw new Error("factory unavailable"); }]) {
    const h = harness(empty, factory);
    await ready(h);
    assert.equal(await h.controller.save(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_request_id");
    assert.equal(h.controller.getSnapshot().pending, null);
    assert.equal(h.controller.getSnapshot().attempt, null);
    assert.equal(h.calls.length, 1);
  }
  const h = harness(empty, () => "same-request");
  await ready(h);
  assert.equal(await h.controller.save(), true);
  h.controller.open(baseline(h.backend.read), { action: "correct", periodId: h.backend.read.period!.id });
  h.controller.openDates(nextDates);
  h.controller.editDates({ start: "2026-09-02", end: "2026-09-29" });
  h.controller.acceptDates();
  assert.equal(await h.controller.save(), false);
  assert.equal(h.controller.getSnapshot().issue, "invalid_request_id");
  assert.equal(h.calls.filter((call) => call.method === "correct").length, 0);
});

test("snapshots/read facts/attempt/receipts use immutable allowlists and do not mutate caller data", async () => {
  const h = harness({ ...empty, owner_id: "not-allowed" } as CoachPaidPeriodRead);
  await h.controller.load();
  const caller = { ...baseline(empty), user_id: "not-allowed" };
  h.controller.open(caller, { action: "confirm" });
  caller.id = "changed";
  h.controller.openDates(nextDates);
  h.controller.acceptDates();
  await h.controller.save();
  const snapshot = h.controller.getSnapshot();
  assert.equal(Object.hasOwn(snapshot.confirmed!, "owner_id"), false);
  assert.equal(Object.hasOwn(snapshot.draft!.baseline, "user_id"), false);
  for (const value of [snapshot, snapshot.confirmed, snapshot.confirmed?.period, snapshot.draft, snapshot.attempt,
    snapshot.attempt?.command, snapshot.attempt?.command.dates, snapshot.attempt?.receipt, snapshot.attempt?.receipt?.period]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.equal(snapshot.attempt?.command.renewalId, "renewal-A");
});

test("controller has no ambient clock, request randomness, Auth, storage, data repository or UI imports", () => {
  for (const name of ["coach-paid-period-controller.ts", "coach-paid-period-controller-contract.ts", "coach-paid-period-reconciliation.ts"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage)\b|Date\.now|new Date\(|Math\.random|randomUUID|setTimeout|setInterval|\.rpc\(|process\.env/);
    assert.doesNotMatch(source, /from ["'][^"']*(?:\/data\/|\/components\/|calendar-reminders|supabase)[^"']*["']/);
  }
});

test("identity guard failure and revoked-access errors invalidate selection rather than allowing retries", async () => {
  for (const code of ["forbidden", "inactive_relationship", "operation_stale"]) {
    const h = harness();
    await ready(h);
    h.handlers.confirmPeriod = async () => { throw { code }; };
    assert.equal(await h.controller.save(), false);
    assert.equal(h.controller.getSnapshot().disposed, true);
    assert.equal(h.controller.getSnapshot().confirmed, null);
    assert.equal(h.controller.getSnapshot().attempt, null);
    assert.equal(await h.controller.reconcile(), false);
  }
  const h = harness();
  const stopped = createCoachPaidPeriodController({ selection: h.selection, source: h.handlers, validation,
    createRequestId: () => "unused", isCurrent: () => { throw new Error("guard failure"); } });
  assert.equal(stopped.getSnapshot().disposed, true);
  assert.equal(await stopped.load(), false);
});

test("factory-triggered invalidation/cancel is rechecked before dispatch", async () => {
  let cancel: () => void = () => undefined;
  const h = harness(empty, () => { cancel(); return "factory-request"; });
  await ready(h);
  cancel = () => { h.controller.cancelDetail(); };
  assert.equal(await h.controller.save(), false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.getSnapshot().attempt, null);
  assert.equal(h.controller.getSnapshot().pending, null);
  let invalidate: () => void = () => undefined;
  const other = harness(empty, () => { invalidate(); return "factory-request"; });
  await ready(other);
  invalidate = () => { other.identity.generation = 2; };
  assert.equal(await other.controller.save(), false);
  assert.equal(other.calls.length, 1);
  assert.equal(other.controller.getSnapshot().disposed, true);
});

test("edits during publication of latest facts are not cleared by the earlier receipt", async () => {
  const h = harness();
  await ready(h);
  let changed = false;
  h.controller.subscribe((snapshot) => {
    if (!changed && snapshot.confirmed?.version === "opaque-request-1") {
      changed = true;
      h.controller.openDates(nextDates);
      h.controller.editDates({ start: "2026-12-01", end: "2026-12-31" });
    }
  });
  assert.equal(await h.controller.save(), true);
  assert.equal(h.controller.getSnapshot().draft?.detailOpen, true);
  assert.equal(h.controller.getSnapshot().draft?.datesUndo !== null, true);
  assert.equal(h.controller.getSnapshot().draft?.override?.dates?.start, "2026-12-01");
  assert.equal(h.controller.getSnapshot().attempt?.command.dates.start, "2026-09-01");
});

test("receipt must record a changed version, both directly and via uncertain reconciliation", async () => {
  for (const viaLookup of [false, true]) {
    const h = harness(prior);
    await ready(h);
    h.handlers.confirmPeriod = async (request) => {
      const operation = { ...receipt(request, "confirm"), version: request.expectedVersion };
      h.backend.operation = operation;
      if (viaLookup) throw { code: "timeout" };
      return { status: "recorded", operation };
    };
    assert.equal(await h.controller.save(), false);
    if (viaLookup) assert.equal(await h.controller.reconcile(), false);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
    assert.equal(h.calls.filter((call) => call.method === "read").length, 1);
  }
});

test("an acknowledged write cannot resolve or publish a pre-write or absent latest period", async () => {
  for (const staleRead of [prior, { ...empty, version: "opaque-after-write-but-absent" }]) {
    const h = harness(prior);
    await ready(h);
    const original = h.controller.getSnapshot().confirmed;
    const normalRead = h.handlers.readPeriod;
    const published: unknown[] = [];
    h.controller.subscribe((snapshot) => published.push(snapshot.confirmed));
    h.handlers.readPeriod = async () => staleRead;
    assert.equal(await h.controller.save(), false);
    assert.equal(h.controller.getSnapshot().confirmed, original);
    assert.equal(h.controller.getSnapshot().attempt?.phase, "recorded");
    assert.equal(h.controller.getSnapshot().needsRefresh, true);
    assert.equal(h.controller.getSnapshot().issue, "invalid_response");
    assert.ok(published.every((read) => read === original));
    h.handlers.readPeriod = normalRead;
    assert.equal(await h.controller.reconcile(), true);
    assert.equal(h.controller.getSnapshot().attempt?.phase, "resolved");
    assert.equal(h.calls.filter((call) => call.method === "confirm").length, 1);
    assert.equal(h.calls.filter((call) => call.method === "operation").length, 0);
  }
});

test("hostile error metadata cannot reject load/save/reconcile or strand their pending state", async () => {
  let getterCalls = 0;
  const errors = [
    () => Object.defineProperty({}, "code", { get: () => { getterCalls++; throw new Error("synthetic private getter"); } }),
    () => new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error("synthetic private descriptor"); },
      has: () => { throw new Error("synthetic private has"); } }),
    () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; },
  ];
  for (const malformed of errors) {
    for (const method of ["load", "save", "reconcile"] as const) {
      const h = harness(); const error: unknown = malformed();
      if (method === "load") h.handlers.readPeriod = async () => { throw error; };
      else {
        await ready(h);
        h.handlers.confirmPeriod = async () => { throw method === "save" ? error : { code: "timeout" }; };
        if (method === "reconcile") {
          await h.controller.save();
          h.handlers.readOwnOperation = async () => { throw error; };
        }
      }
      assert.equal(await h.controller[method](), false);
      assert.equal(h.controller.getSnapshot().pending, null);
      assert.equal(h.controller.getSnapshot().issue, "unavailable");
      if (method !== "load") assert.equal(h.controller.getSnapshot().attempt?.phase, "uncertain");
      h.handlers.readPeriod = async () => h.backend.read;
      assert.equal(await h.controller.load(), true);
      h.controller.dispose();
    }
  }
  assert.equal(getterCalls, 0);
});

test("error classification reads own data descriptors only, never inherited or Proxy get/has accessors", async () => {
  let accessorCalls = 0;
  const inherited = Object.create(Object.defineProperty({}, "code", { get: () => { accessorCalls++; return "forbidden"; } }));
  const proxy = new Proxy({ code: "timeout" }, { get: () => { accessorCalls++; throw new Error("synthetic get"); },
    has: () => { accessorCalls++; throw new Error("synthetic has"); } });
  for (const [error, issue] of [[inherited, "unavailable"], [proxy, "timeout"]] as const) {
    const h = harness(); h.handlers.readPeriod = async () => { throw error; };
    assert.equal(await h.controller.load(), false);
    assert.equal(h.controller.getSnapshot().issue, issue);
    assert.equal(h.controller.getSnapshot().disposed, false);
    h.controller.dispose();
  }
  assert.equal(accessorCalls, 0);
});
