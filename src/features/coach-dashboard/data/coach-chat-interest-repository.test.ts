import assert from "node:assert/strict";
import test from "node:test";
import { createCoachChatInterestRepository } from "./coach-chat-interest-repository";

function fixture(response: unknown = { chatInterestRegistered: false }, code?: string) {
  const calls: { name: string; args: unknown }[] = [];
  const repository = createCoachChatInterestRepository({
    captureOperation: async () => ({
      isCurrent: () => true,
      client: { rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: response, error: code ? { code, message: "private detail" } : null };
      } },
    }),
  });
  return { repository, calls };
}

test("read and register call only the narrow no-argument RPCs", async () => {
  const read = fixture();
  assert.deepEqual(await read.repository.read(), { chatInterestRegistered: false });
  assert.deepEqual(read.calls, [{ name: "read_own_coach_chat_interest", args: {} }]);
  const write = fixture({ chatInterestRegistered: true });
  assert.deepEqual(await write.repository.register(), { chatInterestRegistered: true });
  assert.deepEqual(write.calls, [{ name: "register_own_coach_chat_interest", args: {} }]);
});

test("responses containing a fee, version or owner are rejected", async () => {
  for (const value of [null, [], {}, { chatInterestRegistered: 1 },
    { chatInterestRegistered: false, monthlyFeeClp: 35000 },
    { chatInterestRegistered: true, version: 1 },
    { chatInterestRegistered: true, owner_id: "other" }]) {
    await assert.rejects(fixture(value).repository.read(), { code: "invalid_response" });
  }
  await assert.rejects(fixture({ chatInterestRegistered: false }).repository.register(), { code: "invalid_response" });
});

test("RPC failures are sanitized and stale results are discarded", async () => {
  await assert.rejects(fixture(null, "42501").repository.read(), {
    code: "forbidden", message: "coach-chat-interest-forbidden",
  });
  await assert.rejects(fixture(null, "XX000").repository.read(), { code: "unavailable" });
  let current = true;
  let finish!: (value: { data: unknown; error: null }) => void;
  const repository = createCoachChatInterestRepository({ captureOperation: async () => ({
    isCurrent: () => current,
    client: { rpc: () => new Promise((resolve) => { finish = resolve; }) },
  }) });
  const pending = repository.read();
  await new Promise((resolve) => setTimeout(resolve, 0));
  current = false;
  finish({ data: { chatInterestRegistered: true }, error: null });
  await assert.rejects(pending, { code: "operation_stale" });
});
