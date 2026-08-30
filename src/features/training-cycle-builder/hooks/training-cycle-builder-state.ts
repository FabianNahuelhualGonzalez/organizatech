import {
  TRAINING_CYCLE_DAY_LABELS,
  TRAINING_CYCLE_WEEK_DAYS,
  type TrainingCycleActivateInput,
  type TrainingCycleBuilderInitialViewModel,
  type TrainingCycleBuilderOrigin,
  type TrainingCycleBuilderScreen,
  type TrainingCycleBuilderWorkflow,
  type TrainingCycleCatalogScope,
  type TrainingCycleDayDraft,
  type TrainingCycleDraftViewModel,
  type TrainingCycleExerciseDraft,
  type TrainingCycleGoal,
  type TrainingCycleGenerateSuggestedDraftInput,
  type TrainingCycleMuscleGroup,
  type TrainingCyclePlanDayInput,
  type TrainingCycleRecommendationDecision,
  type TrainingCycleSaveActiveInput,
  type TrainingCycleSaveDraftInput,
  type TrainingCycleSaveState,
  type TrainingCycleSetDraft,
  type TrainingCycleTechnique,
  type TrainingCycleWeekDay,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import {
  normalizeOptionalYouTubeVideoUrl,
  validateOptionalYouTubeVideoUrl,
} from "@/features/training-cycle-builder/hooks/training-cycle-video-url";

export type TrainingCycleExerciseMode = "quick" | "per_set";
export type TrainingCycleCopyMode = "exercises" | "day";

export interface TrainingCycleBuilderState {
  readonly workflow: TrainingCycleBuilderWorkflow;
  readonly screen: TrainingCycleBuilderScreen;
  readonly history: readonly TrainingCycleBuilderScreen[];
  readonly origin: TrainingCycleBuilderOrigin;
  readonly sourceDraft: TrainingCycleDraftViewModel;
  readonly draft: TrainingCycleDraftViewModel;
  readonly currentDay: TrainingCycleWeekDay;
  readonly selectedExerciseId: string | null;
  readonly exerciseMode: TrainingCycleExerciseMode;
  readonly quickReps: string;
  readonly quickKg: string;
  readonly catalogScope: TrainingCycleCatalogScope;
  readonly catalogQuery: string;
  readonly customName: string;
  readonly customMuscleGroup: TrainingCycleMuscleGroup | null;
  readonly customVideoUrl: string;
  readonly customSaveState: "idle" | "saving" | "error";
  readonly customErrorMessage: string | null;
  readonly comparisonOpen: boolean;
  readonly openExerciseMenuId: string | null;
  readonly openSetId: string | null;
  readonly openReviewSection: string | null;
  readonly copyMode: TrainingCycleCopyMode | null;
  readonly discardOpen: boolean;
  readonly discardState: "idle" | "discarding";
  readonly extendOpen: boolean;
  readonly extendDate: string;
  readonly saveState: TrainingCycleSaveState;
  readonly savedAtLabel: string;
  readonly saveErrorMessage: string | null;
  readonly recoveredDraftBannerOpen: boolean;
  readonly activationState: "idle" | "activating" | "error";
  readonly activationErrorMessage: string | null;
  readonly suggestionState: "idle" | "loading" | "error";
  readonly suggestionErrorMessage: string | null;
  readonly activeCycleId: string | null;
  readonly activeCycleRevision: string | null;
  readonly activeEditState: "idle" | "saving" | "error" | "conflict";
  readonly activeEditErrorMessage: string | null;
  readonly activeEditSavedMessage: string | null;
  readonly extensionState: "idle" | "saving" | "error";
  readonly extensionErrorMessage: string | null;
  readonly revision: number;
  readonly nextEntityNumber: number;
}

export type TrainingCycleBuilderAction =
  | { readonly type: "navigate"; readonly screen: TrainingCycleBuilderScreen }
  | { readonly type: "return_to"; readonly screen: TrainingCycleBuilderScreen }
  | { readonly type: "back" }
  | { readonly type: "choose_origin"; readonly origin: TrainingCycleBuilderOrigin; readonly screen: TrainingCycleBuilderScreen }
  | { readonly type: "resume_draft" }
  | { readonly type: "dismiss_recovered_banner" }
  | { readonly type: "toggle_comparison" }
  | { readonly type: "set_goal"; readonly goal: TrainingCycleGoal }
  | { readonly type: "set_start_date"; readonly value: string }
  | { readonly type: "set_end_date"; readonly value: string }
  | { readonly type: "toggle_day"; readonly day: TrainingCycleWeekDay }
  | { readonly type: "select_day"; readonly day: TrainingCycleWeekDay }
  | { readonly type: "set_routine_name"; readonly value: string }
  | { readonly type: "toggle_exercise_menu"; readonly exerciseId: string }
  | { readonly type: "move_exercise"; readonly exerciseId: string; readonly direction: "up" | "down" }
  | { readonly type: "duplicate_exercise"; readonly exerciseId: string }
  | { readonly type: "remove_exercise"; readonly exerciseId: string }
  | { readonly type: "open_exercise"; readonly exerciseId: string }
  | { readonly type: "set_catalog_scope"; readonly scope: TrainingCycleCatalogScope }
  | { readonly type: "set_catalog_query"; readonly value: string }
  | { readonly type: "add_catalog_exercise"; readonly source: TrainingCycleExerciseDraft["source"]; readonly name: string; readonly muscleGroup: TrainingCycleMuscleGroup; readonly recommendation: TrainingCycleExerciseDraft["recommendation"] }
  | { readonly type: "set_custom_name"; readonly value: string }
  | { readonly type: "set_custom_muscle"; readonly value: TrainingCycleMuscleGroup }
  | { readonly type: "set_custom_video"; readonly value: string }
  | { readonly type: "custom_exercise_started" }
  | { readonly type: "custom_exercise_failed"; readonly message: string }
  | { readonly type: "custom_exercise_succeeded"; readonly source: TrainingCycleExerciseDraft["source"]; readonly name: string; readonly muscleGroup: TrainingCycleMuscleGroup; readonly videoUrl: string; readonly recommendation: TrainingCycleExerciseDraft["recommendation"] }
  | { readonly type: "set_exercise_mode"; readonly mode: TrainingCycleExerciseMode }
  | { readonly type: "set_quick_reps"; readonly value: string }
  | { readonly type: "set_quick_kg"; readonly value: string }
  | { readonly type: "change_set_count"; readonly delta: -1 | 1 }
  | { readonly type: "apply_quick_values" }
  | { readonly type: "set_technique"; readonly technique: TrainingCycleTechnique }
  | { readonly type: "edit_set"; readonly setId: string; readonly field: "targetReps" | "targetKg"; readonly value: string }
  | { readonly type: "toggle_set_failure"; readonly setId: string }
  | { readonly type: "toggle_set_open"; readonly setId: string }
  | { readonly type: "duplicate_set"; readonly setId: string }
  | { readonly type: "remove_set"; readonly setId: string }
  | { readonly type: "add_set" }
  | { readonly type: "add_drop"; readonly setId: string }
  | { readonly type: "edit_drop"; readonly setId: string; readonly dropId: string; readonly field: "targetReps" | "targetKg"; readonly value: string }
  | { readonly type: "remove_drop"; readonly setId: string; readonly dropId: string }
  | { readonly type: "set_video_url"; readonly value: string }
  | { readonly type: "accept_recommendation" }
  | { readonly type: "modify_recommendation" }
  | { readonly type: "ignore_recommendation" }
  | { readonly type: "toggle_review_section"; readonly section: string }
  | { readonly type: "open_copy"; readonly mode: TrainingCycleCopyMode }
  | { readonly type: "close_copy" }
  | { readonly type: "copy_from_day"; readonly sourceDay: TrainingCycleWeekDay }
  | { readonly type: "open_discard" }
  | { readonly type: "close_discard" }
  | { readonly type: "discard_started" }
  | { readonly type: "discard_failed" }
  | { readonly type: "discard_complete"; readonly draft: TrainingCycleDraftViewModel }
  | { readonly type: "set_save_state"; readonly state: TrainingCycleSaveState; readonly savedAtLabel?: string; readonly errorMessage?: string | null }
  | { readonly type: "activation_started" }
  | { readonly type: "activation_failed"; readonly message: string }
  | { readonly type: "activation_succeeded"; readonly cycleId: string; readonly revision: string }
  | { readonly type: "show_active" }
  | { readonly type: "suggestion_started" }
  | { readonly type: "suggestion_succeeded"; readonly draft: TrainingCycleDraftViewModel }
  | { readonly type: "suggestion_failed"; readonly message: string }
  | { readonly type: "begin_active_edit" }
  | { readonly type: "cancel_active_edit" }
  | { readonly type: "active_edit_started" }
  | { readonly type: "active_edit_failed"; readonly message: string; readonly conflict: boolean }
  | { readonly type: "active_edit_succeeded"; readonly revision: string; readonly savedAtLabel: string }
  | { readonly type: "dismiss_active_edit_saved" }
  | { readonly type: "open_extend" }
  | { readonly type: "close_extend" }
  | { readonly type: "set_extend_date"; readonly value: string }
  | { readonly type: "extension_started" }
  | { readonly type: "extension_failed"; readonly message: string }
  | { readonly type: "extension_succeeded"; readonly endDate: string; readonly revision: string };

function firstSelectedDay(draft: TrainingCycleDraftViewModel): TrainingCycleWeekDay {
  return draft.selectedDays[0] ?? "monday";
}

function createManualRoutines(
  source: TrainingCycleDraftViewModel["routines"],
): TrainingCycleDraftViewModel["routines"] {
  const empty = (day: TrainingCycleWeekDay): TrainingCycleDayDraft => ({
    ...source[day],
    name: "",
    exercises: [],
  });
  return {
    monday: empty("monday"),
    tuesday: empty("tuesday"),
    wednesday: empty("wednesday"),
    thursday: empty("thursday"),
    friday: empty("friday"),
    saturday: empty("saturday"),
    sunday: empty("sunday"),
  };
}

export function createTrainingCycleDraftAfterDiscard(
  source: TrainingCycleDraftViewModel,
  draftId: string,
): TrainingCycleDraftViewModel {
  if (!draftId.trim() || draftId === source.draftId) {
    throw new TypeError("A fresh draft ID is required after discard");
  }
  return {
    ...source,
    draftId,
    selectedDays: [],
    routines: createManualRoutines(source.routines),
  };
}

function initialWorkflow(screen: TrainingCycleBuilderScreen | undefined): TrainingCycleBuilderWorkflow {
  return screen === "active" || screen === "alerts" || screen === "closing"
    ? "active"
    : "draft";
}

export function createTrainingCycleBuilderState(
  viewModel: TrainingCycleBuilderInitialViewModel,
): TrainingCycleBuilderState {
  return {
    workflow: initialWorkflow(viewModel.initialScreen),
    screen: viewModel.initialScreen ?? "start",
    history: [],
    origin: viewModel.origin ?? "duplicate",
    sourceDraft: viewModel.draft,
    draft: viewModel.draft,
    currentDay: firstSelectedDay(viewModel.draft),
    selectedExerciseId: null,
    exerciseMode: "quick",
    quickReps: "10",
    quickKg: "20",
    catalogScope: "previous",
    catalogQuery: "",
    customName: "",
    customMuscleGroup: null,
    customVideoUrl: "",
    customSaveState: "idle",
    customErrorMessage: null,
    comparisonOpen: false,
    openExerciseMenuId: null,
    openSetId: null,
    openReviewSection: "plan",
    copyMode: null,
    discardOpen: false,
    discardState: "idle",
    extendOpen: false,
    extendDate: addDaysToIso(viewModel.draft.endDate, 14),
    saveState: viewModel.saveState ?? "saved",
    savedAtLabel: "Guardado hace un momento",
    saveErrorMessage: null,
    recoveredDraftBannerOpen: false,
    activationState: "idle",
    activationErrorMessage: null,
    suggestionState: "idle",
    suggestionErrorMessage: null,
    activeCycleId: viewModel.activeCycleId ?? null,
    activeCycleRevision: viewModel.activeCycleRevision ?? null,
    activeEditState: "idle",
    activeEditErrorMessage: null,
    activeEditSavedMessage: null,
    extensionState: "idle",
    extensionErrorMessage: null,
    revision: 0,
    nextEntityNumber: 1,
  };
}

function markDraftChanged(
  state: TrainingCycleBuilderState,
  draft: TrainingCycleDraftViewModel,
  extra: Partial<TrainingCycleBuilderState> = {},
): TrainingCycleBuilderState {
  return {
    ...state,
    ...extra,
    draft,
    revision: state.revision + 1,
    saveErrorMessage: null,
  };
}

function updateRoutine(
  draft: TrainingCycleDraftViewModel,
  day: TrainingCycleWeekDay,
  update: (routine: TrainingCycleDayDraft) => TrainingCycleDayDraft,
): TrainingCycleDraftViewModel {
  return {
    ...draft,
    routines: {
      ...draft.routines,
      [day]: update(draft.routines[day]),
    },
  };
}

function updateCurrentExercise(
  state: TrainingCycleBuilderState,
  update: (exercise: TrainingCycleExerciseDraft) => TrainingCycleExerciseDraft,
): TrainingCycleBuilderState {
  const selectedExerciseId = state.selectedExerciseId;
  if (!selectedExerciseId) return state;
  const draft = updateRoutine(state.draft, state.currentDay, (routine) => ({
    ...routine,
    exercises: routine.exercises.map((exercise) =>
      exercise.id === selectedExerciseId ? update(exercise) : exercise),
  }));
  return markDraftChanged(state, draft);
}

function nextId(state: TrainingCycleBuilderState, prefix: string) {
  return `${prefix}-${state.nextEntityNumber}`;
}

function cloneExercise(
  exercise: TrainingCycleExerciseDraft,
  prefix: string,
  number: number,
): TrainingCycleExerciseDraft {
  return {
    ...exercise,
    id: `${prefix}-exercise-${number}`,
    sets: exercise.sets.map((set, setIndex) => ({
      ...set,
      id: `${prefix}-exercise-${number}-set-${setIndex + 1}`,
      drops: set.drops.map((drop, dropIndex) => ({
        ...drop,
        id: `${prefix}-exercise-${number}-set-${setIndex + 1}-drop-${dropIndex + 1}`,
      })),
    })),
  };
}

function createCatalogExercise(
  state: TrainingCycleBuilderState,
  action: Extract<TrainingCycleBuilderAction, { type: "add_catalog_exercise" }>,
): TrainingCycleExerciseDraft {
  const id = nextId(state, "catalog-exercise");
  return {
    id,
    source: action.source,
    name: action.name,
    muscleGroup: action.muscleGroup,
    technique: "linear",
    videoUrl: "",
    recommendation: action.recommendation,
    recommendationDecision: "idle",
    sets: Array.from({ length: 4 }, (_, index) => ({
      id: `${id}-set-${index + 1}`,
      targetReps: "10",
      targetKg: "20",
      toFailure: false,
      drops: [],
    })),
  };
}

function applyTechnique(
  exercise: TrainingCycleExerciseDraft,
  technique: TrainingCycleTechnique,
): TrainingCycleExerciseDraft {
  const firstSet = exercise.sets[0];
  const baseKg = Number(firstSet?.targetKg) || 20;
  const baseReps = Number(firstSet?.targetReps) || 10;
  const lastIndex = exercise.sets.length - 1;
  return {
    ...exercise,
    technique,
    sets: exercise.sets.map((set, index) => {
      if (technique === "ascending") {
        return {
          ...set,
          targetKg: String(Math.round(baseKg * (1 + index * 0.1))),
          targetReps: String(Math.max(3, baseReps - index * 2)),
          drops: [],
        };
      }
      if (technique === "descending") {
        return {
          ...set,
          targetKg: String(Math.round(baseKg * (1 + (lastIndex - index) * 0.1))),
          targetReps: String(Math.max(3, baseReps + index * 2)),
          drops: [],
        };
      }
      if (technique === "drop_set") {
        const drops = index === lastIndex && set.drops.length === 0
          ? [{ id: `${set.id}-drop-1`, targetKg: String(Math.round(baseKg * 0.8)), targetReps: "8" }]
          : set.drops;
        return { ...set, drops };
      }
      if (technique === "failure") {
        return { ...set, toFailure: index === lastIndex, drops: [] };
      }
      return { ...set, drops: [] };
    }),
  };
}

function updateSelectedExerciseDecision(
  state: TrainingCycleBuilderState,
  decision: TrainingCycleRecommendationDecision,
): TrainingCycleBuilderState {
  return updateCurrentExercise(state, (exercise) => ({ ...exercise, recommendationDecision: decision }));
}

function applySuggestedDraftResult(
  requested: TrainingCycleDraftViewModel,
  generated: TrainingCycleDraftViewModel,
): TrainingCycleDraftViewModel {
  const routines = { ...requested.routines };
  for (const day of requested.selectedDays) {
    const suggestion = generated.routines[day];
    if (suggestion?.day !== day) continue;
    routines[day] = { ...suggestion, day };
  }
  return {
    ...requested,
    // El gateway no puede cambiar la identidad ni los cuatro criterios de entrada.
    draftId: requested.draftId,
    goal: requested.goal,
    startDate: requested.startDate,
    endDate: requested.endDate,
    selectedDays: requested.selectedDays,
    routines,
  };
}

const PLAN_EDIT_ACTIONS = new Set<TrainingCycleBuilderAction["type"]>([
  "set_goal",
  "set_start_date",
  "set_end_date",
  "toggle_day",
  "set_routine_name",
  "move_exercise",
  "duplicate_exercise",
  "remove_exercise",
  "add_catalog_exercise",
  "custom_exercise_succeeded",
  "change_set_count",
  "apply_quick_values",
  "set_technique",
  "edit_set",
  "toggle_set_failure",
  "duplicate_set",
  "remove_set",
  "add_set",
  "add_drop",
  "edit_drop",
  "remove_drop",
  "set_video_url",
  "accept_recommendation",
  "modify_recommendation",
  "ignore_recommendation",
  "copy_from_day",
]);

export function trainingCycleBuilderReducer(
  state: TrainingCycleBuilderState,
  action: TrainingCycleBuilderAction,
): TrainingCycleBuilderState {
  if (state.workflow === "active" && PLAN_EDIT_ACTIONS.has(action.type)) return state;
  switch (action.type) {
    case "navigate":
      if (action.screen === state.screen) return state;
      return {
        ...state,
        history: [...state.history, state.screen],
        screen: action.screen,
        openExerciseMenuId: null,
      };
    case "return_to": {
      let targetIndex = -1;
      for (let index = state.history.length - 1; index >= 0; index -= 1) {
        if (state.history[index] === action.screen) {
          targetIndex = index;
          break;
        }
      }
      return {
        ...state,
        screen: action.screen,
        history: targetIndex >= 0 ? state.history.slice(0, targetIndex) : state.history,
        openExerciseMenuId: null,
        openSetId: null,
      };
    }
    case "back": {
      const previous = state.history.at(-1);
      if (!previous) return state;
      if (previous === "active" && state.workflow === "active_edit") {
        return {
          ...state,
          workflow: "active",
          screen: "active",
          history: [],
          draft: state.sourceDraft,
          currentDay: firstSelectedDay(state.sourceDraft),
          activeEditState: "idle",
          activeEditErrorMessage: null,
        };
      }
      return {
        ...state,
        screen: previous,
        history: state.history.slice(0, -1),
        openExerciseMenuId: null,
      };
    }
    case "choose_origin": {
      const draft = action.origin === "manual" || action.origin === "suggested"
        ? {
            ...state.sourceDraft,
            routines: createManualRoutines(state.sourceDraft.routines),
          }
        : state.sourceDraft;
      return {
        ...state,
        workflow: "draft",
        origin: action.origin,
        screen: action.screen,
        history: [...state.history, state.screen],
        draft,
        currentDay: firstSelectedDay(draft),
        suggestionState: "idle",
        suggestionErrorMessage: null,
        activeEditSavedMessage: null,
        revision: state.revision + 1,
      };
    }
    case "resume_draft":
      return {
        ...state,
        workflow: "draft",
        origin: "resume",
        screen: "setup",
        history: [...state.history, state.screen],
        recoveredDraftBannerOpen: true,
      };
    case "dismiss_recovered_banner":
      return { ...state, recoveredDraftBannerOpen: false };
    case "toggle_comparison":
      return { ...state, comparisonOpen: !state.comparisonOpen };
    case "set_goal":
      return markDraftChanged(state, { ...state.draft, goal: action.goal });
    case "set_start_date":
      if (state.workflow === "active_edit") return state;
      return markDraftChanged(state, { ...state.draft, startDate: action.value });
    case "set_end_date":
      if (state.workflow === "active_edit") return state;
      return markDraftChanged(state, { ...state.draft, endDate: action.value });
    case "toggle_day": {
      const selectedDays = state.draft.selectedDays.includes(action.day)
        ? state.draft.selectedDays.filter((day) => day !== action.day)
        : TRAINING_CYCLE_WEEK_DAYS.filter((day) =>
            state.draft.selectedDays.includes(day) || day === action.day);
      return markDraftChanged(state, { ...state.draft, selectedDays }, {
        currentDay: selectedDays.includes(state.currentDay)
          ? state.currentDay
          : selectedDays[0] ?? state.currentDay,
      });
    }
    case "select_day":
      return { ...state, currentDay: action.day, openExerciseMenuId: null };
    case "set_routine_name":
      return markDraftChanged(
        state,
        updateRoutine(state.draft, state.currentDay, (routine) => ({ ...routine, name: action.value })),
      );
    case "toggle_exercise_menu":
      return {
        ...state,
        openExerciseMenuId: state.openExerciseMenuId === action.exerciseId ? null : action.exerciseId,
      };
    case "move_exercise": {
      const routine = state.draft.routines[state.currentDay];
      const index = routine.exercises.findIndex((exercise) => exercise.id === action.exerciseId);
      const target = action.direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= routine.exercises.length) return state;
      const exercises = [...routine.exercises];
      [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
      return markDraftChanged(
        state,
        updateRoutine(state.draft, state.currentDay, (current) => ({ ...current, exercises })),
        { openExerciseMenuId: null },
      );
    }
    case "duplicate_exercise": {
      const routine = state.draft.routines[state.currentDay];
      const index = routine.exercises.findIndex((exercise) => exercise.id === action.exerciseId);
      if (index < 0) return state;
      const copy = cloneExercise(routine.exercises[index], "duplicate", state.nextEntityNumber);
      const exercises = [...routine.exercises];
      exercises.splice(index + 1, 0, copy);
      return markDraftChanged(
        state,
        updateRoutine(state.draft, state.currentDay, (current) => ({ ...current, exercises })),
        { openExerciseMenuId: null, nextEntityNumber: state.nextEntityNumber + 1 },
      );
    }
    case "remove_exercise":
      return markDraftChanged(
        state,
        updateRoutine(state.draft, state.currentDay, (routine) => ({
          ...routine,
          exercises: routine.exercises.filter((exercise) => exercise.id !== action.exerciseId),
        })),
        { openExerciseMenuId: null },
      );
    case "open_exercise": {
      const exercise = state.draft.routines[state.currentDay].exercises.find(
        (candidate) => candidate.id === action.exerciseId,
      );
      if (!exercise) return state;
      return {
        ...state,
        history: [...state.history, state.screen],
        screen: "exercise",
        selectedExerciseId: exercise.id,
        exerciseMode: "quick",
        quickReps: exercise.sets[0]?.targetReps ?? "10",
        quickKg: exercise.sets[0]?.targetKg ?? "20",
        openSetId: null,
        openExerciseMenuId: null,
      };
    }
    case "set_catalog_scope":
      return { ...state, catalogScope: action.scope };
    case "set_catalog_query":
      return { ...state, catalogQuery: action.value };
    case "add_catalog_exercise": {
      const exercise = createCatalogExercise(state, action);
      return markDraftChanged(
        state,
        updateRoutine(state.draft, state.currentDay, (routine) => ({
          ...routine,
          exercises: [...routine.exercises, exercise],
        })),
        { nextEntityNumber: state.nextEntityNumber + 1 },
      );
    }
    case "set_custom_name":
      return { ...state, customName: action.value, customErrorMessage: null };
    case "set_custom_muscle":
      return { ...state, customMuscleGroup: action.value, customErrorMessage: null };
    case "set_custom_video":
      return { ...state, customVideoUrl: action.value, customErrorMessage: null };
    case "custom_exercise_started":
      if (state.customSaveState === "saving") return state;
      return { ...state, customSaveState: "saving", customErrorMessage: null };
    case "custom_exercise_failed":
      return { ...state, customSaveState: "error", customErrorMessage: action.message };
    case "custom_exercise_succeeded": {
      const id = nextId(state, "custom-exercise");
      const exercise: TrainingCycleExerciseDraft = {
        id,
        source: action.source,
        name: action.name,
        muscleGroup: action.muscleGroup,
        technique: "linear",
        videoUrl: action.videoUrl,
        recommendationDecision: "idle",
        recommendation: action.recommendation,
        sets: Array.from({ length: 4 }, (_, index) => ({
          id: `${id}-set-${index + 1}`,
          targetReps: "10",
          targetKg: "20",
          toFailure: false,
          drops: [],
        })),
      };
      const routineHistoryIndex = state.history.lastIndexOf("routine");
      return markDraftChanged(
        state,
        updateRoutine(state.draft, state.currentDay, (routine) => ({
          ...routine,
          exercises: [...routine.exercises, exercise],
        })),
        {
          screen: "routine",
          history: routineHistoryIndex >= 0
            ? state.history.slice(0, routineHistoryIndex)
            : state.history,
          customName: "",
          customMuscleGroup: null,
          customVideoUrl: "",
          customSaveState: "idle",
          customErrorMessage: null,
          catalogQuery: "",
          nextEntityNumber: state.nextEntityNumber + 1,
        },
      );
    }
    case "set_exercise_mode":
      return { ...state, exerciseMode: action.mode };
    case "set_quick_reps":
      return { ...state, quickReps: action.value };
    case "set_quick_kg":
      return { ...state, quickKg: action.value };
    case "change_set_count": {
      const updated = updateCurrentExercise(state, (exercise) => {
        if (action.delta === -1) {
          return exercise.sets.length > 1 ? { ...exercise, sets: exercise.sets.slice(0, -1) } : exercise;
        }
        if (exercise.sets.length >= 20) return exercise;
        const lastSet = exercise.sets.at(-1);
        const id = nextId(state, "set");
        const nextSet: TrainingCycleSetDraft = {
          id,
          targetReps: lastSet?.targetReps ?? "10",
          targetKg: lastSet?.targetKg ?? "20",
          toFailure: false,
          drops: [],
        };
        return { ...exercise, sets: [...exercise.sets, nextSet] };
      });
      return action.delta === 1 && updated !== state
        ? { ...updated, nextEntityNumber: state.nextEntityNumber + 1 }
        : updated;
    }
    case "apply_quick_values":
      return updateCurrentExercise(state, (exercise) => ({
        ...exercise,
        recommendationDecision: exercise.recommendationDecision === "ignored" ? "ignored" : "modified",
        sets: exercise.sets.map((set) => ({
          ...set,
          targetReps: state.quickReps,
          targetKg: state.quickKg,
        })),
      }));
    case "set_technique":
      return updateCurrentExercise(state, (exercise) => applyTechnique(exercise, action.technique));
    case "edit_set":
      return updateCurrentExercise(state, (exercise) => ({
        ...exercise,
        recommendationDecision: exercise.recommendationDecision === "ignored" ? "ignored" : "modified",
        sets: exercise.sets.map((set) =>
          set.id === action.setId ? { ...set, [action.field]: action.value } : set),
      }));
    case "toggle_set_failure":
      return updateCurrentExercise(state, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) =>
          set.id === action.setId ? { ...set, toFailure: !set.toFailure } : set),
      }));
    case "toggle_set_open":
      return { ...state, openSetId: state.openSetId === action.setId ? null : action.setId };
    case "duplicate_set": {
      const updated = updateCurrentExercise(state, (exercise) => {
        const index = exercise.sets.findIndex((set) => set.id === action.setId);
        if (index < 0) return exercise;
        const source = exercise.sets[index];
        const copyId = nextId(state, "set-copy");
        const copy = {
          ...source,
          id: copyId,
          drops: source.drops.map((drop, dropIndex) => ({
            ...drop,
            id: `${copyId}-drop-${dropIndex + 1}`,
          })),
        };
        const sets = [...exercise.sets];
        sets.splice(index + 1, 0, copy);
        return { ...exercise, sets };
      });
      return updated !== state ? { ...updated, nextEntityNumber: state.nextEntityNumber + 1 } : updated;
    }
    case "remove_set":
      return updateCurrentExercise(state, (exercise) => ({
        ...exercise,
        sets: exercise.sets.length > 1
          ? exercise.sets.filter((set) => set.id !== action.setId)
          : exercise.sets,
      }));
    case "add_set": {
      const updated = updateCurrentExercise(state, (exercise) => {
        if (exercise.sets.length >= 20) return exercise;
        const lastSet = exercise.sets.at(-1);
        return {
          ...exercise,
          sets: [
            ...exercise.sets,
            {
              id: nextId(state, "set"),
              targetReps: lastSet?.targetReps ?? "10",
              targetKg: lastSet?.targetKg ?? "20",
              toFailure: false,
              drops: [],
            },
          ],
        };
      });
      return updated !== state ? { ...updated, nextEntityNumber: state.nextEntityNumber + 1 } : updated;
    }
    case "add_drop": {
      const updated = updateCurrentExercise(state, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => set.id === action.setId
          ? set.drops.length >= 8 ? set : {
              ...set,
              drops: [
                ...set.drops,
                {
                  id: nextId(state, "drop"),
                  targetKg: String(Math.round((Number(set.targetKg) || 20) * 0.8)),
                  targetReps: "8",
                },
              ],
            }
          : set),
      }));
      return updated !== state ? { ...updated, nextEntityNumber: state.nextEntityNumber + 1 } : updated;
    }
    case "edit_drop":
      return updateCurrentExercise(state, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => set.id === action.setId
          ? {
              ...set,
              drops: set.drops.map((drop) =>
                drop.id === action.dropId ? { ...drop, [action.field]: action.value } : drop),
            }
          : set),
      }));
    case "remove_drop":
      return updateCurrentExercise(state, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((set) => set.id === action.setId
          ? { ...set, drops: set.drops.filter((drop) => drop.id !== action.dropId) }
          : set),
      }));
    case "set_video_url":
      return updateCurrentExercise(state, (exercise) => ({ ...exercise, videoUrl: action.value }));
    case "accept_recommendation":
      return updateCurrentExercise(state, (exercise) => {
        const suggestedKg = exercise.recommendation.suggestedKg ?? exercise.sets[0]?.targetKg ?? "20";
        const suggestedSets = new Map(
          (exercise.recommendation.suggestedSets ?? []).map((suggestion) => [suggestion.order, suggestion]),
        );
        return {
          ...exercise,
          recommendationDecision: "accepted",
          sets: exercise.sets.map((set, index) => ({
            ...set,
            targetKg: suggestedSets.get(index + 1)?.suggestedKg ?? suggestedKg,
          })),
        };
      });
    case "modify_recommendation": {
      const modified = updateSelectedExerciseDecision(state, "modified");
      return { ...modified, exerciseMode: "per_set" };
    }
    case "ignore_recommendation":
      return updateSelectedExerciseDecision(state, "ignored");
    case "toggle_review_section":
      return {
        ...state,
        openReviewSection: state.openReviewSection === action.section ? null : action.section,
      };
    case "open_copy":
      return { ...state, copyMode: action.mode };
    case "close_copy":
      return { ...state, copyMode: null };
    case "copy_from_day": {
      const source = state.draft.routines[action.sourceDay];
      const clonedExercises = source.exercises.map((exercise, index) =>
        cloneExercise(exercise, "copy-day", state.nextEntityNumber + index));
      const draft = updateRoutine(state.draft, state.currentDay, (routine) => action.sourceDay === state.currentDay
        ? routine
        : state.copyMode === "day"
          ? { ...routine, name: source.name, exercises: clonedExercises }
          : { ...routine, exercises: [...routine.exercises, ...clonedExercises] });
      return markDraftChanged(state, draft, {
        copyMode: null,
        nextEntityNumber: state.nextEntityNumber + clonedExercises.length,
      });
    }
    case "open_discard":
      return { ...state, discardOpen: true };
    case "close_discard":
      return state.discardState === "discarding" ? state : { ...state, discardOpen: false };
    case "discard_started":
      return { ...state, discardState: "discarding" };
    case "discard_failed":
      return { ...state, discardState: "idle", discardOpen: false };
    case "discard_complete":
      return {
        ...state,
        workflow: "draft",
        origin: "manual",
        sourceDraft: action.draft,
        draft: action.draft,
        currentDay: firstSelectedDay(action.draft),
        discardOpen: false,
        discardState: "idle",
        screen: "start",
        history: [],
        saveState: "saved",
        saveErrorMessage: null,
        recoveredDraftBannerOpen: false,
        revision: 0,
      };
    case "set_save_state":
      return {
        ...state,
        saveState: action.state,
        savedAtLabel: action.savedAtLabel ?? state.savedAtLabel,
        saveErrorMessage: action.errorMessage === undefined ? state.saveErrorMessage : action.errorMessage,
      };
    case "activation_started":
      if (state.activationState === "activating") return state;
      return { ...state, activationState: "activating", activationErrorMessage: null };
    case "activation_failed":
      return { ...state, activationState: "error", activationErrorMessage: action.message };
    case "activation_succeeded":
      return {
        ...state,
        workflow: "active",
        activationState: "idle",
        activationErrorMessage: null,
        activeCycleId: action.cycleId,
        activeCycleRevision: action.revision,
        sourceDraft: state.draft,
        screen: "success",
        history: [],
      };
    case "show_active":
      return {
        ...state,
        workflow: "active",
        history: [],
        screen: "active",
      };
    case "suggestion_started":
      if (state.origin !== "suggested" || state.workflow !== "draft") return state;
      return { ...state, suggestionState: "loading", suggestionErrorMessage: null };
    case "suggestion_succeeded": {
      if (state.origin !== "suggested" || state.workflow !== "draft" || state.screen !== "setup") return state;
      const draft = applySuggestedDraftResult(state.draft, action.draft);
      return markDraftChanged(state, draft, {
        suggestionState: "idle",
        suggestionErrorMessage: null,
        currentDay: firstSelectedDay(draft),
        screen: "routine",
        history: [...state.history, state.screen],
      });
    }
    case "suggestion_failed":
      if (state.origin !== "suggested" || state.workflow !== "draft" || state.screen !== "setup") return state;
      return {
        ...state,
        suggestionState: "error",
        suggestionErrorMessage: action.message,
      };
    case "begin_active_edit":
      if (!state.activeCycleId || !state.activeCycleRevision || state.workflow !== "active") return state;
      return {
        ...state,
        workflow: "active_edit",
        sourceDraft: state.draft,
        screen: "setup",
        history: ["active"],
        currentDay: firstSelectedDay(state.draft),
        activeEditState: "idle",
        activeEditErrorMessage: null,
        activeEditSavedMessage: null,
      };
    case "cancel_active_edit":
      if (state.workflow !== "active_edit") return state;
      return {
        ...state,
        workflow: "active",
        screen: "active",
        history: [],
        draft: state.sourceDraft,
        currentDay: firstSelectedDay(state.sourceDraft),
        activeEditState: "idle",
        activeEditErrorMessage: null,
      };
    case "active_edit_started":
      if (state.workflow !== "active_edit" || state.activeEditState === "saving") return state;
      return { ...state, activeEditState: "saving", activeEditErrorMessage: null };
    case "active_edit_failed":
      return {
        ...state,
        activeEditState: action.conflict ? "conflict" : "error",
        activeEditErrorMessage: action.message,
      };
    case "active_edit_succeeded":
      return {
        ...state,
        workflow: "active",
        screen: "active",
        history: [],
        sourceDraft: state.draft,
        activeCycleRevision: action.revision,
        activeEditState: "idle",
        activeEditErrorMessage: null,
        activeEditSavedMessage: action.savedAtLabel,
      };
    case "dismiss_active_edit_saved":
      return { ...state, activeEditSavedMessage: null };
    case "open_extend":
      if (state.workflow !== "active" || !state.activeCycleId) return state;
      return { ...state, extendOpen: true, extensionState: "idle", extensionErrorMessage: null };
    case "close_extend":
      return state.extensionState === "saving" ? state : { ...state, extendOpen: false };
    case "set_extend_date":
      return { ...state, extendDate: action.value, extensionErrorMessage: null };
    case "extension_started":
      if (state.extensionState === "saving") return state;
      return { ...state, extensionState: "saving", extensionErrorMessage: null };
    case "extension_failed":
      return { ...state, extensionState: "error", extensionErrorMessage: action.message };
    case "extension_succeeded":
      {
        if (
          state.workflow !== "active" ||
          !state.activeCycleId ||
          getIsoDayDifference(state.draft.endDate, action.endDate) <= 0
        ) {
          return {
            ...state,
            extensionState: "error",
            extensionErrorMessage: "La fecha de término sólo puede avanzar.",
          };
        }
        const draft = { ...state.draft, endDate: action.endDate };
        return {
          ...state,
          activeCycleRevision: action.revision,
          draft,
          sourceDraft: draft,
          extendOpen: false,
          extensionState: "idle",
          extensionErrorMessage: null,
        };
      }
  }
}

function toFiniteNumber(value: string, minimum: number) {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, parsed);
}

function toNullableNumber(value: string, minimum: number) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : null;
}

export function buildTrainingCycleSaveDraftInput(
  draft: TrainingCycleDraftViewModel,
  origin: TrainingCycleBuilderOrigin,
): TrainingCycleSaveDraftInput {
  return {
    draftId: draft.draftId,
    origin,
    goal: draft.goal,
    startDate: draft.startDate,
    endDate: draft.endDate,
    days: buildTrainingCyclePlanDays(draft),
  };
}

function buildTrainingCyclePlanDays(
  draft: TrainingCycleDraftViewModel,
): readonly TrainingCyclePlanDayInput[] {
  return draft.selectedDays.map((day) => {
    const routine = draft.routines[day];
    return {
      day,
      name: routine.name.trim(),
      exercises: routine.exercises.map((exercise, exerciseIndex) => ({
        source: exercise.source,
        name: exercise.name.trim(),
        muscleGroup: exercise.muscleGroup,
        order: exerciseIndex + 1,
        technique: exercise.technique,
        videoUrl: normalizeOptionalYouTubeVideoUrl(exercise.videoUrl),
        sets: exercise.sets.map((set, setIndex) => ({
          order: setIndex + 1,
          targetReps: (() => {
            const value = toNullableNumber(set.targetReps, 1);
            return value === null ? null : Math.round(value);
          })(),
          targetKg: toNullableNumber(set.targetKg, 0),
          toFailure: set.toFailure,
          drops: set.drops.map((drop) => ({
            targetKg: toNullableNumber(drop.targetKg, 0),
            targetReps: (() => {
              const value = toNullableNumber(drop.targetReps, 1);
              return value === null ? null : Math.round(value);
            })(),
          })),
        })),
      })),
    };
  });
}

export function buildTrainingCycleActivateInput(
  draft: TrainingCycleDraftViewModel,
): TrainingCycleActivateInput {
  return { draftId: draft.draftId };
}

export function buildTrainingCycleSuggestedDraftInput(
  draft: TrainingCycleDraftViewModel,
): TrainingCycleGenerateSuggestedDraftInput {
  const durationDays = getIsoDayDifference(draft.startDate, draft.endDate);
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw new RangeError("Training cycle dates must define a positive duration");
  }
  return {
    goal: draft.goal,
    startDate: draft.startDate,
    endDate: draft.endDate,
    durationDays,
    selectedDays: [...draft.selectedDays],
  };
}

export function buildTrainingCycleSaveActiveInput(
  draft: TrainingCycleDraftViewModel,
  cycleId: string,
  expectedRevision: string,
): TrainingCycleSaveActiveInput {
  return {
    cycleId,
    expectedRevision,
    goal: draft.goal,
    days: buildTrainingCyclePlanDays(draft),
  };
}

export function getIsoDayDifference(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const end = Date.parse(`${endDate}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.NaN;
  return Math.round((end - start) / 86_400_000);
}

export function addDaysToIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatCycleDate(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(date)
    .replace(".", "");
}

export function getTrainingCycleDraftValidation(draft: TrainingCycleDraftViewModel) {
  const durationDays = getIsoDayDifference(draft.startDate, draft.endDate);
  const datesValid = Number.isFinite(durationDays) && durationDays > 0;
  const hasDays = draft.selectedDays.length > 0;
  const seriesValid = draft.selectedDays.every((day) =>
    draft.routines[day].exercises.every((exercise) =>
      exercise.name.trim().length > 0 &&
      exercise.sets.length > 0 && exercise.sets.length <= 20 &&
      exercise.sets.every((set) =>
        set.drops.length <= 8 &&
        toFiniteNumber(set.targetReps, 0) > 0 &&
        toFiniteNumber(set.targetReps, 0) <= 1000 &&
        toFiniteNumber(set.targetKg, -1) >= 0 &&
        toFiniteNumber(set.targetKg, -1) <= 99999.99)));
  let invalidVideoCount = 0;
  for (const day of draft.selectedDays) {
    for (const exercise of draft.routines[day].exercises) {
      if (!validateOptionalYouTubeVideoUrl(exercise.videoUrl).valid) invalidVideoCount += 1;
    }
  }
  const videosValid = invalidVideoCount === 0;
  return {
    durationDays,
    datesValid,
    hasDays,
    seriesValid,
    videosValid,
    invalidVideoCount,
    canActivate: datesValid && hasDays && seriesValid && videosValid,
  };
}

export function getTrainingCycleMetrics(draft: TrainingCycleDraftViewModel) {
  let exercises = 0;
  let sets = 0;
  let repetitions = 0;
  let volumeKg = 0;
  for (const day of draft.selectedDays) {
    for (const exercise of draft.routines[day].exercises) {
      exercises += 1;
      for (const set of exercise.sets) {
        sets += 1;
        const reps = toFiniteNumber(set.targetReps, 0);
        const kg = toFiniteNumber(set.targetKg, 0);
        repetitions += reps;
        volumeKg += reps * kg;
        for (const drop of set.drops) {
          const dropReps = toFiniteNumber(drop.targetReps, 0);
          repetitions += dropReps;
          volumeKg += dropReps * toFiniteNumber(drop.targetKg, 0);
        }
      }
    }
  }
  return { exercises, sets, repetitions, volumeKg };
}

export function getMuscleDistribution(draft: TrainingCycleDraftViewModel) {
  const week = new Map<TrainingCycleMuscleGroup, number>();
  const byDay = new Map<TrainingCycleWeekDay, Map<TrainingCycleMuscleGroup, number>>();
  for (const day of draft.selectedDays) {
    const dayMap = new Map<TrainingCycleMuscleGroup, number>();
    for (const exercise of draft.routines[day].exercises) {
      dayMap.set(exercise.muscleGroup, (dayMap.get(exercise.muscleGroup) ?? 0) + 1);
      week.set(exercise.muscleGroup, (week.get(exercise.muscleGroup) ?? 0) + 1);
    }
    byDay.set(day, dayMap);
  }
  return { week, byDay };
}

export function getTrainingCycleWarnings(
  draft: TrainingCycleDraftViewModel,
  currentDay: TrainingCycleWeekDay,
) {
  const warnings: string[] = [];
  const routine = draft.routines[currentDay];
  if (routine.exercises.length === 0) {
    warnings.push(`${TRAINING_CYCLE_DAY_LABELS[currentDay]} todavía no tiene ejercicios.`);
  }
  const duplicateNames = new Map<string, number>();
  for (const exercise of routine.exercises) {
    duplicateNames.set(exercise.name, (duplicateNames.get(exercise.name) ?? 0) + 1);
  }
  for (const [name, count] of duplicateNames) {
    if (count > 1) warnings.push(`${name} está ${count} veces en este día. Puede ser intencional.`);
  }
  const { week } = getMuscleDistribution(draft);
  for (const [muscle, count] of week) {
    if (count === 1) warnings.push(`${muscle} aparece una sola vez en la semana.`);
  }
  return warnings;
}

export function getExtensionValidation(
  currentEndDate: string,
  proposedEndDate: string,
  todayIsoDate: string,
) {
  if (!proposedEndDate) return { valid: false, message: "Elige una fecha." } as const;
  if (getIsoDayDifference(todayIsoDate, proposedEndDate) <= 0) {
    return { valid: false, message: "La nueva fecha debe ser posterior a hoy." } as const;
  }
  const addedDays = getIsoDayDifference(currentEndDate, proposedEndDate);
  if (!Number.isFinite(addedDays) || addedDays <= 0) {
    return { valid: false, message: "Debe ser posterior al término actual." } as const;
  }
  return { valid: true, addedDays, message: `Se agregan ${addedDays} días al ciclo.` } as const;
}
