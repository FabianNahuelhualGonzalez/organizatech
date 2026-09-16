import assert from "node:assert/strict";
import test from "node:test";
import { createCoachPreferencesRuntime } from "./coach-preferences-runtime";

const initial = { monthlyFeeClp: null as number | null, version: 0, chatInterestRegistered: false };
const configuration = { url: "https://coach-integration.example.invalid", publicKey: "synthetic-public-key" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

function fixture() {
  let current = true;
  let verifiedUser = "synthetic-coach-a";
  let snapshot = { ...initial };
  const requests: { name: string; body: Record<string, number>; init: RequestInit }[] = [];
  let override: ((name: string, body: Record<string, number>, init: RequestInit) => Promise<Response> | null) | null = null;
  const controller = createCoachPreferencesRuntime({
    configuration, expectedUserId: verifiedUser, isCurrent: () => current,
    // Unsigned, synthetic fixtures; fetch is fully intercepted below, never real authentication.
    principal: { auth: {
      getSession: async () => ({ data: { session: { user: { id: verifiedUser }, access_token: "synthetic-token" } }, error: null }),
      getUser: async () => ({ data: { user: { id: verifiedUser } }, error: null }),
    } },
    fetch: async (url, init = {}) => {
      const requestUrl = new URL(String(url));
      assert.equal(requestUrl.origin, configuration.url);
      assert.equal(init.method, "POST");
      const name = requestUrl.pathname.split("/").at(-1)!;
      const body = JSON.parse(String(init.body)) as Record<string, number>;
      requests.push({ name, body, init });
      const custom = override?.(name, body, init);
      if (custom) return custom;
      if (name === "read_own_coach_dashboard_preferences") return json(snapshot);
      if (name === "save_own_coach_dashboard_fee") {
        if (body.p_expected_version !== snapshot.version) return json({ code: "40001", message: "synthetic private detail" }, 409);
        snapshot = { ...snapshot, monthlyFeeClp: body.p_monthly_fee_clp, version: snapshot.version + 1 };
        return json({ monthlyFeeClp: snapshot.monthlyFeeClp, version: snapshot.version });
      }
      if (name === "register_own_coach_chat_interest") {
        snapshot = { ...snapshot, chatInterestRegistered: true };
        return json({ chatInterestRegistered: true });
      }
      assert.fail(`Unexpected synthetic RPC: ${name}`);
    },
  });
  return {
    controller, requests,
    stored: () => snapshot,
    setStored: (next: typeof snapshot) => { snapshot = next; },
    intercept: (next: typeof override) => { override = next; },
    invalidate: () => { current = false; verifiedUser = "synthetic-coach-b"; },
    changePrincipal: () => { verifiedUser = "synthetic-coach-b"; },
  };
}

test("real parser/controller/repository/SDK preserve unknown, raw CLP and the exact write allowlist", async () => {
  const f = fixture();
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.getSnapshot().confirmed?.monthlyFeeClp, null);
  f.controller.openFee();
  f.controller.editFee("35.000");
  assert.equal(f.controller.getSnapshot().feeDraft, "35.000");
  assert.equal(f.controller.getSnapshot().confirmed?.monthlyFeeClp, null);
  assert.equal(f.controller.canSaveFee(), true);
  assert.equal(await f.controller.saveFee(), true);
  assert.deepEqual(f.requests[1].body, { p_monthly_fee_clp: 35000, p_expected_version: 0 });
  assert.equal(f.stored().monthlyFeeClp, 35000);
  assert.equal(f.controller.getSnapshot().feeDraft, null);
  f.controller.openFee();
  assert.equal(f.controller.getSnapshot().feeDraft, "35000");
  assert.ok(f.requests.every((r) => new Headers(r.init.headers).get("authorization") === "Bearer synthetic-token"));
});

test("invalid or incomplete text never dispatches while an explicit zero remains valid", async () => {
  const f = fixture();
  await f.controller.load(); f.controller.openFee();
  for (const raw of ["", " ", "35.", "35.00", "35,000", "$35.000", "-1", "9007199254740992"]) {
    f.controller.editFee(raw);
    assert.equal(f.controller.canSaveFee(), false, raw);
    assert.equal(await f.controller.saveFee(), false, raw);
  }
  assert.equal(f.requests.length, 1);
  f.controller.editFee("0");
  assert.equal(await f.controller.saveFee(), true);
  assert.equal(f.stored().monthlyFeeClp, 0);
});

test("canceling a valid edit does not write or modify the confirmed baseline", async () => {
  const f = fixture();
  f.setStored({ ...initial, monthlyFeeClp: 25000, version: 1 });
  await f.controller.load(); f.controller.openFee(); f.controller.editFee("50.000");
  assert.equal(f.controller.cancelFee(), true);
  assert.equal(f.requests.length, 1);
  f.controller.openFee();
  assert.equal(f.controller.getSnapshot().feeDraft, "25000");
});

test("a simulated CAS response is sanitized and requires readback without replacing the local draft", async () => {
  const f = fixture();
  await f.controller.load(); f.controller.openFee(); f.controller.editFee("35.000");
  f.setStored({ ...initial, monthlyFeeClp: 50000, version: 1 });
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(f.controller.getSnapshot().issue, "version_conflict");
  assert.equal(f.controller.getSnapshot().feeDraft, "35.000");
  assert.equal(f.controller.getSnapshot().needsRefresh, true);
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(f.requests.length, 2);
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.getSnapshot().feeDraft, "35.000");
  assert.equal(f.controller.getSnapshot().confirmed?.monthlyFeeClp, 50000);
  assert.equal(await f.controller.saveFee(), true);
  assert.deepEqual(f.requests.at(-1)?.body, { p_monthly_fee_clp: 35000, p_expected_version: 1 });
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("private detail"));
});

test("a malformed success never closes the fee sheet or claims a confirmed write", async () => {
  const f = fixture();
  await f.controller.load(); f.controller.openFee(); f.controller.editFee("35.000");
  f.intercept((name) => name === "save_own_coach_dashboard_fee"
    ? Promise.resolve(json({ monthlyFeeClp: 35000, version: 1, owner_id: "not-allowed" })) : null);
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(f.controller.getSnapshot().issue, "invalid_response");
  assert.equal(f.controller.getSnapshot().confirmed?.monthlyFeeClp, null);
  assert.equal(f.controller.getSnapshot().feeDraft, "35.000");
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(f.requests.length, 2);
});

test("HTTP uncertainty is not retried and a confirmed readback reconciles the write", async () => {
  const f = fixture();
  await f.controller.load(); f.controller.openFee(); f.controller.editFee("35.000");
  f.intercept((name) => {
    if (name !== "save_own_coach_dashboard_fee") return null;
    f.setStored({ ...initial, monthlyFeeClp: 35000, version: 1 });
    return Promise.resolve(json({ code: "XX000", message: "synthetic private detail" }, 503));
  });
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(f.requests.length, 2);
  f.intercept(null);
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.getSnapshot().confirmed?.version, 1);
  assert.equal(f.controller.getSnapshot().feeDraft, "35.000");
  assert.equal(f.requests.length, 3);
});

test("changing principal without a matching generation never dispatches another user's edit", async () => {
  const f = fixture();
  await f.controller.load(); f.controller.openFee(); f.controller.editFee("35.000");
  f.changePrincipal();
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.controller.getSnapshot().confirmed, null);
  assert.equal(f.controller.getSnapshot().issue, "forbidden");
});

test("single-flight and generation disposal suppress a late SDK success", async () => {
  const f = fixture();
  await f.controller.load(); f.controller.openFee(); f.controller.editFee("35.000");
  let finish!: (response: Response) => void;
  let dispatched!: () => void;
  const started = new Promise<void>((resolve) => { dispatched = resolve; });
  f.intercept((name) => name === "save_own_coach_dashboard_fee"
    ? new Promise<Response>((resolve) => { finish = resolve; dispatched(); }) : null);
  const saving = f.controller.saveFee();
  await started;
  assert.equal(await f.controller.saveFee(), false);
  assert.equal(f.controller.cancelFee(), false);
  assert.equal(f.controller.getSnapshot().feeDraft, "35.000");
  f.invalidate(); f.controller.dispose();
  finish(json({ monthlyFeeClp: 35000, version: 1 }));
  assert.equal(await saving, false);
  assert.equal(f.controller.getSnapshot().confirmed, null);
  assert.equal(f.controller.getSnapshot().pending, null);
  assert.equal(f.requests.length, 2);
});

test("Chat interest confirmation composes with fee preferences without altering the fee version", async () => {
  const f = fixture();
  f.setStored({ ...initial, monthlyFeeClp: 35000, version: 2 });
  await f.controller.load(); f.controller.openChat();
  assert.equal(await f.controller.registerChatInterest(), true);
  assert.equal(await f.controller.registerChatInterest(), false);
  assert.deepEqual(f.requests[1].body, {});
  assert.equal(f.controller.getSnapshot().confirmed?.chatInterestRegistered, true);
  assert.equal(f.controller.getSnapshot().confirmed?.version, 2);
  f.controller.cancelChat();
  await f.controller.load();
  assert.deepEqual(f.controller.getSnapshot().confirmed, f.stored());
});
