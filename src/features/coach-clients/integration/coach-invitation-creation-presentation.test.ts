import assert from "node:assert/strict";
import test from "node:test";

import type { CoachInvitationCreationSnapshot } from "../hooks/coach-invitation-creation-contract";
import { resolveCoachInvitationCreationAction } from "./coach-invitation-creation-presentation";

function snapshot(patch: Partial<CoachInvitationCreationSnapshot> = {}): CoachInvitationCreationSnapshot {
  return {
    isOpen: true,
    emailRaw: "student@example.test",
    emailValid: true,
    pending: null,
    attempt: null,
    confirmed: null,
    rateLimit: null,
    issue: null,
    needsRefresh: false,
    disposed: false,
    ...patch,
  };
}

const uncertainAttempt = Object.freeze({
  requestId: "11111111-1111-4111-8111-111111111111",
  recipientEmail: "student@example.test",
  phase: "uncertain" as const,
  operation: null,
  retryAllowed: false,
  resolution: null,
});

test("fresh draft submits and uncertain intent reconciles before another write", () => {
  assert.equal(resolveCoachInvitationCreationAction(snapshot(), true), "submit");
  assert.equal(resolveCoachInvitationCreationAction(snapshot({
    attempt: uncertainAttempt,
    needsRefresh: true,
  }), false), "reconcile");
});

test("same-intent retry unlocked by reconciliation wins while needsRefresh remains true", () => {
  assert.equal(resolveCoachInvitationCreationAction(snapshot({
    attempt: { ...uncertainAttempt, retryAllowed: true },
    needsRefresh: true,
  }), false), "retry");
});

test("closed, busy, disposed and resolved snapshots cannot dispatch another intent", () => {
  assert.equal(resolveCoachInvitationCreationAction(snapshot({ isOpen: false }), true), null);
  assert.equal(resolveCoachInvitationCreationAction(snapshot({ pending: "submit" }), true), null);
  assert.equal(resolveCoachInvitationCreationAction(snapshot({ disposed: true }), true), null);
  assert.equal(resolveCoachInvitationCreationAction(snapshot({
    attempt: { ...uncertainAttempt, phase: "resolved", resolution: "reserved" },
  }), false), null);
});
