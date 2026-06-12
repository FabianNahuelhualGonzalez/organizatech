import assert from "node:assert/strict";
import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  dedupeExerciseRowsByName,
  dedupeExercisesByDayAndRoutine,
  getExercisesForTrainingDay,
  getRemovedExerciseIds,
} from "./training-exercise-selection";

const exercises: ExerciseTemplate[] = [
  createExercise("remo-1", "Martes", "Espalda", "Remo T"),
  createExercise("press-1", "Lunes", "Pecho", "Press banca"),
  createExercise("remo-duplicate", "Martes", "Espalda", " remo t "),
  createExercise("curl-1", "Martes", "Espalda", "Curl"),
];

assert.deepEqual(
  dedupeExercisesByDayAndRoutine(exercises).map((exercise) => exercise.id),
  ["remo-1", "press-1", "curl-1"],
  "deduplica por dia, rutina y nombre conservando el ID original",
);

assert.deepEqual(
  getExercisesForTrainingDay(exercises, "Martes").map((exercise) => exercise.id),
  ["remo-1", "curl-1"],
  "el historial de Martes no mezcla ejercicios de otros dias ni duplicados",
);

assert.deepEqual(
  dedupeExerciseRowsByName([
    { id: "1", name: "Remo T" },
    { id: "2", name: " remo t " },
    { id: "3", name: "Curl" },
  ]).map((row) => row.id),
  ["1", "3"],
  "el guardado no inserta dos veces el mismo nombre en una rutina",
);

assert.deepEqual(
  getRemovedExerciseIds(exercises, "Martes", new Set(["remo-1", "curl-1"])),
  ["remo-duplicate"],
  "elimina por ID solo los ejercicios omitidos del dia editado",
);

assert.deepEqual(
  getRemovedExerciseIds(
    [createExercise("legacy-no-day", undefined, "Pecho", "Fondos")],
    "Martes",
    new Set(),
  ),
  [],
  "un ejercicio legacy sin day pertenece a Lunes y no se elimina desde otro dia",
);

console.log("Pruebas de seleccion de ejercicios OK");

function createExercise(
  id: string,
  day: string | undefined,
  routine: string,
  name: string,
): ExerciseTemplate {
  return {
    id,
    day,
    routine,
    name,
    targetSets: 3,
    targetReps: 10,
    baseWeight: 20,
  };
}
