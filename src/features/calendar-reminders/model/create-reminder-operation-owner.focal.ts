import assert from "node:assert/strict";
import test from "node:test";

import { createReminderOperationOwner } from "./create-reminder-operation-owner";

test("dos envíos simultáneos comparten una sola operación del adapter", async () => {
  const owner = createReminderOperationOwner();
  let adapterCalls = 0;
  let resolveAdapter: ((value: boolean) => void) | undefined;
  const operation = () => {
    adapterCalls += 1;
    return new Promise<boolean>((resolve) => {
      resolveAdapter = resolve;
    });
  };

  const first = owner.run(operation);
  const second = owner.run(operation);

  assert.equal(adapterCalls, 1);
  assert.equal(first, second);
  resolveAdapter?.(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("el owner libera el single-flight al terminar", async () => {
  const owner = createReminderOperationOwner();
  let adapterCalls = 0;
  const operation = async () => {
    adapterCalls += 1;
    return true;
  };

  assert.equal(await owner.run(operation), true);
  assert.equal(await owner.run(operation), true);
  assert.equal(adapterCalls, 2);
});
