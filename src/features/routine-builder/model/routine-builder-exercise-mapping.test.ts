import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { ExerciseTemplate } from "@/lib/progress/types";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import {
  hydrateLegacyExerciseTemplatesWithLineage,
} from "@/lib/training/legacy-exercise-lineage-hydration";
import type {
  SetupDayState,
  SetupExerciseRow,
} from "@/lib/training/training-routine-draft";
import {
  createSetupByDayFromExercises,
} from "./routine-builder-exercise-mapping";

const mappingSource = readFileSync(
  "src/features/routine-builder/model/routine-builder-exercise-mapping.ts",
  "utf8",
);
const packageSource = readFileSync("package.json", "utf8");

function createBlankRow(id: string): SetupExerciseRow {
  return { id, name: "", sets: 0, reps: 0, weight: "" };
}

function createInitialSetupByDay(): Record<string, SetupDayState> {
  return Object.fromEntries(
    TRAINING_DAY_LABELS.map((day, dayIndex) => [
      day,
      {
        routineName: "",
        rows: Array.from(
          { length: 4 },
          (_, rowIndex) => createBlankRow(`seed-${dayIndex}-${rowIndex}`),
        ),
      },
    ]),
  );
}

function createExercise(overrides: Partial<ExerciseTemplate> = {}): ExerciseTemplate {
  return {
    id: "exercise-1",
    routine: "Torso",
    day: "Lunes",
    name: "Press banca",
    targetSets: 4,
    targetReps: 8,
    baseWeight: 42.5,
    ...overrides,
  };
}

function mapExercises(
  exercises: readonly ExerciseTemplate[],
  initialSetupByDay = createInitialSetupByDay(),
) {
  return createSetupByDayFromExercises({ exercises, initialSetupByDay });
}

// Empty input preserves the caller-provided empty rows, but returns a deep clone.
{
  const initial = createInitialSetupByDay();
  const result = mapExercises([], initial);
  assert.deepEqual(result, initial);
  assert.notStrictEqual(result, initial);
  for (const day of TRAINING_DAY_LABELS) {
    assert.notStrictEqual(result[day], initial[day]);
    assert.notStrictEqual(result[day].rows, initial[day].rows);
    assert.notStrictEqual(result[day].rows[0], initial[day].rows[0]);
  }
  assert.notStrictEqual(result.Lunes.rows, result.Martes.rows);
}

// A mapped row replaces blank placeholders and preserves every productive field.
{
  const result = mapExercises([
    createExercise({
      id: "press-1",
      day: "Martes",
      routine: "Pecho",
      name: "Press inclinado",
      targetSets: 3,
      targetReps: 10,
      baseWeight: 12.5,
      exerciseLineageId: "lineage-press",
    }),
  ]);
  assert.equal(result.Martes.routineName, "Pecho");
  assert.deepEqual(result.Martes.rows, [{
    id: "press-1",
    sourceExerciseId: "press-1",
    exerciseLineageId: "lineage-press",
    name: "Press inclinado",
    sets: 3,
    reps: 10,
    weight: "12,5",
  }]);
  assert.equal(result.Lunes.rows.length, 4, "los dias sin ejercicios conservan sus IDs externos");
}

// Input order is stable within each day; the setup map keeps its canonical day order.
{
  const result = mapExercises([
    createExercise({ id: "martes-1", day: "Martes", name: "Remo" }),
    createExercise({ id: "lunes-1", day: "Lunes", name: "Sentadilla" }),
    createExercise({ id: "martes-2", day: "Martes", name: "Curl" }),
  ]);
  assert.deepEqual(Object.keys(result), [...TRAINING_DAY_LABELS]);
  assert.deepEqual(result.Martes.rows.map((row) => row.id), ["martes-1", "martes-2"]);
  assert.deepEqual(result.Lunes.rows.map((row) => row.id), ["lunes-1"]);
}

// Production groups rows by day. If several routines share a day, the first routine name wins.
{
  const result = mapExercises([
    createExercise({ id: "routine-a", day: "Jueves", routine: "Torso A", name: "Remo" }),
    createExercise({ id: "routine-b", day: "Jueves", routine: "Torso B", name: "Remo" }),
  ]);
  assert.equal(result.Jueves.routineName, "Torso A");
  assert.deepEqual(result.Jueves.rows.map((row) => row.id), ["routine-a", "routine-b"]);
}

// An empty routine falls back to the resolved day, exactly as the root adapter does.
{
  const result = mapExercises([
    createExercise({ id: "empty-routine", day: "Viernes", routine: "" }),
  ]);
  assert.equal(result.Viernes.routineName, "Viernes");
}

// Missing, unknown and non-canonical day labels fall back to Lunes without alias coercion.
{
  const result = mapExercises([
    createExercise({ id: "missing-day", day: undefined, name: "A" }),
    createExercise({ id: "unknown-day", day: "Funday", name: "B" }),
    createExercise({ id: "lowercase-day", day: "martes", name: "C" }),
  ]);
  assert.deepEqual(
    result.Lunes.rows.map((row) => row.id),
    ["missing-day", "unknown-day", "lowercase-day"],
  );
}

// Lineage is preserved as provided by the upstream boundary, including null and undefined.
{
  const result = mapExercises([
    createExercise({ id: "lineage-value", name: "A", exerciseLineageId: "lineage-1" }),
    createExercise({ id: "lineage-null", name: "B", exerciseLineageId: null }),
    createExercise({ id: "lineage-undefined", name: "C", exerciseLineageId: undefined }),
  ]);
  assert.deepEqual(
    result.Lunes.rows.map((row) => row.exerciseLineageId),
    ["lineage-1", null, undefined],
  );
}

// Legacy lineage is resolved upstream by ID; the mapper preserves that result without name fallback.
{
  const hydrated = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "legacy-1", name: "Press legacy" })],
    [{ id: "lineage-legacy", source_legacy_exercise_id: "legacy-1" }],
  );
  const result = mapExercises(hydrated);
  assert.equal(result.Lunes.rows[0].id, "legacy-1");
  assert.equal(result.Lunes.rows[0].sourceExerciseId, "legacy-1");
  assert.equal(result.Lunes.rows[0].exerciseLineageId, "lineage-legacy");

  const withoutMapping = mapExercises(hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "legacy-without-lineage", name: "Legacy sin lineage" })],
    [],
  ));
  assert.equal(withoutMapping.Lunes.rows[0].exerciseLineageId, null);
}

// Cycle-scoped identity remains the cycle exercise ID, not sourceLegacyExerciseId.
{
  const result = mapExercises([
    createExercise({
      id: "cycle-exercise-1",
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      trainingCycleExerciseId: "cycle-exercise-1",
      sourceLegacyExerciseId: "legacy-1",
      exerciseLineageId: "lineage-cycle",
    }),
  ]);
  assert.equal(result.Lunes.rows[0].id, "cycle-exercise-1");
  assert.equal(result.Lunes.rows[0].sourceExerciseId, "cycle-exercise-1");
  assert.equal(result.Lunes.rows[0].exerciseLineageId, "lineage-cycle");
}

// Canonical dedupe key is placement: day/cycleDayId + routine + normalized name. First wins.
{
  const result = mapExercises([
    createExercise({
      id: "first",
      day: "Martes",
      routine: "Espalda",
      name: "Remo T",
      exerciseLineageId: "lineage-first",
    }),
    createExercise({
      id: "second",
      day: "Martes",
      routine: "Espalda",
      name: " remo t ",
      exerciseLineageId: "lineage-second",
    }),
  ]);
  assert.deepEqual(result.Martes.rows.map((row) => row.id), ["first"]);
  assert.equal(result.Martes.rows[0].exerciseLineageId, "lineage-first");
}

// Same visible name is legitimate across different routines or cycleDayIds.
{
  const differentRoutines = mapExercises([
    createExercise({ id: "same-name-a", routine: "Rutina A", name: "Press" }),
    createExercise({ id: "same-name-b", routine: "Rutina B", name: "Press" }),
  ]);
  assert.deepEqual(
    differentRoutines.Lunes.rows.map((row) => row.id),
    ["same-name-a", "same-name-b"],
  );

  const differentCycleDays = mapExercises([
    createExercise({ id: "week-1", cycleDayId: "cycle-day-1", name: "Press" }),
    createExercise({ id: "week-2", cycleDayId: "cycle-day-2", name: "Press" }),
  ]);
  assert.deepEqual(differentCycleDays.Lunes.rows.map((row) => row.id), ["week-1", "week-2"]);
}

// Productive dedupe does not resolve an ID collision across distinct placement keys.
{
  const result = mapExercises([
    createExercise({ id: "conflicting-id", name: "Press" }),
    createExercise({ id: "conflicting-id", name: "Remo" }),
  ]);
  assert.deepEqual(
    result.Lunes.rows.map((row) => row.id),
    ["conflicting-id", "conflicting-id"],
  );
  assert.deepEqual(result.Lunes.rows.map((row) => row.name), ["Press", "Remo"]);
}

// A non-empty seed day is retained before appending mapped exercises, matching current behavior.
{
  const initial = createInitialSetupByDay();
  initial.Lunes.rows[0] = {
    id: "existing-row",
    name: "Fila existente",
    sets: 1,
    reps: 1,
    weight: "5",
  };
  const result = mapExercises([createExercise({ id: "mapped-row" })], initial);
  assert.equal(result.Lunes.rows.length, 5);
  assert.equal(result.Lunes.rows[0].id, "existing-row");
  assert.equal(result.Lunes.rows[4].id, "mapped-row");
}

// Inputs are not mutated, outputs are independent, and repeated calls are deterministic.
{
  const initial = createInitialSetupByDay();
  const exercises = [createExercise({ id: "immutable", day: "Sábado", name: "Peso muerto" })];
  const initialSnapshot = JSON.parse(JSON.stringify(initial)) as Record<string, SetupDayState>;
  const exerciseSnapshot = exercises.map((exercise) => ({ ...exercise }));
  const first = mapExercises(exercises, initial);
  const second = mapExercises(exercises, initial);

  assert.deepEqual(initial, initialSnapshot);
  assert.deepEqual(exercises, exerciseSnapshot);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first["Sábado"].rows, second["Sábado"].rows);

  first["Sábado"].rows[0].name = "Mutado solo en output";
  assert.equal(second["Sábado"].rows[0].name, "Peso muerto");
  assert.deepEqual(initial, initialSnapshot);
  assert.deepEqual(exercises, exerciseSnapshot);
}

// Static purity contract: no ID generation, effects, infrastructure or duplicate dedupe logic.
assert.match(
  mappingSource,
  /import \{ dedupeExercisesByDayAndRoutine \} from "@\/lib\/training\/training-exercise-selection";/,
);
assert.doesNotMatch(mappingSource, /function\s+dedupeExercisesByDayAndRoutine\b/);
assert.doesNotMatch(mappingSource, /\b(?:Date\.now|Math\.random|crypto\.randomUUID)\s*\(/);
assert.doesNotMatch(mappingSource, /\b(?:window|document|localStorage|sessionStorage)\b/);
assert.doesNotMatch(
  mappingSource,
  /from ["'][^"']*(?:react|repository|supabase|storage|navigation|organizatech-app)[^"']*["']/i,
);

const packageJson = JSON.parse(packageSource) as { scripts: { test: string } };
const deferredTestCommand = "tsx src/features/routine-builder/model/routine-builder-exercise-mapping.test.ts";
assert.equal(packageJson.scripts.test.split(" && ").length, 114);
assert.equal(
  packageJson.scripts.test.split(" && ").filter((command) => command === deferredTestCommand).length,
  0,
  "P3-23A no registra el test; P3-23B lo integrara exactamente una vez",
);

console.log("routine-builder exercise mapping tests passed");
