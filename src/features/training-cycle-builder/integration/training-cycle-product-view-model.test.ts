import assert from "node:assert/strict";
import test from "node:test";

import type { ExerciseEntry } from "@/lib/progress/types";

import type {
  TrainingCycleCatalogItem,
  TrainingCycleRpcSnapshot,
} from "../data/training-cycle-rpc-types";
import { buildTrainingCycleProductViewModel } from "./training-cycle-product-view-model";

const CATALOG_ID = "10000000-0000-4000-8000-000000000001";
const CYCLE_ID = "20000000-0000-4000-8000-000000000001";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const VERSION_ID = "40000000-0000-4000-8000-000000000001";
const DAY_ID = "50000000-0000-4000-8000-000000000001";
const EXERCISE_ID = "60000000-0000-4000-8000-000000000001";
const LINEAGE_ID = "70000000-0000-4000-8000-000000000001";
const LEGACY_EXERCISE_ID = "80000000-0000-4000-8000-000000000001";
const SET_1_ID = "90000000-0000-4000-8000-000000000001";
const SET_2_ID = "90000000-0000-4000-8000-000000000002";

const catalog: readonly TrainingCycleCatalogItem[] = [{
  source: { kind: "catalog", id: CATALOG_ID },
  name: "Press plano con barra",
  muscleGroup: "pectoral",
  videoUrl: "https://youtu.be/AbCdEfGhI_1",
}];

function cycle(): TrainingCycleRpcSnapshot {
  return {
    cycleId: CYCLE_ID,
    portalScope: "usuario",
    cycleNumber: 2,
    goal: "volume",
    startDate: "2026-07-01",
    endDate: "2026-08-31",
    status: "active",
    daysUntilEnd: 2,
    version: 3,
    snapshotId: VERSION_ID,
    extensionCount: 0,
    sourceDraftId: DRAFT_ID,
    sourceCycleId: null,
    closedAt: null,
    closedReason: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    plan: {
      days: [{
        snapshotId: DAY_ID,
        day: "monday",
        name: "Empuje",
        order: 0,
        legacyCycleDayId: null,
        exercises: [{
          snapshotId: EXERCISE_ID,
          source: { kind: "catalog", id: CATALOG_ID },
          exerciseLineageId: LINEAGE_ID,
          name: "Press plano con barra",
          muscleGroup: "pectoral",
          order: 0,
          technique: "linear",
          videoUrl: "https://youtu.be/AbCdEfGhI_1",
          legacyCycleExerciseId: LEGACY_EXERCISE_ID,
          sets: [
            { snapshotId: SET_1_ID, order: 0, targetReps: 10, targetKg: 80, toFailure: false, drops: [] },
            { snapshotId: SET_2_ID, order: 1, targetReps: 10, targetKg: 80, toFailure: false, drops: [] },
          ],
        }],
      }],
    },
  };
}

function entry(input: Partial<ExerciseEntry> & Pick<ExerciseEntry, "id" | "date">): ExerciseEntry {
  return {
    id: input.id,
    sessionId: input.sessionId ?? `session-${input.id}`,
    cycleId: input.cycleId ?? CYCLE_ID,
    trainingCycleExerciseId: input.trainingCycleExerciseId,
    exerciseLineageId: input.exerciseLineageId,
    exerciseId: input.exerciseId ?? `exercise-${input.id}`,
    exerciseName: input.exerciseName ?? "Press plano con barra",
    routine: "Empuje",
    week: 1,
    date: input.date,
    targetSets: 2,
    targetReps: 10,
    weight: input.weight ?? 80,
    previousWeight: 80,
    reps: input.reps ?? [10, 10],
    rir: input.rir,
  };
}

test("proyecta IDs reales, orden canónico y ciclo activo sin inventar catálogo", () => {
  const model = buildTrainingCycleProductViewModel({
    todayIsoDate: "2026-08-29",
    catalog,
    entries: [],
    activeCycle: cycle(),
    draft: null,
    sourceCycle: null,
    lastCycle: null,
  });
  const exercise = model.draft.routines.monday.exercises[0];
  assert.equal(model.initialScreen, "active");
  assert.equal(model.activeCycleId, CYCLE_ID);
  assert.equal(model.activeCycleRevision, "3");
  assert.deepEqual(exercise?.source, { kind: "catalog", id: CATALOG_ID });
  assert.equal(exercise?.id, EXERCISE_ID);
  assert.equal(exercise?.sets[0]?.id, SET_1_ID);
  assert.equal(exercise?.muscleGroup, "Pectoral");
});

test("no usa nombres como fallback para historial de otra lineage", () => {
  const model = buildTrainingCycleProductViewModel({
    todayIsoDate: "2026-08-29",
    catalog,
    entries: [entry({
      id: "foreign",
      date: "2026-08-28",
      exerciseLineageId: "70000000-0000-4000-8000-000000000099",
      exerciseName: "Press plano con barra",
    })],
    activeCycle: cycle(),
    draft: null,
    sourceCycle: null,
    lastCycle: null,
  });
  assert.equal(model.draft.routines.monday.exercises[0]?.recommendation.hasHistory, false);
  assert.equal(model.duplicateComparison[0]?.actualLabel, "Sin registro comparable");
});

test("genera sugerencia opt-in por serie sólo con lineage propia y muestras suficientes", () => {
  const entries = [
    entry({ id: "one", sessionId: "session-one", date: "2026-08-20", exerciseLineageId: LINEAGE_ID, reps: [11, 10] }),
    entry({ id: "two", sessionId: "session-two", date: "2026-08-27", exerciseLineageId: LINEAGE_ID, reps: [12, 11] }),
  ];
  const model = buildTrainingCycleProductViewModel({
    todayIsoDate: "2026-08-29",
    catalog,
    entries,
    activeCycle: cycle(),
    draft: null,
    sourceCycle: null,
    lastCycle: null,
  });
  const recommendation = model.draft.routines.monday.exercises[0]?.recommendation;
  assert.equal(recommendation?.hasHistory, true);
  assert.equal(recommendation?.suggestedSets?.length, 2);
  assert.match(recommendation?.body ?? "", /estimación, no una garantía/i);
});

test("un usuario sin ciclo recibe un borrador vacío editable", () => {
  const model = buildTrainingCycleProductViewModel({
    todayIsoDate: "2026-08-29",
    catalog,
    entries: [],
    activeCycle: null,
    draft: null,
    sourceCycle: null,
    lastCycle: null,
  });
  assert.equal(model.initialScreen, "start");
  assert.deepEqual(model.draft.selectedDays, []);
  assert.equal(model.draft.startDate, "2026-08-30");
  assert.equal(model.draft.endDate, "2026-10-11");
  assert.equal(model.hasRecoverableDraft, false);
});

test("falla cerrado si un draft remoto referencia una fuente que no puede resolverse", () => {
  const source = cycle();
  const plan = {
    days: source.plan.days.map((day) => ({
      day: day.day,
      name: day.name,
      order: day.order,
      exercises: day.exercises.map((exercise) => ({
        catalogExerciseId: "10000000-0000-4000-8000-000000000099",
        order: exercise.order,
        technique: exercise.technique,
        videoUrl: exercise.videoUrl,
        sets: exercise.sets.map((set) => ({
          order: set.order,
          targetReps: set.targetReps,
          targetKg: set.targetKg,
          toFailure: set.toFailure,
          drops: [],
        })),
      })),
    })),
  };
  assert.throws(() => buildTrainingCycleProductViewModel({
    todayIsoDate: "2026-08-29",
    catalog,
    entries: [],
    activeCycle: null,
    draft: {
      draftId: DRAFT_ID,
      origin: "manual",
      sourceCycleId: null,
      state: "draft",
      version: 1,
      goal: "volume",
      startDate: "2026-08-30",
      endDate: "2026-10-11",
      plan,
      activatedCycleId: null,
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
    },
    sourceCycle: null,
    lastCycle: null,
  }), /unresolved-exercise-source/);
});
