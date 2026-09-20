import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseCoachPreferencesRepository } from "./supabase-coach-preferences-repository";

const preferences = { monthlyFeeClp: null, version: 0, chatInterestRegistered: false };
const configuration = { url: "https://coach-preferences.example.invalid", publicKey: "synthetic-public-key" };
// Non-signed fixture: never sent over the network or accepted as real authentication.
function syntheticToken(subject: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: subject, exp: 4_000_000_000 })}.c3ludGhldGlj`;
}

function setup(options: { fetch?: typeof fetch; timeoutMilliseconds?: number } = {}) {
  let userId = "coach-a";
  let token = syntheticToken(userId);
  let current = true;
  let sessionCalls = 0;
  const verifiedTokens: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const principal = { auth: {
    getSession: async () => {
      sessionCalls++;
      return { data: { session: { user: { id: userId }, access_token: token } }, error: null };
    },
    getUser: async (capturedToken: string) => {
      verifiedTokens.push(capturedToken);
      return { data: { user: { id: userId } }, error: null };
    },
  } };
  const request: typeof fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return options.fetch ? options.fetch(url, init)
      : new Response(JSON.stringify(preferences), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const repository = createSupabaseCoachPreferencesRepository({
    configuration, principal, expectedUserId: "coach-a", isCurrent: () => current,
    fetch: request, timeoutMilliseconds: options.timeoutMilliseconds,
  });
  return {
    repository, requests, principal, verifiedTokens,
    sessionCalls: () => sessionCalls,
    transition: (nextUserId: string) => { userId = nextUserId; token = syntheticToken(nextUserId); current = false; },
  };
}

test("SDK sends only the verified token, public apikey and empty POST read allowlist", async () => {
  const state = setup();
  assert.deepEqual(await state.repository.read(), preferences);
  assert.equal(state.requests.length, 1);
  const { url, init } = state.requests[0];
  assert.equal(url, `${configuration.url}/rest/v1/rpc/read_own_coach_dashboard_preferences`);
  assert.equal(init.method, "POST");
  assert.equal(init.body, "{}");
  const headers = new Headers(init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${syntheticToken("coach-a")}`);
  assert.equal(headers.get("apikey"), configuration.publicKey);
  assert.equal(state.sessionCalls(), 1);
  assert.deepEqual(state.verifiedTokens, [syntheticToken("coach-a")]);
  assert.ok(init.signal);
  assert.ok(!state.requests.some((entry) => entry.url.includes("/auth/")));
});

test("SDK write body has no ownership or raw form fields", async () => {
  const state = setup({ fetch: async () => new Response(JSON.stringify({ monthlyFeeClp: 35000, version: 1 })) });
  assert.deepEqual(await state.repository.saveFee({ monthlyFeeClp: 35000, expectedVersion: 0 }), {
    monthlyFeeClp: 35000, version: 1,
  });
  assert.equal(state.requests[0].url, `${configuration.url}/rest/v1/rpc/save_own_coach_dashboard_fee`);
  assert.deepEqual(JSON.parse(String(state.requests[0].init.body)), { p_monthly_fee_clp: 35000, p_expected_version: 0 });
  await assert.rejects(state.repository.saveFee({ monthlyFeeClp: 1, expectedVersion: 1, owner_id: "other" } as never), { code: "invalid_input" });
  assert.equal(state.requests.length, 1);
});

test("SDK confirms Chat through its own no-argument endpoint", async () => {
  const state = setup({ fetch: async () => new Response(JSON.stringify({ chatInterestRegistered: true })) });
  assert.deepEqual(await state.repository.registerChatInterest(), { chatInterestRegistered: true });
  assert.equal(state.requests[0].url, `${configuration.url}/rest/v1/rpc/register_own_coach_chat_interest`);
  assert.equal(state.requests[0].init.body, "{}");
});

test("transport does not retry HTTP failures or expose database messages", async () => {
  for (const [status, payload, expected] of [
    [409, { code: "40001", message: "private SQL detail" }, "version_conflict"],
    [403, { code: "42501", message: "private SQL detail" }, "forbidden"],
    [503, { code: "XX000", message: "private SQL detail" }, "unavailable"],
  ] as const) {
    const state = setup({ fetch: async () => new Response(JSON.stringify(payload), { status }) });
    await assert.rejects(state.repository.read(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `coach-preferences-${expected}`);
      return true;
    });
    assert.equal(state.requests.length, 1);
  }
});

test("transport does not retry network errors", async () => {
  const state = setup({ fetch: async () => { throw new Error("synthetic network failure"); } });
  await assert.rejects(state.repository.read(), { code: "unavailable" });
  assert.equal(state.requests.length, 1);
});

test("shared deadline aborts the real SDK request without later success", async () => {
  let signal: AbortSignal | undefined;
  const state = setup({ timeoutMilliseconds: 15, fetch: (_url, init) => new Promise((_resolve, reject) => {
    signal = init?.signal ?? undefined;
    signal?.addEventListener("abort", () => reject(new DOMException("synthetic abort", "AbortError")), { once: true });
  }) });
  await assert.rejects(state.repository.read(), { code: "timeout" });
  assert.equal(signal?.aborted, true);
  assert.equal(state.requests.length, 1);
});

test("account transition during HTTP discards the old result and blocks new dispatch", async () => {
  let finish!: (response: Response) => void;
  let dispatched!: () => void;
  const started = new Promise<void>((resolve) => { dispatched = resolve; });
  const state = setup({ fetch: () => new Promise((resolve) => { finish = resolve; dispatched(); }) });
  const pending = state.repository.read();
  await started;
  state.transition("coach-b");
  finish(new Response(JSON.stringify(preferences)));
  await assert.rejects(pending, { code: "operation_stale" });
  await assert.rejects(state.repository.read(), { code: "operation_stale" });
  assert.equal(state.requests.length, 1);
  assert.equal(new Headers(state.requests[0].init.headers).get("authorization"), `Bearer ${syntheticToken("coach-a")}`);
});

test("public configuration is validated and snapshotted before any Auth or HTTP", async () => {
  const state = setup();
  for (const value of [
    { ...configuration, url: "http://example.invalid" },
    { ...configuration, url: "https://user:password@example.invalid" },
    { ...configuration, url: "https://example.invalid/?token=synthetic" },
    { ...configuration, url: "https://example.invalid/#fragment" },
    { ...configuration, publicKey: "" },
    { ...configuration, publicKey: "sb_secret_synthetic_do_not_use" },
  ]) {
    assert.throws(() => createSupabaseCoachPreferencesRepository({
      configuration: value, principal: state.principal, expectedUserId: "coach-a", isCurrent: () => true,
    }), { code: "invalid_input" });
  }
  assert.equal(state.sessionCalls(), 0);
  const mutable = { ...configuration, url: `${configuration.url}/rest/v1/` };
  const urls: string[] = [];
  const repository = createSupabaseCoachPreferencesRepository({
    configuration: mutable, principal: state.principal, expectedUserId: "coach-a", isCurrent: () => true,
    fetch: async (url) => { urls.push(String(url)); return new Response(JSON.stringify(preferences)); },
  });
  mutable.url = "https://another.example.invalid";
  await repository.read();
  assert.equal(urls[0], `${configuration.url}/rest/v1/rpc/read_own_coach_dashboard_preferences`);
});
