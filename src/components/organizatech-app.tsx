"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Dumbbell,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Save,
  UserPlus,
} from "lucide-react";
import {
  deactivateActiveCycle,
  deleteExercise,
  replaceLocalData,
  saveExercise,
  saveTrainingSessionWithEntries,
} from "@/lib/data/repository";
import { resolveDashboardActiveDay } from "@/lib/dashboard/dashboard-card-selector";
import {
  getCurrentSantiagoWeekDates,
  getLocalDateKey,
  getTrainingDayCode,
} from "@/lib/dashboard/dashboard-santiago-calendar";
import {
  findDashboardEntries,
  findDashboardSessionForDay,
} from "@/lib/dashboard/dashboard-session-selection";
import { removeAccents } from "@/lib/training/exercise-name-normalization";
import { getSantiagoDateKey } from "@/lib/training/santiago-training-date";
import { ProfileMenuHeader } from "@/components/profile/ProfileMenuHeader";
import { ProfileScreen } from "@/components/profile/ProfileScreen";
import { CycleHistoryProductiveContainer } from "@/components/training/cycle-history";
import { GuidedTrainingScreen } from "@/features/active-workout/components/GuidedTrainingScreen";
import { useActiveWorkoutController } from "@/features/active-workout/hooks/useActiveWorkoutController";
import { useActiveWorkoutExerciseHistory } from "@/features/active-workout/hooks/useActiveWorkoutExerciseHistory";
import {
  createActiveWorkoutReadinessContext,
  resolveActiveWorkoutRecoveryTransition,
  resolveActiveWorkoutStartTransition,
  resolvePendingReadinessLinkUpdate,
} from "@/features/active-workout/model/active-workout-controller-state";
import { TrainingCompletionSummaryScreen } from "@/features/active-workout/components/TrainingCompletionSummaryScreen";
import { TrainingReadinessScreen } from "@/features/active-workout/components/TrainingReadinessScreen";
import { TrainingStartScreen } from "@/features/active-workout/components/TrainingStartScreen";
import { DashboardScreen } from "@/features/dashboard/components/dashboard-screen";
import { EmptyDashboard } from "@/features/dashboard/components/empty-dashboard";
import { NotificationPanel } from "@/features/notifications/components/NotificationPanel";
import { ComparisonScreenV2 } from "@/features/progress/components/comparison-screen-v2";
import { useTrainingDataController } from "@/features/training-data/hooks/useTrainingDataController";
import type { TrainingDataRefreshResult } from "@/features/training-data/model/training-data-controller";
import {
  getNextPersistedCycleNumber,
  isCycleScopedTrainingCycle,
  normalizeCycleScopedEntriesByCalendarWeek,
  normalizeCycleScopedSessionsByCalendarWeek,
  selectTrainingDataView,
} from "@/features/training-data/model/training-data-selectors";
import { getTrainingDataResourceValue } from "@/features/training-data/model/training-data-state";
import {
  buildProgressControllerView,
  createInitialProgressControllerState,
  progressControllerReducer,
} from "@/features/progress/model/progress-controller-state";
import { ConfirmRoutineUpdateModal } from "@/features/routine-builder/components/ConfirmRoutineUpdateModal";
import { RoutineBuilderDayCard } from "@/features/routine-builder/components/RoutineBuilderDayCard";
import { RoutineBuilderNameCard } from "@/features/routine-builder/components/RoutineBuilderNameCard";
import { RoutineExerciseBuilderCard } from "@/features/routine-builder/components/RoutineExerciseBuilderCard";
import { RoutineSuccessModal } from "@/features/routine-builder/components/RoutineSuccessModal";
import {
  resolveRoutineBuilderSavePreparation,
  type RoutineBuilderSaveConfirmation,
} from "@/features/routine-builder/model/routine-builder-save";
import { resolveRoutineBuilderDraftRecovery } from "@/features/routine-builder/model/routine-builder-draft-recovery";
import { createSetupByDayFromExercises } from "@/features/routine-builder/model/routine-builder-exercise-mapping";
import {
  createRoutineBuilderRow,
  createRoutineBuilderState,
  routineBuilderReducer,
} from "@/features/routine-builder/model/routine-builder-state";
import { ConfirmDeleteCycleModal } from "@/features/training-plan/components/ConfirmDeleteCycleModal";
import { ConfirmNewCycleModal } from "@/features/training-plan/components/ConfirmNewCycleModal";
import { CycleManagementScreen } from "@/features/training-plan/components/CycleManagementScreen";
import { TrainingPlanSetupCard } from "@/features/training-plan/components/TrainingPlanSetupCard";
import { CycleScopedPlanBlocker } from "@/features/training-plan/components/CycleScopedPlanBlocker";
import { TRAINING_CYCLE_PRESENTATIONS as trainingCycles } from "@/features/training-plan/model/training-cycle-presentation";
import { buildProfileViewModelFromSources } from "@/lib/profile/profile-view-model";
import { buildAppNotifications } from "@/lib/notifications/notification-model";
import {
  NOTIFICATION_EMPTY_MESSAGE,
  buildNotificationBadgeAriaLabel,
  buildNotificationBadgeText,
  buildNotificationPanelSubtitleText,
  selectNotificationView,
} from "@/lib/notifications/notification-selector";
import {
  markNotificationsSeen as transitionNotificationsSeen,
  resolveNotificationOpenIntent,
} from "@/lib/notifications/notification-state";
import type {
  AppNotification,
  AppNotificationSection,
  SeenNotificationRecord,
  TrainingNotificationContext,
} from "@/lib/notifications/notification-types";
import {
  getProfilePersonalData,
  updateProfilePersonalData,
  type ProfilePersonalData,
} from "@/lib/profile/profile-repository";
import type { ProfilePersonalDataInput } from "@/lib/profile/profile-form";
import { getCurrentProfileAvatar, uploadProfileAvatar } from "@/lib/profile/profile-avatar-repository";
import {
  createEmptyProfileAvatarState,
  mergeProfileAvatarMetadata,
  selectProfileAvatarPath,
  type ProfileAvatarState,
} from "@/lib/profile/profile-avatar";
import {
  calculateWeeklyComparison,
  calculateWeeklySummary,
} from "@/lib/progress/calculations";
import { parseDateKeyAsLocalNoon } from "@/lib/progress/week-day";
import { isDecimalWeightDraftInput, parseDecimalWeightInput } from "@/lib/progress/weight-format";
import { calculateEquivalentWeeklyProgress } from "@/lib/progress/weekly-equivalent-progress";
import type { ExerciseEntry, ExerciseMetrics, ExerciseTemplate, TrainingDayCode, TrainingSession } from "@/lib/progress/types";
import { validateSignupEmail } from "@/lib/auth/signup-email-validation";
import {
  executePasswordRecoveryUpdate,
  hasPasswordRecoveryCallbackError,
  resolvePasswordRecoverySessionDecision,
} from "@/lib/auth/password-recovery-session";
import {
  getActiveFlow,
  resetContextualNavigation,
  resolveActiveFlowRestoration,
  resolveContextualBackNavigation,
  resolveContextualNavigation,
  screenLabel,
  type ContextualNavigationState,
  type Screen,
} from "@/lib/navigation/app-navigation";
import { AppNavigationDrawer } from "@/features/app-shell/components/app-navigation-drawer";
import { AppScreenHeader } from "@/features/app-shell/components/app-screen-header";
import { AppShellLayout } from "@/features/app-shell/components/app-shell-layout";
import { AppTopbar } from "@/features/app-shell/components/app-topbar";
import {
  resolveInitialAuthState,
  resolveInitialAuthStatusMessage,
} from "@/lib/navigation/app-auth-screen-resolver";
import {
  canGoBackFromScreen,
  resolveDayStateReset,
  resolveMenuScreens,
  resolveNotificationScrollTarget,
} from "@/lib/navigation/app-navigation-intent";
import {
  createAuthNavigationReset,
  createFlowScreenTransition,
  resolvePasswordRecoveryRouteTransition,
  resolveWorkoutCompletionTransition,
  type ScreenTransition,
} from "@/lib/navigation/app-navigation-transition";
import {
  isTrainingSummaryScreenValid,
  resolveActiveWorkoutVariant,
  resolveComparisonScreenVariant,
  resolveDashboardScreenVariant,
  resolveRoutineBuilderVariant,
} from "@/lib/navigation/app-screen-resolver";
import { isSessionExpiredError, translateAuthError, translatePersistenceError } from "@/lib/supabase/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getInitialSupabaseSession,
  getMissingSupabaseMessage,
  getSessionDisplayName,
  type DataMode,
  type SupabaseSessionState,
} from "@/lib/supabase/session";
import {
  clearBrowserStorageScope as clearStoredBrowserStorageScope,
  clearPasswordRecoveryStorage,
  confirmPasswordRecoveryFlow,
  getBrowserStorageScope,
  hasStoredPasswordRecoveryFlow,
  loadPasswordRecoveryFlow,
  normalizePasswordRecoveryUserId,
  loadSeenNotificationRecordsFromBrowser as loadSeenNotificationRecords,
  saveSeenNotificationRecordsFromBrowser as saveSeenNotificationRecords,
  startPasswordRecoveryFlow,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";
import {
  ACTIVE_FLOW_VERSION,
  ROUTINE_DRAFT_VERSION,
  clearActiveFlow,
  clearRoutineDraft,
  loadActiveFlow,
  loadCycleHistory,
  loadRoutineDraft,
  loadTrainingPlan,
  saveActiveFlow,
  saveCycleHistory,
  saveRoutineDraft,
  saveTrainingPlan,
} from "@/lib/storage/app-flow-storage";
import {
  advanceSessionDataEpoch as createAdvancedSessionDataEpoch,
  captureSessionDataRequestToken as createSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  resolveEffectiveAuthenticatedUser,
  shouldContinueAuthenticatedFlowAfterRefresh,
  type SessionDataIdentity,
  type SessionDataRequestToken,
} from "@/lib/session/session-data-epoch";
import {
  finalizeSessionOperationOwner,
  invalidateSessionOperationOwners,
  isSessionOperationOwner,
  isSessionOperationOwnerCurrent,
  releaseSessionOperationOwner,
  resolveActiveWorkoutSessionBoundary,
  resolveIncomingWorkoutDraftRecoveryScope,
  settleSessionOperationPromise,
  tryAcquireSessionOperationOwner,
  type SessionOperationOwner,
  type SessionOperationOwnerLock,
} from "@/lib/session/active-workout-session-boundary";
import { translateTrainingCycleRepositoryError } from "@/lib/training/training-cycle-error";
import {
  cancelTrainingCycle,
  completeTrainingCycle,
  getNextTrainingCycleNumber,
  TrainingCycleRepositoryError,
  type TrainingCycle as PersistedTrainingCycle,
  type TrainingCycleSnapshot as PersistedTrainingCycleSnapshot,
} from "@/lib/training/training-cycles-repository";
import {
  isProtectedTrainingCycle,
  PROTECTED_ACTIVE_CYCLE_MESSAGE,
} from "@/lib/training/training-cycle-protection";
import {
  getDailyTrainingReadiness,
  saveDailyTrainingReadiness,
  translateDailyReadinessError,
} from "@/lib/training/training-daily-readiness-repository";
import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";
import {
  linkTrainingWorkoutReadinessSession,
  saveTrainingWorkoutReadiness,
  translateTrainingWorkoutReadinessError,
  type TrainingWorkoutReadinessPayload,
} from "@/lib/training/training-workout-readiness-repository";
import { getLatestExercisePerformanceByLineage } from "@/lib/training/exercise-last-performance-repository";
import { createStableWorkoutStartedAt } from "@/lib/training/exercise-last-performance-loader";
import {
  createExerciseDraft,
  type ExerciseDraft,
} from "@/lib/training/training-exercise-draft";
import {
  isExerciseRegisteredInCurrentWorkout,
  resolveCurrentExerciseRegistration,
} from "@/lib/training/workout-registration";
import {
  buildCycleScopedWorkoutCompletionEntries,
  buildLegacyWorkoutCompletionEntries,
  captureActiveWorkoutCompletionContext,
  prepareActiveWorkoutCompletion,
  resolveActiveWorkoutCompletionMode,
  resolveActiveWorkoutCompletionStart,
  resolveWorkoutReadinessLinkConfirmation,
} from "@/lib/training/active-workout-completion";
import {
  type ActiveWorkoutReadinessContext,
  type PendingWorkoutReadinessLink,
} from "@/lib/training/workout-draft-storage";
import {
  clearActiveWorkoutDraft as clearWorkoutDraft,
  loadActiveWorkoutDraft as loadWorkoutDraft,
  saveActiveWorkoutDraft,
} from "@/lib/training/active-workout-draft";
import {
  createWorkoutAttemptId,
  resolveWorkoutAttemptId,
} from "@/lib/training/training-workout-attempt-lifecycle";
import {
  canResumeActiveWorkoutFromMemory,
  resolveActiveWorkoutReentryDecision,
  shouldRetainActiveWorkoutAttemptState,
} from "@/lib/training/active-workout-reentry";
import {
  resolveTrainingWorkoutReadinessMode,
  TrainingWorkoutReadinessFlowError,
  isNonEmptyString,
  toTrainingWorkoutReadinessPayload,
  type TrainingWorkoutReadinessMode,
} from "@/lib/training/training-workout-readiness-flow";
import {
  createWorkoutReadinessPendingLink,
  TrainingWorkoutReadinessLinkFlowError,
  translateTrainingWorkoutReadinessLinkError,
} from "@/lib/training/training-workout-readiness-link-flow";
import {
  addCycleScopedTrainingDaysAndExercises,
  createTrainingCycleWithPlan,
  createTrainingSessionWithCycleEntries,
  type CycleScopedDay,
  type CycleScopedPlanInput,
  type CycleScopedTrainingPlan,
} from "@/lib/training/cycle-scoped-training-repository";
import {
  getCycleCalendarPlannedDate,
  getCycleCalendarWeekNumber,
  getSessionEffectiveCalendarWeekStart,
} from "@/lib/training/cycle-calendar-week";
import {
  analyzeCycleScopedDayEdit,
  createCycleScopedDayNotes,
  getCycleScopedDayCoverage,
  getCycleScopedDayCodesToAdd,
  getCycleScopedDayRoutineName,
  normalizeCycleScopedExerciseName,
} from "@/lib/training/cycle-scoped-plan-edit";
import {
  dedupeExerciseRowsByName,
  getRemovedExerciseIds,
} from "@/lib/training/training-exercise-selection";
import {
  sortTrainingDaysByWeekOrder,
  TRAINING_DAY_LABELS,
} from "@/lib/training/training-day-order";
import {
  calculateTargetSummary,
  getActiveRoutineDays,
  getCycleDurationValue,
  getCycleObjectiveValue,
  getRoutineDays,
} from "@/lib/training/training-plan-calculations";
import {
  applyTrainingPlanEdit,
  createNextTrainingPlan,
  resolveTrainingPlanSetupTransition,
  type TrainingPlanEdit,
} from "@/lib/training/training-plan-controller";
import type { TrainingCycleId } from "@/lib/training/training-cycle-id";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import { normalizeTrainingPlanInput } from "@/lib/training/training-plan-normalization";
import {
  createDefaultTrainingPlan,
  getTrainingPlanDurationOptions,
  getTrainingPlanObjectiveOptions as getCycleObjectiveOptions,
} from "@/lib/training/training-plan-rules";
import type {
  SetupDayState,
  SetupExerciseRow,
} from "@/lib/training/training-routine-draft";
import {
  buildTrainingTopbarMeta,
} from "@/lib/training/training-carousel-card-presentation";
import {
  buildTrainingCompletionExerciseInputs,
  buildTrainingCompletionSummary,
  loadTrainingCompletionHistoricalInputs,
} from "@/lib/training/training-completion-summary";

const primaryScreens: Screen[] = ["perfil", "dashboard", "entrenamiento", "comparacion", "registro-entrenamiento", "historial-ciclos"];
const PROFILE_AVATAR_REFRESH_THROTTLE_MS = 45 * 1000;
const PROFILE_AVATAR_ERROR_REFRESH_THROTTLE_MS = 8 * 1000;
const NOTIFICATION_SECTION_HIGHLIGHT_MS = 1800;
const objectiveDescriptions: Record<string, string> = {
  Fuerza: "Busca aumentar la capacidad de levantar más carga. Prioriza ejercicios base, descansos amplios y progresión controlada de peso.",
  Hipertrofia: "Enfocada en aumentar masa muscular. Combina volumen, tensión mecánica y progresión de repeticiones o carga.",
  Recomposición: "Busca mejorar la composición corporal: ganar o mantener músculo mientras se reduce grasa de forma gradual.",
  Definición: "Orientada a mantener músculo mientras baja el porcentaje de grasa. Suele combinar fuerza, volumen moderado y control de fatiga.",
  Rendimiento: "Busca mejorar desempeño físico general o deportivo. Puede mezclar fuerza, potencia, resistencia y técnica según el objetivo.",
  Salud: "Prioriza adherencia, movilidad, control técnico y constancia para mejorar bienestar físico sin sobrecargar al usuario.",
  Potencia: "Trabaja la capacidad de aplicar fuerza rápido. Usa movimientos explosivos, técnica cuidada y descansos suficientes.",
  Resistencia: "Mejora la capacidad de sostener esfuerzo por más tiempo. Suele usar más repeticiones, menor carga relativa y descansos controlados.",
  Descarga: "Reduce volumen o intensidad para recuperar fatiga acumulada y preparar al cuerpo para volver a progresar.",
  Progresión: "Semana enfocada en avanzar: subir carga, sumar repeticiones o mejorar volumen sin perder técnica.",
  Mantenimiento: "Semana para conservar rendimiento y consolidar técnica sin buscar aumentos agresivos de carga.",
  Técnica: "Prioriza ejecución, control del movimiento y calidad de cada repetición por sobre subir peso.",
  Volumen: "Sesión enfocada en acumular trabajo total mediante series y repeticiones suficientes.",
  Intensidad: "Sesión orientada a trabajar con cargas exigentes o esfuerzo alto, cuidando descansos y técnica.",
  "Control/RIR": "Sesión enfocada en regular el esfuerzo usando RIR para saber cuántas repeticiones quedan en reserva.",
};

type TrainingDayLabel = (typeof TRAINING_DAY_LABELS)[number];

interface TrainingCycleSnapshot {
  id: string;
  name: string;
  createdAt: string;
  endedAt: string;
  plan: TrainingPlan;
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
}

interface OrganizatechAppProps {
  trainingCyclesRepositoryEnabled?: boolean;
  trainingCyclesSnapshotSource?: "ui-main-production" | "ui-main-qa";
  trainingWorkoutReadinessV2Enabled?: boolean;
}

export function OrganizatechApp({
  trainingCyclesRepositoryEnabled = false,
  trainingCyclesSnapshotSource = "ui-main-qa",
  trainingWorkoutReadinessV2Enabled = false,
}: OrganizatechAppProps) {
  const initialPasswordRecoveryRouteStateRef = useRef<ReturnType<typeof getPasswordRecoveryRouteState> | null>(null);
  const initialPasswordRecoveryRouteState = initialPasswordRecoveryRouteStateRef.current
    ?? getPasswordRecoveryRouteState();
  initialPasswordRecoveryRouteStateRef.current = initialPasswordRecoveryRouteState;
  const initialAuthState = resolveInitialAuthState(initialPasswordRecoveryRouteState);
  const [screen, setScreen] = useState<Screen>(initialAuthState.screen);
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
  const [sessionName, setSessionName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [statusMessage, setStatusMessage] = useState(initialAuthState.statusMessage);
  const [dataMode, setDataMode] = useState<DataMode>("demo");
  const [supabaseSession, setSupabaseSession] = useState<SupabaseSessionState["session"]>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseSessionState["user"]>(null);
  const [profilePersonalData, setProfilePersonalData] = useState<ProfilePersonalData | null>(null);
  const [profilePersonalDataLoading, setProfilePersonalDataLoading] = useState(false);
  const [profilePersonalDataError, setProfilePersonalDataError] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<ProfileAvatarState>(() => createEmptyProfileAvatarState());
  const [profileAvatarResetKey, setProfileAvatarResetKey] = useState(0);
  const [profileAvatarLoading, setProfileAvatarLoading] = useState(false);
  const [profileAvatarError, setProfileAvatarError] = useState("");
  const [isSupabaseConfiguredState, setIsSupabaseConfiguredState] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(initialAuthState.isAuthLoading);
  const [isBusy, setIsBusy] = useState(false);
  const passwordUpdateSuccessRef = useRef(false);
  const passwordRecoveryUserIdRef = useRef<string | null>(null);
  const passwordRecoveryUpdateOwnerRef = useRef<SessionOperationOwner | null>(null);
  const passwordRecoveryStateRef = useRef<"none" | "pending" | "confirmed" | "invalid">("none");
  const [isPasswordRecoveryConfirmed, setIsPasswordRecoveryConfirmed] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [seenNotificationRecords, setSeenNotificationRecords] = useState<SeenNotificationRecord[]>([]);
  const [isEditingRoutinePlan, setIsEditingRoutinePlan] = useState(false);
  const [routineNotice, setRoutineNotice] = useState("");
  const [isTopbarHidden, setIsTopbarHidden] = useState(false);
  const [routineBuilderState, dispatchRoutineBuilder] = useReducer(
    routineBuilderReducer,
    undefined,
    () => createRoutineBuilderState({
      activeDay: "Lunes",
      setupByDay: createSetupByDay(),
    }),
  );
  const setupDay = routineBuilderState.activeDay;
  const setupByDay = routineBuilderState.setupByDay;
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan>(() => createDefaultTrainingPlan());
  const [activeRoutineDay, setActiveRoutineDay] = useState("Lunes");
  const [dashboardDayOverride, setDashboardDayOverride] = useState("");
  const [progressControllerState, dispatchProgressController] = useReducer(
    progressControllerReducer,
    undefined,
    createInitialProgressControllerState,
  );
  const { state: activeWorkoutState, actions: activeWorkoutActions } = useActiveWorkoutController();
  const {
    activeExerciseIndex, exerciseDrafts, readiness, checkingDailyReadiness,
    savingDailyReadiness, dailyReadinessError, hasStartedTraining,
    activeWorkoutStartedAt, activeWorkoutAttemptId, pendingReadinessLink,
    hasRecoverableWorkoutStart, trainingCompletionSummary,
  } = activeWorkoutState;
  const activeWorkoutAttemptIdRef = useRef<string | null>(null);
  const workoutStartInFlightRef = useRef<SessionOperationOwner | null>(null);
  const dailyReadinessSaveInFlightRef = useRef<SessionOperationOwner | null>(null);
  const workoutCompletionInFlightRef = useRef<SessionOperationOwner | null>(null);
  const profileSaveInFlightRef = useRef<SessionOperationOwner | null>(null);
  const profileAvatarUploadInFlightRef = useRef<SessionOperationOwner | null>(null);
  const routineSaveInFlightRef = useRef<SessionOperationOwner | null>(null);
  const trainingCycleCreateInFlightRef = useRef<SessionOperationOwner | null>(null);
  const trainingCycleDeleteInFlightRef = useRef<SessionOperationOwner | null>(null);
  const lastProfileAvatarRefreshAtRef = useRef(0);
  const profileAvatarBootstrapUserIdRef = useRef<string | null>(null);
  const lastProfileAvatarErrorRefreshAtRef = useRef(0);
  const profileAvatarRefreshInFlightRef = useRef(false);
  const pendingReadinessLinkRef = useRef<PendingWorkoutReadinessLink | null>(null);
  const activeWorkoutReadinessContextRef = useRef<ActiveWorkoutReadinessContext | null>(null);
  // P3-32: el estado data/loading/error, las request-key refs y los effects de historial del
  // ejercicio activo son propiedad exclusiva de useActiveWorkoutExerciseHistory (ver más abajo).
  const [routineEditorReturnScreen, setRoutineEditorReturnScreen] = useState<Screen | null>(null);
  const [cycleHistory, setCycleHistory] = useState<TrainingCycleSnapshot[]>([]);
  const [isNewCycleConfirmOpen, setIsNewCycleConfirmOpen] = useState(false);
  const [isDeleteCycleConfirmOpen, setIsDeleteCycleConfirmOpen] = useState(false);
  const [isRoutineSuccessOpen, setIsRoutineSuccessOpen] = useState(false);
  const [isRoutineUpdateConfirmOpen, setIsRoutineUpdateConfirmOpen] = useState(false);
  const activeBrowserStorageScopeRef = useRef<BrowserStorageScope | null>(null);
  const incomingWorkoutDraftRecoveryScopeRef = useRef<BrowserStorageScope | null>(null);
  const sessionDataEpochRef = useRef(createSessionDataEpoch());
  const sessionDataMountedRef = useRef(true);

  const abortWorkoutStartState = useCallback(() => {
    activeWorkoutAttemptIdRef.current = null;
    pendingReadinessLinkRef.current = null;
    activeWorkoutReadinessContextRef.current = null;
    activeWorkoutActions.abortWorkoutStart();
  }, [activeWorkoutActions]);

  const discardActiveWorkoutState = useCallback(() => {
    activeWorkoutAttemptIdRef.current = null;
    pendingReadinessLinkRef.current = null;
    activeWorkoutReadinessContextRef.current = null;
    activeWorkoutActions.discardWorkout();
  }, [activeWorkoutActions]);

  const advanceSessionDataIdentity = useCallback((
    identity: SessionDataIdentity,
    options: { force?: boolean } = {},
  ) => {
    const current = sessionDataEpochRef.current;
    const next = createAdvancedSessionDataEpoch(current, identity, options);
    if (next === current) return false;

    invalidateSessionOperationOwners([
      workoutStartInFlightRef,
      dailyReadinessSaveInFlightRef,
      workoutCompletionInFlightRef,
      profileSaveInFlightRef,
      profileAvatarUploadInFlightRef,
      routineSaveInFlightRef,
      trainingCycleCreateInFlightRef,
      trainingCycleDeleteInFlightRef,
    ]);
    sessionDataEpochRef.current = next;
    setIsBusy(false);
    profileAvatarRefreshInFlightRef.current = false;
    profileAvatarBootstrapUserIdRef.current = null;
    lastProfileAvatarRefreshAtRef.current = 0;
    lastProfileAvatarErrorRefreshAtRef.current = 0;
    // P3-32: ya no se limpian aquí las request keys de historial. Viven dentro del coordinador y su
    // invalidación ante un cambio de identidad la garantiza el SessionDataRequestToken capturado
    // antes del await: aunque la request key coincidiera por accidente entre dos usuarios, el token
    // deja de ser vigente y el resultado se descarta. Ver runActiveWorkoutHistoryLoad.
    return true;
  }, []);

  const captureSessionDataRequestToken = useCallback((): SessionDataRequestToken => {
    return createSessionDataRequestToken(sessionDataEpochRef.current);
  }, []);

  const isSessionDataRequestCurrent = useCallback((token: SessionDataRequestToken) => {
    return sessionDataMountedRef.current &&
      isSessionDataRequestTokenCurrent(sessionDataEpochRef.current, token);
  }, []);

  const trainingDataIdentityPort = useMemo(() => ({
    captureRequestToken: captureSessionDataRequestToken,
    isRequestTokenCurrent: isSessionDataRequestCurrent,
  }), [captureSessionDataRequestToken, isSessionDataRequestCurrent]);
  const {
    controller: trainingDataController,
    state: trainingDataState,
  } = useTrainingDataController(trainingDataIdentityPort);
  const legacyTrainingData = useMemo(
    () => getTrainingDataResourceValue(trainingDataState.appData),
    [trainingDataState.appData],
  );
  const exercises = useMemo(
    () => [...(legacyTrainingData?.exercises ?? [])],
    [legacyTrainingData],
  );
  const entries = useMemo(
    () => [...(legacyTrainingData?.entries ?? [])],
    [legacyTrainingData],
  );
  const trainingSessions = useMemo(
    () => [...(legacyTrainingData?.sessions ?? [])],
    [legacyTrainingData],
  );
  const dataSource = legacyTrainingData?.source ?? "local";
  const trainingDataView = useMemo(
    () => selectTrainingDataView(trainingDataState, trainingPlan),
    [trainingDataState, trainingPlan],
  );
  const persistedActiveCycle = trainingDataView.activeCycle;
  const persistedCycleHistory = trainingDataView.persistedCycleHistory;
  const cycleScopedPlan = trainingDataView.cyclePlan;
  const displayTrainingPlan = trainingDataView.plan;
  const displayExercises = trainingDataView.exercises;
  const displayEntries = trainingDataView.entries;
  const displayTrainingSessions = trainingDataView.sessions;
  const isCycleScopedActiveCycle = trainingDataView.isCycleScoped;
  const isCycleScopedPlanBlocked = trainingDataView.mode === "blocked";
  const cycleScopedPlanBlockerMessage = trainingDataView.blockerMessage;

  function tryAcquireUserScopedOperation(
    lockRef: SessionOperationOwnerLock,
  ): SessionOperationOwner | null {
    const owner = tryAcquireSessionOperationOwner(
      lockRef.current,
      captureSessionDataRequestToken(),
      { dataMode },
    );
    if (!owner) return null;
    lockRef.current = owner;
    return owner;
  }

  function isUserScopedOperationCurrent(
    lockRef: SessionOperationOwnerLock,
    owner: SessionOperationOwner,
  ): boolean {
    return isSessionOperationOwnerCurrent({
      currentOwner: lockRef.current,
      owner,
      isRequestCurrent: isSessionDataRequestCurrent,
    });
  }

  function settleUserScopedOperation<T>(
    lockRef: SessionOperationOwnerLock,
    owner: SessionOperationOwner,
    request: Promise<T>,
  ) {
    return settleSessionOperationPromise({
      request,
      owner,
      getCurrentOwner: () => lockRef.current,
      isRequestCurrent: isSessionDataRequestCurrent,
    });
  }

  function finalizeUserScopedOperation(
    lockRef: SessionOperationOwnerLock,
    owner: SessionOperationOwner,
  ): boolean {
    const finalization = finalizeSessionOperationOwner({
      currentOwner: lockRef.current,
      owner,
      isRequestCurrent: isSessionDataRequestCurrent,
    });
    lockRef.current = finalization.nextOwner;
    return finalization.canFinalize;
  }

  // Compatibility names retained for the password-recovery hotfix contract;
  // all ownership semantics remain delegated to the canonical P3-41 helpers.
  const tryAcquireActiveWorkoutOperation = tryAcquireUserScopedOperation;
  const isActiveWorkoutOperationCurrent = isUserScopedOperationCurrent;
  const finalizeActiveWorkoutOperation = finalizeUserScopedOperation;

  useEffect(() => {
    sessionDataMountedRef.current = true;
    return () => {
      sessionDataMountedRef.current = false;
      passwordRecoveryUpdateOwnerRef.current = null;
      sessionDataEpochRef.current = createAdvancedSessionDataEpoch(
        sessionDataEpochRef.current,
        { userId: null, scope: null },
        { force: true },
      );
    };
  }, []);

  function confirmPasswordRecoverySession(session: SupabaseSessionState["session"]) {
    const recoveryUserId = normalizePasswordRecoveryUserId(session?.user.id);
    if (!recoveryUserId) {
      invalidatePasswordRecoverySession();
      return;
    }

    passwordRecoveryUserIdRef.current = recoveryUserId;
    passwordRecoveryStateRef.current = "confirmed";
    setIsPasswordRecoveryConfirmed(true);
    confirmPasswordRecoveryFlow(recoveryUserId);
    setIsAuthLoading(false);
    setStatusMessage(resolveInitialAuthStatusMessage("active"));
    applyScreenTransition(resolvePasswordRecoveryRouteTransition("active"));
  }

  function invalidatePasswordRecoverySession() {
    passwordRecoveryUserIdRef.current = null;
    passwordRecoveryUpdateOwnerRef.current = null;
    passwordRecoveryStateRef.current = "invalid";
    setIsPasswordRecoveryConfirmed(false);
    clearPasswordRecoveryFlow();
    clearPasswordRecoveryUrl();
    setIsBusy(false);
    setIsAuthLoading(false);
    setStatusMessage(resolveInitialAuthStatusMessage("expired"));
    applyScreenTransition(resolvePasswordRecoveryRouteTransition("expired"));
  }

  function completePasswordRecoveryUpdate(storageScope: BrowserStorageScope | null): boolean {
    if (!passwordUpdateSuccessRef.current) return false;

    passwordUpdateSuccessRef.current = false;
    setNewPassword("");
    setNewPasswordConfirm("");
    clearPasswordRecoveryUrl();
    clearUserSessionState(
      "Contraseña actualizada correctamente. Ya puedes iniciar sesión.",
      storageScope,
    );
    return true;
  }

  useEffect(() => {
    let isMounted = true;
    const recoveryCallbackAccessToken = getPasswordRecoveryCallbackAccessToken();
    const supabase = getSupabaseBrowserClient();

    async function bootstrapSession() {
      let requestToken = captureSessionDataRequestToken();
      const recoveryState = initialPasswordRecoveryRouteState;
      if (recoveryState === "expired") {
        invalidatePasswordRecoverySession();
        return;
      }
      if (recoveryState === "active") {
        markPasswordRecoveryFlow();
        passwordRecoveryUserIdRef.current = null;
        passwordRecoveryStateRef.current = "pending";
        setIsPasswordRecoveryConfirmed(false);
        setIsAuthLoading(true);
        setStatusMessage(resolveInitialAuthStatusMessage("none"));
      } else {
        setIsAuthLoading(true);
        setStatusMessage(resolveInitialAuthStatusMessage("none"));
      }
      try {
        const authState = await getInitialSupabaseSession();
        if (!isMounted || !isSessionDataRequestCurrent(requestToken)) return;

        applySessionState(authState);
        requestToken = captureSessionDataRequestToken();
        const storedRecovery = loadPasswordRecoveryFlow();
        const recoveryDecision = resolvePasswordRecoverySessionDecision({
          routeState: recoveryState,
          event: "bootstrap",
          sessionLookup: "success",
          sessionUserId: authState.session?.user.id ?? null,
          hasCallbackEvidence: Boolean(recoveryCallbackAccessToken),
          callbackMatchesSession: Boolean(
            recoveryCallbackAccessToken
            && authState.session?.access_token === recoveryCallbackAccessToken
          ),
          storedRecoveryStatus: storedRecovery?.status ?? null,
          storedRecoveryUserId: storedRecovery?.userId ?? null,
        });
        if (recoveryDecision === "invalid") {
          invalidatePasswordRecoverySession();
          return;
        }
        if (recoveryDecision === "confirmed") {
          confirmPasswordRecoverySession(authState.session);
          return;
        }
        if (authState.session) {
          setStatusMessage("");
          const refreshResult = await refreshTrainingDataForSession(authState.dataMode);
          if (!shouldContinueAuthenticatedFlowAfterRefresh(refreshResult.kind)) return;
          if (!isMounted || !isSessionDataRequestCurrent(requestToken)) return;
          if (!restoreActiveFlowForSession(authState.dataMode, authState.user?.id)) {
            applyScreenTransition(createAuthNavigationReset("dashboard", "session-established"));
          }
        } else {
          setStatusMessage(authState.isConfigured ? "Continúa con tu progreso." : getMissingSupabaseMessage());
        }
      } catch (error) {
        if (isMounted && isSessionDataRequestCurrent(requestToken)) {
          if (recoveryState === "active") {
            const storedRecovery = loadPasswordRecoveryFlow();
            const recoveryDecision = resolvePasswordRecoverySessionDecision({
              routeState: recoveryState,
              event: "bootstrap",
              sessionLookup: "error",
              sessionUserId: null,
              hasCallbackEvidence: Boolean(recoveryCallbackAccessToken),
              callbackMatchesSession: false,
              storedRecoveryStatus: storedRecovery?.status ?? null,
              storedRecoveryUserId: storedRecovery?.userId ?? null,
            });
            passwordRecoveryStateRef.current = recoveryDecision;
            setIsPasswordRecoveryConfirmed(false);
            setIsAuthLoading(true);
            setStatusMessage(resolveInitialAuthStatusMessage("none"));
          } else {
            setStatusMessage(translateAuthError(error));
          }
        }
      } finally {
        if (isMounted && isSessionDataRequestCurrent(requestToken)) {
          setIsAuthLoading(passwordRecoveryStateRef.current === "pending");
        }
      }
    }

    void bootstrapSession();

    const authSubscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      const nextState: SupabaseSessionState = {
        isConfigured: true,
        dataMode: session ? "supabase" : "demo",
        session,
        user: session?.user ?? null,
      };

      const previousStorageScope = activeBrowserStorageScopeRef.current;
      if (event === "SIGNED_OUT") {
        if (passwordUpdateSuccessRef.current) {
          completePasswordRecoveryUpdate(previousStorageScope);
          return;
        }
        passwordRecoveryUpdateOwnerRef.current = null;
        clearUserSessionState("Sesión cerrada correctamente.", previousStorageScope);
        return;
      }

      applySessionState(nextState);
      const requestToken = captureSessionDataRequestToken();
      if (passwordRecoveryStateRef.current === "invalid" && event !== "PASSWORD_RECOVERY") return;
      const recoveryState = getPasswordRecoveryRouteState();
      const storedRecovery = loadPasswordRecoveryFlow();
      const recoveryEvent =
        event === "PASSWORD_RECOVERY" || event === "INITIAL_SESSION" || event === "SIGNED_IN"
          ? event
          : null;
      const recoveryDecision = resolvePasswordRecoverySessionDecision({
        routeState: recoveryState,
        event: recoveryEvent,
        sessionLookup: "success",
        sessionUserId: session?.user.id ?? null,
        hasCallbackEvidence: Boolean(recoveryCallbackAccessToken),
        callbackMatchesSession: Boolean(
          recoveryCallbackAccessToken
          && session?.access_token === recoveryCallbackAccessToken
        ),
        storedRecoveryStatus: storedRecovery?.status ?? null,
        storedRecoveryUserId: storedRecovery?.userId ?? null,
      });
      if (recoveryDecision === "invalid") {
        invalidatePasswordRecoverySession();
        return;
      }
      if (recoveryDecision === "confirmed") {
        confirmPasswordRecoverySession(session);
        return;
      }
      if (event === "SIGNED_IN" || (event === "INITIAL_SESSION" && session)) {
        passwordRecoveryUpdateOwnerRef.current = null;
        setStatusMessage("");
        void refreshTrainingDataForSession(nextState.dataMode).then((refreshResult) => {
          if (!shouldContinueAuthenticatedFlowAfterRefresh(refreshResult.kind)) return;
          if (!isMounted || !isSessionDataRequestCurrent(requestToken)) return;
          setIsAuthLoading(false);
          if (!restoreActiveFlowForSession(nextState.dataMode, nextState.user?.id)) {
            applyScreenTransition(createAuthNavigationReset("dashboard", "session-established"));
          }
        });
      }
      if (event === "INITIAL_SESSION" && !session) {
        setIsAuthLoading(false);
        setStatusMessage(nextState.isConfigured ? "Continúa con tu progreso." : getMissingSupabaseMessage());
      }
      if (event === "TOKEN_REFRESHED") {
        setStatusMessage("");
      }
    }).data.subscription;

    if ("serviceWorker" in navigator) {
      const hostname = window.location.hostname;
      const isLocalPreview =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

      if (isLocalPreview) {
        navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
          .then(() => caches.keys())
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .catch(() => undefined);
      } else {
        navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      }
    }

    return () => {
      isMounted = false;
      authSubscription?.unsubscribe();
    };
    // This effect owns the auth subscription lifecycle and must run once. The
    // local orchestration callbacks are intentionally captured at bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    function handleScroll() {
      const currentY = window.scrollY;
      const isScrollingDown = currentY > lastY;
      setIsTopbarHidden(currentY > 80 && isScrollingDown);
      lastY = currentY;
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const scope = getBrowserStorageScope(dataMode, supabaseUser?.id);
    if (!scope || activeBrowserStorageScopeRef.current !== scope) return;
    saveTrainingPlan(trainingPlan, scope, {
      serialize: (plan) => ({
        ...plan,
        trainingDays: sortTrainingDaysByWeekOrder(plan.trainingDays),
      }),
    });
  }, [dataMode, supabaseUser?.id, trainingPlan]);

  useEffect(() => {
    const scope = getBrowserStorageScope(dataMode, supabaseUser?.id);
    if (!scope || activeBrowserStorageScopeRef.current !== scope) return;
    saveCycleHistory(cycleHistory, scope);
  }, [cycleHistory, dataMode, supabaseUser?.id]);

  const hasRoutinePlanForDraft = exercises.length > 0;

  useEffect(() => {
    if (
      screen === "login" ||
      screen === "registro" ||
      screen === "recuperar-password" ||
      screen === "nueva-password" ||
      screen === "recovery-expired"
    ) return;
    const flow = getActiveFlow(screen, hasRoutinePlanForDraft, isEditingRoutinePlan, hasStartedTraining, readiness);

    function persistFlow() {
      const userKey = getBrowserStorageScope(dataMode, supabaseUser?.id);
      if (!userKey || activeBrowserStorageScopeRef.current !== userKey) return;
      saveActiveFlow({
        version: ACTIVE_FLOW_VERSION,
        updatedAt: Date.now(),
        dataMode,
        userKey,
        flow,
      });
    }

    persistFlow();
    window.addEventListener("pagehide", persistFlow);
    document.addEventListener("visibilitychange", persistFlow);

    return () => {
      window.removeEventListener("pagehide", persistFlow);
      document.removeEventListener("visibilitychange", persistFlow);
    };
  }, [dataMode, hasRoutinePlanForDraft, hasStartedTraining, isEditingRoutinePlan, readiness, screen, supabaseUser?.id]);

  useEffect(() => {
    const isRoutineDraftActive = screen === "registro-entrenamiento" && (!hasRoutinePlanForDraft || isEditingRoutinePlan);
    if (!isRoutineDraftActive) return;

    function persistDraft() {
      const userKey = getBrowserStorageScope(dataMode, supabaseUser?.id);
      if (!userKey || activeBrowserStorageScopeRef.current !== userKey) return;
      saveRoutineDraft({
        version: ROUTINE_DRAFT_VERSION,
        updatedAt: Date.now(),
        dataMode,
        userKey,
        screen,
        setupDay,
        setupByDay,
        trainingPlan,
        isEditingRoutinePlan,
        routineEditorReturnScreen,
        activeRoutineDay,
      });
    }

    persistDraft();
    window.addEventListener("pagehide", persistDraft);
    document.addEventListener("visibilitychange", persistDraft);

    return () => {
      window.removeEventListener("pagehide", persistDraft);
      document.removeEventListener("visibilitychange", persistDraft);
    };
  }, [activeRoutineDay, dataMode, hasRoutinePlanForDraft, isEditingRoutinePlan, routineEditorReturnScreen, screen, setupByDay, setupDay, supabaseUser?.id, trainingPlan]);

  useEffect(() => {
    const isWorkoutDraftActive = screen === "entrenamiento" && hasStartedTraining;
    if (!isWorkoutDraftActive || !activeWorkoutStartedAt) return;
    const stableWorkoutStartedAt = activeWorkoutStartedAt;
    const workoutScope = getBrowserStorageScope(dataMode, supabaseUser?.id);

    function persistWorkoutDraft() {
      if (!workoutScope || activeBrowserStorageScopeRef.current !== workoutScope) return;
      saveActiveWorkoutDraft({
        updatedAt: Date.now(),
        dataMode,
        userId: supabaseUser?.id,
        activeRoutineDay,
        activeExerciseIndex,
        activeWorkoutStartedAt: stableWorkoutStartedAt,
        hasStartedTraining,
        readiness,
        exerciseDrafts,
        workoutAttemptId: activeWorkoutAttemptIdRef.current ?? activeWorkoutAttemptId,
        pendingReadinessLink: pendingReadinessLinkRef.current,
        cycleId: activeWorkoutReadinessContextRef.current?.cycleId ?? null,
        cycleDayId: activeWorkoutReadinessContextRef.current?.cycleDayId ?? null,
        plannedDay: activeWorkoutReadinessContextRef.current?.plannedDay ?? null,
        plannedDate: activeWorkoutReadinessContextRef.current?.plannedDate ?? null,
      });
    }

    persistWorkoutDraft();
    window.addEventListener("pagehide", persistWorkoutDraft);
    document.addEventListener("visibilitychange", persistWorkoutDraft);

    return () => {
      window.removeEventListener("pagehide", persistWorkoutDraft);
      document.removeEventListener("visibilitychange", persistWorkoutDraft);
    };
  }, [activeExerciseIndex, activeRoutineDay, activeWorkoutAttemptId, activeWorkoutStartedAt, dataMode, exerciseDrafts, hasStartedTraining, pendingReadinessLink, readiness, screen, supabaseUser?.id]);

  useEffect(() => {
    if (screen === "entrenamiento" && !hasStartedTraining && !hasRecoverableWorkoutStart) {
      const scope = getBrowserStorageScope(dataMode, supabaseUser?.id);
      if (scope && incomingWorkoutDraftRecoveryScopeRef.current === scope) return;
      clearWorkoutDraft(dataMode, supabaseUser?.id);
    }
  }, [dataMode, hasRecoverableWorkoutStart, hasStartedTraining, screen, supabaseUser?.id]);

  useEffect(() => {
    const isActiveWorkout = screen === "entrenamiento" && hasStartedTraining;
    const isPausedWorkoutOnDashboard = shouldRetainActiveWorkoutAttemptState({ screen, hasStartedTraining });
    if (isActiveWorkout && !activeWorkoutStartedAt) {
      activeWorkoutActions.recordWorkoutStartedAt(createStableWorkoutStartedAt());
      return;
    }
    if (!isActiveWorkout && !isPausedWorkoutOnDashboard && !hasRecoverableWorkoutStart && (activeWorkoutStartedAt || activeWorkoutAttemptId || pendingReadinessLink)) {
      abortWorkoutStartState();
    }
  }, [abortWorkoutStartState, activeWorkoutActions, activeWorkoutAttemptId, activeWorkoutStartedAt, hasRecoverableWorkoutStart, hasStartedTraining, pendingReadinessLink, screen]);

  useEffect(() => {
    if (screen === "training-summary" && !trainingCompletionSummary) {
      applyScreenTransition(createFlowScreenTransition("dashboard", "summary-state-sanitized"));
    }
    // El adaptador de transiciones solo envuelve setters estables de React; incluirlo como
    // dependencia re-ejecutaría el saneamiento en cada render sin cambiar su resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, trainingCompletionSummary]);

  const hasSupabaseSession = Boolean(
    supabaseSession && supabaseUser && supabaseSession.user.id === supabaseUser.id,
  );
  const canEditProfilePersonalData = Boolean(hasSupabaseSession && getSupabaseBrowserClient());
  const isTrainingCyclesRepositoryActive = trainingCyclesRepositoryEnabled && dataMode === "supabase" && hasSupabaseSession;
  const todayKey = getSantiagoDateKey(new Date());
  const currentWeek = isCycleScopedActiveCycle && persistedActiveCycle?.plannedStartDate
    ? getCycleCalendarWeekNumber(persistedActiveCycle.plannedStartDate, todayKey)
    : getLegacyWeekNumberForTrainingDate(displayTrainingSessions, displayEntries, todayKey);
  const calendarNormalizedTrainingSessions = useMemo(
    () => isCycleScopedActiveCycle && persistedActiveCycle?.plannedStartDate
      ? normalizeCycleScopedSessionsByCalendarWeek(displayTrainingSessions, persistedActiveCycle.plannedStartDate)
      : displayTrainingSessions,
    [displayTrainingSessions, isCycleScopedActiveCycle, persistedActiveCycle?.plannedStartDate],
  );
  const calendarNormalizedEntries = useMemo(
    () => isCycleScopedActiveCycle && persistedActiveCycle?.plannedStartDate
      ? normalizeCycleScopedEntriesByCalendarWeek(displayEntries, persistedActiveCycle.plannedStartDate)
      : displayEntries,
    [displayEntries, isCycleScopedActiveCycle, persistedActiveCycle?.plannedStartDate],
  );
  const metrics = useMemo(() => calculateWeeklyComparison(calendarNormalizedEntries), [calendarNormalizedEntries]);
  const hasTrainingEntries = isCycleScopedActiveCycle
    ? calendarNormalizedEntries.length > 0 || calendarNormalizedTrainingSessions.some((session) => session.status === "completed" && !session.deletedAt && session.entries.length > 0)
    : calendarNormalizedTrainingSessions.some((session) => session.status === "completed" && !session.deletedAt && session.entries.length > 0);
  const hasRoutinePlan = displayExercises.length > 0;
  const routineDays = getActiveRoutineDays(displayExercises, displayTrainingPlan);
  const progressControllerView = buildProgressControllerView(
    progressControllerState,
    {
      plannedExercises: displayExercises,
      entries: metrics,
      routineDays,
      currentWeek,
    },
  );
  const dashboardCarouselDays = hasRoutinePlan ? routineDays : TRAINING_DAY_LABELS;
  const visibleDay = getVisibleTrainingDay(displayExercises, activeRoutineDay);
  const calendarDashboardDay = getCalendarTrainingDay();
  const dashboardDay = resolveDashboardActiveDay({
    dashboardDayOverride,
    calendarDashboardDay,
    carouselDays: dashboardCarouselDays,
  });
  const dayExercises = displayExercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay);
  const dashboardExercises = displayExercises.filter((exercise) => (exercise.day ?? dashboardDay) === dashboardDay);
  const activeWorkoutExercise = screen === "entrenamiento" && hasStartedTraining && readiness
    ? dayExercises[activeExerciseIndex] ?? dayExercises[0] ?? null
    : null;
  const activeWorkoutExerciseLineageId = activeWorkoutExercise?.exerciseLineageId ?? null;
  const activeWorkoutExerciseId = activeWorkoutExercise?.id ?? null;
  const visibleRoutine = dayExercises[0]?.routine ?? setupByDay[visibleDay]?.routineName ?? visibleDay;
  const targetSummary = calculateTargetSummary(dayExercises);
  const currentMetrics = metrics.filter((entry) => entry.week === currentWeek);
  const summary = calculateWeeklySummary(metrics, currentWeek);
  const weeklyEquivalentProgress = useMemo(() => calculateEquivalentWeeklyProgress({
    entries: calendarNormalizedEntries,
    sessions: calendarNormalizedTrainingSessions,
    referenceDate: new Date(),
    activeCycleId: isCycleScopedActiveCycle ? persistedActiveCycle?.id ?? null : null,
    plannedDays: routineDays,
  }), [calendarNormalizedEntries, calendarNormalizedTrainingSessions, isCycleScopedActiveCycle, persistedActiveCycle?.id, routineDays]);
  const visibleCycleHistoryCount = isTrainingCyclesRepositoryActive ? persistedCycleHistory.length : cycleHistory.length;
  const visibleCycleNumber = isTrainingCyclesRepositoryActive
    ? persistedActiveCycle?.cycleNumber ?? getNextPersistedCycleNumber(persistedActiveCycle, persistedCycleHistory)
    : cycleHistory.length + 1;
  const authModeLabel = dataMode === "supabase" && hasSupabaseSession ? "Activo" : isSupabaseConfiguredState ? "Listo" : "Prueba";
  const profileViewModel = useMemo(() => buildProfileViewModelFromSources({
    personalData: profilePersonalData,
    sessionDisplayName: sessionName,
    sessionEmail: supabaseUser?.email ?? null,
    dataSource,
    canEditPersonalData: canEditProfilePersonalData,
    avatar: profileAvatar,
  }), [canEditProfilePersonalData, dataSource, profileAvatar, profilePersonalData, sessionName, supabaseUser?.email]);
  const refreshProfileAvatar = useCallback(async (options?: { force?: boolean; avatarPath?: string | null; allowProfileLookup?: boolean }) => {
    const requestToken = captureSessionDataRequestToken();
    if (!isSessionDataRequestCurrent(requestToken) || !requestToken.userId || !requestToken.scope) return null;
    if (!canEditProfilePersonalData || !supabaseSession) return null;
    if (profileAvatarRefreshInFlightRef.current) return null;

    const now = Date.now();
    if (!options?.force && now - lastProfileAvatarRefreshAtRef.current < PROFILE_AVATAR_REFRESH_THROTTLE_MS) {
      return null;
    }

    lastProfileAvatarRefreshAtRef.current = now;
    profileAvatarRefreshInFlightRef.current = true;
    try {
      let avatarPath = selectProfileAvatarPath(
        options?.avatarPath,
        profileAvatar.avatarPath,
        profilePersonalData?.avatarPath,
      );
      if (!avatarPath && options?.allowProfileLookup) {
        const profile = await getProfilePersonalData();
        if (!isSessionDataRequestCurrent(requestToken)) return null;
        setProfilePersonalData(profile);
        setSessionName(profile.displayName);
        avatarPath = profile.avatarPath;
        if (!avatarPath) {
          setProfileAvatar(createEmptyProfileAvatarState());
          setProfileAvatarResetKey((current) => current + 1);
          setProfileAvatarError("");
          return null;
        }
      }

      if (!avatarPath) return null;

      const avatar = await getCurrentProfileAvatar();
      if (!isSessionDataRequestCurrent(requestToken)) return null;
      setProfileAvatar(avatar);
      if (avatar.avatarUrl) {
        setProfileAvatarResetKey((current) => current + 1);
      }
      setProfileAvatarError("");
      return avatar;
    } catch {
      if (!isSessionDataRequestCurrent(requestToken)) return null;
      setProfileAvatarError("No pudimos actualizar tu foto de perfil. La mostraremos apenas vuelva a estar disponible.");
      return null;
    } finally {
      if (isSessionDataRequestCurrent(requestToken)) {
        profileAvatarRefreshInFlightRef.current = false;
      }
    }
  }, [canEditProfilePersonalData, captureSessionDataRequestToken, isSessionDataRequestCurrent, profileAvatar.avatarPath, profilePersonalData?.avatarPath, supabaseSession]);
  const completedTrainingDays = calculateWeeklyCompletedTrainingDays({
    plannedDays: dashboardCarouselDays,
    exercises: displayExercises,
    entries: calendarNormalizedEntries,
    sessions: calendarNormalizedTrainingSessions,
    usesCycleScopedSessions: isCycleScopedActiveCycle,
  });
  const todayTrainingNotificationContext = useMemo(() => getTodayTrainingNotificationContext({
    plannedDays: dashboardCarouselDays,
    exercises: displayExercises,
    entries: calendarNormalizedEntries,
    sessions: calendarNormalizedTrainingSessions,
    usesCycleScopedSessions: isCycleScopedActiveCycle,
  }), [calendarNormalizedEntries, calendarNormalizedTrainingSessions, dashboardCarouselDays, displayExercises, isCycleScopedActiveCycle]);
  const plannedTrainingDays = hasRoutinePlan ? dashboardCarouselDays.length : 0;
  const trainingTopbarMeta = buildTrainingTopbarMeta({
    cycleLabel: getCycleTypeTitle(displayTrainingPlan),
    weekNumber: currentWeek,
    completedDays: completedTrainingDays,
    plannedDays: hasRoutinePlan ? dashboardCarouselDays.length : 0,
  });
  const appNotifications = useMemo(() => buildAppNotifications({
    profile: profileViewModel,
    personalData: profilePersonalData,
    currentWeek,
    completedDays: completedTrainingDays,
    plannedDays: plannedTrainingDays,
    hasTrainingEntries,
    hasRoutinePlan,
    weeklyEquivalentProgress,
    summary,
    currentMetrics,
    todayTraining: todayTrainingNotificationContext,
  }), [
    completedTrainingDays,
    currentMetrics,
    currentWeek,
    hasRoutinePlan,
    hasTrainingEntries,
    plannedTrainingDays,
    profilePersonalData,
    profileViewModel,
    summary,
    todayTrainingNotificationContext,
    weeklyEquivalentProgress,
  ]);
  const notificationView = useMemo(
    () => selectNotificationView(appNotifications, seenNotificationRecords),
    [appNotifications, seenNotificationRecords],
  );
  const {
    newNotifications,
    historyNotifications,
    unseenCount: unseenNotificationCount,
    seenRecordsById: seenNotificationRecordsById,
  } = notificationView;
  const notificationPanelSubtitle = useMemo(
    () => buildNotificationPanelSubtitleText(unseenNotificationCount, appNotifications.length),
    [appNotifications.length, unseenNotificationCount],
  );
  const notificationBadgeText = useMemo(
    () => buildNotificationBadgeText(unseenNotificationCount),
    [unseenNotificationCount],
  );
  const notificationBadgeAriaLabel = useMemo(
    () => buildNotificationBadgeAriaLabel(unseenNotificationCount),
    [unseenNotificationCount],
  );

  const {
    latestExercisePerformance,
    latestExercisePerformanceLoading,
    latestExercisePerformanceError,
    latestExerciseObservation,
    latestExerciseObservationLoading,
    latestExerciseObservationError,
    latestExerciseObservationDidQuery,
    resetExerciseHistory,
    resetExercisePerformanceHistory,
  } = useActiveWorkoutExerciseHistory({
    activeWorkoutExerciseId,
    activeWorkoutExerciseLineageId,
    activeWorkoutStartedAt,
    observationUserId: supabaseUser?.id ?? null,
    captureSessionDataRequestToken,
    isSessionDataRequestCurrent,
  });

  const resetActiveWorkoutSessionState = useCallback(() => {
    const hadActiveWorkoutBusyOwner = Boolean(workoutCompletionInFlightRef.current);

    workoutStartInFlightRef.current = null;
    dailyReadinessSaveInFlightRef.current = null;
    workoutCompletionInFlightRef.current = null;
    activeWorkoutAttemptIdRef.current = null;
    pendingReadinessLinkRef.current = null;
    activeWorkoutReadinessContextRef.current = null;

    activeWorkoutActions.resetActiveWorkout();
    setRoutineNotice("");

    // P3-32: el coordinador es dueño de ambos flujos; el reset delega en su propia API en lugar de
    // manipular refs/estado que ya no pertenecen al root.
    resetExerciseHistory();

    if (hadActiveWorkoutBusyOwner) setIsBusy(false);
  }, [activeWorkoutActions, resetExerciseHistory]);

  useEffect(() => {
    const currentUserId = supabaseUser?.id ?? null;
    if (!canEditProfilePersonalData || !currentUserId) {
      profileAvatarBootstrapUserIdRef.current = null;
      return;
    }

    if (profileAvatarBootstrapUserIdRef.current === currentUserId) return;
    profileAvatarBootstrapUserIdRef.current = currentUserId;
    void refreshProfileAvatar({ force: true, allowProfileLookup: true });
  }, [canEditProfilePersonalData, refreshProfileAvatar, supabaseUser?.id]);

  useEffect(() => {
    if (screen !== "perfil" || !canEditProfilePersonalData) {
      if (!canEditProfilePersonalData) {
        setProfilePersonalData(null);
        setProfilePersonalDataLoading(false);
        setProfilePersonalDataError("");
        setProfileAvatar(createEmptyProfileAvatarState());
        setProfileAvatarLoading(false);
        setProfileAvatarError("");
      }
      return;
    }

    let isMounted = true;
    const requestToken = captureSessionDataRequestToken();
    if (!isSessionDataRequestCurrent(requestToken) || !requestToken.userId || !requestToken.scope) return;
    setProfilePersonalDataLoading(true);
    setProfilePersonalDataError("");
    setProfileAvatarLoading(true);
    setProfileAvatarError("");

    void getProfilePersonalData()
      .then(async (profile) => {
        if (!isMounted || !isSessionDataRequestCurrent(requestToken)) return;
        setProfilePersonalData(profile);
        setSessionName(profile.displayName);
        await refreshProfileAvatar({ force: true, avatarPath: profile.avatarPath });
        if (!isMounted || !isSessionDataRequestCurrent(requestToken)) return;
      })
      .catch((error) => {
        if (!isMounted || !isSessionDataRequestCurrent(requestToken)) return;
        setProfilePersonalDataError(error instanceof Error ? error.message : "No pudimos cargar tu perfil.");
      })
      .finally(() => {
        if (isMounted && isSessionDataRequestCurrent(requestToken)) {
          setProfilePersonalDataLoading(false);
          setProfileAvatarLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canEditProfilePersonalData, captureSessionDataRequestToken, isSessionDataRequestCurrent, refreshProfileAvatar, screen]);

  useEffect(() => {
    function refreshAvatarOnResume() {
      void refreshProfileAvatar({ force: true, allowProfileLookup: true });
    }

    function refreshAvatarOnVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshAvatarOnResume();
      }
    }

    document.addEventListener("visibilitychange", refreshAvatarOnVisibilityChange);
    window.addEventListener("focus", refreshAvatarOnResume);
    window.addEventListener("pageshow", refreshAvatarOnResume);
    window.addEventListener("online", refreshAvatarOnResume);

    return () => {
      document.removeEventListener("visibilitychange", refreshAvatarOnVisibilityChange);
      window.removeEventListener("focus", refreshAvatarOnResume);
      window.removeEventListener("pageshow", refreshAvatarOnResume);
      window.removeEventListener("online", refreshAvatarOnResume);
    };
  }, [refreshProfileAvatar]);

  function resetUserScopedTransientState() {
    setIsMenuOpen(false);
    setIsNotificationPanelOpen(false);
    setIsTopbarHidden(false);
    setIsNewCycleConfirmOpen(false);
    setIsDeleteCycleConfirmOpen(false);
    setIsRoutineSuccessOpen(false);
    setIsRoutineUpdateConfirmOpen(false);
    setIsEditingRoutinePlan(false);
    setRoutineEditorReturnScreen(null);
    setRoutineNotice("");
    setDashboardDayOverride("");
    dispatchProgressController({ type: "selection_reset" });
    clearAuthForms();
    setStatusMessage("");
  }

  function applySessionState(authState: SupabaseSessionState) {
    const authenticatedUser = resolveEffectiveAuthenticatedUser(authState.session, authState.user);
    const effectiveSession = authenticatedUser ? authState.session : null;
    const effectiveDataMode: DataMode = effectiveSession ? authState.dataMode : "demo";
    const nextStorageScope = getBrowserStorageScope(effectiveDataMode, authenticatedUser?.id);
    const nextIdentity = {
      userId: authenticatedUser?.id ?? null,
      scope: nextStorageScope,
    };
    const sessionBoundary = resolveActiveWorkoutSessionBoundary({
      currentIdentity: sessionDataEpochRef.current,
      nextIdentity,
      event: "session_applied",
    });
    const identityChanged = sessionBoundary.invalidateEpoch
      ? advanceSessionDataIdentity(nextIdentity, { force: sessionBoundary.forceEpochAdvance })
      : false;
    const hasStorageScopeChanged = activeBrowserStorageScopeRef.current !== nextStorageScope;
    if (identityChanged || hasStorageScopeChanged) {
      trainingDataController.reset({
        cyclesEnabled: trainingCyclesRepositoryEnabled &&
          effectiveDataMode === "supabase" &&
          Boolean(effectiveSession),
      });
    }
    if (sessionBoundary.resetActiveWorkoutMemory) {
      incomingWorkoutDraftRecoveryScopeRef.current = resolveIncomingWorkoutDraftRecoveryScope({
        scope: nextStorageScope,
        willAttemptAutomaticRecovery: Boolean(effectiveSession),
      });
      resetActiveWorkoutSessionState();
      resetUserScopedTransientState();
    }
    if (hasStorageScopeChanged) {
      setTrainingPlan(createDefaultTrainingPlan());
      dispatchRoutineBuilder({ type: "reset_state", setupByDay: createSetupByDay(), activeDay: "Lunes" });
      setCycleHistory([]);
      setSeenNotificationRecords([]);
      // P3-32: se conserva exactamente el alcance previo — el cambio de storage scope deja en idle
      // sólo la performance, sin tocar la observación, porque es una condición independiente del
      // reset de memoria de Active Workout.
      resetExercisePerformanceHistory();
      activeBrowserStorageScopeRef.current = nextStorageScope;

      if (typeof window !== "undefined" && nextStorageScope) {
        setTrainingPlan(loadTrainingPlan(nextStorageScope, {
          normalize: normalizePersistedTrainingPlan,
          createDefault: createDefaultTrainingPlan,
        }));
        setCycleHistory(loadCycleHistory<TrainingCycleSnapshot>(nextStorageScope));
        setSeenNotificationRecords(loadSeenNotificationRecords(nextStorageScope));
      }
    }
    if (identityChanged) {
      setProfilePersonalData(null);
      setProfilePersonalDataLoading(false);
      setProfilePersonalDataError("");
      setProfileAvatar(createEmptyProfileAvatarState());
      setProfileAvatarResetKey((current) => current + 1);
      setProfileAvatarLoading(false);
      setProfileAvatarError("");
    }
    setIsSupabaseConfiguredState(authState.isConfigured);
    setDataMode(effectiveDataMode);
    setSupabaseSession(effectiveSession);
    setSupabaseUser(authenticatedUser);
    if (authenticatedUser) setSessionName(getSessionDisplayName(authenticatedUser));
  }

  function clearUserSessionState(
    message: string,
    storageScope = activeBrowserStorageScopeRef.current,
    options: { navigate?: boolean } = {},
  ) {
    if (
      activeBrowserStorageScopeRef.current === null &&
      sessionDataEpochRef.current.userId === null &&
      sessionDataEpochRef.current.scope === null
    ) return false;

    const signedOutIdentity = { userId: null, scope: null };
    const sessionBoundary = resolveActiveWorkoutSessionBoundary({
      currentIdentity: sessionDataEpochRef.current,
      nextIdentity: signedOutIdentity,
      event: "signed_out",
    });
    if (sessionBoundary.invalidateEpoch) {
      advanceSessionDataIdentity(signedOutIdentity, { force: sessionBoundary.forceEpochAdvance });
    }
    trainingDataController.reset({ cyclesEnabled: false });
    if (sessionBoundary.resetActiveWorkoutMemory) {
      incomingWorkoutDraftRecoveryScopeRef.current = null;
      resetActiveWorkoutSessionState();
    }
    resetUserScopedTransientState();
    if (sessionBoundary.clearClosingStorageScope) {
      clearBrowserStorageScope(storageScope);
    }
    passwordRecoveryUserIdRef.current = null;
    passwordRecoveryStateRef.current = "none";
    setIsPasswordRecoveryConfirmed(false);
    clearPasswordRecoveryFlow();
    activeBrowserStorageScopeRef.current = null;
    setSupabaseSession(null);
    setSupabaseUser(null);
    setProfilePersonalData(null);
    setProfilePersonalDataLoading(false);
    setProfilePersonalDataError("");
    setProfileAvatar(createEmptyProfileAvatarState());
    setProfileAvatarResetKey((current) => current + 1);
    setProfileAvatarLoading(false);
    setProfileAvatarError("");
    setDataMode("demo");
    setIsBusy(false);
    setTrainingPlan(createDefaultTrainingPlan());
    dispatchRoutineBuilder({ type: "reset_state", setupByDay: createSetupByDay(), activeDay: "Lunes" });
    setCycleHistory([]);
    setSeenNotificationRecords([]);
    if (options.navigate !== false) {
      applyContextualNavigation(resetContextualNavigation("login"));
    }
    setStatusMessage(message);
    return true;
  }

  function clearBrowserStorageScope(scope: BrowserStorageScope | null) {
    clearStoredBrowserStorageScope(scope);
  }

  function applyContextualNavigation(navigation: ContextualNavigationState) {
    setScreenHistory([...navigation.history]);
    setScreen(navigation.screen);
  }

  // Adaptador único de transiciones canónicas (P3-07B): toda pantalla fuera de la navegación
  // contextual del usuario se aplica aquí, según la política de historial de la transición.
  function applyScreenTransition(transition: ScreenTransition) {
    if (transition.historyPolicy === "reset") {
      applyContextualNavigation(resetContextualNavigation(transition.screen));
      return;
    }
    setScreen(transition.screen);
  }

  function restoreActiveFlowForSession(mode: DataMode, userId?: string) {
    const recoveryScope = getBrowserStorageScope(mode, userId);
    const activeFlow = loadActiveFlow(mode, userId);
    if (incomingWorkoutDraftRecoveryScopeRef.current === recoveryScope) {
      incomingWorkoutDraftRecoveryScopeRef.current = null;
    }
    if (!activeFlow) return false;
    const restoration = resolveActiveFlowRestoration(activeFlow.flow);

    if (restoration.kind === "routine-draft") {
      return restoreRoutineDraftForSession(mode, userId);
    }

    if (restoration.kind === "workout-draft") {
      return restoreWorkoutDraftForSession(mode, userId);
    }

    if (restoration.kind !== "screen") return false;
    if (restoration.resetTrainingStart) {
      activeWorkoutActions.clearTrainingStart();
    }
    applyContextualNavigation(resetContextualNavigation(restoration.screen));
    setIsMenuOpen(false);
    return true;
  }

  function restoreRoutineDraftForSession(mode: DataMode, userId?: string) {
    const draft = loadRoutineDraft(mode, userId, {
      setupDays: TRAINING_DAY_LABELS,
      resolveSetupRecovery(input) {
        const result = resolveRoutineBuilderDraftRecovery(input);
        if (result.kind === "discard") {
          return { kind: "discard", shouldClearStoredDraft: true };
        }

        return {
          kind: "restore",
          setupDay: result.state.activeDay,
          setupByDay: result.state.setupByDay,
          recovery: result.recovery,
        };
      },
      normalizeTrainingPlan: normalizePersistedTrainingPlan,
    });
    if (!draft) return false;

    dispatchRoutineBuilder({
      type: "replace_state",
      state: { activeDay: draft.setupDay, setupByDay: draft.setupByDay },
    });
    setTrainingPlan(draft.trainingPlan);
    setIsEditingRoutinePlan(draft.isEditingRoutinePlan);
    setRoutineEditorReturnScreen(draft.routineEditorReturnScreen);
    setActiveRoutineDay(draft.activeRoutineDay);
    applyContextualNavigation(resetContextualNavigation("registro-entrenamiento"));
    setIsMenuOpen(false);
    if (draft.recovery.kind === "full") {
      setStatusMessage("Recuperamos tu avance pendiente.");
    } else if (draft.recovery.discardedRowCount === 1) {
      setStatusMessage("Recuperamos parte de tu avance pendiente. Se descartó 1 fila inválida.");
    } else {
      setStatusMessage(
        `Recuperamos parte de tu avance pendiente. Se descartaron ${draft.recovery.discardedRowCount} filas inválidas.`,
      );
    }
    return true;
  }

  function restoreWorkoutDraftForSession(mode: DataMode, userId?: string) {
    return restoreWorkoutDraftRecord(loadWorkoutDraft(mode, userId));
  }

  function restoreWorkoutDraftRecord(draft: NonNullable<ReturnType<typeof loadWorkoutDraft>> | null) {
    if (!draft) return false;

    const recovery = resolveActiveWorkoutRecoveryTransition({
      activeExerciseIndex: draft.activeExerciseIndex,
      activeWorkoutStartedAt: draft.activeWorkoutStartedAt,
      activeWorkoutAttemptId: draft.workoutAttemptId,
      pendingReadinessLink: draft.pendingReadinessLink,
      hasStartedTraining: draft.hasStartedTraining,
      readiness: draft.readiness,
      exerciseDrafts: draft.exerciseDrafts,
    });
    if (recovery.kind === "rejected") return false;

    setActiveRoutineDay(draft.activeRoutineDay);
    activeWorkoutAttemptIdRef.current = recovery.value.activeWorkoutAttemptId;
    pendingReadinessLinkRef.current = recovery.value.pendingReadinessLink;
    activeWorkoutReadinessContextRef.current = createActiveWorkoutReadinessContext({
      workoutAttemptId: recovery.value.activeWorkoutAttemptId,
      cycleId: draft.cycleId,
      cycleDayId: draft.cycleDayId,
      workoutStartedAt: recovery.value.activeWorkoutStartedAt,
      plannedDay: draft.plannedDay,
      plannedDate: draft.plannedDate,
    });
    activeWorkoutActions.recoverWorkout(recovery.value);
    setIsEditingRoutinePlan(false);
    applyContextualNavigation(resetContextualNavigation("entrenamiento"));
    setIsMenuOpen(false);
    setStatusMessage("Recuperamos tu entrenamiento pendiente.");
    return true;
  }

  function restoreActiveWorkoutForNavigation() {
    const recoveryScope = getBrowserStorageScope(dataMode, supabaseUser?.id);
    const draft = loadWorkoutDraft(dataMode, supabaseUser?.id);
    if (incomingWorkoutDraftRecoveryScopeRef.current === recoveryScope) {
      incomingWorkoutDraftRecoveryScopeRef.current = null;
    }
    const memoryState = {
      attemptV2: trainingWorkoutReadinessV2Enabled && isCycleScopedActiveCycle,
      hasStartedTraining,
      readiness,
      activeWorkoutStartedAt,
      workoutAttemptId: activeWorkoutAttemptIdRef.current ?? activeWorkoutAttemptId,
      cycleId: activeWorkoutReadinessContextRef.current?.cycleId ?? null,
      cycleDayId: activeWorkoutReadinessContextRef.current?.cycleDayId ?? null,
    };
    const decision = resolveActiveWorkoutReentryDecision(memoryState, Boolean(draft));

    if (decision === "resume-memory" && canResumeActiveWorkoutFromMemory(memoryState)) {
      applyContextualNavigation(resetContextualNavigation("entrenamiento"));
      setIsMenuOpen(false);
      return true;
    }

    if (decision === "restore-draft") {
      return restoreWorkoutDraftRecord(draft);
    }

    return false;
  }

  function applyTrainingDataRefreshResult(
    result: TrainingDataRefreshResult,
    options: { updateStatus?: boolean } = {},
  ) {
    if (result.kind === "stale") return result;
    if (result.kind === "error") {
      if (result.resource === "app-data") {
        handlePersistenceError(result.error, { preserveSession: true });
      } else {
        setStatusMessage(translateTrainingCycleRepositoryError(result.error));
      }
      return result;
    }

    const nextView = selectTrainingDataView(result.state, trainingPlan);
    if (nextView.mode !== "blocked") {
      setActiveRoutineDay((current) => getVisibleTrainingDay(nextView.exercises, current));
    }
    setTrainingPlan((current) => {
      const currentView = selectTrainingDataView(result.state, current);
      if (currentView.activeCycle) return currentView.plan;
      if (currentView.mode === "legacy" && result.appData) {
        return mergeTrainingPlanWithExercises(current, [...result.appData.exercises]);
      }
      return current;
    });
    if (options.updateStatus && result.appData) {
      setStatusMessage(result.appData.source === "supabase" ? "Progreso actualizado." : "Modo de prueba activo.");
    }
    return result;
  }

  async function refreshTrainingDataForSession(mode = dataMode) {
    const requestToken = captureSessionDataRequestToken();
    let canFinalizeBusy = false;
    const requestScope = getBrowserStorageScope(mode, requestToken.userId);
    if (!isSessionDataRequestCurrent(requestToken) || !requestScope || requestScope !== requestToken.scope) {
      return { kind: "stale", state: trainingDataController.getState() } as const;
    }
    setIsBusy(true);
    try {
      const result = await trainingDataController.refreshForIdentity({
        mode,
        cyclesEnabled: trainingCyclesRepositoryEnabled &&
          mode === "supabase" &&
          Boolean(requestToken.userId),
      });
      if (!isSessionDataRequestCurrent(requestToken)) {
        return { kind: "stale", state: trainingDataController.getState() } as const;
      }
      canFinalizeBusy = result.kind !== "stale";
      return applyTrainingDataRefreshResult(result, { updateStatus: true });
    } finally {
      const currentState = trainingDataController.getState();
      const isTrainingDataLoading = currentState.appData.status === "loading" ||
        currentState.cycles.status === "loading" ||
        currentState.cycleScoped.status === "loading";
      if (canFinalizeBusy && isSessionDataRequestCurrent(requestToken) && !isTrainingDataLoading) {
        setIsBusy(false);
      }
    }
  }

  async function refreshProfilePersonalData() {
    const requestToken = captureSessionDataRequestToken();
    if (!isSessionDataRequestCurrent(requestToken) || !requestToken.userId || !requestToken.scope) return null;
    if (!canEditProfilePersonalData) {
      setProfilePersonalData(null);
      setProfilePersonalDataLoading(false);
      setProfilePersonalDataError("");
      setProfileAvatar(createEmptyProfileAvatarState());
      setProfileAvatarResetKey((current) => current + 1);
      setProfileAvatarLoading(false);
      setProfileAvatarError("");
      return null;
    }

    setProfilePersonalDataLoading(true);
    setProfilePersonalDataError("");
    setProfileAvatarLoading(true);
    setProfileAvatarError("");
    try {
      const profile = await getProfilePersonalData();
      if (!isSessionDataRequestCurrent(requestToken)) return null;
      setProfilePersonalData(profile);
      setSessionName(profile.displayName);
      await refreshProfileAvatar({ force: true, avatarPath: profile.avatarPath });
      if (!isSessionDataRequestCurrent(requestToken)) return null;
      return profile;
    } catch (error) {
      if (!isSessionDataRequestCurrent(requestToken)) return null;
      const message = error instanceof Error ? error.message : "No pudimos cargar tu perfil.";
      setProfilePersonalDataError(message);
      return null;
    } finally {
      if (isSessionDataRequestCurrent(requestToken)) {
        setProfilePersonalDataLoading(false);
        setProfileAvatarLoading(false);
      }
    }
  }

  async function handleSaveProfilePersonalData(input: ProfilePersonalDataInput) {
    const operationOwner = tryAcquireUserScopedOperation(profileSaveInFlightRef);
    if (!operationOwner || operationOwner.dataMode !== "supabase" || !operationOwner.userId) return null;

    try {
      const result = await settleUserScopedOperation(
        profileSaveInFlightRef,
        operationOwner,
        updateProfilePersonalData(input, operationOwner.userId),
      );
      if (result.kind === "stale") return null;
      if (result.kind === "error") throw result.error;
      setProfilePersonalData(result.value);
      setSessionName(result.value.displayName);
      return result.value;
    } finally {
      finalizeUserScopedOperation(profileSaveInFlightRef, operationOwner);
    }
  }

  async function handleUploadProfileAvatar(file: File) {
    const operationOwner = tryAcquireUserScopedOperation(profileAvatarUploadInFlightRef);
    if (!operationOwner || operationOwner.dataMode !== "supabase" || !operationOwner.userId) return false;

    setProfileAvatarError("");
    try {
      const result = await settleUserScopedOperation(
        profileAvatarUploadInFlightRef,
        operationOwner,
        uploadProfileAvatar(file, operationOwner.userId),
      );
      if (result.kind === "stale") return false;
      if (result.kind === "error") throw result.error;
      const avatar = result.value;
      lastProfileAvatarRefreshAtRef.current = Date.now();
      setProfileAvatar(avatar);
      setProfileAvatarResetKey((current) => current + 1);
      setProfilePersonalData((current) => mergeProfileAvatarMetadata(current, avatar));
      return true;
    } finally {
      finalizeUserScopedOperation(profileAvatarUploadInFlightRef, operationOwner);
    }
  }

  async function refreshTrainingCyclesBoundary() {
    return applyTrainingDataRefreshResult(
      await trainingDataController.refreshCycles(),
    );
  }

  async function reloadCycleScopedBoundary(cycleId: string) {
    return applyTrainingDataRefreshResult(
      await trainingDataController.reloadCycleSnapshot(cycleId),
    );
  }

  async function createCycleScopedTrainingCycleFromSetup(
    plan: TrainingPlan,
    setupState: Record<string, SetupDayState>,
    activeCycle: PersistedTrainingCycle | null,
    operationOwner: SessionOperationOwner,
  ) {
    if (activeCycle && isProtectedTrainingCycle(activeCycle)) {
      setStatusMessage(PROTECTED_ACTIVE_CYCLE_MESSAGE);
      return false;
    }

    const planInput = createCycleScopedPlanInput(plan, setupState, trainingCyclesSnapshotSource);
    if (!planInput) {
      setTrainingPlan(plan);
      dispatchRoutineBuilder({
        type: "replace_state",
        state: { activeDay: setupDay, setupByDay: setupState },
      });
      setIsEditingRoutinePlan(true);
      applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
      setStatusMessage("Configura al menos una rutina, un dia y un ejercicio antes de crear el ciclo.");
      return false;
    }

    const plannedStartDate = getSantiagoDateKey(new Date());
    const durationWeeks = getCycleDurationWeeks(plan);
    const plannedEndDate = addDaysToDateKey(plannedStartDate, durationWeeks * 7 - 1);
    const activeCycleToClose = activeCycle?.status === "active" ? activeCycle : null;
    const nextCycleNumber = await getNextTrainingCycleNumber();
    if (!isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) return false;
    const endedAt = new Date().toISOString();

    if (activeCycleToClose) {
      await completeTrainingCycle({
        endedAt,
        summarySnapshot: createPersistedCycleSummarySnapshot(
          trainingPlan,
          displayExercises,
          displayEntries,
          activeCycleToClose.startedAt,
          endedAt,
          trainingCyclesSnapshotSource,
        ),
      }, operationOwner.userId ?? undefined);
      if (!isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) return false;
    }

    await createTrainingCycleWithPlan({
      name: `Ciclo ${nextCycleNumber}`,
      cycleNumber: nextCycleNumber,
      cycleType: plan.cycleType,
      goal: getCycleObjectiveValue(plan),
      durationWeeks,
      plannedStartDate,
      plannedEndDate,
      plan: planInput,
    }, operationOwner.userId ?? undefined);
    if (!isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) return false;

    setTrainingPlan(plan);
    const refreshResult = await refreshTrainingCyclesBoundary();
    if (refreshResult.kind !== "success") return false;
    if (!isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) return false;
    const refreshedView = selectTrainingDataView(refreshResult.state, plan);
    setActiveRoutineDay(getVisibleTrainingDay(refreshedView.exercises, "Lunes"));
    setDashboardDayOverride("");
    activeWorkoutActions.replaceExerciseDrafts({});
    activeWorkoutActions.clearReadiness();
    activeWorkoutActions.markTrainingStopped();
    return true;
  }

  useEffect(() => {
    if (!isTrainingCyclesRepositoryActive) return;
    void refreshTrainingCyclesBoundary();
    // The refresh is keyed to repository activation and authenticated user.
    // Including the local async function would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTrainingCyclesRepositoryActive, supabaseUser?.id]);

  function handlePersistenceError(
    error: unknown,
    options: { preserveSession?: boolean } = {},
  ) {
    const message = translatePersistenceError(error);
    setStatusMessage(message);
    if (
      !options.preserveSession &&
      dataMode === "supabase" &&
      (isSessionExpiredError(error) || message.includes("iniciar sesión"))
    ) {
      clearUserSessionState(message);
    }
    return message;
  }

  async function handleAuth(mode: "login" | "registro", formData: FormData) {
    const name = String(formData.get("register-name") || "").trim();
    const rawEmail = String(formData.get(mode === "registro" ? "register-email" : "login-email") || "");
    const email = rawEmail.trim().toLowerCase();
    const password = String(formData.get(mode === "registro" ? "register-password" : "login-password") || "");
    const confirm = String(formData.get("register-confirm-password") || "");
    const supabase = getSupabaseBrowserClient();
    let appliedIdentityToken: SessionDataRequestToken | null = null;
    if (mode === "registro" && !name) {
      setStatusMessage("Ingresa tu nombre.");
      return;
    }

    const signupEmailValidation = mode === "registro" ? validateSignupEmail(rawEmail) : null;

    if (!email) {
      setStatusMessage("Ingresa tu correo electr\u00f3nico.");
      return;
    }

    if (signupEmailValidation) {
      setStatusMessage(signupEmailValidation);
      return;
    }

    if (mode === "login" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatusMessage("Ingresa un correo electr\u00f3nico v\u00e1lido.");
      return;
    }

    if (!password) {
      setStatusMessage(mode === "registro" ? "Crea una contrase\u00f1a." : "Ingresa tu contrase\u00f1a.");
      return;
    }

    if (mode === "registro" && password.length < 8) {
      setStatusMessage("La contrase\u00f1a debe tener al menos 8 caracteres.");
      return;
    }

    if (mode === "registro" && (!/[a-zA-Z]/.test(password) || !/\d/.test(password))) {
      setStatusMessage("La contrase\u00f1a debe incluir letras y n\u00fameros.");
      return;
    }

    if (mode === "registro" && !confirm) {
      setStatusMessage("Confirma tu contrase\u00f1a.");
      return;
    }

    if (mode === "registro" && password !== confirm) {
      setStatusMessage("Las contraseñas no coinciden.");
      return;
    }

    if (!supabase) {
      setSessionName(name || email.split("@")[0] || "Usuario");
      applySessionState({
        isConfigured: false,
        dataMode: "demo",
        session: null,
        user: null,
      });
      appliedIdentityToken = captureSessionDataRequestToken();
      setStatusMessage(getMissingSupabaseMessage());
      const refreshResult = await refreshTrainingDataForSession("demo");
      if (refreshResult.kind !== "success") return;
      if (!isSessionDataRequestCurrent(appliedIdentityToken)) return;
      setStatusMessage(getMissingSupabaseMessage());
      clearAuthForms();
      applyScreenTransition(createAuthNavigationReset("dashboard", "session-established"));
      return;
    }

    setIsBusy(true);
    try {
      const result =
        mode === "registro"
          ? await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } })
          : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setStatusMessage(translateAuthError(result.error));
        return;
      }

      const existingRegisteredUser =
        mode === "registro" && Array.isArray(result.data.user?.identities) && result.data.user.identities.length === 0;
      if (existingRegisteredUser) {
        setStatusMessage("Este correo ya está registrado. Intenta iniciar sesión.");
        return;
      }

      const session = result.data.session;
      applySessionState({
        isConfigured: true,
        dataMode: session ? "supabase" : "demo",
        session,
        user: session?.user ?? null,
      });
      appliedIdentityToken = captureSessionDataRequestToken();

      if (!session && mode === "registro") {
        setStatusMessage("Cuenta creada. Revisa tu correo para confirmar el registro.");
        clearAuthForms();
        applyScreenTransition(createAuthNavigationReset("login", "signup-confirmation-pending"));
        return;
      }

      setStatusMessage("");
      const refreshResult = await refreshTrainingDataForSession("supabase");
      if (!shouldContinueAuthenticatedFlowAfterRefresh(refreshResult.kind)) return;
      if (!isSessionDataRequestCurrent(appliedIdentityToken)) return;
      clearAuthForms();
      applyScreenTransition(createAuthNavigationReset("dashboard", "session-established"));
    } catch (error) {
      if (appliedIdentityToken && !isSessionDataRequestCurrent(appliedIdentityToken)) return;
      setStatusMessage(translateAuthError(error));
    } finally {
      if (!appliedIdentityToken || isSessionDataRequestCurrent(appliedIdentityToken)) {
        setIsBusy(false);
      }
    }
  }

  async function handlePasswordRecovery(formData: FormData) {
    const rawEmail = String(formData.get("recovery-email") || "");
    const email = rawEmail.trim().toLowerCase();
    const emailValidation = validateSignupEmail(rawEmail);
    const supabase = getSupabaseBrowserClient();

    if (!email) {
      setStatusMessage("Ingresa tu correo electr\u00f3nico.");
      return;
    }

    if (emailValidation) {
      setStatusMessage(emailValidation);
      return;
    }

    if (!supabase) {
      setStatusMessage("No pudimos completar la acci\u00f3n. Intenta nuevamente.");
      return;
    }

    setIsBusy(true);
    try {
      const redirectTo = getPasswordRecoveryRedirectUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        setStatusMessage(translateAuthError(error));
        return;
      }
      setRecoveryEmail("");
      setStatusMessage("Si el correo est\u00e1 registrado, enviaremos un enlace para restablecer tu contrase\u00f1a.");
    } catch (error) {
      setStatusMessage(translateAuthError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdatePassword(formData: FormData) {
    const password = String(formData.get("new-password") || "");
    const confirm = String(formData.get("new-password-confirm") || "");
    const supabase = getSupabaseBrowserClient();

    if (!password) {
      setStatusMessage("Crea una contrase\u00f1a.");
      return;
    }

    if (password.length < 8) {
      setStatusMessage("La contrase\u00f1a debe tener al menos 8 caracteres.");
      return;
    }

    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setStatusMessage("La contrase\u00f1a debe incluir letras y n\u00fameros.");
      return;
    }

    if (!confirm) {
      setStatusMessage("Confirma tu contrase\u00f1a.");
      return;
    }

    if (password !== confirm) {
      setStatusMessage("Las contrase\u00f1as no coinciden.");
      return;
    }

    if (!supabase) {
      setStatusMessage("No pudimos completar la acci\u00f3n. Intenta nuevamente.");
      return;
    }

    const confirmedUserId = passwordRecoveryUserIdRef.current;
    if (
      !confirmedUserId ||
      !isPasswordRecoveryConfirmed ||
      passwordRecoveryStateRef.current !== "confirmed"
    ) {
      invalidatePasswordRecoverySession();
      return;
    }

    const operationOwner = tryAcquireActiveWorkoutOperation(passwordRecoveryUpdateOwnerRef);
    if (!operationOwner) return;
    const recoveryStorageScope = activeBrowserStorageScopeRef.current;
    setIsBusy(true);
    try {
      const result = await executePasswordRecoveryUpdate({
        password,
        confirmedUserId,
        auth: {
          getSession: () => supabase.auth.getSession(),
          updateUser: (attributes) => supabase.auth.updateUser(attributes),
          signOut: async () => {
            const { error: signOutError } = await supabase.auth.signOut();
            if (signOutError) return { error: signOutError };
            return { error: null };
          },
        },
        isRecoveryCurrent: (userId) => (
          passwordRecoveryStateRef.current === "confirmed"
          && normalizePasswordRecoveryUserId(passwordRecoveryUserIdRef.current) === userId
        ),
        isOperationCurrent: () => isActiveWorkoutOperationCurrent(
          passwordRecoveryUpdateOwnerRef,
          operationOwner,
        ),
        isTerminalOperationCurrent: () => (
          sessionDataMountedRef.current
          && isSessionOperationOwner(passwordRecoveryUpdateOwnerRef.current, operationOwner)
        ),
        onPasswordUpdated: () => {
          passwordUpdateSuccessRef.current = true;
        },
      });

      if (result.kind === "stale") {
        passwordUpdateSuccessRef.current = false;
        return;
      }
      if (result.kind === "invalid-recovery") {
        invalidatePasswordRecoverySession();
        return;
      }
      if (result.kind === "update-error" || result.kind === "sign-out-error") {
        passwordUpdateSuccessRef.current = false;
        setStatusMessage(translateAuthError(result.error));
        return;
      }

      completePasswordRecoveryUpdate(recoveryStorageScope);
    } catch (error) {
      passwordUpdateSuccessRef.current = false;
      if (
        !isActiveWorkoutOperationCurrent(passwordRecoveryUpdateOwnerRef, operationOwner)
      ) return;
      setStatusMessage(translateAuthError(error));
    } finally {
      const operationStillAuthorized = isActiveWorkoutOperationCurrent(
        passwordRecoveryUpdateOwnerRef,
        operationOwner,
      );
      const hasTerminalOwnership = sessionDataMountedRef.current
        && isSessionOperationOwner(passwordRecoveryUpdateOwnerRef.current, operationOwner);
      const canFinalize = operationStillAuthorized
        ? finalizeActiveWorkoutOperation(passwordRecoveryUpdateOwnerRef, operationOwner)
        : hasTerminalOwnership;
      if (!operationStillAuthorized && hasTerminalOwnership) {
        passwordRecoveryUpdateOwnerRef.current = releaseSessionOperationOwner(
          passwordRecoveryUpdateOwnerRef.current,
          operationOwner,
        );
      }
      if (canFinalize) setIsBusy(false);
    }
  }

  function prepareRoutineBuilderStateFromExercises(
    sourceExercises: ExerciseTemplate[],
    requestedDay: string,
  ) {
    const mapping = createSetupByDayFromExercises({
      placements: sourceExercises.map((exercise) => ({
        exercise,
        visualRowId: exercise.id,
      })),
      initialSetupByDay: createSetupByDay(),
      unknownDayPolicy: "fallback_to_monday",
      existingRowsPolicy: "append",
    });
    if (mapping.kind === "blocked") {
      setStatusMessage("No se pudo preparar la rutina para editar. Intenta nuevamente.");
      return false;
    }

    const visibleDay = getVisibleTrainingDay(sourceExercises, requestedDay);
    const activeDay = TRAINING_DAY_LABELS.some((day) => day === visibleDay)
      ? visibleDay
      : "Lunes";
    dispatchRoutineBuilder({
      type: "replace_state",
      state: { activeDay, setupByDay: mapping.setupByDay },
    });
    return true;
  }

  function navigateTo(nextScreen: Screen) {
    const decision = resolveContextualNavigation({
      current: { screen, history: screenHistory },
      nextScreen,
      hasRoutinePlan,
    });

    if (decision.kind === "same-screen") {
      if (decision.closeMenu) setIsMenuOpen(false);
      return;
    }

    if (
      decision.prepareRoutineEditor &&
      !prepareRoutineBuilderStateFromExercises(exercises, activeRoutineDay)
    ) {
      return;
    }

    if (decision.clearTrainingCompletionSummary) {
      activeWorkoutActions.clearTrainingCompletionSummary();
    }

    if (!decision.prepareRoutineEditor && decision.tryRestoreActiveWorkout) {
      if (restoreActiveWorkoutForNavigation()) return;
      if (decision.resetTrainingStart) {
        activeWorkoutActions.clearTrainingStart();
      }
    }
    if (decision.routineEditorEditingState !== null) {
      setIsEditingRoutinePlan(decision.routineEditorEditingState);
    }
    applyContextualNavigation(decision.navigation);
    if (decision.closeMenu) setIsMenuOpen(false);
  }

  function goBack() {
    const decision = resolveContextualBackNavigation({
      current: { screen, history: screenHistory },
      hasStartedTraining,
      hasReadiness: Boolean(readiness),
      isEditingRoutinePlan,
      hasRoutinePlan,
      routineEditorReturnScreen,
    });

    if (decision.stopTraining) {
      activeWorkoutActions.markTrainingStopped();
    }
    if (decision.clearReadiness) {
      activeWorkoutActions.clearReadiness();
    }
    if (decision.closeRoutineEditor) {
      setIsEditingRoutinePlan(false);
    }
    if (decision.clearRoutineEditorReturnScreen) {
      setRoutineEditorReturnScreen(null);
    }
    if (decision.navigationChanged) {
      applyContextualNavigation(decision.navigation);
    }
    if (decision.closeMenu) setIsMenuOpen(false);
  }

  function updateSetupRow(id: string, field: keyof Omit<SetupExerciseRow, "id" | "sourceExerciseId" | "exerciseLineageId">, value: string) {
    const currentRow = setupByDay[setupDay]?.rows.find((row) => row.id === id);
    if (!currentRow) return;

    if (field === "name") {
      dispatchRoutineBuilder({ type: "update_row_field", rowId: id, update: { field, value } });
      return;
    }
    if (field === "weight") {
      dispatchRoutineBuilder({
        type: "update_row_field",
        rowId: id,
        update: { field, value: readWeightInput(value, currentRow.weight) },
      });
      return;
    }

    dispatchRoutineBuilder({
      type: "update_row_field",
      rowId: id,
      update: { field, value: readSetupNumber(value) },
    });
  }

  function updateTrainingPlan(edit: TrainingPlanEdit) {
    setTrainingPlan((current) => {
      const result = applyTrainingPlanEdit({ plan: current, activeDay: setupDay }, edit);
      if (result.kind !== "updated") return current;
      if (result.state.activeDay !== setupDay) {
        dispatchRoutineBuilder({ type: "select_day", day: result.state.activeDay });
      }
      return result.state.plan;
    });
  }

  function updateSetupRoutineName(value: string) {
    dispatchRoutineBuilder({ type: "set_routine_name", routineName: value });
  }

  function addSetupRow() {
    dispatchRoutineBuilder({ type: "add_row", row: createRoutineBuilderRow(createId()) });
  }

  function removeSetupRow(id: string) {
    const row = setupByDay[setupDay]?.rows.find((item) => item.id === id);
    const isCycleScopedEdit = Boolean(
      isTrainingCyclesRepositoryActive &&
      persistedActiveCycle &&
      isCycleScopedTrainingCycle(persistedActiveCycle),
    );
    if (
      isCycleScopedEdit &&
      row?.sourceExerciseId
    ) {
      const hasRegisteredEntry = displayEntries.some((entry) =>
        (entry.trainingCycleExerciseId ?? entry.exerciseId) === row.sourceExerciseId);
      const confirmed = window.confirm(hasRegisteredEntry
        ? "¿Eliminar este ejercicio de la planificacion? El historial anterior se conservara."
        : "¿Eliminar este ejercicio de la planificacion?");
      if (!confirmed) return;
    }

    dispatchRoutineBuilder({
      type: "remove_row",
      rowId: id,
      allowEmptyRows: isCycleScopedEdit,
    });
  }

  function openRoutineEditor(day = visibleDay) {
    if (!prepareRoutineBuilderStateFromExercises(displayExercises, day)) return;
    setIsEditingRoutinePlan(true);
    setRoutineEditorReturnScreen(screen);
    if (screen === "entrenamiento") {
      activeWorkoutActions.clearTrainingStart();
    }
    setIsMenuOpen(false);
    applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "routine-editor-opened"));
  }

  function cancelRoutineUpdate() {
    const activeDays = getRoutineDays(exercises);
    const nextDay = activeDays.includes(activeRoutineDay) ? activeRoutineDay : activeDays[0] ?? "Lunes";
    if (!prepareRoutineBuilderStateFromExercises(exercises, nextDay)) return;
    clearRoutineDraft(dataMode, supabaseUser?.id);
    setTrainingPlan((current) => ({ ...current, trainingDays: activeDays }));
    setIsRoutineUpdateConfirmOpen(false);
    setStatusMessage("No se realizaron cambios en la rutina.");
  }

  async function saveInitialRoutine(confirmation: RoutineBuilderSaveConfirmation) {
    const dayState = setupByDay[setupDay] ?? createSetupDayState();
    const routineName = dayState.routineName.trim() || setupDay;
    const plannedDays = sortTrainingDaysByWeekOrder(
      trainingPlan.trainingDays.length > 0 ? trainingPlan.trainingDays : [setupDay],
    );
    const currentRoutineDays = getRoutineDays(
      isTrainingCyclesRepositoryActive ? displayExercises : exercises,
    );
    const isChangingRoutineDays = hasRoutinePlan && isEditingRoutinePlan && !sameDayList(plannedDays, currentRoutineDays);
    const isCycleScopedRoutineEdit = Boolean(
      isTrainingCyclesRepositoryActive &&
      isEditingRoutinePlan &&
      persistedActiveCycle &&
      isCycleScopedTrainingCycle(persistedActiveCycle),
    );
    const savePreparation = resolveRoutineBuilderSavePreparation({
      rows: dayState.rows,
      persistenceMode: isTrainingCyclesRepositoryActive ? "cycle_scoped" : "legacy",
      allowEmptyRows: isCycleScopedRoutineEdit,
      requiresRoutineUpdateConfirmation:
        isChangingRoutineDays && !isTrainingCyclesRepositoryActive,
      confirmation,
    });
    if (savePreparation.kind === "invalid_weight") {
      setStatusMessage(`Completa el peso de "${savePreparation.exerciseName}" con un decimal valido.`);
      return;
    }
    if (savePreparation.kind === "no_exercises") {
      setStatusMessage("Agrega al menos un ejercicio para crear la rutina.");
      return;
    }
    if (savePreparation.kind === "confirmation_required") {
      setIsRoutineUpdateConfirmOpen(true);
      return;
    }

    const validRows = savePreparation.rows;
    const savedDayState = {
      routineName,
      rows: validRows.map((row) => ({
        ...row,
        sourceExerciseId: isTrainingCyclesRepositoryActive
          ? row.sourceExerciseId
          : row.sourceExerciseId ?? row.id,
      })),
    };
    const nextSetupByDay = {
      ...setupByDay,
      [setupDay]: savedDayState,
    };
    const completedDays = getConfiguredSetupDays(nextSetupByDay);
    const activeDayAccepted = validRows.length > 0 || isCycleScopedRoutineEdit;
    const configuredDaysForTransition = activeDayAccepted && !completedDays.includes(setupDay)
      ? [...completedDays, setupDay]
      : completedDays;
    const setupTransition = resolveTrainingPlanSetupTransition({
      plan: { ...trainingPlan, trainingDays: plannedDays },
      activeDay: setupDay,
      configuredDays: configuredDaysForTransition,
      activeDayAccepted,
      requiresRoutineUpdateConfirmation: isChangingRoutineDays && !isTrainingCyclesRepositoryActive,
      routineUpdateConfirmed: confirmation === "confirmed_routine_update",
    });
    const nextIncompleteDay = setupTransition.kind === "continue_setup"
      ? setupTransition.nextDay
      : null;
    const daysToPersist = plannedDays.filter((day) => nextSetupByDay[day]?.rows.some((row) => row.name.trim()));

    if (setupTransition.kind === "blocked") {
      if (setupTransition.reason === "active_day_not_ready") {
        setStatusMessage("Agrega al menos un ejercicio para crear la rutina.");
      }
      return;
    }

    if (setupTransition.kind === "confirm_update") {
      setIsRoutineUpdateConfirmOpen(true);
      return;
    }

    const operationOwner = tryAcquireUserScopedOperation(routineSaveInFlightRef);
    if (!operationOwner) return;

    if (isTrainingCyclesRepositoryActive) {
      setIsRoutineUpdateConfirmOpen(false);
      dispatchRoutineBuilder({
        type: "replace_state",
        state: { activeDay: setupDay, setupByDay: nextSetupByDay },
      });

      if (setupTransition.kind === "continue_setup") {
        const successMessage = `Rutina de ${setupDay} preparada.`;
        setStatusMessage(`${successMessage} Ahora configura ${setupTransition.nextDay}.`);
        setRoutineNotice(successMessage);
        setIsEditingRoutinePlan(true);
        dispatchRoutineBuilder({ type: "select_day", day: setupTransition.nextDay });
        applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "routine-setup-continued"));
        return;
      }

      setIsBusy(true);
      try {
        const cycleRefreshResult = await refreshTrainingCyclesBoundary();
        if (!isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) return;
        if (cycleRefreshResult.kind === "stale") return;
        if (cycleRefreshResult.kind === "error") throw cycleRefreshResult.error;
        const activeCycle = selectTrainingDataView(
          cycleRefreshResult.state,
          trainingPlan,
        ).activeCycle;
        if (activeCycle && isCycleScopedTrainingCycle(activeCycle)) {
          if (!cycleScopedPlan || activeCycle.id !== persistedActiveCycle?.id) {
            setStatusMessage("No se pudo cargar el plan cycle-scoped activo. No se guardaron cambios.");
            return;
          }

          const registeredExerciseIds = new Set(
            displayEntries
              .map((entry) => entry.trainingCycleExerciseId ?? entry.exerciseId)
              .filter(Boolean),
          );
          const existingDayRecords = cycleScopedPlan.routines.flatMap((routine) =>
            routine.days
              .filter((cycleDay) => cycleDay.weekIndex === 1)
              .map((cycleDay) => ({ routine, cycleDay })),
          );
          const existingDayCodes = existingDayRecords.map(({ cycleDay }) => cycleDay.dayCode);
          const requestedDayCodes = plannedDays.map(getTrainingDayCode);
          const newDayCodes = new Set(
            getCycleScopedDayCodesToAdd(existingDayCodes, requestedDayCodes),
          );
          const removedExistingDay = existingDayRecords.find(({ cycleDay }) =>
            !requestedDayCodes.includes(cycleDay.dayCode),
          );
          if (removedExistingDay) {
            setStatusMessage("La edicion del ciclo activo no elimina dias existentes.");
            return;
          }

          const fallbackRoutine = cycleScopedPlan.routines[0];
          if (!fallbackRoutine) {
            setStatusMessage("El ciclo activo no tiene una rutina base valida para agregar dias.");
            return;
          }

          const days: Parameters<typeof addCycleScopedTrainingDaysAndExercises>[0]["days"] = [];
          for (const day of plannedDays) {
            const dayCode = getTrainingDayCode(day);
            const existingRecord = existingDayRecords.find(({ cycleDay }) => cycleDay.dayCode === dayCode);
            const state = nextSetupByDay[day] ?? createSetupDayState();
            const routineName = state.routineName.trim() || day;
            const existingExercises = existingRecord?.cycleDay.exercises ?? [];

            if (
              existingRecord &&
              normalizeCycleScopedExerciseName(routineName) !==
                normalizeCycleScopedExerciseName(
                  getCycleScopedDayRoutineName(existingRecord.cycleDay.notes, existingRecord.routine.name),
                )
            ) {
              setStatusMessage("En esta fase no se puede modificar el nombre de una rutina cycle-scoped existente.");
              return;
            }

            const analysis = analyzeCycleScopedDayEdit(
              existingExercises,
              state.rows.map((row) => ({ ...row, weight: readRequiredWeight(row.weight) })),
              registeredExerciseIds,
            );

            if (analysis.unknownExerciseIds.length > 0) {
              setStatusMessage("Uno de los ejercicios editados ya no pertenece al plan activo.");
              return;
            }
            if (analysis.duplicateNames.length > 0) {
              setStatusMessage(`El ejercicio "${analysis.duplicateNames[0]}" ya existe en ${day}.`);
              return;
            }

            const isNewDay = newDayCodes.has(dayCode);
            if (isNewDay && analysis.additions.length === 0) {
              setStatusMessage(`Agrega al menos un ejercicio para crear ${day} en el ciclo activo.`);
              return;
            }
            const hasChanges = (
              analysis.additions.length > 0 ||
              analysis.updates.length > 0 ||
              analysis.replacements.length > 0 ||
              analysis.pendingDeletes.length > 0 ||
              analysis.registeredRetirements.length > 0
            );
            if (!isNewDay && !hasChanges) continue;

            const nextSortOrder = Math.max(
              -1,
              ...existingExercises.map((exercise) => exercise.sortOrder),
            ) + 1;
            days.push({
              existingDayId: existingRecord?.cycleDay.id,
              routineId: existingRecord?.routine.id ?? fallbackRoutine.id,
              weekIndex: existingRecord?.cycleDay.weekIndex ?? 1,
              dayCode,
              sortOrder: TRAINING_DAY_LABELS.findIndex((label) => label === day),
              notes: existingRecord?.cycleDay.notes ?? createCycleScopedDayNotes(routineName),
              exercises: analysis.additions.map((exercise, index) => ({
                name: exercise.name,
                targetSets: exercise.targetSets,
                targetReps: exercise.targetReps,
                baseWeight: exercise.baseWeight,
                sideWeight: null,
                sortOrder: nextSortOrder + index,
                notes: `Ejercicio agregado al plan activo para ${day}.`,
              })),
              updates: analysis.updates.map((exercise) => ({
                exerciseId: exercise.exerciseId,
                name: exercise.name,
                targetSets: exercise.targetSets,
                targetReps: exercise.targetReps,
                baseWeight: exercise.baseWeight,
                sideWeight: null,
                sortOrder: exercise.sortOrder,
                notes: exercise.notes ?? `Ejercicio actualizado para ${day}.`,
              })),
              replacements: analysis.replacements.map((exercise) => ({
                previousExerciseId: exercise.previousExerciseId,
                exerciseLineageId: existingExercises.find((item) => item.id === exercise.previousExerciseId)?.exerciseLineageId ?? null,
                name: exercise.name,
                targetSets: exercise.targetSets,
                targetReps: exercise.targetReps,
                baseWeight: exercise.baseWeight,
                sideWeight: null,
                sortOrder: exercise.sortOrder,
                notes: `Planificacion futura para ${day}; historial anterior conservado.`,
              })),
              pendingDeleteExerciseIds: analysis.pendingDeletes,
              registeredRetireExerciseIds: analysis.registeredRetirements,
            });
          }

          if (days.length === 0) {
            setStatusMessage("No hay cambios para guardar en el ciclo activo.");
            return;
          }

          const saveResult = await settleUserScopedOperation(
            routineSaveInFlightRef,
            operationOwner,
            addCycleScopedTrainingDaysAndExercises({
              cycleId: activeCycle.id,
              days,
            }, operationOwner.userId ?? undefined),
          );
          if (saveResult.kind === "stale") return;
          if (saveResult.kind === "error") throw saveResult.error;
          const loadResult = await reloadCycleScopedBoundary(activeCycle.id);
          if (!isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) return;
          if (loadResult.kind === "stale") return;
          if (loadResult.kind === "error") throw loadResult.error;
          clearRoutineDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
          setIsEditingRoutinePlan(false);
          setActiveRoutineDay(setupDay);
          setRoutineNotice(
            `${saveResult.value.daysAdded} dia${saveResult.value.daysAdded === 1 ? "" : "s"}, ${saveResult.value.exercisesAdded} ejercicio${saveResult.value.exercisesAdded === 1 ? "" : "s"} nuevo${saveResult.value.exercisesAdded === 1 ? "" : "s"}, ${saveResult.value.exercisesUpdated} editado${saveResult.value.exercisesUpdated === 1 ? "" : "s"} y ${saveResult.value.exercisesRetired} retirado${saveResult.value.exercisesRetired === 1 ? "" : "s"}.`,
          );
          setStatusMessage("Plan cycle-scoped actualizado. El historial anterior se conserva.");
          setIsRoutineSuccessOpen(true);
          applyScreenTransition(createFlowScreenTransition("entrenamiento", "routine-plan-saved"));
          return;
        }

        const createdResult = await settleUserScopedOperation(
          routineSaveInFlightRef,
          operationOwner,
          createCycleScopedTrainingCycleFromSetup(
            trainingPlan,
            nextSetupByDay,
            activeCycle,
            operationOwner,
          ),
        );
        if (createdResult.kind === "stale") return;
        if (createdResult.kind === "error") throw createdResult.error;
        if (!createdResult.value) return;

        clearRoutineDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
        setIsEditingRoutinePlan(false);
        setActiveRoutineDay(setupDay);
        setRoutineNotice("Plan cycle-scoped creado correctamente.");
        setStatusMessage("Ciclo y plan operativo creados correctamente en QA.");
        setIsRoutineSuccessOpen(true);
        applyScreenTransition(createFlowScreenTransition("entrenamiento", "routine-plan-saved"));
      } catch (error) {
        if (isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) {
          setStatusMessage(translateTrainingCycleRepositoryError(error));
        }
      } finally {
        if (finalizeUserScopedOperation(routineSaveInFlightRef, operationOwner)) {
          setIsBusy(false);
        }
      }
      return;
    }

    setIsRoutineUpdateConfirmOpen(false);
    dispatchRoutineBuilder({
      type: "replace_state",
      state: { activeDay: setupDay, setupByDay: nextSetupByDay },
    });
    setIsBusy(true);
    try {
      for (const dayToPersist of daysToPersist) {
        const state = nextSetupByDay[dayToPersist] ?? createSetupDayState();
        const currentRoutineName = state.routineName.trim() || dayToPersist;
        const rowsToPersist = dedupeExerciseRowsByName(state.rows.filter((row) => row.name.trim()));
        const persistedIds = new Set(
          rowsToPersist
            .map((row) => row.sourceExerciseId)
            .filter((id): id is string => Boolean(id)),
        );
        const removedExerciseIds = getRemovedExerciseIds(exercises, dayToPersist, persistedIds);

        for (const exerciseId of removedExerciseIds) {
          const deleteResult = await settleUserScopedOperation(
            routineSaveInFlightRef,
            operationOwner,
            deleteExercise(
              exerciseId,
              operationOwner.dataMode,
              operationOwner.userId ?? undefined,
            ),
          );
          if (deleteResult.kind === "stale") return;
          if (deleteResult.kind === "error") throw deleteResult.error;
        }

        for (const row of rowsToPersist) {
          const saveResult = await settleUserScopedOperation(
            routineSaveInFlightRef,
            operationOwner,
            saveExercise({
              id: row.sourceExerciseId ?? row.id,
              routine: currentRoutineName,
              day: dayToPersist,
              name: row.name.trim(),
              targetSets: Math.max(1, row.sets || 1),
              targetReps: Math.max(1, row.reps || 1),
              baseWeight: readRequiredWeight(row.weight),
              notes: `Rutina creada para ${dayToPersist}.`,
            }, operationOwner.dataMode, operationOwner.userId ?? undefined),
          );
          if (saveResult.kind === "stale") return;
          if (saveResult.kind === "error") throw saveResult.error;
        }
      }

      const refreshedData = await refreshTrainingDataForSession(operationOwner.dataMode);
      if (refreshedData.kind !== "success") return;
      if (!isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) return;
      setActiveRoutineDay(setupDay);
      const successMessage = `Rutina de ${setupDay} guardada.`;
      setStatusMessage(nextIncompleteDay ? `${successMessage} Ahora configura ${nextIncompleteDay}.` : "Registro de rutina finalizado.");
      setRoutineNotice(successMessage);
      if (setupTransition.kind === "continue_setup") {
        setIsEditingRoutinePlan(true);
        dispatchRoutineBuilder({ type: "select_day", day: setupTransition.nextDay });
        applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "routine-setup-continued"));
      } else {
        clearRoutineDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
        setIsEditingRoutinePlan(false);
        setActiveRoutineDay(setupDay);
        activeWorkoutActions.clearReadiness();
        setIsRoutineSuccessOpen(true);
      }
    } catch (error) {
      if (isUserScopedOperationCurrent(routineSaveInFlightRef, operationOwner)) {
        handlePersistenceError(error);
      }
    } finally {
      if (finalizeUserScopedOperation(routineSaveInFlightRef, operationOwner)) {
        setIsBusy(false);
      }
    }
  }

  async function handleLogout() {
    setIsBusy(true);
    const requestToken = captureSessionDataRequestToken();
    const currentStorageScope = activeBrowserStorageScopeRef.current;
    try {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
      if (isSessionDataRequestCurrent(requestToken)) {
        clearUserSessionState("Sesión cerrada correctamente.", currentStorageScope);
      }
    } catch (error) {
      if (isSessionDataRequestCurrent(requestToken)) setStatusMessage(translateAuthError(error));
    } finally {
      if (isSessionDataRequestCurrent(requestToken)) setIsBusy(false);
    }
  }

  function openRoutineDay(day: string, keepTrainingStarted = false) {
    if (!keepTrainingStarted && restoreActiveWorkoutForNavigation()) return;

    const nextDayExerciseCount = displayExercises.filter((exercise) =>
      (exercise.day ?? day) === day).length;
    setActiveRoutineDay(day);
    if (nextDayExerciseCount > 0) activeWorkoutActions.selectExercise(0, nextDayExerciseCount);
    setRoutineNotice("");
    if (!keepTrainingStarted) {
      activeWorkoutActions.clearTrainingStart();
    }
    applyScreenTransition(createFlowScreenTransition("entrenamiento", "routine-day-opened"));
  }

  async function startNewTrainingCycle() {
    if (dataMode === "supabase") {
      if (!isTrainingCyclesRepositoryActive) {
        setStatusMessage("Esta acción estará disponible en el siguiente paso.");
        setIsNewCycleConfirmOpen(false);
        return;
      }
    }

    const operationOwner = tryAcquireUserScopedOperation(trainingCycleCreateInFlightRef);
    if (!operationOwner) return;
    setIsBusy(true);
    try {
      if (operationOwner.dataMode === "supabase") {
        const cycleRefreshResult = await refreshTrainingCyclesBoundary();
        if (!isUserScopedOperationCurrent(trainingCycleCreateInFlightRef, operationOwner)) return;
        if (cycleRefreshResult.kind === "stale") return;
        if (cycleRefreshResult.kind === "error") throw cycleRefreshResult.error;
        const activeCycle = selectTrainingDataView(
          cycleRefreshResult.state,
          trainingPlan,
        ).activeCycle;

        const nextPlan = createNextTrainingPlan("controlled_cycle_scoped");
        const freshSetup = createSetupByDay();
        const activeCycleToClose = activeCycle?.status === "active" ? activeCycle : null;

        if (activeCycleToClose) {
          const endedAt = new Date().toISOString();
          const completionResult = await settleUserScopedOperation(
            trainingCycleCreateInFlightRef,
            operationOwner,
            completeTrainingCycle({
              endedAt,
              explicitlyConfirmed: true,
              summarySnapshot: createPersistedCycleSummarySnapshot(
                trainingPlan,
                displayExercises,
                displayEntries,
                activeCycleToClose.startedAt,
                endedAt,
                trainingCyclesSnapshotSource,
              ),
            }, operationOwner.userId ?? undefined),
          );
          if (completionResult.kind === "stale") return;
          if (completionResult.kind === "error") throw completionResult.error;
        }

        clearActiveFlow(operationOwner.dataMode, operationOwner.userId ?? undefined);
        clearRoutineDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
        clearWorkoutDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
        discardActiveWorkoutState();
        trainingDataController.clearForCycleSetup(operationOwner.requestToken);
        dispatchRoutineBuilder({ type: "reset_state", setupByDay: freshSetup, activeDay: "Lunes" });
        setTrainingPlan(nextPlan);
        {
          const dayReset = resolveDayStateReset();
          setActiveRoutineDay(dayReset.activeRoutineDay);
          setDashboardDayOverride(dayReset.dashboardDayOverride);
          dispatchProgressController({ type: "selection_reset" });
        }
        setIsEditingRoutinePlan(true);
        applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
        setStatusMessage(activeCycle
          ? "Ciclo actual finalizado. Configura el nuevo plan antes de crearlo."
          : "Configura el plan del nuevo ciclo antes de crearlo.");
        return;
      }

      if (!isUserScopedOperationCurrent(trainingCycleCreateInFlightRef, operationOwner)) return;
      const snapshot = createTrainingCycleSnapshot(cycleHistory.length + 1, trainingPlan, exercises, entries);
      clearRoutineDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
      const nextHistory = [...cycleHistory, snapshot];
      setCycleHistory(nextHistory);

      const nextPlan = createNextTrainingPlan("default");
      replaceLocalData([], []);
      trainingDataController.clearForCycleSetup(operationOwner.requestToken);
      dispatchRoutineBuilder({ type: "reset_state", setupByDay: createSetupByDay(), activeDay: "Lunes" });
      setTrainingPlan(nextPlan);
      {
        const dayReset = resolveDayStateReset();
        setActiveRoutineDay(dayReset.activeRoutineDay);
        setDashboardDayOverride(dayReset.dashboardDayOverride);
        dispatchProgressController({ type: "selection_reset" });
      }
      activeWorkoutActions.replaceExerciseDrafts({});
      activeWorkoutActions.clearReadiness();
      setIsEditingRoutinePlan(true);
      setStatusMessage("Ciclo actual finalizado. Ya puedes crear un nuevo ciclo de entrenamiento.");
      applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
    } catch (error) {
      if (isUserScopedOperationCurrent(trainingCycleCreateInFlightRef, operationOwner)) {
        setStatusMessage(translateTrainingCycleRepositoryError(error));
      }
    } finally {
      if (finalizeUserScopedOperation(trainingCycleCreateInFlightRef, operationOwner)) {
        setIsBusy(false);
        setIsNewCycleConfirmOpen(false);
      }
    }
  }

  async function deleteCurrentTrainingCycle() {
    const operationOwner = tryAcquireUserScopedOperation(trainingCycleDeleteInFlightRef);
    if (!operationOwner) return;
    setIsBusy(true);
    try {
      if (isTrainingCyclesRepositoryActive) {
        let activeCycle = persistedActiveCycle;
        if (!activeCycle) {
          const cycleRefreshResult = await refreshTrainingCyclesBoundary();
          if (!isUserScopedOperationCurrent(trainingCycleDeleteInFlightRef, operationOwner)) return;
          if (cycleRefreshResult.kind === "stale") return;
          if (cycleRefreshResult.kind === "error") throw cycleRefreshResult.error;
          activeCycle = selectTrainingDataView(
            cycleRefreshResult.state,
            trainingPlan,
          ).activeCycle;
        }
        if (!activeCycle) {
          setStatusMessage("No existe un ciclo activo para cancelar.");
          setIsDeleteCycleConfirmOpen(false);
          return;
        }
        if (isProtectedTrainingCycle(activeCycle)) {
          setStatusMessage(PROTECTED_ACTIVE_CYCLE_MESSAGE);
          setIsDeleteCycleConfirmOpen(false);
          return;
        }

        const endedAt = new Date().toISOString();
        const cancellationResult = await settleUserScopedOperation(
          trainingCycleDeleteInFlightRef,
          operationOwner,
          cancelTrainingCycle({
            endedAt,
            summarySnapshot: createPersistedCycleSummarySnapshot(
              trainingPlan,
              displayExercises,
              displayEntries,
              activeCycle.startedAt,
              endedAt,
              trainingCyclesSnapshotSource,
            ),
          }, operationOwner.userId ?? undefined),
        );
        if (cancellationResult.kind === "stale") return;
        if (cancellationResult.kind === "error") throw cancellationResult.error;

        const nextPlan = createNextTrainingPlan("default");
        clearRoutineDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
        clearWorkoutDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
        discardActiveWorkoutState();
        setTrainingPlan(nextPlan);
        dispatchRoutineBuilder({ type: "reset_state", setupByDay: createSetupByDay(), activeDay: "Lunes" });
        {
          const dayReset = resolveDayStateReset();
          setActiveRoutineDay(dayReset.activeRoutineDay);
          setDashboardDayOverride(dayReset.dashboardDayOverride);
          dispatchProgressController({ type: "selection_reset" });
        }
        setIsEditingRoutinePlan(true);
        setIsDeleteCycleConfirmOpen(false);
        setStatusMessage("Ciclo cancelado. Ya puedes configurar un nuevo ciclo de entrenamiento.");
        applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
        const refreshResult = await refreshTrainingCyclesBoundary();
        if (!isUserScopedOperationCurrent(trainingCycleDeleteInFlightRef, operationOwner)) return;
        if (refreshResult.kind === "error") throw refreshResult.error;
        return;
      }

      const deactivationResult = await settleUserScopedOperation(
        trainingCycleDeleteInFlightRef,
        operationOwner,
        deactivateActiveCycle(
          operationOwner.dataMode,
          operationOwner.userId ?? undefined,
        ),
      );
      if (deactivationResult.kind === "stale") return;
      if (deactivationResult.kind === "error") throw deactivationResult.error;
      clearRoutineDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
      clearWorkoutDraft(operationOwner.dataMode, operationOwner.userId ?? undefined);
      discardActiveWorkoutState();
      const refreshResult = await refreshTrainingDataForSession(operationOwner.dataMode);
      if (refreshResult.kind !== "success") return;
      if (!isUserScopedOperationCurrent(trainingCycleDeleteInFlightRef, operationOwner)) return;

      const nextPlan = createNextTrainingPlan("default");
      setTrainingPlan(nextPlan);
      dispatchRoutineBuilder({ type: "reset_state", setupByDay: createSetupByDay(), activeDay: "Lunes" });
      {
        const dayReset = resolveDayStateReset();
        setActiveRoutineDay(dayReset.activeRoutineDay);
        setDashboardDayOverride(dayReset.dashboardDayOverride);
        dispatchProgressController({ type: "selection_reset" });
      }
      setIsEditingRoutinePlan(true);
      setIsDeleteCycleConfirmOpen(false);
      setStatusMessage("Ciclo eliminado. Ya puedes configurar un nuevo ciclo de entrenamiento.");
      applyScreenTransition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
    } catch (error) {
      if (isUserScopedOperationCurrent(trainingCycleDeleteInFlightRef, operationOwner)) {
        if (error instanceof TrainingCycleRepositoryError) {
          setStatusMessage(translateTrainingCycleRepositoryError(error));
        } else if (isSessionExpiredError(error)) {
          clearUserSessionState("Tu sesión expiró. Inicia sesión nuevamente.");
        } else {
          setStatusMessage(translatePersistenceError(error));
        }
      }
    } finally {
      if (finalizeUserScopedOperation(trainingCycleDeleteInFlightRef, operationOwner)) {
        setIsBusy(false);
      }
    }
  }

  function updateExerciseDraft(exercise: ExerciseTemplate, patch: Partial<ExerciseDraft>) {
    activeWorkoutActions.updateExerciseDraft(exercise.id, {
      ...createExerciseDraft(exercise),
      ...exerciseDrafts[exercise.id],
      ...patch,
    });
  }
  function resolveCurrentReadinessMode() {
    return resolveTrainingWorkoutReadinessMode({
      enabled: trainingWorkoutReadinessV2Enabled,
      cycleScoped: isCycleScopedActiveCycle,
      workoutAttemptId: activeWorkoutReadinessContextRef.current?.workoutAttemptId ?? null,
      cycleId: activeWorkoutReadinessContextRef.current?.cycleId ?? null,
      cycleDayId: activeWorkoutReadinessContextRef.current?.cycleDayId ?? null,
      workoutStartedAt: activeWorkoutReadinessContextRef.current?.workoutStartedAt ?? null,
    });
  }

  function persistCurrentWorkoutDraftSnapshot(nextReadiness: TrainingReadiness | null) {
    if (!activeWorkoutStartedAt) return;
    saveActiveWorkoutDraft({
      updatedAt: Date.now(),
      dataMode,
      userId: supabaseUser?.id,
      activeRoutineDay,
      activeExerciseIndex,
      activeWorkoutStartedAt,
      hasStartedTraining,
      readiness: nextReadiness,
      exerciseDrafts,
      workoutAttemptId: activeWorkoutAttemptIdRef.current ?? activeWorkoutAttemptId,
      pendingReadinessLink: pendingReadinessLinkRef.current,
      cycleId: activeWorkoutReadinessContextRef.current?.cycleId ?? null,
      cycleDayId: activeWorkoutReadinessContextRef.current?.cycleDayId ?? null,
      plannedDay: activeWorkoutReadinessContextRef.current?.plannedDay ?? null,
      plannedDate: activeWorkoutReadinessContextRef.current?.plannedDate ?? null,
    });
  }
  function syncPendingWorkoutReadinessLink(link: PendingWorkoutReadinessLink | null) {
    const update = resolvePendingReadinessLinkUpdate({
      activeWorkoutAttemptId: activeWorkoutAttemptIdRef.current,
      pendingReadinessLink: link,
    });
    if (update.kind === "rejected") return false;

    pendingReadinessLinkRef.current = update.value;
    if (update.value) {
      activeWorkoutActions.publishPendingReadinessLink(update.value);
    } else {
      activeWorkoutActions.clearPendingReadinessLink();
    }
    return true;
  }

  function prepareWorkoutStartSnapshot(nextActiveExerciseIndex: number) {
    const startedAt = activeWorkoutStartedAt ?? createStableWorkoutStartedAt();
    const plannedDay = getTrainingDayCode(visibleDay);
    const cycleId = isCycleScopedActiveCycle ? persistedActiveCycle?.id ?? null : null;
    const cycleDayId = isCycleScopedActiveCycle && persistedActiveCycle && cycleScopedPlan
      ? findCycleScopedDayForTrainingDay(cycleScopedPlan, persistedActiveCycle.id, plannedDay)?.id ?? null
      : null;
    const plannedDate = isCycleScopedActiveCycle && persistedActiveCycle && cycleScopedPlan
      ? (() => {
          const cycleDay = findCycleScopedDayForTrainingDay(cycleScopedPlan, persistedActiveCycle.id, plannedDay);
          if (!cycleDay || !isNonEmptyString(persistedActiveCycle.plannedStartDate)) return null;
          return getCycleCalendarPlannedDate({
            plannedStartDate: persistedActiveCycle.plannedStartDate,
            weekNumber: currentWeek,
            plannedDay,
          });
        })()
      : null;

    if (trainingWorkoutReadinessV2Enabled && isCycleScopedActiveCycle && (!cycleId || !cycleDayId)) {
      throw new Error("No pudimos preparar la identidad del entrenamiento. Recarga el ciclo activo e intenta nuevamente.");
    }

    const currentWorkoutAttemptId = activeWorkoutAttemptIdRef.current ?? activeWorkoutAttemptId;
    const attemptId = resolveWorkoutAttemptId({
      enabled: trainingWorkoutReadinessV2Enabled && isCycleScopedActiveCycle,
      cycleId,
      cycleDayId,
      existingWorkoutAttemptId: currentWorkoutAttemptId,
    }, createWorkoutAttemptId);
    const nextPendingReadinessLink = attemptId && attemptId === currentWorkoutAttemptId ? pendingReadinessLinkRef.current : null;
    const start = resolveActiveWorkoutStartTransition({
      activeExerciseIndex: nextActiveExerciseIndex,
      exerciseCount: dayExercises.length,
      activeWorkoutStartedAt: startedAt,
      activeWorkoutAttemptId: attemptId,
      pendingReadinessLink: nextPendingReadinessLink,
    });
    if (start.kind === "rejected") {
      throw new Error("No pudimos preparar el entrenamiento.");
    }

    activeWorkoutAttemptIdRef.current = start.value.activeWorkoutAttemptId;
    pendingReadinessLinkRef.current = start.value.pendingReadinessLink;
    activeWorkoutReadinessContextRef.current = createActiveWorkoutReadinessContext({
      workoutAttemptId: start.value.activeWorkoutAttemptId,
      cycleId,
      cycleDayId,
      workoutStartedAt: start.value.activeWorkoutStartedAt,
      plannedDay,
      plannedDate,
    });
    activeWorkoutActions.commitWorkoutStart(start.value);

    saveActiveWorkoutDraft({
      updatedAt: Date.now(),
      dataMode,
      userId: supabaseUser?.id,
      activeRoutineDay,
      activeExerciseIndex: start.value.activeExerciseIndex,
      activeWorkoutStartedAt: start.value.activeWorkoutStartedAt,
      hasStartedTraining: true,
      readiness,
      exerciseDrafts,
      workoutAttemptId: start.value.activeWorkoutAttemptId,
      pendingReadinessLink: start.value.pendingReadinessLink,
      cycleId,
      cycleDayId,
      plannedDay,
      plannedDate,
    });

    return {
      startedAt: start.value.activeWorkoutStartedAt, attemptId: start.value.activeWorkoutAttemptId,
      cycleId, cycleDayId, plannedDay, plannedDate, pendingReadinessLink: start.value.pendingReadinessLink,
    };
  }

  async function startTrainingWithDailyReadiness() {
    const operationOwner = tryAcquireUserScopedOperation(workoutStartInFlightRef);
    if (!operationOwner) return;
    let ownsCheckingState = false;

    try {
      if (checkingDailyReadiness || savingDailyReadiness) return;

      const firstPendingIndex = dayExercises.findIndex((exercise) =>
        !isExerciseRegisteredInCurrentWorkout(exercise, exerciseDrafts));
      const nextActiveExerciseIndex = firstPendingIndex >= 0 ? firstPendingIndex : 0;
      activeWorkoutActions.clearDailyReadinessError();
      setRoutineNotice("");

      let startSnapshot: ReturnType<typeof prepareWorkoutStartSnapshot>;
      try {
        startSnapshot = prepareWorkoutStartSnapshot(nextActiveExerciseIndex);
      } catch (error) {
        const message = error instanceof Error ? error.message : "No pudimos preparar el entrenamiento.";
        activeWorkoutActions.publishDailyReadinessError(message);
        setRoutineNotice(message);
        return;
      }

      let readinessMode: TrainingWorkoutReadinessMode;
      try {
        readinessMode = resolveCurrentReadinessMode();
      } catch (error) {
        const message = error instanceof TrainingWorkoutReadinessFlowError ? error.message : "No pudimos preparar el formulario de entrenamiento.";
        activeWorkoutActions.publishDailyReadinessError(message);
        setRoutineNotice(message);
        return;
      }

      if (readinessMode === "attempt_v2") {
        return;
      }

      if (dataMode !== "supabase" || !hasSupabaseSession) {
        return;
      }

      activeWorkoutActions.beginDailyReadinessCheck();
      ownsCheckingState = true;
      const readinessResult = await settleUserScopedOperation(
        workoutStartInFlightRef,
        operationOwner,
        getDailyTrainingReadiness(),
      );
      if (readinessResult.kind === "stale") return;
      if (readinessResult.kind === "success") {
        if (readinessResult.value?.payload) {
          activeWorkoutActions.publishReadiness(readinessResult.value.payload);
        } else {
          activeWorkoutActions.clearReadiness();
        }
        activeWorkoutActions.clearRecoverableWorkoutStart();
      } else {
        const message = translateDailyReadinessError(readinessResult.error);
        if (trainingWorkoutReadinessV2Enabled && startSnapshot.attemptId) {
          activeWorkoutActions.markWorkoutStartRecoverable();
          activeWorkoutActions.publishDailyReadinessError(message);
          setRoutineNotice(message);
          return;
        }

        clearWorkoutDraft(dataMode, supabaseUser?.id);
        abortWorkoutStartState();
        activeWorkoutActions.publishDailyReadinessError(message);
        setRoutineNotice(message);
      }
    } finally {
      const canFinalize = finalizeUserScopedOperation(workoutStartInFlightRef, operationOwner);
      if (ownsCheckingState && canFinalize) {
        activeWorkoutActions.completeDailyReadinessCheck();
      }
    }
  }

  async function submitDailyReadiness(value: Omit<TrainingReadiness, "skipped">) {
    await persistDailyReadiness({ ...value, skipped: false });
  }

  async function skipDailyReadiness() {
    await persistDailyReadiness({ skipped: true });
  }

  async function persistDailyReadiness(value: TrainingReadiness) {
    const operationOwner = tryAcquireUserScopedOperation(dailyReadinessSaveInFlightRef);
    if (!operationOwner) return;
    let ownsSavingState = false;

    try {
      if (savingDailyReadiness) return;
      activeWorkoutActions.clearDailyReadinessError();

      let readinessMode: TrainingWorkoutReadinessMode;
      try {
        readinessMode = resolveCurrentReadinessMode();
      } catch (error) {
        const message = error instanceof TrainingWorkoutReadinessFlowError ? error.message : "No pudimos preparar el formulario de entrenamiento.";
        activeWorkoutActions.publishDailyReadinessError(message);
        return;
      }

      if (readinessMode === "legacy") {
        if (operationOwner.dataMode !== "supabase" || !hasSupabaseSession) {
          activeWorkoutActions.publishReadiness(value);
          return;
        }
        if (!operationOwner.userId) {
          activeWorkoutActions.publishDailyReadinessError("Tu sesión expiró. Inicia sesión nuevamente.");
          return;
        }

        activeWorkoutActions.beginDailyReadinessSave();
        ownsSavingState = true;
        const saveResult = await settleUserScopedOperation(
          dailyReadinessSaveInFlightRef,
          operationOwner,
          saveDailyTrainingReadiness(value, operationOwner.userId),
        );
        if (saveResult.kind === "stale") return;
        if (saveResult.kind === "success") {
          activeWorkoutActions.publishReadiness(saveResult.value.payload);
        } else {
          activeWorkoutActions.publishDailyReadinessError(translateDailyReadinessError(saveResult.error));
        }
        return;
      }

      const context = activeWorkoutReadinessContextRef.current;
      if (!context) {
        activeWorkoutActions.publishDailyReadinessError("No pudimos recuperar la identidad del entrenamiento. Recarga e intenta nuevamente.");
        return;
      }

      let payload: TrainingWorkoutReadinessPayload;
      try {
        payload = toTrainingWorkoutReadinessPayload(value);
      } catch (error) {
        activeWorkoutActions.publishDailyReadinessError(error instanceof Error ? error.message : "Completa tu formulario diario antes de continuar.");
        return;
      }

      if (!operationOwner.userId) {
        activeWorkoutActions.publishDailyReadinessError("Tu sesión expiró. Inicia sesión nuevamente.");
        return;
      }
      activeWorkoutActions.beginDailyReadinessSave();
      ownsSavingState = true;
      const saveResult = await settleUserScopedOperation(
        dailyReadinessSaveInFlightRef,
        operationOwner,
        saveTrainingWorkoutReadiness({
          workoutAttemptId: context.workoutAttemptId,
          cycleId: context.cycleId,
          cycleDayId: context.cycleDayId,
          workoutStartedAt: context.workoutStartedAt,
          payload,
        }, operationOwner.userId),
      );
      if (saveResult.kind === "stale") return;
      if (saveResult.kind === "success") {
        const record = saveResult.value;
        if (record.contextMismatch) {
          activeWorkoutActions.publishDailyReadinessError("Este intento ya tiene un formulario guardado con informacion diferente. Recarga el entrenamiento para recuperar sus datos.");
          return;
        }
        activeWorkoutActions.publishReadiness(record.payload);
        activeWorkoutActions.clearRecoverableWorkoutStart();
        syncPendingWorkoutReadinessLink(null);
        persistCurrentWorkoutDraftSnapshot(record.payload);
      } else {
        activeWorkoutActions.publishDailyReadinessError(translateTrainingWorkoutReadinessError(saveResult.error));
      }
    } finally {
      const canFinalize = finalizeUserScopedOperation(dailyReadinessSaveInFlightRef, operationOwner);
      if (ownsSavingState && canFinalize) {
        activeWorkoutActions.completeDailyReadinessSave();
      }
    }
  }

  function registerCurrentExercise() {
    const decision = resolveCurrentExerciseRegistration({
      isBusy,
      exercises: dayExercises,
      activeExerciseIndex,
      drafts: exerciseDrafts,
    });

    switch (decision.kind) {
      case "busy":
      case "missing_exercise":
      case "already_registered_complete":
        return;
      case "already_registered_advance":
        activeWorkoutActions.selectExercise(decision.nextExerciseIndex, dayExercises.length);
        return;
      case "invalid_draft":
        setRoutineNotice(decision.message);
        return;
      case "register":
        setRoutineNotice("");
        updateExerciseDraft(decision.exercise, decision.draft);
        activeWorkoutActions.selectExercise(decision.nextExerciseIndex, dayExercises.length);
    }
  }

  async function confirmTrainingWorkoutReadinessLink(
    pendingLink: PendingWorkoutReadinessLink,
    operationOwner: SessionOperationOwner,
  ) {
    if (!operationOwner.userId) {
      throw new TrainingWorkoutReadinessLinkFlowError(
        "Tu sesión expiró. Inicia sesión nuevamente.",
      );
    }
    const linkResult = await settleUserScopedOperation(
      workoutCompletionInFlightRef,
      operationOwner,
      linkTrainingWorkoutReadinessSession({
        workoutAttemptId: pendingLink.workoutAttemptId,
        trainingSessionId: pendingLink.trainingSessionId,
      }, operationOwner.userId),
    );
    if (linkResult.kind === "stale") return false;
    if (linkResult.kind === "error") throw linkResult.error;
    const confirmation = resolveWorkoutReadinessLinkConfirmation({
      pendingLink,
      result: linkResult.value,
    });
    if (confirmation.kind === "blocked") {
      throw new TrainingWorkoutReadinessLinkFlowError(confirmation.message);
    }
    return true;
  }

  function persistWorkoutDraftWithPendingLink(input: {
    pendingLink: PendingWorkoutReadinessLink;
    workoutAttemptId: string;
    activeWorkoutStartedAt: string;
    plannedDay: TrainingDayCode;
    plannedDate: string | null;
    cycleId: string | null;
    cycleDayId: string | null;
    activeRoutineDay: string;
    activeExerciseIndex: number;
    readiness: TrainingReadiness | null;
    exerciseDrafts: Record<string, ExerciseDraft>;
  }) {
    if (!syncPendingWorkoutReadinessLink(input.pendingLink)) return false;
    saveActiveWorkoutDraft({
      updatedAt: Date.now(),
      dataMode,
      userId: supabaseUser?.id,
      activeRoutineDay: input.activeRoutineDay,
      activeExerciseIndex: input.activeExerciseIndex,
      activeWorkoutStartedAt: input.activeWorkoutStartedAt,
      hasStartedTraining: true,
      readiness: input.readiness,
      exerciseDrafts: input.exerciseDrafts,
      workoutAttemptId: input.workoutAttemptId,
      pendingReadinessLink: input.pendingLink,
      cycleId: input.cycleId,
      cycleDayId: input.cycleDayId,
      plannedDay: input.plannedDay,
      plannedDate: input.plannedDate,
    });
    return true;
  }

  // Limpieza del intento activo tras persistir un entrenamiento. NO navega: el destino lo
  // decide resolveWorkoutCompletionTransition en cada caller y lo aplica applyScreenTransition
  // (separación persistencia/decisión/aplicación, P3-07B — elimina la doble escritura previa
  // "dashboard" → "training-summary" dentro del mismo lote).
  function finishCompletedWorkout() {
    clearWorkoutDraft(dataMode, supabaseUser?.id);
    activeWorkoutAttemptIdRef.current = null;
    pendingReadinessLinkRef.current = null;
    activeWorkoutReadinessContextRef.current = null;
    activeWorkoutActions.finishWorkout();
  }

  async function buildCompletedTrainingSummarySnapshot(input: {
    sessionId: string;
    validExercises: ExerciseTemplate[];
    capturedExerciseDrafts: Record<string, ExerciseDraft>;
    workoutStartedAt: string | null;
    savedAt: string;
    trainedDate: string;
  }, operationOwner: SessionOperationOwner) {
    const historicalResult = await settleUserScopedOperation(
      workoutCompletionInFlightRef,
      operationOwner,
      loadTrainingCompletionHistoricalInputs({
        currentSessionId: input.sessionId,
        exercises: input.validExercises,
        loadLatestByLineage: getLatestExercisePerformanceByLineage,
      }),
    );
    if (historicalResult.kind === "stale") return null;
    if (historicalResult.kind === "error") throw historicalResult.error;
    const historicalByExerciseId = historicalResult.value;
    const plannedDaysCount = hasRoutinePlan ? dashboardCarouselDays.length : routineDays.length;
    const completedDaysAfterSave = Math.min(
      plannedDaysCount,
      calculateWeeklyCompletedTrainingDays({
        plannedDays: dashboardCarouselDays,
        exercises: displayExercises,
        entries: calendarNormalizedEntries,
        sessions: calendarNormalizedTrainingSessions,
        usesCycleScopedSessions: isCycleScopedActiveCycle,
      }) + 1,
    );
    const completionTopbarMeta = buildTrainingTopbarMeta({
      cycleLabel: trainingTopbarMeta?.cycleLabel ?? getCycleTypeTitle(displayTrainingPlan),
      weekNumber: currentWeek,
      completedDays: completedDaysAfterSave,
      plannedDays: plannedDaysCount,
    });

    return buildTrainingCompletionSummary({
      sessionId: input.sessionId,
      dayLabel: visibleDay,
      statusLabel: `Completado · ${input.validExercises.length} de ${input.validExercises.length}`,
      workoutName: visibleRoutine,
      cycleLabel: completionTopbarMeta?.cycleLabel ?? trainingTopbarMeta?.cycleLabel ?? getCycleTypeTitle(displayTrainingPlan),
      weekLabel: completionTopbarMeta?.weekLabel ?? trainingTopbarMeta?.weekLabel ?? `Semana ${currentWeek}`,
      progressLabel: completionTopbarMeta?.progressLabel ?? trainingTopbarMeta?.progressLabel ?? `${plannedDaysCount} de ${plannedDaysCount} días`,
      workoutStartedAt: input.workoutStartedAt,
      savedAt: input.savedAt,
      currentDate: input.trainedDate,
      exercises: buildTrainingCompletionExerciseInputs({
        exercises: input.validExercises,
        drafts: input.capturedExerciseDrafts,
      }),
      historicalByExerciseId,
    });
  }

  async function saveCompletedTraining() {
    const operationOwner = tryAcquireUserScopedOperation(workoutCompletionInFlightRef);
    if (!operationOwner) return;
    let ownsBusyState = false;

    try {
      if (isBusy) return;

      const completionStart = resolveActiveWorkoutCompletionStart(
        pendingReadinessLinkRef.current,
      );
      if (completionStart.kind === "retry_pending_link") {
        setIsBusy(true);
        ownsBusyState = true;
        setRoutineNotice("");
        try {
          const linked = await confirmTrainingWorkoutReadinessLink(
            completionStart.pendingLink,
            operationOwner,
          );
          if (!linked || !isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
          setStatusMessage("Entrenamiento guardado.");
          finishCompletedWorkout();
          applyScreenTransition(resolveWorkoutCompletionTransition({ hasCompletionSummary: false }));
        } catch (error) {
          if (!isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
          setRoutineNotice(translateTrainingWorkoutReadinessLinkError(error));
        }
        return;
      }

      let readinessMode: TrainingWorkoutReadinessMode;
      try {
        readinessMode = resolveCurrentReadinessMode();
      } catch (error) {
        const message = error instanceof TrainingWorkoutReadinessFlowError ? error.message : "No pudimos preparar el formulario de entrenamiento.";
        setRoutineNotice(message);
        return;
      }

      const completionMode = resolveActiveWorkoutCompletionMode({
        repositoryActive: isTrainingCyclesRepositoryActive,
        hasPersistedActiveCycle: Boolean(persistedActiveCycle),
        cycleScopedActiveCycle: isCycleScopedActiveCycle,
      });
      const shouldLinkWorkoutReadiness = readinessMode === "attempt_v2";
      const readinessContext = activeWorkoutReadinessContextRef.current;
      const capturedWorkoutAttemptId = activeWorkoutAttemptIdRef.current;
      const plannedDay = getTrainingDayCode(visibleDay);
      const preparation = prepareActiveWorkoutCompletion({
        mode: completionMode,
        exercises: dayExercises,
        drafts: exerciseDrafts,
        shouldLinkWorkoutReadiness,
        workoutAttemptId: capturedWorkoutAttemptId,
        readinessContext,
        cycle: completionMode === "cycle_scoped" && persistedActiveCycle
          ? {
            plan: cycleScopedPlan,
            cycleId: persistedActiveCycle.id,
            plannedStartDate: persistedActiveCycle.plannedStartDate,
            plannedDay,
            trainedDate: todayKey,
          }
          : undefined,
      });
      if (preparation.kind === "blocked") {
        setRoutineNotice(preparation.message);
        return;
      }
      const { validExercises } = preparation;
      const readinessNote = formatReadinessNote(readiness);

      if (preparation.mode === "cycle_scoped") {
        if (!operationOwner.userId) return;
        const entriesResult = buildCycleScopedWorkoutCompletionEntries({
          cycleId: preparation.cycleId,
          cycleDay: preparation.cycleDay,
          exercises: validExercises,
          drafts: exerciseDrafts,
          entryIds: validExercises.map(() => createId()),
          dayLabel: visibleDay,
          readinessNote,
        });
        if (entriesResult.kind === "blocked") {
          setRoutineNotice(entriesResult.message);
          return;
        }

        const capture = captureActiveWorkoutCompletionContext({
          shouldLinkWorkoutReadiness,
          activeRoutineDay,
          activeExerciseIndex,
          readiness,
          exerciseDrafts,
          workoutAttemptId: capturedWorkoutAttemptId,
          readinessContext,
          activeWorkoutStartedAt,
          fallbackCycleId: preparation.cycleId,
          fallbackCycleDayId: preparation.cycleDay.id,
        });
        if (capture.kind === "blocked") {
          setRoutineNotice(capture.message);
          return;
        }
        const captured = capture.context;

        setIsBusy(true);
        ownsBusyState = true;
        setRoutineNotice("");
        const sessionSaveResult = await settleUserScopedOperation(
          workoutCompletionInFlightRef,
          operationOwner,
          createTrainingSessionWithCycleEntries({
            cycleId: preparation.cycleId,
            cycleDayId: preparation.cycleDay.id,
            plannedDay: preparation.plannedDay,
            plannedDate: preparation.plannedDate,
            trainedDate: preparation.trainedDate,
            weekNumber: preparation.weekNumber,
            status: "completed",
            notes: `Entrenamiento ${visibleDay}: ${visibleRoutine}. ${readinessNote}`,
            entries: entriesResult.entries,
          }, operationOwner.userId),
        );
        if (sessionSaveResult.kind === "stale") return;
        if (sessionSaveResult.kind === "error") {
          const message = handlePersistenceError(sessionSaveResult.error);
          if (!isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
          setRoutineNotice(message);
          return;
        }
        const savedTrainingSessionId = sessionSaveResult.value;

        if (shouldLinkWorkoutReadiness) {
          let nextPendingLink: PendingWorkoutReadinessLink;
          try {
            const createdPendingLink = createWorkoutReadinessPendingLink({
              enabled: trainingWorkoutReadinessV2Enabled,
              cycleScoped: true,
              workoutAttemptId: captured.workoutAttemptId,
              trainingSessionId: savedTrainingSessionId,
            });
            if (!createdPendingLink) throw new TrainingWorkoutReadinessLinkFlowError();
            nextPendingLink = createdPendingLink;
          } catch (error) {
            setRoutineNotice(translateTrainingWorkoutReadinessLinkError(error));
            return;
          }

          const pendingLinkPersisted = persistWorkoutDraftWithPendingLink({
            pendingLink: nextPendingLink,
            workoutAttemptId: nextPendingLink.workoutAttemptId,
            activeWorkoutStartedAt: captured.workoutStartedAt ?? createStableWorkoutStartedAt(),
            plannedDay: preparation.plannedDay,
            plannedDate: preparation.plannedDate,
            cycleId: captured.cycleId,
            cycleDayId: captured.cycleDayId,
            activeRoutineDay: captured.activeRoutineDay,
            activeExerciseIndex: captured.activeExerciseIndex,
            readiness: captured.readiness,
            exerciseDrafts: captured.exerciseDrafts,
          });
          if (!pendingLinkPersisted) return;

          try {
            const linked = await confirmTrainingWorkoutReadinessLink(
              nextPendingLink,
              operationOwner,
            );
            if (!linked || !isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
          } catch (error) {
            if (!isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
            setRoutineNotice(translateTrainingWorkoutReadinessLinkError(error));
            return;
          }
        }

        const summarySnapshot = await buildCompletedTrainingSummarySnapshot({
          sessionId: savedTrainingSessionId,
          validExercises,
          capturedExerciseDrafts: captured.exerciseDrafts,
          workoutStartedAt: captured.workoutStartedAt,
          savedAt: new Date().toISOString(),
          trainedDate: preparation.trainedDate,
        }, operationOwner);
        if (!summarySnapshot || !isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
        if (!activeWorkoutActions.publishWorkoutCompletion(summarySnapshot, validExercises.map((exercise) => exercise.id))) return;
        setStatusMessage("Entrenamiento guardado.");
        try {
          finishCompletedWorkout();
          applyScreenTransition(resolveWorkoutCompletionTransition({ hasCompletionSummary: true }));
        } catch {
          // El entrenamiento ya fue persistido; un fallo local de limpieza no debe habilitar duplicados.
        }

        await trainingDataController.reloadCycleSessions(preparation.cycleId, {
          errorMessage: "Entrenamiento guardado. Recarga el panel para ver la sesion registrada.",
        });
        return;
      }

      setIsBusy(true);
      ownsBusyState = true;
      setRoutineNotice("");
      try {
        const currentWeekDates = getCurrentSantiagoWeekDates();
        const legacyPlannedDate = currentWeekDates[visibleDay] ?? todayKey;
        const trainedDate = todayKey;
        const trainingWeek = getLegacyWeekNumberForTrainingDate(trainingSessions, entries, trainedDate);
        const capture = captureActiveWorkoutCompletionContext({
          shouldLinkWorkoutReadiness: false,
          activeRoutineDay,
          activeExerciseIndex,
          readiness,
          exerciseDrafts,
          workoutAttemptId: capturedWorkoutAttemptId,
          readinessContext,
          activeWorkoutStartedAt,
          fallbackCycleId: null,
          fallbackCycleDayId: null,
        });
        if (capture.kind === "blocked") {
          setRoutineNotice(capture.message);
          return;
        }
        const captured = capture.context;
        const legacyEntries = buildLegacyWorkoutCompletionEntries({
          exercises: validExercises,
          drafts: captured.exerciseDrafts,
          previousEntries: metrics,
          entryIds: validExercises.map(() => createId()),
          dayLabel: visibleDay,
          readinessNote,
        });
        const legacySessionInput = {
          routine: visibleRoutine,
          plannedDay,
          plannedDate: legacyPlannedDate,
          trainedDate,
          weekNumber: trainingWeek,
          status: "completed" as const,
          notes: `Entrenamiento ${visibleDay}: ${visibleRoutine}. ${readinessNote}`,
          entries: legacyEntries,
        };
        let legacySessionRequest: ReturnType<typeof saveTrainingSessionWithEntries>;
        if (operationOwner.dataMode === "supabase") {
          if (!operationOwner.userId) return;
          legacySessionRequest = saveTrainingSessionWithEntries(
            legacySessionInput,
            operationOwner.dataMode,
            operationOwner.userId,
          );
        } else {
          legacySessionRequest = saveTrainingSessionWithEntries(
            legacySessionInput,
            "demo",
            "demo",
          );
        }
        const sessionSaveResult = await settleUserScopedOperation(
          workoutCompletionInFlightRef,
          operationOwner,
          legacySessionRequest,
        );
        if (sessionSaveResult.kind === "stale") return;
        if (sessionSaveResult.kind === "error") throw sessionSaveResult.error;
        const savedSession = sessionSaveResult.value;

        const summarySnapshot = await buildCompletedTrainingSummarySnapshot({
          sessionId: savedSession.id,
          validExercises,
          capturedExerciseDrafts: captured.exerciseDrafts,
          workoutStartedAt: captured.workoutStartedAt,
          savedAt: new Date().toISOString(),
          trainedDate,
        }, operationOwner);
        if (!summarySnapshot || !isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
        if (!activeWorkoutActions.publishWorkoutCompletion(summarySnapshot, validExercises.map((exercise) => exercise.id))) return;
        trainingDataController.appendLegacySession(savedSession, operationOwner.requestToken);
        setStatusMessage("Entrenamiento guardado.");
        finishCompletedWorkout();
        applyScreenTransition(resolveWorkoutCompletionTransition({ hasCompletionSummary: true }));
      } catch (error) {
        if (!isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
        const message = handlePersistenceError(error);
        if (!isUserScopedOperationCurrent(workoutCompletionInFlightRef, operationOwner)) return;
        setRoutineNotice(message === "Ya existe un entrenamiento registrado para esta rutina y fecha."
          ? "Ya existe un entrenamiento registrado para esta rutina y fecha. Puedes revisar el resumen o editar el registro existente."
          : message);
      }
    } finally {
      const canFinalize = finalizeUserScopedOperation(
        workoutCompletionInFlightRef,
        operationOwner,
      );
      if (ownsBusyState && canFinalize) {
        setIsBusy(false);
      }
    }
  }

  function clearAuthForms() {
    setLoginEmail("");
    setLoginPassword("");
    setRegisterName("");
    setRegisterEmail("");
    setRegisterPassword("");
    setRegisterConfirmPassword("");
    setRecoveryEmail("");
    setNewPassword("");
    setNewPasswordConfirm("");
  }

  function switchAuthScreen(nextScreen: "login" | "registro" | "recuperar-password") {
    passwordRecoveryUserIdRef.current = null;
    passwordRecoveryUpdateOwnerRef.current = null;
    passwordRecoveryStateRef.current = "none";
    setIsPasswordRecoveryConfirmed(false);
    clearPasswordRecoveryFlow();
    clearPasswordRecoveryUrl();
    clearAuthForms();
    setStatusMessage("");
    applyScreenTransition(createAuthNavigationReset(nextScreen, "auth-screen-switch"));
  }

  if (screen === "recovery-expired") {
    return (
      <main className="app-shell">
        <RecoveryExpiredScreen
          message={statusMessage}
          onRequestNewLink={() => switchAuthScreen("recuperar-password")}
        />
      </main>
    );
  }

  if (screen === "nueva-password" && isPasswordRecoveryConfirmed) {
    return (
      <main className="app-shell">
        <NewPasswordScreen
          password={newPassword}
          confirmPassword={newPasswordConfirm}
          message={statusMessage}
          isBusy={isBusy}
          onPasswordChange={setNewPassword}
          onConfirmPasswordChange={setNewPasswordConfirm}
          onSubmit={handleUpdatePassword}
        />
      </main>
    );
  }

  if (isAuthLoading) {
    return (
      <main className="app-shell">
        <section className="login-shell">
          <div className="login-logo">
            <div className="brand-mark">
              <Dumbbell size={28} />
            </div>
            <div>
              <h1>Organizatech</h1>
              <p className="eyebrow">Validando sesión...</p>
            </div>
          </div>
          <div className="card wide">
            <h2>Validando sesión...</h2>
            <p className="eyebrow">Estamos revisando si ya tienes una sesión activa.</p>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "login") {
    return (
      <main className="app-shell">
        <AuthScreen
          mode="login"
          message={statusMessage}
          isBusy={isBusy}
          loginEmail={loginEmail}
          loginPassword={loginPassword}
          registerName={registerName}
          registerEmail={registerEmail}
          registerPassword={registerPassword}
          registerConfirmPassword={registerConfirmPassword}
          onLoginEmailChange={setLoginEmail}
          onLoginPasswordChange={setLoginPassword}
          onRegisterNameChange={setRegisterName}
          onRegisterEmailChange={setRegisterEmail}
          onRegisterPasswordChange={setRegisterPassword}
          onRegisterConfirmPasswordChange={setRegisterConfirmPassword}
          onSubmit={(data) => handleAuth("login", data)}
          onForgotPassword={() => switchAuthScreen("recuperar-password")}
          onSwitch={() => switchAuthScreen("registro")}
        />
      </main>
    );
  }

  if (screen === "registro") {
    return (
      <main className="app-shell">
        <AuthScreen
          mode="registro"
          message={statusMessage}
          isBusy={isBusy}
          loginEmail={loginEmail}
          loginPassword={loginPassword}
          registerName={registerName}
          registerEmail={registerEmail}
          registerPassword={registerPassword}
          registerConfirmPassword={registerConfirmPassword}
          onLoginEmailChange={setLoginEmail}
          onLoginPasswordChange={setLoginPassword}
          onRegisterNameChange={setRegisterName}
          onRegisterEmailChange={setRegisterEmail}
          onRegisterPasswordChange={setRegisterPassword}
          onRegisterConfirmPasswordChange={setRegisterConfirmPassword}
          onSubmit={(data) => handleAuth("registro", data)}
          onForgotPassword={() => switchAuthScreen("recuperar-password")}
          onSwitch={() => switchAuthScreen("login")}
        />
      </main>
    );
  }

  if (screen === "recuperar-password") {
    return (
      <main className="app-shell">
        <PasswordRecoveryScreen
          email={recoveryEmail}
          message={statusMessage}
          isBusy={isBusy}
          onEmailChange={setRecoveryEmail}
          onSubmit={handlePasswordRecovery}
          onBack={() => switchAuthScreen("login")}
        />
      </main>
    );
  }

  function handleProfileAvatarImageError() {
    const now = Date.now();
    if (now - lastProfileAvatarErrorRefreshAtRef.current < PROFILE_AVATAR_ERROR_REFRESH_THROTTLE_MS) return;
    lastProfileAvatarErrorRefreshAtRef.current = now;
    void refreshProfileAvatar({ force: true, allowProfileLookup: true });
  }

  function markNotificationsSeen(ids: string[]) {
    if (ids.length === 0) return;
    const requestToken = captureSessionDataRequestToken();
    const scope = activeBrowserStorageScopeRef.current;
    if (
      !scope ||
      requestToken.scope !== scope ||
      !isSessionDataRequestCurrent(requestToken)
    ) return;
    setSeenNotificationRecords((current) => {
      if (
        activeBrowserStorageScopeRef.current !== scope ||
        !isSessionDataRequestCurrent(requestToken)
      ) return current;
      const next = [...transitionNotificationsSeen(current, ids)];
      saveSeenNotificationRecords(next, scope);
      return next;
    });
  }

  function toggleNotifications() {
    setIsNotificationPanelOpen((current) => !current);
    setIsMenuOpen(false);
  }

  function openNotificationTarget(notification: AppNotification) {
    const intent = resolveNotificationOpenIntent(notification);
    markNotificationsSeen([intent.notificationId]);
    setIsNotificationPanelOpen(false);
    activeWorkoutActions.clearTrainingCompletionSummary();
    if (intent.dashboardDayOverride) {
      setDashboardDayOverride(intent.dashboardDayOverride);
    }
    if (intent.comparisonDayOverride) {
      dispatchProgressController({ type: "day_selected", day: intent.comparisonDayOverride });
    }
    navigateTo(intent.target);
    scrollToNotificationSection(intent.section ?? undefined);
  }

  function scrollToNotificationSection(section?: AppNotificationSection) {
    const scrollTarget = resolveNotificationScrollTarget(section ?? null);
    if (!scrollTarget || typeof document === "undefined") return;

    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(scrollTarget.selector);
      if (!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("section-highlighted");
      window.setTimeout(() => {
        target.classList.remove("section-highlighted");
      }, NOTIFICATION_SECTION_HIGHLIGHT_MS);
    }, 160);
  }

  const menuScreens = resolveMenuScreens(primaryScreens, hasTrainingEntries, visibleCycleHistoryCount);

  const dashboardScreenVariant = resolveDashboardScreenVariant(isCycleScopedPlanBlocked);
  const comparisonScreenVariant = resolveComparisonScreenVariant(isCycleScopedPlanBlocked);
  const routineBuilderVariant = resolveRoutineBuilderVariant({
    isCycleScopedPlanBlocked,
    hasRoutinePlan,
    isEditingRoutinePlan,
  });
  const activeWorkoutVariant = resolveActiveWorkoutVariant({
    isCycleScopedPlanBlocked,
    hasRoutinePlan,
    isEditingRoutinePlan,
    hasStartedTraining,
    hasReadiness: Boolean(readiness),
  });

  function toggleMenu() {
    setIsNotificationPanelOpen(false);
    setIsMenuOpen((value) => {
      const next = !value;
      if (next) {
        void refreshProfileAvatar({ force: true, allowProfileLookup: true });
      }
      return next;
    });
  }

  return (
    <AppShellLayout
      topbar={
        <AppTopbar
          isHidden={isTopbarHidden}
          isMenuOpen={isMenuOpen}
          onMenuToggle={toggleMenu}
          trainingMeta={trainingTopbarMeta}
          fallbackText={hasTrainingEntries ? `Semana ${currentWeek} · ${authModeLabel}` : "Sin registro de entrenamiento"}
          isNotificationPanelOpen={isNotificationPanelOpen}
          notificationBadgeText={notificationBadgeText}
          notificationBadgeAriaLabel={notificationBadgeAriaLabel}
          onToggleNotifications={toggleNotifications}
        />
      }
      notificationOverlay={
        <NotificationPanel
          isOpen={isNotificationPanelOpen}
          subtitle={notificationPanelSubtitle}
          totalNotificationsCount={appNotifications.length}
          newNotifications={newNotifications}
          historyNotifications={historyNotifications}
          seenNotificationRecordsById={seenNotificationRecordsById}
          emptyMessage={NOTIFICATION_EMPTY_MESSAGE}
          onClose={() => setIsNotificationPanelOpen(false)}
          onOpenNotification={openNotificationTarget}
        />
      }
      navigationOverlay={
        <AppNavigationDrawer
          isOpen={isMenuOpen}
          profileHeader={
            <ProfileMenuHeader
              profile={profileViewModel}
              onAvatarImageError={handleProfileAvatarImageError}
              avatarResetKey={profileAvatarResetKey}
            />
          }
          items={menuScreens.map((item) => ({ id: item, label: screenLabel(item), isActive: screen === item }))}
          isLogoutDisabled={isBusy}
          onClose={() => setIsMenuOpen(false)}
          onNavigate={navigateTo}
          onLogout={handleLogout}
        />
      }
      screenHeader={canGoBackFromScreen(screen) ? <AppScreenHeader onBack={goBack} /> : null}
    >
      {screen === "dashboard" && (
        dashboardScreenVariant === "blocked" ? (
          <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
        ) : (
          <DashboardScreen
            exercises={displayExercises}
            hasTrainingEntries={hasTrainingEntries}
            hasRoutinePlan={hasRoutinePlan}
            usesCycleScopedSessions={isCycleScopedActiveCycle}
            day={dashboardDay}
            weekDays={dashboardCarouselDays}
            dayExercises={dashboardExercises}
            summary={summary}
            weeklyEquivalentProgress={weeklyEquivalentProgress}
            currentWeek={currentWeek}
            entries={calendarNormalizedEntries}
            sessions={calendarNormalizedTrainingSessions}
            startRegistration={() => navigateTo("registro-entrenamiento")}
            goToRoutine={() => openRoutineDay(dashboardDay)}
            viewSummary={(selectedDay) => {
              dispatchProgressController({ type: "day_selected", day: selectedDay });
              navigateTo("comparacion");
            }}
            switchDay={setDashboardDayOverride}
          />
        )
      )}
      {screen === "training-summary" && isTrainingSummaryScreenValid(Boolean(trainingCompletionSummary)) && trainingCompletionSummary && (
        <TrainingCompletionSummaryScreen
          summary={trainingCompletionSummary}
          onDashboard={() => {
            activeWorkoutActions.clearTrainingCompletionSummary();
            applyScreenTransition(createFlowScreenTransition("dashboard", "summary-dismissed"));
          }}
        />
      )}
      {screen === "registro-entrenamiento" && routineBuilderVariant === "blocked" && (
        <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
      )}
      {screen === "registro-entrenamiento" && routineBuilderVariant === "editor" && (
        <InitialTrainingScreen
          day={setupDay}
          setDay={(day) => dispatchRoutineBuilder({ type: "select_day", day })}
          routineName={setupByDay[setupDay]?.routineName ?? ""}
          setRoutineName={updateSetupRoutineName}
          rows={setupByDay[setupDay]?.rows ?? createSetupRows()}
          updateRow={updateSetupRow}
          addRow={addSetupRow}
          removeRow={removeSetupRow}
          saveRoutine={() => void saveInitialRoutine("unconfirmed")}
          trainingPlan={trainingPlan}
          updateTrainingPlan={updateTrainingPlan}
          message={statusMessage}
          isBusy={isBusy}
          configuredDays={getConfiguredSetupDays(setupByDay)}
        />
      )}
      {screen === "registro-entrenamiento" && routineBuilderVariant === "management" && (
        <CycleManagementScreen
          trainingPlan={displayTrainingPlan}
          exercises={displayExercises}
          entries={displayEntries}
          cycleNumber={visibleCycleNumber}
          activeCycleName={isTrainingCyclesRepositoryActive ? persistedActiveCycle?.name : undefined}
          editCurrentCycle={() => openRoutineEditor(visibleDay)}
          requestNewCycle={() => setIsNewCycleConfirmOpen(true)}
          requestDeleteCycle={() => setIsDeleteCycleConfirmOpen(true)}
        />
      )}
      {screen === "entrenamiento" && activeWorkoutVariant === "blocked" && (
        <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
      )}
      {screen === "entrenamiento" && activeWorkoutVariant === "empty" && (
        <EmptyDashboard startRegistration={() => navigateTo("registro-entrenamiento")} />
      )}
      {screen === "entrenamiento" && activeWorkoutVariant === "start" && (
        <TrainingStartScreen
          day={visibleDay}
          routine={visibleRoutine}
          exercises={dayExercises}
          targetSummary={targetSummary}
          routineDays={routineDays}
          switchDay={(day) => openRoutineDay(day)}
          editRoutine={() => openRoutineEditor(visibleDay)}
          startTraining={startTrainingWithDailyReadiness}
          isStartingTraining={checkingDailyReadiness}
          notice={dailyReadinessError || routineNotice}
        />
      )}
      {screen === "entrenamiento" && activeWorkoutVariant === "readiness" && (
        <TrainingReadinessScreen
          onSubmit={submitDailyReadiness}
          onSkip={skipDailyReadiness}
          isSaving={savingDailyReadiness}
          error={dailyReadinessError}
        />
      )}
      {screen === "entrenamiento" && activeWorkoutVariant === "guided" && (
        <GuidedTrainingScreen
          day={visibleDay}
          routine={visibleRoutine}
          exercises={dayExercises}
          targetSummary={targetSummary}
          activeIndex={activeExerciseIndex}
          setActiveIndex={(index) => {
            activeWorkoutActions.selectExercise(index, dayExercises.length);
          }}
          drafts={exerciseDrafts}
          latestExercisePerformance={latestExercisePerformance}
          latestExercisePerformanceLoading={latestExercisePerformanceLoading}
          latestExercisePerformanceError={latestExercisePerformanceError}
          latestExerciseObservation={latestExerciseObservation}
          latestExerciseObservationLoading={latestExerciseObservationLoading}
          latestExerciseObservationError={latestExerciseObservationError}
          latestExerciseObservationDidQuery={latestExerciseObservationDidQuery}
          updateDraft={updateExerciseDraft}
          registerExercise={registerCurrentExercise}
          saveCompletedTraining={saveCompletedTraining}
          editRoutine={() => openRoutineEditor(visibleDay)}
          routineDays={routineDays}
          switchDay={(day) => openRoutineDay(day, true)}
          notice={routineNotice}
          isBusy={isBusy}
        />
      )}
      {screen === "comparacion" && (
        comparisonScreenVariant === "blocked" ? (
          <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
        ) : (
          <ComparisonScreenV2
            model={progressControllerView.comparisonModel}
            routineDays={routineDays}
            onDaySelect={(day) => dispatchProgressController({ type: "day_selected", day })}
            onExerciseSelect={(exerciseId) => dispatchProgressController({ type: "exercise_selected", exerciseId })}
            onWeekSelect={(week) => dispatchProgressController({ type: "week_selected", week })}
          />
        )
      )}
      {screen === "historial-ciclos" && (
        <CycleHistoryProductiveContainer
          key={`${supabaseUser?.id ?? "anonymous"}:${isTrainingCyclesRepositoryActive ? "enabled" : "disabled"}`}
          enabled={isTrainingCyclesRepositoryActive}
          identityKey={supabaseUser?.id ?? null}
          legacySnapshots={cycleHistory}
        />
      )}
      {screen === "perfil" && (
        <ProfileScreen
          key={supabaseUser?.id ?? "anonymous"}
          profile={profileViewModel}
          personalData={profilePersonalData}
          canEditPersonalData={canEditProfilePersonalData}
          personalDataLoading={profilePersonalDataLoading}
          personalDataError={profilePersonalDataError}
          canEditAvatar={canEditProfilePersonalData}
          avatarLoading={profileAvatarLoading}
          avatarError={profileAvatarError}
          onAvatarImageError={handleProfileAvatarImageError}
          avatarResetKey={profileAvatarResetKey}
          onReloadPersonalData={refreshProfilePersonalData}
          onSavePersonalData={handleSaveProfilePersonalData}
          onUploadAvatar={handleUploadProfileAvatar}
          cycleContextLabel={`${trainingTopbarMeta?.cycleLabel ?? "Ciclo"} + ${trainingTopbarMeta?.weekLabel ?? `Semana ${currentWeek}`}`}
        />
      )}
      {isNewCycleConfirmOpen && (
        <ConfirmNewCycleModal
          isBusy={isBusy}
          onCancel={() => setIsNewCycleConfirmOpen(false)}
          onConfirm={() => void startNewTrainingCycle()}
        />
      )}
      {isDeleteCycleConfirmOpen && (
        <ConfirmDeleteCycleModal
          isBusy={isBusy}
          onCancel={() => setIsDeleteCycleConfirmOpen(false)}
          onConfirm={() => void deleteCurrentTrainingCycle()}
        />
      )}
      {isRoutineSuccessOpen && (
        <RoutineSuccessModal
          onConfirm={() => {
            setIsRoutineSuccessOpen(false);
            applyScreenTransition(createFlowScreenTransition("dashboard", "routine-success-dismissed"));
          }}
        />
      )}
      {isRoutineUpdateConfirmOpen && (
        <ConfirmRoutineUpdateModal
          onCancel={() => cancelRoutineUpdate()}
          onConfirm={() => void saveInitialRoutine("confirmed_routine_update")}
        />
      )}
    </AppShellLayout>
  );
}

function AuthScreen({
  mode,
  message,
  isBusy,
  loginEmail,
  loginPassword,
  registerName,
  registerEmail,
  registerPassword,
  registerConfirmPassword,
  onLoginEmailChange,
  onLoginPasswordChange,
  onRegisterNameChange,
  onRegisterEmailChange,
  onRegisterPasswordChange,
  onRegisterConfirmPasswordChange,
  onSubmit,
  onForgotPassword,
  onSwitch,
}: {
  mode: "login" | "registro";
  message: string;
  isBusy: boolean;
  loginEmail: string;
  loginPassword: string;
  registerName: string;
  registerEmail: string;
  registerPassword: string;
  registerConfirmPassword: string;
  onLoginEmailChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onRegisterNameChange: (value: string) => void;
  onRegisterEmailChange: (value: string) => void;
  onRegisterPasswordChange: (value: string) => void;
  onRegisterConfirmPasswordChange: (value: string) => void;
  onSubmit: (data: FormData) => void;
  onForgotPassword: () => void;
  onSwitch: () => void;
}) {
  const isRegister = mode === "registro";
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);

  return (
    <section className="login-shell">
      <div className="login-logo">
        <div className="brand-mark">
          <Dumbbell size={28} />
        </div>
        <div>
          <h1>Organizatech</h1>
          <p className="eyebrow">Evoluciona tu rendimiento.</p>
        </div>
      </div>
      <form className="card form-grid" action={onSubmit} autoComplete={isRegister ? "off" : "on"} key={mode}>
        <h2>{isRegister ? "Crea tu cuenta" : "Iniciar sesión"}</h2>
        {isRegister ? (
          <>
            <TextField name="register-name" label="Nombre" placeholder="Ej: Fabian" autoComplete="name" value={registerName} onChange={onRegisterNameChange} required />
            <TextField name="register-email" label="Correo electrónico" placeholder="tu@email.com" type="email" autoComplete="email" value={registerEmail} onChange={onRegisterEmailChange} required />
            <PasswordField name="register-password" label="Contraseña" placeholder="Crea una contraseña" autoComplete="new-password" value={registerPassword} onChange={onRegisterPasswordChange} visible={showRegisterPassword} onToggle={() => setShowRegisterPassword((current) => !current)} required />
            <PasswordField name="register-confirm-password" label="Confirmar contraseña" placeholder="Repite tu contraseña" autoComplete="new-password" value={registerConfirmPassword} onChange={onRegisterConfirmPasswordChange} visible={showRegisterConfirmPassword} onToggle={() => setShowRegisterConfirmPassword((current) => !current)} required />
          </>
        ) : (
          <>
            <TextField name="login-email" label="Correo electrónico" placeholder="tu@email.com" type="email" autoComplete="username" value={loginEmail} onChange={onLoginEmailChange} required />
            <PasswordField name="login-password" label="Contraseña" placeholder="Ingresa tu contraseña" autoComplete="current-password" value={loginPassword} onChange={onLoginPasswordChange} visible={showLoginPassword} onToggle={() => setShowLoginPassword((current) => !current)} required />
          </>
        )}
        <p className="eyebrow">{message}</p>
        <button className="button" type="submit" disabled={isBusy}>
          {isRegister ? <UserPlus size={17} /> : <Lock size={17} />}
          {isBusy ? (isRegister ? "Creando cuenta..." : "Iniciando sesión...") : isRegister ? "Crear cuenta" : "Iniciar sesión"}
        </button>
        {!isRegister ? (
          <button className="tab" type="button" onClick={onForgotPassword}>
            ¿Olvidaste tu contraseña?
          </button>
        ) : null}
        <div className="socials">
          <button className="button secondary" type="button" aria-label="Google">G</button>
          <button className="button secondary" type="button" aria-label="Apple">A</button>
          <button className="button secondary" type="button" aria-label="Correo"><Mail size={17} /></button>
        </div>
        <button className="tab" type="button" onClick={onSwitch}>
          {isRegister ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crear cuenta"}
        </button>
      </form>
    </section>
  );
}

function PasswordRecoveryScreen({
  email,
  message,
  isBusy,
  onEmailChange,
  onSubmit,
  onBack,
}: {
  email: string;
  message: string;
  isBusy: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (data: FormData) => void;
  onBack: () => void;
}) {
  return (
    <section className="login-shell">
      <div className="login-logo">
        <div className="brand-mark">
          <Dumbbell size={28} />
        </div>
        <div>
          <h1>Organizatech</h1>
          <p className="eyebrow">Recupera el acceso a tu cuenta.</p>
        </div>
      </div>
      <form className="card form-grid" action={onSubmit} autoComplete="on">
        <h2>Recuperar contraseña</h2>
        <p className="eyebrow">Ingresa tu correo y enviaremos las instrucciones si la cuenta existe.</p>
        <TextField name="recovery-email" label="Correo electrónico" placeholder="tu@email.com" type="email" autoComplete="username" value={email} onChange={onEmailChange} required />
        <p className="eyebrow">{message}</p>
        <button className="button" type="submit" disabled={isBusy}>
          <Mail size={17} />
          {isBusy ? "Enviando enlace..." : "Enviar enlace"}
        </button>
        <button className="tab" type="button" onClick={onBack}>
          Volver a iniciar sesión
        </button>
      </form>
    </section>
  );
}

function RecoveryExpiredScreen({
  message,
  onRequestNewLink,
}: {
  message: string;
  onRequestNewLink: () => void;
}) {
  return (
    <section className="login-shell">
      <div className="login-logo">
        <div className="brand-mark">
          <Dumbbell size={28} />
        </div>
        <div>
          <h1>Organizatech</h1>
          <p className="eyebrow">Recupera el acceso a tu cuenta.</p>
        </div>
      </div>
      <div className="card form-grid">
        <h2>Enlace expirado</h2>
        <p className="eyebrow">{message || "El enlace de recuperación expiró o ya fue utilizado."}</p>
        <p className="eyebrow">Solicita un nuevo enlace para restablecer tu contraseña.</p>
        <button className="button" type="button" onClick={onRequestNewLink}>
          <Mail size={17} />
          Solicitar nuevo enlace
        </button>
      </div>
    </section>
  );
}

function NewPasswordScreen({
  password,
  confirmPassword,
  message,
  isBusy,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}: {
  password: string;
  confirmPassword: string;
  message: string;
  isBusy: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (data: FormData) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  return (
    <section className="login-shell">
      <div className="login-logo">
        <div className="brand-mark">
          <Dumbbell size={28} />
        </div>
        <div>
          <h1>Organizatech</h1>
          <p className="eyebrow">Define una nueva contraseña.</p>
        </div>
      </div>
      <form className="card form-grid" action={onSubmit} autoComplete="off">
        <h2>Crear nueva contraseña</h2>
        <PasswordField name="new-password" label="Nueva contraseña" placeholder="Crea una contraseña" autoComplete="new-password" value={password} onChange={onPasswordChange} visible={showPassword} onToggle={() => setShowPassword((current) => !current)} required />
        <PasswordField name="new-password-confirm" label="Confirmar nueva contraseña" placeholder="Repite tu contraseña" autoComplete="new-password" value={confirmPassword} onChange={onConfirmPasswordChange} visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((current) => !current)} required />
        <p className="eyebrow">{message}</p>
        <button className="button" type="submit" disabled={isBusy}>
          <Save size={17} />
          {isBusy ? "Actualizando..." : "Cambiar contraseña"}
        </button>
      </form>
    </section>
  );
}

function PasswordField({
  name,
  label,
  value,
  onChange,
  placeholder = "",
  autoComplete,
  visible,
  onToggle,
  required = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  visible: boolean;
  onToggle: () => void;
  required?: boolean;
}) {
  const toggleLabel = visible ? "Ocultar contraseña" : "Mostrar contraseña";

  return (
    <label className="field password-field">
      <span>{label}</span>
      <div className="password-input-wrap">
        <input
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
        <button className="password-toggle" type="button" aria-label={toggleLabel} title={toggleLabel} onClick={onToggle}>
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </label>
  );
}

function InitialTrainingScreen({
  day,
  setDay,
  routineName,
  setRoutineName,
  rows,
  updateRow,
  addRow,
  removeRow,
  saveRoutine,
  trainingPlan,
  updateTrainingPlan,
  message,
  isBusy,
  configuredDays,
}: {
  day: string;
  setDay: (value: string) => void;
  routineName: string;
  setRoutineName: (value: string) => void;
  rows: SetupExerciseRow[];
  updateRow: (id: string, field: keyof Omit<SetupExerciseRow, "id" | "sourceExerciseId" | "exerciseLineageId">, value: string) => void;
  addRow: () => void;
  removeRow: (id: string) => void;
  saveRoutine: () => void;
  trainingPlan: TrainingPlan;
  updateTrainingPlan: (edit: TrainingPlanEdit) => void;
  message: string;
  isBusy: boolean;
  configuredDays: string[];
}) {
  const plannedDays = sortTrainingDaysByWeekOrder(
    trainingPlan.trainingDays.length > 0 ? trainingPlan.trainingDays : [day],
  );
  const remainingDays = plannedDays.filter((item) => item !== day && !configuredDays.includes(item));
  const isLastPendingDay = remainingDays.length === 0;
  const objectiveOptions = getCycleObjectiveOptions(trainingPlan.cycleType);
  const durationOptions = getCycleDurationOptions(trainingPlan.cycleType);
  const objectiveValue = getCycleObjectiveValue(trainingPlan);
  const objectiveDescription = objectiveDescriptions[objectiveValue] ?? "Este objetivo define cómo Organizatech ordenará la intención principal del bloque.";
  const durationValue = getCycleDurationValue(trainingPlan);
  const visibleMessage = message === "Modo de prueba activo." || message === "Progreso actualizado." ? "" : message;

  function toggleTrainingDay(item: string) {
    updateTrainingPlan({ type: "toggle_training_day", value: item });
  }

  function updateCycleType(value: string) {
    updateTrainingPlan({ type: "cycle_type", value });
  }

  function updateCycleObjective(value: string) {
    updateTrainingPlan({ type: "objective", value });
  }

  function updateCycleDuration(value: string) {
    updateTrainingPlan({ type: "duration", value });
  }

  return (
    <section className="setup-screen">
      <TrainingPlanSetupCard
        cycleType={trainingPlan.cycleType}
        objectiveValue={objectiveValue}
        objectiveOptions={objectiveOptions}
        objectiveDescription={objectiveDescription}
        durationValue={durationValue}
        durationOptions={durationOptions}
        plannedDays={plannedDays}
        activeDay={day}
        configuredDays={configuredDays}
        onCycleTypeChange={updateCycleType}
        onObjectiveChange={updateCycleObjective}
        onDurationChange={updateCycleDuration}
        onToggleTrainingDay={toggleTrainingDay}
      />

      <RoutineBuilderDayCard
        plannedDays={plannedDays}
        activeDay={day}
        configuredDays={configuredDays}
        onSelectDay={setDay}
      />

      <RoutineBuilderNameCard
        day={day}
        routineName={routineName}
        onRoutineNameChange={setRoutineName}
      />

      <RoutineExerciseBuilderCard
        day={day}
        rows={rows}
        isBusy={isBusy}
        isLastPendingDay={isLastPendingDay}
        message={visibleMessage}
        onRowChange={updateRow}
        onAddRow={addRow}
        onRemoveRow={removeRow}
        onSave={saveRoutine}
      />
    </section>
  );
}

function TextField({
  name,
  label,
  value,
  onChange,
  placeholder = "",
  type = "text",
  autoComplete,
  required = false,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSetupRows(): SetupExerciseRow[] {
  return Array.from({ length: 4 }, () => createSetupRow());
}

function createSetupDayState(): SetupDayState {
  return {
    routineName: "",
    rows: createSetupRows(),
  };
}

function createSetupByDay(): Record<TrainingDayLabel, SetupDayState> {
  return Object.fromEntries(
    TRAINING_DAY_LABELS.map((day) => [day, createSetupDayState()]),
  ) as Record<TrainingDayLabel, SetupDayState>;
}

function getConfiguredSetupDays(setupByDay: Record<string, SetupDayState>): string[] {
  return TRAINING_DAY_LABELS.filter((day) => setupByDay[day]?.rows.some((row) => row.name.trim()));
}

function createCycleScopedPlanInput(
  plan: TrainingPlan,
  setupByDay: Record<string, SetupDayState>,
  source: string,
): CycleScopedPlanInput | null {
  const plannedDays = sortTrainingDaysByWeekOrder(
    (plan.trainingDays.length > 0 ? plan.trainingDays : ["Lunes"])
      .filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)),
  );
  const routines = plannedDays.flatMap((day, dayIndex) => {
    const state = setupByDay[day] ?? createSetupDayState();
    const rows = state.rows.filter((row) => row.name.trim());
    if (rows.length === 0) return [];

    return [{
      name: state.routineName.trim() || day,
      sortOrder: dayIndex,
      notes: `Plan cycle-scoped 2.2AT para ${day}.`,
      days: [{
        weekIndex: 1,
        dayCode: getTrainingDayCode(day),
        sortOrder: dayIndex,
        notes: `Dia planificado: ${day}.`,
        exercises: rows.map((row, exerciseIndex) => ({
          name: row.name.trim(),
          targetSets: Math.max(1, row.sets || 1),
          targetReps: Math.max(1, row.reps || 1),
          baseWeight: readRequiredWeight(row.weight),
          sideWeight: null,
          sortOrder: exerciseIndex,
          notes: `Ejercicio planificado para ${day}.`,
          sourceLegacyExerciseId: row.exerciseLineageId ? null : row.sourceExerciseId ?? null,
          exerciseLineageId: row.exerciseLineageId ?? null,
        })),
      }],
    }];
  });
  const exerciseCount = routines.reduce(
    (total, routine) => total + routine.days.reduce((dayTotal, day) => dayTotal + day.exercises.length, 0),
    0,
  );

  if (routines.length === 0 || exerciseCount === 0) return null;

  return {
    source,
    trainingDays: plannedDays,
    exerciseCount,
    routines,
  };
}

function findCycleScopedDayForTrainingDay(
  plan: CycleScopedTrainingPlan,
  cycleId: string,
  dayCode: TrainingDayCode,
): CycleScopedDay | null {
  for (const routine of plan.routines) {
    const day = routine.days.find((item) => item.cycleId === cycleId && item.dayCode === dayCode);
    if (day) return day;
  }
  return null;
}

function getCycleDurationWeeks(plan: TrainingPlan) {
  if (plan.cycleType === "macro") return Math.max(1, plan.macroDurationMonths * 4);
  if (plan.cycleType === "meso") return Math.max(1, plan.mesoDurationWeeks);
  if (plan.cycleType === "micro") return Math.max(1, plan.microDurationWeeks);
  return 1;
}

function addDaysToDateKey(value: string, days: number) {
  const date = parseDateKeyAsLocalNoon(value);
  date.setDate(date.getDate() + days);
  return getLocalDateKey(date);
}

function normalizePersistedTrainingPlan(value: unknown): TrainingPlan {
  return normalizeTrainingPlanInput(value).plan;
}

function createTrainingCycleSnapshot(index: number, plan: TrainingPlan, exercises: ExerciseTemplate[], entries: ExerciseEntry[]): TrainingCycleSnapshot {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name: `Ciclo ${index}`,
    createdAt: entries[0]?.date ?? now,
    endedAt: now,
    plan,
    exercises,
    entries,
  };
}

function createPersistedCycleSummarySnapshot(
  plan: TrainingPlan,
  exercises: ExerciseTemplate[],
  entries: ExerciseEntry[],
  startedAt: string,
  endedAt: string,
  source: string,
): PersistedTrainingCycleSnapshot {
  const metrics = calculateWeeklyComparison(entries);
  const summary = calculateWeeklySummary(metrics, Math.max(1, ...entries.map((entry) => entry.week)));
  const activeDays = getActiveRoutineDays(exercises, plan);
  const legacyCycle = createTrainingCycleSnapshot(0, plan, exercises, entries);
  const progress = summarizeCycleProgress(legacyCycle);
  const moodSummary = summarizeCycleMood(entries);
  const suggestions = createCycleSuggestions(progress, moodSummary);

  return {
    source,
    volumeTotal: summary.volumeTotal,
    totalReps: summary.totalReps,
    weekCount: Math.max(1, ...entries.map((entry) => entry.week)),
    dayCount: activeDays.length,
    exerciseCount: exercises.length,
    startedAt,
    endedAt,
    cycleType: plan.cycleType,
    goal: getCycleObjectiveValue(plan),
    improvedExercises: progress.improved,
    stagnantExercises: progress.stagnant,
    moodSummary: {
      score: moodSummary.score > 0 ? moodSummary.score : null,
      message: moodSummary.message,
    },
    suggestions,
  };
}

function mergeTrainingPlanWithExercises(plan: TrainingPlan, exercises: ExerciseTemplate[]) {
  const routineDays = getRoutineDays(exercises);
  if (routineDays.length === 0) return plan;
  const hasDefaultDays = sameDayList(plan.trainingDays, createDefaultTrainingPlan().trainingDays);
  if (hasDefaultDays) return { ...plan, trainingDays: routineDays };
  return {
    ...plan,
    trainingDays: sortTrainingDaysByWeekOrder(
      plan.trainingDays.filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)),
    ),
  };
}

function getCycleDurationOptions(cycleType: TrainingCycleId) {
  return getTrainingPlanDurationOptions(cycleType).map((value) => ({
    value,
    label: cycleType === "macro"
      ? `${value} meses`
      : cycleType === "session"
        ? `${value} día`
        : `${value} semana${value === 1 ? "" : "s"}`,
  }));
}

function getCycleTypeTitle(plan: TrainingPlan) {
  const cycle = trainingCycles.find((item) => item.id === plan.cycleType);
  return cycle?.title ?? "Ciclo";
}

function summarizeCycleProgress(cycle: TrainingCycleSnapshot) {
  const byExercise = new Map<string, ExerciseMetrics[]>();
  for (const entry of calculateWeeklyComparison(cycle.entries)) {
    const list = byExercise.get(entry.exerciseId) ?? [];
    list.push(entry);
    byExercise.set(entry.exerciseId, list);
  }

  const improved: string[] = [];
  const stagnant: string[] = [];

  for (const values of byExercise.values()) {
    const sorted = values.sort((a, b) => a.week - b.week);
    const first = sorted[0];
    const latest = sorted.at(-1);
    if (!first || !latest) continue;

    const kgDelta = latest.weight - first.weight;
    const repsDelta = latest.totalReps - first.totalReps;
    if (kgDelta > 0 || repsDelta > 0) {
      improved.push(`${latest.exerciseName} (${kgDelta > 0 ? `+${kgDelta} kg` : ""}${kgDelta > 0 && repsDelta > 0 ? ", " : ""}${repsDelta > 0 ? `+${repsDelta} reps` : ""})`);
    } else if (kgDelta === 0 && repsDelta === 0) {
      stagnant.push(latest.exerciseName);
    }
  }

  return { improved, stagnant };
}

function summarizeCycleMood(entries: ExerciseEntry[]) {
  const values = entries
    .map((entry) => parseReadiness(entry.notes))
    .filter((value): value is ReadinessScores => Boolean(value));

  if (values.length === 0) {
    return { score: 0, message: "No hay suficientes formularios de motivación para resumir el estado de ánimo de este ciclo." };
  }

  const average = values.reduce((total, value) => total + value.motivation + value.hydration + value.sleep + value.energy, 0) / (values.length * 4);
  const rounded = Math.round(average * 10) / 10;
  const message = rounded >= 5.5
    ? `Animo estable y favorable: promedio ${rounded}/7. Buen contexto para progresar.`
    : rounded >= 4
      ? `Animo medio: promedio ${rounded}/7. Conviene cuidar descanso e hidratacion.`
      : `Animo bajo: promedio ${rounded}/7. Para el proximo ciclo prioriza recuperacion y cargas manejables.`;

  return { score: rounded, message };
}

interface ReadinessScores {
  motivation: number;
  hydration: number;
  sleep: number;
  energy: number;
}

function parseReadiness(notes: string | undefined) {
  if (!notes || notes.includes("omitido")) return null;
  const match = notes.match(/motivaci[oó]n (\d+)\/7, hidrataci[oó]n (\d+)\/7, sue(?:ño|\u00C3\u00B1o) (\d+)\/7, energ[ií]a (\d+)\/7/i);
  if (!match) return null;
  return {
    motivation: Number(match[1]),
    hydration: Number(match[2]),
    sleep: Number(match[3]),
    energy: Number(match[4]),
  };
}

function createCycleSuggestions(progress: ReturnType<typeof summarizeCycleProgress>, mood: ReturnType<typeof summarizeCycleMood>) {
  const suggestions = [
    progress.stagnant.length > 0
      ? "Revisa los ejercicios estancados y prueba subir reps antes de aumentar peso."
      : "Mantén la progresion gradual: pequeños avances sostenidos ganan ciclos completos.",
    mood.score > 0 && mood.score < 4
      ? "Planifica una primera semana mas liviana para recuperar energia y adherencia."
      : "Mantén el formulario de motivación antes de entrenar para ajustar intensidad según tu estado real.",
  ];
  return suggestions;
}

function createSetupRow(): SetupExerciseRow {
  return {
    id: createId(),
    name: "",
    sets: 0,
    reps: 0,
    weight: "",
  };
}


function calculateWeeklyCompletedTrainingDays({
  plannedDays,
  exercises,
  entries,
  sessions,
  usesCycleScopedSessions,
}: {
  plannedDays: readonly string[];
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  usesCycleScopedSessions: boolean;
}) {
  const currentWeekDates = getCurrentSantiagoWeekDates();
  const currentWeekStart = currentWeekDates.Lunes;
  const activeSessions = sessions.filter((session) => (
    session.status === "completed" &&
    !session.deletedAt &&
    (usesCycleScopedSessions
      ? getSessionEffectiveCalendarWeekStart(session) === currentWeekStart
      : session.calendarWeekStart === currentWeekStart)
  ));

  return plannedDays.reduce((completedCount, day) => {
    const dayExercises = exercises.filter((exercise) => (exercise.day ?? day) === day);
    const expectedDate = currentWeekDates[day] ?? "";
    const plannedDay = getTrainingDayCode(day);
    const session = findDashboardSessionForDay(activeSessions, dayExercises, expectedDate, plannedDay, usesCycleScopedSessions);
    const sessionEntries = session ? findDashboardEntries(session.entries, dayExercises, expectedDate, usesCycleScopedSessions) : [];
    const allMatchingEntries = usesCycleScopedSessions ? [] : findDashboardEntries(entries, dayExercises, expectedDate, false);
    const fallbackEntries = sessionEntries.length > 0 ? [] : allMatchingEntries;
    const itemEntries = usesCycleScopedSessions
      ? sessionEntries
      : sessionEntries.length > 0
        ? sessionEntries
        : fallbackEntries;
    const coverage = usesCycleScopedSessions
      ? getCycleScopedDayCoverage(dayExercises, itemEntries)
      : null;
    const status = coverage?.status ?? (Boolean(session) || fallbackEntries.length > 0 ? "completed" : "pending");

    return status === "completed" ? completedCount + 1 : completedCount;
  }, 0);
}

function getTodayTrainingNotificationContext({
  plannedDays,
  exercises,
  entries,
  sessions,
  usesCycleScopedSessions,
}: {
  plannedDays: readonly string[];
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  usesCycleScopedSessions: boolean;
}): TrainingNotificationContext | null {
  const currentWeekDates = getCurrentSantiagoWeekDates();
  const todayKey = getSantiagoDateKey(new Date());
  const todayDay = Object.entries(currentWeekDates).find(([, date]) => date === todayKey)?.[0] ?? getCalendarTrainingDay();
  if (!plannedDays.includes(todayDay)) return null;

  const dayExercises = exercises.filter((exercise) => (exercise.day ?? todayDay) === todayDay);
  if (dayExercises.length === 0) return null;

  const currentWeekStart = currentWeekDates.Lunes;
  const activeSessions = sessions.filter((session) => (
    session.status === "completed" &&
    !session.deletedAt &&
    (usesCycleScopedSessions
      ? getSessionEffectiveCalendarWeekStart(session) === currentWeekStart
      : session.calendarWeekStart === currentWeekStart)
  ));
  const plannedDay = getTrainingDayCode(todayDay);
  const session = findDashboardSessionForDay(activeSessions, dayExercises, todayKey, plannedDay, usesCycleScopedSessions);
  const sessionEntries = session ? findDashboardEntries(session.entries, dayExercises, todayKey, usesCycleScopedSessions) : [];
  const fallbackEntries = usesCycleScopedSessions ? [] : findDashboardEntries(entries, dayExercises, todayKey, false);
  const itemEntries = usesCycleScopedSessions
    ? sessionEntries
    : sessionEntries.length > 0
      ? sessionEntries
      : fallbackEntries;
  const coverage = usesCycleScopedSessions
    ? getCycleScopedDayCoverage(dayExercises, itemEntries)
    : null;
  const status = coverage?.status ?? (Boolean(session) || fallbackEntries.length > 0 ? "completed" : "pending");

  return {
    day: todayDay,
    routine: dayExercises[0]?.routine ?? todayDay,
    status: status === "completed" ? "completed" : "pending",
  };
}

function getVisibleTrainingDay(exercises: ExerciseTemplate[], current: string) {
  if (exercises.some((exercise) => exercise.day === current)) return current;

  const today = new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date());
  const normalizedToday = TRAINING_DAY_LABELS.find((day) => removeAccents(day.toLowerCase()) === removeAccents(today.toLowerCase()));
  if (normalizedToday && exercises.some((exercise) => exercise.day === normalizedToday)) return normalizedToday;

  return exercises.find((exercise) => exercise.day)?.day ?? current;
}

function getCalendarTrainingDay() {
  const today = new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date());
  const normalizedToday = TRAINING_DAY_LABELS.find((day) => removeAccents(day.toLowerCase()) === removeAccents(today.toLowerCase()));
  return normalizedToday ?? "Lunes";
}

function getLegacyWeekNumberForTrainingDate(sessions: TrainingSession[], entries: ExerciseEntry[], trainedDate: string) {
  const weekStart = getCurrentSantiagoWeekDates(parseDateKeyAsLocalNoon(trainedDate)).Lunes;
  const sameWeekSessions = sessions.filter((session) => session.calendarWeekStart === weekStart);
  if (sameWeekSessions.length > 0) {
    return Math.min(...sameWeekSessions.map((session) => session.weekNumber));
  }

  const legacySameWeek = entries.filter((entry) => getCurrentSantiagoWeekDates(parseDateKeyAsLocalNoon(entry.date)).Lunes === weekStart);
  if (legacySameWeek.length > 0) {
    return Math.min(...legacySameWeek.map((entry) => entry.week));
  }

  const previousWeeks = [
    ...sessions.filter((session) => session.calendarWeekStart && session.calendarWeekStart < weekStart).map((session) => session.weekNumber),
    ...entries.filter((entry) => entry.date < weekStart).map((entry) => entry.week),
  ];
  return previousWeeks.length > 0 ? Math.max(...previousWeeks) + 1 : 1;
}

function sameDayList(left: string[], right: string[]) {
  const normalizedLeft = sortTrainingDaysByWeekOrder(left.filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)));
  const normalizedRight = sortTrainingDaysByWeekOrder(right.filter((day) => TRAINING_DAY_LABELS.some((label) => label === day)));
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((day, index) => day === normalizedRight[index]);
}

function getPasswordRecoveryRedirectUrl() {
  if (typeof window === "undefined") return "https://organizatech.cl?flow=password-recovery";
  const url = new URL(window.location.origin);
  url.searchParams.set("flow", "password-recovery");
  return url.toString();
}

function getPasswordRecoveryCallbackAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const accessToken = hashParams.get("access_token");
  return hashParams.get("type") === "recovery" && accessToken ? accessToken : null;
}

function getPasswordRecoveryRouteState(): "none" | "active" | "expired" {
  if (typeof window === "undefined") return "none";

  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);

  const errorCode = searchParams.get("error_code") ?? hashParams.get("error_code");
  const error = searchParams.get("error") ?? hashParams.get("error");
  const errorDescription = searchParams.get("error_description") ?? hashParams.get("error_description");
  if (hasPasswordRecoveryCallbackError({ error, errorCode, errorDescription })) return "expired";

  const hadStoredRecovery = hasStoredPasswordRecoveryFlow();
  const storedRecovery = loadPasswordRecoveryFlow();
  if (hadStoredRecovery && !storedRecovery) return "expired";

  const hasRecoveryRoute =
    searchParams.get("flow") === "password-recovery" ||
    searchParams.get("type") === "recovery" ||
    hashParams.get("type") === "recovery";
  if (hasRecoveryRoute) {
    if (!storedRecovery) startPasswordRecoveryFlow();
    return "active";
  }

  if (storedRecovery) return "active";

  return "none";
}

function markPasswordRecoveryFlow() {
  if (typeof window === "undefined") return;
  startPasswordRecoveryFlow();
}

function clearPasswordRecoveryFlow() {
  if (typeof window === "undefined") return;
  clearPasswordRecoveryStorage();
}

function clearPasswordRecoveryUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("flow");
  url.searchParams.delete("type");
  url.searchParams.delete("error");
  url.searchParams.delete("error_code");
  url.searchParams.delete("error_description");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function readSetupNumber(value: string) {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readWeightInput(value: string, fallback: string) {
  return isDecimalWeightDraftInput(value) ? value : fallback;
}

function readRequiredWeight(value: string | number | "") {
  return parseDecimalWeightInput(value) ?? 0;
}

function formatReadinessNote(value: TrainingReadiness | null) {
  if (!value) return "Formulario de motivación no registrado.";
  if (value.skipped) return "Formulario de motivación omitido: usuario no quiso registrar.";
  return `Formulario de motivación: motivacion ${value.motivation}/7, hidratacion ${value.hydration}/7, sueño ${value.sleep}/7, energia ${value.energy}/7.`;
}
