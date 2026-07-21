import assert from "node:assert/strict";

import { paginateCycleHistoryWeeks } from "@/lib/training/cycle-history/cycle-history-pagination";

function testZeroWeeks() {
  assert.deepEqual(paginateCycleHistoryWeeks([]), []);
}

function testOneWeek() {
  assert.deepEqual(paginateCycleHistoryWeeks([1]), [[1]]);
}

function testTwoWeeks() {
  assert.deepEqual(paginateCycleHistoryWeeks([1, 2]), [[1, 2]]);
}

function testThreeWeeks() {
  assert.deepEqual(paginateCycleHistoryWeeks([1, 2, 3]), [[1, 2], [3]]);
}

function testSixWeeks() {
  assert.deepEqual(paginateCycleHistoryWeeks([1, 2, 3, 4, 5, 6]), [[1, 2], [3, 4], [5, 6]]);
}

function testTwentyWeeks() {
  const weeks = Array.from({ length: 20 }, (_, index) => index + 1);
  const blocks = paginateCycleHistoryWeeks(weeks);

  assert.equal(blocks.length, 10);
  assert.deepEqual(blocks[0], [1, 2]);
  assert.deepEqual(blocks[9], [19, 20]);
}

function testPreservesChronologicalOrderEvenIfInputIsUnordered() {
  const blocks = paginateCycleHistoryWeeks([5, 1, 3, 2, 4]);
  assert.deepEqual(blocks, [[1, 2], [3, 4], [5]]);
}

function testNoDuplicatesAndNoOmissions() {
  const input = [1, 2, 3, 4, 5, 6, 7];
  const blocks = paginateCycleHistoryWeeks(input);
  const flattened = blocks.flat();

  assert.deepEqual(flattened, input);
  assert.equal(new Set(flattened).size, input.length);
}

function testDeduplicatesRepeatedWeekNumbers() {
  const blocks = paginateCycleHistoryWeeks([1, 1, 2, 2, 3]);
  assert.deepEqual(blocks, [[1, 2], [3]]);
}

function testCustomBlockSize() {
  assert.deepEqual(paginateCycleHistoryWeeks([1, 2, 3, 4, 5], 3), [[1, 2, 3], [4, 5]]);
}

function testInvalidBlockSizeFallsBackToDefault() {
  assert.deepEqual(paginateCycleHistoryWeeks([1, 2, 3], 0), [[1, 2], [3]]);
  assert.deepEqual(paginateCycleHistoryWeeks([1, 2, 3], -5), [[1, 2], [3]]);
}

function testDeterministicOutput() {
  const weeks = [4, 2, 1, 3];
  assert.deepEqual(paginateCycleHistoryWeeks(weeks), paginateCycleHistoryWeeks(weeks));
}

function testDoesNotMutateInput() {
  const weeks = [3, 1, 2];
  const snapshot = [...weeks];
  paginateCycleHistoryWeeks(weeks);
  assert.deepEqual(weeks, snapshot);
}

testZeroWeeks();
testOneWeek();
testTwoWeeks();
testThreeWeeks();
testSixWeeks();
testTwentyWeeks();
testPreservesChronologicalOrderEvenIfInputIsUnordered();
testNoDuplicatesAndNoOmissions();
testDeduplicatesRepeatedWeekNumbers();
testCustomBlockSize();
testInvalidBlockSizeFallsBackToDefault();
testDeterministicOutput();
testDoesNotMutateInput();

console.log("cycle-history-pagination tests passed");
