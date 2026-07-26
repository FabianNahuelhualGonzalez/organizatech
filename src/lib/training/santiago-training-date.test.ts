import assert from "node:assert/strict";

import {
  getSantiagoDateKey,
  normalizeEntryDateKey,
} from "@/lib/training/santiago-training-date";

function testEntryDateNormalizationPreservesSliceSemantics() {
  assert.equal(normalizeEntryDateKey("2026-07-08"), "2026-07-08");
  assert.equal(normalizeEntryDateKey("2026-07-08T14:30:00.000Z"), "2026-07-08");
  assert.equal(normalizeEntryDateKey("2026-07"), "2026-07");
  assert.equal(normalizeEntryDateKey("fecha-invalida"), "fecha-inva");
  assert.equal(normalizeEntryDateKey(""), "");
  assert.throws(
    () => normalizeEntryDateKey(undefined as unknown as string),
    TypeError,
    "mantiene el fallo runtime previo cuando el contrato string no se respeta",
  );
}

function testSantiagoDateKeyUsesAStableFixedReference() {
  const reference = new Date("2026-07-09T16:45:00.000Z");
  assert.equal(getSantiagoDateKey(reference), "2026-07-09");
  assert.match(getSantiagoDateKey(reference), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(getSantiagoDateKey(reference), getSantiagoDateKey(reference));
}

function testSantiagoDateKeyHandlesTheUtcDayBoundary() {
  assert.equal(getSantiagoDateKey(new Date("2026-07-09T03:30:00.000Z")), "2026-07-08");
  assert.equal(getSantiagoDateKey(new Date("2026-07-09T04:30:00.000Z")), "2026-07-09");
}

function testSantiagoDateKeyPreservesInvalidDateFailure() {
  assert.throws(
    () => getSantiagoDateKey(new Date("fecha-invalida")),
    RangeError,
    "Intl conserva el mismo error para Date invalida",
  );
}

testEntryDateNormalizationPreservesSliceSemantics();
testSantiagoDateKeyUsesAStableFixedReference();
testSantiagoDateKeyHandlesTheUtcDayBoundary();
testSantiagoDateKeyPreservesInvalidDateFailure();

console.log("Santiago training date tests passed");
