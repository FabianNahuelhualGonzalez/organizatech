import assert from "node:assert/strict";
import test from "node:test";
import { createCoachChatInterestController } from "./coach-chat-interest-controller";

test("Chat state loads, opens and confirms registration without fee fields", async () => {
  let registered = false;
  let writes = 0;
  const controller = createCoachChatInterestController({
    isCurrent: () => true,
    source: {
      read: async () => ({ chatInterestRegistered: registered }),
      register: async () => { writes++; registered = true; return { chatInterestRegistered: true }; },
    },
  });
  assert.equal(controller.openChat(), false);
  assert.equal(await controller.load(), true);
  assert.equal(controller.openChat(), true);
  assert.equal(await controller.registerChatInterest(), true);
  assert.equal(await controller.registerChatInterest(), false);
  assert.equal(writes, 1);
  assert.deepEqual(Object.keys(controller.getSnapshot().confirmed ?? {}), ["chatInterestRegistered"]);
  assert.equal(controller.cancelChat(), true);
});

test("uncertain write needs readback; disposal suppresses late success", async () => {
  let fail = true;
  let registered = false;
  const controller = createCoachChatInterestController({
    isCurrent: () => true,
    source: {
      read: async () => ({ chatInterestRegistered: registered }),
      register: async () => {
        registered = true;
        if (fail) throw new Error("private detail");
        return { chatInterestRegistered: true };
      },
    },
  });
  await controller.load(); controller.openChat();
  assert.equal(await controller.registerChatInterest(), false);
  assert.equal(controller.getSnapshot().needsRefresh, true);
  assert.equal(await controller.registerChatInterest(), false);
  fail = false;
  assert.equal(await controller.load(), true);
  assert.equal(controller.getSnapshot().confirmed?.chatInterestRegistered, true);
  controller.dispose();
  assert.equal(controller.getSnapshot().confirmed, null);
  assert.equal(await controller.registerChatInterest(), false);
});

test("single flight and identity invalidation suppress a late registration", async () => {
  let finish!: (value: { chatInterestRegistered: boolean }) => void;
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => { started = resolve; });
  let current = true;
  const controller = createCoachChatInterestController({
    isCurrent: () => current,
    source: {
      read: async () => ({ chatInterestRegistered: false }),
      register: () => new Promise((resolve) => { finish = resolve; started(); }),
    },
  });
  await controller.load(); controller.openChat();
  const pending = controller.registerChatInterest();
  await dispatched;
  assert.equal(await controller.registerChatInterest(), false);
  current = false;
  finish({ chatInterestRegistered: true });
  assert.equal(await pending, false);
  assert.equal(controller.getSnapshot().confirmed, null);
});
