export const TRAINING_CYCLE_WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type TrainingCycleWeekDay = (typeof TRAINING_CYCLE_WEEK_DAYS)[number];

export const TRAINING_CYCLE_GOALS = ["strength", "volume", "definition", "deload"] as const;
export type TrainingCycleGoal = (typeof TRAINING_CYCLE_GOALS)[number];

export const TRAINING_CYCLE_MUSCLE_GROUPS = [
  "Pectoral",
  "Hombros",
  "Tríceps",
  "Dorsal",
  "Bíceps",
  "Trapecio",
  "Cuádriceps",
  "Femoral",
  "Glúteos",
  "Pantorrillas",
  "Pierna completa",
  "Abdomen",
] as const;

export type TrainingCycleMuscleGroup = (typeof TRAINING_CYCLE_MUSCLE_GROUPS)[number];

export const TRAINING_CYCLE_TECHNIQUES = [
  "linear",
  "ascending",
  "descending",
  "drop_set",
  "failure",
] as const;

export type TrainingCycleTechnique = (typeof TRAINING_CYCLE_TECHNIQUES)[number];
export type TrainingCycleBuilderOrigin = "duplicate" | "manual" | "suggested" | "resume";
export type TrainingCycleSaveState = "loading" | "saving" | "saved" | "offline" | "error";
export type TrainingCycleSuggestionState = "idle" | "loading" | "error";
export type TrainingCycleActiveEditState = "idle" | "saving" | "error" | "conflict";
export type TrainingCycleBuilderWorkflow = "draft" | "active" | "active_edit";
export type TrainingCycleRecommendationDecision = "idle" | "accepted" | "modified" | "ignored";
export type TrainingCycleCatalogScope = "previous" | "recent" | "all";
export type TrainingCycleBuilderChromeMode = "standalone" | "embedded";
export type TrainingCycleStartTrainingHandler = (
  cycleId: string,
) => boolean | void | Promise<boolean | void>;

export type TrainingCycleExerciseSource =
  | { readonly kind: "catalog"; readonly id: string }
  | { readonly kind: "custom"; readonly id: string };

export type TrainingCycleBuilderScreen =
  | "start"
  | "duplicate"
  | "setup"
  | "routine"
  | "catalog"
  | "custom"
  | "exercise"
  | "muscle"
  | "review"
  | "success"
  | "active"
  | "alerts"
  | "closing"
  | "next";

export interface TrainingCycleDropDraft {
  readonly id: string;
  readonly targetKg: string;
  readonly targetReps: string;
}

export interface TrainingCycleSetDraft {
  readonly id: string;
  readonly targetReps: string;
  readonly targetKg: string;
  readonly toFailure: boolean;
  readonly drops: readonly TrainingCycleDropDraft[];
}

export interface TrainingCycleRecommendationViewModel {
  readonly hasHistory: boolean;
  readonly title: string;
  readonly body: string;
  readonly source: string;
  readonly previousPlanLabel?: string;
  readonly achievedLabel?: string;
  readonly estimatedLabel?: string;
  readonly suggestedKg?: string;
  /** Sugerencias opt-in por serie; nunca se aplican sin confirmación explícita. */
  readonly suggestedSets?: readonly {
    readonly order: number;
    readonly targetReps: number;
    readonly suggestedKg: string;
  }[];
}

export interface TrainingCycleExerciseDraft {
  readonly id: string;
  readonly source: TrainingCycleExerciseSource;
  readonly name: string;
  readonly muscleGroup: TrainingCycleMuscleGroup;
  readonly technique: TrainingCycleTechnique;
  readonly videoUrl: string;
  readonly sets: readonly TrainingCycleSetDraft[];
  readonly recommendation: TrainingCycleRecommendationViewModel;
  readonly recommendationDecision: TrainingCycleRecommendationDecision;
}

export interface TrainingCycleDayDraft {
  readonly day: TrainingCycleWeekDay;
  readonly name: string;
  readonly exercises: readonly TrainingCycleExerciseDraft[];
}

export interface TrainingCycleDraftViewModel {
  readonly draftId: string;
  readonly goal: TrainingCycleGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly selectedDays: readonly TrainingCycleWeekDay[];
  readonly routines: Readonly<Record<TrainingCycleWeekDay, TrainingCycleDayDraft>>;
}

export interface TrainingCycleCatalogExerciseViewModel {
  readonly id: string;
  readonly source: TrainingCycleExerciseSource;
  readonly name: string;
  readonly muscleGroup: TrainingCycleMuscleGroup;
  readonly sources: readonly TrainingCycleCatalogScope[];
  readonly recommendation?: TrainingCycleRecommendationViewModel;
}

export interface TrainingCycleDuplicateComparisonRowViewModel {
  readonly id: string;
  readonly exerciseName: string;
  readonly plannedLabel: string;
  readonly actualLabel: string;
  readonly outcome: "met" | "below";
}

export interface TrainingCycleExpiryAlertViewModel {
  readonly offsetDays: 3 | 2 | 1 | 0;
  readonly title: string;
  readonly body: string;
  readonly whenLabel: string;
  readonly emailEnabled: boolean;
}

export interface TrainingCycleClosedSummaryViewModel {
  readonly cycleLabel: string;
  readonly completedSessions: number;
  readonly plannedSessions: number;
}

export interface TrainingCycleBuilderInitialViewModel {
  readonly initialScreen?: TrainingCycleBuilderScreen;
  readonly origin?: TrainingCycleBuilderOrigin;
  readonly todayIsoDate: string;
  readonly activeCycleId?: string | null;
  /** Token opaco requerido para guardar una edición con control optimista. */
  readonly activeCycleRevision?: string | null;
  readonly draft: TrainingCycleDraftViewModel;
  readonly catalog: readonly TrainingCycleCatalogExerciseViewModel[];
  readonly duplicateComparison: readonly TrainingCycleDuplicateComparisonRowViewModel[];
  readonly hasRecoverableDraft: boolean;
  readonly recoveredDraftLabel?: string;
  readonly saveState?: TrainingCycleSaveState;
  readonly activeCycleDaysRemaining?: number;
  readonly activeCycleElapsedDays?: number;
  readonly activeCycleTotalDays?: number;
  readonly registeredSessions?: number;
  readonly expiryAlerts: readonly TrainingCycleExpiryAlertViewModel[];
  readonly closedSummary: TrainingCycleClosedSummaryViewModel;
  readonly nextSessionLabel: string;
  readonly nextSessionDetail: string;
}

export interface TrainingCycleBuilderShellProps {
  readonly isMenuOpen: boolean;
  readonly onMenuToggle: () => void;
  readonly isNotificationPanelOpen: boolean;
  readonly onNotificationPanelToggle?: () => void;
  readonly notificationBadgeText?: string | null;
  readonly notificationBadgeAriaLabel?: string | null;
}

export interface TrainingCyclePlanDayInput {
  readonly day: TrainingCycleWeekDay;
  readonly name: string;
  readonly exercises: readonly {
    readonly source: TrainingCycleExerciseSource;
    readonly name: string;
    readonly muscleGroup: TrainingCycleMuscleGroup;
    readonly order: number;
    readonly technique: TrainingCycleTechnique;
    readonly videoUrl: string | null;
    readonly sets: readonly {
      readonly order: number;
      readonly targetReps: number | null;
      readonly targetKg: number | null;
      readonly toFailure: boolean;
      readonly drops: readonly {
        readonly targetKg: number | null;
        readonly targetReps: number | null;
      }[];
    }[];
  }[];
}

export interface TrainingCycleSaveDraftInput {
  readonly draftId: string;
  readonly origin: TrainingCycleBuilderOrigin;
  readonly goal: TrainingCycleGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly days: readonly TrainingCyclePlanDayInput[];
}

export interface TrainingCycleActivateInput {
  readonly draftId: string;
}

export interface TrainingCycleExtendInput {
  readonly cycleId: string;
  readonly expectedRevision: string;
  readonly currentEndDate: string;
  readonly newEndDate: string;
}

/** Únicos datos que pueden alimentar al motor de sugerencias. */
export interface TrainingCycleGenerateSuggestedDraftInput {
  readonly goal: TrainingCycleGoal;
  readonly startDate: string;
  readonly endDate: string;
  readonly durationDays: number;
  readonly selectedDays: readonly TrainingCycleWeekDay[];
}

export interface TrainingCycleGenerateSuggestedDraftResult {
  readonly draft: TrainingCycleDraftViewModel;
}

/**
 * Allowlist de edición activa. Las fechas quedan fuera a propósito: el inicio es
 * inmutable y el término sólo cambia mediante TrainingCycleExtendInput.
 */
export interface TrainingCycleSaveActiveInput {
  readonly cycleId: string;
  readonly expectedRevision: string;
  readonly goal: TrainingCycleGoal;
  readonly days: readonly TrainingCyclePlanDayInput[];
}

export type TrainingCycleSaveDraftResult =
  | { readonly status: "saved"; readonly savedAtLabel: string }
  | { readonly status: "offline" };

export interface TrainingCycleActivationResult {
  readonly cycleId: string;
  readonly revision: string;
  readonly status: "activated" | "already_active";
}

export type TrainingCycleSaveActiveResult =
  | {
      readonly status: "saved";
      readonly revision: string;
      readonly savedAtLabel: string;
    }
  | {
      readonly status: "conflict";
    };

export interface TrainingCycleBuilderGateway {
  saveDraft(input: TrainingCycleSaveDraftInput): Promise<TrainingCycleSaveDraftResult>;
  generateSuggestedDraft(
    input: TrainingCycleGenerateSuggestedDraftInput,
  ): Promise<TrainingCycleGenerateSuggestedDraftResult>;
  createCustomExercise(input: {
    readonly name: string;
    readonly muscleGroup: TrainingCycleMuscleGroup;
    readonly videoUrl: string | null;
  }): Promise<TrainingCycleCatalogExerciseViewModel>;
  activateCycle(input: TrainingCycleActivateInput): Promise<TrainingCycleActivationResult>;
  saveActiveCycle(input: TrainingCycleSaveActiveInput): Promise<TrainingCycleSaveActiveResult>;
  extendCycle(input: TrainingCycleExtendInput): Promise<{
    readonly endDate: string;
    readonly revision: string;
  }>;
  discardDraft(input: { readonly draftId: string }): Promise<void>;
}

export interface TrainingCycleBuilderProps {
  /** Requerido incluso en runtime; null produce un estado cerrado sin acciones. */
  readonly initialViewModel: TrainingCycleBuilderInitialViewModel | null;
  /** Requerido incluso en runtime; nunca se sustituye por persistencia simulada. */
  readonly gateway: TrainingCycleBuilderGateway | null;
  readonly shell: TrainingCycleBuilderShellProps;
  readonly chromeMode?: TrainingCycleBuilderChromeMode;
  readonly onExit: () => void;
  readonly onStartTraining?: TrainingCycleStartTrainingHandler;
}

export const TRAINING_CYCLE_DAY_LABELS: Record<TrainingCycleWeekDay, string> = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miércoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sábado",
  sunday: "Domingo",
};

export const TRAINING_CYCLE_DAY_SHORT_LABELS: Record<TrainingCycleWeekDay, string> = {
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mié",
  thursday: "Jue",
  friday: "Vie",
  saturday: "Sáb",
  sunday: "Dom",
};

export const TRAINING_CYCLE_DAY_LETTERS: Record<TrainingCycleWeekDay, string> = {
  monday: "L",
  tuesday: "M",
  wednesday: "M",
  thursday: "J",
  friday: "V",
  saturday: "S",
  sunday: "D",
};

export const TRAINING_CYCLE_GOAL_LABELS: Record<TrainingCycleGoal, string> = {
  strength: "Fuerza",
  volume: "Volumen",
  definition: "Definición",
  deload: "Descarga",
};

export const TRAINING_CYCLE_TECHNIQUE_LABELS: Record<TrainingCycleTechnique, string> = {
  linear: "Lineal",
  ascending: "Pirámide ascendente",
  descending: "Pirámide descendente",
  drop_set: "Drop set",
  failure: "Fallo muscular",
};
