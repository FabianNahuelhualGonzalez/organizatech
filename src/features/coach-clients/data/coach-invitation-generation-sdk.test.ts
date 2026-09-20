import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError, type CoachInvitationsErrorCode } from "./coach-invitations-contract";
import { createSupabaseCoachInvitationsRepository } from "./supabase-coach-invitations-repository";

// All I/O intercepted. No real Auth, project, key, email or invitation is used.
const owner = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const now = "2026-09-09T12:00:00.123456Z";
const token = "synthetic-generation-session-not-a-credential";
const command = { invitationId, requestId, expectedGeneration: 2 };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const receipt = (action = "resend") => ({ requestId, action, state: "reserved", invitationId,
  expectedGeneration: 2, generation: action === "regenerate" ? 3 : 2, reservedAt: now });
const issue = (code: CoachInvitationsErrorCode) => (error: unknown) => error instanceof CoachInvitationsError
  && error.code === code && error.message === `coach-invitations-${code}` && !("cause" in error);
const deferred = <T>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>((done) => setTimeout(done, 0));
function fixture(timeoutMilliseconds = 8_000) {
  let current = true, sessions = 0, users = 0;
  const verified = () => ({ data: { user: { id: owner } }, error: null });
  let verify = async () => verified();
  const calls: { name: string; args: unknown; signal: AbortSignal | null | undefined }[] = [];
  let transport: ((name: string) => Promise<Response>) | null = null;
  const repo = createSupabaseCoachInvitationsRepository({
    configuration: { url: "https://coach-generation.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" },
    expectedIdentity: { userId: owner, generation: 1 }, isCurrent: () => current, timeoutMilliseconds,
    principal: { auth: {
      getSession: async () => { sessions++; return { data: { session: { user: { id: owner }, access_token: token } }, error: null }; },
      getUser: (value) => { users++; assert.equal(value, token); return verify(); },
    } },
    fetch: async (url, init = {}) => {
      const parsed = new URL(String(url)); assert.equal(parsed.origin, "https://coach-generation.example.invalid");
      assert.match(parsed.pathname, /^\/rest\/v1\/rpc\/[a-z_]+$/); assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
      const name = parsed.pathname.split("/").at(-1)!;
      calls.push({ name, args: JSON.parse(String(init.body)), signal: init.signal });
      if (transport) return transport(name);
      if (name === "read_own_coach_invitation_generation_operation") return json(receipt());
      return json({ status: "recorded", serverNow: now, operation: receipt(name.split("_")[0]) });
    },
  });
  return { repo, calls, verified, counters: () => ({ sessions, users }),
    verify: (next: typeof verify) => { verify = next; },
    transport: (next: typeof transport) => { transport = next; }, stale: () => { current = false; } };
}
test("real SDK serializes exact bound write/read bodies with numeric expected generation", async () => {
  const f = fixture();
  await f.repo.resendInvitationForGeneration(command); await f.repo.regenerateInvitationForGeneration(command);
  await f.repo.readOwnGenerationOperation(requestId);
  assert.deepEqual(f.calls.map(({ name, args }) => [name, args]), [
    ["resend_own_coach_invitation_for_generation", { p_invitation_id: invitationId, p_expected_generation: 2, p_request_id: requestId }],
    ["regenerate_own_coach_invitation_for_generation", { p_invitation_id: invitationId, p_expected_generation: 2, p_request_id: requestId }],
    ["read_own_coach_invitation_generation_operation", { p_request_id: requestId }],
  ]);
  assert.deepEqual(f.counters(), { sessions: 3, users: 3 });
});
test("invalid generation intent fails before Auth or SDK fetch", async () => {
  const f = fixture();
  await assert.rejects(f.repo.resendInvitationForGeneration({ ...command, expectedGeneration: "2" } as never), issue("invalid_input"));
  await assert.rejects(f.repo.regenerateInvitationForGeneration({ ...command, owner_id: owner } as never), issue("invalid_input"));
  assert.deepEqual(f.counters(), { sessions: 0, users: 0 }); assert.equal(f.calls.length, 0);
});
test("verified identity mismatch and stale verification prevent dispatch", async () => {
  const f = fixture(); f.verify(async () => ({ data: { user: { id: invitationId } }, error: null }));
  await assert.rejects(f.repo.resendInvitationForGeneration(command), issue("forbidden")); assert.equal(f.calls.length, 0);
  const g = fixture(); g.verify(async () => { g.stale(); return g.verified(); });
  await assert.rejects(g.repo.regenerateInvitationForGeneration(command), issue("operation_stale")); assert.equal(g.calls.length, 0);
});
test("Auth timeout suppresses late bound write dispatch", async () => {
  const f = fixture(20), pending = deferred<ReturnType<typeof f.verified>>(); f.verify(() => pending.promise);
  await assert.rejects(f.repo.resendInvitationForGeneration(command), issue("timeout"));
  pending.resolve(f.verified()); await tick(); assert.equal(f.calls.length, 0);
});
for (const kind of ["network", "http", "generation-conflict", "legacy-conflict"] as const) {
  test(`SDK ${kind} is sanitized and never retried implicitly`, async () => {
    const f = fixture(); f.transport(async () => {
      if (kind === "network") throw new Error("private sentinel");
      return json({ code: kind === "generation-conflict" ? "55000" : kind === "legacy-conflict" ? "22023" : "XX000",
        message: "private sentinel", details: "private sentinel" }, kind === "http" ? 503 : 400);
    });
    await assert.rejects(f.repo.resendInvitationForGeneration(command), issue(
      kind === "generation-conflict" ? "state_conflict" : kind === "legacy-conflict" ? "invalid_input" : "unavailable"));
    assert.equal(f.calls.length, 1);
    f.transport(null); const operation = await f.repo.readOwnGenerationOperation(requestId);
    assert.equal(operation?.requestId, requestId); assert.equal(operation?.expectedGeneration, 2);
    assert.equal(f.calls.length, 2);
  });
}
test("fetch timeout and explicit abort propagate AbortSignal and ignore late responses", async () => {
  const f = fixture(20), pending = deferred<Response>(); f.transport(() => pending.promise);
  await assert.rejects(f.repo.regenerateInvitationForGeneration(command), issue("timeout"));
  assert.equal(f.calls[0].signal?.aborted, true); pending.resolve(json(receipt())); await tick();
  assert.equal(f.calls.length, 1);
  const g = fixture(), late = deferred<Response>(), controller = new AbortController(); g.transport(() => late.promise);
  const result = g.repo.resendInvitationForGeneration(command, { signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(result, issue("aborted"));
  assert.equal(g.calls[0].signal?.aborted, true); late.resolve(json(receipt()));
});
test("session change during SDK request cannot publish an old identity receipt", async () => {
  const f = fixture(); f.transport(async () => { f.stale(); return json({ status: "recorded", serverNow: now, operation: receipt() }); });
  await assert.rejects(f.repo.resendInvitationForGeneration(command), issue("operation_stale")); assert.equal(f.calls.length, 1);
});
test("old DTO, extra private fields or delivery claims are rejected through actual SDK", async () => {
  const f = fixture(), { expectedGeneration: unused, ...legacy } = receipt(); void unused;
  for (const data of [{ ...legacy, episodeId: null }, { ...receipt(), code: "private sentinel" }, { ...receipt(), state: "delivered" }]) {
    f.transport(async () => json(data)); await assert.rejects(f.repo.readOwnGenerationOperation(requestId), issue("invalid_response"));
  }
  f.transport(async () => json(null)); assert.equal(await f.repo.readOwnGenerationOperation(requestId), null);
});
