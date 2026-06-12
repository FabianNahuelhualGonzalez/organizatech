import assert from "node:assert/strict";
import type { ExerciseEntry } from "@/lib/progress/types";
import type { CycleScopedExercise } from "./cycle-scoped-training-repository";
import {
  analyzeCycleScopedDayEdit,
  createCycleScopedDayNotes,
  getCycleScopedDayCoverage,
  getCycleScopedDayCodesToAdd,
  getCycleScopedDayRoutineName,
} from "./cycle-scoped-plan-edit";

const existingExercises = [
  createExercise("registered", "Gemelos hack"),
] satisfies CycleScopedExercise[];
const existingEntries = [
  createEntry("entry-1", "registered"),
] satisfies ExerciseEntry[];
const sessionsBefore = [{ id: "session-1", status: "completed" }];
const entriesBefore = structuredClone(existingEntries);

const edit = analyzeCycleScopedDayEdit(
  existingExercises,
  [
    { sourceExerciseId: "registered", name: "Gemelos hack", sets: 3, reps: 10, weight: 20 },
    { name: "Prensa", sets: 4, reps: 12, weight: 40 },
    { name: "Soleo", sets: 3, reps: 15, weight: 15 },
    { name: "Pantorrilla sentado", sets: 3, reps: 12, weight: 25 },
    { name: " prensa ", sets: 4, reps: 12, weight: 40 },
  ],
  new Set(["registered"]),
);

assert.deepEqual(
  edit.additions,
  [
    { name: "Prensa", targetSets: 4, targetReps: 12, baseWeight: 40 },
    { name: "Soleo", targetSets: 3, targetReps: 15, baseWeight: 15 },
    { name: "Pantorrilla sentado", targetSets: 3, targetReps: 12, baseWeight: 25 },
  ],
  "agrega solo los ejercicios nuevos al dia cycle-scoped",
);
assert.deepEqual(edit.duplicateNames, ["prensa"], "no duplica ejercicios por nombre normalizado y dia");
assert.deepEqual(edit.removedExerciseIds, [], "mantiene el ejercicio ya registrado");
assert.deepEqual(edit.modifiedExerciseIds, [], "no modifica el ejercicio existente");

const coverage = getCycleScopedDayCoverage(
  [
    ...existingExercises,
    createExercise("pending-1", "Prensa"),
    createExercise("pending-2", "Soleo"),
    createExercise("pending-3", "Pantorrilla sentado"),
  ],
  existingEntries,
);
assert.equal(coverage.status, "partial", "un ejercicio nuevo pendiente quita el estado Completado");
assert.equal(coverage.registeredCount, 1, "el ejercicio previo sigue Registrado");
assert.equal(coverage.plannedCount, 4, "los ejercicios nuevos aumentan el total planificado");
assert.deepEqual(sessionsBefore, [{ id: "session-1", status: "completed" }], "no modifica sesiones existentes");
assert.deepEqual(existingEntries, entriesBefore, "no modifica entries existentes");

const removal = analyzeCycleScopedDayEdit(existingExercises, [], new Set(["registered"]));
assert.deepEqual(
  removal.removedRegisteredExerciseIds,
  ["registered"],
  "detecta y bloquea la eliminacion de un ejercicio con entry asociada",
);

assert.equal(
  getCycleScopedDayCoverage(existingExercises, existingEntries).status,
  "completed",
  "el dia queda Completado cuando todos los planificados tienen entry",
);
assert.equal(
  getCycleScopedDayCoverage(existingExercises, []).status,
  "pending",
  "el dia queda Pendiente cuando ningun ejercicio tiene entry",
);

assert.deepEqual(
  getCycleScopedDayCodesToAdd(
    ["monday"],
    ["friday", "monday", "wednesday", "tuesday", "thursday"],
  ),
  ["tuesday", "wednesday", "thursday", "friday"],
  "detecta solo dias faltantes y los devuelve en orden semanal",
);
assert.deepEqual(
  getCycleScopedDayCodesToAdd(
    ["monday", "tuesday"],
    ["tuesday", "monday", "tuesday"],
  ),
  [],
  "no duplica dias existentes ni repetidos en la seleccion",
);

const newDayNotes = createCycleScopedDayNotes("Espalda biceps");
assert.equal(
  getCycleScopedDayRoutineName(newDayNotes, "Rutina existente"),
  "Espalda biceps",
  "conserva el nombre visible de la rutina para un dia nuevo",
);
assert.equal(
  getCycleScopedDayRoutineName("nota legacy", "Rutina existente"),
  "Rutina existente",
  "mantiene compatibilidad con notas existentes",
);

console.log("Pruebas de edicion de plan cycle-scoped OK");

function createExercise(id: string, name: string): CycleScopedExercise {
  return {
    id,
    cycleId: "cycle-2",
    dayId: "day-1",
    name,
    targetSets: 3,
    targetReps: 10,
    baseWeight: 20,
    sideWeight: null,
    sortOrder: 0,
    notes: null,
    sourceLegacyExerciseId: null,
  };
}

function createEntry(id: string, trainingCycleExerciseId: string): ExerciseEntry {
  return {
    id,
    sessionId: "session-1",
    cycleId: "cycle-2",
    cycleDayId: "day-1",
    trainingCycleExerciseId,
    exerciseId: trainingCycleExerciseId,
    exerciseName: "Gemelos hack",
    routine: "Lunes",
    week: 1,
    date: "2026-06-12",
    targetSets: 3,
    targetReps: 10,
    weight: 20,
    previousWeight: 20,
    reps: [10, 10, 10],
  };
}
