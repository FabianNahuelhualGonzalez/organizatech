import assert from "node:assert/strict";
import test from "node:test";

import type { CoachInvitationActionsSnapshot } from "../hooks/coach-invitation-actions-contract";
import {
  hasUnresolvedCoachInvitationAction,
  resolveCoachInvitationDetailAction,
} from "./coach-invitation-actions-presentation";

const attempt = Object.freeze({
  invitationId: "11111111-1111-4111-8111-111111111111",
  expectedGeneration: 2,
  requestId: "22222222-2222-4222-8222-222222222222",
  action: "resend" as const,
  phase: "uncertain" as const,
  operation: null,
  retryAllowed: false,
  resolution: null,
});

function snapshot(patch: Partial<CoachInvitationActionsSnapshot> = {}): CoachInvitationActionsSnapshot {
  return { confirmed: null, pending: null, attempt: null, rateLimit: null, issue: null,
    needsRefresh: false, disposed: false, ...patch };
}

test("fresh server capabilities select resend or generation", () => {
  assert.equal(resolveCoachInvitationDetailAction(snapshot(), { canResend: true, canRegenerate: false }), "resend");
  assert.equal(resolveCoachInvitationDetailAction(snapshot(), { canResend: false, canRegenerate: true }), "regenerate");
});

test("uncertainty reconciles and an unlocked same-intent retry takes priority", () => {
  const uncertain = snapshot({ attempt, needsRefresh: true });
  assert.equal(resolveCoachInvitationDetailAction(uncertain, { canResend: false, canRegenerate: false }), "reconcile");
  assert.equal(hasUnresolvedCoachInvitationAction(uncertain), true);
  const retry = snapshot({ attempt: { ...attempt, retryAllowed: true }, needsRefresh: true });
  assert.equal(resolveCoachInvitationDetailAction(retry, { canResend: false, canRegenerate: false }), "retry");
});

test("busy cannot dispatch and resolved/rejected attempts may close safely", () => {
  assert.equal(resolveCoachInvitationDetailAction(snapshot({ pending: "reconcile", attempt }), { canResend: true, canRegenerate: true }), null);
  assert.equal(hasUnresolvedCoachInvitationAction(snapshot({ attempt: { ...attempt, phase: "resolved", resolution: "reserved" } })), false);
  assert.equal(hasUnresolvedCoachInvitationAction(snapshot({ attempt: { ...attempt, phase: "rejected" } })), false);
});
