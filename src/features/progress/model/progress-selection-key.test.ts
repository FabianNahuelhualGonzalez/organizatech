import assert from "node:assert/strict";
import test from "node:test";

import {
  createProgressSelectionKey,
  reduceProgressSelectionSnapshot,
  resolveProgressSelectionState,
  type ProgressSelectionSnapshot,
} from "@/features/progress/hooks/useProgressController";
import { createInitialProgressControllerState } from "./progress-controller-state";

test("la seleccion se keyea por identidad, scope y ciclo", () => {
  const identityA = createProgressSelectionKey({
    userId: "user-a",
    scope: "supabase:user-a",
    cycleId: "cycle-1",
  });
  const tokenRefreshedA = createProgressSelectionKey({
    userId: "user-a",
    scope: "supabase:user-a",
    cycleId: "cycle-1",
  });
  const cycleChanged = createProgressSelectionKey({
    userId: "user-a",
    scope: "supabase:user-a",
    cycleId: "cycle-2",
  });
  const identityB = createProgressSelectionKey({
    userId: "user-b",
    scope: "supabase:user-b",
    cycleId: "cycle-1",
  });

  assert.equal(identityA, tokenRefreshedA);
  assert.notEqual(identityA, cycleChanged);
  assert.notEqual(identityA, identityB);
});

test("A→B y el cambio de ciclo invalidan selección; foreground conserva A", () => {
  const keyA = createProgressSelectionKey({
    userId: "user-a",
    scope: "supabase:user-a",
    cycleId: "cycle-1",
  });
  let snapshot: ProgressSelectionSnapshot = {
    key: keyA,
    state: createInitialProgressControllerState(),
  };
  snapshot = reduceProgressSelectionSnapshot(snapshot, keyA, {
    type: "exercise_selected",
    exerciseId: "exercise-a",
  });

  const sameIdentityForeground = createProgressSelectionKey({
    userId: "user-a",
    scope: "supabase:user-a",
    cycleId: "cycle-1",
  });
  assert.equal(resolveProgressSelectionState(snapshot, sameIdentityForeground).selectedExerciseId, "exercise-a");

  const nextCycle = createProgressSelectionKey({
    userId: "user-a",
    scope: "supabase:user-a",
    cycleId: "cycle-2",
  });
  assert.deepEqual(resolveProgressSelectionState(snapshot, nextCycle), createInitialProgressControllerState());

  const keyB = createProgressSelectionKey({
    userId: "user-b",
    scope: "supabase:user-b",
    cycleId: "cycle-1",
  });
  assert.deepEqual(resolveProgressSelectionState(snapshot, keyB), createInitialProgressControllerState());
  const snapshotB = reduceProgressSelectionSnapshot(snapshot, keyB, {
    type: "week_selected",
    week: 2,
  });
  assert.equal(snapshotB.key, keyB);
  assert.equal(snapshotB.state.selectedDay, "Lunes");
  assert.equal(snapshotB.state.selectedWeek, 2);
  assert.equal(snapshotB.state.selectedExerciseId, null);
  assert.equal(resolveProgressSelectionState(snapshotB, keyA).selectedExerciseId, null);
});
