"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
import { useActiveWorkoutBoundary } from "@/features/active-workout/hooks/useActiveWorkoutBoundary";
import { useActiveWorkoutDraftLifecycle } from "@/features/active-workout/hooks/useActiveWorkoutDraftLifecycle";
import { useActiveWorkoutExerciseHistory } from "@/features/active-workout/hooks/useActiveWorkoutExerciseHistory";
import type { ActiveWorkoutOperationContext } from "@/features/active-workout/model/active-workout-boundary-contract";
import {
  createActiveWorkoutReadinessContext,
  resolveActiveWorkoutRecoveryTransition,
  resolveActiveWorkoutStartTransition,
  resolvePendingReadinessLinkUpdate,
} from "@/features/active-workout/model/active-workout-controller-state";
import { TrainingCompletionSummaryScreen } from "@/features/active-workout/components/TrainingCompletionSummaryScreen";
import { TrainingReadinessScreen } from "@/features/active-workout/components/TrainingReadinessScreen";
import { TrainingStartScreen } from "@/features/active-workout/components/TrainingStartScreen";
import {
  AuthLoadingScreen,
  AuthScreen,
  NewPasswordScreen,
  PasswordRecoveryScreen,
  RecoveryExpiredScreen,
  type AuthStatusTone,
} from "@/features/auth/components/auth-screen";
import { useAuthRegistrationFormController } from "@/features/auth/hooks/use-auth-registration-form-controller";
import { useAuthRouteController } from "@/features/auth/hooks/use-auth-route-controller";
import {
  PASSWORD_RECOVERY_FLOW,
  SIGNUP_CONFIRMATION_FLOW,
  getBrowserAuthCallbackUrl,
  isCrossedSignupConfirmationCallback,
  parseAuthCallbackEvidence,
  resolveSignupConfirmationRouteState,
  resolveSignupConfirmationSessionDecision,
  type AuthCallbackEvidence,
  type SignupConfirmationRouteState,
} from "@/features/auth/model/auth-callback";
import {
  useMultiportalAuthBoundary,
  type CoachRegistrationOwner,
  type PortalResolutionOwner,
  type UserRegistrationOwner,
} from "@/features/auth/hooks/use-multiportal-auth-boundary";
import {
  buildCoachRegistrationPayload,
  buildLoginPayload,
  buildSharedCoachRegistrationPayload,
  buildUserSignupPayload,
  type CoachRegistrationSubmission,
  type AuthFieldErrors,
  type AuthFieldName,
} from "@/features/auth/model/auth-form";
import {
  DEFAULT_AUTH_ROUTE,
  type AuthAccountType,
  type AuthRouteState,
} from "@/features/auth/model/auth-route";
import {
  MULTIPORTAL_AUTH_ERROR_MESSAGE,
  SIGNUP_CONFIRMATION_INVALID_MESSAGE,
  type AuthorizedPortalAccess,
  type SignupConfirmationResult,
} from "@/features/auth/model/multiportal-auth-controller";
import {
  createUserPortalAuthorizationProof,
  hasCurrentUserPortalAuthorization,
  shouldMountAuthorizedUserPortal,
  type UserPortalAuthorizationProof,
} from "@/features/auth/model/user-portal-authorization-proof";
import {
  FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION,
  resolveUserPortalSessionRevalidation,
  type UserPortalSessionRevalidation,
} from "@/features/auth/model/user-portal-session-revalidation";
import { CoachPortalBoundary } from "@/features/coach-portal/components/coach-portal";
import {
  createCoachPortalSession,
  type CoachPortalSession,
} from "@/features/coach-portal/model/coach-portal";
import { DashboardScreen } from "@/features/dashboard/components/dashboard-screen";
import { EmptyDashboard } from "@/features/dashboard/components/empty-dashboard";
import { NotificationPanel } from "@/features/notifications/components/NotificationPanel";
import { useNotificationsController } from "@/features/notifications/hooks/useNotificationsController";
import { useProfileController } from "@/features/profile/hooks/useProfileController";
import { UserPortalShell } from "@/features/user-portal-shell/components/user-portal-shell";
import {
  createUserPortalNavigationModel,
  isUserPortalRenderableScreen,
} from "@/features/user-portal-shell/model/user-portal-navigation";
import { useLegacyCycleHistoryController } from "@/features/cycle-history/hooks/useLegacyCycleHistoryController";
import {
  coordinateAuthenticatedSessionEvent,
  createAuthenticatedSessionCoordinator,
  type AuthenticatedSessionIntent,
} from "@/features/app-shell/model/authenticated-session-coordinator";
import {
  createLoginSubmitOwnerController,
  type LoginSubmitOwner,
  type LoginSubmitOwnerController,
} from "@/features/app-shell/model/login-submit-owner";
import type { ComparisonScreenV2Props } from "@/features/progress/components/comparison-screen-v2";
import { useTrainingDataController } from "@/features/training-data/hooks/useTrainingDataController";
import type { TrainingDataRefreshResult } from "@/features/training-data/model/training-data-controller";
import {
  getNextPersistedCycleNumber,
  isCycleScopedTrainingCycle,
  isTrainingDataProfilePrepared,
  normalizeCycleScopedEntriesByCalendarWeek,
  normalizeCycleScopedSessionsByCalendarWeek,
  selectTrainingDataView,
} from "@/features/training-data/model/training-data-selectors";
import { getTrainingDataResourceValue } from "@/features/training-data/model/training-data-state";
import { useProgressController } from "@/features/progress/hooks/useProgressController";
import { ConfirmRoutineUpdateModal } from "@/features/routine-builder/components/ConfirmRoutineUpdateModal";
import { RoutineBuilderDayCard } from "@/features/routine-builder/components/RoutineBuilderDayCard";
import { RoutineBuilderNameCard } from "@/features/routine-builder/components/RoutineBuilderNameCard";
import { RoutineExerciseBuilderCard } from "@/features/routine-builder/components/RoutineExerciseBuilderCard";
import { RoutineSuccessModal } from "@/features/routine-builder/components/RoutineSuccessModal";
import {
  resolveRoutineBuilderSavePreparation,
  type RoutineBuilderSaveConfirmation,
} from "@/features/routine-builder/model/routine-builder-save";
import {
  createSetupByDay,
  createSetupDayState,
  createSetupRows,
  getVisibleTrainingDay,
  sameTrainingDayList,
  useRoutineBuilderController,
  useRoutineBuilderDraftLifecycle,
  useRoutineBuilderWorkflows,
} from "@/features/routine-builder/hooks/useRoutineBuilderController";
import { createSetupByDayFromExercises } from "@/features/routine-builder/model/routine-builder-exercise-mapping";
import type {
  RoutineBuilderCycleDeleteContext,
  RoutineBuilderOwnedOperationContext,
  RoutineBuilderRoutineSaveContext,
} from "@/features/routine-builder/model/routine-builder-operation-owner";
import { ConfirmDeleteCycleModal } from "@/features/training-plan/components/ConfirmDeleteCycleModal";
import { ConfirmNewCycleModal } from "@/features/training-plan/components/ConfirmNewCycleModal";
import { CycleManagementScreen } from "@/features/training-plan/components/CycleManagementScreen";
import { TrainingPlanSetupCard } from "@/features/training-plan/components/TrainingPlanSetupCard";
import { CycleScopedPlanBlocker } from "@/features/training-plan/components/CycleScopedPlanBlocker";
import { TRAINING_CYCLE_PRESENTATIONS as trainingCycles } from "@/features/training-plan/model/training-cycle-presentation";
import { selectTrainingPlanSources } from "@/features/training-plan/model/training-plan-sources";
import { buildProfileViewModelFromSources } from "@/lib/profile/profile-view-model";
import { NOTIFICATION_EMPTY_MESSAGE } from "@/lib/notifications/notification-selector";
import type {
  AppNotificationSection,
  NotificationOpenIntent,
  TrainingNotificationContext,
} from "@/lib/notifications/notification-types";
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
  getPasswordRecoveryClearedHref,
  hasPasswordRecoveryCallbackError,
  resolvePasswordRecoverySessionDecision,
} from "@/lib/auth/password-recovery-session";
import {
  screenLabel,
  type Screen,
} from "@/lib/navigation/app-navigation";
import { AppNavigationDrawer } from "@/features/app-shell/components/app-navigation-drawer";
import { AppScreenHeader } from "@/features/app-shell/components/app-screen-header";
import { AppShellLayout } from "@/features/app-shell/components/app-shell-layout";
import { AppTopbar } from "@/features/app-shell/components/app-topbar";
import { useAppNavigationController } from "@/features/app-shell/hooks/useAppNavigationController";
import { useAppShellController } from "@/features/app-shell/hooks/useAppShellController";
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
  startPasswordRecoveryFlow,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";
import {
  clearActiveFlow,
  clearRoutineDraft,
} from "@/lib/storage/app-flow-storage";
import {
  advanceSessionDataEpoch as createAdvancedSessionDataEpoch,
  captureSessionDataRequestToken as createSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
  resolveEffectiveAuthenticatedUser,
  type SessionDataIdentity,
  type SessionDataRequestToken,
} from "@/lib/session/session-data-epoch";
import {
  finalizeSessionOperationOwner,
  isSessionOperationOwner,
  isSessionOperationOwnerCurrent,
  releaseSessionOperationOwner,
  resolveActiveWorkoutSessionBoundary,
  resolveIncomingWorkoutDraftRecoveryScope,
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
import {
  getLatestExercisePerformanceByLineage,
  normalizeExerciseLineageId,
} from "@/lib/training/exercise-last-performance-repository";
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
  createNextTrainingPlan,
  resolveTrainingPlanSetupTransition,
  type TrainingPlanEdit,
} from "@/lib/training/training-plan-controller";
import type { TrainingCycleId } from "@/lib/training/training-cycle-id";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import {
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

const ComparisonScreenV2 = dynamic<ComparisonScreenV2Props>(
  () => import("@/features/progress/components/comparison-screen-v2")
    .then((module) => module.ComparisonScreenV2),
);

const primaryScreens: Screen[] = ["perfil", "dashboard", "entrenamiento", "comparacion", "registro-entrenamiento", "historial-ciclos"];
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

interface OrganizatechAppProps {
  trainingCyclesRepositoryEnabled?: boolean;
  trainingCyclesSnapshotSource?: "ui-main-production" | "ui-main-qa";
  trainingWorkoutReadinessV2Enabled?: boolean;
  initialAuthRoute?: AuthRouteState;
}

export function OrganizatechApp({
  trainingCyclesRepositoryEnabled = false,
  trainingCyclesSnapshotSource = "ui-main-qa",
  trainingWorkoutReadinessV2Enabled = false,
  initialAuthRoute = DEFAULT_AUTH_ROUTE,
}: OrganizatechAppProps) {
  const initialSignupConfirmationRef = useRef<SignupConfirmationSnapshot | null>(null);
  const initialSignupConfirmation = initialSignupConfirmationRef.current
    ?? getSignupConfirmationSnapshot();
  initialSignupConfirmationRef.current = initialSignupConfirmation;
  const initialPasswordRecoveryRouteStateRef = useRef<ReturnType<typeof getPasswordRecoveryRouteState> | null>(null);
  const initialPasswordRecoveryRouteState = initialPasswordRecoveryRouteStateRef.current
    ?? getPasswordRecoveryRouteState();
  initialPasswordRecoveryRouteStateRef.current = initialPasswordRecoveryRouteState;
  const initialAuthState = resolveInitialAuthState(initialPasswordRecoveryRouteState, initialAuthRoute.mode);
  const authRouteController = useAuthRouteController(initialAuthRoute);
  const multiportalAuth = useMultiportalAuthBoundary({
    initialRoute: initialAuthRoute,
    currentRoute: authRouteController.route,
    initialPasswordRecoveryActive: initialPasswordRecoveryRouteState === "active",
  });
  const [sessionName, setSessionName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [statusMessage, setStatusMessage] = useState(initialAuthState.statusMessage);
  const [authStatusTone, setAuthStatusTone] = useState<AuthStatusTone>("info");
  const [authFieldErrors, setAuthFieldErrors] = useState<AuthFieldErrors>({});
  const [dataMode, setDataMode] = useState<DataMode>("demo");
  const [supabaseSession, setSupabaseSession] = useState<SupabaseSessionState["session"]>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseSessionState["user"]>(null);
  const [coachPortalSession, setCoachPortalSession] = useState<CoachPortalSession | null>(null);
  const coachPortalSessionRef = useRef<CoachPortalSession | null>(null);
  const [userPortalAuthorizationProof, setUserPortalAuthorizationProof] =
    useState<UserPortalAuthorizationProof | null>(null);
  const userPortalAuthorizationProofRef = useRef<UserPortalAuthorizationProof | null>(null);
  const registrationForm = useAuthRegistrationFormController({
    authenticatedUserId: supabaseUser?.id ?? null,
    prepareSharedCoachRegistration: multiportalAuth.prepareSharedCoachRegistration,
    completeSharedCoachLogin: multiportalAuth.completeSharedCoachLogin,
  });
  const [isSupabaseConfiguredState, setIsSupabaseConfiguredState] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(initialAuthState.isAuthLoading);
  const [isBusy, setIsBusy] = useState(false);
  const passwordUpdateSuccessRef = useRef(false);
  const passwordRecoveryUserIdRef = useRef<string | null>(null);
  const passwordRecoveryUpdateOwnerRef = useRef<SessionOperationOwner | null>(null);
  const passwordRecoveryStateRef = useRef<"none" | "pending" | "confirmed" | "invalid">("none");
  const signupConfirmationStateRef = useRef<"none" | "pending" | "completed" | "invalid">(
    initialSignupConfirmation.routeState === "active"
      ? "pending"
      : initialSignupConfirmation.routeState === "invalid" ? "invalid" : "none",
  );
  const [isPasswordRecoveryConfirmed, setIsPasswordRecoveryConfirmed] = useState(false);
  const [dashboardDayOverride, setDashboardDayOverride] = useState("");
  // P3-32: el estado data/loading/error, las request-key refs y los effects de historial del
  // ejercicio activo son propiedad exclusiva de useActiveWorkoutExerciseHistory (ver más abajo).
  const activeBrowserStorageScopeRef = useRef<BrowserStorageScope | null>(null);
  const sessionDataEpochRef = useRef(createSessionDataEpoch());
  const sessionDataMountedRef = useRef(true);
  const authenticatedSessionCoordinatorRef = useRef(createAuthenticatedSessionCoordinator());
  const interactiveAuthAttemptRef = useRef(false);
  const loginSubmitOwnerRef = useRef<LoginSubmitOwnerController | null>(null);
  const logoutInFlightRef = useRef(false);

  const captureSessionDataRequestToken = useCallback((): SessionDataRequestToken => {
    return createSessionDataRequestToken(sessionDataEpochRef.current);
  }, []);

  const isSessionDataRequestCurrent = useCallback((token: SessionDataRequestToken) => {
    return sessionDataMountedRef.current &&
      isSessionDataRequestTokenCurrent(sessionDataEpochRef.current, token);
  }, []);

  const routineBuilder = useRoutineBuilderController({
    identity: {
      captureRequestToken: captureSessionDataRequestToken,
      isRequestTokenCurrent: isSessionDataRequestCurrent,
    },
    dataMode,
  });
  const routineBuilderRef = useRef(routineBuilder);
  routineBuilderRef.current = routineBuilder;
  const {
    saveInitialRoutine,
    startNewTrainingCycle,
    deleteCurrentTrainingCycle,
  } = useRoutineBuilderWorkflows(routineBuilder, {
    saveInitialRoutine: executeRoutineSaveAdapter,
    startNewTrainingCycle: executeCycleCreateAdapter,
    deleteCurrentTrainingCycle: executeCycleDeleteAdapter,
    onFinalized(operation) {
      setIsBusy(false);
      if (operation === "cycle-create") routineBuilder.closeModal("new-cycle-confirm");
    },
    onUnexpectedError(operation, error) {
      if (operation === "routine-save") handlePersistenceError(error);
      else setStatusMessage(translateTrainingCycleRepositoryError(error));
    },
  });
  const {
    activeDay: setupDay,
    setupByDay,
    draftPlan,
    activeRoutineDay,
    isEditingRoutinePlan,
    routineEditorReturnScreen,
    notice: routineNotice,
    isNewCycleConfirmOpen,
    isDeleteCycleConfirmOpen,
    isRoutineSuccessOpen,
    isRoutineUpdateConfirmOpen,
  } = routineBuilder;
  const trainingPlan = draftPlan;

  const activeWorkoutBoundary = useActiveWorkoutBoundary({
    dataMode,
    captureRequestToken: captureSessionDataRequestToken,
    isRequestTokenCurrent: isSessionDataRequestCurrent,
  }, {
    start: startTrainingCommand,
    submitReadiness: submitReadinessCommand,
    complete: completeWorkoutCommand,
    resumeOrRestore: resumeOrRestoreActiveWorkoutCommand,
  });
  const activeWorkoutState = activeWorkoutBoundary.state;
  const activeWorkoutActions = activeWorkoutBoundary.controllerActions;
  const {
    activeExerciseIndex, exerciseDrafts, readiness, checkingDailyReadiness,
    savingDailyReadiness, dailyReadinessError, hasStartedTraining,
    activeWorkoutStartedAt, activeWorkoutAttemptId, trainingCompletionSummary,
  } = activeWorkoutState;

  const abortWorkoutStartState = activeWorkoutBoundary.abortStart;
  const discardActiveWorkoutState = activeWorkoutBoundary.discard;

  const advanceSessionDataIdentity = useCallback((
    identity: SessionDataIdentity,
    options: { force?: boolean } = {},
  ) => {
    const current = sessionDataEpochRef.current;
    const next = createAdvancedSessionDataEpoch(current, identity, options);
    if (next === current) return false;

    routineBuilderRef.current.invalidateOperations();
    activeWorkoutBoundary.invalidateOperations();
    sessionDataEpochRef.current = next;
    setIsBusy(false);
    // P3-32: ya no se limpian aquí las request keys de historial. Viven dentro del coordinador y su
    // invalidación ante un cambio de identidad la garantiza el SessionDataRequestToken capturado
    // antes del await: aunque la request key coincidiera por accidente entre dos usuarios, el token
    // deja de ser vigente y el resultado se descarta. Ver runActiveWorkoutHistoryLoad.
    return true;
  }, [activeWorkoutBoundary]);

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
  const {
    displayTrainingPlan,
  } = selectTrainingPlanSources(draftPlan, trainingDataView);
  const displayExercises = trainingDataView.exercises;
  const displayEntries = trainingDataView.entries;
  const displayTrainingSessions = trainingDataView.sessions;
  const isCycleScopedActiveCycle = trainingDataView.isCycleScoped;
  const isCycleScopedPlanBlocked = trainingDataView.mode === "blocked";
  const cycleScopedPlanBlockerMessage = trainingDataView.blockerMessage;
  const appShell = useAppShellController();
  const navigation = useAppNavigationController(initialAuthState.screen, {
    dataMode,
    userId: supabaseUser?.id,
    activeStorageScope: activeBrowserStorageScopeRef.current,
    hasRoutinePlan: exercises.length > 0,
    isEditingRoutinePlan,
    hasStartedTraining,
    readiness,
  });
  const { screen } = navigation;
  const hasSupabaseSession = Boolean(
    supabaseSession && supabaseUser && supabaseSession.user.id === supabaseUser.id,
  );
  const hasCurrentUserPortalAuthorizationProof = hasCurrentUserPortalAuthorization({
    authorizationProof: userPortalAuthorizationProof,
    sessionUserId: supabaseSession?.user.id,
    authenticatedUserId: supabaseUser?.id,
  });
  const canEditProfilePersonalData = Boolean(hasSupabaseSession && getSupabaseBrowserClient());
  const activeFeatureStorageScope = getBrowserStorageScope(dataMode, supabaseUser?.id);
  const trainingDataPrepared = isTrainingDataProfilePrepared(trainingDataState);
  const profileBoundary = useProfileController({
    identity: trainingDataIdentityPort,
    enabled: canEditProfilePersonalData,
    dataMode,
    trainingDataPrepared,
    screen,
  });
  const {
    profilePersonalData,
    profilePersonalDataLoading,
    profilePersonalDataError,
    profileAvatar,
    profileAvatarLoading,
    profileAvatarError,
    profileAvatarResetKey,
    refreshProfilePersonalData,
    refreshProfileAvatar,
    handleSaveProfilePersonalData,
    handleUploadProfileAvatar,
    handleProfileAvatarImageError,
  } = profileBoundary;
  const legacyCycleHistoryBoundary = useLegacyCycleHistoryController({
    identity: trainingDataIdentityPort,
    scope: activeFeatureStorageScope,
  });
  const {
    cycleHistory,
    legacyCycleHistoryCount,
    nextLegacyCycleNumber,
    appendCompletedCycle,
  } = legacyCycleHistoryBoundary;
  const {
    isMenuOpen,
    isNotificationPanelOpen,
    isTopbarHidden,
  } = appShell;
  useActiveWorkoutDraftLifecycle({
    boundary: activeWorkoutBoundary,
    screen,
    dataMode,
    userId: supabaseUser?.id,
    activeStorageScope: activeBrowserStorageScopeRef.current,
    activeRoutineDay,
  });

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
    const controller = createLoginSubmitOwnerController();
    loginSubmitOwnerRef.current = controller;
    return () => {
      controller.dispose();
      if (loginSubmitOwnerRef.current === controller) loginSubmitOwnerRef.current = null;
    };
  }, []);

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

  function setAuthStatus(message: string, tone: AuthStatusTone) {
    setStatusMessage(message);
    setAuthStatusTone(tone);
  }

  function setAuthFieldError(field: AuthFieldName, message: string) {
    setAuthFieldErrors({ [field]: message });
    setAuthStatus("", "info");
  }

  function clearAuthFieldError(field: AuthFieldName) {
    setAuthFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function invalidateSignupConfirmation() {
    signupConfirmationStateRef.current = "invalid";
    clearSignupConfirmationUrl();
    setIsBusy(false);
    setIsAuthLoading(false);
    authRouteController.replace({ mode: "login", accountType: "usuario" });
    navigation.transition(createAuthNavigationReset("login", "signup-confirmation-completed"));
    setAuthStatus(
      SIGNUP_CONFIRMATION_INVALID_MESSAGE,
      "error",
    );
  }

  function publishSignupConfirmationResult(
    result: Exclude<SignupConfirmationResult, { state: "stale" }>,
    storageScope: BrowserStorageScope | null,
  ) {
    signupConfirmationStateRef.current = result.state === "confirmed" ? "completed" : "invalid";
    clearSignupConfirmationUrl();
    clearUserSessionState("", storageScope, { navigate: false });
    clearAuthForms();
    authRouteController.replace({
      mode: "login",
      accountType: result.requestedPortal,
    });
    navigation.transition(createAuthNavigationReset("login", "signup-confirmation-completed"));
    setIsBusy(false);
    setIsAuthLoading(false);
    setAuthStatus(result.message, result.state === "confirmed" ? "success" : "error");
  }

  function completeSignupConfirmationSession(
    authState: SupabaseSessionState,
    forceInvalid = false,
  ) {
    clearSignupConfirmationUrl();
    void multiportalAuth.completeSignupConfirmation(authState, forceInvalid)
      .then((result) => {
        if (
          result === "stale"
          && signupConfirmationStateRef.current === "pending"
        ) {
          invalidateSignupConfirmation();
        }
      })
      .catch(() => {
        invalidateSignupConfirmation();
      });
  }

  function beginPasswordRecoveryPortalSession() {
    replaceUserPortalAuthorizationProof(null);
    const becameActive = multiportalAuth.beginPasswordRecoveryPortalGuard();
    authenticatedSessionCoordinatorRef.current.reset();
    replaceCoachPortalSession(null);
    if (!becameActive) return false;

    loginSubmitOwnerRef.current?.invalidate();
    interactiveAuthAttemptRef.current = false;
    resetUserScopedTransientState();
    setSupabaseSession(null);
    setSupabaseUser(null);
    setSessionName("");
    setDataMode("demo");
    return true;
  }

  function confirmPasswordRecoverySession(session: SupabaseSessionState["session"]) {
    beginPasswordRecoveryPortalSession();
    clearPasswordRecoveryUrl();
    const recoveryUserId = normalizePasswordRecoveryUserId(session?.user.id);
    if (!recoveryUserId) {
      invalidatePasswordRecoverySession();
      return;
    }

    passwordRecoveryUserIdRef.current = recoveryUserId;
    passwordRecoveryStateRef.current = "confirmed";
    setIsPasswordRecoveryConfirmed(true);
    confirmPasswordRecoveryFlow();
    setIsAuthLoading(false);
    setAuthStatus(resolveInitialAuthStatusMessage("active"), "info");
    navigation.transition(resolvePasswordRecoveryRouteTransition("active"));
  }

  function invalidatePasswordRecoverySession() {
    beginPasswordRecoveryPortalSession();
    passwordRecoveryUserIdRef.current = null;
    passwordRecoveryUpdateOwnerRef.current = null;
    passwordRecoveryStateRef.current = "invalid";
    setIsPasswordRecoveryConfirmed(false);
    clearPasswordRecoveryFlow();
    clearPasswordRecoveryUrl();
    setIsBusy(false);
    setIsAuthLoading(false);
    setAuthStatus(resolveInitialAuthStatusMessage("expired"), "error");
    navigation.transition(resolvePasswordRecoveryRouteTransition("expired"));
  }

  function finalizePasswordRecoveryToLogin(
    message: string,
    statusTone: AuthStatusTone,
    storageScope: BrowserStorageScope | null,
  ) {
    multiportalAuth.releasePasswordRecoveryPortalGuard();
    clearPasswordRecoveryUrl();
    const clearedSession = clearUserSessionState(message, storageScope, { statusTone });
    if (clearedSession) return;

    passwordRecoveryUserIdRef.current = null;
    passwordRecoveryUpdateOwnerRef.current = null;
    passwordRecoveryStateRef.current = "none";
    setIsPasswordRecoveryConfirmed(false);
    clearPasswordRecoveryFlow();
    clearAuthForms();
    setIsBusy(false);
    setIsAuthLoading(false);
    authRouteController.replace({ mode: "login", accountType: "usuario" });
    navigation.reset("login");
    setAuthStatus(message, statusTone);
  }

  async function closePasswordRecoverySessionLocally(
    message: string,
    statusTone: AuthStatusTone,
    storageScope = activeBrowserStorageScopeRef.current,
  ): Promise<boolean> {
    clearPasswordRecoveryUrl();
    const { error } = await multiportalAuth.signOutPasswordRecoveryLocally();
    if (error) {
      setIsBusy(false);
      setIsAuthLoading(false);
      setAuthStatus(translateAuthError(error), "error");
      return false;
    }
    finalizePasswordRecoveryToLogin(message, statusTone, storageScope);
    return true;
  }

  function completePasswordRecoveryUpdate(storageScope: BrowserStorageScope | null): boolean {
    if (!passwordUpdateSuccessRef.current) return false;

    passwordUpdateSuccessRef.current = false;
    setNewPassword("");
    setNewPasswordConfirm("");
    finalizePasswordRecoveryToLogin(
      "Contraseña actualizada correctamente. Ya puedes iniciar sesión.",
      "success",
      storageScope,
    );
    return true;
  }

  function holdPasswordRecoverySessionEvent(
    event: string,
    session: SupabaseSessionState["session"],
    recoveryCallbackAccessToken: string | null,
  ): boolean {
    if (event === "PASSWORD_RECOVERY") {
      markPasswordRecoveryFlow();
      beginPasswordRecoveryPortalSession();
    }
    if (!multiportalAuth.isPasswordRecoveryPortalBlocked() || event === "SIGNED_OUT") {
      return false;
    }

    const recoveryState = getPasswordRecoveryRouteState();
    const storedRecovery = loadPasswordRecoveryFlow();
    const recoveryEvent =
      event === "PASSWORD_RECOVERY"
      || event === "INITIAL_SESSION"
      || event === "SIGNED_IN"
      || event === "TOKEN_REFRESHED"
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
      confirmedRecoveryUserId: passwordRecoveryUserIdRef.current,
    });
    if (recoveryDecision === "invalid") {
      invalidatePasswordRecoverySession();
      return true;
    }
    if (recoveryDecision === "confirmed") {
      confirmPasswordRecoverySession(session);
      return true;
    }

    passwordRecoveryStateRef.current = "pending";
    setIsPasswordRecoveryConfirmed(false);
    setIsAuthLoading(true);
    setAuthStatus(resolveInitialAuthStatusMessage("none"), "info");
    navigation.transition(resolvePasswordRecoveryRouteTransition("active"));
    return true;
  }

  useEffect(() => {
    let isMounted = true;
    const recoveryCallbackAccessToken = getPasswordRecoveryCallbackAccessToken();
    const supabase = getSupabaseBrowserClient();

    async function bootstrapSession() {
      let requestToken = captureSessionDataRequestToken();
      const recoveryState = initialPasswordRecoveryRouteState;
      const signupConfirmationRouteState = initialSignupConfirmation.routeState;
      if (signupConfirmationRouteState === "invalid") {
        invalidateSignupConfirmation();
        return;
      }
      if (signupConfirmationRouteState === "active") {
        signupConfirmationStateRef.current = "pending";
        setIsAuthLoading(true);
        setAuthStatus("Confirmando tu correo...", "info");
      } else if (recoveryState === "expired") {
        invalidatePasswordRecoverySession();
        return;
      } else if (recoveryState === "active") {
        beginPasswordRecoveryPortalSession();
        markPasswordRecoveryFlow();
        passwordRecoveryUserIdRef.current = null;
        passwordRecoveryStateRef.current = "pending";
        setIsPasswordRecoveryConfirmed(false);
        setIsAuthLoading(true);
        setAuthStatus(resolveInitialAuthStatusMessage("none"), "info");
      } else {
        setIsAuthLoading(true);
        setAuthStatus(resolveInitialAuthStatusMessage("none"), "info");
      }
      try {
        const authState = await getInitialSupabaseSession();
        if (!isMounted || !isSessionDataRequestCurrent(requestToken)) return;

        if (signupConfirmationRouteState === "active") {
          const signupDecision = resolveSignupConfirmationSessionDecision({
            routeState: signupConfirmationRouteState,
            event: "bootstrap",
            callbackAccessToken: initialSignupConfirmation.evidence.accessToken,
            sessionAccessToken: authState.session?.access_token ?? null,
            sessionUserId: authState.session?.user.id ?? null,
          });
          if (signupDecision === "invalid") {
            invalidateSignupConfirmation();
            return;
          }
          if (signupDecision === "complete") {
            applySessionState(authState);
            requestToken = captureSessionDataRequestToken();
            completeSignupConfirmationSession(authState);
            return;
          }
        }

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
          confirmedRecoveryUserId: passwordRecoveryUserIdRef.current,
        });
        if (recoveryDecision === "invalid") {
          invalidatePasswordRecoverySession();
          return;
        }
        if (recoveryDecision === "confirmed") {
          confirmPasswordRecoverySession(authState.session);
          return;
        }
        if (recoveryDecision === "pending") {
          beginPasswordRecoveryPortalSession();
          passwordRecoveryStateRef.current = "pending";
          setIsPasswordRecoveryConfirmed(false);
          setIsAuthLoading(true);
          return;
        }

        applySessionState(authState);
        requestToken = captureSessionDataRequestToken();
        if (authState.session) {
          const portalDecision = multiportalAuth.resolveInitialSessionDecision(authState.session.user.id);
          if (
            portalDecision === "hold_user_registration"
            || portalDecision === "hold_coach_registration"
          ) {
            multiportalAuth.completeInitialResolution();
            setIsAuthLoading(false);
            setAuthStatus("", "info");
            return;
          }
          if (portalDecision === "authorize_user" || portalDecision === "authorize_coach") {
            const requestedPortal = portalDecision === "authorize_coach" ? "coach" : "usuario";
            const resolutionOwner = multiportalAuth.beginPortalResolution(authState.session.user.id);
            try {
              await authorizeAndContinuePortalSession(
                authState,
                requestedPortal,
                "restore-active-flow",
                resolutionOwner,
                FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION,
              );
            } finally {
              multiportalAuth.endPortalResolution(resolutionOwner);
              multiportalAuth.completeInitialResolution();
            }
            return;
          }
          await continueAuthenticatedSession(authState, "restore-active-flow");
        } else {
          setAuthStatus(authState.isConfigured ? "Continúa con tu progreso." : getMissingSupabaseMessage(), "info");
        }
      } catch (error) {
        if (isMounted && isSessionDataRequestCurrent(requestToken)) {
          if (signupConfirmationRouteState === "active") {
            signupConfirmationStateRef.current = "invalid";
            setIsAuthLoading(false);
            setAuthStatus(translateAuthError(error), "error");
          } else if (recoveryState === "active") {
            const storedRecovery = loadPasswordRecoveryFlow();
            const recoveryDecision = resolvePasswordRecoverySessionDecision({
              routeState: recoveryState,
              event: "bootstrap",
              sessionLookup: "error",
              sessionUserId: null,
              hasCallbackEvidence: Boolean(recoveryCallbackAccessToken),
              callbackMatchesSession: false,
              storedRecoveryStatus: storedRecovery?.status ?? null,
              confirmedRecoveryUserId: passwordRecoveryUserIdRef.current,
            });
            passwordRecoveryStateRef.current = recoveryDecision;
            setIsPasswordRecoveryConfirmed(false);
            setIsAuthLoading(true);
            setAuthStatus(resolveInitialAuthStatusMessage("none"), "info");
          } else {
            setAuthStatus(translateAuthError(error), "error");
          }
        }
      } finally {
        multiportalAuth.completeInitialResolution();
        if (isMounted && isSessionDataRequestCurrent(requestToken)) {
          setIsAuthLoading(
            passwordRecoveryStateRef.current === "pending"
            || signupConfirmationStateRef.current === "pending",
          );
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

      const portalEventDecision = multiportalAuth.resolveSessionEventDecision(
        event,
        session?.user.id ?? null,
        interactiveAuthAttemptRef.current,
      );
      if (portalEventDecision === "complete_signup_confirmation") {
        const confirmation = multiportalAuth.consumeSignupConfirmationResult();
        if (confirmation) {
          publishSignupConfirmationResult(confirmation, previousStorageScope);
        } else {
          invalidateSignupConfirmation();
        }
        return;
      }

      if (
        initialSignupConfirmation.routeState === "invalid"
        && isCrossedSignupConfirmationCallback(initialSignupConfirmation.evidence)
        && (
          event === "SIGNED_IN"
          || event === "INITIAL_SESSION"
          || event === "PASSWORD_RECOVERY"
        )
      ) {
        const callbackMatchesSession = Boolean(
          initialSignupConfirmation.evidence.accessToken
          && initialSignupConfirmation.evidence.accessToken === session?.access_token,
        );
        if (session && callbackMatchesSession) {
          holdSignupConfirmationSession(event, nextState, true);
        } else {
          invalidateSignupConfirmation();
        }
        return;
      }

      const signupConfirmationRouteState = signupConfirmationStateRef.current === "pending"
        ? initialSignupConfirmation.routeState
        : "none";
      if (signupConfirmationRouteState !== "none") {
        if (
          event === "SIGNED_IN"
          || event === "INITIAL_SESSION"
          || event === "PASSWORD_RECOVERY"
        ) {
          const signupDecision = resolveSignupConfirmationSessionDecision({
            routeState: signupConfirmationRouteState,
            event,
            callbackAccessToken: initialSignupConfirmation.evidence.accessToken,
            sessionAccessToken: session?.access_token ?? null,
            sessionUserId: session?.user.id ?? null,
          });
          if (signupDecision === "complete") {
            holdSignupConfirmationSession(event, nextState);
            return;
          }
          if (signupDecision === "invalid") {
            const callbackMatchesSession = Boolean(
              initialSignupConfirmation.evidence.accessToken
              && initialSignupConfirmation.evidence.accessToken === session?.access_token,
            );
            if (event === "PASSWORD_RECOVERY" && session && callbackMatchesSession) {
              holdSignupConfirmationSession(event, nextState, true);
            } else {
              invalidateSignupConfirmation();
            }
            return;
          }
        }
        if (event !== "SIGNED_OUT") return;
      }
      if (holdPasswordRecoverySessionEvent(event, session, recoveryCallbackAccessToken)) {
        return;
      }
      if (portalEventDecision === "defer") return;
      if (
        portalEventDecision === "hold_user_registration" ||
        portalEventDecision === "hold_coach_registration" ||
        portalEventDecision === "authorize_user" ||
        portalEventDecision === "authorize_coach"
      ) {
        setIsAuthLoading(false);
        if (
          portalEventDecision === "hold_user_registration"
          || portalEventDecision === "hold_coach_registration"
        ) {
          holdAuthenticatedSessionWithoutContinuation(event, nextState);
          setAuthStatus("", "info");
          return;
        }

        const requestedPortal = portalEventDecision === "authorize_coach" ? "coach" : "usuario";
        const userPortalSessionRevalidation = resolveUserPortalSessionRevalidation({
          event,
          authorizationProof: userPortalAuthorizationProofRef.current,
          nextSessionUserId: nextState.session?.user.id,
          nextAuthenticatedUserId: resolveEffectiveAuthenticatedUser(
            nextState.session,
            nextState.user,
          )?.id,
          requestedPortal,
          isInteractiveAuthAttempt: interactiveAuthAttemptRef.current,
          isPasswordRecoveryBlocked: multiportalAuth.isPasswordRecoveryPortalBlocked(),
          isLogoutInFlight: logoutInFlightRef.current,
          hasCoachPortalSession: Boolean(coachPortalSessionRef.current),
        });
        replaceUserPortalAuthorizationProof(userPortalSessionRevalidation.authorizationProof);
        const resolutionOwner = multiportalAuth.beginPortalResolution(session!.user.id);
        queueMicrotask(() => {
          void authorizeAndContinuePortalSession(
            nextState,
            requestedPortal,
            "dashboard",
            resolutionOwner,
            userPortalSessionRevalidation,
          )
            .finally(() => {
              multiportalAuth.endPortalResolution(resolutionOwner);
            });
        });
        return;
      }

      if (event === "SIGNED_OUT") {
        loginSubmitOwnerRef.current?.invalidate();
        interactiveAuthAttemptRef.current = false;
        const portalSignOutMessage = multiportalAuth.consumePortalSignOutMessage();
        if (portalSignOutMessage) {
          const sharedCoachLoginSignOut = registrationForm.controller.getState()
            .sharedCoachLoginPending;
          clearUserSessionState(portalSignOutMessage, previousStorageScope, {
            navigate: false,
            preserveAuthForms: sharedCoachLoginSignOut,
            statusTone: "error",
            forceSessionBoundary: sharedCoachLoginSignOut,
          });
          setIsBusy(false);
          setIsAuthLoading(false);
          setAuthStatus(portalSignOutMessage, "error");
          return;
        }
        if (passwordUpdateSuccessRef.current) {
          completePasswordRecoveryUpdate(previousStorageScope);
          return;
        }
        if (multiportalAuth.isPasswordRecoveryPortalBlocked()) {
          finalizePasswordRecoveryToLogin(
            "Sesión cerrada correctamente.",
            "success",
            previousStorageScope,
          );
          return;
        }
        passwordRecoveryUpdateOwnerRef.current = null;
        clearUserSessionState("Sesión cerrada correctamente.", previousStorageScope, { statusTone: "success" });
        return;
      }

      const authEventResult = coordinateAuthenticatedSessionEvent({
        event,
        state: nextState,
        currentIdentity: sessionDataEpochRef.current,
        nextIdentity: {
          userId: session?.user.id ?? null,
          scope: getBrowserStorageScope(nextState.dataMode, session?.user.id),
        },
        intent: interactiveAuthAttemptRef.current ? "dashboard" : "restore-active-flow",
        hasAuthenticatedSession: Boolean(session),
      }, {
        applySameIdentitySession: applySessionState,
        applyNewIdentitySession: (state) => {
          loginSubmitOwnerRef.current?.invalidate();
          interactiveAuthAttemptRef.current = false;
          applySessionState(state);
        },
        canContinueAfterSessionApplied: () => !multiportalAuth.isPasswordRecoveryPortalBlocked(),
        continueSession: (state, intent) => {
          passwordRecoveryUpdateOwnerRef.current = null;
          return continueAuthenticatedSession(state, intent);
        },
      });
      if (!authEventResult.proceedAfterSessionApplied) return;
      if (event === "INITIAL_SESSION" && !session) {
        setIsAuthLoading(false);
        setAuthStatus(nextState.isConfigured ? "Continúa con tu progreso." : getMissingSupabaseMessage(), "info");
      }
    }).data.subscription;

    const handlePasswordRecoveryHistoryExit = () => {
      if (!multiportalAuth.isPasswordRecoveryPortalBlocked()) return;
      void closePasswordRecoverySessionLocally("", "info");
    };
    window.addEventListener("popstate", handlePasswordRecoveryHistoryExit);

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
      window.removeEventListener("popstate", handlePasswordRecoveryHistoryExit);
    };
    // This effect owns the auth subscription lifecycle and must run once. The
    // local orchestration callbacks are intentionally captured at bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasRoutinePlanForDraft = exercises.length > 0;
  useRoutineBuilderDraftLifecycle({
    controller: routineBuilder,
    screen,
    dataMode,
    userId: supabaseUser?.id,
    activeStorageScope: activeBrowserStorageScopeRef.current,
    hasRoutinePlan: hasRoutinePlanForDraft,
  });

  useEffect(() => {
    if (screen === "training-summary" && !trainingCompletionSummary) {
      navigation.transition(createFlowScreenTransition("dashboard", "summary-state-sanitized"));
    }
    // El adaptador de transiciones solo envuelve setters estables de React; incluirlo como
    // dependencia re-ejecutaría el saneamiento en cada render sin cambiar su resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, trainingCompletionSummary]);

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
  const progressControllerSource = useMemo(() => ({
      plannedExercises: displayExercises,
      entries: metrics,
      routineDays,
      currentWeek,
    }), [currentWeek, displayExercises, metrics, routineDays]);
  const progressController = useProgressController({
    userId: sessionDataEpochRef.current.userId,
    scope: sessionDataEpochRef.current.scope,
    cycleId: persistedActiveCycle?.id ?? null,
  }, progressControllerSource);
  const progressControllerView = progressController.view;

  function dispatchProgressController(action:
    | { type: "day_selected"; day: string }
    | { type: "exercise_selected"; exerciseId: string }
    | { type: "week_selected"; week: number }
    | { type: "selection_reset" }) {
    if (action.type === "day_selected") {
      progressController.selectDay(action.day);
      return;
    }
    if (action.type === "exercise_selected") {
      progressController.selectExercise(action.exerciseId);
      return;
    }
    if (action.type === "week_selected") {
      progressController.selectWeek(action.week);
      return;
    }
    progressController.resetSelection();
  }

  const dashboardCarouselDays = hasRoutinePlan ? routineDays : TRAINING_DAY_LABELS;
  const visibleDay = getVisibleTrainingDay(displayExercises, activeRoutineDay);
  const calendarDashboardDay = getCalendarTrainingDay();
  const dashboardDay = resolveDashboardActiveDay({
    dashboardDayOverride,
    calendarDashboardDay,
    carouselDays: dashboardCarouselDays,
  });
  const dayExercises = useMemo(
    () => displayExercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay),
    [displayExercises, visibleDay],
  );
  const dashboardExercises = displayExercises.filter((exercise) => (exercise.day ?? dashboardDay) === dashboardDay);
  const activeWorkoutExercise = screen === "entrenamiento" && hasStartedTraining && readiness
    ? dayExercises[activeExerciseIndex] ?? dayExercises[0] ?? null
    : null;
  const activeWorkoutExerciseLineageId = activeWorkoutExercise?.exerciseLineageId ?? null;
  const activeWorkoutExerciseId = activeWorkoutExercise?.id ?? null;
  const activeWorkoutHistoryScope = useMemo(() => ({
    source: isCycleScopedActiveCycle ? "cycle-scoped" as const : "legacy" as const,
    cycleId: persistedActiveCycle?.id ?? null,
  }), [isCycleScopedActiveCycle, persistedActiveCycle?.id]);
  const performancePrefetchLineageIds = useMemo(
    () => dayExercises
      .map((exercise) => normalizeExerciseLineageId(exercise.exerciseLineageId))
      .filter((lineageId): lineageId is string => lineageId !== null),
    [dayExercises],
  );
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
  const visibleCycleHistoryCount = isTrainingCyclesRepositoryActive ? persistedCycleHistory.length : legacyCycleHistoryCount;
  const visibleCycleNumber = isTrainingCyclesRepositoryActive
    ? persistedActiveCycle?.cycleNumber ?? getNextPersistedCycleNumber(persistedActiveCycle, persistedCycleHistory)
    : nextLegacyCycleNumber;
  const authModeLabel = dataMode === "supabase" && hasSupabaseSession ? "Activo" : isSupabaseConfiguredState ? "Listo" : "Prueba";
  const profileViewModel = useMemo(() => buildProfileViewModelFromSources({
    personalData: profilePersonalData,
    sessionDisplayName: sessionName,
    sessionEmail: supabaseUser?.email ?? null,
    dataSource,
    canEditPersonalData: canEditProfilePersonalData,
    avatar: profileAvatar,
  }), [canEditProfilePersonalData, dataSource, profileAvatar, profilePersonalData, sessionName, supabaseUser?.email]);
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
  const notificationCatalogInput = useMemo(() => ({
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
  const notificationsBoundary = useNotificationsController({
    identity: trainingDataIdentityPort,
    scope: activeFeatureStorageScope,
    catalogInput: notificationCatalogInput,
    onOpenIntent: handleNotificationOpenIntent,
  });
  const {
    appNotifications,
    newNotifications,
    historyNotifications,
    seenNotificationRecordsById,
    notificationPanelSubtitle,
    notificationBadgeText,
    notificationBadgeAriaLabel,
    openNotificationTarget,
  } = notificationsBoundary;

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
    historyScope: activeWorkoutHistoryScope,
    performancePrefetchLineageIds,
    observationUserId: supabaseUser?.id ?? null,
    captureSessionDataRequestToken,
    isSessionDataRequestCurrent,
  });

  const resetActiveWorkoutSessionState = useCallback((incomingRecoveryScope: BrowserStorageScope | null) => {
    activeWorkoutBoundary.resetForIdentity({
      incomingRecoveryScope,
      resetHistory: resetExerciseHistory,
    });
    routineBuilderRef.current.clearNotice();
    setIsBusy(false);
  }, [activeWorkoutBoundary, resetExerciseHistory]);

  function resetUserScopedTransientState() {
    resetUserScopedTransientStateWithoutAuthForms();
    clearAuthForms();
  }

  function resetUserScopedTransientStatePreservingAuthForms() {
    resetUserScopedTransientStateWithoutAuthForms();
  }

  function resetUserScopedTransientStateWithoutAuthForms() {
    appShell.closeAll();
    routineBuilder.resetTransient();
    setDashboardDayOverride("");
    progressController.resetSelection();
    setStatusMessage("");
  }

  function replaceCoachPortalSession(session: CoachPortalSession | null) {
    if (session) replaceUserPortalAuthorizationProof(null);
    coachPortalSessionRef.current = session;
    setCoachPortalSession(session);
  }

  function replaceUserPortalAuthorizationProof(proof: UserPortalAuthorizationProof | null) {
    userPortalAuthorizationProofRef.current = proof;
    setUserPortalAuthorizationProof(proof);
  }

  function holdAuthenticatedSessionWithoutContinuation(
    event: string,
    authState: SupabaseSessionState,
  ) {
    replaceUserPortalAuthorizationProof(null);
    coordinateAuthenticatedSessionEvent({
      event,
      state: authState,
      currentIdentity: sessionDataEpochRef.current,
      nextIdentity: {
        userId: authState.session?.user.id ?? null,
        scope: getBrowserStorageScope(authState.dataMode, authState.session?.user.id),
      },
      intent: "restore-active-flow",
      hasAuthenticatedSession: Boolean(authState.session),
    }, {
      applySameIdentitySession: applySessionState,
      applyNewIdentitySession: (state) => {
        loginSubmitOwnerRef.current?.invalidate();
        interactiveAuthAttemptRef.current = false;
        applySessionState(state);
      },
      canContinueAfterSessionApplied: () => false,
      continueSession: continueAuthenticatedSession,
    });
  }

  function holdSignupConfirmationSession(
    event: string,
    authState: SupabaseSessionState,
    forceInvalid = false,
  ) {
    holdAuthenticatedSessionWithoutContinuation(event, authState);
    queueMicrotask(() => completeSignupConfirmationSession(authState, forceInvalid));
  }

  async function authorizeAndContinuePortalSession(
    authState: SupabaseSessionState,
    requestedPortal: AuthAccountType,
    intent: AuthenticatedSessionIntent,
    resolutionOwner: PortalResolutionOwner,
    sessionRevalidation: UserPortalSessionRevalidation,
  ): Promise<AuthorizedPortalAccess | null> {
    const access = await multiportalAuth.resolvePortalAccess(authState, requestedPortal, resolutionOwner);
    if (access.state === "stale" || !multiportalAuth.isPortalResolutionCurrent(resolutionOwner)) {
      return null;
    }
    if (
      access.state === "user_registration_required"
      || access.state === "coach_registration_required"
      || access.state === "error"
    ) {
      replaceUserPortalAuthorizationProof(null);
      const rejectionMessage = multiportalAuth.settlePortalSignOutMessage(access.message);
      setIsAuthLoading(false);
      if (rejectionMessage) setAuthStatus(rejectionMessage, "error");
      return null;
    }
    applySessionState(authState);
    await continueAuthorizedPortalAccess(
      access,
      authState,
      intent,
      () => multiportalAuth.isPortalResolutionCurrent(resolutionOwner),
      sessionRevalidation,
    );
    return access;
  }

  async function continueAuthorizedPortalAccess(
    access: AuthorizedPortalAccess,
    authState: SupabaseSessionState,
    intent: AuthenticatedSessionIntent,
    isAuthorizationCurrent: () => boolean,
    sessionRevalidation: UserPortalSessionRevalidation,
    clearCompletedAuthForm: () => void = clearAuthForms,
  ): Promise<void> {
    switch (access.state) {
      case "user_authorized": {
        const authorizationProof = createUserPortalAuthorizationProof({
          access,
          sessionUserId: authState.session?.user.id,
          authenticatedUserId: authState.user?.id,
        });
        if (!authorizationProof) {
          replaceUserPortalAuthorizationProof(null);
          authenticatedSessionCoordinatorRef.current.reset();
          setIsAuthLoading(false);
          setAuthStatus(MULTIPORTAL_AUTH_ERROR_MESSAGE, "error");
          return;
        }
        if (!isAuthorizationCurrent()) return;
        replaceCoachPortalSession(null);
        if (sessionRevalidation.kind === "silent_revalidation") {
          replaceUserPortalAuthorizationProof(authorizationProof);
          return;
        }
        const continuation = await continueAuthenticatedSession(
          authState,
          intent,
          clearCompletedAuthForm,
        );
        if (continuation.kind === "stale" || !isAuthorizationCurrent()) return;
        replaceUserPortalAuthorizationProof(authorizationProof);
        return;
      }
      case "coach_authorized": {
        const nextCoachPortalSession = createCoachPortalSession({
          authorizedUserId: access.userId,
          authenticatedUser: authState.user,
          registration: access.coach,
        });
        if (!nextCoachPortalSession) {
          replaceCoachPortalSession(null);
          setIsAuthLoading(false);
          setAuthStatus(MULTIPORTAL_AUTH_ERROR_MESSAGE, "error");
          return;
        }

        authenticatedSessionCoordinatorRef.current.reset();
        replaceCoachPortalSession(nextCoachPortalSession);
        setIsAuthLoading(false);
        clearCompletedAuthForm();
        setAuthStatus("", "info");
        return;
      }
    }
  }

  function continueAuthenticatedSession(
    authState: SupabaseSessionState,
    intent: AuthenticatedSessionIntent,
    clearCompletedAuthForm: () => void = clearAuthForms,
  ) {
    const requestToken = captureSessionDataRequestToken();
    if (!authState.session || !authState.user || requestToken.userId !== authState.user.id) {
      return Promise.resolve({ kind: "stale" } as const);
    }
    return authenticatedSessionCoordinatorRef.current.continueSession(
      requestToken,
      intent,
      {
        refresh: () => refreshTrainingDataForSession(authState.dataMode),
        isCurrent: isSessionDataRequestCurrent,
        onStart: () => setStatusMessage(""),
        onComplete: (completedIntent) => {
          setIsAuthLoading(false);
          clearCompletedAuthForm();
          if (
            completedIntent === "restore-active-flow" &&
            restoreActiveFlowForSession(authState.dataMode, authState.user?.id)
          ) return;
          navigation.transition(createAuthNavigationReset("dashboard", "session-established"));
        },
      },
    );
  }

  function applySessionState(authState: SupabaseSessionState) {
    const authenticatedUser = resolveEffectiveAuthenticatedUser(authState.session, authState.user);
    if (userPortalAuthorizationProofRef.current?.userId !== authenticatedUser?.id) {
      replaceUserPortalAuthorizationProof(null);
    }
    if (coachPortalSessionRef.current?.userId !== authenticatedUser?.id) {
      replaceCoachPortalSession(null);
    }
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
    if (identityChanged) {
      profileBoundary.controller.invalidateIdentity();
      notificationsBoundary.controller.invalidateIdentity();
      legacyCycleHistoryBoundary.controller.replaceIdentityScope(null);
    }
    const hasStorageScopeChanged = activeBrowserStorageScopeRef.current !== nextStorageScope;
    if (identityChanged || hasStorageScopeChanged) {
      trainingDataController.reset({
        cyclesEnabled: trainingCyclesRepositoryEnabled &&
          effectiveDataMode === "supabase" &&
          Boolean(effectiveSession),
      });
    }
    if (sessionBoundary.resetActiveWorkoutMemory) {
      const incomingRecoveryScope = resolveIncomingWorkoutDraftRecoveryScope({
        scope: nextStorageScope,
        willAttemptAutomaticRecovery: Boolean(effectiveSession),
      });
      resetActiveWorkoutSessionState(incomingRecoveryScope);
      resetUserScopedTransientState();
    }
    if (hasStorageScopeChanged) {
      routineBuilder.replaceIdentityScope(nextStorageScope);
      legacyCycleHistoryBoundary.controller.replaceIdentityScope(nextStorageScope);
      notificationsBoundary.controller.replaceIdentityScope(nextStorageScope);
      // P3-32: se conserva exactamente el alcance previo — el cambio de storage scope deja en idle
      // sólo la performance, sin tocar la observación, porque es una condición independiente del
      // reset de memoria de Active Workout.
      resetExercisePerformanceHistory();
      activeBrowserStorageScopeRef.current = nextStorageScope;
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
    options: {
      navigate?: boolean;
      preserveAuthForms?: boolean;
      statusTone?: AuthStatusTone;
      forceSessionBoundary?: boolean;
    } = {},
  ) {
    replaceUserPortalAuthorizationProof(null);
    replaceCoachPortalSession(null);
    if (
      activeBrowserStorageScopeRef.current === null &&
      sessionDataEpochRef.current.userId === null &&
      sessionDataEpochRef.current.scope === null &&
      !options.forceSessionBoundary
    ) return false;

    authenticatedSessionCoordinatorRef.current.reset();
    interactiveAuthAttemptRef.current = false;
    const signedOutIdentity = { userId: null, scope: null };
    const sessionBoundary = resolveActiveWorkoutSessionBoundary({
      currentIdentity: sessionDataEpochRef.current,
      nextIdentity: signedOutIdentity,
      event: "signed_out",
    });
    if (sessionBoundary.invalidateEpoch) {
      advanceSessionDataIdentity(signedOutIdentity, { force: sessionBoundary.forceEpochAdvance });
      profileBoundary.controller.invalidateIdentity();
      notificationsBoundary.controller.invalidateIdentity();
      legacyCycleHistoryBoundary.controller.replaceIdentityScope(null);
    }
    trainingDataController.reset({ cyclesEnabled: false });
    if (sessionBoundary.resetActiveWorkoutMemory) {
      resetActiveWorkoutSessionState(null);
    }
    if (options.preserveAuthForms) resetUserScopedTransientStatePreservingAuthForms();
    else resetUserScopedTransientState();
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
    setSessionName("");
    setDataMode("demo");
    setIsBusy(false);
    routineBuilder.replaceIdentityScope(null);
    if (options.navigate !== false) {
      authRouteController.replace({ mode: "login", accountType: "usuario" });
      navigation.reset("login");
    }
    setAuthStatus(message, options.statusTone ?? "info");
    return true;
  }

  function clearBrowserStorageScope(scope: BrowserStorageScope | null) {
    clearStoredBrowserStorageScope(scope);
  }

  function restoreActiveFlowForSession(mode: DataMode, userId?: string) {
    return navigation.restoreActiveFlow(mode, userId, {
      beforeRestoreAttempt(recoveryScope) {
        activeWorkoutBoundary.consumeIncomingRecoveryScope(recoveryScope);
      },
      restoreRoutineDraft: restoreRoutineDraftForSession,
      restoreWorkoutDraft: restoreWorkoutDraftForSession,
      clearTrainingStart: activeWorkoutActions.clearTrainingStart,
      closeMenu: appShell.closeMenu,
    });
  }

  function restoreRoutineDraftForSession(mode: DataMode, userId?: string) {
    const result = routineBuilder.restoreDraft(mode, userId);
    if (!result.restored) return false;
    setStatusMessage(result.message);
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

    routineBuilder.selectActiveRoutineDay(draft.activeRoutineDay);
    activeWorkoutBoundary.replaceRuntimeSnapshot({
      attemptId: recovery.value.activeWorkoutAttemptId,
      pendingReadinessLink: recovery.value.pendingReadinessLink,
      readinessContext: createActiveWorkoutReadinessContext({
        workoutAttemptId: recovery.value.activeWorkoutAttemptId,
        cycleId: draft.cycleId,
        cycleDayId: draft.cycleDayId,
        workoutStartedAt: recovery.value.activeWorkoutStartedAt,
        plannedDay: draft.plannedDay,
        plannedDate: draft.plannedDate,
      }),
    });
    activeWorkoutActions.recoverWorkout(recovery.value);
    routineBuilder.finishEdit();
    setStatusMessage("Recuperamos tu entrenamiento pendiente.");
    return true;
  }

  function resumeOrRestoreActiveWorkoutCommand() {
    const recoveryScope = getBrowserStorageScope(dataMode, supabaseUser?.id);
    const draft = loadWorkoutDraft(dataMode, supabaseUser?.id);
    activeWorkoutBoundary.consumeIncomingRecoveryScope(recoveryScope);
    const runtime = activeWorkoutBoundary.getRuntimeSnapshot();
    const memoryState = {
      attemptV2: trainingWorkoutReadinessV2Enabled && isCycleScopedActiveCycle,
      hasStartedTraining,
      readiness,
      activeWorkoutStartedAt,
      workoutAttemptId: runtime.attemptId ?? activeWorkoutAttemptId,
      cycleId: runtime.readinessContext?.cycleId ?? null,
      cycleDayId: runtime.readinessContext?.cycleDayId ?? null,
    };
    const decision = resolveActiveWorkoutReentryDecision(memoryState, Boolean(draft));

    if (decision === "resume-memory" && canResumeActiveWorkoutFromMemory(memoryState)) {
      return "resume-memory" as const;
    }

    if (decision === "restore-draft") {
      return restoreWorkoutDraftRecord(draft) ? "restore-draft" as const : "unavailable" as const;
    }

    return "unavailable" as const;
  }

  function restoreActiveWorkoutForNavigation() {
    return activeWorkoutBoundary.resumeOrRestore() !== "unavailable";
  }

  function applyTrainingDataRefreshResult(
    result: TrainingDataRefreshResult,
    options: { updateStatus?: boolean } = {},
  ) {
    if (result.kind === "stale") return result;
    if (result.kind === "error") {
      if (result.resource === "legacy-snapshot") {
        handlePersistenceError(result.error, { preserveSession: true });
      } else {
        setStatusMessage(translateTrainingCycleRepositoryError(result.error));
      }
      return result;
    }

    routineBuilder.reconcileTrainingDataRefresh((currentDraftPlan) => {
      const currentView = selectTrainingDataView(result.state, currentDraftPlan);
      return {
        mode: currentView.mode,
        plan: currentView.plan,
        exercises: currentView.exercises,
        hasActiveCycle: Boolean(currentView.activeCycle),
        legacyExercises: result.appData?.exercises,
      };
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
    operation: RoutineBuilderRoutineSaveContext,
  ) {
    if (activeCycle && isProtectedTrainingCycle(activeCycle)) {
      setStatusMessage(PROTECTED_ACTIVE_CYCLE_MESSAGE);
      return false;
    }

    const planInput = createCycleScopedPlanInput(plan, setupState, trainingCyclesSnapshotSource);
    if (!planInput) {
      routineBuilder.replaceDraft(plan);
      routineBuilder.replaceBuilderState({ activeDay: setupDay, setupByDay: setupState });
      routineBuilder.beginEdit();
      navigation.transition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
      setStatusMessage("Configura al menos una rutina, un dia y un ejercicio antes de crear el ciclo.");
      return false;
    }

    const plannedStartDate = getSantiagoDateKey(new Date());
    const durationWeeks = getCycleDurationWeeks(plan);
    const plannedEndDate = addDaysToDateKey(plannedStartDate, durationWeeks * 7 - 1);
    const activeCycleToClose = activeCycle?.status === "active" ? activeCycle : null;
    const nextCycleNumber = await getNextTrainingCycleNumber();
    if (!operation.isCurrent()) return false;
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
      }, operation.userId ?? undefined);
      if (!operation.isCurrent()) return false;
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
    }, operation.userId ?? undefined);
    if (!operation.isCurrent()) return false;

    routineBuilder.replaceDraft(plan);
    const refreshResult = await refreshTrainingCyclesBoundary();
    if (refreshResult.kind !== "success") return false;
    if (!operation.isCurrent()) return false;
    const refreshedView = selectTrainingDataView(refreshResult.state, plan);
    routineBuilder.selectActiveRoutineDay(getVisibleTrainingDay(refreshedView.exercises, "Lunes"));
    setDashboardDayOverride("");
    activeWorkoutActions.replaceExerciseDrafts({});
    activeWorkoutActions.clearReadiness();
    activeWorkoutActions.markTrainingStopped();
    return true;
  }

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
      clearUserSessionState(message, activeBrowserStorageScopeRef.current, { statusTone: "error" });
    }
    return message;
  }

  function handleSharedCoachLogin() {
    registrationForm.controller.beginSharedCoachLogin();
    setLoginEmail("");
    setLoginPassword("");
    setAuthFieldErrors({});
    setAuthStatus("", "info");
    authRouteController.replace({ mode: "login", accountType: "coach" });
    navigation.transition(createAuthNavigationReset("login", "auth-screen-switch"));
  }

  async function handleAuth(mode: "login" | "registro", formData: FormData) {
    replaceUserPortalAuthorizationProof(null);
    const requestedPortal = authRouteController.route.accountType;
    const isCoachRegistration = mode === "registro" && requestedPortal === "coach";
    const coachFlow = isCoachRegistration
      ? registrationForm.controller.getState().coachFlow
      : null;
    const separateCoachPreparation = isCoachRegistration && coachFlow === "separate"
      ? buildCoachRegistrationPayload(formData)
      : null;
    const sharedCoachPreparation = isCoachRegistration && coachFlow === "shared"
      ? buildSharedCoachRegistrationPayload(formData)
      : null;
    const signupPreparation = mode === "registro" && !isCoachRegistration
      ? buildUserSignupPayload(formData)
      : null;
    const loginPreparation = mode === "login" ? buildLoginPayload(formData) : null;
    const preparation = separateCoachPreparation
      ?? sharedCoachPreparation
      ?? signupPreparation
      ?? loginPreparation;
    if (!preparation) return;
    if (!preparation.ok) {
      if (mode === "registro") {
        registrationForm.controller.setFieldError(preparation.field, preparation.message);
        setAuthStatus("", "info");
      } else {
        setAuthFieldError(preparation.field, preparation.message);
      }
      return;
    }

    if (mode === "registro") registrationForm.controller.clearFieldErrors();
    else setAuthFieldErrors({});
    setAuthStatus("", "info");
    const registrationRevision = mode === "registro"
      ? registrationForm.controller.captureRevision()
      : null;

    const coachRegistrationPayload: CoachRegistrationSubmission | null =
      separateCoachPreparation?.ok
        ? { flow: "separate", ...separateCoachPreparation.payload }
        : sharedCoachPreparation?.ok
          ? { flow: "shared", registration: sharedCoachPreparation.payload }
          : null;
    const signupPayload = signupPreparation?.ok ? signupPreparation.payload : null;
    const authPayload = coachRegistrationPayload?.flow === "separate"
      ? coachRegistrationPayload.auth
      : signupPayload ?? (loginPreparation?.ok ? loginPreparation.payload : null);
    const email = authPayload?.email ?? "";
    const password = authPayload?.password ?? "";
    const name = (coachRegistrationPayload?.flow === "separate"
      ? coachRegistrationPayload.auth.options.data.display_name
      : null)
      ?? signupPayload?.options.data.display_name
      ?? "";
    const supabase = getSupabaseBrowserClient();
    let appliedIdentityToken: SessionDataRequestToken | null = null;
    let loginSubmitOwner: LoginSubmitOwner | null = null;
    let coachRegistrationSubmitOwner: CoachRegistrationOwner | null = null;
    let userRegistrationSubmitOwner: UserRegistrationOwner | null = null;
    let portalResolutionOwner: PortalResolutionOwner | null = null;

    if (!supabase) {
      if (requestedPortal === "coach") {
        setAuthStatus(MULTIPORTAL_AUTH_ERROR_MESSAGE, "error");
        return;
      }
      setSessionName(name || email.split("@")[0] || "Usuario");
      applySessionState({
        isConfigured: false,
        dataMode: "demo",
        session: null,
        user: null,
      });
      appliedIdentityToken = captureSessionDataRequestToken();
      setAuthStatus(getMissingSupabaseMessage(), "info");
      const refreshResult = await refreshTrainingDataForSession("demo");
      if (refreshResult.kind !== "success") return;
      if (!isSessionDataRequestCurrent(appliedIdentityToken)) return;
      setAuthStatus(getMissingSupabaseMessage(), "info");
      clearAuthForms();
      navigation.transition(createAuthNavigationReset("dashboard", "session-established"));
      return;
    }

    if (coachRegistrationPayload) {
      coachRegistrationSubmitOwner = multiportalAuth.beginCoachRegistrationSubmit(
        coachRegistrationPayload.flow,
      );
    } else {
      multiportalAuth.invalidateCoachRegistrationSubmits();
    }
    if (signupPayload) {
      userRegistrationSubmitOwner = multiportalAuth.beginUserRegistrationSubmit();
    } else {
      multiportalAuth.invalidateUserRegistrationSubmits();
    }

    const loginSubmitOwnerController = mode === "login" ? loginSubmitOwnerRef.current : null;
    if (mode === "login") {
      if (!loginSubmitOwnerController) return;
      loginSubmitOwner = loginSubmitOwnerController.acquire();
      if (!loginSubmitOwner) return;
    }

    interactiveAuthAttemptRef.current = true;
    setIsBusy(true);
    try {
      if (coachRegistrationPayload) {
        const registration = await multiportalAuth.registerCoach(
          coachRegistrationPayload,
          coachRegistrationSubmitOwner!,
        );
        if (
          !coachRegistrationSubmitOwner
          || !multiportalAuth.isCoachRegistrationSubmitCurrent(coachRegistrationSubmitOwner)
        ) return;
        if (
          !registrationRevision
          || !registrationForm.controller.isRevisionCurrent(registrationRevision)
        ) return;
        if (registration.state === "busy" || registration.state === "stale") return;
        if (registration.state === "coach_confirmation_required") {
          if (registrationForm.controller.resetIfCurrent(registrationRevision)) {
            setAuthStatus(registration.message, "success");
          }
          return;
        }
        if (registration.state === "error") {
          if (registration.field) {
            registrationForm.controller.setFieldError(registration.field, registration.message);
          } else {
            setAuthStatus(registration.message, "error");
          }
          return;
        }

        portalResolutionOwner = multiportalAuth.beginPortalResolution(registration.userId);
        if (!multiportalAuth.isPortalResolutionCurrent(portalResolutionOwner)) return;
        applySessionState(registration.authState);
        appliedIdentityToken = captureSessionDataRequestToken();
        await continueAuthorizedPortalAccess({
          state: "coach_authorized",
          requestedPortal: "coach",
          userId: registration.userId,
          coach: registration.coach,
        }, registration.authState, "dashboard", () => (
          multiportalAuth.isPortalResolutionCurrent(portalResolutionOwner!)
        ), FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION, () => {
          if (
            coachRegistrationSubmitOwner
            && multiportalAuth.isCoachRegistrationSubmitCurrent(coachRegistrationSubmitOwner)
          ) {
            registrationForm.controller.resetIfCurrent(registrationRevision);
          }
        });
        return;
      }

      if (signupPayload) {
        const registration = await multiportalAuth.registerUser(
          signupPayload,
          userRegistrationSubmitOwner!,
        );
        if (
          !userRegistrationSubmitOwner
          || !multiportalAuth.isUserRegistrationSubmitCurrent(userRegistrationSubmitOwner)
        ) return;
        if (
          !registrationRevision
          || !registrationForm.controller.isRevisionCurrent(registrationRevision)
        ) return;
        if (registration.state === "busy" || registration.state === "stale") return;
        if (registration.state === "user_confirmation_required") {
          if (registrationForm.controller.resetIfCurrent(registrationRevision)) {
            setAuthStatus(registration.message, "success");
          }
          return;
        }
        if (registration.state === "error") {
          if (registration.field) {
            registrationForm.controller.setFieldError(registration.field, registration.message);
          } else {
            setAuthStatus(registration.message, "error");
          }
          return;
        }

        portalResolutionOwner = multiportalAuth.beginPortalResolution(registration.userId);
        if (!multiportalAuth.isPortalResolutionCurrent(portalResolutionOwner)) return;
        applySessionState(registration.authState);
        appliedIdentityToken = captureSessionDataRequestToken();
        await continueAuthorizedPortalAccess({
          state: "user_authorized",
          requestedPortal: "usuario",
          userId: registration.userId,
        }, registration.authState, "dashboard", () => (
          multiportalAuth.isPortalResolutionCurrent(portalResolutionOwner!)
        ), FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION, () => {
          if (
            userRegistrationSubmitOwner
            && multiportalAuth.isUserRegistrationSubmitCurrent(userRegistrationSubmitOwner)
          ) {
            registrationForm.controller.resetIfCurrent(registrationRevision);
          }
        });
        return;
      }

      if (mode !== "login") return;
      const settlement = await loginSubmitOwnerController!.settle(
        loginSubmitOwner!,
        supabase.auth.signInWithPassword({ email, password }),
      );
      if (settlement.kind === "stale") return;
      if (settlement.kind === "error") throw settlement.error;
      const result = settlement.value;

      if (result.error) {
        setAuthStatus(translateAuthError(result.error), "error");
        return;
      }

      const session = result.data.session;
      const authenticatedState: SupabaseSessionState = {
        isConfigured: true,
        dataMode: session ? "supabase" : "demo",
        session,
        user: session?.user ?? null,
      };

      if (!session) {
        setAuthStatus(MULTIPORTAL_AUTH_ERROR_MESSAGE, "error");
        return;
      }

      if (registrationForm.controller.getState().sharedCoachLoginPending) {
        const sharedPreparation = await registrationForm.completeSharedCoachLogin(session.user.id);
        if (sharedPreparation.state === "busy" || sharedPreparation.state === "stale") return;
        if (sharedPreparation.state !== "authorized") {
          const rejectionMessage = multiportalAuth.settlePortalSignOutMessage(
            sharedPreparation.message,
          ) ?? sharedPreparation.message;
          setAuthStatus(rejectionMessage, "error");
          return;
        }
        applySessionState(authenticatedState);
        appliedIdentityToken = captureSessionDataRequestToken();
        authRouteController.replace({ mode: "registro", accountType: "coach" });
        navigation.transition(createAuthNavigationReset("registro", "auth-screen-switch"));
        setAuthStatus("", "info");
        return;
      }

      portalResolutionOwner = multiportalAuth.beginPortalResolution(session.user.id);
      if (!multiportalAuth.isPortalResolutionCurrent(portalResolutionOwner)) return;

      const access = await authorizeAndContinuePortalSession(
        authenticatedState,
        requestedPortal,
        "dashboard",
        portalResolutionOwner,
        FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION,
      );
      if (access) appliedIdentityToken = captureSessionDataRequestToken();
    } catch (error) {
      if (
        portalResolutionOwner
        && !multiportalAuth.isPortalResolutionCurrent(portalResolutionOwner)
      ) return;
      if (
        coachRegistrationSubmitOwner
        && !multiportalAuth.isCoachRegistrationSubmitCurrent(coachRegistrationSubmitOwner)
      ) return;
      if (
        userRegistrationSubmitOwner
        && !multiportalAuth.isUserRegistrationSubmitCurrent(userRegistrationSubmitOwner)
      ) return;
      if (appliedIdentityToken && !isSessionDataRequestCurrent(appliedIdentityToken)) return;
      setAuthStatus(translateAuthError(error), "error");
    } finally {
      const canFinalizeAuthAttempt = loginSubmitOwner && loginSubmitOwnerController
        ? loginSubmitOwnerController.finalize(loginSubmitOwner)
        : true;
      const canFinalizePortalResolution = portalResolutionOwner
        ? multiportalAuth.isPortalResolutionCurrent(portalResolutionOwner)
        : true;
      const canFinalizeCoachRegistration = coachRegistrationSubmitOwner
        ? multiportalAuth.isCoachRegistrationSubmitCurrent(coachRegistrationSubmitOwner)
        : true;
      const canFinalizeUserRegistration = userRegistrationSubmitOwner
        ? multiportalAuth.isUserRegistrationSubmitCurrent(userRegistrationSubmitOwner)
        : true;
      if (portalResolutionOwner) multiportalAuth.endPortalResolution(portalResolutionOwner);
      if (coachRegistrationSubmitOwner) {
        multiportalAuth.endCoachRegistrationSubmit(coachRegistrationSubmitOwner);
      }
      if (userRegistrationSubmitOwner) {
        multiportalAuth.endUserRegistrationSubmit(userRegistrationSubmitOwner);
      }
      if (
        canFinalizeAuthAttempt
        && canFinalizePortalResolution
        && canFinalizeCoachRegistration
        && canFinalizeUserRegistration
      ) {
        interactiveAuthAttemptRef.current = false;
        if (!appliedIdentityToken || isSessionDataRequestCurrent(appliedIdentityToken)) {
          setIsBusy(false);
        }
      }
    }
  }

  async function handlePasswordRecovery(formData: FormData) {
    const rawEmail = String(formData.get("recovery-email") || "");
    const email = rawEmail.trim().toLowerCase();
    const emailValidation = validateSignupEmail(rawEmail);
    const supabase = getSupabaseBrowserClient();

    if (!email) {
      setAuthFieldError("recovery-email", "Ingresa tu correo electr\u00f3nico.");
      return;
    }

    if (emailValidation) {
      setAuthFieldError("recovery-email", emailValidation);
      return;
    }

    if (!supabase) {
      setAuthStatus("No pudimos completar la acci\u00f3n. Intenta nuevamente.", "error");
      return;
    }

    setAuthFieldErrors({});
    setAuthStatus("", "info");
    setIsBusy(true);
    try {
      const redirectTo = getPasswordRecoveryRedirectUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        setAuthStatus(translateAuthError(error), "error");
        return;
      }
      setRecoveryEmail("");
      setAuthStatus("Si el correo est\u00e1 registrado, enviaremos un enlace para restablecer tu contrase\u00f1a.", "success");
    } catch (error) {
      setAuthStatus(translateAuthError(error), "error");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdatePassword(formData: FormData) {
    const password = String(formData.get("new-password") || "");
    const confirm = String(formData.get("new-password-confirm") || "");
    const supabase = getSupabaseBrowserClient();

    if (!password) {
      setAuthFieldError("new-password", "Crea una contrase\u00f1a.");
      return;
    }

    if (password.length < 8) {
      setAuthFieldError("new-password", "La contrase\u00f1a debe tener al menos 8 caracteres.");
      return;
    }

    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setAuthFieldError("new-password", "La contrase\u00f1a debe incluir letras y n\u00fameros.");
      return;
    }

    if (!confirm) {
      setAuthFieldError("new-password-confirm", "Confirma tu contrase\u00f1a.");
      return;
    }

    if (password !== confirm) {
      setAuthFieldError("new-password-confirm", "Las contrase\u00f1as no coinciden.");
      return;
    }

    if (!supabase) {
      setAuthStatus("No pudimos completar la acci\u00f3n. Intenta nuevamente.", "error");
      return;
    }

    setAuthFieldErrors({});
    setAuthStatus("", "info");

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
          signOut: () => multiportalAuth.signOutPasswordRecoveryLocally(),
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
        await closePasswordRecoverySessionLocally(
          resolveInitialAuthStatusMessage("expired"),
          "error",
          recoveryStorageScope,
        );
        return;
      }
      if (result.kind === "update-error") {
        passwordUpdateSuccessRef.current = false;
        await closePasswordRecoverySessionLocally(
          translateAuthError(result.error),
          "error",
          recoveryStorageScope,
        );
        return;
      }
      if (result.kind === "sign-out-error") {
        passwordUpdateSuccessRef.current = false;
        setAuthStatus(translateAuthError(result.error), "error");
        return;
      }

      completePasswordRecoveryUpdate(recoveryStorageScope);
    } catch (error) {
      passwordUpdateSuccessRef.current = false;
      if (
        !isActiveWorkoutOperationCurrent(passwordRecoveryUpdateOwnerRef, operationOwner)
      ) return;
      await closePasswordRecoverySessionLocally(
        translateAuthError(error),
        "error",
        recoveryStorageScope,
      );
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
    routineBuilder.replaceBuilderState({ activeDay, setupByDay: mapping.setupByDay });
    return true;
  }

  function navigateTo(nextScreen: Screen) {
    navigation.navigate(nextScreen, {
      hasRoutinePlan,
      prepareRoutineEditor: () => prepareRoutineBuilderStateFromExercises(exercises, activeRoutineDay),
      clearTrainingCompletionSummary: activeWorkoutActions.clearTrainingCompletionSummary,
      tryRestoreActiveWorkout: restoreActiveWorkoutForNavigation,
      clearTrainingStart: activeWorkoutActions.clearTrainingStart,
      setRoutineEditorEditing: (editing) => editing
        ? routineBuilder.beginEdit()
        : routineBuilder.finishEdit(),
      closeMenu: appShell.closeMenu,
    });
  }

  function goBack() {
    navigation.back({
      hasStartedTraining,
      hasReadiness: Boolean(readiness),
      isEditingRoutinePlan,
      hasRoutinePlan,
      routineEditorReturnScreen,
      pauseTraining: activeWorkoutBoundary.pause,
      stopTraining: activeWorkoutActions.markTrainingStopped,
      clearReadiness: activeWorkoutActions.clearReadiness,
      closeRoutineEditor: () => routineBuilder.finishEdit(),
      clearRoutineEditorReturnScreen: () => routineBuilder.setReturnDestination(null),
      closeMenu: appShell.closeMenu,
    });
  }

  function updateSetupRow(id: string, field: keyof Omit<SetupExerciseRow, "id" | "sourceExerciseId" | "exerciseLineageId">, value: string) {
    const currentRow = setupByDay[setupDay]?.rows.find((row) => row.id === id);
    if (!currentRow) return;

    if (field === "name") {
      routineBuilder.updateRow(id, { field, value });
      return;
    }
    if (field === "weight") {
      routineBuilder.updateRow(id, { field, value: readWeightInput(value, currentRow.weight) });
      return;
    }

    routineBuilder.updateRow(id, { field, value: readSetupNumber(value) });
  }

  function updateTrainingPlan(edit: TrainingPlanEdit) {
    routineBuilder.applyDraftEdit(edit);
  }

  function dispatchRoutineBuilder(action: { type: "select_day"; day: string }) {
    routineBuilder.selectRoutineDay(action.day);
  }

  function setIsNewCycleConfirmOpen(isOpen: boolean) {
    if (isOpen) routineBuilder.openModal("new-cycle-confirm");
    else routineBuilder.closeModal("new-cycle-confirm");
  }

  function setIsDeleteCycleConfirmOpen(isOpen: boolean) {
    if (isOpen) routineBuilder.openModal("delete-cycle-confirm");
    else routineBuilder.closeModal("delete-cycle-confirm");
  }

  function setIsRoutineSuccessOpen(isOpen: boolean) {
    if (isOpen) routineBuilder.openModal("routine-success");
    else routineBuilder.closeModal("routine-success");
  }

  function updateSetupRoutineName(value: string) {
    routineBuilder.renameRoutine(value);
  }

  function addSetupRow() {
    routineBuilder.addRow();
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

    routineBuilder.removeRow(id, isCycleScopedEdit);
  }

  function openRoutineEditor(day = visibleDay) {
    if (!prepareRoutineBuilderStateFromExercises(displayExercises, day)) return;
    routineBuilder.beginEdit(screen);
    if (screen === "entrenamiento") {
      activeWorkoutActions.clearTrainingStart();
    }
    appShell.closeMenu();
    navigation.transition(createFlowScreenTransition("registro-entrenamiento", "routine-editor-opened"));
  }

  function cancelRoutineUpdate() {
    const activeDays = getRoutineDays(exercises);
    const nextDay = activeDays.includes(activeRoutineDay) ? activeRoutineDay : activeDays[0] ?? "Lunes";
    if (!prepareRoutineBuilderStateFromExercises(exercises, nextDay)) return;
    clearRoutineDraft(dataMode, supabaseUser?.id);
    routineBuilder.replaceDraftTrainingDays(activeDays);
    routineBuilder.closeModal("routine-update-confirm");
    setStatusMessage("No se realizaron cambios en la rutina.");
  }

  async function executeRoutineSaveAdapter(
    confirmation: RoutineBuilderSaveConfirmation,
    operation: RoutineBuilderRoutineSaveContext,
  ) {
    const dayState = setupByDay[setupDay] ?? createSetupDayState();
    const routineName = dayState.routineName.trim() || setupDay;
    const plannedDays = sortTrainingDaysByWeekOrder(
      trainingPlan.trainingDays.length > 0 ? trainingPlan.trainingDays : [setupDay],
    );
    const currentRoutineDays = getRoutineDays(
      isTrainingCyclesRepositoryActive ? displayExercises : exercises,
    );
    const isChangingRoutineDays = hasRoutinePlan && isEditingRoutinePlan && !sameTrainingDayList(plannedDays, currentRoutineDays);
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
      routineBuilder.openModal("routine-update-confirm");
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
      routineBuilder.openModal("routine-update-confirm");
      return;
    }

    if (isTrainingCyclesRepositoryActive) {
      routineBuilder.closeModal("routine-update-confirm");
      routineBuilder.replaceBuilderState({ activeDay: setupDay, setupByDay: nextSetupByDay });

      if (setupTransition.kind === "continue_setup") {
        const successMessage = `Rutina de ${setupDay} preparada.`;
        setStatusMessage(`${successMessage} Ahora configura ${setupTransition.nextDay}.`);
        routineBuilder.publishNotice(successMessage);
        routineBuilder.beginEdit();
        routineBuilder.selectRoutineDay(setupTransition.nextDay);
        navigation.transition(createFlowScreenTransition("registro-entrenamiento", "routine-setup-continued"));
        operation.completeSetupContinuation();
        return;
      }

      setIsBusy(true);
      try {
        const cycleRefreshResult = await refreshTrainingCyclesBoundary();
        if (!operation.isCurrent()) return;
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

          if (!operation.isCurrent()) return;
          const saveResult = await operation.settle(
            addCycleScopedTrainingDaysAndExercises({
              cycleId: activeCycle.id,
              days,
            }, operation.userId ?? undefined),
          );
          if (saveResult.kind === "stale") return;
          if (saveResult.kind === "error") throw saveResult.error;
          const loadResult = await reloadCycleScopedBoundary(activeCycle.id);
          if (!operation.isCurrent()) return;
          if (loadResult.kind === "stale") return;
          if (loadResult.kind === "error") throw loadResult.error;
          clearRoutineDraft(operation.dataMode, operation.userId ?? undefined);
          routineBuilder.finishEdit();
          routineBuilder.selectActiveRoutineDay(setupDay);
          routineBuilder.publishNotice(
            `${saveResult.value.daysAdded} dia${saveResult.value.daysAdded === 1 ? "" : "s"}, ${saveResult.value.exercisesAdded} ejercicio${saveResult.value.exercisesAdded === 1 ? "" : "s"} nuevo${saveResult.value.exercisesAdded === 1 ? "" : "s"}, ${saveResult.value.exercisesUpdated} editado${saveResult.value.exercisesUpdated === 1 ? "" : "s"} y ${saveResult.value.exercisesRetired} retirado${saveResult.value.exercisesRetired === 1 ? "" : "s"}.`,
          );
          setStatusMessage("Plan cycle-scoped actualizado. El historial anterior se conserva.");
          routineBuilder.openModal("routine-success");
          navigation.transition(createFlowScreenTransition("entrenamiento", "routine-plan-saved"));
          return;
        }

        const createdResult = await operation.settle(
          createCycleScopedTrainingCycleFromSetup(
            trainingPlan,
            nextSetupByDay,
            activeCycle,
            operation,
          ),
        );
        if (createdResult.kind === "stale") return;
        if (createdResult.kind === "error") throw createdResult.error;
        if (!createdResult.value) return;

        clearRoutineDraft(operation.dataMode, operation.userId ?? undefined);
        routineBuilder.finishEdit();
        routineBuilder.selectActiveRoutineDay(setupDay);
        routineBuilder.publishNotice("Plan cycle-scoped creado correctamente.");
        setStatusMessage("Ciclo y plan operativo creados correctamente en QA.");
        routineBuilder.openModal("routine-success");
        navigation.transition(createFlowScreenTransition("entrenamiento", "routine-plan-saved"));
      } catch (error) {
        if (operation.isCurrent()) {
          setStatusMessage(translateTrainingCycleRepositoryError(error));
        }
      }
      return;
    }

    routineBuilder.closeModal("routine-update-confirm");
    routineBuilder.replaceBuilderState({ activeDay: setupDay, setupByDay: nextSetupByDay });
    setIsBusy(true);
    try {
      const legacyWrites: Array<() => Promise<unknown>> = [];
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
          legacyWrites.push(() => deleteExercise(
              exerciseId,
              operation.dataMode,
              operation.userId ?? undefined,
            ));
        }

        for (const row of rowsToPersist) {
          legacyWrites.push(() => saveExercise({
              id: row.sourceExerciseId ?? row.id,
              routine: currentRoutineName,
              day: dayToPersist,
              name: row.name.trim(),
              targetSets: Math.max(1, row.sets || 1),
              targetReps: Math.max(1, row.reps || 1),
              baseWeight: readRequiredWeight(row.weight),
              notes: `Rutina creada para ${dayToPersist}.`,
            }, operation.dataMode, operation.userId ?? undefined));
        }
      }

      const batchResult = await operation.runLegacyBatch(legacyWrites);
      if (batchResult.kind === "stale") return;
      if (batchResult.kind === "error") throw batchResult.error;

      const refreshedData = await refreshTrainingDataForSession(operation.dataMode);
      if (refreshedData.kind !== "success") return;
      if (!operation.isCurrent()) return;
      routineBuilder.selectActiveRoutineDay(setupDay);
      const successMessage = `Rutina de ${setupDay} guardada.`;
      setStatusMessage(nextIncompleteDay ? `${successMessage} Ahora configura ${nextIncompleteDay}.` : "Registro de rutina finalizado.");
      routineBuilder.publishNotice(successMessage);
      if (setupTransition.kind === "continue_setup") {
        routineBuilder.beginEdit();
        routineBuilder.selectRoutineDay(setupTransition.nextDay);
        navigation.transition(createFlowScreenTransition("registro-entrenamiento", "routine-setup-continued"));
      } else {
        clearRoutineDraft(operation.dataMode, operation.userId ?? undefined);
        routineBuilder.finishEdit();
        routineBuilder.selectActiveRoutineDay(setupDay);
        activeWorkoutActions.clearReadiness();
        routineBuilder.openModal("routine-success");
      }
    } catch (error) {
      if (operation.isCurrent()) {
        handlePersistenceError(error);
      }
    }
  }

  async function handleLogout() {
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    replaceUserPortalAuthorizationProof(null);
    multiportalAuth.invalidatePortalOperations();
    setIsBusy(true);
    const requestToken = captureSessionDataRequestToken();
    const currentStorageScope = activeBrowserStorageScopeRef.current;
    try {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
      if (isSessionDataRequestCurrent(requestToken)) {
        clearUserSessionState("Sesión cerrada correctamente.", currentStorageScope, { statusTone: "success" });
      }
    } catch (error) {
      if (isSessionDataRequestCurrent(requestToken)) setStatusMessage(translateAuthError(error));
    } finally {
      if (isSessionDataRequestCurrent(requestToken)) setIsBusy(false);
      logoutInFlightRef.current = false;
    }
  }

  function openRoutineDay(day: string, keepTrainingStarted = false) {
    if (!keepTrainingStarted && navigation.reenterActiveWorkout({
      tryRestoreActiveWorkout: restoreActiveWorkoutForNavigation,
      closeMenu: appShell.closeMenu,
    })) return;

    const nextDayExerciseCount = displayExercises.filter((exercise) =>
      (exercise.day ?? day) === day).length;
    routineBuilder.selectActiveRoutineDay(day);
    if (nextDayExerciseCount > 0) activeWorkoutActions.selectExercise(0, nextDayExerciseCount);
    routineBuilder.clearNotice();
    if (!keepTrainingStarted) {
      activeWorkoutActions.clearTrainingStart();
    }
    navigation.transition(createFlowScreenTransition("entrenamiento", "routine-day-opened"));
  }

  async function executeCycleCreateAdapter(operation: RoutineBuilderOwnedOperationContext) {
    if (dataMode === "supabase") {
      if (!isTrainingCyclesRepositoryActive) {
        setStatusMessage("Esta acción estará disponible en el siguiente paso.");
        routineBuilder.closeModal("new-cycle-confirm");
        return;
      }
    }

    setIsBusy(true);
    try {
      if (operation.dataMode === "supabase") {
        const cycleRefreshResult = await refreshTrainingCyclesBoundary();
        if (!operation.isCurrent()) return;
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
          if (!operation.isCurrent()) return;
          const endedAt = new Date().toISOString();
          const completionResult = await operation.settle(
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
            }, operation.userId ?? undefined),
          );
          if (completionResult.kind === "stale") return;
          if (completionResult.kind === "error") throw completionResult.error;
        }

        clearActiveFlow(operation.dataMode, operation.userId ?? undefined);
        clearRoutineDraft(operation.dataMode, operation.userId ?? undefined);
        clearWorkoutDraft(operation.dataMode, operation.userId ?? undefined);
        discardActiveWorkoutState();
        trainingDataController.clearForCycleSetup(operation.requestToken);
        routineBuilder.replaceBuilderState({ activeDay: "Lunes", setupByDay: freshSetup });
        routineBuilder.replaceDraft(nextPlan);
        {
          const dayReset = resolveDayStateReset();
          routineBuilder.selectActiveRoutineDay(dayReset.activeRoutineDay);
          setDashboardDayOverride(dayReset.dashboardDayOverride);
          progressController.resetSelection();
        }
        routineBuilder.beginEdit();
        navigation.transition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
        setStatusMessage(activeCycle
          ? "Ciclo actual finalizado. Configura el nuevo plan antes de crearlo."
          : "Configura el plan del nuevo ciclo antes de crearlo.");
        return;
      }

      if (!operation.isCurrent()) return;
      const snapshot = appendCompletedCycle({ plan: trainingPlan, exercises, entries });
      if (!snapshot || !operation.isCurrent()) return;
      clearRoutineDraft(operation.dataMode, operation.userId ?? undefined);

      const nextPlan = createNextTrainingPlan("default");
      replaceLocalData([], []);
      trainingDataController.clearForCycleSetup(operation.requestToken);
      routineBuilder.resetBuilder();
      routineBuilder.replaceDraft(nextPlan);
      {
        const dayReset = resolveDayStateReset();
        routineBuilder.selectActiveRoutineDay(dayReset.activeRoutineDay);
        setDashboardDayOverride(dayReset.dashboardDayOverride);
        progressController.resetSelection();
      }
      activeWorkoutActions.replaceExerciseDrafts({});
      activeWorkoutActions.clearReadiness();
      routineBuilder.beginEdit();
      setStatusMessage("Ciclo actual finalizado. Ya puedes crear un nuevo ciclo de entrenamiento.");
      navigation.transition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
    } catch (error) {
      if (operation.isCurrent()) {
        setStatusMessage(translateTrainingCycleRepositoryError(error));
      }
    }
  }

  async function executeCycleDeleteAdapter(operation: RoutineBuilderCycleDeleteContext) {
    setIsBusy(true);
    try {
      if (isTrainingCyclesRepositoryActive) {
        let activeCycle = persistedActiveCycle;
        if (!activeCycle) {
          const cycleRefreshResult = await refreshTrainingCyclesBoundary();
          if (!operation.isCurrent()) return;
          if (cycleRefreshResult.kind === "stale") return;
          if (cycleRefreshResult.kind === "error") throw cycleRefreshResult.error;
          activeCycle = selectTrainingDataView(
            cycleRefreshResult.state,
            trainingPlan,
          ).activeCycle;
        }
        if (!activeCycle) {
          setStatusMessage("No existe un ciclo activo para cancelar.");
          routineBuilder.closeModal("delete-cycle-confirm");
          return;
        }
        if (isProtectedTrainingCycle(activeCycle)) {
          setStatusMessage(PROTECTED_ACTIVE_CYCLE_MESSAGE);
          routineBuilder.closeModal("delete-cycle-confirm");
          return;
        }

        const endedAt = new Date().toISOString();
        const cancellationResult = await operation.runRepositoryWrite(
          () => cancelTrainingCycle({
            endedAt,
            summarySnapshot: createPersistedCycleSummarySnapshot(
              trainingPlan,
              displayExercises,
              displayEntries,
              activeCycle.startedAt,
              endedAt,
              trainingCyclesSnapshotSource,
            ),
          }, operation.userId ?? undefined),
        );
        if (cancellationResult.kind === "stale") return;
        if (cancellationResult.kind === "error") throw cancellationResult.error;

        const nextPlan = createNextTrainingPlan("default");
        clearRoutineDraft(operation.dataMode, operation.userId ?? undefined);
        clearWorkoutDraft(operation.dataMode, operation.userId ?? undefined);
        discardActiveWorkoutState();
        routineBuilder.replaceDraft(nextPlan);
        routineBuilder.resetBuilder();
        {
          const dayReset = resolveDayStateReset();
          routineBuilder.selectActiveRoutineDay(dayReset.activeRoutineDay);
          setDashboardDayOverride(dayReset.dashboardDayOverride);
          progressController.resetSelection();
        }
        routineBuilder.beginEdit();
        routineBuilder.closeModal("delete-cycle-confirm");
        setStatusMessage("Ciclo cancelado. Ya puedes configurar un nuevo ciclo de entrenamiento.");
        navigation.transition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
        const refreshResult = await refreshTrainingCyclesBoundary();
        if (!operation.isCurrent()) return;
        if (refreshResult.kind === "error") throw refreshResult.error;
        return;
      }

      const deactivationResult = await operation.runRepositoryWrite(
        () => deactivateActiveCycle(
          operation.dataMode,
          operation.userId ?? undefined,
        ),
      );
      if (deactivationResult.kind === "stale") return;
      if (deactivationResult.kind === "error") throw deactivationResult.error;
      clearRoutineDraft(operation.dataMode, operation.userId ?? undefined);
      clearWorkoutDraft(operation.dataMode, operation.userId ?? undefined);
      discardActiveWorkoutState();
      const refreshResult = await refreshTrainingDataForSession(operation.dataMode);
      if (refreshResult.kind !== "success") return;
      if (!operation.isCurrent()) return;

      const nextPlan = createNextTrainingPlan("default");
      routineBuilder.replaceDraft(nextPlan);
      routineBuilder.resetBuilder();
      {
        const dayReset = resolveDayStateReset();
        routineBuilder.selectActiveRoutineDay(dayReset.activeRoutineDay);
        setDashboardDayOverride(dayReset.dashboardDayOverride);
        progressController.resetSelection();
      }
      routineBuilder.beginEdit();
      routineBuilder.closeModal("delete-cycle-confirm");
      setStatusMessage("Ciclo eliminado. Ya puedes configurar un nuevo ciclo de entrenamiento.");
      navigation.transition(createFlowScreenTransition("registro-entrenamiento", "cycle-lifecycle-reset"));
    } catch (error) {
      if (operation.isCurrent()) {
        if (error instanceof TrainingCycleRepositoryError) {
          setStatusMessage(translateTrainingCycleRepositoryError(error));
        } else if (isSessionExpiredError(error)) {
          clearUserSessionState("Tu sesión expiró. Inicia sesión nuevamente.", activeBrowserStorageScopeRef.current, { statusTone: "error" });
        } else {
          setStatusMessage(translatePersistenceError(error));
        }
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
    const runtime = activeWorkoutBoundary.getRuntimeSnapshot();
    return resolveTrainingWorkoutReadinessMode({
      enabled: trainingWorkoutReadinessV2Enabled,
      cycleScoped: isCycleScopedActiveCycle,
      workoutAttemptId: runtime.readinessContext?.workoutAttemptId ?? null,
      cycleId: runtime.readinessContext?.cycleId ?? null,
      cycleDayId: runtime.readinessContext?.cycleDayId ?? null,
      workoutStartedAt: runtime.readinessContext?.workoutStartedAt ?? null,
    });
  }

  function persistCurrentWorkoutDraftSnapshot(nextReadiness: TrainingReadiness | null) {
    if (!activeWorkoutStartedAt) return;
    const runtime = activeWorkoutBoundary.getRuntimeSnapshot();
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
      workoutAttemptId: runtime.attemptId ?? activeWorkoutAttemptId,
      pendingReadinessLink: runtime.pendingReadinessLink,
      cycleId: runtime.readinessContext?.cycleId ?? null,
      cycleDayId: runtime.readinessContext?.cycleDayId ?? null,
      plannedDay: runtime.readinessContext?.plannedDay ?? null,
      plannedDate: runtime.readinessContext?.plannedDate ?? null,
    });
  }
  function syncPendingWorkoutReadinessLink(link: PendingWorkoutReadinessLink | null) {
    const runtime = activeWorkoutBoundary.getRuntimeSnapshot();
    const update = resolvePendingReadinessLinkUpdate({
      activeWorkoutAttemptId: runtime.attemptId,
      pendingReadinessLink: link,
    });
    if (update.kind === "rejected") return false;

    activeWorkoutBoundary.replaceRuntimeSnapshot({
      ...runtime,
      pendingReadinessLink: update.value,
    });
    if (update.value) {
      activeWorkoutActions.publishPendingReadinessLink(update.value);
    } else {
      activeWorkoutActions.clearPendingReadinessLink();
    }
    return true;
  }

  function prepareWorkoutStartSnapshot(nextActiveExerciseIndex: number) {
    const runtime = activeWorkoutBoundary.getRuntimeSnapshot();
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

    const currentWorkoutAttemptId = runtime.attemptId ?? activeWorkoutAttemptId;
    const attemptId = resolveWorkoutAttemptId({
      enabled: trainingWorkoutReadinessV2Enabled && isCycleScopedActiveCycle,
      cycleId,
      cycleDayId,
      existingWorkoutAttemptId: currentWorkoutAttemptId,
    }, createWorkoutAttemptId);
    const nextPendingReadinessLink = attemptId && attemptId === currentWorkoutAttemptId
      ? runtime.pendingReadinessLink
      : null;
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

    activeWorkoutBoundary.replaceRuntimeSnapshot({
      attemptId: start.value.activeWorkoutAttemptId,
      pendingReadinessLink: start.value.pendingReadinessLink,
      readinessContext: createActiveWorkoutReadinessContext({
        workoutAttemptId: start.value.activeWorkoutAttemptId,
        cycleId,
        cycleDayId,
        workoutStartedAt: start.value.activeWorkoutStartedAt,
        plannedDay,
        plannedDate,
      }),
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

  async function startTrainingCommand(operationContext: ActiveWorkoutOperationContext) {
    let ownsCheckingState = false;

    try {
      if (checkingDailyReadiness || savingDailyReadiness) return;

      const firstPendingIndex = dayExercises.findIndex((exercise) =>
        !isExerciseRegisteredInCurrentWorkout(exercise, exerciseDrafts));
      const nextActiveExerciseIndex = firstPendingIndex >= 0 ? firstPendingIndex : 0;
      activeWorkoutActions.clearDailyReadinessError();
      routineBuilder.clearNotice();

      let startSnapshot: ReturnType<typeof prepareWorkoutStartSnapshot>;
      try {
        startSnapshot = prepareWorkoutStartSnapshot(nextActiveExerciseIndex);
      } catch (error) {
        const message = error instanceof Error ? error.message : "No pudimos preparar el entrenamiento.";
        activeWorkoutActions.publishDailyReadinessError(message);
        routineBuilder.publishNotice(message);
        return;
      }

      let readinessMode: TrainingWorkoutReadinessMode;
      try {
        readinessMode = resolveCurrentReadinessMode();
      } catch (error) {
        const message = error instanceof TrainingWorkoutReadinessFlowError ? error.message : "No pudimos preparar el formulario de entrenamiento.";
        activeWorkoutActions.publishDailyReadinessError(message);
        routineBuilder.publishNotice(message);
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
      const readinessResult = await operationContext.settle(getDailyTrainingReadiness());
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
          routineBuilder.publishNotice(message);
          return;
        }

        clearWorkoutDraft(dataMode, supabaseUser?.id);
        abortWorkoutStartState();
        activeWorkoutActions.publishDailyReadinessError(message);
        routineBuilder.publishNotice(message);
      }
    } finally {
      if (ownsCheckingState && operationContext.isCurrent()) {
        activeWorkoutActions.completeDailyReadinessCheck();
      }
    }
  }

  async function submitReadinessCommand(
    value: TrainingReadiness,
    operationContext: ActiveWorkoutOperationContext,
  ) {
    const operationOwner = operationContext.owner;
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
        const saveResult = await operationContext.settle(
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

      const context = operationContext.getRuntimeSnapshot().readinessContext;
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
      const saveResult = await operationContext.settle(
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
      if (ownsSavingState && operationContext.isCurrent()) {
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
        routineBuilder.publishNotice(decision.message);
        return;
      case "register":
        routineBuilder.clearNotice();
        updateExerciseDraft(decision.exercise, decision.draft);
        activeWorkoutActions.selectExercise(decision.nextExerciseIndex, dayExercises.length);
    }
  }

  async function confirmTrainingWorkoutReadinessLink(
    pendingLink: PendingWorkoutReadinessLink,
    operationContext: ActiveWorkoutOperationContext,
  ) {
    const operationOwner = operationContext.owner;
    if (!operationOwner.userId) {
      throw new TrainingWorkoutReadinessLinkFlowError(
        "Tu sesión expiró. Inicia sesión nuevamente.",
      );
    }
    const linkResult = await operationContext.settle(
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
    activeWorkoutBoundary.replaceRuntimeSnapshot({
      attemptId: null,
      pendingReadinessLink: null,
      readinessContext: null,
    });
    activeWorkoutActions.finishWorkout();
  }

  async function buildCompletedTrainingSummarySnapshot(input: {
    sessionId: string;
    validExercises: ExerciseTemplate[];
    capturedExerciseDrafts: Record<string, ExerciseDraft>;
    workoutStartedAt: string | null;
    savedAt: string;
    trainedDate: string;
  }, operationContext: ActiveWorkoutOperationContext) {
    const historicalResult = await operationContext.settle(
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

  async function completeWorkoutCommand(operationContext: ActiveWorkoutOperationContext) {
    const operationOwner = operationContext.owner;
    let ownsBusyState = false;

    try {
      if (isBusy) return;

      const completionStart = resolveActiveWorkoutCompletionStart(
        operationContext.getRuntimeSnapshot().pendingReadinessLink,
      );
      if (completionStart.kind === "retry_pending_link") {
        setIsBusy(true);
        ownsBusyState = true;
        routineBuilder.clearNotice();
        try {
          const linked = await confirmTrainingWorkoutReadinessLink(
            completionStart.pendingLink,
            operationContext,
          );
          if (!linked || !operationContext.isCurrent()) return;
          setStatusMessage("Entrenamiento guardado.");
          finishCompletedWorkout();
          navigation.transition(resolveWorkoutCompletionTransition({ hasCompletionSummary: false }));
        } catch (error) {
          if (!operationContext.isCurrent()) return;
          routineBuilder.publishNotice(translateTrainingWorkoutReadinessLinkError(error));
        }
        return;
      }

      let readinessMode: TrainingWorkoutReadinessMode;
      try {
        readinessMode = resolveCurrentReadinessMode();
      } catch (error) {
        const message = error instanceof TrainingWorkoutReadinessFlowError ? error.message : "No pudimos preparar el formulario de entrenamiento.";
        routineBuilder.publishNotice(message);
        return;
      }

      const completionMode = resolveActiveWorkoutCompletionMode({
        repositoryActive: isTrainingCyclesRepositoryActive,
        hasPersistedActiveCycle: Boolean(persistedActiveCycle),
        cycleScopedActiveCycle: isCycleScopedActiveCycle,
      });
      const shouldLinkWorkoutReadiness = readinessMode === "attempt_v2";
      const runtime = operationContext.getRuntimeSnapshot();
      const readinessContext = runtime.readinessContext;
      const capturedWorkoutAttemptId = runtime.attemptId;
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
        routineBuilder.publishNotice(preparation.message);
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
          routineBuilder.publishNotice(entriesResult.message);
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
          routineBuilder.publishNotice(capture.message);
          return;
        }
        const captured = capture.context;

        setIsBusy(true);
        ownsBusyState = true;
        routineBuilder.clearNotice();
        const sessionSaveResult = await operationContext.settle(
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
          if (!operationContext.isCurrent()) return;
          routineBuilder.publishNotice(message);
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
            routineBuilder.publishNotice(translateTrainingWorkoutReadinessLinkError(error));
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
              operationContext,
            );
            if (!linked || !operationContext.isCurrent()) return;
          } catch (error) {
            if (!operationContext.isCurrent()) return;
            routineBuilder.publishNotice(translateTrainingWorkoutReadinessLinkError(error));
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
        }, operationContext);
        if (!summarySnapshot || !operationContext.isCurrent()) return;
        if (!activeWorkoutActions.publishWorkoutCompletion(summarySnapshot, validExercises.map((exercise) => exercise.id))) return;
        setStatusMessage("Entrenamiento guardado.");
        try {
          finishCompletedWorkout();
          navigation.transition(resolveWorkoutCompletionTransition({ hasCompletionSummary: true }));
        } catch {
          // El entrenamiento ya fue persistido; un fallo local de limpieza no debe habilitar duplicados.
        }

        const reloadResult = await trainingDataController.reloadCycleSessions(preparation.cycleId, {
          errorMessage: "Entrenamiento guardado. Recarga el panel para ver la sesion registrada.",
        });
        if (reloadResult.kind === "stale") return "stale";
        if (reloadResult.kind === "error") return "error";
        return "success";
      }

      setIsBusy(true);
      ownsBusyState = true;
      routineBuilder.clearNotice();
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
          routineBuilder.publishNotice(capture.message);
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
        const sessionSaveResult = await operationContext.settle(legacySessionRequest);
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
        }, operationContext);
        if (!summarySnapshot || !operationContext.isCurrent()) return;
        if (!activeWorkoutActions.publishWorkoutCompletion(summarySnapshot, validExercises.map((exercise) => exercise.id))) return;
        if (!trainingDataController.appendLegacySession(savedSession, operationOwner.requestToken)) {
          return "stale";
        }
        setStatusMessage("Entrenamiento guardado.");
        finishCompletedWorkout();
        navigation.transition(resolveWorkoutCompletionTransition({ hasCompletionSummary: true }));
        return "success";
      } catch (error) {
        if (!operationContext.isCurrent()) return;
        const message = handlePersistenceError(error);
        if (!operationContext.isCurrent()) return;
        routineBuilder.publishNotice(message === "Ya existe un entrenamiento registrado para esta rutina y fecha."
          ? "Ya existe un entrenamiento registrado para esta rutina y fecha. Puedes revisar el resumen o editar el registro existente."
          : message);
      }
    } finally {
      if (ownsBusyState && operationContext.isCurrent()) {
        setIsBusy(false);
      }
    }
  }

  function clearAuthForms() {
    setLoginEmail("");
    setLoginPassword("");
    registrationForm.controller.reset();
    setRecoveryEmail("");
    setNewPassword("");
    setNewPasswordConfirm("");
    setAuthFieldErrors({});
  }

  function switchAuthScreen(nextScreen: "login" | "registro" | "recuperar-password") {
    passwordRecoveryUserIdRef.current = null;
    passwordRecoveryUpdateOwnerRef.current = null;
    passwordRecoveryStateRef.current = "none";
    setIsPasswordRecoveryConfirmed(false);
    clearPasswordRecoveryFlow();
    clearPasswordRecoveryUrl();
    clearAuthForms();
    setAuthStatus("", "info");
    if (nextScreen === "login" || nextScreen === "registro") {
      authRouteController.replace({
        mode: nextScreen,
        accountType: authRouteController.route.accountType,
      });
    }
    navigation.transition(createAuthNavigationReset(nextScreen, "auth-screen-switch"));
  }

  async function handleRequestNewRecoveryLink() {
    if (multiportalAuth.isPasswordRecoveryPortalBlocked()) {
      const closed = await closePasswordRecoverySessionLocally("", "info");
      if (!closed) return;
    }
    switchAuthScreen("recuperar-password");
  }

  function switchAuthAccountType(accountType: AuthAccountType) {
    if (screen !== "login" && screen !== "registro") return;
    setAuthFieldErrors({});
    registrationForm.controller.clearFieldErrors();
    setAuthStatus("", "info");
    authRouteController.replace({ mode: screen, accountType });
  }

  if (screen === "recovery-expired") {
    return (
      <main className="app-shell">
        <RecoveryExpiredScreen
          message={statusMessage}
          onRequestNewLink={handleRequestNewRecoveryLink}
        />
      </main>
    );
  }

  if (multiportalAuth.isPasswordRecoveryPortalBlocked() && isPasswordRecoveryConfirmed) {
    return (
      <main className="app-shell">
        <NewPasswordScreen
          password={newPassword}
          confirmPassword={newPasswordConfirm}
          message={statusMessage}
          statusTone={authStatusTone}
          fieldErrors={authFieldErrors}
          isBusy={isBusy}
          onPasswordChange={setNewPassword}
          onConfirmPasswordChange={setNewPasswordConfirm}
          onSubmit={handleUpdatePassword}
          onFieldErrorClear={clearAuthFieldError}
        />
      </main>
    );
  }

  if (multiportalAuth.isPasswordRecoveryPortalBlocked()) {
    return (
      <main className="app-shell">
        <AuthLoadingScreen />
      </main>
    );
  }

  if (isAuthLoading) {
    return (
      <main className="app-shell">
        <AuthLoadingScreen />
      </main>
    );
  }

  if (coachPortalSession) {
    return (
      <CoachPortalBoundary
        key={`${coachPortalSession.userId}:${coachPortalSession.registration.createdAt}`}
        session={coachPortalSession}
        isLoggingOut={isBusy}
        onLogout={handleLogout}
      />
    );
  }

  if (screen === "login" || screen === "registro") {
    return (
      <main className="app-shell">
        <AuthScreen
          key={screen}
          mode={screen}
          accountType={authRouteController.route.accountType}
          message={statusMessage}
          statusTone={authStatusTone}
          fieldErrors={authFieldErrors}
          isBusy={isBusy}
          authenticatedUserId={supabaseUser?.id ?? null}
          registrationForm={registrationForm}
          loginEmail={loginEmail}
          loginPassword={loginPassword}
          onLoginEmailChange={setLoginEmail}
          onLoginPasswordChange={setLoginPassword}
          onSubmit={(data) => handleAuth(screen, data)}
          onSharedCoachLogin={handleSharedCoachLogin}
          onForgotPassword={() => switchAuthScreen("recuperar-password")}
          onModeChange={switchAuthScreen}
          onAccountTypeChange={switchAuthAccountType}
          onFieldErrorClear={clearAuthFieldError}
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
          statusTone={authStatusTone}
          fieldErrors={authFieldErrors}
          isBusy={isBusy}
          onEmailChange={setRecoveryEmail}
          onSubmit={handlePasswordRecovery}
          onBack={() => switchAuthScreen("login")}
          onFieldErrorClear={clearAuthFieldError}
        />
      </main>
    );
  }

  if (
    hasSupabaseSession
    && isUserPortalRenderableScreen(screen)
    && !hasCurrentUserPortalAuthorizationProof
  ) {
    return (
      <main className="app-shell">
        <AuthLoadingScreen />
      </main>
    );
  }

  function toggleNotifications() {
    appShell.toggleNotifications();
  }

  function handleNotificationOpenIntent(intent: NotificationOpenIntent) {
    appShell.closeNotifications();
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
  const userPortalNavigation = createUserPortalNavigationModel({
    currentScreen: screen,
    visibleScreens: menuScreens,
  });
  const useUserPortalShell = shouldMountAuthorizedUserPortal({
    authorizationProof: userPortalAuthorizationProof,
    sessionUserId: supabaseSession?.user.id,
    authenticatedUserId: supabaseUser?.id,
    hasCoachPortalSession: Boolean(coachPortalSession),
    isAuthLoading,
    isPasswordRecoveryBlocked: multiportalAuth.isPasswordRecoveryPortalBlocked(),
    isRenderableScreen: isUserPortalRenderableScreen(screen),
  });

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
    appShell.toggleMenu(() => {
      void refreshProfileAvatar();
    });
  }

  const notificationOverlay = (
    <NotificationPanel
      isOpen={isNotificationPanelOpen}
      subtitle={notificationPanelSubtitle}
      totalNotificationsCount={appNotifications.length}
      newNotifications={newNotifications}
      historyNotifications={historyNotifications}
      seenNotificationRecordsById={seenNotificationRecordsById}
      emptyMessage={NOTIFICATION_EMPTY_MESSAGE}
      onClose={appShell.closeNotifications}
      onOpenNotification={openNotificationTarget}
    />
  );
  const screenHeader = canGoBackFromScreen(screen)
    ? <AppScreenHeader onBack={goBack} />
    : null;
  const portalScreenContent = (
    <>
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
            navigation.transition(createFlowScreenTransition("dashboard", "summary-dismissed"));
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
          startTraining={activeWorkoutBoundary.start}
          isStartingTraining={checkingDailyReadiness}
          notice={dailyReadinessError || routineNotice}
        />
      )}
      {screen === "entrenamiento" && activeWorkoutVariant === "readiness" && (
        <TrainingReadinessScreen
          onSubmit={activeWorkoutBoundary.submitReadiness}
          onSkip={activeWorkoutBoundary.skipReadiness}
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
          saveCompletedTraining={activeWorkoutBoundary.complete}
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
            navigation.transition(createFlowScreenTransition("dashboard", "routine-success-dismissed"));
          }}
        />
      )}
      {isRoutineUpdateConfirmOpen && (
        <ConfirmRoutineUpdateModal
          onCancel={() => cancelRoutineUpdate()}
          onConfirm={() => void saveInitialRoutine("confirmed_routine_update")}
        />
      )}
    </>
  );

  if (useUserPortalShell) {
    return (
      <UserPortalShell
        profile={profileViewModel}
        navigation={userPortalNavigation}
        isDrawerOpen={isMenuOpen}
        isTopbarHidden={isTopbarHidden}
        isLogoutDisabled={isBusy}
        isNotificationPanelOpen={isNotificationPanelOpen}
        notificationBadgeText={notificationBadgeText}
        notificationBadgeAriaLabel={notificationBadgeAriaLabel}
        notificationOverlay={notificationOverlay}
        screenHeader={screenHeader}
        avatarResetKey={profileAvatarResetKey}
        onAvatarImageError={handleProfileAvatarImageError}
        onOpen={toggleMenu}
        onClose={appShell.closeMenu}
        onNavigate={navigateTo}
        onToggleNotifications={toggleNotifications}
        onLogout={handleLogout}
      >
        {portalScreenContent}
      </UserPortalShell>
    );
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
      notificationOverlay={notificationOverlay}
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
          onClose={appShell.closeMenu}
          onNavigate={navigateTo}
          onLogout={handleLogout}
        />
      }
      screenHeader={screenHeader}
    >
      {portalScreenContent}
    </AppShellLayout>
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

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  const progress = summarizeCycleProgress(entries);
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

function summarizeCycleProgress(entries: ExerciseEntry[]) {
  const byExercise = new Map<string, ExerciseMetrics[]>();
  for (const entry of calculateWeeklyComparison(entries)) {
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

function getPasswordRecoveryRedirectUrl() {
  return getBrowserAuthCallbackUrl(PASSWORD_RECOVERY_FLOW);
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

  const hadStoredRecovery = hasStoredPasswordRecoveryFlow();
  const storedRecovery = loadPasswordRecoveryFlow();
  if (hadStoredRecovery && !storedRecovery) return "expired";

  const requestedFlow = searchParams.get("flow");
  const callbackType = searchParams.get("type") ?? hashParams.get("type");
  const hasRecoveryRoute =
    requestedFlow === PASSWORD_RECOVERY_FLOW || callbackType === "recovery";
  const isCrossedCallback = (
    requestedFlow === PASSWORD_RECOVERY_FLOW
    && callbackType !== null
    && callbackType !== "recovery"
  ) || (
    requestedFlow === SIGNUP_CONFIRMATION_FLOW
    && callbackType !== null
    && callbackType !== "signup"
  );
  const hasCallbackError = hasPasswordRecoveryCallbackError({
    error,
    errorCode,
    errorDescription,
  });
  if (isCrossedCallback || ((hasRecoveryRoute || storedRecovery) && hasCallbackError)) {
    return "expired";
  }
  if (hasRecoveryRoute) {
    if (!storedRecovery) startPasswordRecoveryFlow();
    return "active";
  }

  if (storedRecovery) return "active";

  return "none";
}

interface SignupConfirmationSnapshot {
  routeState: SignupConfirmationRouteState;
  evidence: AuthCallbackEvidence;
}

function getSignupConfirmationSnapshot(): SignupConfirmationSnapshot {
  if (typeof window === "undefined") {
    return {
      routeState: "none",
      evidence: parseAuthCallbackEvidence({ search: "", hash: "" }),
    };
  }
  const evidence = parseAuthCallbackEvidence({
    search: window.location.search,
    hash: window.location.hash,
  });
  return {
    routeState: resolveSignupConfirmationRouteState({
      pathname: window.location.pathname,
      evidence,
    }),
    evidence,
  };
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
  window.history.replaceState({}, "", getPasswordRecoveryClearedHref(window.location.href));
}

function clearSignupConfirmationUrl() {
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
