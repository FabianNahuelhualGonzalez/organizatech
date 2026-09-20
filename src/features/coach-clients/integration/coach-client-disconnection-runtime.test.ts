import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createCoachClientDisconnectionRuntime, type CoachClientDisconnectionRuntimeInput } from "./coach-client-disconnection-runtime";
import type { CoachInvitationDetail, CoachInvitationOperation, CoachRelationshipDetail } from "../data/coach-invitations-contract";

const owner = "10000000-0000-4000-8000-000000000001";
const targetId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const otherId = "40000000-0000-4000-8000-000000000001";
const time = "2026-09-09T08:00:00.123456+00:00";
const configuration = { url: "https://coach-disconnect.example.invalid", publicKey: "sb_publishable_synthetic_not_a_key" };
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

/** All Auth and HTTP are synthetic; the actual installed SDK handles every RPC. */
function fixture(kind: "invitation" | "relationship" = "relationship", timeoutMilliseconds?: number) {
  let current = true; let selected = true; let idCalls = 0; let authCalls = 0;
  let createId = () => requestId;
  let onVerified: (() => void) | null = null;
  let invitation: CoachInvitationDetail = { id: targetId, recipientEmail: "fixture@example.invalid", state: "pending",
    generation: 1, createdAt: time, issuedAt: time, expiresAt: "2026-09-16T08:00:00.123456+00:00",
    cancelledAt: null, code: "AB2-CD3-EF4" };
  let relationship: CoachRelationshipDetail = { id: targetId, studentName: "Synthetic Only",
    studentEmail: "fixture@example.invalid", linkedAt: time, endedAt: null };
  let operation: CoachInvitationOperation | null = null;
  const requests: Request[] = [];
  let transport: ((request: Request) => Promise<Response>) | null = null;
  const normalReply = (request: Request) => {
    if (request.name === "read_own_coach_invitation") return json(invitation);
    if (request.name === "read_own_coach_relationship") return json(relationship);
    if (request.name === "read_own_coach_invitation_operation") return json(operation);
    if (kind === "invitation") {
      assert.equal(request.name, "cancel_own_coach_invitation");
      operation = { requestId: request.body.p_request_id, action: "cancel", state: "completed",
        invitationId: targetId, episodeId: null, generation: 1, reservedAt: time };
      invitation = { ...invitation, state: "cancelled", code: null, cancelledAt: time };
    } else {
      assert.equal(request.name, "revoke_own_coach_relationship");
      operation = { requestId: request.body.p_request_id, action: "revoke", state: "completed",
        invitationId: null, episodeId: targetId, generation: null, reservedAt: time };
      relationship = { ...relationship, endedAt: time };
    }
    return json({ status: "recorded", serverNow: time, operation });
  };
  const input: CoachClientDisconnectionRuntimeInput = {
    connection: { configuration: { ...configuration }, expectedIdentity: { userId: owner, generation: 7 }, timeoutMilliseconds,
      isCurrent: (identity) => current && identity.userId === owner && identity.generation === 7,
      principal: { auth: {
        getSession: async () => { authCalls++; return { data: { session: { user: { id: owner }, access_token: token } }, error: null }; },
        getUser: async (value) => { assert.equal(value, token); onVerified?.(); return { data: { user: { id: owner } }, error: null }; },
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
    }, selection: { kind, id: targetId },
    isSelectionCurrent: (selection) => selected && selection.kind === kind && selection.id === targetId,
    createRequestId: () => { idCalls++; return createId(); },
  };
  const controller = createCoachClientDisconnectionRuntime(input);
  return { input, controller, requests, normalReply, counts: () => ({ idCalls, authCalls }),
    current: (value: boolean) => { current = value; }, selected: (value: boolean) => { selected = value; },
    transport: (value: typeof transport) => { transport = value; }, createId: (value: typeof createId) => { createId = value; },
    onVerified: (value: typeof onVerified) => { onVerified = value; },
    invitation: () => invitation, relationship: () => relationship,
    setInvitation: (value: CoachInvitationDetail) => { invitation = value; },
    setRelationship: (value: CoachRelationshipDetail) => { relationship = value; },
  };
}
async function prepare(f: ReturnType<typeof fixture>) {
  assert.equal(await f.controller.load(), true);
  assert.equal(f.controller.openConfirmation(), true);
  assert.equal(f.controller.canConfirm(), true);
}
const writes = (requests: Request[]) => requests.filter((request) => /^(cancel|revoke)_/.test(request.name));

for (const kind of ["invitation", "relationship"] as const) {
  test(`${kind}: only explicit confirmation writes exact allowlist, then refreshes the same selected resource`, async () => {
    const f = fixture(kind); assert.deepEqual(f.counts(), { idCalls: 0, authCalls: 0 });
    await prepare(f); assert.equal(writes(f.requests).length, 0);
    assert.equal(f.controller.cancelConfirmation(), true); assert.equal(await f.controller.confirm(), false);
    assert.equal(f.controller.openConfirmation(), true);
    assert.equal(await f.controller.confirm(), true);
    assert.equal(writes(f.requests).length, 1);
    assert.deepEqual(writes(f.requests)[0].body, kind === "invitation"
      ? { p_invitation_id: targetId, p_request_id: requestId } : { p_episode_id: targetId, p_request_id: requestId });
    assert.equal(f.requests.length, 3); assert.equal(f.requests[0].name, f.requests[2].name);
    assert.equal(f.controller.getSnapshot().attempt?.phase, "resolved");
    assert.equal(f.counts().idCalls, 1);
    const state = JSON.stringify(f.controller.getSnapshot());
    assert.ok(!state.includes("fixture@example.invalid") && !state.includes("Synthetic Only") && !state.includes("AB2-CD3-EF4"));
    f.controller.dispose();
  });
}

test("accepted invitations and closed relationships never become another destructive action", async () => {
  const invitation = fixture("invitation");
  invitation.setInvitation({ ...invitation.invitation(), state: "accepted", code: null, cancelledAt: null });
  const relationship = fixture(); relationship.setRelationship({ ...relationship.relationship(), endedAt: time });
  for (const f of [invitation, relationship]) {
    await f.controller.load(); assert.equal(f.controller.openConfirmation(), false);
    assert.equal(await f.controller.confirm(), false); assert.equal(writes(f.requests).length, 0);
    assert.equal(f.counts().idCalls, 0); f.controller.dispose();
  }
});

test("an expired invitation can be explicitly cancelled without regeneration or email dispatch", async () => {
  const f = fixture("invitation"); f.setInvitation({ ...f.invitation(), state: "expired", code: null, cancelledAt: null });
  await prepare(f); assert.equal(await f.controller.confirm(), true);
  assert.deepEqual(f.requests.map((request) => request.name), ["read_own_coach_invitation", "cancel_own_coach_invitation", "read_own_coach_invitation"]);
  f.controller.dispose();
});

test("input mutation cannot retarget captured selection or public configuration", async () => {
  const f = fixture();
  Object.assign(f.input.selection, { id: otherId, kind: "invitation" });
  Object.assign(f.input.connection.configuration, { url: "https://changed.example.invalid", publicKey: "sb_publishable_changed" });
  Object.assign(f.input.connection.expectedIdentity, { userId: otherId, generation: 99 });
  await prepare(f); assert.equal(await f.controller.confirm(), true);
  assert.equal(writes(f.requests)[0].body.p_episode_id, targetId); f.controller.dispose();
});

test("invalid selection and request ids fail before mutation or private configuration access", async () => {
  const f = fixture();
  for (const selection of [{ kind: "invitation", id: "invalid" }, { kind: "unknown", id: targetId },
    { kind: "relationship", id: targetId, owner_id: owner }]) {
    assert.throws(() => createCoachClientDisconnectionRuntime({ ...f.input, selection } as CoachClientDisconnectionRuntimeInput),
      { message: "coach-invitations-invalid_input" });
  }
  assert.equal(f.counts().authCalls, 0); await prepare(f);
  f.createId(() => "invalid"); assert.equal(await f.controller.confirm(), false);
  assert.equal(f.controller.getSnapshot().issue, "invalid_request_id"); assert.equal(writes(f.requests).length, 0); f.controller.dispose();
});

test("double confirmation and closing while pending keep a single tracked operation", async () => {
  const f = fixture(); await prepare(f); const response = deferred<Response>();
  f.transport(async (request) => request.name.startsWith("revoke") ? response.promise : f.normalReply(request));
  const saving = f.controller.confirm(); await setImmediate();
  assert.equal(await f.controller.confirm(), false); assert.equal(f.controller.cancelConfirmation(), true);
  assert.equal(f.controller.openConfirmation(), false);
  response.resolve(f.normalReply(f.requests[1])); assert.equal(await saving, true);
  assert.equal(writes(f.requests).length, 1); assert.equal(f.counts().idCalls, 1); f.controller.dispose();
});

test("uncertain committed cancellation reconciles receipt and current state, never resends", async () => {
  const f = fixture("invitation"); await prepare(f);
  f.transport(async (request) => {
    if (request.name.startsWith("cancel")) { f.normalReply(request); return json({ code: "XX000", message: "private sentinel" }, 503); }
    return f.normalReply(request);
  });
  assert.equal(await f.controller.confirm(), false);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "uncertain");
  assert.equal(f.requests.length, 2); assert.equal(await f.controller.reconcile(), true);
  assert.deepEqual(f.requests[2].body, { p_request_id: requestId });
  assert.equal(f.controller.getSnapshot().attempt?.phase, "resolved");
  assert.equal(writes(f.requests).length, 1); f.controller.dispose();
});

test("null receipt permits only explicit retry of the original id and resource", async () => {
  const f = fixture(); await prepare(f);
  f.transport(async (request) => request.name.startsWith("revoke") ? json({ code: "XX000", message: "private sentinel" }, 503) : f.normalReply(request));
  assert.equal(await f.controller.confirm(), false); assert.equal(await f.controller.retry(), false);
  await f.controller.reconcile(); assert.equal(f.controller.getSnapshot().attempt?.retryAllowed, true);
  f.transport(null); assert.equal(await f.controller.retry(), true);
  assert.equal(writes(f.requests).length, 2); assert.deepEqual(writes(f.requests)[0].body, writes(f.requests)[1].body);
  assert.equal(f.counts().idCalls, 1); f.controller.dispose();
});

test("reconciliation rejects an otherwise valid operation for another action or resource", async () => {
  for (const wrong of ["action", "resource"] as const) {
    const f = fixture(); await prepare(f);
    f.transport(async (request) => {
      if (request.name.startsWith("revoke")) return json({ code: "XX000", message: "private sentinel" }, 503);
      if (request.name.endsWith("_operation")) return json(wrong === "action"
        ? { requestId, action: "cancel", state: "completed", invitationId: targetId, episodeId: null, generation: 1, reservedAt: time }
        : { requestId, action: "revoke", state: "completed", invitationId: null, episodeId: otherId, generation: null, reservedAt: time });
      return f.normalReply(request);
    });
    await f.controller.confirm(); assert.equal(await f.controller.reconcile(), false);
    assert.equal(f.controller.getSnapshot().attempt?.phase, "uncertain");
    assert.equal(f.controller.getSnapshot().issue, "invalid_response"); assert.equal(await f.controller.retry(), false);
    assert.equal(writes(f.requests).length, 1); f.controller.dispose();
  }
});

test("a receipt alone cannot turn an unchanged server read into completed disconnection", async () => {
  const f = fixture(); await prepare(f); const old = f.relationship();
  f.transport(async (request) => request.name === "read_own_coach_relationship" ? json(old) : f.normalReply(request));
  assert.equal(await f.controller.confirm(), false); assert.equal(f.controller.getSnapshot().attempt?.phase, "recorded");
  assert.equal(await f.controller.retry(), false); f.transport(null);
  assert.equal(await f.controller.reconcile(), true); assert.equal(writes(f.requests).length, 1);
  assert.equal(f.requests.filter((request) => request.name.endsWith("_operation")).length, 0); f.controller.dispose();
});

test("stale selection observed in Auth cannot revive and dispatch an RPC", async () => {
  const f = fixture(); f.onVerified(() => f.selected(false));
  assert.equal(await f.controller.load(), false); f.selected(true); f.onVerified(null);
  assert.equal(await f.controller.load(), false); assert.equal(f.requests.length, 0);
  assert.equal(f.controller.getSnapshot().disposed, true);
});

test("failed or mismatched detail reads never authorize a confirmation", async () => {
  for (const reply of [json({ code: "42501", message: "private sentinel" }, 403),
    json({ id: otherId, studentName: "Synthetic Only", studentEmail: "fixture@example.invalid", linkedAt: time, endedAt: null })]) {
    const f = fixture(); f.transport(async () => reply);
    assert.equal(await f.controller.load(), false);
    assert.equal(f.controller.getSnapshot().confirmed, null);
    assert.equal(f.controller.openConfirmation(), false); assert.equal(await f.controller.confirm(), false);
    assert.equal(writes(f.requests).length, 0);
    assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("private sentinel")); f.controller.dispose();
  }
});

test("a state conflict at confirmation does not claim a successful cancellation or issue revoke", async () => {
  const f = fixture("invitation"); await prepare(f);
  f.transport(async (request) => {
    if (request.name.startsWith("cancel")) {
      f.setInvitation({ ...f.invitation(), state: "accepted", code: null, cancelledAt: null });
      return json({ code: "55000", message: "private sentinel" }, 409);
    }
    return f.normalReply(request);
  });
  assert.equal(await f.controller.confirm(), false);
  assert.notEqual(f.controller.getSnapshot().attempt?.phase, "resolved");
  assert.equal(f.controller.getSnapshot().attempt?.receipt, null);
  assert.equal(f.requests.filter((request) => request.name.startsWith("revoke")).length, 0);
  assert.ok(!JSON.stringify(f.controller.getSnapshot()).includes("private sentinel")); f.controller.dispose();
});

test("identity change, selection change and dispose suppress late data and pending mutations", async () => {
  for (const invalidate of ["identity", "selection", "dispose"] as const) {
    const f = fixture(); const response = deferred<Response>(); f.transport(async () => response.promise);
    const loading = f.controller.load(); await setImmediate();
    if (invalidate === "identity") f.current(false);
    if (invalidate === "selection") f.selected(false);
    if (invalidate === "dispose") f.controller.dispose();
    response.resolve(json(f.relationship())); assert.equal(await loading, false);
    assert.equal(f.controller.getSnapshot().confirmed, null);
    f.current(true); f.selected(true); assert.equal(await f.controller.load(), false);
    assert.equal(writes(f.requests).length, 0);
  }
});

test("deadline retains uncertain attempt, aborts fetch, and ignores late success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture("relationship", 100); await prepare(f); const response = deferred<Response>();
  f.transport(async () => response.promise);
  const saving = f.controller.confirm(); await setImmediate(); t.mock.timers.tick(100);
  assert.equal(await saving, false); assert.equal(f.controller.getSnapshot().pending, null);
  assert.equal(f.controller.getSnapshot().attempt?.phase, "uncertain"); assert.equal(f.requests[1].signal?.aborted, true);
  response.resolve(f.normalReply(f.requests[1])); await setImmediate();
  assert.equal(f.controller.getSnapshot().attempt?.phase, "uncertain"); assert.equal(f.requests.length, 2); f.controller.dispose();
});
