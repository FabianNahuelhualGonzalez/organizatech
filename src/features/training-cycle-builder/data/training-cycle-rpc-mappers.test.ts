import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingCyclePlanDayInput } from "../components/training-cycle-builder-contracts";
import {
  canonicalMuscleToRpc,
  canonicalMuscleToUi,
  isBackendCompatibleYoutubeUrl,
  mapBuilderDaysToRpcPlan,
  mapUiExecutionToRpc,
  rpcMuscleToCanonical,
  rpcMuscleToUi,
  uiMuscleToCanonical,
  uiMuscleToRpc,
  uiOriginToRpc,
} from "./training-cycle-rpc-mappers";
import {
  TRAINING_CYCLE_UI_MUSCLES,
  TrainingCycleTransportError,
} from "./training-cycle-rpc-types";

const CATALOG_ID = "10000000-0000-4000-8000-000000000001";
const DAY_ID = "20000000-0000-4000-8000-000000000001";
const EXERCISE_ID = "30000000-0000-4000-8000-000000000001";
const SET_ID = "40000000-0000-4000-8000-000000000001";
const DROP_ID = "50000000-0000-4000-8000-000000000001";

function plan(overrides: Partial<TrainingCyclePlanDayInput["exercises"][number]["sets"][number]> = {}): TrainingCyclePlanDayInput[] {
  return [{
    day: "monday",
    name: "Empuje",
    exercises: [{
      source: { kind: "catalog", id: CATALOG_ID },
      name: "Press plano",
      muscleGroup: "Pectoral",
      order: 1,
      technique: "drop_set",
      videoUrl: "https://youtu.be/abcDEF_1234",
      sets: [{
        order: 1,
        targetReps: 10,
        targetKg: 100.25,
        toFailure: false,
        drops: [{ targetKg: 80, targetReps: 12 }],
        ...overrides,
      }],
    }],
  }];
}

test("los 12 músculos tienen round-trip UI, dominio y RPC sin heurísticas", () => {
  for (const ui of TRAINING_CYCLE_UI_MUSCLES) {
    const canonical = uiMuscleToCanonical(ui);
    const rpc = uiMuscleToRpc(ui);
    assert.equal(canonicalMuscleToUi(canonical), ui);
    assert.equal(canonicalMuscleToRpc(canonical), rpc);
    assert.equal(rpcMuscleToUi(rpc), ui);
    assert.equal(rpcMuscleToCanonical(rpc), canonical);
  }
});

test("el mapper produce allowlist exacta y convierte órdenes UI 1-based a RPC 0-based", () => {
  const mapped = mapBuilderDaysToRpcPlan(plan());
  assert.deepEqual(mapped, {
    days: [{
      day: "monday",
      name: "Empuje",
      order: 0,
      exercises: [{
        catalogExerciseId: CATALOG_ID,
        order: 0,
        technique: "drop_set",
        videoUrl: "https://youtu.be/abcDEF_1234",
        sets: [{
          order: 0,
          targetReps: 10,
          targetKg: 100.25,
          toFailure: false,
          drops: [{ order: 0, kg: 80, reps: 12 }],
        }],
      }],
    }],
  });
  const serialized = JSON.stringify(mapped);
  assert.doesNotMatch(serialized, /userId|ownerId|muscleGroup|"name":"Press plano"/);
});

test("un borrador incompleto falla cerrado y no inventa reps ni kilos", () => {
  assert.throws(
    () => mapBuilderDaysToRpcPlan(plan({ targetKg: null })),
    (error) => error instanceof TrainingCycleTransportError && error.code === "incomplete_plan",
  );
  assert.throws(
    () => mapBuilderDaysToRpcPlan(plan({ targetKg: 100.123 })),
    (error) => error instanceof TrainingCycleTransportError && error.code === "invalid_input",
  );
});

test("un custom debe tener UUID persistido y drop_set debe tener una descarga", () => {
  const base = plan();
  const customPlan: TrainingCyclePlanDayInput[] = [{
    ...base[0]!,
    exercises: [{
      ...base[0]!.exercises[0]!,
      source: { kind: "custom", id: "60000000-0000-4000-8000-000000000001" },
    }],
  }];
  const mapped = mapBuilderDaysToRpcPlan(customPlan);
  assert.equal(mapped.days[0]!.exercises[0]!.customExerciseId, "60000000-0000-4000-8000-000000000001");

  const missingDrop = plan({ drops: [] });
  assert.throws(
    () => mapBuilderDaysToRpcPlan(missingDrop),
    (error) => error instanceof TrainingCycleTransportError && error.code === "incomplete_plan",
  );
});

test("la ejecución conserva IDs de snapshot y convierte todas las órdenes", () => {
  const result = mapUiExecutionToRpc({
    dayId: DAY_ID,
    exercises: [{
      planExerciseId: EXERCISE_ID,
      order: 1,
      sets: [{
        planSetId: SET_ID,
        order: 1,
        completed: true,
        reps: 10,
        kg: 100,
        reachedFailure: false,
        drops: [{ planDropId: DROP_ID, order: 1, completed: true, reps: 12, kg: 80 }],
      }],
    }],
  });
  assert.equal(result.exercises[0]!.order, 0);
  assert.equal(result.exercises[0]!.sets[0]!.order, 0);
  assert.equal(result.exercises[0]!.sets[0]!.drops[0]!.order, 0);
  assert.equal(result.exercises[0]!.sets[0]!.planSetId, SET_ID);
});

test("resume no es un origen persistible y YouTube replica el límite SQL", () => {
  assert.throws(() => uiOriginToRpc("resume" as "manual"));
  assert.equal(isBackendCompatibleYoutubeUrl("https://youtu.be/abcDEF_1234"), true);
  assert.equal(isBackendCompatibleYoutubeUrl("https://youtube.com/watch?v=x"), false);
  assert.equal(isBackendCompatibleYoutubeUrl("https://example.com/video"), false);
});
