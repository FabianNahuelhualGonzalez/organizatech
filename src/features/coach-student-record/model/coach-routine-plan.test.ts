import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingCycleRpcSnapshot } from
  "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import { editablePlan, replaceRoutine } from "./coach-routine-plan";

const snapshot: TrainingCycleRpcSnapshot = {
  cycleId: "cycle", portalScope: "usuario", cycleNumber: 1, goal: "strength",
  startDate: "2026-11-26", endDate: "2026-12-26", status: "active", daysUntilEnd: 30,
  version: 3, snapshotId: "version", extensionCount: 0, sourceDraftId: null,
  sourceCycleId: null, closedAt: null, closedReason: null, createdAt: "now", updatedAt: "now",
  plan: { days: [
    { snapshotId: "day-a", day: "monday", name: "A", order: 0, legacyCycleDayId: null,
      exercises: [{ snapshotId: "exercise", source: { kind: "catalog", id: "source" },
        exerciseLineageId: "lineage", name: "Sentadilla", muscleGroup: "cuadriceps",
        order: 0, technique: "linear", videoUrl: null, legacyCycleExerciseId: null,
        sets: [{ snapshotId: "set", order: 0, targetReps: 8, targetKg: 70,
          toFailure: false, drops: [] }] }] },
    { snapshotId: "day-b", day: "tuesday", name: "B", order: 1,
      legacyCycleDayId: null, exercises: [] },
  ] },
};

test("editar una rutina conserva la otra y elimina los ID inmutables del snapshot", () => {
  const plan = editablePlan(snapshot);
  const changed = replaceRoutine(plan, 1, { ...plan.days[1], name: "B editada" });
  assert.deepEqual(changed.days[0], plan.days[0]);
  assert.equal(changed.days[1].name, "B editada");
  assert.equal(changed.days[0].exercises[0].sets[0].targetKg, 70);
  assert.equal(JSON.stringify(changed).includes("snapshotId"), false);
  assert.equal(snapshot.plan.days[1].name, "B");
});

test("quitar una rutina sólo modifica el plan nuevo y reordena las restantes", () => {
  const original = editablePlan(snapshot);
  const next = replaceRoutine(original, 0, null);
  assert.deepEqual(next.days.map((day) => [day.name, day.order]), [["B", 0]]);
  assert.equal(original.days.length, 2);
});
