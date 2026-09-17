import assert from "node:assert/strict";
import test from "node:test";

import { createCoachInvitationDeliveryRuntime } from "./coach-invitation-delivery-runtime";

const OWNER = "10000000-0000-4000-8000-000000000001";
const REQUEST = "20000000-0000-4000-8000-000000000001";
const INVITATION = "30000000-0000-4000-8000-000000000001";
const TOKEN = "synthetic-not-a-secret";

function fixture(payload: unknown = { accepted: true, claimed: 2, sent: 2, pending: 0 }) {
  let current = true;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const connection = {
    configuration: { url: "https://delivery.example.invalid", publicKey: "sb_publishable_synthetic" },
    expectedIdentity: { userId: OWNER, generation: 3 },
    isCurrent: (identity: { userId: string; generation: number }) => current
      && identity.userId === OWNER && identity.generation === 3,
    principal: { auth: {
      getSession: async () => ({ data: { session: { user: { id: OWNER }, access_token: TOKEN } }, error: null }),
      getUser: async (token: string) => ({ data: { user: token === TOKEN ? { id: OWNER } : null }, error: null }),
    } },
    fetch: async (input: URL | RequestInfo, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return Response.json(payload, { status: 202 });
    },
  };
  return { runtime: createCoachInvitationDeliveryRuntime({ connection }), calls,
    stale: () => { current = false; } };
}

test("delivery runtime sends only requestId with pinned verified user token", async () => {
  const subject = fixture();
  assert.equal(await subject.runtime.dispatch(REQUEST), "provider-accepted");
  assert.equal(subject.calls.length, 1);
  assert.equal(subject.calls[0]?.url, "https://delivery.example.invalid/functions/v1/send-coach-link-emails");
  const headers = new Headers(subject.calls[0]?.init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(headers.get("apikey"), "sb_publishable_synthetic");
  assert.deepEqual(JSON.parse(String(subject.calls[0]?.init.body)), { requestId: REQUEST });
  assert.doesNotMatch(String(subject.calls[0]?.init.body), /code|email|owner|generation/);
});

test("recovery sends only a fixed flag and reuses the authenticated owner boundary", async () => {
  const subject = fixture({ accepted: true, claimed: 0, sent: 0, pending: 0 });
  assert.equal(await subject.runtime.recover(), "pending");
  assert.deepEqual(JSON.parse(String(subject.calls[0]?.init.body)), { recover: true });
  assert.doesNotMatch(String(subject.calls[0]?.init.body), /code|email|owner|requestId/);
});

test("scoped recovery sends only the selected invitation id", async () => {
  const subject = fixture({ accepted: true, claimed: 1, sent: 0, pending: 1, delivered: false });
  assert.equal(await subject.runtime.recoverInvitation(INVITATION), "pending");
  assert.deepEqual(JSON.parse(String(subject.calls[0]?.init.body)), { invitationId: INVITATION });
  assert.doesNotMatch(String(subject.calls[0]?.init.body), /code|email|owner|requestId/);
  await assert.rejects(subject.runtime.recoverInvitation("not-a-uuid"));
  assert.equal(subject.calls.length, 1);
});

test("scoped recovery publishes aggregate completion even when only one audience was claimed", async () => {
  const subject = fixture({ accepted: true, claimed: 1, sent: 1, pending: 0, delivered: true });
  assert.equal(await subject.runtime.recoverInvitation(INVITATION), "provider-accepted");
});

test("partial/provider failure remains pending and malformed responses fail closed", async () => {
  assert.equal(await fixture({ accepted: true, claimed: 2, sent: 1, pending: 1 }).runtime.dispatch(REQUEST), "pending");
  for (const payload of [null, {}, { accepted: true, claimed: 3, sent: 3, pending: 0 },
    { accepted: true, claimed: 2, sent: 2, pending: 1 },
    { accepted: true, claimed: 2, sent: 2, pending: 0, accountExists: false }]) {
    await assert.rejects(fixture(payload).runtime.dispatch(REQUEST), (error: unknown) => (
      error instanceof Error && "code" in error && error.code === "invalid_response"
    ));
  }
});

test("invalid request ids and stale identity never dispatch or publish success", async () => {
  const invalid = fixture();
  await assert.rejects(invalid.runtime.dispatch("not-a-uuid"));
  assert.equal(invalid.calls.length, 0);
  const stale = fixture();
  stale.stale();
  await assert.rejects(stale.runtime.dispatch(REQUEST), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "operation_stale"
  ));
  assert.equal(stale.calls.length, 0);
});
