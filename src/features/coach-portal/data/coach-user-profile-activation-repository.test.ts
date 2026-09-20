import assert from "node:assert/strict";
import test from "node:test";
import type { Session, User } from "@supabase/supabase-js";

import {
  CoachUserProfileActivationError,
  createCoachUserProfileActivationRepository,
  type CoachUserProfileActivationClient,
  type CoachUserProfileActivationDataClient,
} from "./coach-user-profile-activation-repository";

const ownerId = "10000000-0000-4000-8000-000000000001";

function client(input: {
  readonly sessionUserId?: string | null;
  readonly selectedUserId?: string | null;
  readonly activatedUserId?: string | null;
}) {
  const calls: Array<readonly [string, unknown?]> = [];
  const sessionUserId = input.sessionUserId === undefined ? ownerId : input.sessionUserId;
  const session = sessionUserId ? {
    access_token: "test-access-token",
    user: { id: sessionUserId },
  } as unknown as Session : null;
  const fake: CoachUserProfileActivationClient = {
    auth: {
      async getSession() {
        calls.push(["getSession"]);
        return { data: { session }, error: null };
      },
      async getUser(accessToken) {
        calls.push(["getUser", accessToken]);
        return {
          data: { user: sessionUserId ? { id: sessionUserId } as User : null },
          error: null,
        };
      },
    },
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            eq(column, value) {
              calls.push(["eq", [column, value]]);
              return {
                async maybeSingle() {
                  calls.push(["maybeSingle"]);
                  return {
                    data: input.selectedUserId ? { user_id: input.selectedUserId } : null,
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name) {
      calls.push(["rpc", name]);
      return {
        data: input.activatedUserId ? { user_id: input.activatedUserId } : null,
        error: null,
      };
    },
  };
  const scopedTokens: string[] = [];
  const repository = createCoachUserProfileActivationRepository(fake, (accessToken) => {
    scopedTokens.push(accessToken);
    return fake as CoachUserProfileActivationDataClient;
  });
  return { repository, calls, scopedTokens };
}

test("consulta sólo la membresía Usuario de la identidad autenticada", async () => {
  const fake = client({ selectedUserId: ownerId });
  assert.equal(await fake.repository.hasOwnUserProfile(ownerId), true);
  assert.deepEqual(fake.calls.filter(([name]) => name === "eq"), [
    ["eq", ["user_id", ownerId]],
  ]);
  assert.deepEqual(fake.scopedTokens, ["test-access-token"]);
});

test("la activación usa register_own_user sin aceptar ownership desde el cliente", async () => {
  const fake = client({ activatedUserId: ownerId });
  await fake.repository.activateOwnUserProfile(ownerId);
  assert.deepEqual(fake.calls.filter(([name]) => name === "rpc"), [
    ["rpc", "register_own_user"],
  ]);
  assert.deepEqual(fake.scopedTokens, ["test-access-token"]);
});

test("rechaza sesión o fila que no pertenezcan a la identidad esperada", async () => {
  const wrongSession = client({
    sessionUserId: "10000000-0000-4000-8000-000000000002",
    selectedUserId: ownerId,
  });
  await assert.rejects(
    wrongSession.repository.hasOwnUserProfile(ownerId),
    (error) => error instanceof CoachUserProfileActivationError && error.code === "forbidden",
  );
  assert.equal(wrongSession.calls.some(([name]) => name === "from"), false);

  const wrongRow = client({
    activatedUserId: "10000000-0000-4000-8000-000000000002",
  });
  await assert.rejects(
    wrongRow.repository.activateOwnUserProfile(ownerId),
    (error) => error instanceof CoachUserProfileActivationError && error.code === "unavailable",
  );
});
