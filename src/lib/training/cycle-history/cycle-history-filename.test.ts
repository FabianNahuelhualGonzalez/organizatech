import assert from "node:assert/strict";

import { buildCycleHistoryPdfFilename } from "@/lib/training/cycle-history/cycle-history-filename";

function testExpectedFormat() {
  assert.equal(
    buildCycleHistoryPdfFilename({ cycleNumber: 3, generatedAt: "2026-07-21" }),
    "organizatech-ciclo-3-2026-07-21.pdf",
  );
}

function testAcceptsFullTimestampAndUsesOnlyTheDate() {
  assert.equal(
    buildCycleHistoryPdfFilename({ cycleNumber: 3, generatedAt: "2026-07-21T15:30:00.000Z" }),
    "organizatech-ciclo-3-2026-07-21.pdf",
  );
}

function testLowercaseAndExtensionExactlyOnce() {
  const filename = buildCycleHistoryPdfFilename({ cycleNumber: 12, generatedAt: "2026-01-05" });
  assert.equal(filename, filename.toLowerCase());
  assert.equal(filename.match(/\.pdf/g)?.length, 1);
  assert.ok(filename.endsWith(".pdf"));
}

function testSafeCharactersOnly() {
  const filename = buildCycleHistoryPdfFilename({ cycleNumber: 3, generatedAt: "2026-07-21" });
  assert.match(filename, /^[a-z0-9.-]+$/);
}

function testNoPathTraversalOrSeparators() {
  const filename = buildCycleHistoryPdfFilename({ cycleNumber: 3, generatedAt: "2026-07-21" });
  assert.doesNotMatch(filename, /\.\./);
  assert.doesNotMatch(filename, /[/\\]/);
}

function testDoesNotContainSensitivePersonalData() {
  const filename = buildCycleHistoryPdfFilename({ cycleNumber: 3, generatedAt: "2026-07-21" });
  assert.doesNotMatch(filename, /@/);
  assert.doesNotMatch(filename, /nahuelhual|gmail|correo/i);
}

function testNegativeOrNonIntegerCycleNumberIsSanitized() {
  assert.equal(
    buildCycleHistoryPdfFilename({ cycleNumber: -3.7, generatedAt: "2026-07-21" }),
    "organizatech-ciclo-3-2026-07-21.pdf",
  );
  assert.equal(
    buildCycleHistoryPdfFilename({ cycleNumber: Number.NaN, generatedAt: "2026-07-21" }),
    "organizatech-ciclo-0-2026-07-21.pdf",
  );
}

function testMalformedDateFallsBackToSafePlaceholder() {
  const filename = buildCycleHistoryPdfFilename({ cycleNumber: 3, generatedAt: "not-a-date" });
  assert.equal(filename, "organizatech-ciclo-3-0000-00-00.pdf");
  assert.match(filename, /^[a-z0-9.-]+$/);
}

function testAttemptedTraversalInDateInputIsSanitized() {
  const filename = buildCycleHistoryPdfFilename({ cycleNumber: 3, generatedAt: "../../etc/passwd" });
  assert.doesNotMatch(filename, /\.\./);
  assert.doesNotMatch(filename, /[/\\]/);
}

function testDeterministicOutput() {
  const input = { cycleNumber: 5, generatedAt: "2026-03-02" };
  assert.equal(buildCycleHistoryPdfFilename(input), buildCycleHistoryPdfFilename(input));
}

testExpectedFormat();
testAcceptsFullTimestampAndUsesOnlyTheDate();
testLowercaseAndExtensionExactlyOnce();
testSafeCharactersOnly();
testNoPathTraversalOrSeparators();
testDoesNotContainSensitivePersonalData();
testNegativeOrNonIntegerCycleNumberIsSanitized();
testMalformedDateFallsBackToSafePlaceholder();
testAttemptedTraversalInDateInputIsSanitized();
testDeterministicOutput();

console.log("cycle-history-filename tests passed");
