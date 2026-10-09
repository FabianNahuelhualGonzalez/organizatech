import assert from "node:assert/strict";
import test from "node:test";
import { createCoachChatInterestRuntime } from "./coach-chat-interest-runtime";

test("runtime uses verified identity and only Chat RPC bodies", async () => {
  const requests: { name: string; body: unknown; authorization: string | null }[] = [];
  let registered = false;
  const controller = createCoachChatInterestRuntime({
    configuration: { url: "https://coach-chat.example.invalid", publicKey: "synthetic-public-key" },
    expectedUserId: "coach-a", isCurrent: () => true,
    principal: { auth: {
      getSession: async () => ({ data: { session: { user: { id: "coach-a" }, access_token: "synthetic-token" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "coach-a" } }, error: null }),
    } },
    fetch: async (url, init = {}) => {
      const name = String(url).split("/").at(-1)!;
      requests.push({ name, body: JSON.parse(String(init.body)),
        authorization: new Headers(init.headers).get("authorization") });
      return new Response(JSON.stringify({ chatInterestRegistered: name === "register_own_coach_chat_interest" || registered }),
        { headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(await controller.load(), true);
  assert.equal(controller.openChat(), true);
  assert.equal(await controller.registerChatInterest(), true);
  registered = true;
  assert.deepEqual(requests.map(({ name, body }) => ({ name, body })), [
    { name: "read_own_coach_chat_interest", body: {} },
    { name: "register_own_coach_chat_interest", body: {} },
  ]);
  assert.ok(requests.every(({ authorization }) => authorization === "Bearer synthetic-token"));
  assert.deepEqual(controller.getSnapshot().confirmed, { chatInterestRegistered: true });
});

test("runtime rejects a changed verified user before dispatch", async () => {
  let requests = 0;
  const controller = createCoachChatInterestRuntime({
    configuration: { url: "https://coach-chat.example.invalid", publicKey: "synthetic-public-key" },
    expectedUserId: "coach-a", isCurrent: () => true,
    principal: { auth: {
      getSession: async () => ({ data: { session: { user: { id: "coach-a" }, access_token: "synthetic-token" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "coach-b" } }, error: null }),
    } },
    fetch: async () => { requests++; return new Response("{}"); },
  });
  assert.equal(await controller.load(), false);
  assert.equal(controller.getSnapshot().issue, "forbidden");
  assert.equal(requests, 0);
});

test("one deadline covers Auth capture and never dispatches after timeout", async () => {
  let finish!: (value: { data: { session: { user: { id: string }; access_token: string } }; error: null }) => void;
  let requests = 0;
  const controller = createCoachChatInterestRuntime({
    configuration: { url: "https://coach-chat.example.invalid", publicKey: "synthetic-public-key" },
    expectedUserId: "coach-a", isCurrent: () => true, timeoutMilliseconds: 5,
    principal: { auth: {
      getSession: () => new Promise((resolve) => { finish = resolve; }),
      getUser: async () => ({ data: { user: { id: "coach-a" } }, error: null }),
    } },
    fetch: async () => { requests++; return new Response("{}"); },
  });
  assert.equal(await controller.load(), false);
  assert.equal(controller.getSnapshot().issue, "timeout");
  finish({ data: { session: { user: { id: "coach-a" }, access_token: "synthetic-token" } }, error: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 0);
});
