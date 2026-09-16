import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  COACH_PAID_PERIOD_INITIAL_VERSION as initial, CoachPaidPeriodsError,
  type CapturedCoachPaidPeriodsOperation, type CoachPaidPeriodsErrorCode,
  type CoachPaidPeriodsPinnedClient, type CoachPaidPeriodsRpcName,
} from "./coach-paid-periods-contract";
import { createCoachPaidPeriodsRepository, createCoachPaidPeriodsRpcAdapter } from "./coach-paid-periods-repository";

const owner = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const episodeId = "40000000-0000-4000-8000-000000000001";
const periodId = "50000000-0000-4000-8000-000000000001";
const version = "60000000-0000-4000-8000-000000000001";
const period = { id: periodId, linkEpisodeId: episodeId, start: "2026-09-01", end: "2026-09-30" };
const command = { episodeId, start: period.start, end: period.end, expectedVersion: initial, requestId };
const receipt = (action = "confirm") => ({ requestId, action, period, version, recordedAt: "2026-09-09T06:00:00.123456Z" });
const write = (action = "confirm") => ({ status: "recorded", operation: receipt(action) });
const read = () => ({ linkEpisodeId: episodeId, version, period });
const isError = (code: CoachPaidPeriodsErrorCode) => (error: unknown) => error instanceof CoachPaidPeriodsError
  && error.code === code && error.message === `coach-paid-periods-${code}`;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness() {
  const calls: Array<{ name: CoachPaidPeriodsRpcName; args: Readonly<Record<string, string>>; signal: AbortSignal }> = [];
  const identity = { userId: owner, generation: 1 };
  let currentUser = owner, currentGeneration = 1, captures = 0;
  let answer: unknown = write();
  let transport: CoachPaidPeriodsPinnedClient["rpc"] | undefined;
  const captured: CapturedCoachPaidPeriodsOperation = { identity,
    isCurrent: (snapshot) => snapshot.userId === currentUser && snapshot.generation === currentGeneration,
    client: { rpc(name, args, signal) {
      calls.push({ name, args, signal });
      return transport ? transport(name, args, signal) : Promise.resolve({ data: answer, error: null });
    } },
  };
  const repo = createCoachPaidPeriodsRepository({ captureOperation: async () => { captures++; return captured; } });
  return { repo, calls, captured, identity, get captures() { return captures; },
    answer(value: unknown) { answer = value; },
    transport(value: CoachPaidPeriodsPinnedClient["rpc"]) { transport = value; },
    changeUser() { currentUser = episodeId; }, changeGeneration() { currentGeneration++; } };
}

test("four methods dispatch exact RPC names/scalar arguments; confirmation and correction remain distinct", async () => {
  const h = harness();
  assert.equal((await h.repo.confirmPeriod(command)).operation.action, "confirm");
  h.answer(write("correct"));
  assert.equal((await h.repo.correctPeriod({ ...command, periodId })).operation.action, "correct");
  h.answer(read()); assert.deepEqual(await h.repo.readPeriod(episodeId), read());
  h.answer(receipt()); assert.deepEqual(await h.repo.readOwnOperation(requestId), receipt());
  assert.deepEqual(h.calls.map(({ name, args }) => [name, args]), [
    ["confirm_own_coach_paid_period", { p_episode_id: episodeId, p_start: period.start, p_end: period.end, p_expected_version: initial, p_request_id: requestId }],
    ["correct_own_coach_paid_period", { p_episode_id: episodeId, p_period_id: periodId, p_start: period.start, p_end: period.end, p_expected_version: initial, p_request_id: requestId }],
    ["read_own_coach_paid_period", { p_episode_id: episodeId }],
    ["read_own_coach_paid_period_operation", { p_request_id: requestId }],
  ]);
  assert.equal(h.captures, 4);
  assert.ok(h.calls.every(({ args }) => Object.isFrozen(args)));
});

test("no period and unknown operation are legitimate and never trigger writes", async () => {
  const h = harness(); h.answer({ linkEpisodeId: episodeId, version: initial, period: null });
  assert.equal((await h.repo.readPeriod(episodeId)).period, null);
  h.answer(null); assert.equal(await h.repo.readOwnOperation(requestId), null);
  assert.deepEqual(h.calls.map(({ name }) => name), ["read_own_coach_paid_period", "read_own_coach_paid_period_operation"]);
});

test("invalid scalar IDs/dates/extra ownership and hostile input properties reject before capture", async () => {
  const h = harness(); let reads = 0;
  const getter = Object.defineProperty({ ...command }, "start", { enumerable: true, get() { reads++; throw new Error("private"); } });
  for (const invalid of [null, [], {}, { ...command, owner_id: owner }, { ...command, studentId: owner },
    { ...command, periodId }, { ...command, state: "paid" }, { ...command, [Symbol("extra")]: true },
    { ...command, start: "2026-02-29" }, { ...command, end: command.start }, { ...command, expectedVersion: "version-1" },
    { ...command, requestId: "request-1" }, { ...command, episodeId: "episode-1" }, getter,
    new Proxy(command, { ownKeys() { throw new Error("private"); } })]) {
    await assert.rejects(h.repo.confirmPeriod(invalid as never), isError("invalid_input"));
  }
  await assert.rejects(h.repo.correctPeriod(command as never), isError("invalid_input"));
  await assert.rejects(h.repo.correctPeriod({ ...command, periodId: "period-1" }), isError("invalid_input"));
  await assert.rejects(h.repo.correctPeriod({ ...command, periodId, owner_id: owner } as never), isError("invalid_input"));
  for (const invalid of [null, undefined, {}, 1, "fake", `${episodeId} `]) {
    await assert.rejects(h.repo.readPeriod(invalid as never), isError("invalid_input"));
    await assert.rejects(h.repo.readOwnOperation(invalid as never), isError("invalid_input"));
  }
  assert.equal(reads, 0); assert.equal(h.captures, 0); assert.equal(h.calls.length, 0);
});

test("caller payload is snapshotted before capture awaits, retaining the original request/version", async () => {
  const h = harness(), capture = deferred<CapturedCoachPaidPeriodsOperation>();
  const repo = createCoachPaidPeriodsRepository({ captureOperation: () => capture.promise });
  const value = { ...command };
  const result = repo.confirmPeriod(value);
  value.requestId = episodeId; value.start = "2026-10-01"; value.expectedVersion = version;
  capture.resolve(h.captured); await result;
  assert.deepEqual(h.calls[0].args, { p_episode_id: episodeId, p_start: period.start, p_end: period.end,
    p_expected_version: initial, p_request_id: requestId });
});

test("stale user and same-user new generation reject before dispatch and after success/rejection", async () => {
  for (const change of ["changeUser", "changeGeneration"] as const) {
    const before = harness(); before[change]();
    await assert.rejects(before.repo.confirmPeriod(command), isError("operation_stale"));
    assert.equal(before.calls.length, 0);
    for (const rejected of [false, true]) {
      const after = harness();
      after.transport(async () => { after[change](); if (rejected) throw new Error("private"); return { data: write(), error: null }; });
      await assert.rejects(after.repo.confirmPeriod(command), isError("operation_stale"));
      assert.equal(after.calls.length, 1);
    }
  }
});

test("captured identity primitives cannot be replaced by mutating the captured object during transport", async () => {
  const h = harness();
  h.transport(async () => { h.changeGeneration(); h.identity.generation = 2; return { data: write(), error: null }; });
  await assert.rejects(h.repo.confirmPeriod(command), isError("operation_stale"));
  assert.equal(h.calls.length, 1);
});

test("malformed captured identities/generation and nonboolean currency checks fail closed", async () => {
  const h = harness();
  for (const identity of [{ userId: "not-uuid", generation: 1 }, { userId: owner, generation: -1 },
    { userId: owner, generation: NaN }, { userId: owner, generation: Number.MAX_SAFE_INTEGER + 1 },
    { userId: owner, generation: "1" }, { userId: owner, generation: 1, owner_id: owner }]) {
    const repo = createCoachPaidPeriodsRepository({ captureOperation: async () => ({ ...h.captured, identity } as never) });
    await assert.rejects(repo.readPeriod(episodeId), isError("invalid_response"));
  }
  const repo = createCoachPaidPeriodsRepository({ captureOperation: async () => ({ ...h.captured, isCurrent: () => 1 } as never) });
  await assert.rejects(repo.readPeriod(episodeId), isError("operation_stale"));
  assert.equal(h.calls.length, 0);
});

test("SQL version/request/link errors are sanitized and none retries a write", async () => {
  const errors: Array<[string, string, CoachPaidPeriodsErrorCode]> = [
    ["42501", "private", "forbidden"], ["P0002", "private", "not_found"], ["55000", "coach_paid_period_inactive_relationship", "inactive_relationship"],
    ["22023", "coach_paid_period_request_conflict", "request_conflict"], ["22023", "private", "invalid_input"],
    ["40001", "coach_paid_period_version_conflict", "version_conflict"], ["40001", "coach_paid_period_conflict", "conflict"],
    ["40001", "private", "conflict"], ["23505", "private", "unavailable"],
  ];
  for (const [code, message, mapped] of errors) {
    const h = harness();
    h.transport(async () => ({ data: null, error: { code, message, details: "private", hint: "private" } }));
    await assert.rejects(h.repo.confirmPeriod(command), isError(mapped));
    assert.equal(h.calls.length, 1);
  }
});

test("an uncertain write reconciles only when the caller explicitly reads the same requestId", async () => {
  const h = harness(); h.transport(async () => { throw new Error("private network detail"); });
  await assert.rejects(h.repo.confirmPeriod(command), isError("unavailable"));
  assert.equal(h.calls.length, 1);
  h.transport(async () => ({ data: receipt(), error: null }));
  assert.deepEqual(await h.repo.readOwnOperation(requestId), receipt());
  assert.deepEqual(h.calls.map(({ name }) => name), ["confirm_own_coach_paid_period", "read_own_coach_paid_period_operation"]);
  assert.equal(h.calls[1].args.p_request_id, requestId);
});

test("bad responses, forged references and invented copy never become payment success", async () => {
  const h = harness();
  for (const invalid of [null, {}, { ...write(), sent: true }, { ...write(), message: "Pagado" },
    { ...write(), operation: { ...receipt(), requestId: episodeId } },
    { ...write(), operation: { ...receipt(), action: "correct" } },
    { ...write(), operation: { ...receipt(), period: { ...period, linkEpisodeId: requestId } } },
    { ...write(), operation: { ...receipt(), period: { ...period, end: "2026-10-01" } } }]) {
    h.answer(invalid); await assert.rejects(h.repo.confirmPeriod(command), isError("invalid_response"));
  }
  h.answer(write("correct"));
  await assert.rejects(h.repo.correctPeriod({ ...command, periodId: episodeId }), isError("invalid_response"));
  h.answer({ ...read(), linkEpisodeId: requestId });
  await assert.rejects(h.repo.readPeriod(episodeId), isError("invalid_response"));
  h.answer({ ...receipt(), requestId: episodeId });
  await assert.rejects(h.repo.readOwnOperation(requestId), isError("invalid_response"));
});

test("shared deadline releases hung capture and prevents late dispatch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness(), capture = deferred<CapturedCoachPaidPeriodsOperation>(), started = deferred<AbortSignal>();
  const repo = createCoachPaidPeriodsRepository({ timeoutMilliseconds: 20,
    captureOperation: (signal) => { started.resolve(signal); return capture.promise; } });
  const rejected = assert.rejects(repo.confirmPeriod(command), isError("timeout"));
  const signal = await started.promise;
  t.mock.timers.tick(20); await rejected;
  assert.equal(signal.aborted, true);
  capture.resolve(h.captured); await flush();
  assert.equal(h.calls.length, 0);
});

test("one total deadline spans capture plus transport; it is not reset at dispatch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness(), capture = deferred<CapturedCoachPaidPeriodsOperation>();
  const started = deferred<AbortSignal>(), dispatched = deferred<AbortSignal>();
  h.transport((_name, _args, signal) => { dispatched.resolve(signal); return new Promise(() => undefined); });
  const repo = createCoachPaidPeriodsRepository({ timeoutMilliseconds: 50,
    captureOperation: (signal) => { started.resolve(signal); return capture.promise; } });
  const rejected = assert.rejects(repo.confirmPeriod(command), isError("timeout"));
  const signal = await started.promise;
  t.mock.timers.tick(40); capture.resolve(h.captured);
  assert.equal(await dispatched.promise, signal);
  t.mock.timers.tick(9); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await rejected;
  assert.equal(signal.aborted, true); assert.equal(h.calls.length, 1);
});

test("abort before/during capture and during transport stays distinct; late work cannot publish", async () => {
  const before = harness(), aborted = new AbortController(); aborted.abort("private");
  await assert.rejects(before.repo.confirmPeriod(command, { signal: aborted.signal }), isError("aborted"));
  assert.equal(before.captures, 0);
  const h = harness(), capture = deferred<CapturedCoachPaidPeriodsOperation>(), started = deferred<void>();
  const controller = new AbortController();
  const repo = createCoachPaidPeriodsRepository({ captureOperation: () => { started.resolve(); return capture.promise; } });
  const rejected = assert.rejects(repo.confirmPeriod(command, { signal: controller.signal }), isError("aborted"));
  await started.promise; controller.abort("private"); await rejected;
  capture.resolve(h.captured); await flush(); assert.equal(h.calls.length, 0);
  const during = harness(), transport = deferred<{ data: unknown; error: null }>(), dispatched = deferred<void>();
  const second = new AbortController();
  during.transport(() => { dispatched.resolve(); return transport.promise; });
  const stopped = assert.rejects(during.repo.confirmPeriod(command, { signal: second.signal }), isError("aborted"));
  await dispatched.promise; second.abort("private"); await stopped;
  transport.resolve({ data: write(), error: null }); await flush();
  assert.equal(during.calls.length, 1); assert.equal(during.calls[0].signal.aborted, true);
});

test("bad deadline settings never start capture", () => {
  for (const timeoutMilliseconds of [0, -1, 1.5, NaN, Infinity, 30001]) {
    assert.throws(() => createCoachPaidPeriodsRepository({ timeoutMilliseconds,
      captureOperation: () => { throw new Error("must not capture"); } }), isError("invalid_input"));
  }
});

test("tainted errors/accessors/proxies are reconstructed without raw messages or causes", async () => {
  const h = harness();
  const known = new CoachPaidPeriodsError("forbidden"); known.message = "private";
  h.transport(async () => { throw known; });
  await assert.rejects(h.repo.readPeriod(episodeId), isError("forbidden"));
  Object.defineProperty(known, "code", { get() { throw new Error("private"); } });
  h.transport(async () => { throw known; });
  await assert.rejects(h.repo.readPeriod(episodeId), isError("unavailable"));
  h.transport(async () => { throw new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("private"); } }); });
  await assert.rejects(h.repo.readPeriod(episodeId), isError("unavailable"));
  let reads = 0;
  h.transport(async () => Object.defineProperty({ error: null }, "data", { enumerable: true,
    get() { reads++; throw new Error("private"); } }) as never);
  await assert.rejects(h.repo.readPeriod(episodeId), isError("invalid_response"));
  assert.equal(reads, 0);
});

test("four-RPC adapter enforces POST, dates/UUID allowlists and the same AbortSignal without an SDK", async () => {
  const calls: unknown[] = [], controller = new AbortController();
  const adapter = createCoachPaidPeriodsRpcAdapter({ rpc(name, args, options) {
    calls.push({ name, args, options });
    return { abortSignal(signal) { assert.equal(signal, controller.signal); return Promise.resolve({ data: write(), error: null }); } };
  } });
  const args = { p_episode_id: episodeId, p_start: period.start, p_end: period.end, p_expected_version: initial, p_request_id: requestId };
  await adapter.rpc("confirm_own_coach_paid_period", args, controller.signal);
  await adapter.rpc("correct_own_coach_paid_period", { ...args, p_period_id: periodId }, controller.signal);
  await adapter.rpc("read_own_coach_paid_period", { p_episode_id: episodeId }, controller.signal);
  await adapter.rpc("read_own_coach_paid_period_operation", { p_request_id: requestId }, controller.signal);
  assert.deepEqual(calls, [
    { name: "confirm_own_coach_paid_period", args, options: { get: false, head: false } },
    { name: "correct_own_coach_paid_period", args: { ...args, p_period_id: periodId }, options: { get: false, head: false } },
    { name: "read_own_coach_paid_period", args: { p_episode_id: episodeId }, options: { get: false, head: false } },
    { name: "read_own_coach_paid_period_operation", args: { p_request_id: requestId }, options: { get: false, head: false } },
  ]);
  for (const bad of [{ ...args, p_owner_id: owner }, { ...args, p_request_id: "bad" }, { ...args, p_end: args.p_start },
    { ...args, p_start: "2026-02-29" }]) {
    await assert.rejects(Promise.resolve(adapter.rpc("confirm_own_coach_paid_period", bad, controller.signal)), isError("invalid_input"));
  }
  await assert.rejects(Promise.resolve(adapter.rpc("create_own_coach_invitation" as never, {}, controller.signal)), isError("invalid_input"));
  controller.abort();
  await assert.rejects(Promise.resolve(adapter.rpc("read_own_coach_paid_period", { p_episode_id: episodeId }, controller.signal)), isError("aborted"));
  assert.equal(calls.length, 4);
});

test("repository composes with the pinned RPC adapter and has no UI/Auth/SQL side effects", async () => {
  const calls: unknown[] = [];
  const adapter = createCoachPaidPeriodsRpcAdapter({ rpc(name, args, options) {
    calls.push({ name, args, options });
    return { abortSignal: async () => ({ data: write(), error: null, status: 200, count: null, statusText: "OK" }) };
  } });
  const repo = createCoachPaidPeriodsRepository({ captureOperation: async () => ({ identity: { userId: owner, generation: 1 },
    isCurrent: () => true, client: adapter }) });
  assert.equal((await repo.confirmPeriod(command)).operation.action, "confirm");
  assert.equal(calls.length, 1);
  const source = readFileSync("src/features/coach-clients/data/coach-paid-periods-repository.ts", "utf8");
  assert.match(source, /import \{ withCoachInvitationsDeadline \} from "\.\/coach-invitations-deadline"/);
  assert.doesNotMatch(source, /createClient|\.auth\.|\.from\(|fetch\(|console\.|setTimeout\(|Math\.random|randomUUID|useEffect/);
});
