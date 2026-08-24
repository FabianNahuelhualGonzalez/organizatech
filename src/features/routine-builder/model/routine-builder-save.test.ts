import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { SetupExerciseRow } from "@/lib/training/training-routine-draft";
import {
  resolveRoutineBuilderSavePreparation,
  type RoutineBuilderSaveConfirmation,
  type RoutineBuilderSavePreparationResult,
  type RoutineBuilderSavePersistenceMode,
} from "./routine-builder-save";

const moduleSource = readFileSync(
  "src/features/routine-builder/model/routine-builder-save.ts",
  "utf8",
);
const moduleCode = moduleSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: { test: string };
};

function createRow(
  id: string,
  overrides: Partial<SetupExerciseRow> = {},
): SetupExerciseRow {
  return {
    id,
    name: `Ejercicio ${id}`,
    sets: 3,
    reps: 10,
    weight: "20",
    ...overrides,
  };
}

function prepare(
  rows: readonly SetupExerciseRow[],
  options: {
    persistenceMode?: RoutineBuilderSavePersistenceMode;
    allowEmptyRows?: boolean;
    requiresRoutineUpdateConfirmation?: boolean;
    confirmation?: RoutineBuilderSaveConfirmation;
  } = {},
) {
  return resolveRoutineBuilderSavePreparation({
    rows,
    persistenceMode: options.persistenceMode ?? "legacy",
    allowEmptyRows: options.allowEmptyRows ?? false,
    requiresRoutineUpdateConfirmation:
      options.requiresRoutineUpdateConfirmation ?? false,
    confirmation: options.confirmation ?? "unconfirmed",
  });
}

function expectReady(result: RoutineBuilderSavePreparationResult) {
  if (result.kind !== "ready") {
    assert.fail(`se esperaba ready, se recibio ${result.kind}`);
  }
  return result.rows;
}

function expectKind<Kind extends RoutineBuilderSavePreparationResult["kind"]>(
  result: RoutineBuilderSavePreparationResult,
  kind: Kind,
): Extract<RoutineBuilderSavePreparationResult, { kind: Kind }> {
  assert.equal(result.kind, kind);
  return result as Extract<RoutineBuilderSavePreparationResult, { kind: Kind }>;
}

// Empty names and whitespace-only names are not save candidates.
{
  const result = prepare([
    createRow("empty", { name: "" }),
    createRow("spaces", { name: "   " }),
  ]);
  assert.equal(result.kind, "no_exercises");
  assert.equal("rows" in result, false);
}

// Empty, integer, comma and point weights preserve the canonical parser behavior.
for (const weight of ["", "20", "20,5", "20.5"]) {
  const rows = expectReady(prepare([createRow(`weight-${weight}`, { weight })]));
  assert.equal(rows[0].weight, weight);
}

// Negative and textual weights are rejected with the trimmed exercise name.
for (const weight of ["-1", "peso"]) {
  const result = expectKind(
    prepare([createRow(`invalid-${weight}`, { name: "  Press banca  ", weight })]),
    "invalid_weight",
  );
  assert.equal(result.exerciseName, "Press banca");
  assert.equal("rows" in result, false);
}

// Weight validation happens before legacy dedupe, including a duplicate loser.
{
  const result = expectKind(prepare([
    createRow("winner", { name: "Remo", weight: "20" }),
    createRow("duplicate", { name: " remo ", weight: "invalido" }),
  ]), "invalid_weight");
  assert.equal(result.exerciseName, "remo");
}

// Legacy dedupe delegates to the canonical first-winner policy and keeps order.
{
  const rows = expectReady(prepare([
    createRow("first", {
      name: "Press banca",
      sourceExerciseId: "source-first",
      exerciseLineageId: "lineage-first",
    }),
    createRow("duplicate", {
      name: " press BANCA ",
      sourceExerciseId: "source-duplicate",
      exerciseLineageId: "lineage-duplicate",
    }),
    createRow("last", { name: "Remo" }),
  ]));
  assert.deepEqual(rows.map((row) => row.id), ["first", "last"]);
  assert.equal(rows[0].sourceExerciseId, "source-first");
  assert.equal(rows[0].exerciseLineageId, "lineage-first");
}

// Cycle-scoped mode keeps same-name rows for its downstream conflict analysis.
{
  const rows = expectReady(prepare([
    createRow("first", { name: "Press" }),
    createRow("second", { name: " press " }),
  ], { persistenceMode: "cycle_scoped" }));
  assert.deepEqual(rows.map((row) => row.id), ["first", "second"]);
}

// allowEmptyRows is explicit and maps to the legacy/cycle-scoped caller policy.
assert.equal(prepare([]).kind, "no_exercises");
assert.deepEqual(
  expectReady(prepare([], {
    persistenceMode: "cycle_scoped",
    allowEmptyRows: true,
  })),
  [],
);

// Confirmation is accepted only through the exact literal.
assert.equal(prepare([createRow("row")], {
  requiresRoutineUpdateConfirmation: true,
}).kind, "confirmation_required");
assert.equal(prepare([createRow("row")], {
  requiresRoutineUpdateConfirmation: true,
  confirmation: "confirmed_routine_update",
}).kind, "ready");
assert.equal(resolveRoutineBuilderSavePreparation({
  rows: [createRow("runtime")],
  persistenceMode: "legacy",
  allowEmptyRows: false,
  requiresRoutineUpdateConfirmation: true,
  confirmation: { type: "click" } as unknown as RoutineBuilderSaveConfirmation,
}).kind, "confirmation_required");

// Ready preserves all fields while cloning rows and remaining deterministic.
{
  const input = [createRow("complete", {
    sourceExerciseId: "source-complete",
    exerciseLineageId: null,
    name: "Sentadilla",
    sets: 4,
    reps: 8,
    weight: "32,5",
  })];
  const snapshot = input.map((row) => ({ ...row }));
  const first = expectReady(prepare(input));
  const second = expectReady(prepare(input));

  assert.deepEqual(input, snapshot);
  assert.deepEqual(first, input);
  assert.deepEqual(second, input);
  assert.notStrictEqual(first, input);
  assert.notStrictEqual(first[0], input[0]);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first[0], second[0]);
  first[0].name = "Mutado solo en output";
  assert.equal(input[0].name, "Sentadilla");
  assert.equal(second[0].name, "Sentadilla");
}

// Required caller decisions cannot be omitted from the typed API.
if (false) {
  // @ts-expect-error allowEmptyRows es obligatorio
  resolveRoutineBuilderSavePreparation({
    rows: [],
    persistenceMode: "legacy",
    requiresRoutineUpdateConfirmation: false,
    confirmation: "unconfirmed",
  });
  // @ts-expect-error confirmation es obligatoria
  resolveRoutineBuilderSavePreparation({
    rows: [],
    persistenceMode: "legacy",
    allowEmptyRows: false,
    requiresRoutineUpdateConfirmation: false,
  });
}

// Exhaustive result contract.
function describeResult(result: RoutineBuilderSavePreparationResult): string {
  switch (result.kind) {
    case "invalid_weight":
      return `invalid:${result.exerciseName}`;
    case "no_exercises":
      return "empty";
    case "confirmation_required":
      return "confirm";
    case "ready":
      return `ready:${result.rows.length}`;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}
assert.equal(describeResult(prepare([createRow("row")])), "ready:1");

// Static purity and phase boundaries.
assert.match(moduleCode, /parseDecimalWeightInput/);
assert.match(moduleCode, /dedupeExerciseRowsByName/);
assert.doesNotMatch(moduleCode, /\bNumber\s*\(/);
assert.doesNotMatch(moduleCode, /\b(?:Date\.now|Math\.random|crypto\.randomUUID)\s*\(/);
for (const forbidden of [
  /from ["']react["']/,
  /from ["'][^"']*(?:repository|supabase|storage|navigation|organizatech-app)[^"']*["']/i,
  /\b(?:window|document|localStorage|sessionStorage|setTimeout)\b/,
  /\b(?:saveInitialRoutine|saveExercise|deleteExercise|clearRoutineDraft|useReducer)\b/,
]) {
  assert.doesNotMatch(moduleCode, forbidden);
}

const testCommands = packageJson.scripts.test.split(" && ");
const registeredCommand =
  "tsx src/features/routine-builder/model/routine-builder-save.test.ts";
assert.equal(testCommands.length, 127);
assert.equal(testCommands.filter((command) => command === registeredCommand).length, 1);

console.log("routine-builder save preparation tests passed");
