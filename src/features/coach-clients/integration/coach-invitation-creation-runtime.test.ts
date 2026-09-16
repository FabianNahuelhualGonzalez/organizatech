import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createCoachInvitationCreationRuntime, type CoachInvitationCreationRuntimeInput } from "./coach-invitation-creation-runtime";
import type { CoachInvitationDetail, CoachInvitationOperation } from "../data/coach-invitations-contract";

const owner = "10000000-0000-4000-8000-000000000001";
const invitationId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const otherId = "40000000-0000-4000-8000-000000000001";
const time = "2026-09-09T10:00:00.123456Z";
const configuration = { url: "https://coach-create.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" };
const token = "synthetic-not-a-credential";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
type Request = { name: string; body: Record<string, string>; signal?: AbortSignal | null };

/** Auth/fetch are synthetic. The installed Supabase SDK constructs every RPC. */
function fixture(timeoutMilliseconds?: number) {
  let current = true; let authCalls = 0; let idCalls = 0;
  let createId = () => requestId;
  let verified: (() => void) | null = null;
  let operation: CoachInvitationOperation | null = null;
  let invitation: CoachInvitationDetail = { id: invitationId, recipientEmail: "fixture@example.invalid",
    generation: 1, state: "pending", code: "AB2-CD3-EF4", cancelledAt: null,
    createdAt: time, issuedAt: time, expiresAt: "2026-09-16T10:00:00.123456Z" };
  const requests: Request[] = [];
  let transport: ((request: Request) => Promise<Response>) | null = null;
  const normalReply = (request: Request) => {
    if (request.name === "read_own_coach_invitation_operation") return json(operation);
    if (request.name === "read_own_coach_invitation") return json(invitation);
    assert.equal(request.name, "create_own_coach_invitation");
    assert.deepEqual(Object.keys(request.body).sort(), ["p_recipient_email", "p_request_id"]);
    operation = { requestId: request.body.p_request_id, action: "create", state: "reserved",
      invitationId, generation: 1, episodeId: null, reservedAt: time };
    invitation = { ...invitation, recipientEmail: request.body.p_recipient_email };
    return json({ status: "recorded", serverNow: time, operation });
  };
  const input: CoachInvitationCreationRuntimeInput = {
    connection: { configuration: { ...configuration }, expectedIdentity: { userId: owner, generation: 8 }, timeoutMilliseconds,
      isCurrent: (identity) => current && identity.userId === owner && identity.generation === 8,
      principal: { auth: {
        getSession: async () => { authCalls++; return { data: { session: { user: { id: owner }, access_token: token } }, error: null }; },
        getUser: async (value) => { assert.equal(value, token); verified?.(); return { data: { user: { id: owner } }, error: null }; },
      } },
      fetch: async (url, init = {}) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.origin, configuration.url);
        assert.equal(init.method, "POST");
        assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${token}`);
        assert.equal(new Headers(init.headers).get("apikey"), configuration.publicKey);
        const request = { name: parsed.pathname.split("/").at(-1)!, body: JSON.parse(String(init.body)), signal: init.signal };
        requests.push(request);
        return transport ? transport(request) : normalReply(request);
      },
    },
    createRequestId: () => { idCalls++; return createId(); },
  };
  const controller = createCoachInvitationCreationRuntime(input);
  return { input, controller, requests, normalReply, counts: () => ({ idCalls, authCalls }),
    current: (value: boolean) => { current = value; },
    onVerified: (value: typeof verified) => { verified = value; },
    createId: (value: typeof createId) => { createId = value; },
    transport: (value: typeof transport) => { transport = value; },
    setOperation: (value: CoachInvitationOperation | null) => { operation = value; },
    invitation: () => invitation,
    setInvitation: (value: CoachInvitationDetail) => { invitation = value; },
  };
}
function open(f: ReturnType<typeof fixture>, email = "fixture@example.invalid") {
  assert.equal(f.controller.open(), true);
  assert.equal(f.controller.setEmail(email), true);
  assert.equal(f.controller.canSubmit(), true);
}
const writes = (requests: Request[]) => requests.filter((request) => request.name === "create_own_coach_invitation");

test("creation is explicit and allowlisted; a reservation never exposes code, delivery or account identity", async () => {
  const f = fixture();
  assert.deepEqual(f.counts(), { idCalls: 0, authCalls: 0 });
  assert.equal(await f.controller.submit(), false);
  open(f, "  FIXTURE@example.invalid  ");
  assert.equal(f.controller.getSnapshot().emailRaw, "  FIXTURE@example.invalid  ");
  assert.equal(f.requests.length, 0);
  assert.equal(f.controller.close(), true);
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.controller.open(), true);
  assert.equal(await f.controller.submit(), true);
  assert.deepEqual(writes(f.requests)[0].body, { p_recipient_email: "fixture@example.invalid", p_request_id: requestId });
  const snapshot = f.controller.getSnapshot();
  assert.equal(snapshot.attempt?.resolution, "reserved");
  assert.deepEqual(snapshot.confirmed, { id: invitationId, recipientEmail: "fixture@example.invalid", generation: 1, state: "pending" });
  assert.deepEqual(Object.keys(snapshot.attempt!.operation!).sort(), ["action", "generation", "invitationId", "requestId", "reservedAt", "state"]);
  assert.doesNotMatch(JSON.stringify(snapshot), /AB2-CD3-EF4|provider-accepted|delivered|episodeId|userId/);
  assert.equal(f.requests.length, 2);
  assert.equal(await f.controller.submit(), false);
  assert.equal(await f.controller.retry(), false);
  assert.equal(f.counts().idCalls, 1);
  f.controller.dispose();
});

test("existing recipient normalization is reused without a stricter UI-only TLD rule", async () => {
  const f = fixture();
  open(f, "  A@B.C  ");
  assert.equal(await f.controller.submit(), true);
  assert.equal(writes(f.requests)[0].body.p_recipient_email, "a@b.c");
  f.controller.dispose();
});

test("invalid raw inputs and UUIDs never reach Auth/HTTP or get silently truncated", async () => {
  for (const raw of ["", "not an email", "a\0@b.c", "a\ud800@b.c", "a".repeat(321), "a".repeat(250) + "@b.com", "\ta@b.c\t"]) {
    const f = fixture(); f.controller.open();
    assert.equal(f.controller.setEmail(raw), false);
    assert.equal(f.controller.getSnapshot().emailRaw, raw);
    assert.equal(await f.controller.submit(), false);
    assert.deepEqual(f.counts(), { idCalls: 0, authCalls: 0 });
    assert.equal(f.requests.length, 0); f.controller.dispose();
  }
  const f = fixture(); open(f); f.createId(() => "not-a-uuid");
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.requests.length, 0); f.controller.dispose();
});

test("concurrent submits and a late draft edit cannot alter the already captured creation intent", async () => {
  const f = fixture(); open(f);
  const wait = deferred<Response>();
  f.transport((request) => request.name === "create_own_coach_invitation" ? wait.promise : Promise.resolve(f.normalReply(request)));
  const work = f.controller.submit(); await setImmediate();
  assert.equal(await f.controller.submit(), false);
  f.controller.setEmail("changed@example.invalid");
  assert.equal(f.controller.canSubmit(), false);
  assert.equal(f.controller.close(), true);
  wait.resolve(f.normalReply(writes(f.requests)[0]));
  await work;
  assert.equal(writes(f.requests).length, 1);
  assert.equal(f.controller.getSnapshot().attempt?.recipientEmail, "fixture@example.invalid");
  assert.equal(f.counts().idCalls, 1);
  f.controller.dispose();
});

test("a lost successful creation is reconciled through its existing operation without another write", async () => {
  const f = fixture(10); open(f);
  f.transport(async (request) => { f.normalReply(request); return new Promise<Response>(() => {}); });
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(await f.controller.retry(), false);
  f.transport(null);
  assert.equal(await f.controller.reconcile(), true);
  assert.deepEqual(f.requests.map((request) => request.name), ["create_own_coach_invitation",
    "read_own_coach_invitation_operation", "read_own_coach_invitation"]);
  assert.equal(writes(f.requests).length, 1);
  assert.equal(f.counts().idCalls, 1); f.controller.dispose();
});

test("only an absent operation unlocks retry of the original canonical recipient and request id", async () => {
  const f = fixture(10); open(f);
  f.transport(async () => new Promise<Response>(() => {}));
  assert.equal(await f.controller.submit(), false);
  f.controller.setEmail("later@example.invalid");
  assert.equal(await f.controller.retry(), false);
  f.transport(null);
  assert.equal(await f.controller.reconcile(), false);
  assert.equal(f.controller.getSnapshot().attempt?.retryAllowed, true);
  assert.equal(await f.controller.retry(), true);
  assert.equal(writes(f.requests).length, 2);
  assert.deepEqual(writes(f.requests)[0].body, writes(f.requests)[1].body);
  assert.equal(f.counts().idCalls, 1); f.controller.dispose();
});

test("an initial authoritative limit preserves server times; a new explicit retry uses the same id", async () => {
  const f = fixture(); open(f);
  const limit = { status: "rate_limited", serverNow: time, retryAt: "2026-09-09T11:00:00.123456Z" };
  f.transport(async () => json(limit));
  assert.equal(await f.controller.submit(), false);
  assert.deepEqual(f.controller.getSnapshot().rateLimit, { serverNow: limit.serverNow, retryAt: limit.retryAt });
  assert.equal(f.controller.getSnapshot().confirmed, null);
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.requests.length, 1);
  f.transport(null);
  assert.equal(await f.controller.retry(), true);
  assert.deepEqual(writes(f.requests)[0].body, writes(f.requests)[1].body);
  assert.equal(f.counts().idCalls, 1); f.controller.dispose();
});

test("reconciliation rejects a different action before reading any invitation detail", async () => {
  const f = fixture(10); open(f);
  f.transport(async () => new Promise<Response>(() => {})); await f.controller.submit();
  f.setOperation({ requestId, action: "revoke", state: "completed", invitationId: null,
    episodeId: otherId, generation: null, reservedAt: time });
  f.transport(null);
  assert.equal(await f.controller.reconcile(), false);
  assert.equal(f.controller.getSnapshot().issue, "invalid_response");
  assert.equal(f.requests.filter((request) => request.name === "read_own_coach_invitation").length, 0);
  assert.equal(f.controller.getSnapshot().confirmed, null); f.controller.dispose();
});

test("current terminal states do not become email receipts or authorize another creation", async () => {
  for (const state of ["expired", "accepted", "cancelled"] as const) {
    const f = fixture(); open(f); await f.controller.submit();
    const detail = f.invitation();
    f.setInvitation(state === "cancelled" ? { ...detail, state, code: null, cancelledAt: time }
      : { ...detail, state, code: null, cancelledAt: null });
    if (state === "cancelled") f.setOperation({ requestId, action: "create", state: "cancelled",
      invitationId, episodeId: null, generation: 1, reservedAt: time });
    assert.equal(await f.controller.reconcile(), false);
    assert.equal(f.controller.getSnapshot().attempt?.resolution, "inactive");
    assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot()), /AB2-CD3-EF4|provider-accepted|delivered/);
    assert.equal(await f.controller.submit(), false);
    assert.equal(writes(f.requests).length, 1); f.controller.dispose();
  }
});

test("generation replacement and mismatched recipient are not adopted as a confirmed reservation", async () => {
  for (const mutation of ["generation", "recipient"] as const) {
    const f = fixture(); open(f); await f.controller.submit();
    f.setInvitation(mutation === "generation" ? { ...f.invitation(), generation: 2 }
      : { ...f.invitation(), recipientEmail: "different@example.invalid" });
    assert.equal(await f.controller.reconcile(), false);
    const snapshot = f.controller.getSnapshot();
    assert.ok(snapshot.confirmed === null || (snapshot.confirmed.generation === 1
      && snapshot.confirmed.recipientEmail === "fixture@example.invalid"));
    assert.equal(snapshot.attempt?.retryAllowed, false);
    assert.equal(writes(f.requests).length, 1); f.controller.dispose();
  }
});

test("a known recorded operation disappearing is not proof that the original write never happened", async () => {
  const f = fixture(); open(f); await f.controller.submit(); f.setOperation(null);
  assert.equal(await f.controller.reconcile(), false);
  assert.equal(f.controller.getSnapshot().attempt?.retryAllowed, false);
  assert.equal(await f.controller.retry(), false);
  assert.equal(writes(f.requests).length, 1); f.controller.dispose();
});

test("invalid responses and private backend errors do not publish partial facts or an empty success", async () => {
  for (const response of [() => json({ status: "recorded", ownerId: owner }),
    () => json({ message: "private diagnostic", details: "private diagnostic", code: "unknown" }, 500)]) {
    const f = fixture(); open(f); f.transport(async () => response());
    assert.equal(await f.controller.submit(), false);
    assert.equal(f.controller.getSnapshot().confirmed, null);
    assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot()), /private diagnostic|ownerId/);
    assert.equal(writes(f.requests).length, 1); f.controller.dispose();
  }
});

test("public configuration, principal and id callback are captured instead of reread from mutable input", async () => {
  const f = fixture(); open(f);
  Object.assign(f.input.connection.configuration, { url: "https://changed.example.invalid", publicKey: "sb_publishable_changed" });
  Object.assign(f.input.connection.expectedIdentity, { userId: otherId, generation: 99 });
  Object.assign(f.input.connection, { principal: { auth: { getSession: () => { throw new Error("changed"); } } },
    isCurrent: () => false, fetch: () => { throw new Error("changed"); } });
  Object.assign(f.input, { createRequestId: () => otherId });
  assert.equal(await f.controller.submit(), true);
  assert.equal(writes(f.requests)[0].body.p_request_id, requestId); f.controller.dispose();
});

test("observed identity invalidation is permanent and clears pending personal data", async () => {
  const f = fixture(); open(f); await f.controller.submit();
  f.current(false);
  assert.equal(f.controller.getSnapshot().disposed, true);
  f.current(true);
  assert.equal(await f.controller.submit(), false);
  assert.equal(await f.controller.reconcile(), false);
  assert.equal(f.controller.getSnapshot().emailRaw, "");
  assert.equal(f.controller.getSnapshot().confirmed, null);
  assert.equal(f.requests.length, 2);
});

test("a verified principal change before dispatch makes no write", async () => {
  const f = fixture(); open(f); f.onVerified(() => f.current(false));
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.controller.getSnapshot().disposed, true);
});

test("dispose settles pending work even if the transport ignores abort; a late success remains invisible", async () => {
  const f = fixture(); open(f); const wait = deferred<Response>();
  f.transport(() => wait.promise);
  const work = f.controller.submit(); await setImmediate(); f.controller.dispose();
  assert.equal(await Promise.race([work, setImmediate().then(() => "not settled")]), false);
  assert.equal(writes(f.requests)[0].signal?.aborted, true);
  wait.resolve(f.normalReply(writes(f.requests)[0])); await setImmediate();
  assert.equal(f.controller.getSnapshot().disposed, true);
  assert.equal(f.controller.getSnapshot().attempt, null);
});

test("the existing total RPC deadline also covers non-abortable Auth and prevents a late write", async () => {
  const f = fixture(10); open(f);
  const wait = deferred<{ data: { session: { user: { id: string }; access_token: string } }; error: null }>();
  Object.assign(f.input.connection.principal.auth, { getSession: () => wait.promise });
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.controller.getSnapshot().issue, "timeout");
  assert.equal(f.requests.length, 0);
  wait.resolve({ data: { session: { user: { id: owner }, access_token: token } }, error: null });
  await setImmediate();
  assert.equal(f.requests.length, 0); f.controller.dispose();
});

test("a mismatched authenticated user is forbidden before any POST, never a valid reservation", async () => {
  const f = fixture(); open(f);
  Object.assign(f.input.connection.principal.auth, { getUser: async () => ({ data: { user: { id: otherId } }, error: null }) });
  assert.equal(await f.controller.submit(), false);
  assert.equal(f.controller.getSnapshot().issue, "forbidden");
  assert.equal(f.controller.getSnapshot().disposed, true);
  assert.equal(f.requests.length, 0);
});
