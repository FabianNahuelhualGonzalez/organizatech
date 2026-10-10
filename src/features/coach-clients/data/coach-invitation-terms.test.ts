import assert from "node:assert/strict";
import test from "node:test";
import { coachInvitationAmount, coachInvitationFrequency, parseCoachInvitationAmount } from "./coach-invitation-terms";

test("new invitation amounts are positive integer CLP within the commercial storage bound", () => {
  for (const value of [1, 25000, 1_000_000_000_000]) assert.equal(coachInvitationAmount(value), value);
  for (const value of [null, 0, -1, 1.5, Number.NaN, 1_000_000_000_001, "25000"]) {
    assert.throws(() => coachInvitationAmount(value));
  }
  assert.equal(parseCoachInvitationAmount("00025"), 25);
  for (const raw of ["", "0", "-1", "1.5", "1e3", " 25", "1000000000001"]) {
    assert.equal(parseCoachInvitationAmount(raw), null);
  }
});

test("new invitations accept exactly six approved commercial frequencies", () => {
  for (const value of ["daily", "weekly", "monthly", "quarterly", "semiannual", "annual"]) {
    assert.equal(coachInvitationFrequency(value), value);
  }
  for (const value of [null, "", "biweekly", "bimonthly", "yearly", "MONTHLY"]) {
    assert.throws(() => coachInvitationFrequency(value));
  }
});
