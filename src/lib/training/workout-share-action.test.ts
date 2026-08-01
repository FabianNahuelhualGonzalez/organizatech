import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  executeWorkoutShareAction,
  type WorkoutShareActionPorts,
} from "@/lib/training/workout-share-action";
import type { WorkoutShareTextPayload } from "@/lib/training/workout-share-model";

const payload: WorkoutShareTextPayload = {
  title: "Entrenamiento completado - Organizatech",
  text: "Organizatech\nPiernas\nLunes · Mesociclo · Semana 2",
};

async function testShareSuccessUsesExactPayloadWithoutClipboard() {
  const sharedPayloads: unknown[] = [];
  let copyCalls = 0;
  const result = await executeWorkoutShareAction(payload, {
    share: async (data) => {
      sharedPayloads.push(data);
    },
    copyText: async () => {
      copyCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "shared" });
  assert.deepEqual(sharedPayloads, [{ title: payload.title, text: payload.text }]);
  assert.equal(copyCalls, 0, "un share exitoso no ejecuta clipboard");
}

async function testMissingShareFallsBackToExactClipboardText() {
  const copiedTexts: string[] = [];
  const result = await executeWorkoutShareAction(payload, {
    copyText: async (text) => {
      copiedTexts.push(text);
    },
  });

  assert.deepEqual(result, { kind: "copied" });
  assert.deepEqual(copiedTexts, [payload.text]);
}

async function testNonAbortShareFailureFallsBackToClipboard() {
  const copiedTexts: string[] = [];
  const result = await executeWorkoutShareAction(payload, {
    share: async () => {
      throw new Error("share unavailable");
    },
    copyText: async (text) => {
      copiedTexts.push(text);
    },
  });

  assert.deepEqual(result, { kind: "copied" });
  assert.deepEqual(copiedTexts, [payload.text]);
}

async function testAbortDoesNotUseClipboard() {
  let copyCalls = 0;
  const abortError = new Error("user cancelled");
  abortError.name = "AbortError";
  const result = await executeWorkoutShareAction(payload, {
    share: async () => {
      throw abortError;
    },
    copyText: async () => {
      copyCalls += 1;
    },
  });

  assert.deepEqual(result, { kind: "cancelled" });
  assert.equal(copyCalls, 0, "AbortError no debe ejecutar clipboard");
}

async function testClipboardFailureReturnsSanitizedFailure() {
  const result = await executeWorkoutShareAction(payload, {
    copyText: async () => {
      throw new Error("Bearer secret-token ownerId=private-user");
    },
  });

  assert.deepEqual(result, { kind: "failed" });
  assert.doesNotMatch(JSON.stringify(result), /Bearer|secret-token|private-user|ownerId/);
}

async function testNoCapabilitiesReturnsUnavailable() {
  assert.deepEqual(
    await executeWorkoutShareAction(payload, {}),
    { kind: "unavailable" },
  );
}

async function testShareFailureWithoutClipboardReturnsFailure() {
  const result = await executeWorkoutShareAction(payload, {
    share: async () => {
      throw new Error("userId=private profileId=private token=private");
    },
  });

  assert.deepEqual(result, { kind: "failed" });
  assert.doesNotMatch(JSON.stringify(result), /userId|profileId|token|private/);
}

async function testInputsRemainImmutable() {
  const frozenPayload = Object.freeze({ ...payload });
  const ports: WorkoutShareActionPorts = Object.freeze({
    copyText: async () => undefined,
  });
  const payloadBefore = structuredClone(frozenPayload);
  const portsBefore = { copyText: ports.copyText };

  const first = await executeWorkoutShareAction(frozenPayload, ports);
  const second = await executeWorkoutShareAction(frozenPayload, ports);

  assert.deepEqual(first, { kind: "copied" });
  assert.deepEqual(second, first, "la misma entrada produce el mismo resultado controlado");
  assert.deepEqual(frozenPayload, payloadBefore);
  assert.equal(ports.copyText, portsBefore.copyText);
}

function testStaticInfrastructureBoundary() {
  // Contrato ESTATICO/SOURCE-BASED: no renderiza React, no simula navegador ni reemplaza runtime.
  const source = readFileSync("src/lib/training/workout-share-action.ts", "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.match(source, /^import type \{ WorkoutShareTextPayload \}/m);
  assert.doesNotMatch(code, /\bnavigator\b|\bwindow\b|\bdocument\b/);
  assert.doesNotMatch(code, /localStorage|sessionStorage|Supabase|repository/i);
  assert.doesNotMatch(code, /console\.|JSON\.stringify\(error|String\(error/);
  assert.doesNotMatch(code, /return\s*\{[^}]*\berror\b/);
  assert.doesNotMatch(code, /\bBlob\b|\bFile\b|\bcanvas\b|createObjectURL|html2canvas/);
}

async function runTests() {
  await testShareSuccessUsesExactPayloadWithoutClipboard();
  await testMissingShareFallsBackToExactClipboardText();
  await testNonAbortShareFailureFallsBackToClipboard();
  await testAbortDoesNotUseClipboard();
  await testClipboardFailureReturnsSanitizedFailure();
  await testNoCapabilitiesReturnsUnavailable();
  await testShareFailureWithoutClipboardReturnsFailure();
  await testInputsRemainImmutable();
  testStaticInfrastructureBoundary();

  console.log("workout-share-action runtime and static boundary tests passed");
}

runTests().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
