import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildWorkoutShareImageLayout,
  renderWorkoutShareImagePng,
  WORKOUT_SHARE_IMAGE_HEIGHT,
  WORKOUT_SHARE_IMAGE_MAX_DETAIL_ROWS,
  WORKOUT_SHARE_IMAGE_WIDTH,
  type WorkoutShareImageCanvas,
  type WorkoutShareImageCanvasContext,
} from "@/lib/training/workout-share-image";
import { buildWorkoutShareCardModel, type WorkoutShareCardModel } from "@/lib/training/workout-share-model";
import { buildTrainingCompletionSummary } from "@/lib/training/training-completion-summary";

const baseModel: WorkoutShareCardModel = {
  title: "Piernas y zona media",
  periodLabel: "Viernes · Mesociclo · Semana 4",
  detailLines: [
    { label: "Estado", value: "Completado" },
    { label: "Duración", value: "52 min" },
    { label: "Sentadilla", value: "4 series · 32 repeticiones · 90 kg" },
  ],
  footer: "4 de 5 días",
};

function testLayoutIsDeterministicAndUsesExactDimensions() {
  const first = buildWorkoutShareImageLayout(baseModel);
  const second = buildWorkoutShareImageLayout(baseModel);

  assert.deepEqual(first, second);
  assert.equal(first.width, 1080);
  assert.equal(first.height, 1350);
  assert.equal(first.width, WORKOUT_SHARE_IMAGE_WIDTH);
  assert.equal(first.height, WORKOUT_SHARE_IMAGE_HEIGHT);
}

function testDetailLimitAndOverflowIndicator() {
  const model: WorkoutShareCardModel = {
    ...baseModel,
    detailLines: Array.from({ length: 13 }, (_, index) => ({
      label: `Ejercicio ${index + 1}`,
      value: `${index + 1} series`,
    })),
  };
  const layout = buildWorkoutShareImageLayout(model);

  assert.equal(WORKOUT_SHARE_IMAGE_MAX_DETAIL_ROWS, 10);
  assert.equal(layout.detailRows.length, 10);
  assert.equal(layout.overflowLabel, "+3 ejercicios más");
  assert.equal(JSON.stringify(layout).includes("Ejercicio 11"), false);
}

function testUnicodeAndLongTextWrapSafely() {
  const longUnicode = `Prensa 🏋️‍♀️ ${"a\u0301漢字🏋️‍♀️🙂".repeat(24)}`;
  const layout = buildWorkoutShareImageLayout({
    title: longUnicode,
    periodLabel: `Semana internacional ${longUnicode}`,
    detailLines: [{ label: longUnicode, value: longUnicode }],
    footer: longUnicode,
  });
  const renderedLines = [
    ...layout.titleLines,
    ...layout.periodLines,
    ...layout.detailRows.flatMap((row) => [...row.labelLines, ...row.valueLines]),
    ...layout.footerLines,
  ];

  assert.equal(layout.titleLines.length, 2);
  assert.equal(layout.detailRows[0]?.labelLines.length, 2);
  assert.ok(renderedLines.some((line) => line.endsWith("…")));
  assert.doesNotMatch(JSON.stringify(layout), /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
  for (const line of renderedLines) assertSafeGraphemeBoundary(line);
}

function testExtremeUnicodeTruncationEndsAtSafeBoundary() {
  const boundaryCases = [
    `${"\u0001".repeat(4095)}\ud83d\ude00contenido posterior`,
    `${"\u0001".repeat(4095)}\u0301contenido posterior`,
    `${"\u0001".repeat(4095)}\u200dcontenido posterior`,
  ];

  for (const title of boundaryCases) {
    assert.ok(title.length > 4096);
    const layout = buildWorkoutShareImageLayout({
      title,
      periodLabel: baseModel.periodLabel,
      detailLines: baseModel.detailLines,
    });
    for (const line of layout.titleLines) assertSafeGraphemeBoundary(line);
  }

  const malformedLayout = buildWorkoutShareImageLayout({
    title: "A\ud83dB\ude00C",
    periodLabel: baseModel.periodLabel,
    detailLines: baseModel.detailLines,
  });
  assert.deepEqual(malformedLayout.titleLines, ["ABC"]);
  for (const line of malformedLayout.titleLines) assertNoIsolatedSurrogates(line);
}

async function testSummaryToFillTextUnicodeBoundaryComposition() {
  const boundaryTitle = `A${"\u0001".repeat(4094)}😀`;
  assert.equal(boundaryTitle.length, 4097, "el fixture cruza 4096 unidades UTF-16");
  assert.equal(
    Array.from(new Intl.Segmenter("es", { granularity: "grapheme" }).segment(boundaryTitle)).length,
    4096,
    "el emoji completo ocupa el grapheme 4096",
  );

  const summary = buildTrainingCompletionSummary({
    sessionId: "private-session-id",
    dayLabel: "Lunes",
    workoutName: boundaryTitle,
    cycleLabel: "Mesociclo",
    weekLabel: "Semana 1",
    progressLabel: "1 de 5 días",
    workoutStartedAt: "2026-08-01T10:00:00.000Z",
    savedAt: "2026-08-01T10:45:00.000Z",
    currentDate: "2026-08-01",
    exercises: [{
      exerciseId: "private-exercise-id",
      exerciseLineageId: "private-lineage-id",
      exerciseName: "Press banca",
      targetSets: 1,
      draft: { reps: [10], weight: "80" },
    }],
  });
  const summaryBeforeShare = structuredClone(summary);
  const model = buildWorkoutShareCardModel(summary);
  assert.ok(model);
  assert.equal(model.title, "A", "el emoji que cruza el limite UTF-16 se descarta como grapheme completo");

  const layout = buildWorkoutShareImageLayout(model);
  assert.deepEqual(layout.titleLines, ["A"]);
  const calls: string[] = [];
  const canvas = createCanvas(createContext(calls), (callback) => {
    callback(new Blob(["png"], { type: "image/png" }));
  });
  await renderWorkoutShareImagePng(model, { createCanvas: () => canvas });

  assert.deepEqual(summary, summaryBeforeShare, "summary → shareModel → layout → fillText no muta el summary");
  assert.ok(calls.some((call) => call.startsWith("fillText:A:")), "fillText recibe solo graphemes completos");
  assert.equal(calls.some((call) => call.includes("😀")), false, "fillText no recibe el grapheme fuera de limite");
  assert.equal(JSON.stringify(model).includes("private-session-id"), false);
  assert.equal(JSON.stringify(layout).includes("private-session-id"), false);
  for (const value of [model.title, ...layout.titleLines, ...calls]) {
    assertNoIsolatedSurrogates(value);
  }
}

function testProjectionExcludesContaminatedFieldsAndReferences() {
  const contaminatedLine = Object.assign(
    { label: "Remo", value: "3 series" },
    { exerciseId: "private-exercise-id", ownerId: "private-owner-id" },
  );
  const contaminatedModel = Object.assign(
    {
      title: baseModel.title,
      periodLabel: baseModel.periodLabel,
      detailLines: [contaminatedLine],
      footer: baseModel.footer,
    },
    {
      sessionId: "private-session-id",
      userId: "private-user-id",
      profileId: "private-profile-id",
      token: "private-token",
    },
  ) as WorkoutShareCardModel;
  const layout = buildWorkoutShareImageLayout(contaminatedModel);
  const serialized = JSON.stringify(layout);

  for (const secret of [
    "private-exercise-id",
    "private-owner-id",
    "private-session-id",
    "private-user-id",
    "private-profile-id",
    "private-token",
  ]) {
    assert.equal(serialized.includes(secret), false, `no debe proyectar ${secret}`);
  }
  assert.notEqual(layout.detailRows, contaminatedModel.detailLines);
  assert.notEqual(layout.detailRows[0], contaminatedModel.detailLines[0]);
}

async function testVisibleFieldsRedactSensitiveValuesBeforeFillText() {
  const sensitiveValues = [
    "private@example.com",
    "550e8400-e29b-41d4-a716-446655440000",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.private_signature",
    "private-bearer-value",
    "private-token-value",
    "private-secret-value",
    "private-user-id",
    "private-owner-id",
    "private-profile-id",
    "private-session-id",
    "private-exercise-id",
    "private-cycle-id",
  ];
  const contaminatedModel: WorkoutShareCardModel = {
    title: `Rutina ${sensitiveValues[0]} userId=${sensitiveValues[6]}`,
    periodLabel: `UUID ${sensitiveValues[1]} ownerId=${sensitiveValues[7]}`,
    detailLines: [{
      label: `JWT ${sensitiveValues[2]} exerciseId=${sensitiveValues[10]}`,
      value: `Bearer ${sensitiveValues[3]} token=${sensitiveValues[4]} sessionId=${sensitiveValues[9]}`,
    }],
    footer: `secret=${sensitiveValues[5]} profileId=${sensitiveValues[8]} cycleId=${sensitiveValues[11]}`,
  };
  const layout = buildWorkoutShareImageLayout(contaminatedModel);
  const calls: string[] = [];
  const canvas = createCanvas(createContext(calls), (callback) => {
    callback(new Blob(["png"], { type: "image/png" }));
  });

  await renderWorkoutShareImagePng(contaminatedModel, { createCanvas: () => canvas });
  const visibleOutput = `${JSON.stringify(layout)}\n${calls.join("\n")}`;
  assert.match(visibleOutput, /\[redactado\]/);
  for (const sensitiveValue of sensitiveValues) {
    assert.equal(
      visibleOutput.includes(sensitiveValue),
      false,
      `layout y fillText no deben exponer ${sensitiveValue}`,
    );
  }
}

function testLayoutDoesNotMutateInput() {
  const model = structuredClone(baseModel);
  const before = structuredClone(model);
  Object.freeze(model.detailLines);
  model.detailLines.forEach(Object.freeze);
  Object.freeze(model);

  buildWorkoutShareImageLayout(model);
  assert.deepEqual(model, before);
}

async function testRendererUsesCanvas2dAndPngBlob() {
  const calls: string[] = [];
  const context = createContext(calls);
  const png = new Blob(["png"], { type: "image/png" });
  let requestedBlobType = "";
  let canvasWidth = 0;
  let canvasHeight = 0;
  const canvas = createCanvas(context, (callback, type) => {
    requestedBlobType = type;
    callback(png);
  });

  const result = await renderWorkoutShareImagePng(baseModel, {
    createCanvas: (width, height) => {
      canvasWidth = width;
      canvasHeight = height;
      return canvas;
    },
  });

  assert.equal(result, png);
  assert.equal(result.type, "image/png");
  assert.equal(canvasWidth, 1080);
  assert.equal(canvasHeight, 1350);
  assert.equal(canvas.width, 1080);
  assert.equal(canvas.height, 1350);
  assert.equal(requestedBlobType, "image/png");
  assert.ok(calls.includes("fillRect:0:0:1080:1350"));
  assert.ok(calls.some((call) => call.includes("ORGANIZATECH")));
}

async function testMissingContextReturnsOnlyPublicError() {
  const canvas = createCanvas(null, () => undefined);
  await assert.rejects(
    renderWorkoutShareImagePng(baseModel, { createCanvas: () => canvas }),
    (error: unknown) => assertPublicImageError(error),
  );
}

async function testNullBlobReturnsOnlyPublicError() {
  const canvas = createCanvas(createContext([]), (callback) => callback(null));
  await assert.rejects(
    renderWorkoutShareImagePng(baseModel, { createCanvas: () => canvas }),
    (error: unknown) => assertPublicImageError(error),
  );
}

async function testWrongMimeReturnsOnlyPublicError() {
  const secret = "Bearer private-token ownerId=private-owner";
  const canvas = createCanvas(createContext([]), (callback) => {
    callback(new Blob([secret], { type: "text/plain" }));
  });
  await assert.rejects(
    renderWorkoutShareImagePng(baseModel, { createCanvas: () => canvas }),
    (error: unknown) => {
      assertPublicImageError(error);
      assert.doesNotMatch(String((error as Error).message), /Bearer|private-token|ownerId|private-owner/);
      return true;
    },
  );
}

function testStaticSourceBoundary() {
  // Contrato ESTATICO/SOURCE-BASED: complementa, pero no sustituye, los tests runtime anteriores.
  // No renderiza DOM; verifica imports, APIs prohibidas y la forma segura del contrato.
  const source = readFileSync("src/lib/training/workout-share-image.ts", "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.match(source, /^import type \{ WorkoutShareCardModel \}/m);
  assert.doesNotMatch(code, /TrainingCompletionSummary|ShareWorkoutCard|TrainingSession|Supabase/i);
  assert.doesNotMatch(code, /\bnavigator\b|\bwindow\b|\bdocument\b/);
  assert.doesNotMatch(code, /toDataURL|drawImage|html2canvas|satori|next\/og|fetch\s*\(/i);
  assert.doesNotMatch(code, /\.\.\.(?:model|line)\b/);
  assert.doesNotMatch(code, /Date\.now|Math\.random|randomUUID/);
  assert.match(source, /\.slice\(0, WORKOUT_SHARE_IMAGE_MAX_DETAIL_ROWS\)/);
  assert.match(source, /canvas\.toBlob\(/);
  assert.match(source, /const PNG_MIME_TYPE = "image\/png";/);
  assert.match(source, /textAlign: CanvasTextAlign;/);
  assert.match(source, /textBaseline: CanvasTextBaseline;/);
  assert.match(source, /\.normalize\("NFKC"\)\s*\.replace\(ISOLATED_SURROGATE_PATTERN, ""\)/);
  assert.match(source, /for \(const grapheme of splitGraphemes\(normalized\)\)/);
  assert.match(source, /utf16Length \+ grapheme\.length > maxLength/);
}

function assertRealCanvasCompatibility(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): [WorkoutShareImageCanvasContext, WorkoutShareImageCanvas] {
  return [context, canvas];
}
void assertRealCanvasCompatibility;

function createContext(calls: string[]): WorkoutShareImageCanvasContext {
  return {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "top",
    fillRect: (x, y, width, height) => calls.push(`fillRect:${x}:${y}:${width}:${height}`),
    fillText: (text, x, y) => calls.push(`fillText:${text}:${x}:${y}`),
  };
}

function createCanvas(
  context: WorkoutShareImageCanvasContext | null,
  toBlob: WorkoutShareImageCanvas["toBlob"],
): WorkoutShareImageCanvas {
  return {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob,
  };
}

function assertSafeGraphemeBoundary(value: string): void {
  assertNoIsolatedSurrogates(value);
  assert.doesNotMatch(value, /^[\p{Mark}\u200d\ufe0f]/u);
  assert.doesNotMatch(value, /\u200d$/u);
}

function assertNoIsolatedSurrogates(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      assert.ok(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff, "high surrogate debe tener low surrogate");
      index += 1;
      continue;
    }
    assert.equal(codeUnit >= 0xdc00 && codeUnit <= 0xdfff, false, "low surrogate debe tener high surrogate");
  }
}

function assertPublicImageError(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal(error.message, "No fue posible generar la imagen del entrenamiento.");
  assert.equal(Object.keys(error).length, 0);
  return true;
}

async function runTests() {
  testLayoutIsDeterministicAndUsesExactDimensions();
  testDetailLimitAndOverflowIndicator();
  testUnicodeAndLongTextWrapSafely();
  testExtremeUnicodeTruncationEndsAtSafeBoundary();
  await testSummaryToFillTextUnicodeBoundaryComposition();
  testProjectionExcludesContaminatedFieldsAndReferences();
  await testVisibleFieldsRedactSensitiveValuesBeforeFillText();
  testLayoutDoesNotMutateInput();
  await testRendererUsesCanvas2dAndPngBlob();
  await testMissingContextReturnsOnlyPublicError();
  await testNullBlobReturnsOnlyPublicError();
  await testWrongMimeReturnsOnlyPublicError();
  testStaticSourceBoundary();
  console.log("workout-share-image runtime and static boundary tests passed");
}

runTests().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
