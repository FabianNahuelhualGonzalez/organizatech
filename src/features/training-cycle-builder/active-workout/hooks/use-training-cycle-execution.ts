"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createTrainingCycleExecutionDraft,
  resolveAdvancedWorkoutPlan,
  seedTrainingCycleExecutionDraftFromLegacy,
  updateTrainingCycleExecutionDrop,
  updateTrainingCycleExecutionSet,
  type AdvancedWorkoutExecutionContext,
  type ResolvedAdvancedWorkoutPlan,
  type TrainingCycleExecutionDraft,
  type TrainingCycleExecutionDropPatch,
  type TrainingCycleExecutionSetPatch,
} from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";
import {
  clearTrainingCycleExecutionDraft,
  loadTrainingCycleExecutionDraft,
  saveTrainingCycleExecutionDraft,
} from "@/features/training-cycle-builder/active-workout/model/training-cycle-execution-draft-storage";
import {
  TrainingCycleExecutionSyncOwner,
  type TrainingCycleExecutionSyncState,
  type TrainingCycleExecutionSyncWriter,
} from "@/features/training-cycle-builder/active-workout/model/training-cycle-execution-sync-owner";
import type { ExerciseTemplate } from "@/lib/progress/types";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";

interface DraftPublication {
  readonly scopeKey: string | null;
  readonly draft: TrainingCycleExecutionDraft | null;
}

function getPlanScopeKey(plan: ResolvedAdvancedWorkoutPlan | null) {
  return plan ? JSON.stringify([
    plan.storageScope,
    plan.cycleId,
    plan.expectedVersion,
    plan.planSnapshotId,
    plan.daySnapshotId,
    plan.workoutAttemptId,
    plan.performedAt,
  ]) : null;
}

export function useTrainingCycleExecutionDraft(input: {
  readonly context?: AdvancedWorkoutExecutionContext;
  readonly exercises: readonly ExerciseTemplate[];
  readonly legacyDrafts: Readonly<Record<string, ExerciseDraft | undefined>>;
}) {
  const { context, exercises, legacyDrafts } = input;
  const resolution = useMemo(
    () => resolveAdvancedWorkoutPlan({ context, exercises }),
    [context, exercises],
  );
  const plan = resolution.kind === "advanced" ? resolution.plan : null;
  const scopeKey = getPlanScopeKey(plan);
  const initialDraft = useMemo(
    () => plan ? seedTrainingCycleExecutionDraftFromLegacy(
      createTrainingCycleExecutionDraft(plan, 0),
      legacyDrafts,
    ) : null,
    [legacyDrafts, plan],
  );
  const [publication, setPublication] = useState<DraftPublication>({
    scopeKey: null,
    draft: null,
  });
  const visibleDraft = publication.scopeKey === scopeKey ? publication.draft : initialDraft;
  const planRef = useRef(plan);
  const scopeKeyRef = useRef(scopeKey);
  const draftRef = useRef(visibleDraft);
  const legacyDraftsRef = useRef(legacyDrafts);
  planRef.current = plan;
  scopeKeyRef.current = scopeKey;
  draftRef.current = visibleDraft;
  legacyDraftsRef.current = legacyDrafts;

  useEffect(() => {
    if (!plan || !scopeKey) {
      draftRef.current = null;
      setPublication({ scopeKey: null, draft: null });
      return;
    }
    const now = Date.now();
    const next = loadTrainingCycleExecutionDraft(plan, { now: () => now })
      ?? seedTrainingCycleExecutionDraftFromLegacy(
        createTrainingCycleExecutionDraft(plan, now),
        legacyDraftsRef.current,
      );
    draftRef.current = next;
    setPublication({ scopeKey, draft: next });
    saveTrainingCycleExecutionDraft(plan, next, { now: () => now });
  }, [plan, scopeKey]);

  const commit = useCallback((
    update: (current: TrainingCycleExecutionDraft, updatedAt: number) => TrainingCycleExecutionDraft,
  ) => {
    const currentPlan = planRef.current;
    const currentScopeKey = scopeKeyRef.current;
    const current = draftRef.current;
    if (!currentPlan || !currentScopeKey || !current) return null;
    const now = Date.now();
    const next = update(current, now);
    if (next === current) return current;
    draftRef.current = next;
    setPublication({ scopeKey: currentScopeKey, draft: next });
    saveTrainingCycleExecutionDraft(currentPlan, next, { now: () => now });
    return next;
  }, []);

  const updateSet = useCallback((input: {
    readonly planExerciseId: string;
    readonly planSetId: string;
    readonly patch: TrainingCycleExecutionSetPatch;
  }) => commit((current, updatedAt) => updateTrainingCycleExecutionSet(current, {
    ...input,
    updatedAt,
  })), [commit]);

  const updateDrop = useCallback((input: {
    readonly planExerciseId: string;
    readonly planSetId: string;
    readonly planDropId: string;
    readonly patch: TrainingCycleExecutionDropPatch;
  }) => commit((current, updatedAt) => updateTrainingCycleExecutionDrop(current, {
    ...input,
    updatedAt,
  })), [commit]);

  const clear = useCallback(() => {
    const currentPlan = planRef.current;
    if (!currentPlan) return false;
    const cleared = clearTrainingCycleExecutionDraft(currentPlan);
    const next = createTrainingCycleExecutionDraft(currentPlan, Date.now());
    draftRef.current = next;
    setPublication({ scopeKey: scopeKeyRef.current, draft: next });
    return cleared;
  }, []);

  return {
    plan,
    draft: visibleDraft,
    updateSet,
    updateDrop,
    clear,
  } as const;
}

export function useTrainingCycleExecutionSync(input: {
  readonly scopeKey: string | null;
  readonly write: TrainingCycleExecutionSyncWriter;
}) {
  const writeRef = useRef(input.write);
  writeRef.current = input.write;
  const [state, setState] = useState<TrainingCycleExecutionSyncState>({ status: "idle" });
  const ownerRef = useRef<TrainingCycleExecutionSyncOwner | null>(null);
  if (!ownerRef.current) {
    ownerRef.current = new TrainingCycleExecutionSyncOwner(
      (payload) => writeRef.current(payload),
      setState,
    );
  }

  useEffect(() => {
    ownerRef.current?.replaceScope(input.scopeKey);
    return () => ownerRef.current?.replaceScope(null);
  }, [input.scopeKey]);

  const syncAfterLegacyCompletion = useCallback((
    payload: Parameters<TrainingCycleExecutionSyncOwner["syncAfterLegacyCompletion"]>[0],
  ) => ownerRef.current?.syncAfterLegacyCompletion(payload) ?? Promise.resolve(false), []);
  const retry = useCallback(
    () => ownerRef.current?.retry() ?? Promise.resolve(false),
    [],
  );

  return { state, syncAfterLegacyCompletion, retry } as const;
}
