import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecordOwnTrainingCycleExecutionPayload,
  createTrainingCycleExecutionDraft,
  getTrainingCycleExecutionExerciseDraft,
  resolveAdvancedWorkoutPlan,
  TrainingCycleExecutionPayloadError,
  updateTrainingCycleExecutionDrop,
  updateTrainingCycleExecutionSet,
  type AdvancedWorkoutExecutionContext,
} from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";
import { mapUiExecutionToRpc } from "@/features/training-cycle-builder/data/training-cycle-rpc-mappers";
import type { TrainingCycleRpcSnapshot } from "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import type { ExerciseTemplate } from "@/lib/progress/types";

function uuid(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

const USER_ID = uuid(1);
const CYCLE_ID = uuid(2);
const SNAPSHOT_ID = uuid(3);
const DAY_ID = uuid(4);
const LEGACY_DAY_ID = uuid(5);
const EXERCISE_A_ID = uuid(6);
const EXERCISE_B_ID = uuid(7);
const LEGACY_EXERCISE_A_ID = uuid(8);
const LEGACY_EXERCISE_B_ID = uuid(9);
const LINEAGE_A_ID = uuid(10);
const LINEAGE_B_ID = uuid(11);
const SET_A_ID = uuid(12);
const SET_B_ID = uuid(13);
const DROP_B_ID = uuid(14);

function snapshot(videoUrl = "https://www.youtube.com/watch?v=ABCdef12345"): TrainingCycleRpcSnapshot {
  return {
    cycleId: CYCLE_ID,
    portalScope: "usuario",
    cycleNumber: 1,
    goal: "strength",
    startDate: "2026-08-01",
    endDate: "2026-09-01",
    status: "active",
    daysUntilEnd: 3,
    version: 2,
    snapshotId: SNAPSHOT_ID,
    extensionCount: 0,
    sourceDraftId: null,
    sourceCycleId: null,
    closedAt: null,
    closedReason: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    plan: {
      days: [{
        snapshotId: DAY_ID,
        day: "monday",
        name: "Día A",
        order: 0,
        legacyCycleDayId: LEGACY_DAY_ID,
        exercises: [
          {
            snapshotId: EXERCISE_B_ID,
            source: { kind: "catalog", id: uuid(21) },
            exerciseLineageId: LINEAGE_B_ID,
            name: "Nombre repetido",
            muscleGroup: "dorsal",
            order: 1,
            technique: "drop_set",
            videoUrl: null,
            legacyCycleExerciseId: LEGACY_EXERCISE_B_ID,
            sets: [{
              snapshotId: SET_B_ID,
              order: 0,
              targetReps: 8,
              targetKg: 80,
              toFailure: false,
              drops: [{ snapshotId: DROP_B_ID, order: 0, kg: 60, reps: 6 }],
            }],
          },
          {
            snapshotId: EXERCISE_A_ID,
            source: { kind: "catalog", id: uuid(20) },
            exerciseLineageId: LINEAGE_A_ID,
            name: "Nombre repetido",
            muscleGroup: "pectoral",
            order: 0,
            technique: "linear",
            videoUrl,
            legacyCycleExerciseId: LEGACY_EXERCISE_A_ID,
            sets: [{
              snapshotId: SET_A_ID,
              order: 0,
              targetReps: 10,
              targetKg: 70,
              toFailure: false,
              drops: [],
            }],
          },
        ],
      }],
    },
  };
}

function exercise(input: {
  id: string;
  lineage: string;
  name: string;
}): ExerciseTemplate {
  return {
    id: input.id,
    cycleId: CYCLE_ID,
    cycleDayId: LEGACY_DAY_ID,
    trainingCycleExerciseId: input.id,
    exerciseLineageId: input.lineage,
    routine: "Día A",
    day: "Lunes",
    name: input.name,
    targetSets: 1,
    targetReps: 10,
    baseWeight: 70,
  };
}

const exercises = [
  exercise({ id: LEGACY_EXERCISE_B_ID, lineage: LINEAGE_B_ID, name: "Nombre A" }),
  exercise({ id: LEGACY_EXERCISE_A_ID, lineage: LINEAGE_A_ID, name: "Nombre B" }),
];

function context(value = snapshot()): AdvancedWorkoutExecutionContext {
  return {
    storageScope: `supabase:${USER_ID}`,
    snapshot: value,
    workoutAttemptId: uuid(30),
    performedAt: "2026-08-29T15:00:00.000-04:00",
    onPayloadReady: () => undefined,
  };
}

function resolvedPlan(value = snapshot()) {
  const result = resolveAdvancedWorkoutPlan({ context: context(value), exercises });
  assert.equal(result.kind, "advanced");
  return result.plan;
}

test("resuelve sólo por legacyCycleExerciseId y conserva linajes/órdenes snapshot", () => {
  const plan = resolvedPlan();
  assert.deepEqual(
    plan.exercises.map(({ legacyExercise, plan: exercisePlan }) => ({
      legacyId: legacyExercise.id,
      planId: exercisePlan.snapshotId,
      lineage: exercisePlan.exerciseLineageId,
      order: exercisePlan.order,
    })),
    [
      { legacyId: LEGACY_EXERCISE_A_ID, planId: EXERCISE_A_ID, lineage: LINEAGE_A_ID, order: 0 },
      { legacyId: LEGACY_EXERCISE_B_ID, planId: EXERCISE_B_ID, lineage: LINEAGE_B_ID, order: 1 },
    ],
  );

  const sameNamesWrongId = exercises.map((item, index) => ({
    ...item,
    id: uuid(100 + index),
    trainingCycleExerciseId: uuid(100 + index),
    name: "Nombre repetido",
  }));
  assert.deepEqual(
    resolveAdvancedWorkoutPlan({ context: context(), exercises: sameNamesWrongId }),
    { kind: "legacy" },
  );
  assert.deepEqual(
    resolveAdvancedWorkoutPlan({
      context: context(),
      exercises: [{ ...exercises[0], exerciseLineageId: uuid(500) }, exercises[1]],
    }),
    { kind: "legacy" },
  );
  assert.deepEqual(
    resolveAdvancedWorkoutPlan({
      context: context(),
      exercises: [{ ...exercises[0], targetSets: 2 }, exercises[1]],
    }),
    { kind: "legacy" },
  );
  assert.deepEqual(
    resolveAdvancedWorkoutPlan({
      context: { ...context(), onPayloadReady: undefined } as unknown as AdvancedWorkoutExecutionContext,
      exercises,
    }),
    { kind: "legacy" },
  );
});

test("video sólo queda disponible para una URL YouTube allowlisted y el snapshot alterado falla cerrado", () => {
  assert.equal(resolvedPlan().exercises[0].plan.safeVideoUrl, "https://www.youtube.com/watch?v=ABCdef12345");
  assert.deepEqual(
    resolveAdvancedWorkoutPlan({
      context: context(snapshot("https://evil.example.com/video/ABCdef12345")),
      exercises,
    }),
    { kind: "legacy" },
  );
});

test("borrador y payload conservan todos los IDs; gateway recibe órdenes RPC canónicas", () => {
  const plan = resolvedPlan();
  let draft = createTrainingCycleExecutionDraft(plan, 100);
  draft = updateTrainingCycleExecutionSet(draft, {
    planExerciseId: EXERCISE_A_ID,
    planSetId: SET_A_ID,
    patch: { completed: true, reps: "9", kg: "72,5", reachedFailure: true },
    updatedAt: 101,
  });
  draft = updateTrainingCycleExecutionSet(draft, {
    planExerciseId: EXERCISE_B_ID,
    planSetId: SET_B_ID,
    patch: { completed: true, reps: "8", kg: "80" },
    updatedAt: 102,
  });
  draft = updateTrainingCycleExecutionDrop(draft, {
    planExerciseId: EXERCISE_B_ID,
    planSetId: SET_B_ID,
    planDropId: DROP_B_ID,
    patch: { completed: true, reps: "6", kg: "60" },
    updatedAt: 103,
  });

  const payload = buildRecordOwnTrainingCycleExecutionPayload({ plan, draft });
  const retryPayload = buildRecordOwnTrainingCycleExecutionPayload({ plan, draft });
  assert.deepEqual(retryPayload, payload);
  assert.deepEqual(payload.execution.exercises.map((exercise) => exercise.order), [1, 2]);
  assert.deepEqual(mapUiExecutionToRpc(payload.execution), {
    dayId: DAY_ID,
    exercises: [
      {
        planExerciseId: EXERCISE_A_ID,
        order: 0,
        sets: [{
          planSetId: SET_A_ID,
          order: 0,
          completed: true,
          reps: 9,
          kg: 72.5,
          reachedFailure: true,
          drops: [],
        }],
      },
      {
        planExerciseId: EXERCISE_B_ID,
        order: 1,
        sets: [{
          planSetId: SET_B_ID,
          order: 0,
          completed: true,
          reps: 8,
          kg: 80,
          reachedFailure: false,
          drops: [{
            planDropId: DROP_B_ID,
            order: 0,
            completed: true,
            reps: 6,
            kg: 60,
          }],
        }],
      },
    ],
  });
  assert.deepEqual(Object.keys(payload).sort(), ["cycleId", "execution", "expectedVersion", "performedAt"]);
  assert.doesNotMatch(JSON.stringify(payload), /user_id|owner_id|profile_id|requestId|portalScope/);
  assert.equal(Object.isFrozen(payload), true);
});

test("builder falla cerrado ante resultados incompletos o estructura ajena al snapshot", () => {
  const plan = resolvedPlan();
  let draft = createTrainingCycleExecutionDraft(plan, 100);
  draft = updateTrainingCycleExecutionSet(draft, {
    planExerciseId: EXERCISE_A_ID,
    planSetId: SET_A_ID,
    patch: { completed: true },
    updatedAt: 101,
  });
  assert.throws(
    () => buildRecordOwnTrainingCycleExecutionPayload({ plan, draft }),
    TrainingCycleExecutionPayloadError,
  );

  const validDraft = createTrainingCycleExecutionDraft(plan, 102);
  const exerciseDraft = getTrainingCycleExecutionExerciseDraft(validDraft, EXERCISE_A_ID);
  assert.ok(exerciseDraft);
  const tampered = {
    ...validDraft,
    exercises: validDraft.exercises.map((item) => item.planExerciseId === EXERCISE_A_ID
      ? { ...item, exerciseLineageId: uuid(999) }
      : item),
  };
  assert.throws(
    () => buildRecordOwnTrainingCycleExecutionPayload({ plan, draft: tampered }),
    TrainingCycleExecutionPayloadError,
  );
});
