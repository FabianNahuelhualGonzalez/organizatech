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
  TrainingCycleBuilderOrigin,
  TrainingCycleBuilderScreen,
  TrainingCycleDraftViewModel,
  TrainingCycleWeekDay,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import { TrainingCycleCommittedMutationError } from "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import {
  TrainingCycleDraftAutosaveOwner,
  type TrainingCycleDraftAutosaveClaim,
} from "@/features/training-cycle-builder/hooks/training-cycle-draft-autosave";
import { normalizeOptionalYouTubeVideoUrl } from "@/lib/training/youtube-video-url";
import { prepareTrainingCycleDraftSave, requestTrainingCycleDraftSave } from "./training-cycle-draft-persistence";

const AUTOSAVE_DELAY_MS = 520;

export interface TrainingCycleBuilderController {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: Dispatch<TrainingCycleBuilderAction>;
  goBack(): boolean;
  retrySave(): Promise<void>;
  requestNewCycle(origin: TrainingCycleBuilderOrigin, screen: TrainingCycleBuilderScreen): Promise<void>;
  confirmActiveCycleClose(): Promise<void>;
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

export function publicOperationError(operation: "save" | "suggest" | "activate" | "active_edit" | "discard" | "extend", error?: unknown) {
  if (error instanceof TrainingCycleCommittedMutationError) {
    return "El cambio se guardó, pero no pudimos actualizar la pantalla. Recarga antes de continuar.";
  }
  if (operation === "save") return "No pudimos confirmar el guardado. Tus cambios siguen en esta pantalla; reintenta antes de salir.";
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

export async function requestTrainingCycleNewCycle(
  gateway: Pick<TrainingCycleBuilderGateway, "getActiveCycleGuard">,
  dispatch: Dispatch<TrainingCycleBuilderAction>,
  origin: TrainingCycleBuilderOrigin,
  screen: TrainingCycleBuilderScreen,
) {
  try {
    const guard = await gateway.getActiveCycleGuard();
    if (guard) {
      dispatch({
        type: "active_cycle_close_confirmation_required",
        cycleId: guard.cycleId,
        origin,
        screen,
      });
      return;
    }
    dispatch({ type: "choose_origin", origin, screen });
  } catch {
    dispatch({
      type: "active_cycle_guard_failed",
      message: "No pudimos comprobar tu ciclo actual. No se modificó ningún entrenamiento.",
    });
  }
}

export async function confirmTrainingCycleActiveClose(
  gateway: Pick<TrainingCycleBuilderGateway, "completeActiveCycle">,
  dispatch: Dispatch<TrainingCycleBuilderAction>,
  state: Pick<
    TrainingCycleBuilderState,
    "activeCycleCloseId" | "pendingNewCycleIntent" | "draft"
  >,
) {
  if (!state.activeCycleCloseId || !state.pendingNewCycleIntent) return;
  dispatch({ type: "active_cycle_close_started" });
  try {
    const draft = await gateway.completeActiveCycle({
      expectedActiveCycleId: state.activeCycleCloseId,
      startDate: state.draft.startDate,
      endDate: state.draft.endDate,
    });
    dispatch({ type: "active_cycle_close_succeeded", draft });
  } catch (error) {
    if (error instanceof TrainingCycleCommittedMutationError) {
      dispatch({
        type: "active_cycle_close_committed_sync_failed",
        message: "El ciclo anterior terminó, pero no pudimos sincronizar el nuevo borrador. Recarga para continuar.",
      });
      return;
    }
    dispatch({
      type: "active_cycle_close_failed",
      message: "No pudimos finalizar el ciclo actual. Sigue activo y no se perdió ningún dato.",
    });
  }
}

export class TrainingCycleNewCycleOperationOwner {
  private intentRunning = false;
  private closeRunning = false;

  async request(
    gateway: Pick<TrainingCycleBuilderGateway, "getActiveCycleGuard">,
    dispatch: Dispatch<TrainingCycleBuilderAction>,
    state: Pick<TrainingCycleBuilderState, "activeCycleCloseState">,
    origin: TrainingCycleBuilderOrigin,
    screen: TrainingCycleBuilderScreen,
  ) {
    if (this.intentRunning || state.activeCycleCloseState === "closing") return;
    this.intentRunning = true;
    try {
      await requestTrainingCycleNewCycle(gateway, dispatch, origin, screen);
    } finally {
      this.intentRunning = false;
    }
  }

  async confirm(
    gateway: Pick<TrainingCycleBuilderGateway, "completeActiveCycle">,
    dispatch: Dispatch<TrainingCycleBuilderAction>,
    state: Pick<
      TrainingCycleBuilderState,
      "activeCycleCloseId" | "activeCycleCloseState" | "pendingNewCycleIntent" | "draft"
    >,
  ) {
    if (this.closeRunning || state.activeCycleCloseState === "closing") return;
    this.closeRunning = true;
    try {
      await confirmTrainingCycleActiveClose(gateway, dispatch, state);
    } finally {
      this.closeRunning = false;
    }
  }
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
  const newCycleOwnerRef = useRef<TrainingCycleNewCycleOperationOwner | null>(null);
  if (!newCycleOwnerRef.current) {
    newCycleOwnerRef.current = new TrainingCycleNewCycleOperationOwner();
  }
  const newCycleOwner = newCycleOwnerRef.current;
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
          errorMessage: publicOperationError("save", event.error),
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
    if (state.committedSyncPending || state.workflow !== "draft" || state.discardState === "discarding") {
      autosaveOwner.pause();
      return;
    }
    autosaveOwner.resume(state.draft.draftId);
    return () => autosaveOwner.pause();
  }, [autosaveOwner, state.committedSyncPending, state.discardState, state.draft.draftId, state.workflow]);

  const persistDraftSnapshot = useCallback(async (
    draft: TrainingCycleDraftViewModel,
    claim?: TrainingCycleDraftAutosaveClaim,
  ) => {
    await requestTrainingCycleDraftSave({ draft, origin: originRef.current, owner: autosaveOwner, dispatch, claim });
  }, [autosaveOwner]);

  useEffect(() => {
    if (
      state.revision === 0 ||
      state.committedSyncPending ||
      state.workflow !== "draft" ||
      state.discardState === "discarding"
    ) return;
    const snapshot = state.draft;
    const claim = autosaveOwner.claim(snapshot.draftId);
    if (!claim) return;
    if (!prepareTrainingCycleDraftSave(snapshot, originRef.current)) {
      dispatch({ type: "set_save_state", state: "pending", errorMessage: null });
      return;
    }
    dispatch({ type: "set_save_state", state: "saving", errorMessage: null });
    const timeoutId = window.setTimeout(() => {
      void persistDraftSnapshot(snapshot, claim);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [autosaveOwner, persistDraftSnapshot, state.committedSyncPending, state.discardState, state.draft, state.revision, state.workflow]);

  const retrySave = useCallback(async () => {
    if (state.committedSyncPending || state.workflow !== "draft" || state.discardState === "discarding") return;
    await persistDraftSnapshot(draftRef.current);
  }, [persistDraftSnapshot, state.committedSyncPending, state.discardState, state.workflow]);

  const requestNewCycle = useCallback(async (
    origin: TrainingCycleBuilderOrigin,
    screen: TrainingCycleBuilderScreen,
  ) => {
    await newCycleOwner.request(
      gatewayRef.current,
      dispatch,
      { activeCycleCloseState: state.activeCycleCloseState },
      origin,
      screen,
    );
  }, [newCycleOwner, state.activeCycleCloseState]);

  const confirmActiveCycleClose = useCallback(async () => {
    if (
      !state.activeCycleCloseId
      || !state.pendingNewCycleIntent
    ) return;
    await newCycleOwner.confirm(gatewayRef.current, dispatch, {
      activeCycleCloseId: state.activeCycleCloseId,
      activeCycleCloseState: state.activeCycleCloseState,
      pendingNewCycleIntent: state.pendingNewCycleIntent,
      draft: state.draft,
    });
  }, [
    newCycleOwner,
    state.activeCycleCloseId,
    state.activeCycleCloseState,
    state.draft,
    state.pendingNewCycleIntent,
  ]);

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
    if (activationLockRef.current || state.committedSyncPending || state.workflow !== "draft") return;
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
    } catch (error) {
      const committed = error instanceof TrainingCycleCommittedMutationError;
      if (committed) autosaveOwner.pause();
      dispatch({ type: "activation_failed", message: publicOperationError("activate", error), committed });
    } finally {
      activationLockRef.current = false;
    }
  }, [autosaveOwner, state.committedSyncPending, state.workflow]);

  const saveActiveCycle = useCallback(async () => {
    if (
      activeEditLockRef.current ||
      state.committedSyncPending ||
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
    } catch (error) {
      dispatch({
        type: "active_edit_failed",
        conflict: error instanceof TrainingCycleCommittedMutationError,
        committed: error instanceof TrainingCycleCommittedMutationError,
        message: publicOperationError("active_edit", error),
      });
    } finally {
      activeEditLockRef.current = false;
    }
  }, [state.activeCycleId, state.activeCycleRevision, state.activeEditState, state.committedSyncPending, state.workflow]);

  const discardDraft = useCallback(async () => {
    if (discardLockRef.current || state.committedSyncPending || state.workflow !== "draft") return;
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
  }, [autosaveOwner, state.committedSyncPending, state.workflow]);

  const extendCycle = useCallback(async () => {
    if (extensionLockRef.current || state.committedSyncPending || !state.activeCycleId || state.workflow !== "active") return;
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
    } catch (error) {
      dispatch({ type: "extension_failed", message: publicOperationError("extend", error), committed: error instanceof TrainingCycleCommittedMutationError });
    } finally {
      extensionLockRef.current = false;
    }
  }, [initialViewModel.todayIsoDate, state.activeCycleId, state.activeCycleRevision, state.committedSyncPending, state.draft.endDate, state.extendDate, state.workflow]);

  const saveCustomExercise = useCallback(async () => {
    if (state.customSaveState === "saving") return;
    const name = state.customName.trim();
    const muscleGroup = state.customMuscleGroup;
    if (!name || !muscleGroup) return;
    dispatch({ type: "custom_exercise_started" });
    try {
      const normalizedVideoUrl = normalizeOptionalYouTubeVideoUrl(state.customVideoUrl);
      const created = await gatewayRef.current.createCustomExercise({
        name,
        muscleGroup,
        videoUrl: normalizedVideoUrl,
      });
      if (created.source.kind !== "custom") throw new TypeError("Invalid custom exercise source");
      dispatch({
        type: "custom_exercise_succeeded",
        source: created.source,
        name: created.name,
        muscleGroup: created.muscleGroup,
        videoUrl: normalizedVideoUrl ?? "",
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
    requestNewCycle,
    confirmActiveCycleClose,
    generateSuggestion,
    activate,
    saveActiveCycle,
    discardDraft,
    extendCycle,
    saveCustomExercise,
  };
}
