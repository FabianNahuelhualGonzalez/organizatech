import assert from "node:assert/strict";
import test from "node:test";

import type { CoachInvitationDetail, CoachInvitationGenerationOperation } from "../data/coach-invitations-contract";
import {
  createCoachInvitationActionsRuntime,
  type CoachInvitationActionsRuntimeInput,
} from "./coach-invitation-actions-runtime";

const owner = "10000000-0000-4000-8000-000000000001";
const invitationId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const otherId = "40000000-0000-4000-8000-000000000001";
const now = "2026-09-09T12:00:00.123456Z";
const configuration = {
  url: "https://coach-actions.example.invalid",
  publicKey: "sb_publishable_synthetic_not_a_key",
};
const token = "synthetic-not-a-credential";
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

function fixture(state: CoachInvitationDetail["state"] = "pending") {
  let current = true;
  let generation = 2;
  let operation: CoachInvitationGenerationOperation | null = null;
  const requests: { readonly name: string; readonly body: Record<string, unknown> }[] = [];
  const detail = (): CoachInvitationDetail => ({
    id: invitationId,
    recipientEmail: "fixture@example.invalid",
    generation,
    state,
    code: state === "pending" ? "AB2-CD3-EF4" : null,
    cancelledAt: state === "cancelled" ? now : null,
    createdAt: now,
    issuedAt: now,
    expiresAt: "2026-09-16T12:00:00.123456Z",
  } as CoachInvitationDetail);
  const input: CoachInvitationActionsRuntimeInput = {
    connection: {
      configuration,
      expectedIdentity: { userId: owner, generation: 7 },
      isCurrent: (identity) => current && identity.userId === owner && identity.generation === 7,
      principal: { auth: {
        getSession: async () => ({
          data: { session: { user: { id: owner }, access_token: token } },
          error: null,
        }),
        getUser: async (value) => ({
          data: { user: value === token ? { id: owner } : null },
          error: null,
        }),
      } },
      fetch: async (url, init = {}) => {
        const name = new URL(String(url)).pathname.split("/").at(-1)!;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ name, body });
        if (name === "read_own_coach_invitation") return json(detail());
        if (name === "read_own_coach_invitation_generation_operation") return json(operation);
        assert.ok(name === "resend_own_coach_invitation_for_generation"
          || name === "regenerate_own_coach_invitation_for_generation");
        const action = name.startsWith("resend") ? "resend" : "regenerate";
        if (action === "regenerate") {
          generation += 1;
          state = "pending";
        }
        operation = {
          requestId,
          action,
          state: "reserved",
          invitationId,
          expectedGeneration: body.p_expected_generation as number,
          generation,
          reservedAt: now,
        };
        return json({ status: "recorded", serverNow: now, operation });
      },
    },
    selection: { invitationId },
    isSelectionCurrent: (selection) => current && selection.invitationId === invitationId,
    createRequestId: () => requestId,
  };
  return {
    controller: createCoachInvitationActionsRuntime(input),
    requests,
    stale: () => { current = false; },
  };
}

test("runtime uses only generation-bound resend and strips code, email and ownership", async () => {
  const fixtureState = fixture("pending");
  assert.equal(await fixtureState.controller.load(), true);
  assert.equal(fixtureState.controller.canResend(), true);
  assert.equal(await fixtureState.controller.resend(), true);
  assert.deepEqual(fixtureState.requests.map(({ name }) => name), [
    "read_own_coach_invitation",
    "resend_own_coach_invitation_for_generation",
    "read_own_coach_invitation",
  ]);
  assert.deepEqual(fixtureState.requests[1].body, {
    p_invitation_id: invitationId,
    p_expected_generation: 2,
    p_request_id: requestId,
  });
  assert.doesNotMatch(JSON.stringify(fixtureState.controller.getSnapshot()), /AB2-CD3-EF4|fixture@example|owner/);
  fixtureState.controller.dispose();
});

test("expired invitation regenerates one generation and becomes pending", async () => {
  const fixtureState = fixture("expired");
  assert.equal(await fixtureState.controller.load(), true);
  assert.equal(fixtureState.controller.canRegenerate(), true);
  assert.equal(await fixtureState.controller.regenerate(), true);
  assert.equal(fixtureState.controller.getSnapshot().confirmed?.generation, 3);
  assert.equal(fixtureState.controller.getSnapshot().confirmed?.state, "pending");
  assert.equal(fixtureState.requests[1].name, "regenerate_own_coach_invitation_for_generation");
  fixtureState.controller.dispose();
});

test("invalid selection fails before Auth or HTTP", () => {
  const fixtureState = fixture();
  assert.throws(() => createCoachInvitationActionsRuntime({
    connection: {
      configuration,
      expectedIdentity: { userId: owner, generation: 7 },
      isCurrent: () => true,
      principal: { auth: {
        getSession: () => { throw new Error("must not run"); },
        getUser: () => { throw new Error("must not run"); },
      } },
    },
    selection: { invitationId: "invalid" },
    isSelectionCurrent: () => true,
    createRequestId: () => requestId,
  }));
  assert.equal(fixtureState.requests.length, 0);
  fixtureState.controller.dispose();
});

test("identity or selection invalidation permanently disposes the controller", async () => {
  const fixtureState = fixture();
  assert.equal(await fixtureState.controller.load(), true);
  fixtureState.stale();
  assert.equal(fixtureState.controller.getSnapshot().disposed, true);
  assert.equal(await fixtureState.controller.resend(), false);
  assert.equal(fixtureState.requests.length, 1);
});

test("a selection mismatch cannot dispatch a write", async () => {
  const fixtureState = fixture();
  await fixtureState.controller.load();
  const input = (fixtureState.controller as unknown) as { selection?: { invitationId: string } };
  assert.equal(input.selection?.invitationId, undefined);
  assert.notEqual(invitationId, otherId);
  fixtureState.controller.dispose();
});
