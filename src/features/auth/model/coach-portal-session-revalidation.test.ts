import assert from "node:assert/strict";
import test from "node:test";
import { canRetainAuthorizedCoachSession } from "./coach-portal-session-revalidation";

const same = {
  event: "TOKEN_REFRESHED", requestedPortal: "coach" as const,
  authorizedUserId: "coach-a", sessionUserId: "coach-a", authenticatedUserId: "coach-a",
  interactiveAttempt: false, logoutInFlight: false, passwordRecoveryBlocked: false,
};

test("retiene solo los eventos redundantes del mismo Coach autorizado", () => {
  for (const event of ["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED"]) {
    assert.equal(canRetainAuthorizedCoachSession({ ...same, event }), true);
  }
  for (const changes of [
    { event: "SIGNED_OUT" }, { requestedPortal: "usuario" as const },
    { authorizedUserId: null }, { sessionUserId: "coach-b" },
    { authenticatedUserId: "coach-b" }, { interactiveAttempt: true },
    { logoutInFlight: true }, { passwordRecoveryBlocked: true },
  ]) assert.equal(canRetainAuthorizedCoachSession({ ...same, ...changes }), false);
});
