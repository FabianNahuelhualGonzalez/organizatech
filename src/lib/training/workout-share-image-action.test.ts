import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  executeWorkoutShareImageAction,
  WORKOUT_SHARE_IMAGE_MAX_BYTES,
  type WorkoutShareImageActionPorts,
} from "@/lib/training/workout-share-image-action";

interface TestFile {
  readonly blob: Blob;
  readonly filename: string;
  readonly type: string;
}

const png = new Blob(["safe-png"], { type: "image/png" });
const input = { png, generatedAt: "2026-07-31T22:00:00-04:00" } as const;

async function testShareSuccessStartsSynchronouslyWithoutDownload() {
  const events: string[] = [];
  const ports = createPorts({
    canShare: () => true,
    share: async () => {
      events.push("share");
    },
    createObjectUrl: () => {
      events.push("create-url");
      return "blob:unused";
    },
    download: async () => {
      events.push("download");
    },
  });

  const pendingResult = executeWorkoutShareImageAction(input, ports);
  assert.deepEqual(events, ["share"], "share se invoca sin un await previo");
  assert.deepEqual(await pendingResult, { kind: "shared" });
  assert.deepEqual(events, ["share"], "share exitoso no crea URL ni descarga");
}

async function testUnsupportedFallsBackToDownloadWithSafeFilename() {
  const downloads: Array<{ objectUrl: string; filename: string }> = [];
  const createdFiles: TestFile[] = [];
  const revoked: string[] = [];
  const ports = createPorts({
    canShare: () => false,
    createFile: (blob, filename, type) => {
      const file = { blob, filename, type };
      createdFiles.push(file);
      return file;
    },
    createObjectUrl: () => "blob:download-1",
    download: async (data) => {
      downloads.push({ ...data });
    },
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
  });

  assert.deepEqual(await executeWorkoutShareImageAction(input, ports), { kind: "downloaded" });
  assert.equal(createdFiles[0]?.filename, "organizatech-entrenamiento-2026-07-31.png");
  assert.equal(createdFiles[0]?.type, "image/png");
  assert.equal(createdFiles[0]?.blob, png);
  assert.deepEqual(downloads, [{
    objectUrl: "blob:download-1",
    filename: "organizatech-entrenamiento-2026-07-31.png",
  }]);
  assert.deepEqual(revoked, ["blob:download-1"]);
}

async function testCanShareExceptionFallsBackToDownload() {
  let downloadCalls = 0;
  const result = await executeWorkoutShareImageAction(input, createPorts({
    canShare: () => {
      throw new Error("private capability error");
    },
    download: async () => {
      downloadCalls += 1;
    },
  }));

  assert.deepEqual(result, { kind: "downloaded" });
  assert.equal(downloadCalls, 1);
}

async function testAbortReturnsCancelledWithoutDownloadOrObjectUrl() {
  let objectUrlCalls = 0;
  let downloadCalls = 0;
  const abortError = new Error("private cancellation details");
  abortError.name = "AbortError";
  const result = await executeWorkoutShareImageAction(input, createPorts({
    canShare: () => true,
    share: async () => {
      throw abortError;
    },
    createObjectUrl: () => {
      objectUrlCalls += 1;
      return "blob:must-not-exist";
    },
    download: async () => {
      downloadCalls += 1;
    },
  }));

  assert.deepEqual(result, { kind: "cancelled" });
  assert.equal(objectUrlCalls, 0);
  assert.equal(downloadCalls, 0);
}

async function testNonAbortShareErrorFallsBackToDownload() {
  let downloadCalls = 0;
  const result = await executeWorkoutShareImageAction(input, createPorts({
    canShare: () => true,
    share: async () => {
      throw new Error("Bearer private-token ownerId=private-owner");
    },
    download: async () => {
      downloadCalls += 1;
    },
  }));

  assert.deepEqual(result, { kind: "downloaded" });
  assert.equal(downloadCalls, 1);
  assert.doesNotMatch(JSON.stringify(result), /Bearer|private-token|ownerId|private-owner/);
}

async function testDownloadFailureReturnsFailedAndStillRevokesExactlyOnce() {
  const revoked: string[] = [];
  const result = await executeWorkoutShareImageAction(input, createPorts({
    canShare: () => false,
    createObjectUrl: () => "blob:download-failure",
    download: async () => {
      throw new Error("token=private userId=private-user");
    },
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
  }));

  assert.deepEqual(result, { kind: "failed" });
  assert.deepEqual(revoked, ["blob:download-failure"]);
  assert.doesNotMatch(JSON.stringify(result), /token|private|userId/);
}

async function testCreateObjectUrlFailureReturnsFailedWithoutDownloadOrRevoke() {
  let downloadCalls = 0;
  let revokeCalls = 0;
  const result = await executeWorkoutShareImageAction(input, createPorts({
    createObjectUrl: () => {
      throw new Error("Bearer private-object-url-error");
    },
    download: async () => {
      downloadCalls += 1;
    },
    revokeObjectUrl: () => {
      revokeCalls += 1;
    },
  }));

  assert.deepEqual(result, { kind: "failed" });
  assert.equal(downloadCalls, 0);
  assert.equal(revokeCalls, 0);
}

async function testRevokeObjectUrlFailureChangesResultToFailed() {
  let downloadCalls = 0;
  let revokeCalls = 0;
  const result = await executeWorkoutShareImageAction(input, createPorts({
    createObjectUrl: () => "blob:revoke-failure",
    download: async () => {
      downloadCalls += 1;
    },
    revokeObjectUrl: () => {
      revokeCalls += 1;
      throw new Error("secret=private-revoke-error");
    },
  }));

  assert.deepEqual(result, { kind: "failed" });
  assert.equal(downloadCalls, 1);
  assert.equal(revokeCalls, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret|private-revoke-error/);
}

async function testInvalidPngSizeAndMimeRejectBeforeUsingPorts() {
  assert.equal(WORKOUT_SHARE_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
  const invalidPngs = [
    new Blob([], { type: "image/png" }),
    new Blob([new Uint8Array(WORKOUT_SHARE_IMAGE_MAX_BYTES + 1)], { type: "image/png" }),
    new Blob(["not-png"], { type: "text/plain" }),
  ];

  for (const invalidPng of invalidPngs) {
    let portCalls = 0;
    const trackPortCall = () => {
      portCalls += 1;
    };
    const result = await executeWorkoutShareImageAction(
      { png: invalidPng, generatedAt: "2026-07-31" },
      createPorts({
        createFile: (blob, filename, type) => {
          trackPortCall();
          return { blob, filename, type };
        },
        canShare: () => {
          trackPortCall();
          return false;
        },
        share: async () => {
          trackPortCall();
        },
        createObjectUrl: () => {
          trackPortCall();
          return "blob:invalid";
        },
        download: async () => {
          trackPortCall();
        },
        revokeObjectUrl: () => {
          trackPortCall();
        },
        isAbortError: () => {
          trackPortCall();
          return false;
        },
      }),
    );

    assert.deepEqual(result, { kind: "failed" });
    assert.equal(portCalls, 0, "un PNG inválido debe rechazarse antes de usar puertos");
  }
}

async function testActionInputRemainsImmutable() {
  const frozenInput = Object.freeze({
    png,
    generatedAt: input.generatedAt,
  });
  const before = {
    png: frozenInput.png,
    generatedAt: frozenInput.generatedAt,
    size: frozenInput.png.size,
    type: frozenInput.png.type,
  };

  assert.deepEqual(
    await executeWorkoutShareImageAction(frozenInput, createPorts()),
    { kind: "downloaded" },
  );
  assert.equal(frozenInput.png, before.png);
  assert.equal(frozenInput.generatedAt, before.generatedAt);
  assert.equal(frozenInput.png.size, before.size);
  assert.equal(frozenInput.png.type, before.type);
}

async function testSynchronousShareErrorUsesAbortGuard() {
  const abortError = new Error("cancelled synchronously");
  abortError.name = "AbortError";
  let downloadCalls = 0;
  const result = await executeWorkoutShareImageAction(input, createPorts({
    canShare: () => true,
    share: () => {
      throw abortError;
    },
    download: async () => {
      downloadCalls += 1;
    },
  }));

  assert.deepEqual(result, { kind: "cancelled" });
  assert.equal(downloadCalls, 0);
}

async function testInvalidMimeAndPortErrorsStayGeneric() {
  const wrongMime = new Blob(["Bearer private-token"], { type: "text/plain" });
  const invalidMimeResult = await executeWorkoutShareImageAction(
    { png: wrongMime, generatedAt: "ownerId=private" },
    createPorts(),
  );
  const createFileResult = await executeWorkoutShareImageAction(input, createPorts({
    createFile: () => {
      throw new Error("profileId=private secret=private-secret");
    },
  }));

  assert.deepEqual(invalidMimeResult, { kind: "failed" });
  assert.deepEqual(createFileResult, { kind: "failed" });
  assert.doesNotMatch(
    JSON.stringify([invalidMimeResult, createFileResult]),
    /Bearer|private-token|ownerId|profileId|private-secret/,
  );
}

function testStaticSourceBoundaryAndOrdering() {
  // Contrato ESTATICO/SOURCE-BASED: complementa, pero no sustituye, los tests runtime anteriores.
  // No renderiza DOM; verifica APIs prohibidas, cleanup y orden del contrato.
  const source = readFileSync("src/lib/training/workout-share-image-action.ts", "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const actionStart = code.indexOf("export async function executeWorkoutShareImageAction");
  const helperStart = code.indexOf("\nfunction isSafeAbortError", actionStart);
  const actionSource = code.slice(actionStart, helperStart);
  const shareCallIndex = actionSource.indexOf("ports.share(");
  const firstAwaitIndex = actionSource.indexOf("await ");

  assert.ok(actionStart >= 0 && helperStart > actionStart);
  assert.ok(shareCallIndex >= 0);
  assert.ok(firstAwaitIndex >= 0);
  assert.ok(shareCallIndex < firstAwaitIndex);
  assert.match(actionSource, /isSafeAbortError\(error, ports\.isAbortError\)/);
  assert.match(actionSource, /input\.png\.size === 0/);
  assert.match(actionSource, /input\.png\.size > WORKOUT_SHARE_IMAGE_MAX_BYTES/);
  assert.match(source, /buildWorkoutShareImageFilename\(\{ generatedAt: input\.generatedAt \}\)/);
  assert.match(source, /\}\s*finally\s*\{/);
  assert.match(source, /ports\.revokeObjectUrl\(objectUrl\)/);
  assert.doesNotMatch(code, /\bnavigator\b|\bwindow\b|\bdocument\b/);
  assert.doesNotMatch(code, /console\.|JSON\.stringify\(error|String\(error|return\s*\{[^}]*error/);
  assert.doesNotMatch(code, /Date\.now|Math\.random|randomUUID|localStorage|sessionStorage|fetch\s*\(/);
}

function testPackageRegistrationContract() {
  // Contrato ESTATICO/SOURCE-BASED: verifica el registro; no sustituye ningún test runtime.
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: { test?: string };
  };
  const testScript = packageJson.scripts?.test ?? "";
  const workoutShareGroup = testScript
    .split(" && ")
    .find((group) => group.includes("src/lib/training/workout-share-model.test.ts"));

  assert.equal(testScript.split(" && ").length, 124);
  assert.equal(countOccurrences(testScript, "src/lib/training/workout-share-image.test.ts"), 1);
  assert.equal(countOccurrences(testScript, "src/lib/training/workout-share-image-action.test.ts"), 1);
  assert.match(workoutShareGroup ?? "", /workout-share-image\.test\.ts/);
  assert.match(workoutShareGroup ?? "", /workout-share-image-action\.test\.ts/);
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}

function createPorts(
  overrides: Partial<WorkoutShareImageActionPorts<TestFile>> = {},
): WorkoutShareImageActionPorts<TestFile> {
  return {
    createFile: (blob, filename, type) => ({ blob, filename, type }),
    canShare: () => false,
    share: async () => undefined,
    createObjectUrl: () => "blob:default-download",
    download: async () => undefined,
    revokeObjectUrl: () => undefined,
    isAbortError: (error) => error instanceof Error && error.name === "AbortError",
    ...overrides,
  };
}

async function runTests() {
  await testShareSuccessStartsSynchronouslyWithoutDownload();
  await testUnsupportedFallsBackToDownloadWithSafeFilename();
  await testCanShareExceptionFallsBackToDownload();
  await testAbortReturnsCancelledWithoutDownloadOrObjectUrl();
  await testNonAbortShareErrorFallsBackToDownload();
  await testDownloadFailureReturnsFailedAndStillRevokesExactlyOnce();
  await testCreateObjectUrlFailureReturnsFailedWithoutDownloadOrRevoke();
  await testRevokeObjectUrlFailureChangesResultToFailed();
  await testInvalidPngSizeAndMimeRejectBeforeUsingPorts();
  await testActionInputRemainsImmutable();
  await testSynchronousShareErrorUsesAbortGuard();
  await testInvalidMimeAndPortErrorsStayGeneric();
  testStaticSourceBoundaryAndOrdering();
  testPackageRegistrationContract();
  console.log("workout-share-image-action runtime and static boundary tests passed");
}

runTests().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
