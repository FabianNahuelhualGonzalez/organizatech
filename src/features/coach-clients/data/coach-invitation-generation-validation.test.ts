import assert from "node:assert/strict";
import test from "node:test";
import { CoachInvitationsError } from "./coach-invitations-contract";
import { invitationGeneration, mapCoachInvitationGenerationMutation, mapCoachInvitationGenerationOperation } from "./coach-invitation-generation-validation";

const requestId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const now = "2026-09-09T12:00:00.123456+00:00";
const operation = { requestId, invitationId, action: "resend" as const, state: "reserved" as const,
  expectedGeneration: 2, generation: 2, reservedAt: now };
const expected = { requestId, invitationId, action: "resend" as const, expectedGeneration: 2 };
const invalid = (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_response";

for (const action of ["resend", "regenerate"] as const) {
  for (const state of ["reserved", "cancelled"] as const) {
    test(`generation receipt preserves ${action}/${state} without private fields or delivery claims`, () => {
      const row = { ...operation, action, state, generation: action === "regenerate" ? 3 : 2 };
      const result = mapCoachInvitationGenerationOperation(row, { ...expected, action });
      assert.deepEqual(result, row); assert.ok(Object.isFrozen(result));
      assert.deepEqual(Object.keys(result).sort(), ["requestId", "action", "state", "invitationId", "expectedGeneration", "generation", "reservedAt"].sort());
      assert.deepEqual(mapCoachInvitationGenerationOperation(row, { requestId }), result);
    });
  }
}

const invalidGenerations: unknown[] = [null, undefined, "2", false, 0, -1, 1.5, NaN, Infinity, 2_147_483_648, Number.MAX_SAFE_INTEGER];
for (const [index, value] of invalidGenerations.entries()) {
  test(`generation rejects non-Postgres integer input case ${index}`, () => {
    assert.throws(() => invitationGeneration(value, "invalid_input"), (error: unknown) => error instanceof CoachInvitationsError && error.code === "invalid_input");
    assert.throws(() => mapCoachInvitationGenerationOperation({ ...operation, expectedGeneration: value }, expected), invalid);
  });
}
test("integer boundaries accept resend MAX but reject overflowing regeneration receipts", () => {
  assert.equal(invitationGeneration(1), 1); assert.equal(invitationGeneration(2_147_483_647), 2_147_483_647);
  const row = { ...operation, expectedGeneration: 2_147_483_647, generation: 2_147_483_647 };
  assert.equal(mapCoachInvitationGenerationOperation(row, { requestId }).generation, 2_147_483_647);
  assert.throws(() => mapCoachInvitationGenerationOperation({ ...row, action: "regenerate", generation: 2_147_483_648 }, { requestId }), invalid);
});
const invalidReceipts = [
  { ...operation, expectedGeneration: 1 }, { ...operation, generation: 3 },
  { ...operation, action: "regenerate", generation: 2 }, { ...operation, action: "create" },
  { ...operation, action: "cancel", state: "completed" }, { ...operation, state: "sent" },
  { ...operation, requestId: invitationId }, { ...operation, invitationId: requestId },
  { ...operation, invitationId: null }, { ...operation, episodeId: null },
  { ...operation, owner_id: invitationId }, { ...operation, code: "AA2-AA2-AA2" },
  { ...operation, contractVersion: 1 }, { ...operation, payload: {} },
  { ...operation, reservedAt: "2026-02-30T12:00:00Z" }, { ...operation, generation: "2" },
];
for (const [index, row] of invalidReceipts.entries()) {
  test(`invalid or mismatched receipt case ${index} is rejected`, () => {
    assert.throws(() => mapCoachInvitationGenerationOperation(row, expected), invalid);
  });
}
test("v1 receipt is never silently adopted as generation-bound", () => {
  const { expectedGeneration: unused, ...legacy } = operation; void unused;
  assert.throws(() => mapCoachInvitationGenerationOperation({ ...legacy, episodeId: null }, { requestId }), invalid);
});
test("hostile/accessor/symbol/prototype payloads are rejected without invoking accessors", () => {
  let invoked = 0;
  const getter = Object.defineProperty({ ...operation }, "expectedGeneration", { enumerable: true, get() { invoked++; return 2; } });
  const proxy = new Proxy(operation, { ownKeys() { throw new Error("private sentinel"); } });
  for (const value of [null, [], {}, getter, proxy, { ...operation, [Symbol("secret")]: 1 }, Object.create(operation)]) {
    assert.throws(() => mapCoachInvitationGenerationOperation(value, expected), invalid);
  }
  assert.equal(invoked, 0);
});
test("mutation enforces timestamp microseconds and exact envelope", () => {
  const value = { status: "recorded", serverNow: now, operation };
  const result = mapCoachInvitationGenerationMutation(value, expected);
  assert.deepEqual(result, value); assert.ok(Object.isFrozen(result));
  for (const candidate of [{ ...value, serverNow: "2026-09-09T12:00:00.123455Z" }, { ...value, delivered: true },
    { ...value, status: "sent" }, { ...value, operation: { ...operation, expectedGeneration: 1 } }]) {
    assert.throws(() => mapCoachInvitationGenerationMutation(candidate, expected), invalid);
  }
});
test("rate-limit is metadata only and strictly later than serverNow", () => {
  const row = { status: "rate_limited", serverNow: now, retryAt: "2026-09-09T12:00:00.123457Z" };
  assert.deepEqual(mapCoachInvitationGenerationMutation(row, expected), row);
  for (const candidate of [{ ...row, retryAt: now }, { ...row, operation }, { ...row, retryAt: "bad" },
    Object.defineProperty({}, "status", { enumerable: true, get() { assert.fail("no accessor"); } }),
    new Proxy(row, { getOwnPropertyDescriptor() { throw new Error("private sentinel"); } })]) {
    assert.throws(() => mapCoachInvitationGenerationMutation(candidate, expected), invalid);
  }
});
