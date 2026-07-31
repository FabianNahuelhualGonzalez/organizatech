import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { toPersistedExerciseObservation } from "@/lib/data/repository";
import type { ExerciseTemplate } from "@/lib/progress/types";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";
import {
  buildCurrentWorkoutSavePlan,
  getCurrentWorkoutRegisteredExerciseIds,
  incompleteCurrentExerciseMessage,
  incompleteCurrentWorkoutMessage,
  isExerciseRegisteredInCurrentWorkout,
  noCurrentWorkoutExercisesMessage,
  resolveCurrentExerciseRegistration,
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

const registrationExercises = [
  createRegistrationExercise("registration-1", 2),
  createRegistrationExercise("registration-2", 2),
  createRegistrationExercise("registration-3", 2),
];
const validDraft = createRegistrationDraft();

assert.deepEqual(resolveRegistration({ isBusy: true }), { kind: "busy" }, "isBusy no produce accion");
assert.deepEqual(
  resolveRegistration({ activeExerciseIndex: 99 }),
  { kind: "missing_exercise" },
  "un indice sin ejercicio no produce accion",
);
assert.deepEqual(resolveRegistration({
  drafts: {
    "registration-1": { ...validDraft, registered: true },
    "registration-2": { ...validDraft, registered: true },
  },
}), {
  kind: "already_registered_advance",
  nextExerciseIndex: 2,
}, "un ejercicio registrado avanza al siguiente pendiente posterior");
assert.deepEqual(resolveRegistration({
  drafts: Object.fromEntries(registrationExercises.map((exercise) => [
    exercise.id,
    { ...validDraft, registered: true },
  ])),
}), { kind: "already_registered_complete" }, "sin siguiente pendiente no altera el indice");

const invalidRegistrationDrafts: Array<[ExerciseDraft, string]> = [
  [{ ...validDraft, weight: "" }, "peso vacio"],
  [{ ...validDraft, weight: "peso-invalido" }, "peso invalido"],
  [{ ...validDraft, reps: [10, ""] }, "rep requerida vacia"],
];
for (const [draft, label] of invalidRegistrationDrafts) {
  assert.deepEqual(resolveRegistration({ drafts: { "registration-1": draft } }), {
    kind: "invalid_draft",
    message: incompleteCurrentExerciseMessage,
  }, `${label} conserva el mensaje productivo`);
}

const extraRepDecision = expectRegister(resolveRegistration({
  drafts: { "registration-1": { ...validDraft, reps: [10, 11, ""] } },
}));
assert.deepEqual(extraRepDecision.draft.reps, [10, 11], "reps fuera de targetSets no bloquean y se recortan");

const registrationDecision = expectRegister(resolveRegistration({
  drafts: {
    "registration-1": {
      ...validDraft,
      weight: "95,5",
      reps: [8, 9],
      observation: "Mantener control escapular",
    },
  },
}));
assert.equal(registrationDecision.draft.registered, true, "el registro valido marca registered");
assert.equal(registrationDecision.draft.observation, "Mantener control escapular", "el registro conserva observation");
assert.equal(registrationDecision.nextExerciseIndex, 1, "el registro intermedio avanza un indice");

const finalExerciseDecision = expectRegister(resolveRegistration({
  activeExerciseIndex: 2,
  drafts: { "registration-3": validDraft },
}));
assert.equal(finalExerciseDecision.nextExerciseIndex, 2, "el ultimo ejercicio conserva el ultimo indice");

const historicalIds = new Set([registrationExercises[0]?.trainingCycleExerciseId]);
assert.equal(historicalIds.has("cycle-registration-1"), true, "fixture: existe historial previo");
assert.equal(
  expectRegister(resolveRegistration({ drafts: { "registration-1": validDraft } })).exercise.id,
  "registration-1",
  "el historial previo no influye en el draft actual",
);
assert.equal(
  expectRegister(resolveRegistration({
    drafts: {
      "registration-1": validDraft,
      "otro-ejercicio": { ...validDraft, registered: true },
    },
  })).exercise.id,
  "registration-1",
  "el draft de otro ejercicio no influye por aislamiento de exercise.id",
);

const immutableDrafts = { "registration-1": createRegistrationDraft({ reps: [7, 8, 9] }) };
const immutableInput = {
  isBusy: false,
  exercises: registrationExercises,
  activeExerciseIndex: 0,
  drafts: immutableDrafts,
};
const immutableBefore = structuredClone(immutableInput);
const immutableDecision = expectRegister(resolveCurrentExerciseRegistration(immutableInput));
assert.deepEqual(immutableInput, immutableBefore, "la decision no muta sus inputs");
assert.notEqual(immutableDecision.draft, immutableDrafts["registration-1"], "el draft normalizado es independiente");
assert.notEqual(immutableDecision.draft.reps, immutableDrafts["registration-1"].reps, "las reps normalizadas son independientes");

const zeroDecision = expectRegister(resolveRegistration({
  drafts: { "registration-1": createRegistrationDraft({ weight: "0", reps: [0, 0] }) },
}));
assert.equal(zeroDecision.draft.weight, "0", "cero mantiene la compatibilidad actual de peso");
assert.deepEqual(zeroDecision.draft.reps, [0, 0], "cero mantiene la compatibilidad actual de reps");

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

// Contrato estatico/source-based: verifica wiring; no renderiza React ni sustituye la cobertura runtime anterior.
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const registrationStart = appSource.indexOf("  function registerCurrentExercise()");
const registrationEnd = appSource.indexOf("  async function confirmTrainingWorkoutReadinessLink", registrationStart);
const registrationBlock = registrationStart >= 0 && registrationEnd > registrationStart
  ? appSource.slice(registrationStart, registrationEnd)
  : "";
assert.match(registrationBlock, /resolveCurrentExerciseRegistration\(\{/);
assert.match(registrationBlock, /switch \(decision\.kind\)/);
assert.doesNotMatch(
  registrationBlock,
  /parseDecimalWeightInput|normalizeExerciseDraft|findIndex|isExerciseRegisteredInCurrentWorkout/,
  "el root no reimplementa validacion ni busqueda del siguiente pendiente",
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

function createRegistrationExercise(id: string, targetSets: number): ExerciseTemplate {
  return {
    id,
    trainingCycleExerciseId: `cycle-${id}`,
    exerciseLineageId: `lineage-${id}`,
    routine: "Lunes",
    day: "Lunes",
    name: `Exercise ${id}`,
    targetSets,
    targetReps: 10,
    baseWeight: 80,
  };
}

function createRegistrationDraft(overrides: Partial<ExerciseDraft> = {}): ExerciseDraft {
  return {
    weight: "100",
    rir: "2",
    reps: [10, 10],
    registered: false,
    observation: "Observacion actual",
    ...overrides,
  };
}

function resolveRegistration(overrides: Partial<Parameters<typeof resolveCurrentExerciseRegistration>[0]> = {}) {
  return resolveCurrentExerciseRegistration({
    isBusy: false,
    exercises: registrationExercises,
    activeExerciseIndex: 0,
    drafts: { "registration-1": validDraft },
    ...overrides,
  });
}

function expectRegister(decision: ReturnType<typeof resolveCurrentExerciseRegistration>) {
  assert.equal(decision.kind, "register");
  if (decision.kind !== "register") throw new Error("Expected register decision");
  return decision;
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
