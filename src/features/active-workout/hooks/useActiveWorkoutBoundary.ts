"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { useActiveWorkoutController } from "@/features/active-workout/hooks/useActiveWorkoutController";
import type {
  ActiveWorkoutActionResult,
  ActiveWorkoutBoundary,
  ActiveWorkoutCommandPorts,
  ActiveWorkoutIdentityPort,
  ActiveWorkoutIdentityReset,
  ActiveWorkoutOperation,
  ActiveWorkoutOperationContext,
  ActiveWorkoutRuntimeSnapshot,
} from "@/features/active-workout/model/active-workout-boundary-contract";
import {
  invalidateSessionOperationOwners,
  type SessionOperationOwner,
} from "@/lib/session/active-workout-session-boundary";
import {
  runActiveWorkoutOperation,
  type ActiveWorkoutOperationLocks,
} from "@/features/active-workout/model/active-workout-operation-engine";
import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";

const EMPTY_RUNTIME: ActiveWorkoutRuntimeSnapshot = {
  attemptId: null,
  pendingReadinessLink: null,
  readinessContext: null,
};

export function useActiveWorkoutBoundary(
  identity: ActiveWorkoutIdentityPort,
  commands: ActiveWorkoutCommandPorts,
): ActiveWorkoutBoundary {
  const controller = useActiveWorkoutController();
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const startOwnerRef = useRef<SessionOperationOwner | null>(null);
  const readinessOwnerRef = useRef<SessionOperationOwner | null>(null);
  const completionOwnerRef = useRef<SessionOperationOwner | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const pendingReadinessLinkRef = useRef<ActiveWorkoutRuntimeSnapshot["pendingReadinessLink"]>(null);
  const readinessContextRef = useRef<ActiveWorkoutRuntimeSnapshot["readinessContext"]>(null);
  const incomingRecoveryScopeRef = useRef<BrowserStorageScope | null>(null);

  const getRuntimeSnapshot = useCallback((): ActiveWorkoutRuntimeSnapshot => ({
    attemptId: attemptIdRef.current,
    pendingReadinessLink: pendingReadinessLinkRef.current,
    readinessContext: readinessContextRef.current,
  }), []);

  const replaceRuntimeSnapshot = useCallback((snapshot: ActiveWorkoutRuntimeSnapshot) => {
    attemptIdRef.current = snapshot.attemptId;
    pendingReadinessLinkRef.current = snapshot.pendingReadinessLink;
    readinessContextRef.current = snapshot.readinessContext;
  }, []);

  const invalidateOperations = useCallback(() => {
    invalidateSessionOperationOwners([
      startOwnerRef,
      readinessOwnerRef,
      completionOwnerRef,
    ]);
  }, []);

  const run = useCallback(async (
    operation: ActiveWorkoutOperation,
    command: (context: ActiveWorkoutOperationContext) => Promise<ActiveWorkoutActionResult | void>,
  ): Promise<ActiveWorkoutActionResult> => {
    const locks: ActiveWorkoutOperationLocks = {
      start: startOwnerRef,
      readiness: readinessOwnerRef,
      completion: completionOwnerRef,
    };
    return runActiveWorkoutOperation({
      operation,
      locks,
      identity: identityRef.current,
      actions: controller.actions,
      getRuntimeSnapshot,
      replaceRuntimeSnapshot,
      command,
    });
  }, [controller.actions, getRuntimeSnapshot, replaceRuntimeSnapshot]);

  const start = useCallback(
    () => run("start", commandsRef.current.start),
    [run],
  );
  const persistReadiness = useCallback(
    (value: TrainingReadiness) => run(
      "readiness",
      (context) => commandsRef.current.submitReadiness(value, context),
    ),
    [run],
  );
  const submitReadiness = useCallback(async (value: Omit<TrainingReadiness, "skipped">) => {
    await persistReadiness({
      motivation: value.motivation,
      hydration: value.hydration,
      sleep: value.sleep,
      energy: value.energy,
      skipped: false,
    });
  }, [persistReadiness]);
  const skipReadiness = useCallback(async () => {
    await persistReadiness({ skipped: true });
  }, [persistReadiness]);
  const complete = useCallback(
    () => run("completion", commandsRef.current.complete),
    [run],
  );
  // La pausa conserva reducer/refs: Dashboard representa el estado pausado y permite reentry
  // desde memoria. Cancelar un start usa markTrainingStopped mediante un port separado.
  const pause = useCallback(() => undefined, []);
  const resumeOrRestore = useCallback(
    () => commandsRef.current.resumeOrRestore(),
    [],
  );
  const abortStart = useCallback(() => {
    replaceRuntimeSnapshot(EMPTY_RUNTIME);
    controller.actions.abortWorkoutStart();
  }, [controller.actions, replaceRuntimeSnapshot]);
  const discard = useCallback(() => {
    replaceRuntimeSnapshot(EMPTY_RUNTIME);
    controller.actions.discardWorkout();
  }, [controller.actions, replaceRuntimeSnapshot]);
  const resetForIdentity = useCallback((input: ActiveWorkoutIdentityReset) => {
    invalidateOperations();
    replaceRuntimeSnapshot(EMPTY_RUNTIME);
    incomingRecoveryScopeRef.current = input.incomingRecoveryScope;
    controller.actions.resetActiveWorkout();
    input.resetHistory();
  }, [controller.actions, invalidateOperations, replaceRuntimeSnapshot]);
  const consumeIncomingRecoveryScope = useCallback((scope: BrowserStorageScope | null) => {
    if (incomingRecoveryScopeRef.current === scope) incomingRecoveryScopeRef.current = null;
  }, []);
  const getIncomingRecoveryScope = useCallback(
    () => incomingRecoveryScopeRef.current,
    [],
  );

  useEffect(() => () => {
    invalidateOperations();
  }, [invalidateOperations]);

  return useMemo(() => ({
    state: controller.state,
    controllerActions: controller.actions,
    start,
    submitReadiness,
    skipReadiness,
    pause,
    resumeOrRestore,
    complete,
    discard,
    resetForIdentity,
    invalidateOperations,
    getRuntimeSnapshot,
    replaceRuntimeSnapshot,
    abortStart,
    consumeIncomingRecoveryScope,
    getIncomingRecoveryScope,
  }), [
    abortStart,
    complete,
    consumeIncomingRecoveryScope,
    controller.actions,
    controller.state,
    discard,
    getIncomingRecoveryScope,
    getRuntimeSnapshot,
    invalidateOperations,
    pause,
    resumeOrRestore,
    replaceRuntimeSnapshot,
    resetForIdentity,
    skipReadiness,
    start,
    submitReadiness,
  ]);
}
