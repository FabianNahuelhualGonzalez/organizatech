"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { resolveRoutineBuilderDraftRecovery } from "@/features/routine-builder/model/routine-builder-draft-recovery";
import {
  createRoutineBuilderRow,
  createRoutineBuilderState,
  routineBuilderReducer,
  type RoutineBuilderRowFieldUpdate,
  type RoutineBuilderState,
} from "@/features/routine-builder/model/routine-builder-state";
import {
  createRoutineBuilderOperationRegistry,
  runCycleCreateWorkflow,
  runCycleDeleteWorkflow,
  runRoutineSaveWorkflow,
  type RoutineBuilderCycleDeleteContext,
  type RoutineBuilderOwnedOperationContext,
  type RoutineBuilderOwnedWorkflowRunResult,
  type RoutineBuilderOperationRegistry,
  type RoutineBuilderRoutineSaveContext,
} from "@/features/routine-builder/model/routine-builder-operation-owner";
import type { RoutineBuilderSaveConfirmation } from "@/features/routine-builder/model/routine-builder-save";
import type { Screen } from "@/lib/navigation/app-navigation";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";
import {
  ROUTINE_DRAFT_VERSION,
  loadRoutineDraft,
  loadTrainingPlan,
  saveRoutineDraft,
  saveTrainingPlan,
} from "@/lib/storage/app-flow-storage";
import {
  getBrowserStorageScope,
  type BrowserStorageLike,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";
import type { DataMode } from "@/lib/supabase/session";
import { removeAccents } from "@/lib/training/exercise-name-normalization";
import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  applyTrainingPlanEdit,
  type TrainingPlanEdit,
  type TrainingPlanEditResult,
} from "@/lib/training/training-plan-controller";
import { getRoutineDays } from "@/lib/training/training-plan-calculations";
import { sortTrainingDaysByWeekOrder, TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import { normalizeTrainingPlanInput } from "@/lib/training/training-plan-normalization";
import { createDefaultTrainingPlan } from "@/lib/training/training-plan-rules";
import type { SetupDayState, SetupExerciseRow } from "@/lib/training/training-routine-draft";

type TrainingDayLabel = (typeof TRAINING_DAY_LABELS)[number];

export type RoutineBuilderModal =
  | "new-cycle-confirm"
  | "delete-cycle-confirm"
  | "routine-success"
  | "routine-update-confirm";

export interface RoutineBuilderTransientState {
  readonly isEditingRoutinePlan: boolean;
  readonly routineEditorReturnScreen: Screen | null;
  readonly notice: string;
  readonly openModals: Readonly<Record<RoutineBuilderModal, boolean>>;
}

type RoutineBuilderTransientAction =
  | { type: "begin_edit"; returnScreen?: Screen | null }
  | { type: "finish_edit" }
  | { type: "set_return_screen"; screen: Screen | null }
  | { type: "publish_notice"; message: string }
  | { type: "open_modal"; modal: RoutineBuilderModal }
  | { type: "close_modal"; modal: RoutineBuilderModal }
  | { type: "reset_transient" };

export function createRoutineBuilderTransientState(): RoutineBuilderTransientState {
  return {
    isEditingRoutinePlan: false,
    routineEditorReturnScreen: null,
    notice: "",
    openModals: createClosedRoutineBuilderModals(),
  };
}

function createClosedRoutineBuilderModals(): Record<RoutineBuilderModal, boolean> {
  return {
    "new-cycle-confirm": false,
    "delete-cycle-confirm": false,
    "routine-success": false,
    "routine-update-confirm": false,
  };
}

export function routineBuilderTransientReducer(
  state: RoutineBuilderTransientState,
  action: RoutineBuilderTransientAction,
): RoutineBuilderTransientState {
  switch (action.type) {
    case "begin_edit":
      return {
        ...state,
        isEditingRoutinePlan: true,
        routineEditorReturnScreen: action.returnScreen === undefined
          ? state.routineEditorReturnScreen
          : action.returnScreen,
      };
    case "finish_edit":
      return { ...state, isEditingRoutinePlan: false };
    case "set_return_screen":
      return { ...state, routineEditorReturnScreen: action.screen };
    case "publish_notice":
      return { ...state, notice: action.message };
    case "open_modal":
      return { ...state, openModals: { ...state.openModals, [action.modal]: true } };
    case "close_modal":
      return { ...state, openModals: { ...state.openModals, [action.modal]: false } };
    case "reset_transient":
      return {
        isEditingRoutinePlan: false,
        routineEditorReturnScreen: null,
        notice: "",
        openModals: createClosedRoutineBuilderModals(),
      };
  }
}

function createRoutineBuilderId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSetupRows(): SetupExerciseRow[] {
  return Array.from({ length: 4 }, () => createRoutineBuilderRow(createRoutineBuilderId()));
}

export function createSetupDayState(): SetupDayState {
  return { routineName: "", rows: createSetupRows() };
}

export function createSetupByDay(): Record<TrainingDayLabel, SetupDayState> {
  return Object.fromEntries(
    TRAINING_DAY_LABELS.map((day) => [day, createSetupDayState()]),
  ) as Record<TrainingDayLabel, SetupDayState>;
}

export function normalizePersistedTrainingPlan(value: unknown): TrainingPlan {
  return normalizeTrainingPlanInput(value).plan;
}

export interface RoutineBuilderIdentityPort {
  captureRequestToken(): SessionDataRequestToken;
  isRequestTokenCurrent(token: SessionDataRequestToken): boolean;
}

export interface RoutineBuilderControllerOptions {
  identity: RoutineBuilderIdentityPort;
  dataMode: DataMode;
}

export interface RoutineBuilderTrainingDataState {
  readonly draftPlan: TrainingPlan;
  readonly activeRoutineDay: string;
}

export interface RoutineBuilderTrainingDataProjection {
  readonly mode: "legacy" | "cycle-scoped" | "blocked";
  readonly plan: TrainingPlan;
  readonly exercises: readonly ExerciseTemplate[];
  readonly hasActiveCycle: boolean;
  readonly legacyExercises?: readonly ExerciseTemplate[];
}

export type ResolveRoutineBuilderTrainingDataProjection = (
  currentDraftPlan: TrainingPlan,
) => RoutineBuilderTrainingDataProjection;

export function sameTrainingDayList(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = sortTrainingDaysByWeekOrder(
    left.filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)),
  );
  const normalizedRight = sortTrainingDaysByWeekOrder(
    right.filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)),
  );
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((day, index) => day === normalizedRight[index]);
}

export function mergeTrainingPlanWithExercises(
  plan: TrainingPlan,
  exercises: readonly ExerciseTemplate[],
): TrainingPlan {
  const routineDays = getRoutineDays([...exercises]);
  if (routineDays.length === 0) return plan;
  const hasDefaultDays = sameTrainingDayList(
    plan.trainingDays,
    createDefaultTrainingPlan().trainingDays,
  );
  if (hasDefaultDays) return { ...plan, trainingDays: routineDays };
  return {
    ...plan,
    trainingDays: sortTrainingDaysByWeekOrder(
      plan.trainingDays.filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)),
    ),
  };
}

export function getVisibleTrainingDay(
  exercises: readonly ExerciseTemplate[],
  current: string,
) {
  if (exercises.some((exercise) => exercise.day === current)) return current;

  const today = new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date());
  const normalizedToday = TRAINING_DAY_LABELS.find((day) =>
    removeAccents(day.toLowerCase()) === removeAccents(today.toLowerCase()));
  if (normalizedToday && exercises.some((exercise) => exercise.day === normalizedToday)) {
    return normalizedToday;
  }

  return exercises.find((exercise) => exercise.day)?.day ?? current;
}

export function reconcileRoutineBuilderTrainingDataState(
  current: RoutineBuilderTrainingDataState,
  resolveView: ResolveRoutineBuilderTrainingDataProjection,
): RoutineBuilderTrainingDataState {
  const view = resolveView(current.draftPlan);
  const draftPlan = view.hasActiveCycle
    ? view.plan
    : view.mode === "legacy" && view.legacyExercises
      ? mergeTrainingPlanWithExercises(current.draftPlan, view.legacyExercises)
      : current.draftPlan;
  const activeRoutineDay = view.mode === "blocked"
    ? current.activeRoutineDay
    : getVisibleTrainingDay(view.exercises, current.activeRoutineDay);
  return { draftPlan, activeRoutineDay };
}

export function createRoutineBuilderTrainingDataRefreshUpdater(
  resolveView: ResolveRoutineBuilderTrainingDataProjection,
) {
  return (current: RoutineBuilderTrainingDataState) =>
    reconcileRoutineBuilderTrainingDataState(current, resolveView);
}

export interface RoutineBuilderController {
  readonly activeDay: string;
  readonly setupByDay: Readonly<Record<string, SetupDayState>>;
  readonly draftPlan: TrainingPlan;
  readonly activeRoutineDay: string;
  readonly isEditingRoutinePlan: boolean;
  readonly routineEditorReturnScreen: Screen | null;
  readonly notice: string;
  readonly isRoutineSuccessOpen: boolean;
  readonly isRoutineUpdateConfirmOpen: boolean;
  readonly isNewCycleConfirmOpen: boolean;
  readonly isDeleteCycleConfirmOpen: boolean;
  replaceBuilderState(state: RoutineBuilderState): void;
  resetBuilder(activeDay?: string): void;
  selectRoutineDay(day: string): void;
  updateRow(rowId: string, update: RoutineBuilderRowFieldUpdate): void;
  replaceRows(rows: SetupExerciseRow[]): void;
  renameRoutine(routineName: string): void;
  addRow(): void;
  removeRow(rowId: string, allowEmptyRows: boolean): void;
  replaceDraft(plan: TrainingPlan): void;
  replaceDraftTrainingDays(trainingDays: readonly string[]): void;
  applyDraftEdit(edit: TrainingPlanEdit): TrainingPlanEditResult;
  selectActiveRoutineDay(day: string): void;
  reconcileTrainingDataRefresh(resolveView: ResolveRoutineBuilderTrainingDataProjection): void;
  beginEdit(returnScreen?: Screen | null): void;
  finishEdit(): void;
  setReturnDestination(screen: Screen | null): void;
  publishNotice(message: string): void;
  clearNotice(): void;
  openModal(modal: RoutineBuilderModal): void;
  closeModal(modal: RoutineBuilderModal): void;
  resetTransient(): void;
  replaceIdentityScope(scope: BrowserStorageScope | null): void;
  restoreDraft(mode: DataMode, userId?: string): { restored: false } | { restored: true; message: string };
  runRoutineSave<T>(execute: (context: RoutineBuilderRoutineSaveContext) => Promise<T>):
    Promise<RoutineBuilderOwnedWorkflowRunResult<T>>;
  runCycleCreate<T>(execute: (context: RoutineBuilderOwnedOperationContext) => Promise<T>):
    Promise<RoutineBuilderOwnedWorkflowRunResult<T>>;
  runCycleDelete<T>(execute: (context: RoutineBuilderCycleDeleteContext) => Promise<T>):
    Promise<RoutineBuilderOwnedWorkflowRunResult<T>>;
  invalidateOperations(): void;
}

export interface RoutineBuilderWorkflowAdapters {
  saveInitialRoutine(
    confirmation: RoutineBuilderSaveConfirmation,
    context: RoutineBuilderRoutineSaveContext,
  ): Promise<void>;
  startNewTrainingCycle(context: RoutineBuilderOwnedOperationContext): Promise<void>;
  deleteCurrentTrainingCycle(context: RoutineBuilderCycleDeleteContext): Promise<void>;
  onFinalized(operation: "routine-save" | "cycle-create" | "cycle-delete"): void;
  onUnexpectedError(operation: "routine-save" | "cycle-create" | "cycle-delete", error: unknown): void;
}

export interface RoutineBuilderWorkflows {
  saveInitialRoutine(confirmation: RoutineBuilderSaveConfirmation): Promise<void>;
  startNewTrainingCycle(): Promise<void>;
  deleteCurrentTrainingCycle(): Promise<void>;
}

export function invalidateRoutineBuilderIdentity(registry: RoutineBuilderOperationRegistry) {
  registry.invalidateAll();
}

export function disposeRoutineBuilderController(registry: RoutineBuilderOperationRegistry) {
  registry.invalidateAll();
}

export interface RoutineBuilderDraftSnapshot {
  readonly activeDay: string;
  readonly setupByDay: Readonly<Record<string, SetupDayState>>;
  readonly draftPlan: TrainingPlan;
  readonly activeRoutineDay: string;
  readonly isEditingRoutinePlan: boolean;
  readonly routineEditorReturnScreen: Screen | null;
}

export function persistRoutineBuilderPlan(input: {
  snapshot: Pick<RoutineBuilderDraftSnapshot, "draftPlan">;
  dataMode: DataMode;
  userId?: string;
  activeStorageScope: BrowserStorageScope | null;
  write?: typeof saveTrainingPlan;
}): boolean {
  const scope = getBrowserStorageScope(input.dataMode, input.userId);
  if (!scope || input.activeStorageScope !== scope) return false;
  const write = input.write ?? saveTrainingPlan;
  return write(input.snapshot.draftPlan, scope, {
    serialize: (plan) => ({ ...plan, trainingDays: sortTrainingDaysByWeekOrder(plan.trainingDays) }),
  });
}

export function persistRoutineBuilderDraft(input: {
  snapshot: RoutineBuilderDraftSnapshot;
  screen: Screen;
  dataMode: DataMode;
  userId?: string;
  activeStorageScope: BrowserStorageScope | null;
  hasRoutinePlan: boolean;
  now?: () => number;
  write?: typeof saveRoutineDraft;
}): boolean {
  const active = input.screen === "registro-entrenamiento" &&
    (!input.hasRoutinePlan || input.snapshot.isEditingRoutinePlan);
  if (!active) return false;
  const userKey = getBrowserStorageScope(input.dataMode, input.userId);
  if (!userKey || input.activeStorageScope !== userKey) return false;
  const write = input.write ?? saveRoutineDraft;
  write({
    version: ROUTINE_DRAFT_VERSION,
    updatedAt: input.now?.() ?? Date.now(),
    dataMode: input.dataMode,
    userKey,
    screen: "registro-entrenamiento",
    setupDay: input.snapshot.activeDay,
    setupByDay: input.snapshot.setupByDay,
    trainingPlan: input.snapshot.draftPlan,
    isEditingRoutinePlan: input.snapshot.isEditingRoutinePlan,
    routineEditorReturnScreen: input.snapshot.routineEditorReturnScreen,
    activeRoutineDay: input.snapshot.activeRoutineDay,
  });
  return true;
}

export function loadRoutineBuilderDraft(input: {
  mode: DataMode;
  userId?: string;
  now?: () => number;
  storage?: BrowserStorageLike | null;
}) {
  return loadRoutineDraft(input.mode, input.userId, {
    setupDays: TRAINING_DAY_LABELS,
    resolveSetupRecovery(value) {
      const result = resolveRoutineBuilderDraftRecovery(value);
      if (result.kind === "discard") {
        return { kind: "discard" as const, shouldClearStoredDraft: true as const };
      }
      return {
        kind: "restore" as const,
        setupDay: result.state.activeDay,
        setupByDay: result.state.setupByDay,
        recovery: result.recovery,
      };
    },
    normalizeTrainingPlan: normalizePersistedTrainingPlan,
    now: input.now,
    storage: input.storage,
  });
}

export function useRoutineBuilderController({
  identity,
  dataMode,
}: RoutineBuilderControllerOptions): RoutineBuilderController {
  const [builderState, dispatchBuilder] = useReducer(
    routineBuilderReducer,
    undefined,
    () => createRoutineBuilderState({ activeDay: "Lunes", setupByDay: createSetupByDay() }),
  );
  const [trainingDataState, setTrainingDataState] = useState<RoutineBuilderTrainingDataState>(() => ({
    draftPlan: createDefaultTrainingPlan(),
    activeRoutineDay: "Lunes",
  }));
  const { draftPlan, activeRoutineDay } = trainingDataState;
  const draftPlanRef = useRef(draftPlan);
  draftPlanRef.current = draftPlan;
  const builderStateRef = useRef(builderState);
  builderStateRef.current = builderState;
  const [transient, dispatchTransient] = useReducer(
    routineBuilderTransientReducer,
    undefined,
    createRoutineBuilderTransientState,
  );
  const operationRegistryRef = useRef<RoutineBuilderOperationRegistry | null>(null);
  operationRegistryRef.current ??= createRoutineBuilderOperationRegistry(identity);
  const operationRegistry = operationRegistryRef.current;

  const invalidateOperations = useCallback(() => operationRegistry.invalidateAll(), [operationRegistry]);
  useEffect(() => () => disposeRoutineBuilderController(operationRegistry), [operationRegistry]);

  const resetTransient = useCallback(() => {
    operationRegistry.invalidateAll();
    dispatchTransient({ type: "reset_transient" });
  }, [operationRegistry]);

  const replaceIdentityScope = useCallback((scope: BrowserStorageScope | null) => {
    invalidateRoutineBuilderIdentity(operationRegistry);
    dispatchBuilder({ type: "reset_state", setupByDay: createSetupByDay(), activeDay: "Lunes" });
    setTrainingDataState({
      draftPlan: scope
        ? loadTrainingPlan(scope, {
            normalize: normalizePersistedTrainingPlan,
            createDefault: createDefaultTrainingPlan,
          })
        : createDefaultTrainingPlan(),
      activeRoutineDay: "Lunes",
    });
    dispatchTransient({ type: "reset_transient" });
  }, [operationRegistry]);

  const restoreDraft = useCallback((mode: DataMode, userId?: string) => {
    const draft = loadRoutineBuilderDraft({ mode, userId });
    if (!draft) return { restored: false as const };
    dispatchBuilder({ type: "replace_state", state: { activeDay: draft.setupDay, setupByDay: draft.setupByDay } });
    setTrainingDataState({
      draftPlan: draft.trainingPlan,
      activeRoutineDay: draft.activeRoutineDay,
    });
    dispatchTransient({
      type: draft.isEditingRoutinePlan ? "begin_edit" : "finish_edit",
      ...(draft.isEditingRoutinePlan ? { returnScreen: draft.routineEditorReturnScreen } : {}),
    });
    if (!draft.isEditingRoutinePlan) {
      dispatchTransient({ type: "set_return_screen", screen: draft.routineEditorReturnScreen });
    }
    const message = draft.recovery.kind === "full"
      ? "Recuperamos tu avance pendiente."
      : draft.recovery.discardedRowCount === 1
        ? "Recuperamos parte de tu avance pendiente. Se descartó 1 fila inválida."
        : `Recuperamos parte de tu avance pendiente. Se descartaron ${draft.recovery.discardedRowCount} filas inválidas.`;
    return { restored: true as const, message };
  }, []);

  const applyDraftEdit = useCallback((edit: TrainingPlanEdit) => {
    const currentPlan = draftPlanRef.current;
    const currentBuilderState = builderStateRef.current;
    const result = applyTrainingPlanEdit(
      { plan: currentPlan, activeDay: currentBuilderState.activeDay },
      edit,
    );
    if (result.kind === "updated") {
      setTrainingDataState((current) => ({ ...current, draftPlan: result.state.plan }));
      if (result.state.activeDay !== currentBuilderState.activeDay) {
        dispatchBuilder({ type: "select_day", day: result.state.activeDay });
      }
    }
    return result;
  }, []);

  return {
    activeDay: builderState.activeDay,
    setupByDay: builderState.setupByDay,
    draftPlan,
    activeRoutineDay,
    isEditingRoutinePlan: transient.isEditingRoutinePlan,
    routineEditorReturnScreen: transient.routineEditorReturnScreen,
    notice: transient.notice,
    isRoutineSuccessOpen: transient.openModals["routine-success"],
    isRoutineUpdateConfirmOpen: transient.openModals["routine-update-confirm"],
    isNewCycleConfirmOpen: transient.openModals["new-cycle-confirm"],
    isDeleteCycleConfirmOpen: transient.openModals["delete-cycle-confirm"],
    replaceBuilderState: (state) => dispatchBuilder({ type: "replace_state", state }),
    resetBuilder: (activeDay = "Lunes") => dispatchBuilder({ type: "reset_state", setupByDay: createSetupByDay(), activeDay }),
    selectRoutineDay: (day) => dispatchBuilder({ type: "select_day", day }),
    updateRow: (rowId, update) => dispatchBuilder({ type: "update_row_field", rowId, update }),
    replaceRows: (rows) => dispatchBuilder({ type: "replace_rows", rows }),
    renameRoutine: (routineName) => dispatchBuilder({ type: "set_routine_name", routineName }),
    addRow: () => dispatchBuilder({ type: "add_row", row: createRoutineBuilderRow(createRoutineBuilderId()) }),
    removeRow: (rowId, allowEmptyRows) => dispatchBuilder({ type: "remove_row", rowId, allowEmptyRows }),
    replaceDraft: (plan) => setTrainingDataState((current) => ({ ...current, draftPlan: plan })),
    replaceDraftTrainingDays: (trainingDays) => setTrainingDataState((current) => ({
      ...current,
      draftPlan: { ...current.draftPlan, trainingDays: [...trainingDays] },
    })),
    applyDraftEdit,
    selectActiveRoutineDay: (day) => setTrainingDataState((current) => ({
      ...current,
      activeRoutineDay: day,
    })),
    reconcileTrainingDataRefresh: (resolveView) => setTrainingDataState(
      createRoutineBuilderTrainingDataRefreshUpdater(resolveView),
    ),
    beginEdit: (returnScreen) => dispatchTransient({ type: "begin_edit", returnScreen }),
    finishEdit: () => dispatchTransient({ type: "finish_edit" }),
    setReturnDestination: (screen) => dispatchTransient({ type: "set_return_screen", screen }),
    publishNotice: (message) => dispatchTransient({ type: "publish_notice", message }),
    clearNotice: () => dispatchTransient({ type: "publish_notice", message: "" }),
    openModal: (modal) => dispatchTransient({ type: "open_modal", modal }),
    closeModal: (modal) => dispatchTransient({ type: "close_modal", modal }),
    resetTransient,
    replaceIdentityScope,
    restoreDraft,
    runRoutineSave: (execute) => runRoutineSaveWorkflow({
      registry: operationRegistry,
      dataMode,
      execute,
    }),
    runCycleCreate: (execute) => runCycleCreateWorkflow({
      registry: operationRegistry,
      dataMode,
      execute,
    }),
    runCycleDelete: (execute) => runCycleDeleteWorkflow({
      registry: operationRegistry,
      dataMode,
      execute,
    }),
    invalidateOperations,
  };
}

export function useRoutineBuilderWorkflows(
  controller: RoutineBuilderController,
  adapters: RoutineBuilderWorkflowAdapters,
): RoutineBuilderWorkflows {
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const adaptersRef = useRef(adapters);
  adaptersRef.current = adapters;

  const completeRun = useCallback((
    operation: "routine-save" | "cycle-create" | "cycle-delete",
    result: RoutineBuilderOwnedWorkflowRunResult<void>,
  ) => {
    if (result.kind === "error") adaptersRef.current.onUnexpectedError(operation, result.error);
    if (result.kind !== "busy" && result.finalized) adaptersRef.current.onFinalized(operation);
  }, []);

  const saveInitialRoutine = useCallback(async (confirmation: RoutineBuilderSaveConfirmation) => {
    const result = await controllerRef.current.runRoutineSave((context) =>
      adaptersRef.current.saveInitialRoutine(confirmation, context));
    completeRun("routine-save", result);
  }, [completeRun]);

  const startNewTrainingCycle = useCallback(async () => {
    const result = await controllerRef.current.runCycleCreate((context) =>
      adaptersRef.current.startNewTrainingCycle(context));
    completeRun("cycle-create", result);
  }, [completeRun]);

  const deleteCurrentTrainingCycle = useCallback(async () => {
    const result = await controllerRef.current.runCycleDelete((context) =>
      adaptersRef.current.deleteCurrentTrainingCycle(context));
    completeRun("cycle-delete", result);
  }, [completeRun]);

  return { saveInitialRoutine, startNewTrainingCycle, deleteCurrentTrainingCycle };
}

export function useRoutineBuilderDraftLifecycle(input: {
  controller: RoutineBuilderController;
  screen: Screen;
  dataMode: DataMode;
  userId?: string;
  activeStorageScope: BrowserStorageScope | null;
  hasRoutinePlan: boolean;
}) {
  const { controller } = input;
  const snapshot = useMemo<RoutineBuilderDraftSnapshot>(() => ({
    activeDay: controller.activeDay,
    setupByDay: controller.setupByDay,
    draftPlan: controller.draftPlan,
    activeRoutineDay: controller.activeRoutineDay,
    isEditingRoutinePlan: controller.isEditingRoutinePlan,
    routineEditorReturnScreen: controller.routineEditorReturnScreen,
  }), [
    controller.activeDay,
    controller.activeRoutineDay,
    controller.draftPlan,
    controller.isEditingRoutinePlan,
    controller.routineEditorReturnScreen,
    controller.setupByDay,
  ]);

  useEffect(() => {
    persistRoutineBuilderPlan({
      snapshot,
      dataMode: input.dataMode,
      userId: input.userId,
      activeStorageScope: input.activeStorageScope,
    });
  }, [snapshot, input.activeStorageScope, input.dataMode, input.userId]);

  useEffect(() => {
    const persist = () => persistRoutineBuilderDraft({
      snapshot,
      screen: input.screen,
      dataMode: input.dataMode,
      userId: input.userId,
      activeStorageScope: input.activeStorageScope,
      hasRoutinePlan: input.hasRoutinePlan,
    });
    if (!persist()) return;
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", persist);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", persist);
    };
  }, [
    snapshot,
    input.activeStorageScope,
    input.dataMode,
    input.hasRoutinePlan,
    input.screen,
    input.userId,
  ]);
}
