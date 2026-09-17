"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { AdvancedExerciseExecutionFields } from "@/features/training-cycle-builder/active-workout/components/AdvancedExerciseExecutionFields";
import { TrainingCycleExecutionSyncStatus } from "@/features/training-cycle-builder/active-workout/components/TrainingCycleExecutionSyncStatus";
import { useTrainingCycleExecutionDraft, useTrainingCycleExecutionSync } from "@/features/training-cycle-builder/active-workout/hooks/use-training-cycle-execution";
import {
  buildRecordOwnTrainingCycleExecutionPayload,
  getTrainingCycleExecutionExerciseDraft,
  isTrainingCycleExecutionDraftReady,
  isTrainingCycleExecutionExerciseReady,
  projectTrainingCycleExecutionToLegacyDraft,
  type AdvancedWorkoutExecutionContext,
  type RecordOwnTrainingCycleExecutionPayload,
} from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";
import { ScopedTrainingCycleExecutionPayloadOwner } from "@/features/training-cycle-builder/active-workout/model/scoped-training-cycle-execution-payload-owner";
import type { TrainingCycleRpcSnapshot } from "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import type { AdvancedWorkoutExecutionIntegration } from "@/lib/training/advanced-workout-execution-contract";
import type { ExerciseTemplate } from "@/lib/progress/types";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";

export interface TrainingCycleActiveWorkoutControllerInput {
  readonly enabled: boolean;
  readonly userId: string | null;
  readonly storageScope: BrowserStorageScope | null;
  readonly snapshot: TrainingCycleRpcSnapshot | null;
  readonly workoutAttemptId: string | null;
  readonly performedAt: string | null;
  readonly exercises: readonly ExerciseTemplate[];
  readonly legacyDrafts: Readonly<Record<string, ExerciseDraft | undefined>>;
  readonly updateLegacyDraft: (
    exercise: ExerciseTemplate,
    patch: Partial<ExerciseDraft>,
  ) => void;
  readonly write: (payload: RecordOwnTrainingCycleExecutionPayload) => Promise<unknown>;
}

export interface TrainingCycleActiveWorkoutController {
  readonly integration?: AdvancedWorkoutExecutionIntegration;
  readonly syncStatus?: ReactNode;
  readonly captureLegacyOperationScope: () => string | null;
  readonly syncAfterLegacyCompletion: (capturedScopeKey: string | null) => void;
}

export function useTrainingCycleActiveWorkoutController(
  input: TrainingCycleActiveWorkoutControllerInput,
): TrainingCycleActiveWorkoutController {
  const { legacyDrafts, updateLegacyDraft } = input;
  const payloadOwnerRef = useRef<ScopedTrainingCycleExecutionPayloadOwner | null>(null);
  if (!payloadOwnerRef.current) {
    payloadOwnerRef.current = new ScopedTrainingCycleExecutionPayloadOwner();
  }

  const identityScopeKey = input.enabled && input.userId && input.snapshot
    ? `${input.userId}:${input.snapshot.cycleId}`
    : null;
  const activeScopeKey = identityScopeKey && input.workoutAttemptId
    ? `${identityScopeKey}:${input.workoutAttemptId}`
    : null;

  // Ref fail-closed: el nuevo render invalida antes de que pueda ejecutarse un callback legacy.
  payloadOwnerRef.current.replaceScope(activeScopeKey);

  const onPayloadReady = useCallback((payload: RecordOwnTrainingCycleExecutionPayload) => {
    payloadOwnerRef.current?.publish(payload);
  }, []);
  const context = useMemo<AdvancedWorkoutExecutionContext | undefined>(() => {
    if (
      !activeScopeKey
      || !input.snapshot
      || !input.storageScope
      || !input.workoutAttemptId
      || !input.performedAt
    ) return undefined;
    return {
      storageScope: input.storageScope,
      snapshot: input.snapshot,
      workoutAttemptId: input.workoutAttemptId,
      performedAt: input.performedAt,
      onPayloadReady,
    };
  }, [
    activeScopeKey,
    input.performedAt,
    input.snapshot,
    input.storageScope,
    input.workoutAttemptId,
    onPayloadReady,
  ]);

  const execution = useTrainingCycleExecutionDraft({
    context,
    exercises: input.exercises,
    legacyDrafts,
  });
  const payload = useMemo(() => {
    if (!execution.plan || !execution.draft) return null;
    try {
      return buildRecordOwnTrainingCycleExecutionPayload({
        plan: execution.plan,
        draft: execution.draft,
      });
    } catch {
      return null;
    }
  }, [execution.draft, execution.plan]);

  useEffect(() => {
    if (!execution.plan || !execution.draft) return;
    for (const resolved of execution.plan.exercises) {
      const advancedDraft = getTrainingCycleExecutionExerciseDraft(
        execution.draft,
        resolved.plan.snapshotId,
      );
      if (!advancedDraft) continue;
      const projection = projectTrainingCycleExecutionToLegacyDraft(advancedDraft);
      const current = legacyDrafts[resolved.legacyExercise.id];
      const sameReps = current?.reps.length === projection.reps.length
        && current.reps.every((value, index) => value === projection.reps[index]);
      if (current?.weight === projection.weight && sameReps) continue;
      updateLegacyDraft(resolved.legacyExercise, {
        weight: projection.weight,
        reps: [...projection.reps],
      });
    }
  }, [execution.draft, execution.plan, legacyDrafts, updateLegacyDraft]);

  const integration = useMemo<AdvancedWorkoutExecutionIntegration | undefined>(() => {
    if (!execution.plan || !execution.draft) return undefined;
    const exerciseByLegacyId = new Map(execution.plan.exercises.map((resolved) => {
      const draft = getTrainingCycleExecutionExerciseDraft(
        execution.draft,
        resolved.plan.snapshotId,
      );
      if (!draft) return [resolved.legacyExercise.id, null] as const;
      return [resolved.legacyExercise.id, {
        isReady: isTrainingCycleExecutionExerciseReady(draft),
        legacyDraftProjection: projectTrainingCycleExecutionToLegacyDraft(draft),
        renderRegistrationFields: (initialControlRef: Ref<HTMLInputElement>) => (
          <AdvancedExerciseExecutionFields
            resolved={resolved}
            draft={draft}
            initialControlRef={initialControlRef}
            onSetChange={(planSetId, patch) => execution.updateSet({
              planExerciseId: resolved.plan.snapshotId,
              planSetId,
              patch,
            })}
            onDropChange={(planSetId, planDropId, patch) => execution.updateDrop({
              planExerciseId: resolved.plan.snapshotId,
              planSetId,
              planDropId,
              patch,
            })}
          />
        ),
      }] as const;
    }));
    return {
      isReady: payload !== null && isTrainingCycleExecutionDraftReady(execution.draft),
      publishPendingPayload: () => {
        if (!payload) return false;
        onPayloadReady(payload);
        return true;
      },
      getExercise: (legacyExerciseId) => exerciseByLegacyId.get(legacyExerciseId) ?? null,
    };
  }, [execution, onPayloadReady, payload]);

  const [syncScopeKey, setSyncScopeKey] = useState<string | null>(null);
  const syncIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    if (identityScopeKey !== syncIdentityRef.current) {
      syncIdentityRef.current = identityScopeKey;
      setSyncScopeKey(activeScopeKey);
      return;
    }
    if (activeScopeKey) setSyncScopeKey(activeScopeKey);
  }, [activeScopeKey, identityScopeKey]);
  const sync = useTrainingCycleExecutionSync({ scopeKey: syncScopeKey, write: input.write });

  const captureLegacyOperationScope = useCallback(
    () => payloadOwnerRef.current?.captureLegacyOperationScope() ?? null,
    [],
  );
  const syncAfterLegacyCompletion = useCallback((capturedScopeKey: string | null) => {
    const pending = payloadOwnerRef.current?.consumeAfterLegacyCompletion(capturedScopeKey);
    if (pending) void sync.syncAfterLegacyCompletion(pending.payload);
  }, [sync]);
  const syncStatus = useMemo(() => {
    if (sync.state.status === "idle") return undefined;
    if (sync.state.status === "error") {
      return (
        <TrainingCycleExecutionSyncStatus
          presentation={{ status: "error", retry: () => { void sync.retry(); } }}
        />
      );
    }
    return <TrainingCycleExecutionSyncStatus presentation={{ status: sync.state.status }} />;
  }, [sync]);

  return {
    integration,
    syncStatus,
    captureLegacyOperationScope,
    syncAfterLegacyCompletion,
  };
}
