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
  type RoutineBuilderExerciseMappingResult,
  type RoutineBuilderExercisePlacementInput,
  type RoutineBuilderExistingRowsPolicy,
  type RoutineBuilderUnknownDayPolicy,
} from "./routine-builder-exercise-mapping";

type TrainingDayLabel = (typeof TRAINING_DAY_LABELS)[number];

const mappingSource = readFileSync(
  "src/features/routine-builder/model/routine-builder-exercise-mapping.ts",
  "utf8",
);
const mappingCode = mappingSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
const packageSource = readFileSync("package.json", "utf8");

function createBlankRow(id: string): SetupExerciseRow {
  return { id, name: "", sets: 0, reps: 0, weight: "" };
}

function createInitialSetupByDay(): Record<TrainingDayLabel, SetupDayState> {
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
  ) as Record<TrainingDayLabel, SetupDayState>;
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

function createPlacement(
  visualRowId: string | null | undefined,
  exerciseOverrides: Partial<ExerciseTemplate> = {},
): RoutineBuilderExercisePlacementInput {
  return { visualRowId, exercise: createExercise(exerciseOverrides) };
}

function mapPlacements(
  placements: readonly RoutineBuilderExercisePlacementInput[],
  options: {
    initialSetupByDay?: Record<TrainingDayLabel, SetupDayState>;
    unknownDayPolicy?: RoutineBuilderUnknownDayPolicy;
    existingRowsPolicy?: RoutineBuilderExistingRowsPolicy;
  } = {},
) {
  return createSetupByDayFromExercises({
    placements,
    initialSetupByDay: options.initialSetupByDay ?? createInitialSetupByDay(),
    unknownDayPolicy: options.unknownDayPolicy ?? "fallback_to_monday",
    existingRowsPolicy: options.existingRowsPolicy ?? "append",
  });
}

function expectReady(result: RoutineBuilderExerciseMappingResult) {
  if (result.kind !== "ready") assert.fail(`se esperaba ready, se recibio ${result.reason}`);
  return result.setupByDay;
}

function expectBlocked<Reason extends Extract<
  RoutineBuilderExerciseMappingResult,
  { kind: "blocked" }
>["reason"]>(
  result: RoutineBuilderExerciseMappingResult,
  reason: Reason,
): Extract<RoutineBuilderExerciseMappingResult, { kind: "blocked"; reason: Reason }> {
  assert.equal(result.kind, "blocked");
  if (result.kind !== "blocked") assert.fail("se esperaba un resultado bloqueado");
  assert.equal(result.reason, reason);
  return result as Extract<RoutineBuilderExerciseMappingResult, {
    kind: "blocked";
    reason: Reason;
  }>;
}

// Empty input preserves the externally allocated placeholders through an independent clone.
{
  const initial = createInitialSetupByDay();
  const setupByDay = expectReady(mapPlacements([], { initialSetupByDay: initial }));
  assert.deepEqual(setupByDay, initial);
  assert.notStrictEqual(setupByDay, initial);
  for (const day of TRAINING_DAY_LABELS) {
    assert.notStrictEqual(setupByDay[day], initial[day]);
    assert.notStrictEqual(setupByDay[day].rows, initial[day].rows);
    assert.notStrictEqual(setupByDay[day].rows[0], initial[day].rows[0]);
  }
  assert.notStrictEqual(setupByDay.Lunes.rows, setupByDay.Martes.rows);
}

// Visual identity is external and distinct from the persisted source exercise identity.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-press", {
      id: "source-press",
      day: "Martes",
      routine: "Pecho",
      name: "Press inclinado",
      targetSets: 3,
      targetReps: 10,
      baseWeight: 12.5,
      exerciseLineageId: "lineage-press",
    }),
  ]));
  assert.deepEqual(setupByDay.Martes.rows, [{
    id: "visual-press",
    sourceExerciseId: "source-press",
    exerciseLineageId: "lineage-press",
    name: "Press inclinado",
    sets: 3,
    reps: 10,
    weight: "12,5",
  }]);
  assert.notEqual(setupByDay.Martes.rows[0].id, setupByDay.Martes.rows[0].sourceExerciseId);
}

// Missing, empty and whitespace-only visual IDs block without returning partial setup state.
for (const [visualRowId, label] of [
  [undefined, "ausente"],
  [null, "null"],
  ["", "vacio"],
  ["   ", "solo espacios"],
] as const) {
  const blocked = expectBlocked(
    mapPlacements([createPlacement(visualRowId, { id: `source-${label}` })]),
    "missing_visual_row_id",
  );
  assert.deepEqual(blocked.location, {
    source: "placement",
    placementIndex: 0,
    exerciseId: `source-${label}`,
  });
  assert.equal("setupByDay" in blocked, false);
}

// The same source ID survives twice when the canonical placement keys are different.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-a", { id: "same-source", name: "Press" }),
    createPlacement("visual-b", { id: "same-source", name: "Remo" }),
  ]));
  assert.deepEqual(setupByDay.Lunes.rows.map((row) => row.id), ["visual-a", "visual-b"]);
  assert.deepEqual(
    setupByDay.Lunes.rows.map((row) => row.sourceExerciseId),
    ["same-source", "same-source"],
  );
}

// A discarded canonical duplicate cannot block its valid winner with an empty visual ID.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-winner", { id: "first-source", name: "Remo" }),
    createPlacement("", { id: "discarded-source", name: " remo " }),
  ]));
  assert.deepEqual(setupByDay.Lunes.rows.map((row) => row.id), ["visual-winner"]);
  assert.equal(setupByDay.Lunes.rows[0].sourceExerciseId, "first-source");
}

// A duplicate visual ID on a discarded placement is irrelevant to final identity.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("shared-visual", { id: "first-source", name: "Remo" }),
    createPlacement("shared-visual", { id: "discarded-source", name: " remo " }),
  ]));
  assert.deepEqual(setupByDay.Lunes.rows.map((row) => row.id), ["shared-visual"]);
  assert.equal(setupByDay.Lunes.rows[0].sourceExerciseId, "first-source");
}

// A discarded duplicate with an unknown day cannot block under reject.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-winner", {
      id: "first-source",
      day: "Martes",
      cycleDayId: "shared-cycle-day",
      routine: "Espalda",
      name: "Remo",
    }),
    createPlacement("visual-discarded", {
      id: "discarded-source",
      day: "Funday",
      cycleDayId: "shared-cycle-day",
      routine: " espalda ",
      name: " remo ",
    }),
  ], { unknownDayPolicy: "reject" }));
  assert.deepEqual(setupByDay.Martes.rows.map((row) => row.id), ["visual-winner"]);
  assert.equal(setupByDay.Martes.rows[0].sourceExerciseId, "first-source");
}

// The first canonical winner still blocks when its own visual ID is invalid.
{
  const blocked = expectBlocked(mapPlacements([
    createPlacement(undefined, { id: "invalid-winner", name: "Remo" }),
    createPlacement("valid-discarded", { id: "valid-discarded", name: " remo " }),
  ]), "missing_visual_row_id");
  assert.deepEqual(blocked.location, {
    source: "placement",
    placementIndex: 0,
    exerciseId: "invalid-winner",
  });
  assert.equal("setupByDay" in blocked, false);
}

// Two effective winners with the same visual ID remain globally ambiguous and block.
{
  const blocked = expectBlocked(mapPlacements([
    createPlacement("duplicate-visual", { id: "first-source", name: "Remo" }),
    createPlacement("duplicate-visual", { id: "second-source", name: "Press" }),
  ]), "duplicate_visual_row_id");
  assert.equal(blocked.visualRowId, "duplicate-visual");
  assert.deepEqual(blocked.locations, [
    { source: "placement", placementIndex: 0, exerciseId: "first-source" },
    { source: "placement", placementIndex: 1, exerciseId: "second-source" },
  ]);
  assert.equal("setupByDay" in blocked, false);
}

// The same source ID and canonical key dedupe to the first visual placement only.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-first", { id: "same-source", name: "Remo" }),
    createPlacement("visual-second", { id: "same-source", name: " remo " }),
  ]));
  assert.deepEqual(setupByDay.Lunes.rows.map((row) => row.id), ["visual-first"]);
  assert.equal(setupByDay.Lunes.rows[0].sourceExerciseId, "same-source");
}

// Dedupe keeps the visual ID, source identity and lineage from the first placement winner.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-first", {
      id: "source-first",
      day: "Martes",
      routine: "Espalda",
      name: "Remo T",
      exerciseLineageId: "lineage-first",
    }),
    createPlacement("visual-second", {
      id: "source-second",
      day: "Martes",
      routine: "Espalda",
      name: " remo t ",
      exerciseLineageId: "lineage-second",
    }),
  ]));
  assert.deepEqual(setupByDay.Martes.rows.map((row) => row.id), ["visual-first"]);
  assert.equal(setupByDay.Martes.rows[0].sourceExerciseId, "source-first");
  assert.equal(setupByDay.Martes.rows[0].exerciseLineageId, "lineage-first");
}

// Explicit fallback retains productive behavior without aliases or case normalization.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("missing-day", { id: "source-a", day: undefined, name: "A" }),
    createPlacement("unknown-day", { id: "source-b", day: "Funday", name: "B" }),
    createPlacement("lowercase-day", { id: "source-c", day: "martes", name: "C" }),
    createPlacement("empty-day", { id: "source-d", day: "", name: "D" }),
  ], { unknownDayPolicy: "fallback_to_monday" }));
  assert.deepEqual(
    setupByDay.Lunes.rows.map((row) => row.id),
    ["missing-day", "unknown-day", "lowercase-day", "empty-day"],
  );
}

// Explicit reject reports every affected placement; cycleDayId never substitutes the visual day.
{
  const blocked = expectBlocked(mapPlacements([
    createPlacement("known", { id: "known", day: "Lunes" }),
    createPlacement("missing", { id: "missing", day: undefined, cycleDayId: "cycle-day-1" }),
    createPlacement("unknown", { id: "unknown", day: "Monday" }),
  ], { unknownDayPolicy: "reject" }), "unknown_day");
  assert.deepEqual(blocked.placements, [
    { placementIndex: 1, exerciseId: "missing", day: undefined },
    { placementIndex: 2, exerciseId: "unknown", day: "Monday" },
  ]);
  assert.equal("setupByDay" in blocked, false);
}

// A day without its canonical accent is unknown under both explicit policies.
{
  const fallback = expectReady(mapPlacements([
    createPlacement("miercoles-fallback", {
      id: "source-miercoles-fallback",
      day: "Miercoles",
    }),
  ], { unknownDayPolicy: "fallback_to_monday" }));
  assert.deepEqual(fallback.Lunes.rows.map((row) => row.id), ["miercoles-fallback"]);

  const blocked = expectBlocked(mapPlacements([
    createPlacement("miercoles-reject", {
      id: "source-miercoles-reject",
      day: "Miercoles",
    }),
  ], { unknownDayPolicy: "reject" }), "unknown_day");
  assert.deepEqual(blocked.placements, [{
    placementIndex: 0,
    exerciseId: "source-miercoles-reject",
    day: "Miercoles",
  }]);
  assert.equal("setupByDay" in blocked, false);
}

// Both policies are mandatory in the public API; there is no implicit module default.
if (false) {
  // @ts-expect-error unknownDayPolicy es obligatoria
  createSetupByDayFromExercises({
    placements: [],
    initialSetupByDay: createInitialSetupByDay(),
    existingRowsPolicy: "append",
  });
  // @ts-expect-error existingRowsPolicy es obligatoria
  createSetupByDayFromExercises({
    placements: [],
    initialSetupByDay: createInitialSetupByDay(),
    unknownDayPolicy: "reject",
  });
}

// Placeholder seed rows are replaced; their IDs do not collide with mapped visual IDs.
{
  const initial = createInitialSetupByDay();
  initial.Lunes.rows[0].id = "visual-row";
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-row", { id: "source-row" }),
  ], { initialSetupByDay: initial, existingRowsPolicy: "reject_non_empty" }));
  assert.deepEqual(setupByDay.Lunes.rows.map((row) => row.id), ["visual-row"]);
  assert.equal(setupByDay.Lunes.rows[0].sourceExerciseId, "source-row");
}

// A non-empty seed blocks under reject_non_empty, with every affected canonical day.
{
  const initial = createInitialSetupByDay();
  initial.Lunes.rows[0] = {
    id: "existing-lunes",
    name: "Fila existente",
    sets: 1,
    reps: 1,
    weight: "5",
  };
  initial.Martes.rows[1] = {
    id: "existing-martes",
    name: "Otra fila",
    sets: 2,
    reps: 2,
    weight: "10",
  };
  const blocked = expectBlocked(mapPlacements([
    createPlacement("mapped", { id: "mapped-source" }),
  ], { initialSetupByDay: initial, existingRowsPolicy: "reject_non_empty" }), "non_empty_seed");
  assert.deepEqual(blocked.days, ["Lunes", "Martes"]);
}

// append explicitly preserves existing rows before adding mapped rows; no name-based seed dedupe.
{
  const initial = createInitialSetupByDay();
  initial.Lunes.rows[0] = {
    id: "existing-row",
    name: "Press banca",
    sets: 1,
    reps: 1,
    weight: "5",
  };
  const setupByDay = expectReady(mapPlacements([
    createPlacement("mapped-row", { id: "mapped-source", name: "Press banca" }),
  ], { initialSetupByDay: initial, existingRowsPolicy: "append" }));
  assert.equal(setupByDay.Lunes.rows.length, 5);
  assert.equal(setupByDay.Lunes.rows[0].id, "existing-row");
  assert.equal(setupByDay.Lunes.rows[4].id, "mapped-row");
}

// Final output identity also validates retained seed rows and seed/placement collisions.
{
  const emptyIdSeed = createInitialSetupByDay();
  emptyIdSeed.Martes.rows[0].id = "";
  const missing = expectBlocked(mapPlacements([], {
    initialSetupByDay: emptyIdSeed,
  }), "missing_visual_row_id");
  assert.deepEqual(missing.location, { source: "seed", day: "Martes", rowIndex: 0 });

  const duplicateSeed = createInitialSetupByDay();
  duplicateSeed.Martes.rows[0].id = duplicateSeed.Lunes.rows[0].id;
  const duplicate = expectBlocked(mapPlacements([], {
    initialSetupByDay: duplicateSeed,
  }), "duplicate_visual_row_id");
  assert.equal(duplicate.visualRowId, "seed-0-0");

  const seedPlacementCollision = createInitialSetupByDay();
  seedPlacementCollision.Lunes.rows[0] = {
    id: "shared-visual",
    name: "Seed real",
    sets: 1,
    reps: 1,
    weight: "1",
  };
  const collision = expectBlocked(mapPlacements([
    createPlacement("shared-visual", { id: "mapped-source" }),
  ], {
    initialSetupByDay: seedPlacementCollision,
    existingRowsPolicy: "append",
  }), "duplicate_visual_row_id");
  assert.equal(collision.visualRowId, "shared-visual");
}

// Rows keep canonical day order and stable input order; homonyms survive across real placements.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("martes-a", { id: "source-a", day: "Martes", routine: "Rutina A", name: "Remo" }),
    createPlacement("lunes", { id: "source-l", day: "Lunes", name: "Sentadilla" }),
    createPlacement("martes-b", { id: "source-b", day: "Martes", routine: "Rutina B", name: "Remo" }),
    createPlacement("week-2", { id: "source-w2", day: "Martes", cycleDayId: "cycle-day-2", routine: "Rutina A", name: "Remo" }),
  ]));
  assert.deepEqual(Object.keys(setupByDay), [...TRAINING_DAY_LABELS]);
  assert.deepEqual(
    setupByDay.Martes.rows.map((row) => row.id),
    ["martes-a", "martes-b", "week-2"],
  );
  assert.equal(setupByDay.Martes.routineName, "Rutina A");
}

// The first non-empty routine labels the day; all-empty routines fall back to the resolved day.
{
  const firstNonEmpty = expectReady(mapPlacements([
    createPlacement("empty-routine", { id: "source-empty", day: "Viernes", routine: "", name: "A" }),
    createPlacement("named-routine", { id: "source-named", day: "Viernes", routine: "Piernas", name: "B" }),
  ]));
  assert.equal(firstNonEmpty.Viernes.routineName, "Piernas");

  const allEmpty = expectReady(mapPlacements([
    createPlacement("empty-only", { id: "source-only", day: "Jueves", routine: "" }),
  ]));
  assert.equal(allEmpty.Jueves.routineName, "Jueves");
}

// Lineage string/null/undefined remains exactly as resolved upstream.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("lineage-value", { id: "source-1", name: "A", exerciseLineageId: "lineage-1" }),
    createPlacement("lineage-null", { id: "source-2", name: "B", exerciseLineageId: null }),
    createPlacement("lineage-undefined", { id: "source-3", name: "C", exerciseLineageId: undefined }),
  ]));
  assert.deepEqual(
    setupByDay.Lunes.rows.map((row) => row.exerciseLineageId),
    ["lineage-1", null, undefined],
  );
}

// Legacy lineage is resolved upstream by exact source ID, never by name.
{
  const [legacy] = hydrateLegacyExerciseTemplatesWithLineage(
    [createExercise({ id: "legacy-1", name: "Press legacy" })],
    [{ id: "lineage-legacy", source_legacy_exercise_id: "legacy-1" }],
  );
  const setupByDay = expectReady(mapPlacements([
    { visualRowId: "visual-legacy", exercise: legacy },
  ]));
  assert.equal(setupByDay.Lunes.rows[0].id, "visual-legacy");
  assert.equal(setupByDay.Lunes.rows[0].sourceExerciseId, "legacy-1");
  assert.equal(setupByDay.Lunes.rows[0].exerciseLineageId, "lineage-legacy");
}

// Cycle-scoped source identity is the cycle exercise ID, never sourceLegacyExerciseId.
{
  const setupByDay = expectReady(mapPlacements([
    createPlacement("visual-cycle", {
      id: "cycle-exercise-1",
      cycleId: "cycle-1",
      cycleDayId: "cycle-day-1",
      trainingCycleExerciseId: "cycle-exercise-1",
      sourceLegacyExerciseId: "legacy-1",
      exerciseLineageId: "lineage-cycle",
    }),
  ]));
  assert.equal(setupByDay.Lunes.rows[0].sourceExerciseId, "cycle-exercise-1");
  assert.equal(setupByDay.Lunes.rows[0].exerciseLineageId, "lineage-cycle");
}

// Inputs stay untouched; outputs and calls are independent and deterministic by value.
{
  const initial = createInitialSetupByDay();
  const exercise = createExercise({ id: "immutable-source", day: "Sábado", name: "Peso muerto" });
  const placements = [{ visualRowId: "immutable-visual", exercise }];
  const initialSnapshot = JSON.parse(JSON.stringify(initial)) as Record<TrainingDayLabel, SetupDayState>;
  const placementSnapshot = placements.map((placement) => ({
    ...placement,
    exercise: { ...placement.exercise },
  }));
  const first = expectReady(mapPlacements(placements, { initialSetupByDay: initial }));
  const second = expectReady(mapPlacements(placements, { initialSetupByDay: initial }));

  assert.deepEqual(initial, initialSnapshot);
  assert.deepEqual(placements, placementSnapshot);
  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first["Sábado"].rows, second["Sábado"].rows);
  first["Sábado"].rows[0].name = "Mutado solo en output";
  assert.equal(second["Sábado"].rows[0].name, "Peso muerto");
  assert.deepEqual(initial, initialSnapshot);
  assert.deepEqual(placements, placementSnapshot);
}

// Exhaustive consumer contract for the discriminated result.
function describeResult(result: RoutineBuilderExerciseMappingResult): string {
  if (result.kind === "ready") return `ready:${Object.keys(result.setupByDay).length}`;
  switch (result.reason) {
    case "missing_visual_row_id":
      return `missing:${result.location.source}`;
    case "duplicate_visual_row_id":
      return `duplicate:${result.visualRowId}`;
    case "unknown_day":
      return `unknown:${result.placements.length}`;
    case "non_empty_seed":
      return `seed:${result.days.length}`;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}
assert.equal(describeResult(mapPlacements([])), "ready:7");
assert.equal(
  describeResult(mapPlacements([createPlacement(undefined)])),
  "missing:placement",
);

// Static purity and phase boundaries: canonical dedupe only, no generated identity or effects.
assert.match(
  mappingCode,
  /import \{ dedupeExercisesByDayAndRoutine \} from "@\/lib\/training\/training-exercise-selection";/,
);
assert.doesNotMatch(mappingCode, /function\s+dedupeExercisesByDayAndRoutine\b/);
assert.doesNotMatch(mappingCode, /\b(?:Date\.now|Math\.random|crypto\.randomUUID)\s*\(/);
assert.doesNotMatch(mappingCode, /\bid:\s*placement\.exercise\.id\b/);
assert.match(mappingCode, /id: placement\.visualRowId/);
assert.match(mappingCode, /sourceExerciseId: placement\.exercise\.id/);
assert.ok(
  mappingCode.indexOf("const winningPlacements = dedupePlacements(placements);")
    < mappingCode.indexOf("for (const placement of winningPlacements)"),
  "el dedupe canonico debe definir los placements efectivos antes de validarlos",
);
for (const forbidden of [
  /from ["']react["']/,
  /from ["'][^"']*(?:repository|supabase|storage|navigation|organizatech-app)[^"']*["']/i,
  /\b(?:window|document|localStorage|sessionStorage)\b/,
  /\b(?:saveInitialRoutine|SyntheticEvent|useReducer|setState)\b/,
]) {
  assert.doesNotMatch(mappingCode, forbidden);
}

const packageJson = JSON.parse(packageSource) as { scripts: { test: string } };
const mappingTestCommand = "tsx src/features/routine-builder/model/routine-builder-exercise-mapping.test.ts";
const testCommands = packageJson.scripts.test.split(" && ");
assert.equal(testCommands.length, 127);
assert.equal(testCommands.filter((command) => command === mappingTestCommand).length, 1);

console.log("routine-builder exercise mapping tests passed");
