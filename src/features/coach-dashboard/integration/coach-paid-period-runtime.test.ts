import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createCoachPaidPeriodRuntime, type CoachPaidPeriodRuntimeInput } from "./coach-paid-period-runtime";
import type { CoachRenewalBaseline } from "../model/coach-renewal-draft";
import type { CoachPaidPeriodOperationReceipt, CoachPaidPeriodRead } from "../hooks/coach-paid-period-controller-contract";

const owner = "10000000-0000-4000-8000-000000000001";
const episodeId = "20000000-0000-4000-8000-000000000001";
const periodId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const oldVersion = "50000000-0000-4000-8000-000000000001";
const newVersion = "50000000-0000-4000-8000-000000000002";
const zero = "00000000-0000-0000-0000-000000000000";
const renewalId = "commercial-row-not-an-episode";
const dates = { start: "2026-09-11", end: "2026-10-11" };
const oldPeriod = { id: periodId, linkEpisodeId: episodeId, start: "2026-08-10", end: "2026-09-10" };
// Only synthetic fixtures, real SDK with every fetch intercepted. No remote I/O.
const configuration = { url: "https://coach-paid-runtime.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" };
const token = "synthetic-not-a-credential";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(existing = false, timeoutMilliseconds?: number) {
  let current = true; let selected = true; let idCalls = 0; let sessionCalls = 0; let userCalls = 0;
  let read: CoachPaidPeriodRead = { linkEpisodeId: episodeId, version: existing ? oldVersion : zero, period: existing ? oldPeriod : null };
  let receipt: CoachPaidPeriodOperationReceipt | null = null;
  let idFactory = () => requestId;
  type CapturedRequest = { name: string; body: Record<string, string>; signal?: AbortSignal | null };
  const requests: CapturedRequest[] = [];
  let transport: ((request: CapturedRequest) => Promise<Response>) | null = null;
  let onVerified: (() => void) | null = null;
  const normalReply = (request: CapturedRequest) => {
    if (request.name === "read_own_coach_paid_period") return json(read);
    if (request.name === "read_own_coach_paid_period_operation") return json(receipt);
    assert.ok(["confirm_own_coach_paid_period", "correct_own_coach_paid_period"].includes(request.name));
    const body = request.body;
    const period = { id: body.p_period_id ?? periodId, linkEpisodeId: body.p_episode_id, start: body.p_start, end: body.p_end };
    receipt = { requestId: body.p_request_id, action: request.name.startsWith("correct") ? "correct" : "confirm",
      period, version: newVersion, recordedAt: "2026-09-09T06:00:00.123456+00:00" };
    read = { linkEpisodeId: episodeId, period, version: newVersion };
    return json({ status: "recorded", operation: receipt });
  };
  const input: CoachPaidPeriodRuntimeInput = {
    connection: { configuration: { ...configuration }, expectedIdentity: { userId: owner, generation: 4 },
      timeoutMilliseconds,
      isCurrent: (snapshot) => current && snapshot.userId === owner && snapshot.generation === 4,
      principal: { auth: {
        getSession: async () => { sessionCalls++; return { data: { session: { user: { id: owner }, access_token: token } }, error: null }; },
        getUser: async (value) => { userCalls++; assert.equal(value, token); onVerified?.(); return { data: { user: { id: owner } }, error: null }; },
      } },
      fetch: async (url, init = {}) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.origin, configuration.url); assert.equal(init.method, "POST");
        assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
        assert.equal(new Headers(init.headers).get("apikey"), configuration.publicKey);
        const request = { name: parsed.pathname.split("/").at(-1)!, body: JSON.parse(String(init.body)), signal: init.signal };
        requests.push(request);
        return transport ? transport(request) : normalReply(request);
      },
    },
    selection: { renewalId, episodeId },
    isSelectionCurrent: (snapshot) => selected && snapshot.renewalId === renewalId && snapshot.episodeId === episodeId,
    createRequestId: () => { idCalls++; return idFactory(); },
  };
  const controller = createCoachPaidPeriodRuntime(input);
  const baseline = (): CoachRenewalBaseline => ({ id: renewalId, version: read.version,
    state: read.period ? "renewed" : "pending", source: "confirmed-paid-period-read",
    currentPaidPeriodEndsOn: read.period?.end ?? null,
    dates: read.period ? { start: read.period.start, end: read.period.end } : null });
  return { controller, requests, input, baseline, normalReply,
    counters: () => ({ idCalls, sessionCalls, userCalls }),
    transport: (value: typeof transport) => { transport = value; },
    idFactory: (value: typeof idFactory) => { idFactory = value; },
    onVerified: (value: typeof onVerified) => { onVerified = value; },
    current: (value: boolean) => { current = value; }, selected: (value: boolean) => { selected = value; },
    read: () => read,
  };
}

async function prepare(f: ReturnType<typeof fixture>, action: "confirm" | "correct" = "confirm") {
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.open(f.baseline(), action === "correct" ? { action, periodId } : { action }), true);
  assert.equal(f.controller.openDates(dates), true);
  // Choosing dates and accepting the inner modal remain local, not a payment.
  assert.equal(f.controller.editDates(dates), true);
  assert.equal(f.controller.acceptDates(), true);
  assert.equal(f.controller.canSave(), true);
}

test("runtime Listo confirms only explicit accepted dates through SDK then reads authoritative state", async () => {
  const f = fixture(); assert.deepEqual(f.counters(), { idCalls: 0, sessionCalls: 0, userCalls: 0 });
  await prepare(f);
  assert.equal(f.requests.length, 1); assert.equal(f.counters().idCalls, 0);
  assert.equal(await f.controller.save(), true);
  assert.deepEqual(f.requests.map((request) => request.name), ["read_own_coach_paid_period", "confirm_own_coach_paid_period", "read_own_coach_paid_period"]);
  assert.deepEqual(f.requests[1].body, { p_episode_id: episodeId, p_start: dates.start, p_end: dates.end,
    p_expected_version: zero, p_request_id: requestId });
  assert.deepEqual(f.controller.getSnapshot().confirmed, f.read());
  assert.equal(f.controller.getSnapshot().attempt?.phase, "resolved");
  assert.equal(f.counters().idCalls, 1); f.controller.dispose();
});

test("explicit correction keeps period id and baseline version rather than pretending a renewal", async () => {
  const f = fixture(true); await prepare(f, "correct");
  assert.equal(await f.controller.save(), true);
  assert.equal(f.requests[1].name, "correct_own_coach_paid_period");
  assert.deepEqual(f.requests[1].body, { p_episode_id: episodeId, p_period_id: periodId,
    p_start: dates.start, p_end: dates.end, p_expected_version: oldVersion, p_request_id: requestId });
  assert.equal(f.controller.getSnapshot().confirmed?.period?.id, periodId); f.controller.dispose();
});

test("frozen config, identity and selected row cannot be retargeted by input mutation", async () => {
  const f = fixture();
  Object.assign(f.input.connection.configuration, { url: "https://changed.example.invalid", publicKey: "sb_publishable_changed" });
  Object.assign(f.input.connection.expectedIdentity, { userId: periodId, generation: 99 });
  Object.assign(f.input.selection, { renewalId: "different-row", episodeId: periodId });
  await prepare(f); assert.equal(await f.controller.save(), true);
  assert.equal(f.requests[1].body.p_episode_id, episodeId); f.controller.dispose();
});

test("invalid runtime binding fails before I/O and invalid request ids never dispatch", async () => {
  const f = fixture();
  for (const selection of [{ renewalId: " ", episodeId }, { renewalId, episodeId: "row-is-not-uuid" }]) {
    assert.throws(() => createCoachPaidPeriodRuntime({ ...f.input, selection }), { message: "coach-paid-periods-invalid_input" });
  }
  assert.equal(f.requests.length, 0); assert.equal(f.counters().sessionCalls, 0);
  await prepare(f); f.idFactory(() => "invalid");
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.getSnapshot().issue, "invalid_request_id");
  assert.equal(f.requests.length, 1); f.controller.dispose();
});

test("strict civil dates, inner cancel, outer cancel and unpaid choices never create a payment", async () => {
  const f = fixture(); await prepare(f);
  assert.equal(f.controller.openDates(dates), true);
  assert.equal(f.controller.editDates({ start: "2026-02-30", end: dates.end }), true);
  assert.equal(f.controller.acceptDates(), false);
  assert.equal(f.controller.canSave(), false);
  assert.equal(f.controller.cancelDates(), true);
  assert.equal(f.controller.canSave(), true);
  for (const state of ["pending", "declined"] as const) {
    assert.equal(f.controller.selectState(state), true);
    assert.equal(f.controller.canSave(), false); assert.equal(await f.controller.save(), false);
  }
  assert.equal(f.controller.cancelDetail(), true);
  assert.equal(await f.controller.save(), false);
  assert.equal(f.requests.length, 1); assert.equal(f.counters().idCalls, 0); f.controller.dispose();
});

test("an SDK read failure is not represented as an authoritative absent paid period", async () => {
  const f = fixture(); f.transport(async () => json({ code: "XX000", message: "private sentinel" }, 503));
  assert.equal(await f.controller.load(), false);
  assert.equal(f.controller.getSnapshot().confirmed, null);
  assert.equal(f.controller.open(f.baseline(), { action: "confirm" }), false);
  assert.equal(f.requests.length, 1); f.controller.dispose();
});

test("double Listo is single-flight and cancellation does not discard an in-flight receipt", async () => {
  const f = fixture(); await prepare(f); const response = deferred<Response>();
  f.transport(async (request) => request.name.startsWith("confirm") ? response.promise : f.normalReply(request));
  const saving = f.controller.save(); await setImmediate();
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.cancelDetail(), true);
  assert.equal(f.controller.canSave(), false);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "in-flight");
  response.resolve(f.normalReply(f.requests[1])); await saving;
  assert.equal(f.requests.filter((request) => request.name.startsWith("confirm")).length, 1);
  assert.equal(f.counters().idCalls, 1);
  assert.equal(f.controller.getSnapshot().confirmed?.version, newVersion); f.controller.dispose();
});

test("uncertain persisted write is reconciled by the same receipt id, without a second write", async () => {
  const f = fixture(); await prepare(f);
  f.transport(async (request) => {
    if (request.name.startsWith("confirm")) { f.normalReply(request); return json({ code: "XX000", message: "private sentinel" }, 503); }
    return f.normalReply(request);
  });
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(f.requests.length, 2); // No automatic retry or operation lookup.
  assert.equal(await f.controller.reconcile(), true);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "resolved");
  assert.deepEqual(f.requests[2], { name: "read_own_coach_paid_period_operation", body: { p_request_id: requestId }, signal: f.requests[2].signal });
  assert.equal(f.requests.filter((request) => request.name.startsWith("confirm")).length, 1);
  assert.equal(f.counters().idCalls, 1); f.controller.dispose();
});

test("explicit absent receipt enables only an explicit retry with the original immutable body", async () => {
  const f = fixture(); await prepare(f);
  f.transport(async (request) => request.name.startsWith("confirm") ? json({ code: "XX000", message: "private sentinel" }, 503) : f.normalReply(request));
  assert.equal(await f.controller.save(), false); assert.equal(await f.controller.retry(), false);
  await f.controller.reconcile();
  assert.equal(f.controller.getSnapshot().attempt?.retryAllowed, true);
  assert.equal(f.requests.filter((request) => request.name.startsWith("confirm")).length, 1);
  f.transport(null); assert.equal(await f.controller.retry(), true);
  const writes = f.requests.filter((request) => request.name.startsWith("confirm"));
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].body, writes[1].body);
  assert.equal(f.counters().idCalls, 1); f.controller.dispose();
});

test("selection observed stale inside Auth cannot revive or issue a late RPC", async () => {
  const f = fixture(); f.onVerified(() => { f.selected(false); });
  assert.equal(await f.controller.load(), false);
  f.selected(true); f.onVerified(null);
  assert.equal(await f.controller.load(), false); assert.equal(f.requests.length, 0);
  assert.equal(f.controller.getSnapshot().disposed, true);
});

test("identity/selection changes and dispose discard late SDK success without publishing private rows", async () => {
  for (const invalidate of ["identity", "selection", "dispose"] as const) {
    const f = fixture(); const response = deferred<Response>(); const seen: unknown[] = [];
    f.controller.subscribe((snapshot) => seen.push(snapshot.confirmed));
    f.transport(async () => response.promise);
    const loading = f.controller.load(); await setImmediate();
    if (invalidate === "identity") f.current(false);
    if (invalidate === "selection") f.selected(false);
    if (invalidate === "dispose") f.controller.dispose();
    response.resolve(json({ linkEpisodeId: episodeId, period: oldPeriod, version: oldVersion }));
    assert.equal(await loading, false);
    assert.equal(f.controller.getSnapshot().confirmed, null);
    assert.ok(seen.every((row) => row === null));
    f.current(true); f.selected(true); assert.equal(await f.controller.load(), false);
  }
});

test("transport deadline stops saving, retains uncertain intent and suppresses late confirmation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(false, 100); await prepare(f); const response = deferred<Response>();
  f.transport(async () => response.promise);
  const saving = f.controller.save(); await setImmediate();
  t.mock.timers.tick(100); assert.equal(await saving, false);
  assert.equal(f.controller.getSnapshot().pending, null);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(f.requests[1].signal?.aborted, true);
  response.resolve(f.normalReply(f.requests[1])); await setImmediate();
  assert.equal(f.controller.getSnapshot().confirmed?.version, zero);
  assert.equal(f.requests.length, 2); f.controller.dispose();
});

test("SDK-valid old read after a receipt stays recorded until an explicit fresh reconciliation", async () => {
  const f = fixture(true); await prepare(f, "correct"); const original = f.read();
  f.transport(async (request) => request.name === "read_own_coach_paid_period" ? json(original) : f.normalReply(request));
  assert.equal(await f.controller.save(), false);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "recorded");
  assert.equal(f.controller.getSnapshot().issue, "invalid_response");
  assert.deepEqual(f.controller.getSnapshot().confirmed, original);
  assert.equal(await f.controller.retry(), false);
  f.transport(null); assert.equal(await f.controller.reconcile(), true);
  assert.equal(f.controller.getSnapshot().confirmed?.version, newVersion);
  assert.equal(f.requests.filter((request) => request.name.startsWith("correct")).length, 1);
  assert.equal(f.requests.filter((request) => request.name.endsWith("_operation")).length, 0); f.controller.dispose();
});
