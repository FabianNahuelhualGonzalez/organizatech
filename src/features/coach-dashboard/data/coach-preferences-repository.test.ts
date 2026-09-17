import assert from "node:assert/strict";
import test from "node:test";
import { CoachPreferencesError, type CoachPreferencesOperation } from "./coach-preferences-contract";
import { createCoachPreferencesRepository } from "./coach-preferences-repository";
import { captureCoachPreferencesOperation } from "./coach-preferences-operation";

const unknownPreferences = { monthlyFeeClp: null, version: 0, chatInterestRegistered: false };

function setup(response: unknown = unknownPreferences, error: { code?: string } | null = null) {
  const calls: { name: string; args: Readonly<Record<string, number>> }[] = [];
  const client = { rpc: async (name: string, args: Readonly<Record<string, number>>) => {
    calls.push({ name, args });
    return { data: response, error };
  } };
  const repository = createCoachPreferencesRepository({
    captureOperation: async () => ({ client, isCurrent: () => true }),
  });
  return { repository, calls, client };
}

test("read preserves an unknown fee separately from configured zero", async () => {
  assert.deepEqual(await setup().repository.read(), unknownPreferences);
  const zero = { ...unknownPreferences, monthlyFeeClp: 0, version: 1 };
  assert.deepEqual(await setup(zero).repository.read(), zero);
});

test("save sends only the exact fee/version RPC allowlist", async () => {
  const { repository, calls } = setup({ monthlyFeeClp: 35000, version: 1 });
  assert.deepEqual(await repository.saveFee({ monthlyFeeClp: 35000, expectedVersion: 0 }), {
    monthlyFeeClp: 35000, version: 1,
  });
  assert.deepEqual(calls, [{ name: "save_own_coach_dashboard_fee", args: {
    p_monthly_fee_clp: 35000, p_expected_version: 0,
  } }]);
});

test("invalid input and ownership injection never reach RPC", async () => {
  const { repository, calls } = setup();
  for (const value of [null, "", "35000", -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(repository.saveFee({ monthlyFeeClp: value as number, expectedVersion: 0 }), { code: "invalid_input" });
  }
  for (const value of [null, "", "0", -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(repository.saveFee({ monthlyFeeClp: 0, expectedVersion: value as number }), { code: "invalid_input" });
  }
  await assert.rejects(repository.saveFee({ monthlyFeeClp: 35000, expectedVersion: 0, user_id: "other" } as never), { code: "invalid_input" });
  assert.equal(calls.length, 0);
});

test("technical maximum is valid without adding commercial limits", async () => {
  const fee = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(await setup({ monthlyFeeClp: fee, version: 1 }).repository.saveFee({ monthlyFeeClp: fee, expectedVersion: 0 }), {
    monthlyFeeClp: fee, version: 1,
  });
});

test("invalid/unexpected response fields are not passed to UI", async () => {
  for (const value of [null, [], {}, { ...unknownPreferences, user_id: "other" },
    { ...unknownPreferences, monthlyFeeClp: 0 }, { ...unknownPreferences, version: 1 },
    { ...unknownPreferences, chatInterestRegistered: 1 },
    { ...unknownPreferences, monthlyFeeClp: Number.MAX_SAFE_INTEGER + 1, version: 1 }]) {
    await assert.rejects(setup(value).repository.read(), { code: "invalid_response" });
  }
  await assert.rejects(setup({ monthlyFeeClp: 100, version: 1 }).repository.saveFee({ monthlyFeeClp: 200, expectedVersion: 0 }), { code: "invalid_response" });
  await assert.rejects(setup({ monthlyFeeClp: 200, version: 2 }).repository.saveFee({ monthlyFeeClp: 200, expectedVersion: 0 }), { code: "invalid_response" });
});

test("error mapping strips database messages and does not silently retry conflicts", async () => {
  for (const [code, expected] of [["40001", "version_conflict"], ["42501", "forbidden"], ["22023", "invalid_input"], ["XX000", "unavailable"]]) {
    const { repository, calls } = setup(null, { code, message: "sensitive SQL detail" } as never);
    await assert.rejects(repository.read(), (error: unknown) => {
      assert.ok(error instanceof CoachPreferencesError);
      assert.equal(error.code, expected);
      assert.ok(!error.message.includes("sensitive"));
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test("chat intent only uses its no-argument endpoint and requires confirmed state", async () => {
  const { repository, calls } = setup({ chatInterestRegistered: true });
  assert.deepEqual(await repository.registerChatInterest(), { chatInterestRegistered: true });
  assert.deepEqual(calls, [{ name: "register_own_coach_chat_interest", args: {} }]);
  await assert.rejects(setup({ chatInterestRegistered: false }).repository.registerChatInterest(), { code: "invalid_response" });
});

test("stale operations do not write; late responses cannot update another owner", async () => {
  let current = false;
  const { client, calls } = setup();
  const repository = createCoachPreferencesRepository({ captureOperation: async () => ({ client, isCurrent: () => current }) });
  await assert.rejects(repository.read(), { code: "operation_stale" });
  assert.equal(calls.length, 0);
  current = true;
  const late = createCoachPreferencesRepository({ captureOperation: async () => ({
    isCurrent: () => current,
    client: { rpc: async () => { current = false; return { data: unknownPreferences, error: null }; } },
  }) });
  await assert.rejects(late.read(), { code: "operation_stale" });
});

test("deadline covers capture and transport; delayed capture cannot start a write", async () => {
  let resolveCapture!: (operation: CoachPreferencesOperation) => void;
  const { client, calls } = setup();
  const repository = createCoachPreferencesRepository({
    timeoutMilliseconds: 5,
    captureOperation: () => new Promise((resolve) => { resolveCapture = resolve; }),
  });
  await assert.rejects(repository.saveFee({ monthlyFeeClp: 1, expectedVersion: 0 }), { code: "timeout" });
  resolveCapture({ client, isCurrent: () => true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 0);
  let signal: AbortSignal | undefined;
  const stuck = createCoachPreferencesRepository({ timeoutMilliseconds: 5, captureOperation: async () => ({
    isCurrent: () => true,
    client: { rpc: (_name, _args, capturedSignal) => { signal = capturedSignal; return new Promise(() => {}); } },
  }) });
  await assert.rejects(stuck.read(), { code: "timeout" });
  assert.equal(signal?.aborted, true);
});

test("capture pins the verified token and never accepts a different identity", async () => {
  const { client } = setup();
  const tokens: string[] = [];
  let userId = "coach-a";
  const capture = () => captureCoachPreferencesOperation({
    expectedUserId: "coach-a", isCurrent: () => true,
    principal: { auth: {
      getSession: async () => ({ data: { session: { user: { id: userId }, access_token: "synthetic-test-token" } }, error: null }),
      getUser: async (token) => { tokens.push(token); return { data: { user: { id: userId } }, error: null }; },
    } },
    createPinnedClient: (token) => { tokens.push(token); return client; },
  });
  assert.equal((await capture()).client, client);
  assert.deepEqual(tokens, ["synthetic-test-token", "synthetic-test-token"]);
  userId = "coach-b";
  await assert.rejects(capture(), { code: "forbidden" });
  assert.equal(tokens.length, 2);
});

test("standalone capture releases stuck Auth and never creates a client on late completion", async () => {
  for (const stuckStep of ["session", "identity"]) {
    let settleSession!: (value: { data: { session: { user: { id: string }; access_token: string } }; error: null }) => void;
    let settleIdentity!: (value: { data: { user: { id: string } }; error: null }) => void;
    let clientsCreated = 0;
    let identityCalls = 0;
    const session = { data: { session: { user: { id: "coach-a" }, access_token: "synthetic-test-token" } }, error: null };
    const identity = { data: { user: { id: "coach-a" } }, error: null };
    await assert.rejects(captureCoachPreferencesOperation({
      expectedUserId: "coach-a", isCurrent: () => true, timeoutMilliseconds: 5,
      principal: { auth: {
        getSession: () => stuckStep === "session" ? new Promise((resolve) => { settleSession = resolve; }) : Promise.resolve(session),
        getUser: () => {
          identityCalls++;
          return stuckStep === "identity" ? new Promise((resolve) => { settleIdentity = resolve; }) : Promise.resolve(identity);
        },
      } },
      createPinnedClient: () => { clientsCreated++; return setup().client; },
    }), { code: "timeout" });
    if (stuckStep === "session") settleSession(session); else settleIdentity(identity);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(clientsCreated, 0);
    assert.equal(identityCalls, stuckStep === "session" ? 0 : 1);
  }
});

test("repository passes its single deadline through Auth capture", async () => {
  let created = 0;
  let sharedSignal: AbortSignal | undefined;
  const repository = createCoachPreferencesRepository({
    timeoutMilliseconds: 5,
    captureOperation: (signal) => {
      sharedSignal = signal;
      return captureCoachPreferencesOperation({
        expectedUserId: "coach-a", isCurrent: () => true, signal,
        // Ignored because the repository owns the shared deadline.
        timeoutMilliseconds: 10000,
        principal: { auth: {
          getSession: () => new Promise(() => {}),
          getUser: () => new Promise(() => {}),
        } },
        createPinnedClient: () => { created++; return setup().client; },
      });
    },
  });
  await assert.rejects(repository.read(), { code: "timeout" });
  assert.equal(sharedSignal?.aborted, true);
  assert.equal(created, 0);
});

test("an identity transition during Auth prevents pinned-client construction", async () => {
  let current = true;
  let created = 0;
  await assert.rejects(captureCoachPreferencesOperation({
    expectedUserId: "coach-a", isCurrent: () => current,
    principal: { auth: {
      getSession: async () => ({ data: { session: { user: { id: "coach-a" }, access_token: "synthetic-test-token" } }, error: null }),
      getUser: async () => { current = false; return { data: { user: { id: "coach-a" } }, error: null }; },
    } },
    createPinnedClient: () => { created++; return setup().client; },
  }), { code: "operation_stale" });
  assert.equal(created, 0);
});
