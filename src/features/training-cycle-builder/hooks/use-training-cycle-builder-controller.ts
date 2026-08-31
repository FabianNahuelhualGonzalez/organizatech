"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
} from "react";

import type {
  TrainingCycleBuilderAction,
  TrainingCycleBuilderState,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  buildTrainingCycleActivateInput,
  buildTrainingCycleSaveActiveInput,
  buildTrainingCycleSaveDraftInput,
  buildTrainingCycleSuggestedDraftInput,
  createTrainingCycleDraftAfterDiscard,
  createTrainingCycleBuilderState,
  getExtensionValidation,
  getTrainingCycleDraftValidation,
  trainingCycleBuilderReducer,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import type {
  TrainingCycleBuilderGateway,
  TrainingCycleBuilderInitialViewModel,
  TrainingCycleDraftViewModel,
  TrainingCycleWeekDay,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import {
  TrainingCycleDraftAutosaveOwner,
  type TrainingCycleDraftAutosaveClaim,
} from "@/features/training-cycle-builder/hooks/training-cycle-draft-autosave";

const AUTOSAVE_DELAY_MS = 520;

export interface TrainingCycleBuilderController {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: Dispatch<TrainingCycleBuilderAction>;
  goBack(): boolean;
  retrySave(): Promise<void>;
  generateSuggestion(): Promise<void>;
  activate(): Promise<void>;
  saveActiveCycle(): Promise<void>;
  discardDraft(): Promise<void>;
  extendCycle(): Promise<void>;
  saveCustomExercise(): Promise<void>;
}

interface UseTrainingCycleBuilderControllerOptions {
  readonly initialViewModel: TrainingCycleBuilderInitialViewModel;
  readonly gateway: TrainingCycleBuilderGateway;
}

function publicOperationError(operation: "save" | "suggest" | "activate" | "active_edit" | "discard" | "extend") {
  if (operation === "save") return "No pudimos guardar tus cambios. El borrador sigue disponible aquí.";
  if (operation === "suggest") return "No pudimos generar la rutina sugerida. Revisa tu conexión e inténtalo otra vez.";
  if (operation === "activate") return "No pudimos activar el ciclo. Revisa tu conexión e inténtalo otra vez.";
  if (operation === "active_edit") return "No pudimos guardar los cambios del ciclo activo. Tu edición sigue abierta.";
  if (operation === "discard") return "No pudimos descartar el borrador. Puedes volver a intentarlo.";
  return "No pudimos extender el ciclo. La fecha actual no cambió.";
}

function hasSuggestedRoutines(
  value: unknown,
  selectedDays: readonly TrainingCycleWeekDay[],
): value is TrainingCycleDraftViewModel {
  if (!value || typeof value !== "object") return false;
  const routines = (value as { readonly routines?: Record<string, unknown> }).routines;
  if (!routines || typeof routines !== "object") return false;
  return selectedDays.every((day) => {
    const routine = routines[day];
    return Boolean(
      routine &&
      typeof routine === "object" &&
      (routine as { readonly day?: unknown }).day === day &&
      Array.isArray((routine as { readonly exercises?: unknown }).exercises),
    );
  });
}

export function useTrainingCycleBuilderController({
  initialViewModel,
  gateway,
}: UseTrainingCycleBuilderControllerOptions): TrainingCycleBuilderController {
  const [state, dispatch] = useReducer(
    trainingCycleBuilderReducer,
    initialViewModel,
    createTrainingCycleBuilderState,
  );
  const gatewayRef = useRef(gateway);
  const draftRef = useRef(state.draft);
  const originRef = useRef(state.origin);
  const activationLockRef = useRef(false);
  const suggestionLockRef = useRef(false);
  const activeEditLockRef = useRef(false);
  const discardLockRef = useRef(false);
  const extensionLockRef = useRef(false);
  const autosaveOwnerRef = useRef<TrainingCycleDraftAutosaveOwner | null>(null);
  if (!autosaveOwnerRef.current) {
    autosaveOwnerRef.current = new TrainingCycleDraftAutosaveOwner({
      write: (input) => gatewayRef.current.saveDraft(input),
      onEvent: (event) => {
        if (event.status === "saved") {
          dispatch({
            type: "set_save_state",
            state: "saved",
            savedAtLabel: event.savedAtLabel,
            errorMessage: null,
          });
          return;
        }
        if (event.status === "offline") {
          dispatch({ type: "set_save_state", state: "offline", errorMessage: null });
          return;
        }
        dispatch({
          type: "set_save_state",
          state: "error",
          errorMessage: publicOperationError("save"),
        });
      },
    });
  }
  const autosaveOwner = autosaveOwnerRef.current;

  useEffect(() => {
    gatewayRef.current = gateway;
  }, [gateway]);

  useEffect(() => {
    draftRef.current = state.draft;
  }, [state.draft]);

  useEffect(() => {
    originRef.current = state.origin;
  }, [state.origin]);

  useEffect(() => {
    if (state.workflow !== "draft" || state.discardState === "discarding") {
      autosaveOwner.pause();
      return;
    }
    autosaveOwner.resume(state.draft.draftId);
    return () => autosaveOwner.pause();
  }, [autosaveOwner, state.discardState, state.draft.draftId, state.workflow]);

  const persistDraftSnapshot = useCallback(async (
    draft: TrainingCycleDraftViewModel,
    claim?: TrainingCycleDraftAutosaveClaim,
  ) => {
    const validation = getTrainingCycleDraftValidation(draft);
    if (!validation.canActivate) return;
    try {
      await autosaveOwner.request(buildTrainingCycleSaveDraftInput(draft, originRef.current), claim);
    } catch {
      dispatch({
        type: "set_save_state",
        state: "error",
        errorMessage: "Corrige los enlaces de YouTube antes de guardar. Tus cambios siguen aquí.",
      });
    }
  }, [autosaveOwner]);

  useEffect(() => {
    if (
      state.revision === 0 ||
      state.workflow !== "draft" ||
      state.discardState === "discarding"
    ) return;
    const snapshot = state.draft;
    if (!getTrainingCycleDraftValidation(snapshot).canActivate) return;
    const claim = autosaveOwner.claim(snapshot.draftId);
    if (!claim) return;
    dispatch({ type: "set_save_state", state: "saving", errorMessage: null });
    const timeoutId = window.setTimeout(() => {
      void persistDraftSnapshot(snapshot, claim);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [autosaveOwner, persistDraftSnapshot, state.discardState, state.draft, state.revision, state.workflow]);

  const retrySave = useCallback(async () => {
    if (state.workflow !== "draft" || state.discardState === "discarding") return;
    dispatch({ type: "set_save_state", state: "saving", errorMessage: null });
    await persistDraftSnapshot(draftRef.current);
  }, [persistDraftSnapshot, state.discardState, state.workflow]);

  const generateSuggestion = useCallback(async () => {
    if (
      suggestionLockRef.current ||
      state.workflow !== "draft" ||
      state.origin !== "suggested" ||
      state.screen !== "setup"
    ) return;
    const requestedDraft = draftRef.current;
    const validation = getTrainingCycleDraftValidation(requestedDraft);
    if (!validation.datesValid || !validation.hasDays) return;
    suggestionLockRef.current = true;
    dispatch({ type: "suggestion_started" });
    try {
      const result = await gatewayRef.current.generateSuggestedDraft(
        buildTrainingCycleSuggestedDraftInput(requestedDraft),
      );
      if (!hasSuggestedRoutines(result?.draft, requestedDraft.selectedDays)) {
        throw new TypeError("Invalid suggested draft result");
      }
      const generatedValidation = getTrainingCycleDraftValidation({
        ...result.draft,
        goal: requestedDraft.goal,
        startDate: requestedDraft.startDate,
        endDate: requestedDraft.endDate,
        selectedDays: requestedDraft.selectedDays,
      });
      if (!generatedValidation.videosValid) throw new TypeError("Invalid suggested video URL");
      dispatch({ type: "suggestion_succeeded", draft: result.draft });
    } catch {
      dispatch({ type: "suggestion_failed", message: publicOperationError("suggest") });
    } finally {
      suggestionLockRef.current = false;
    }
  }, [state.origin, state.screen, state.workflow]);

  const activate = useCallback(async () => {
    if (activationLockRef.current || state.workflow !== "draft") return;
    const draft = draftRef.current;
    if (!getTrainingCycleDraftValidation(draft).canActivate) return;
    activationLockRef.current = true;
    dispatch({ type: "activation_started" });
    try {
      dispatch({ type: "set_save_state", state: "saving", errorMessage: null });
      const saveOutcome = await autosaveOwner.request(
        buildTrainingCycleSaveDraftInput(draft, originRef.current),
      );
      await autosaveOwner.whenIdle();
      if (saveOutcome.status !== "saved") throw new Error("latest-draft-not-saved");
      const result = await gatewayRef.current.activateCycle(
        buildTrainingCycleActivateInput(draft),
      );
      if (!result.cycleId || !result.revision) throw new TypeError("Invalid activation result");
      dispatch({ type: "activation_succeeded", cycleId: result.cycleId, revision: result.revision });
    } catch {
      dispatch({ type: "activation_failed", message: publicOperationError("activate") });
    } finally {
      activationLockRef.current = false;
    }
  }, [autosaveOwner, state.workflow]);

  const saveActiveCycle = useCallback(async () => {
    if (
      activeEditLockRef.current ||
      state.workflow !== "active_edit" ||
      state.activeEditState === "conflict" ||
      !state.activeCycleId ||
      !state.activeCycleRevision
    ) return;
    const draft = draftRef.current;
    if (!getTrainingCycleDraftValidation(draft).canActivate) return;
    activeEditLockRef.current = true;
    dispatch({ type: "active_edit_started" });
    try {
      const result = await gatewayRef.current.saveActiveCycle(
        buildTrainingCycleSaveActiveInput(
          draft,
          state.activeCycleId,
          state.activeCycleRevision,
        ),
      );
      if (result.status === "conflict") {
        dispatch({
          type: "active_edit_failed",
          conflict: true,
          message: "El ciclo cambió en otro lugar. Recarga antes de volver a guardar.",
        });
        return;
      }
      if (!result.revision) throw new TypeError("Invalid active edit result");
      dispatch({
        type: "active_edit_succeeded",
        revision: result.revision,
        savedAtLabel: result.savedAtLabel,
      });
    } catch {
      dispatch({
        type: "active_edit_failed",
        conflict: false,
        message: publicOperationError("active_edit"),
      });
    } finally {
      activeEditLockRef.current = false;
    }
  }, [state.activeCycleId, state.activeCycleRevision, state.activeEditState, state.workflow]);

  const discardDraft = useCallback(async () => {
    if (discardLockRef.current || state.workflow !== "draft") return;
    discardLockRef.current = true;
    const discardedDraft = draftRef.current;
    autosaveOwner.pause();
    dispatch({ type: "discard_started" });
    try {
      await autosaveOwner.whenIdle();
      await gatewayRef.current.discardDraft({ draftId: discardedDraft.draftId });
      dispatch({
        type: "discard_complete",
        draft: createTrainingCycleDraftAfterDiscard(
          discardedDraft,
          `local:${crypto.randomUUID()}`,
        ),
      });
    } catch {
      autosaveOwner.resume(discardedDraft.draftId);
      dispatch({ type: "discard_failed" });
      dispatch({
        type: "set_save_state",
        state: "error",
        errorMessage: publicOperationError("discard"),
      });
    } finally {
      discardLockRef.current = false;
    }
  }, [autosaveOwner, state.workflow]);

  const extendCycle = useCallback(async () => {
    if (extensionLockRef.current || !state.activeCycleId || state.workflow !== "active") return;
    const requestedValidation = getExtensionValidation(
      state.draft.endDate,
      state.extendDate,
      initialViewModel.todayIsoDate,
    );
    if (!requestedValidation.valid) return;
    extensionLockRef.current = true;
    dispatch({ type: "extension_started" });
    try {
      const result = await gatewayRef.current.extendCycle({
        cycleId: state.activeCycleId,
        expectedRevision: state.activeCycleRevision ?? "",
        currentEndDate: state.draft.endDate,
        newEndDate: state.extendDate,
      });
      if (
        result.endDate !== state.extendDate ||
        !result.revision ||
        !getExtensionValidation(
          state.draft.endDate,
          result.endDate,
          initialViewModel.todayIsoDate,
        ).valid
      ) {
        throw new TypeError("Invalid extension result");
      }
      dispatch({ type: "extension_succeeded", endDate: result.endDate, revision: result.revision });
    } catch {
      dispatch({ type: "extension_failed", message: publicOperationError("extend") });
    } finally {
      extensionLockRef.current = false;
    }
  }, [initialViewModel.todayIsoDate, state.activeCycleId, state.activeCycleRevision, state.draft.endDate, state.extendDate, state.workflow]);

  const saveCustomExercise = useCallback(async () => {
    if (state.customSaveState === "saving") return;
    const name = state.customName.trim();
    const muscleGroup = state.customMuscleGroup;
    if (!name || !muscleGroup) return;
    dispatch({ type: "custom_exercise_started" });
    try {
      const created = await gatewayRef.current.createCustomExercise({
        name,
        muscleGroup,
        videoUrl: state.customVideoUrl.trim() || null,
      });
      if (created.source.kind !== "custom") throw new TypeError("Invalid custom exercise source");
      dispatch({
        type: "custom_exercise_succeeded",
        source: created.source,
        name: created.name,
        muscleGroup: created.muscleGroup,
        videoUrl: state.customVideoUrl.trim(),
        recommendation: created.recommendation ?? {
          hasHistory: false,
          title: "Todavía no tenemos historial de este ejercicio",
          body: "Partimos con una carga conservadora que puedes modificar.",
          source: "Sin datos suficientes: sugerencia inicial conservadora.",
        },
      });
    } catch {
      dispatch({
        type: "custom_exercise_failed",
        message: "No pudimos guardar el ejercicio. Tus datos siguen aquí para reintentar.",
      });
    }
  }, [state.customMuscleGroup, state.customName, state.customSaveState, state.customVideoUrl]);

  const goBack = useCallback(() => {
    if (state.history.length === 0) return false;
    dispatch({ type: "back" });
    return true;
  }, [state.history.length]);

  return {
    state,
    dispatch,
    goBack,
    retrySave,
    generateSuggestion,
    activate,
    saveActiveCycle,
    discardDraft,
    extendCycle,
    saveCustomExercise,
  };
}
