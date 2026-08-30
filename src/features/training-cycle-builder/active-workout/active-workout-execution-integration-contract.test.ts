import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { RecordOwnTrainingCycleExecutionPayload } from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";
import { ScopedTrainingCycleExecutionPayloadOwner } from "@/features/training-cycle-builder/active-workout/model/scoped-training-cycle-execution-payload-owner";

const source = (path: string) => readFileSync(path, "utf8");

const model = source("src/features/training-cycle-builder/active-workout/model/active-workout-execution.ts");
const fields = source("src/features/training-cycle-builder/active-workout/components/AdvancedExerciseExecutionFields.tsx");
const syncOwner = source("src/features/training-cycle-builder/active-workout/model/training-cycle-execution-sync-owner.ts");
const syncStatus = source("src/features/training-cycle-builder/active-workout/components/TrainingCycleExecutionSyncStatus.tsx");
const boundary = source("src/features/active-workout/components/ActiveWorkoutSheetBoundary.tsx");
const sheet = source("src/features/active-workout/components/ExerciseRegistrationSheet.tsx");
const summary = source("src/features/active-workout/components/TrainingCompletionSummaryScreen.tsx");
const controller = source("src/features/training-cycle-builder/active-workout/hooks/use-training-cycle-active-workout-controller.tsx");
const scopedPayloadOwner = source("src/features/training-cycle-builder/active-workout/model/scoped-training-cycle-execution-payload-owner.ts");
const sharedContract = source("src/lib/training/advanced-workout-execution-contract.ts");
const root = source("src/components/organizatech-app.tsx");
const payload = {
  cycleId: "00000000-0000-4000-8000-000000000001",
  expectedVersion: 1,
  performedAt: "2026-08-29T15:00:00.000-04:00",
  execution: { dayId: "00000000-0000-4000-8000-000000000002", exercises: [] },
} satisfies RecordOwnTrainingCycleExecutionPayload;

function between(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return value.slice(startIndex, endIndex);
}

test("la resolución avanzada usa exclusivamente IDs legacy y cae al flujo legacy", () => {
  const resolver = between(model, "export function resolveAdvancedWorkoutPlan", "export function createTrainingCycleExecutionDraft");
  assert.match(resolver, /legacyCycleExerciseId/);
  assert.match(resolver, /currentByLegacyId\.get\(plan\.legacyCycleExerciseId\)/);
  assert.match(resolver, /exerciseLineageId !== plan\.exerciseLineageId/);
  assert.doesNotMatch(resolver, /\.name\b/);
  assert.match(sheet, /\{advancedExecution \? \(/);
  assert.match(sheet, /\) : \(\s*<div className=\{styles\.workoutCapture\}/);
});

test("la captura incluye series, fallo y drops; el video abre con aislamiento", () => {
  for (const marker of [
    "set.completed",
    "set.reps",
    "set.kg",
    "set.reachedFailure",
    "setPlan.drops.map",
    "drop.completed",
    "drop.reps",
    "drop.kg",
  ]) assert.match(fields, new RegExp(marker.replace(".", "\\.")));
  assert.match(fields, /target="_blank"/);
  assert.match(fields, /rel="noopener noreferrer"/);
  assert.match(fields, /href=\{resolved\.plan\.safeVideoUrl\}/);
});

test("cada cambio avanzado se proyecta al draft legacy y el payload precede al write legacy", () => {
  assert.match(controller, /projectTrainingCycleExecutionToLegacyDraft\(advancedDraft\)/);
  assert.match(controller, /updateLegacyDraft\(resolved\.legacyExercise, \{/);
  const save = between(boundary, "function saveCompletedTraining()", "function retrySaveCompletedTraining()");
  assert.match(save, /if \(publishAdvancedPayload\(\)\) saveLegacyCompletedTraining\(\);/);
  const retry = between(boundary, "function retrySaveCompletedTraining()", "if \(!selectedExercise");
  assert.match(retry, /if \(publishAdvancedPayload\(\)\) retryLegacySaveCompletedTraining\(\);/);
});

test("el owner post-legacy no posee callback legacy y el summary expone un retry separado", () => {
  assert.equal((syncOwner.match(/private readonly write:/g) ?? []).length, 1);
  assert.doesNotMatch(syncOwner, /saveLegacy|retryLegacy|training_sessions|exercise_entries/);
  assert.match(syncOwner, /if \(this\.pending\) return this\.pending/);
  assert.match(syncOwner, /this\.start\(this\.payload\)/);
  assert.match(syncStatus, /presentation\.status === "error"/);
  assert.match(syncStatus, /onClick=\{presentation\.retry\}/);
  assert.match(summary, /advancedExecutionSync\?: ReactNode/);
  assert.match(summary, /\{advancedExecutionSync \?\? null\}/);
  assert.match(controller, /<TrainingCycleExecutionSyncStatus/);
});

test("el payload pendiente queda scoped y Active Workout depende sólo del contrato estable", () => {
  assert.match(scopedPayloadOwner, /readonly scopeKey: string/);
  assert.match(scopedPayloadOwner, /readonly payload: RecordOwnTrainingCycleExecutionPayload/);
  assert.match(scopedPayloadOwner, /pending\?\.scopeKey !== capturedScopeKey/);
  assert.doesNotMatch(boundary, /@\/features\/training-cycle-builder\//);
  assert.doesNotMatch(sheet, /@\/features\/training-cycle-builder\//);
  assert.doesNotMatch(summary, /@\/features\/training-cycle-builder\//);
  assert.match(boundary, /@\/lib\/training\/advanced-workout-execution-contract/);
  assert.match(sharedContract, /publishPendingPayload/);
  assert.match(root, /trainingCycleActiveWorkout\.captureLegacyOperationScope\(\)/);
  assert.match(root, /trainingCycleActiveWorkout\.syncAfterLegacyCompletion\(/);
});

test("abandono o cambio de intento invalida el payload pendiente", () => {
  const owner = new ScopedTrainingCycleExecutionPayloadOwner();
  owner.replaceScope("user-a:cycle-a:attempt-a");
  owner.publish(payload);
  const captured = owner.captureLegacyOperationScope();
  owner.replaceScope(null);
  owner.replaceScope("user-a:cycle-a:attempt-b");
  assert.equal(owner.consumeAfterLegacyCompletion(captured), null);
  assert.equal(owner.hasPendingPayload(), false);
});

test("logout/login y el siguiente workout legacy no consumen payload anterior", () => {
  const owner = new ScopedTrainingCycleExecutionPayloadOwner();
  owner.replaceScope("user-a:cycle-a:attempt-a");
  owner.publish(payload);
  const capturedBeforeLogout = owner.captureLegacyOperationScope();
  owner.replaceScope(null);
  owner.replaceScope("user-b:cycle-b:attempt-b");
  assert.equal(owner.consumeAfterLegacyCompletion(capturedBeforeLogout), null);

  owner.publish(payload);
  owner.replaceScope(null);
  assert.equal(owner.captureLegacyOperationScope(), null);
  assert.equal(owner.consumeAfterLegacyCompletion(null), null);
  assert.equal(owner.hasPendingPayload(), false);
});

test("sólo el scope capturado por la misma operación consume una vez", () => {
  const owner = new ScopedTrainingCycleExecutionPayloadOwner();
  owner.replaceScope("user-a:cycle-a:attempt-a");
  owner.publish(payload);
  const captured = owner.captureLegacyOperationScope();
  assert.equal(owner.consumeAfterLegacyCompletion("user-a:cycle-a:other"), null);
  assert.deepEqual(owner.consumeAfterLegacyCompletion(captured), { scopeKey: captured, payload });
  assert.equal(owner.consumeAfterLegacyCompletion(captured), null);
});
