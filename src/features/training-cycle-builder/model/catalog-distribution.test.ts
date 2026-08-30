import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXERCISE_CATALOG,
  addExerciseToCatalog,
  buildExerciseCatalog,
  createCustomExercise,
  exerciseSourceForCatalogEntry,
  findCatalogExerciseByTerm,
  isSupportedYouTubeUrl,
  normalizeCatalogTerm,
  searchExerciseCatalog,
  type CatalogExercise,
} from "./catalog";
import { calculateMuscleDistribution } from "./distribution";
import { createFixtureDay, createFixtureDraft, createFixtureExercise, createFixtureSet } from "./test-fixtures";

test("catálogo normaliza mayúsculas, acentos, signos y espacios", () => {
  assert.equal(normalizeCatalogTerm("  Extensión   de TRÍCEPS — polea "), "extension de triceps polea");
  const press = findCatalogExerciseByTerm(DEFAULT_EXERCISE_CATALOG, "PRESS BÁNCA");
  assert.equal(press?.id, "press-flat-barbell");
  assert.equal(findCatalogExerciseByTerm(DEFAULT_EXERCISE_CATALOG, "bench press")?.id, "press-flat-barbell");
  assert.equal(findCatalogExerciseByTerm(DEFAULT_EXERCISE_CATALOG, "inexistente"), null);
});

test("búsqueda prioriza coincidencia exacta y aliases de forma determinista", () => {
  const exact = searchExerciseCatalog(DEFAULT_EXERCISE_CATALOG, "RDL");
  assert.equal(exact[0]?.id, "romanian-deadlift");
  const partial = searchExerciseCatalog(DEFAULT_EXERCISE_CATALOG, "press", 3);
  assert.equal(partial.length, 3);
  assert.ok(partial.every((entry) => normalizeCatalogTerm(
    [entry.canonicalName, ...entry.aliases].join(" "),
  ).includes("press")));
  assert.deepEqual(
    searchExerciseCatalog(DEFAULT_EXERCISE_CATALOG, "rumano").map((entry) => entry.id),
    ["romanian-deadlift"],
  );
});

test("construcción detecta IDs y términos ambiguos en lugar de resolverlos silenciosamente", () => {
  const first: CatalogExercise = {
    id: "a",
    canonicalName: "Press banca",
    primaryMuscleGroup: "chest",
    loadBasis: "external",
    aliases: [],
    source: "curated",
    videoUrl: null,
  };
  const second: CatalogExercise = {
    ...first,
    id: "b",
    canonicalName: "Press plano",
    aliases: ["PRESS BÁNCA"],
  };
  const collision = buildExerciseCatalog([first, second]);
  assert.equal(collision.valid, false);
  assert.ok(collision.issues.some((issue) => issue.code === "term_collision" && issue.existingId === "a"));

  const duplicateId = buildExerciseCatalog([first, { ...second, id: "a" }]);
  assert.ok(duplicateId.issues.some((issue) => issue.code === "duplicate_id"));
});

test("ejercicio personalizado exige identidad, nombre, grupo y URL YouTube segura", () => {
  const created = createCustomExercise({
    customExerciseId: "custom-1",
    name: "  Remo en punta   con barra ",
    primaryMuscleGroup: "back",
    aliases: ["Remo T"],
    videoUrl: "https://youtu.be/abc123",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.exercise.canonicalName, "Remo en punta con barra");
  assert.deepEqual(exerciseSourceForCatalogEntry(created.exercise), {
    kind: "custom",
    customExerciseId: "custom-1",
  });

  const empty = createCustomExercise({
    customExerciseId: "",
    name: "",
    primaryMuscleGroup: "back",
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.ok(empty.issues.some((issue) => issue.code === "empty_id"));
  }

  const invalidGroup = createCustomExercise({
    customExerciseId: "custom-2",
    name: "Ejercicio",
    primaryMuscleGroup: "unknown" as "back",
  });
  assert.equal(invalidGroup.ok, false);
  if (!invalidGroup.ok) assert.ok(invalidGroup.issues.some((issue) => issue.code === "invalid_muscle_group"));

  assert.equal(isSupportedYouTubeUrl("https://www.youtube.com/watch?v=abc"), true);
  assert.equal(isSupportedYouTubeUrl("https://youtube.com/shorts/abc"), true);
  assert.equal(isSupportedYouTubeUrl("http://youtu.be/abc"), false);
  assert.equal(isSupportedYouTubeUrl("https://example.com/watch?v=abc"), false);
});

test("agregar personalizado rechaza alias que colisiona con catálogo curado", () => {
  const created = createCustomExercise({
    customExerciseId: "custom-press",
    name: "Press personal",
    primaryMuscleGroup: "chest",
    aliases: ["Press banca"],
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const result = addExerciseToCatalog(DEFAULT_EXERCISE_CATALOG, created.exercise);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "term_collision"));
});

test("distribución cuenta sólo grupo principal y sólo días seleccionados", () => {
  const pressA = createFixtureExercise({
    id: "press-a",
    order: 1,
    sets: [createFixtureSet({ id: "set-a" })],
  });
  const pressB = createFixtureExercise({
    id: "press-b",
    name: "PRESS PLANO CON BARRA",
    order: 2,
    sets: [createFixtureSet({ id: "set-b" })],
  });
  const row = createFixtureExercise({
    id: "row",
    name: "Remo con barra",
    primaryMuscleGroup: "back",
    order: 3,
    source: { kind: "catalog", catalogExerciseId: "barbell-row" },
    sets: [createFixtureSet({ id: "set-c" })],
  });
  const retained = createFixtureDay({
    day: "saturday",
    exercises: [createFixtureExercise({
      id: "retained",
      primaryMuscleGroup: "glutes",
      sets: [createFixtureSet({ id: "retained-set" })],
    })],
  });
  const draft = createFixtureDraft({
    routines: {
      monday: createFixtureDay({ exercises: [pressA, pressB, row] }),
      saturday: retained,
    },
  });
  const distribution = calculateMuscleDistribution(draft);
  assert.deepEqual(distribution.week, [
    { muscleGroup: "chest", exerciseCount: 2 },
    { muscleGroup: "back", exerciseCount: 1 },
  ]);
  assert.equal(distribution.week.some((entry) => entry.muscleGroup === "glutes"), false);
  assert.ok(distribution.warnings.some((warning) => warning.code === "duplicate_exercise_in_day"));
  assert.ok(distribution.warnings.some((warning) => warning.code === "muscle_group_single_exercise" && warning.muscleGroup === "back"));
  assert.equal(distribution.balancedUnderCurrentRules, false);
});

test("día vacío es advertencia y una distribución sin advertencias queda equilibrada bajo reglas actuales", () => {
  const empty = calculateMuscleDistribution(createFixtureDraft({
    routines: { monday: createFixtureDay({ exercises: [] }) },
  }));
  assert.deepEqual(empty.warnings, [{ code: "empty_day", day: "monday" }]);

  const balanced = calculateMuscleDistribution(createFixtureDraft({
    routines: { monday: createFixtureDay({ exercises: [
      createFixtureExercise({ id: "a", name: "Press A", sets: [createFixtureSet({ id: "sa" })] }),
      createFixtureExercise({ id: "b", name: "Press B", order: 2, sets: [createFixtureSet({ id: "sb" })] }),
    ] }) },
  }));
  assert.equal(balanced.balancedUnderCurrentRules, true);
  assert.deepEqual(balanced.warnings, []);
});
