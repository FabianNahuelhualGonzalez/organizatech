import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ExerciseEntry } from "@/lib/progress/types";
import type { CycleScopedExercise } from "./cycle-scoped-training-repository";
import {
  addFuturePlanRetiredMarker,
  analyzeCycleScopedDayEdit,
  createCycleScopedDayNotes,
  createCycleScopedRetiredExerciseNotes,
  futurePlanRetiredMarker,
  getCycleScopedExerciseDisplayNotes,
  getCycleScopedDayCoverage,
  getCycleScopedDayCodesToAdd,
  getCycleScopedDayRoutineName,
  hasFuturePlanRetiredMarker,
  isCycleScopedExerciseRetired,
  removeTechnicalMarkersForDisplay,
} from "./cycle-scoped-plan-edit";

const cycleScopedRepositorySource = readFileSync(
  "src/lib/training/cycle-scoped-training-repository.ts",
  "utf8",
);

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
    { name: "Prensa", targetSets: 4, targetReps: 12, baseWeight: 40, sortOrder: -1, notes: undefined },
    { name: "Soleo", targetSets: 3, targetReps: 15, baseWeight: 15, sortOrder: -1, notes: undefined },
    { name: "Pantorrilla sentado", targetSets: 3, targetReps: 12, baseWeight: 25, sortOrder: -1, notes: undefined },
  ],
  "agrega solo los ejercicios nuevos al dia cycle-scoped",
);
assert.deepEqual(edit.duplicateNames, ["prensa"], "no duplica ejercicios por nombre normalizado y dia");
assert.deepEqual(edit.removedExerciseIds, [], "mantiene el ejercicio ya registrado");
assert.deepEqual(edit.updates, [], "no modifica el ejercicio existente sin cambios");
assert.deepEqual(edit.replacements, [], "no versiona el ejercicio existente sin cambios");

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
  removal.registeredRetirements,
  ["registered"],
  "retira de la planificacion futura un ejercicio con entry asociada",
);

const pendingEdit = analyzeCycleScopedDayEdit(
  [createExercise("pending", "Press plano")],
  [{ sourceExerciseId: "pending", name: "Press plano libre", sets: 4, reps: 10, weight: 45.5 }],
  new Set(),
);
assert.deepEqual(
  pendingEdit.updates,
  [{
    exerciseId: "pending",
    name: "Press plano libre",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 45.5,
    sortOrder: 0,
    notes: null,
  }],
  "edita directamente un ejercicio pendiente",
);

const registeredEdit = analyzeCycleScopedDayEdit(
  existingExercises,
  [{ sourceExerciseId: "registered", name: "Gemelos hack", sets: 3, reps: 13, weight: 120 }],
  new Set(["registered"]),
);
assert.deepEqual(
  registeredEdit.replacements,
  [{
    previousExerciseId: "registered",
    name: "Gemelos hack",
    targetSets: 3,
    targetReps: 13,
    baseWeight: 120,
    sortOrder: 0,
    notes: null,
  }],
  "versiona la planificacion futura de un ejercicio registrado",
);

const pendingRemoval = analyzeCycleScopedDayEdit([createExercise("pending", "Press plano")], [], new Set());
assert.deepEqual(pendingRemoval.pendingDeletes, ["pending"], "soft-delete para pendiente sin entries");

const retiredNotes = createCycleScopedRetiredExerciseNotes("nota previa", "2026-06-15T00:00:00.000Z");
assert.equal(isCycleScopedExerciseRetired(retiredNotes), true, "marca retiro futuro sin deleted_at para registrados");
assert.equal(
  createCycleScopedRetiredExerciseNotes(null, "2026-06-15T00:00:00.000Z"),
  futurePlanRetiredMarker,
  "agrega el marcador tecnico cuando notes es null",
);
assert.equal(
  retiredNotes,
  `nota previa\n${futurePlanRetiredMarker}`,
  "preserva la nota funcional y agrega el marcador en una linea separada",
);
assert.equal(
  addFuturePlanRetiredMarker(retiredNotes),
  retiredNotes,
  "no duplica el marcador tecnico",
);
assert.equal(
  hasFuturePlanRetiredMarker(`texto con palabra retirado pero sin marcador`),
  false,
  "no interpreta palabras genericas como retiro tecnico",
);
assert.equal(
  hasFuturePlanRetiredMarker(`[organizatech:future-plan-retired-extra]`),
  false,
  "detecta solo el marcador namespaced exacto",
);
assert.equal(
  getCycleScopedExerciseDisplayNotes(retiredNotes),
  "nota previa",
  "oculta el marcador en la UI y conserva visible la nota funcional",
);
assert.equal(
  removeTechnicalMarkersForDisplay(futurePlanRetiredMarker),
  null,
  "no muestra metadata tecnica cuando no hay nota funcional",
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

assert.match(
  cycleScopedRepositorySource,
  /from\("exercise_entries"\)[\s\S]*?training_sessions!inner\(id,user_id,deleted_at\)[\s\S]*?\.eq\("training_sessions\.user_id", userId\)[\s\S]*?\.is\("training_sessions\.deleted_at", null\)/,
  "la edicion del plan considera historial solo de sesiones activas del usuario",
);
assert.match(
  cycleScopedRepositorySource,
  /export async function getCycleScopedTrainingSessionData[\s\S]*?\.from\("training_sessions"\)[\s\S]*?\.is\("deleted_at", null\)[\s\S]*?\.from\("exercise_entries"\)[\s\S]*?\.in\("session_id", sessionIds\)/,
  "el loader cycle-scoped conserva entries de sesiones activas y excluye las soft-deleted desde los sessionIds",
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
    exerciseLineageId: null,
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
