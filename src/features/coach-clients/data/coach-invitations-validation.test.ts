import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError, type CoachInvitationAction } from "./coach-invitations-contract";
import {
  exactRecord, mapCoachInvitationDetail, mapCoachInvitationMutation, mapCoachInvitationOperation,
  mapCoachRelationshipDetail, normalizeRecipientEmail, timestampMicros, uuid,
} from "./coach-invitations-validation";

const requestId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const episodeId = "40000000-0000-4000-8000-000000000001";
const now = "2026-09-09T06:00:00.123456+00:00";
const invitation = { id: invitationId, recipientEmail: "synthetic@example.test", state: "pending", generation: 1,
  createdAt: now, issuedAt: now, expiresAt: "2026-09-16T06:00:00.123456+00:00", cancelledAt: null, code: "AA2-AA2-AA2" };
const operation = { requestId, action: "create", state: "reserved", invitationId, episodeId: null, generation: 1, reservedAt: now };
const relationship = { id: episodeId, studentName: "Synthetic Student", studentEmail: "Student@Example.Test", linkedAt: now, endedAt: null };
const badResponse = (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_response";
const badInput = (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_input";

test("UUIDs are canonical values, never fabricated labels or implicit ids", () => {
  assert.equal(uuid("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA", "invalid_input"), "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  for (const value of [undefined, null, 42, "", "invitation-1", `${invitationId} `, "g0000000-0000-0000-0000-000000000000"]) {
    assert.throws(() => uuid(value, "invalid_input"), badInput);
  }
});

test("email normalization follows server space/lowercase and UTF-8 bounds", () => {
  assert.equal(normalizeRecipientEmail(" Synthetic@Example.Test "), "synthetic@example.test");
  assert.equal(normalizeRecipientEmail(`${"é".repeat(120)}@x.test`), `${"é".repeat(120)}@x.test`);
  for (const value of [null, "a@@x.test", "a@x", "a b@x.test", "\ta@x.test", "a@x.test\n",
    "a\u0000@x.test", "\ud800@x.test", `${"é".repeat(125)}@x.test`, `${" ".repeat(321)}a@x.test`]) {
    assert.throws(() => normalizeRecipientEmail(value), badInput);
  }
});

test("allowlists reject symbols, hidden fields, accessors and non-plain object prototypes", () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "id", { enumerable: true, get() { getterCalls++; return invitationId; } });
  const hidden = Object.defineProperty({ id: invitationId }, "user_id", { value: requestId, enumerable: false });
  for (const value of [null, [], new Date(), Object.create({ id: invitationId }), getter, hidden,
    { id: invitationId, [Symbol("owner")]: requestId }]) {
    assert.throws(() => exactRecord(value, ["id"]), badResponse);
  }
  assert.equal(getterCalls, 0);
  const valid = Object.assign(Object.create(null), { id: invitationId });
  assert.deepEqual(exactRecord(valid, ["id"]), { id: invitationId });
});

test("timestamps preserve microseconds, normalize offsets for comparison, and reject invalid calendars", () => {
  assert.equal(timestampMicros("2026-09-09T06:00:00.000001Z") - timestampMicros("2026-09-09T06:00:00Z"), BigInt(1));
  assert.equal(timestampMicros("2026-09-09T03:00:00.123456-03:00"), timestampMicros(now));
  assert.doesNotThrow(() => timestampMicros("2024-02-29T00:00:00Z"));
  assert.doesNotThrow(() => timestampMicros("0001-01-01T00:00:00Z"));
  for (const value of [null, 1, "infinity", "2026-02-29T00:00:00Z", "2024-02-30T00:00:00Z",
    "0000-01-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-09-09T24:00:00Z", "2026-09-09T06:60:00Z",
    "2026-09-09T06:00:60Z", "2026-09-09T06:00:00", "2026-09-09T06:00:00.1234567Z",
    "2026-09-09T06:00:00+16:00", "2026-09-09T06:00:00+01:60", "2026-09-09T06:00:00Z suffix"]) {
    assert.throws(() => timestampMicros(value), badResponse);
  }
});

test("invitation states require coherent code/null and cancellation fields", () => {
  assert.equal(mapCoachInvitationDetail(invitation, invitationId).state, "pending");
  for (const state of ["expired", "accepted", "cancelled"]) {
    const row = { ...invitation, state, code: null, cancelledAt: state === "cancelled" ? now : null };
    const result = mapCoachInvitationDetail(row, invitationId);
    assert.equal(result.state, state); assert.equal(result.code, null); assert.ok(Object.isFrozen(result));
    assert.throws(() => mapCoachInvitationDetail({ ...row, code: invitation.code }, invitationId), badResponse);
  }
  for (const change of [{ code: null }, { code: "IO0-IO0-IO0" }, { code: "aa2-aa2-aa2" }, { code: "AB2CD3EF4" },
    { state: "delivered" }, { cancelledAt: now }, { state: "expired", code: null, cancelledAt: now },
    { state: "cancelled", code: null, cancelledAt: null }, { owner_id: requestId }, { message: "Enviado" },
    { recipientEmail: "Noncanonical@Example.Test" }, { id: episodeId }]) {
    assert.throws(() => mapCoachInvitationDetail({ ...invitation, ...change }, invitationId), badResponse);
  }
});

test("invitation duration is exactly 168 hours including the last microsecond; no phone clock is consulted", () => {
  for (const expiresAt of ["2026-09-16T06:00:00.123455+00:00", "2026-09-16T06:00:00.123457+00:00",
    "2026-09-15T06:00:00.123456+00:00"]) {
    assert.throws(() => mapCoachInvitationDetail({ ...invitation, expiresAt }, invitationId), badResponse);
  }
  assert.throws(() => mapCoachInvitationDetail({ ...invitation, createdAt: "2026-09-10T06:00:00Z" }, invitationId), badResponse);
  assert.throws(() => mapCoachInvitationDetail({ ...invitation, state: "cancelled", code: null, cancelledAt: "2020-01-01T00:00:00Z" }, invitationId), badResponse);
  // Old dates with a server-projected pending state are structurally valid. This
  // read has no serverNow; the adapter must not invent an expiry decision.
  assert.equal(mapCoachInvitationDetail({ ...invitation, createdAt: "2020-01-01T00:00:00Z", issuedAt: "2020-01-01T00:00:00Z",
    expiresAt: "2020-01-08T00:00:00Z" }, invitationId).state, "pending");
});

test("generation matches the SQL integer bounds and regeneration cannot claim generation one", () => {
  for (const value of [null, "1", 0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => mapCoachInvitationDetail({ ...invitation, generation: value }, invitationId), badResponse);
    assert.throws(() => mapCoachInvitationOperation({ ...operation, generation: value }, { requestId }), badResponse);
  }
  assert.equal(mapCoachInvitationDetail({ ...invitation, generation: 2_147_483_647 }, invitationId).generation, 2_147_483_647);
  assert.throws(() => mapCoachInvitationOperation({ ...operation, action: "regenerate", generation: 1 }, { requestId }), badResponse);
});

test("operation states and references distinguish reservation/cancellation/completion, never delivery", () => {
  for (const action of ["create", "resend", "regenerate"] as const) {
    for (const state of ["reserved", "cancelled"]) {
      const result = mapCoachInvitationOperation({ ...operation, action, state, generation: action === "regenerate" ? 2 : 1 }, { requestId, action, invitationId });
      assert.equal(result.state, state); assert.ok(Object.isFrozen(result));
    }
  }
  assert.equal(mapCoachInvitationOperation({ ...operation, action: "cancel", state: "completed" }, { requestId }).state, "completed");
  assert.equal(mapCoachInvitationOperation({ ...operation, action: "revoke", state: "completed", invitationId: null, episodeId, generation: null }, { requestId }).action, "revoke");
  for (const change of [{ state: "sent" }, { state: "provider_accepted" }, { state: "delivered" }, { state: "completed" },
    { action: "accept" }, { requestId: episodeId }, { invitationId: null }, { episodeId }, { payload: {} },
    { user_id: requestId }, { code: invitation.code }, { action: "cancel", state: "reserved" },
    { action: "revoke", state: "completed", episodeId }, { reservedAt: "infinity" }]) {
    assert.throws(() => mapCoachInvitationOperation({ ...operation, ...change }, { requestId }), badResponse);
  }
});

test("mutation envelopes enforce request/action identity and authoritative time ordering", () => {
  const expected = { requestId, action: "create" as const };
  const recorded = { status: "recorded", serverNow: now, operation };
  const result = mapCoachInvitationMutation(recorded, expected);
  assert.equal(result.status, "recorded"); assert.ok(Object.isFrozen(result));
  const limited = { status: "rate_limited", serverNow: now, retryAt: "2026-09-09T06:00:00.123457+00:00" };
  assert.equal(mapCoachInvitationMutation(limited, expected).status, "rate_limited");
  for (const response of [{ ...limited, retryAt: now }, { ...limited, retryAt: "2020-01-01T00:00:00Z" },
    { ...limited, seconds: 60 }, { ...recorded, serverNow: "2026-09-09T06:00:00.123455+00:00" },
    { ...recorded, receipt: true }, { ...recorded, status: "sent" }, { ...recorded, operation: null },
    { ...recorded, operation: { ...operation, action: "resend" } }, [], null]) {
    assert.throws(() => mapCoachInvitationMutation(response, expected), badResponse);
  }
  for (const action of ["cancel", "revoke"] as CoachInvitationAction[]) {
    assert.throws(() => mapCoachInvitationMutation(limited, { requestId, action }), badResponse);
  }
});

test("relationship snapshots preserve approved text but reject ownership and invalid chronology/bounds", () => {
  const result = mapCoachRelationshipDetail(relationship, episodeId);
  assert.equal(result.studentEmail, relationship.studentEmail); assert.equal(result.endedAt, null);
  assert.ok(Object.isFrozen(result));
  assert.equal(mapCoachRelationshipDetail({ ...relationship, endedAt: now }, episodeId).endedAt, now);
  assert.doesNotThrow(() => mapCoachRelationshipDetail({ ...relationship, studentName: "😀".repeat(201) }, episodeId));
  for (const change of [{ id: invitationId }, { user_id: requestId }, { consentedAt: now }, { studentName: "   " },
    { studentName: "a".repeat(202) }, { studentName: "\ud800" }, { studentEmail: "aa" },
    { studentEmail: "é".repeat(128) }, { endedAt: "2026-09-09T06:00:00.123455+00:00" }, { linkedAt: "infinity" }]) {
    assert.throws(() => mapCoachRelationshipDetail({ ...relationship, ...change }, episodeId), badResponse);
  }
});
