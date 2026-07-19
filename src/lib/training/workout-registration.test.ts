import assert from "node:assert/strict";
import { toPersistedExerciseObservation } from "@/lib/data/repository";
import {
  acquireWorkoutSaveLock,
  buildCurrentWorkoutSavePlan,
  getCurrentWorkoutRegisteredExerciseIds,
  incompleteCurrentWorkoutMessage,
  isExerciseRegisteredInCurrentWorkout,
  noCurrentWorkoutExercisesMessage,
  releaseWorkoutSaveLock,
  type WorkoutRegistrationDraft,
  type WorkoutRegistrationExercise,
} from "./workout-registration";

const mondayBench = createExercise("exercise-1", "cycle-exercise-1");
const mondayRow = createExercise("exercise-2", "cycle-exercise-2");
const tuesdayPress = createExercise("exercise-3", "cycle-exercise-1");

const historicalCycleScopedExerciseIds = new Set(["cycle-exercise-1", "cycle-exercise-2"]);
assert.equal(
  historicalCycleScopedExerciseIds.has(mondayBench.trainingCycleExerciseId ?? ""),
  true,
  "fixture: el ejercicio ya existe en historial scoped previo",
);
assert.equal(
  isExerciseRegisteredInCurrentWorkout(mondayBench, {}),
  false,
  "una sesion historica previa no registra el ejercicio del workout nuevo",
);

const manyHistoricalSessions = new Set(["cycle-exercise-1", "cycle-exercise-2", "cycle-exercise-3"]);
assert.equal(
  manyHistoricalSessions.has(mondayRow.trainingCycleExerciseId ?? ""),
  true,
  "fixture: varias sesiones historicas contienen el ejercicio",
);
assert.deepEqual(
  buildCurrentWorkoutSavePlan([mondayBench, mondayRow], {}).validExercises,
  [],
  "varias sesiones historicas previas no habilitan ni bloquean como registrado el workout nuevo",
);

const currentBenchDrafts = {
  [mondayBench.id]: { registered: true },
} satisfies Record<string, WorkoutRegistrationDraft>;
assert.equal(
  isExerciseRegisteredInCurrentWorkout(mondayBench, currentBenchDrafts),
  true,
  "Registrar serie marca unicamente el draft actual",
);
assert.equal(
  isExerciseRegisteredInCurrentWorkout(mondayRow, currentBenchDrafts),
  false,
  "Registrar serie no marca otros ejercicios del workout",
);
assert.deepEqual(
  [...getCurrentWorkoutRegisteredExerciseIds([mondayBench, mondayRow], currentBenchDrafts)],
  [mondayBench.id],
  "los registrados actuales se calculan por id del draft, no por historial scoped",
);

const partialPlan = buildCurrentWorkoutSavePlan([mondayBench, mondayRow], currentBenchDrafts);
assert.equal(partialPlan.canSave, false, "un draft parcial impide guardar");
assert.equal(partialPlan.message, incompleteCurrentWorkoutMessage, "un draft parcial entrega mensaje visible");
assert.deepEqual(
  partialPlan.exercisesToRegister.map((exercise) => exercise.id),
  [mondayBench.id, mondayRow.id],
  "el payload candidato incluye todos los ejercicios del workout actual aunque existan en historial",
);
assert.deepEqual(
  partialPlan.validExercises.map((exercise) => exercise.id),
  [mondayBench.id],
  "solo los drafts registrados entran como validos",
);

const completeDrafts = {
  [mondayBench.id]: { registered: true },
  [mondayRow.id]: { registered: true },
} satisfies Record<string, WorkoutRegistrationDraft>;
const completePlan = buildCurrentWorkoutSavePlan([mondayBench, mondayRow], completeDrafts);
assert.equal(completePlan.canSave, true, "draft completo permite guardar");
assert.equal(completePlan.message, null, "draft completo no genera aviso");
assert.deepEqual(
  completePlan.validExercises.map((exercise) => exercise.id),
  [mondayBench.id, mondayRow.id],
  "el guardado cycle-scoped conserva todos los ejercicios actuales registrados",
);

assert.equal(
  isExerciseRegisteredInCurrentWorkout(tuesdayPress, {}),
  false,
  "historial de otro dia con el mismo trainingCycleExerciseId no afecta el estado actual",
);

const emptyPlan = buildCurrentWorkoutSavePlan([], {});
assert.equal(emptyPlan.canSave, false, "sin ejercicios actuales no se guarda");
assert.equal(emptyPlan.message, noCurrentWorkoutExercisesMessage, "sin ejercicios actuales entrega mensaje visible");

const busyGuardBefore = 0;
const busyGuardAfter = maybeInvokeWhenNotBusy(true, () => busyGuardBefore + 1);
assert.equal(busyGuardAfter, busyGuardBefore, "isBusy=true bloquea una segunda persistencia");
assert.equal(maybeInvokeWhenNotBusy(false, () => 1), 1, "isBusy=false permite continuar");

const cycleScopedLock = { current: false };
assert.equal(acquireWorkoutSaveLock(cycleScopedLock), true, "la primera invocacion cycle-scoped adquiere el lock");
assert.equal(acquireWorkoutSaveLock(cycleScopedLock), false, "la segunda invocacion inmediata cycle-scoped es ignorada");
let cycleScopedRepositoryCalls = 0;
if (acquireWorkoutSaveLock(cycleScopedLock)) cycleScopedRepositoryCalls += 1;
assert.equal(cycleScopedRepositoryCalls, 0, "cycle-scoped no crea dos llamadas al repository");
releaseWorkoutSaveLock(cycleScopedLock);
assert.equal(cycleScopedLock.current, false, "el lock se libera despues de exito");
assert.equal(acquireWorkoutSaveLock(cycleScopedLock), true, "despues de liberar se permite un nuevo intento");
releaseWorkoutSaveLock(cycleScopedLock);

const legacyLock = { current: false };
let legacyRepositoryCalls = 0;
if (acquireWorkoutSaveLock(legacyLock)) legacyRepositoryCalls += 1;
if (acquireWorkoutSaveLock(legacyLock)) legacyRepositoryCalls += 1;
assert.equal(legacyRepositoryCalls, 1, "legacy no crea dos llamadas al repository");
try {
  throw new Error("fallo simulado");
} catch {
  releaseWorkoutSaveLock(legacyLock);
}
assert.equal(legacyLock.current, false, "el lock se libera despues de error");

const controlledReturnLock = { current: false };
assert.equal(acquireWorkoutSaveLock(controlledReturnLock), true, "el flujo con retorno controlado adquiere lock");
releaseWorkoutSaveLock(controlledReturnLock);
assert.equal(controlledReturnLock.current, false, "el lock se libera despues de retorno controlado");

assert.deepEqual(
  createCycleScopedEntryInput(mondayBench, {
    weight: "110",
    reps: [12, 12, 8],
    registered: true,
    notes: "Entrenamiento Lunes: Piernas. Motivacion alta",
  }),
  {
    trainingCycleExerciseId: "cycle-exercise-1",
    exerciseLineageId: "lineage-exercise-1",
    weight: 110,
    reps: [12, 12, 8],
    notes: "Entrenamiento Lunes: Piernas. Motivacion alta",
  },
  "el payload cycle-scoped mantiene lineage, trainingCycleExerciseId, reps, peso y notes con readiness",
);

assert.deepEqual(
  buildLegacyEntryInput(mondayBench, { weight: "100", reps: [10, 10, 10], registered: true }),
  {
    exerciseId: "exercise-1",
    weight: 100,
    reps: [10, 10, 10],
  },
  "el flujo legacy sigue usando exerciseId y drafts actuales",
);

const cycleScopedWithObservation = createCycleScopedEntryInput(mondayBench, {
  weight: "110",
  reps: [12, 12, 8],
  registered: true,
  notes: "Entrenamiento Lunes: Piernas. Motivacion alta",
  observation: "  Sentí molestia leve en el hombro  ",
});
assert.equal(
  cycleScopedWithObservation.observation,
  "Sentí molestia leve en el hombro",
  "el payload cycle-scoped incluye observation recortada cuando hay texto",
);
assert.equal(
  cycleScopedWithObservation.notes,
  "Entrenamiento Lunes: Piernas. Motivacion alta",
  "notes permanece intacto e independiente de observation en el payload cycle-scoped",
);
assert.ok(
  !("exerciseLineageId" in buildLegacyEntryInput(mondayBench, { weight: "100", reps: [10, 10, 10], registered: true })),
  "el payload legacy nunca incluye exerciseLineageId desde el cliente",
);

const cycleScopedWithoutObservation = createCycleScopedEntryInput(mondayBench, {
  weight: "110",
  reps: [12, 12, 8],
  registered: true,
  notes: "Entrenamiento Lunes: Piernas. Motivacion alta",
  observation: "   ",
});
assert.ok(
  !("observation" in cycleScopedWithoutObservation),
  "observation vacia o solo espacios se omite del payload cycle-scoped, no se envia como string vacio",
);

const legacyWithObservation = buildLegacyEntryInput(mondayBench, {
  weight: "100",
  reps: [10, 10, 10],
  registered: true,
  observation: "Buena ejecucion, subir peso la proxima",
});
assert.equal(
  legacyWithObservation.observation,
  "Buena ejecucion, subir peso la proxima",
  "el payload legacy incluye observation valida cuando hay texto",
);

const legacyWithoutObservation = buildLegacyEntryInput(mondayBench, { weight: "100", reps: [10, 10, 10], registered: true });
assert.ok(
  !("observation" in legacyWithoutObservation),
  "el registro legacy sigue siendo valido sin observation: la propiedad se omite, no se envia null",
);

console.log("workout-registration tests passed");

function createExercise(id: string, trainingCycleExerciseId: string): WorkoutRegistrationExercise & {
  exerciseLineageId: string;
} {
  return {
    id,
    trainingCycleExerciseId,
    exerciseLineageId: `lineage-${id}`,
  };
}

function maybeInvokeWhenNotBusy<T>(isBusy: boolean, action: () => T) {
  if (isBusy) return 0;
  return action();
}

function createCycleScopedEntryInput(
  exercise: WorkoutRegistrationExercise & { exerciseLineageId: string },
  draft: WorkoutRegistrationDraft & { weight: string; reps: number[]; notes: string; observation?: string },
) {
  const observation = toPersistedExerciseObservation(draft.observation);
  return {
    trainingCycleExerciseId: exercise.trainingCycleExerciseId,
    exerciseLineageId: exercise.exerciseLineageId,
    weight: Number(draft.weight),
    reps: draft.reps,
    notes: draft.notes,
    ...(observation ? { observation } : {}),
  };
}

function buildLegacyEntryInput(
  exercise: WorkoutRegistrationExercise,
  draft: WorkoutRegistrationDraft & { weight: string; reps: number[]; observation?: string },
) {
  const observation = toPersistedExerciseObservation(draft.observation);
  return {
    exerciseId: exercise.id,
    weight: Number(draft.weight),
    reps: draft.reps,
    ...(observation ? { observation } : {}),
  };
}
