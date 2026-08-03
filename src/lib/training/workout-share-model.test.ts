import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  TrainingCompletionComparisonStatus,
  TrainingCompletionExerciseSummary,
  TrainingCompletionSummary,
} from "@/lib/training/training-completion-summary";
import {
  buildWorkoutShareCardModel,
  buildWorkoutShareImageFilename,
  buildWorkoutShareTextPayload,
  type WorkoutShareCardModel,
} from "@/lib/training/workout-share-model";

{
  const summary = createSummary({
    exercises: [
      createExercise({ exerciseName: "Press banca", currentSeriesCount: 1, currentTotalReps: 10, currentWeight: 80 }),
      createExercise({
        exerciseId: "exercise-2",
        exerciseLineageId: "lineage-2",
        exerciseName: "Remo con barra",
        currentSeriesCount: 3,
        currentTotalReps: 27,
        currentWeight: 62.5,
      }),
    ],
  });

  const model = buildWorkoutShareCardModel(summary);
  assert.deepEqual(model, {
    title: "Pecho y espalda",
    periodLabel: "Lunes · Mesociclo · Semana 2",
    detailLines: [
      { label: "Estado", value: "Completado" },
      { label: "Duración", value: "48 min" },
      { label: "Press banca", value: "1 serie · 10 repeticiones · 80 kg" },
      { label: "Remo con barra", value: "3 series · 27 repeticiones · 62,5 kg" },
    ],
    footer: "2 de 5 dias",
  });
}

{
  const statuses: TrainingCompletionComparisonStatus[] = ["ready", "first_reference", "unavailable"];
  const summary = createSummary({
    sessionId: "session-private",
    exercises: statuses.map((comparisonStatus, index) => createExercise({
      exerciseId: `private-exercise-${index}`,
      exerciseLineageId: `private-lineage-${index}`,
      exerciseName: `Ejercicio ${index + 1}`,
      comparisonStatus,
    })),
  });
  const model = buildWorkoutShareCardModel(summary);
  assert.ok(model);
  assert.equal(model.detailLines.length, 5);
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /session-private|private-exercise|private-lineage/);
  assert.doesNotMatch(serialized, /ready|first_reference|unavailable/);
}

{
  const summary = createSummary({
    exercises: [
      createExercise({
        exerciseName: "Valores invalidos",
        currentSeriesCount: Number.NaN,
        currentTotalReps: Number.POSITIVE_INFINITY,
        currentWeight: -10,
      }),
      createExercise({
        exerciseId: "exercise-decimal",
        exerciseName: "Valores decimales",
        currentSeriesCount: 2.9,
        currentTotalReps: 10.9,
        currentWeight: 12.345,
      }),
      createExercise({
        exerciseId: "exercise-negative",
        exerciseName: "Valores negativos",
        currentSeriesCount: -2,
        currentTotalReps: -7,
        currentWeight: Number.NEGATIVE_INFINITY,
      }),
    ],
  });
  const model = buildWorkoutShareCardModel(summary);
  assert.ok(model);
  assert.deepEqual(model.detailLines.slice(2), [
    { label: "Valores invalidos", value: "0 series · 0 repeticiones · —" },
    { label: "Valores decimales", value: "2 series · 10 repeticiones · 12,35 kg" },
    { label: "Valores negativos", value: "0 series · 0 repeticiones · —" },
  ]);
}

{
  const summary = createSummary({
    exercises: [createExercise({
      exerciseName: "\u0000\u202e 550e8400-e29b-41d4-a716-446655440000 test@example.com",
    })],
  });
  assert.equal(buildWorkoutShareCardModel(summary), null, "un nombre compuesto solo por datos redactados no es compartible");
  assert.equal(buildWorkoutShareCardModel(createSummary({ exercises: [] })), null);
}

{
  const summary = createSummary({
    workoutName: " ownerId=private ",
    dayLabel: "",
    cycleLabel: "profileId=private",
    weekLabel: "\u202e",
    statusLabel: "token=private",
    durationLabel: "secret=private",
    progressLabel: "notes=private",
  });
  assert.deepEqual(buildWorkoutShareCardModel(summary), {
    title: "Entrenamiento completado",
    periodLabel: "Periodo no disponible",
    detailLines: [
      { label: "Estado", value: "Completado" },
      { label: "Duración", value: "Duración no disponible" },
      { label: "Press banca", value: "3 series · 30 repeticiones · 80 kg" },
    ],
  });
}

{
  const model: WorkoutShareCardModel = {
    title: "Pecho y espalda",
    periodLabel: "Lunes · Mesociclo · Semana 2",
    detailLines: [
      { label: "Estado", value: "Completado" },
      { label: "Duración", value: "48 min" },
      { label: "Press banca", value: "3 series · 30 repeticiones · 80 kg" },
    ],
    footer: "2 de 5 dias",
  };
  assert.deepEqual(buildWorkoutShareTextPayload(model), {
    title: "Entrenamiento completado - Organizatech",
    text: [
      "Organizatech",
      "Pecho y espalda",
      "Lunes · Mesociclo · Semana 2",
      "",
      "Estado: Completado",
      "Duración: 48 min",
      "Press banca: 3 series · 30 repeticiones · 80 kg",
      "",
      "2 de 5 dias",
    ].join("\n"),
  });
}

{
  const summary = createSummary();
  const first = buildWorkoutShareCardModel(summary);
  const second = buildWorkoutShareCardModel(summary);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first ? buildWorkoutShareTextPayload(first) : null,
    second ? buildWorkoutShareTextPayload(second) : null,
  );
}

{
  const summary = createSummary();
  const original = structuredClone(summary);
  const model = buildWorkoutShareCardModel(summary);
  assert.deepEqual(summary, original, "el mapping no muta el resumen");
  assert.ok(model);
  assert.notEqual(model.detailLines, summary.exercises, "la salida no reutiliza el array de ejercicios");
  assert.notEqual(model.detailLines[2], summary.exercises[0], "las lineas no reutilizan ejercicios productivos");
  (model.detailLines as Array<{ label: string; value: string }>)[2].label = "Cambio local";
  assert.deepEqual(summary, original, "la salida puede cambiar sin contaminar el input");
}

{
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const email = "private@example.com";
  const token = "private-token-value";
  const summary = createSummary({
    workoutName: `Rutina ownerId=owner-1 ${email} ${uuid}`,
    dayLabel: "Lunes userId=user-1",
    cycleLabel: "Mesociclo profileId=profile-1",
    weekLabel: `Semana 2 Bearer ${token}`,
    progressLabel: "notes=private-note observation=private-observation RIR=4 readiness=high",
    exercises: [createExercise({
      exerciseName: `Press token=${token} ${email} ${uuid}`,
    })],
  }) as TrainingCompletionSummary & {
    ownerId: string;
    userId: string;
    profileId: string;
    email: string;
    token: string;
    notes: string;
    observation: string;
    RIR: number;
    readiness: string;
  };
  Object.assign(summary, {
    ownerId: "owner-raw",
    userId: "user-raw",
    profileId: "profile-raw",
    email,
    token,
    notes: "private-note",
    observation: "private-observation",
    RIR: 4,
    readiness: "high",
  });
  Object.assign(summary.exercises[0], {
    cycleId: "cycle-private",
    cycleDayId: "cycle-day-private",
    trainingCycleExerciseId: "training-exercise-private",
    ownerId: "owner-exercise-private",
    observation: "exercise-observation-private",
  });

  const model = buildWorkoutShareCardModel(summary);
  assert.ok(model);
  const text = buildWorkoutShareTextPayload(model).text;
  const exposed = `${JSON.stringify(model)}\n${text}`.toLowerCase();
  for (const forbidden of [
    uuid,
    email,
    token,
    "owner-raw",
    "user-raw",
    "profile-raw",
    "private-note",
    "private-observation",
    "cycle-private",
    "cycle-day-private",
    "training-exercise-private",
    "owner-exercise-private",
    "exercise-observation-private",
    "ownerid",
    "userid",
    "profileid",
    "email",
    "notes",
    "observation",
    "rir",
    "readiness",
    "bearer",
    "token",
  ]) {
    assert.equal(exposed.includes(forbidden.toLowerCase()), false, `no debe exponer ${forbidden}`);
  }
}

{
  const longText = "A".repeat(500);
  const summary = createSummary({
    workoutName: `Ｒｕｔｉｎａ\u0000\n\u202e ${longText}`,
    dayLabel: "Lu\nnes",
    cycleLabel: "Meso\u0007ciclo",
    weekLabel: "Semana\u2066 2",
    progressLabel: `Progreso\r\n${longText}`,
    exercises: [createExercise({ exerciseName: `Press\u0000\u202e ${longText}` })],
  });
  const model = buildWorkoutShareCardModel(summary);
  assert.ok(model);
  const serialized = JSON.stringify(model);
  assert.doesNotMatch(serialized, /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
  assert.ok(model.title.startsWith("Rutina A"), "NFKC y espacios se normalizan antes de limitar");
  assert.ok(Array.from(model.title).length <= 96);
  assert.ok(Array.from(model.detailLines[2].label).length <= 96);
  assert.ok(model.footer && Array.from(model.footer).length <= 160);
}

{
  const nfkcExpansionAtLimit = `${"A".repeat(95)}㍿`;
  const model = buildWorkoutShareCardModel(createSummary({ workoutName: nfkcExpansionAtLimit }));
  assert.ok(model);
  assert.equal(model.title, `${"A".repeat(95)}株`);
  assert.equal(
    Array.from(new Intl.Segmenter("es", { granularity: "grapheme" }).segment(model.title)).length,
    96,
    "NFKC se aplica antes del limite final de graphemes",
  );
}

{
  const model = buildWorkoutShareCardModel(createSummary({
    workoutName: "\ud83dRutina\ude00 segura",
    exercises: [createExercise({ exerciseName: "Press\ud83d banca\ude00" })],
  }));
  assert.ok(model);
  assert.equal(model.title, "Rutina segura");
  assert.equal(model.detailLines[2]?.label, "Press banca");
  for (const value of [model.title, ...model.detailLines.flatMap((line) => [line.label, line.value])]) {
    assert.doesNotMatch(value, /[\uD800-\uDFFF]/u, "el modelo elimina surrogates aislados de entrada");
  }
}

assert.equal(
  buildWorkoutShareImageFilename({ generatedAt: "2026-07-31" }),
  "organizatech-entrenamiento-2026-07-31.png",
);
assert.equal(
  buildWorkoutShareImageFilename({ generatedAt: "2026-08-01T00:30:45.123Z" }),
  "organizatech-entrenamiento-2026-08-01.png",
);
assert.equal(
  buildWorkoutShareImageFilename({ generatedAt: "2026-08-01T23:30:45-04:00" }),
  "organizatech-entrenamiento-2026-08-01.png",
  "el filename usa el date key explicito y no cambia por zona horaria",
);
for (const invalid of [
  "",
  "not-a-date",
  "2026-02-30",
  "2026-07-31T25:00:00Z",
  "../../2026-07-31.png",
  "2026-07-31/../../secret",
  "2026-07-31.png.exe",
]) {
  const filename = buildWorkoutShareImageFilename({ generatedAt: invalid });
  assert.equal(filename, "organizatech-entrenamiento-0000-00-00.png");
  assert.match(filename, /^[a-z0-9.-]+$/);
  assert.equal(filename.includes("/"), false);
  assert.equal(filename.includes("\\"), false);
  assert.equal(filename.includes(".."), false);
  assert.equal(filename.endsWith(".png.png"), false);
}

runStaticSourceContract();

function runStaticSourceContract() {
  // Contrato estatico/source-based: inspecciona dependencias y wiring; no sustituye los casos runtime anteriores.
  const source = readFileSync(resolve(process.cwd(), "src/lib/training/workout-share-model.ts"), "utf8");

  assert.match(
    source,
    /import type \{ TrainingCompletionSummary \} from "@\/lib\/training\/training-completion-summary";/,
  );
  assert.doesNotMatch(source, /\.\.\.(?:summary|exercise)\b/);
  assert.doesNotMatch(
    source,
    /\b(?:ShareWorkoutCard|TrainingSession|ExerciseEntry|ExerciseDraft|Readiness|Repository|SupabaseClient)\b/,
  );
  assert.doesNotMatch(source, /\b(?:window|document|navigator|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(source, /\b(?:React|Blob|File|URL|crypto|Date\.now|Math\.random|randomUUID)\b/);
  assert.doesNotMatch(source, /\b(?:useState|useEffect|useMemo|useCallback|useRef)\b/);
  assert.doesNotMatch(source, /(?:html2canvas|clipboard|canvas|web\s*share)/i);
  assert.doesNotMatch(source, /(?:supabase|repositories|storage|navigation|auth|process\.env)/i);
  assert.match(source, /\.normalize\("NFKC"\)\s*\.replace\(ISOLATED_SURROGATE_PATTERN, ""\)/);
  assert.match(source, /for \(const \{ segment \} of GRAPHEME_SEGMENTER\.segment\(value\)\)/);
  assert.match(source, /utf16Length \+ segment\.length > maxLength/);
  assert.match(source, /codePointLength \+ graphemeCodePointLength > maxLength/);
  assert.match(source, /const MAX_TITLE_LENGTH = \d+;/);
  assert.match(source, /const MAX_DETAIL_VALUE_LENGTH = \d+;/);
  assert.match(source, /const MAX_SANITIZATION_INPUT_LENGTH = \d+;/);
}

function createSummary(
  overrides: Partial<TrainingCompletionSummary> = {},
): TrainingCompletionSummary {
  return {
    sessionId: "session-1",
    dayLabel: "Lunes",
    statusLabel: "Completado",
    workoutName: "Pecho y espalda",
    cycleLabel: "Mesociclo",
    weekLabel: "Semana 2",
    progressLabel: "2 de 5 dias",
    durationMinutes: 48,
    durationLabel: "48 min",
    exercises: [createExercise()],
    ...overrides,
  };
}

function createExercise(
  overrides: Partial<TrainingCompletionExerciseSummary> = {},
): TrainingCompletionExerciseSummary {
  return {
    exerciseId: "exercise-1",
    exerciseLineageId: "lineage-1",
    exerciseName: "Press banca",
    currentDate: "2026-07-31",
    currentDateLabel: "31/07",
    currentSeriesCount: 3,
    currentTotalReps: 30,
    currentWeight: 80,
    currentWeightLabel: "80 kg",
    previousDate: "2026-07-24",
    previousDateLabel: "24/07",
    previousSeriesCount: 3,
    previousTotalReps: 28,
    previousWeightLabel: "77,5 kg",
    repsDifference: 2,
    weightDifference: 2.5,
    comparisonStatus: "ready",
    repsTone: "positive",
    weightTone: "positive",
    resultLines: [{ label: "+2 reps", tone: "positive" }],
    ...overrides,
  };
}

console.log("workout-share-model: runtime y contrato estatico source-based OK");
