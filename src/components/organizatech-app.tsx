"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  Dumbbell,
  Eye,
  EyeOff,
  HelpCircle,
  Lock,
  LogOut,
  Mail,
  Minus,
  Pencil,
  Save,
  Smile,
  Sparkles,
  Trash2,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  deactivateActiveCycle,
  deleteExercise,
  loadAppData,
  replaceLocalData,
  resetLocalData,
  saveExercise,
  saveTrainingSessionWithEntries,
  type DataSource,
} from "@/lib/data/repository";
import { ProfileMenuHeader } from "@/components/profile/ProfileMenuHeader";
import { ProfileScreen } from "@/components/profile/ProfileScreen";
import { buildProfileViewModel } from "@/lib/profile/profile-view-model";
import {
  getProfilePersonalData,
  updateProfilePersonalData,
  type ProfilePersonalData,
} from "@/lib/profile/profile-repository";
import type { ProfilePersonalDataInput } from "@/lib/profile/profile-form";
import {
  deleteProfileAvatar,
  getCurrentProfileAvatar,
  uploadProfileAvatar,
} from "@/lib/profile/profile-avatar-repository";
import type { ProfileAvatarState } from "@/lib/profile/profile-avatar";
import {
  calculateExerciseMetrics,
  calculateWeeklyComparison,
  calculateWeeklySummary,
  formatSigned,
  generateSmartInsights,
  getObjectiveStatusLabel,
} from "@/lib/progress/calculations";
import { buildExerciseComparisonSummary, getExerciseHistory } from "@/lib/progress/exercise-history";
import { formatDecimalEs, formatKg, isDecimalWeightDraftInput, parseDecimalWeightInput } from "@/lib/progress/weight-format";
import { buildWeeklyProgressChart } from "@/lib/progress/weekly-progress-chart";
import {
  buildWeeklyExerciseComparisonModel,
  type WeeklyExerciseComparisonModel,
  type WeeklyExerciseComparisonSeriesPoint,
  type WeeklyExerciseMetricSummary,
} from "@/lib/progress/weekly-exercise-comparison";
import {
  calculateEquivalentWeeklyProgress,
  type WeeklyEquivalentProgressResult,
} from "@/lib/progress/weekly-equivalent-progress";
import type {
  ExerciseComparisonSummary,
  ExerciseEntry,
  ExerciseMetrics,
  ExerciseTemplate,
  ObjectiveStatus,
  TrainingDayCode,
  TrainingSession,
} from "@/lib/progress/types";
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
  cancelTrainingCycle,
  completeTrainingCycle,
  getActiveTrainingCycle,
  getNextTrainingCycleNumber,
  getTrainingCycleHistory,
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
  TrainingDailyReadinessRepositoryError,
  type TrainingDailyReadinessRecord,
} from "@/lib/training/training-daily-readiness-repository";
import {
  linkTrainingWorkoutReadinessSession,
  saveTrainingWorkoutReadiness,
  TrainingWorkoutReadinessRepositoryError,
  type TrainingWorkoutReadinessPayload,
} from "@/lib/training/training-workout-readiness-repository";
import {
  getLatestExercisePerformanceByLineage,
  type LatestExercisePerformance,
} from "@/lib/training/exercise-last-performance-repository";
import {
  buildTrainingCoachFeedback,
  type CoachInsight,
  type TrainingCoachFeedback,
} from "@/lib/training/training-coach-feedback";
import { buildTrainingCoachDashboardInput } from "@/lib/training/training-coach-dashboard-mapper";
import {
  createStableWorkoutStartedAt,
  createLatestExercisePerformanceRequest,
  getLatestExercisePerformanceIdleState,
  getLatestExercisePerformanceLoadingState,
  loadLatestExercisePerformanceForRequest,
} from "@/lib/training/exercise-last-performance-loader";
import {
  buildExerciseLastPerformancePresentation,
  type ExerciseLastPerformancePresentation,
} from "@/lib/training/exercise-last-performance-presentation";
import { buildExerciseCurrentResultPresentation } from "@/lib/training/exercise-current-result-presentation";
import {
  acquireWorkoutSaveLock,
  buildCurrentWorkoutSavePlan,
  incompleteCurrentWorkoutMessage,
  isExerciseRegisteredInCurrentWorkout,
  releaseWorkoutSaveLock,
} from "@/lib/training/workout-registration";
import {
  clearWorkoutDraft as clearStoredWorkoutDraft,
  getDraftUserKey,
  getWorkoutDraftKey as getStoredWorkoutDraftKey,
  saveWorkoutDraft as saveStoredWorkoutDraft,
  loadWorkoutDraft as loadStoredWorkoutDraft,
  type PendingWorkoutReadinessLink,
  type WorkoutDraftStorageRecord,
} from "@/lib/training/workout-draft-storage";
import {
  createWorkoutAttemptId,
  releaseWorkoutStartLock,
  resolveWorkoutAttemptId,
  tryAcquireWorkoutStartLock,
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
} from "@/lib/training/training-workout-readiness-link-flow";
import {
  addCycleScopedTrainingDaysAndExercises,
  createTrainingCycleWithPlan,
  createTrainingSessionWithCycleEntries,
  getCycleScopedTrainingSessionData,
  getCycleScopedTrainingPlan,
  CycleScopedTrainingRepositoryError,
  type CycleScopedDay,
  type CycleScopedPlanInput,
  type CycleScopedTrainingSessionEntryInput,
  type CycleScopedTrainingPlan,
} from "@/lib/training/cycle-scoped-training-repository";
import {
  getCalendarWeekStartDateKey,
  getCycleCalendarPlannedDate,
  getCycleCalendarWeekNumber,
  getSessionEffectiveCalendarWeekStart,
  getSessionEffectiveCycleWeekNumber,
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
  dedupeExercisesByDayAndRoutine,
  getExercisesForTrainingDay,
  getRemovedExerciseIds,
} from "@/lib/training/training-exercise-selection";
import {
  sortTrainingDaysByWeekOrder,
  TRAINING_DAY_LABELS,
} from "@/lib/training/training-day-order";
import {
  buildTrainingCarouselCardModel,
  buildTrainingTopbarMeta,
  resolveActiveCarouselIndex,
  resolveTrainingCarouselAction,
  type TrainingCarouselCardModel,
} from "@/lib/training/training-carousel-card-presentation";
import {
  buildTrainingCompletionSummary,
  type TrainingCompletionHistoricalInput,
  type TrainingCompletionSummary,
} from "@/lib/training/training-completion-summary";

type Screen =
  | "login"
  | "registro"
  | "recuperar-password"
  | "nueva-password"
  | "recovery-expired"
  | "dashboard"
  | "entrenamiento"
  | "training-summary"
  | "registro-entrenamiento"
  | "comparacion"
  | "historial-ciclos"
  | "perfil";

const primaryScreens: Screen[] = ["perfil", "dashboard", "entrenamiento", "comparacion", "registro-entrenamiento", "historial-ciclos"];
const setupDays: string[] = [...TRAINING_DAY_LABELS];
const LOCAL_TRAINING_PLAN_KEY = "organizatech:training-plan";
const LOCAL_CYCLE_HISTORY_KEY = "organizatech:cycle-history";
const ROUTINE_DRAFT_KEY_PREFIX = "organizatech:routine-draft";
const ACTIVE_FLOW_KEY_PREFIX = "organizatech:active-flow";
const PASSWORD_RECOVERY_FLOW_KEY = "organizatech:password-recovery-flow";
const ROUTINE_DRAFT_VERSION = 1;
const WORKOUT_DRAFT_VERSION = 1;
const ACTIVE_FLOW_VERSION = 1;
const ROUTINE_DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const WORKOUT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_FLOW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PROFILE_AVATAR_REFRESH_THROTTLE_MS = 45 * 1000;
const PROFILE_AVATAR_ERROR_REFRESH_THROTTLE_MS = 8 * 1000;
const SEEN_NOTIFICATIONS_KEY = "organizatech:seen-notifications-v1";
const SEEN_NOTIFICATIONS_MAX_RECORDS = 60;
const NOTIFICATION_SECTION_HIGHLIGHT_MS = 1800;
const blockedSignupDomains = new Set([
  "example.com",
  "example.cl",
  "test.com",
  "test.cl",
  "fake.com",
  "fake.cl",
  "prueba.com",
  "demo.com",
  "dominio.com",
  "correo.com",
  "email.com",
  "mailinator.com",
  "yopmail.com",
  "tempmail.com",
  "10minutemail.com",
]);
const blockedSignupLocalParts = new Set([
  "test",
  "prueba",
  "fake",
  "demo",
  "usuario",
  "user",
  "asd",
  "aaa",
  "qwe",
  "correo",
  "email",
]);
const trainingCycles = [
  {
    id: "macro",
    title: "Macrociclo",
    summary: "Plan grande del objetivo principal.",
    detail:
      "Es la estructura más grande de planificación. Generalmente abarca entre 6 y 11 meses y se enfoca en el objetivo deportivo principal o la forma física deseada.",
  },
  {
    id: "meso",
    title: "Mesociclo",
    summary: "Bloques de 3 a 6 semanas.",
    detail:
      "Son bloques intermedios de entrenamiento. Cada mesociclo trabaja un objetivo específico como fuerza, hipertrofia, potencia, resistencia, descarga o definición.",
  },
  {
    id: "micro",
    title: "Microciclo",
    summary: "Organización semanal del entrenamiento.",
    detail:
      "Representa la planificación semanal. Ordena la distribución de cargas, descansos y tipos de entrenamiento durante la semana.",
  },
  {
    id: "session",
    title: "Sesión de entrenamiento",
    summary: "El entrenamiento de un día específico.",
    detail:
      "Es la unidad más pequeña del sistema. Contiene ejercicios, series, repeticiones, pesos, intensidad y métricas asociadas a ese día.",
  },
] as const;
type TrainingCycleId = (typeof trainingCycles)[number]["id"];
const macroObjectives = ["Fuerza", "Hipertrofia", "Recomposición", "Definición", "Rendimiento", "Salud"];
const mesoObjectives = ["Fuerza", "Hipertrofia", "Potencia", "Resistencia", "Descarga", "Definición"];
const microFocusOptions = ["Progresión", "Mantenimiento", "Descarga", "Técnica"];
const sessionFocusOptions = ["Técnica", "Volumen", "Intensidad", "Control/RIR"];
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
const macroDurations = [6, 7, 8, 9, 10, 11];
const mesoDurations = [3, 4, 5, 6];

interface SetupExerciseRow {
  id: string;
  sourceExerciseId?: string;
  exerciseLineageId?: string | null;
  name: string;
  sets: number;
  reps: number;
  weight: string;
}

interface SetupDayState {
  routineName: string;
  rows: SetupExerciseRow[];
}

interface RoutineDraft {
  version: number;
  updatedAt: number;
  dataMode: DataMode;
  userKey: string;
  screen: Screen;
  setupDay: string;
  setupByDay: Record<string, SetupDayState>;
  trainingPlan: TrainingPlan;
  isEditingRoutinePlan: boolean;
  routineEditorReturnScreen: Screen | null;
  activeRoutineDay: string;
}

type ActiveFlow =
  | "dashboard"
  | "routine_setup"
  | "routine_edit"
  | "training_start"
  | "motivation_form"
  | "active_workout"
  | "comparison"
  | "cycle_history"
  | "profile";

interface ActiveFlowState {
  version: number;
  updatedAt: number;
  dataMode: DataMode;
  userKey: string;
  flow: ActiveFlow;
}

type WorkoutDraft = WorkoutDraftStorageRecord<TrainingReadiness | null, Record<string, ExerciseDraft>>;

type ActiveWorkoutReadinessContext = {
  workoutAttemptId: string;
  cycleId: string;
  cycleDayId: string;
  workoutStartedAt: string;
  plannedDay: string | null;
  plannedDate: string | null;
};

interface TrainingPlan {
  cycleType: TrainingCycleId;
  macroObjective: string;
  macroDurationMonths: number;
  mesoObjective: string;
  mesoDurationWeeks: number;
  microDurationWeeks: number;
  sessionDurationDays: number;
  trainingDays: string[];
  microFocus: string;
  sessionFocus: string;
}

interface ExerciseDraft {
  weight: string;
  rir: string;
  reps: Array<number | "">;
  registered: boolean;
}

interface TrainingReadiness {
  motivation?: number;
  hydration?: number;
  sleep?: number;
  energy?: number;
  skipped: boolean;
}

interface AnalyticsSnapshot {
  score: number;
  factors: Array<[string, number]>;
}

type AppNotificationTarget = Extract<Screen, "dashboard" | "perfil" | "comparacion">;
type AppNotificationSection =
  | "profile-avatar"
  | "personal-data"
  | "today-training"
  | "training-carousel"
  | "weekly-progress"
  | "coach"
  | "weekly-comparison";

interface AppNotification {
  id: string;
  title: string;
  summary: string;
  target: AppNotificationTarget;
  section?: AppNotificationSection;
  kind: "feature" | "profile" | "week" | "progress" | "coach";
}

interface SeenNotificationRecord {
  id: string;
  seenAt: number;
}

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
  const [screen, setScreen] = useState<Screen>(() => getInitialAuthScreen());
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
  const [statusMessage, setStatusMessage] = useState(() => {
    const recoveryState = getPasswordRecoveryRouteState();
    if (recoveryState === "expired") return "El enlace de recuperación expiró o ya fue utilizado.";
    if (recoveryState === "active") return "Crea una nueva contraseña para continuar.";
    return "Validando sesión...";
  });
  const [dataSource, setDataSource] = useState<DataSource>("local");
  const [dataMode, setDataMode] = useState<DataMode>("demo");
  const [supabaseSession, setSupabaseSession] = useState<SupabaseSessionState["session"]>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseSessionState["user"]>(null);
  const [profilePersonalData, setProfilePersonalData] = useState<ProfilePersonalData | null>(null);
  const [profilePersonalDataLoading, setProfilePersonalDataLoading] = useState(false);
  const [profilePersonalDataError, setProfilePersonalDataError] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<ProfileAvatarState>({
    avatarPath: null,
    avatarUrl: null,
    avatarUpdatedAt: null,
  });
  const [profileAvatarResetKey, setProfileAvatarResetKey] = useState(0);
  const [profileAvatarLoading, setProfileAvatarLoading] = useState(false);
  const [profileAvatarError, setProfileAvatarError] = useState("");
  const [isSupabaseConfiguredState, setIsSupabaseConfiguredState] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(() => getPasswordRecoveryRouteState() === "none");
  const [isBusy, setIsBusy] = useState(false);
  const isSavingTrainingRef = useRef(false);
  const passwordUpdateSuccessRef = useRef(false);
  const [exercises, setExercises] = useState<ExerciseTemplate[]>([]);
  const [cycleScopedPlan, setCycleScopedPlan] = useState<CycleScopedTrainingPlan | null>(null);
  const [cycleScopedExercises, setCycleScopedExercises] = useState<ExerciseTemplate[] | null>(null);
  const [cycleScopedLoadError, setCycleScopedLoadError] = useState("");
  const isCycleScopedDisplayLockedRef = useRef(false);
  const [entries, setEntries] = useState<ExerciseEntry[]>([]);
  const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);
  const [seenNotificationRecords, setSeenNotificationRecords] = useState<SeenNotificationRecord[]>(() => loadSeenNotificationRecords());
  const [isEditingRoutinePlan, setIsEditingRoutinePlan] = useState(false);
  const [routineNotice, setRoutineNotice] = useState("");
  const [isTopbarHidden, setIsTopbarHidden] = useState(false);
  const [setupDay, setSetupDay] = useState("Lunes");
  const [setupByDay, setSetupByDay] = useState<Record<string, SetupDayState>>(() => createSetupByDay());
  const [trainingPlan, setTrainingPlan] = useState<TrainingPlan>(() => loadTrainingPlan());
  const [activeRoutineDay, setActiveRoutineDay] = useState("Lunes");
  const [dashboardDayOverride, setDashboardDayOverride] = useState("");
  const [comparisonDay, setComparisonDay] = useState("Lunes");
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0);
  const [exerciseDrafts, setExerciseDrafts] = useState<Record<string, ExerciseDraft>>({});
  const [readiness, setReadiness] = useState<TrainingReadiness | null>(null);
  const [dailyReadinessRecord, setDailyReadinessRecord] = useState<TrainingDailyReadinessRecord | null>(null);
  const [checkingDailyReadiness, setCheckingDailyReadiness] = useState(false);
  const [savingDailyReadiness, setSavingDailyReadiness] = useState(false);
  const [dailyReadinessError, setDailyReadinessError] = useState("");
  const [hasStartedTraining, setHasStartedTraining] = useState(false);
  const [activeWorkoutStartedAt, setActiveWorkoutStartedAt] = useState<string | null>(null);
  const [activeWorkoutAttemptId, setActiveWorkoutAttemptId] = useState<string | null>(null);
  const activeWorkoutAttemptIdRef = useRef<string | null>(null);
  const workoutStartInFlightRef = useRef(false);
  const dailyReadinessSaveInFlightRef = useRef(false);
  const workoutCompletionInFlightRef = useRef(false);
  const lastProfileAvatarRefreshAtRef = useRef(0);
  const profileAvatarBootstrapUserIdRef = useRef<string | null>(null);
  const lastProfileAvatarErrorRefreshAtRef = useRef(0);
  const profileAvatarRefreshInFlightRef = useRef(false);
  const [pendingReadinessLink, setPendingReadinessLink] = useState<PendingWorkoutReadinessLink | null>(null);
  const pendingReadinessLinkRef = useRef<PendingWorkoutReadinessLink | null>(null);
  const [hasRecoverableWorkoutStart, setHasRecoverableWorkoutStart] = useState(false);
  const activeWorkoutReadinessContextRef = useRef<ActiveWorkoutReadinessContext | null>(null);
  const [latestExercisePerformance, setLatestExercisePerformance] = useState<LatestExercisePerformance | null>(null);
  const [latestExercisePerformanceLoading, setLatestExercisePerformanceLoading] = useState(false);
  const [latestExercisePerformanceError, setLatestExercisePerformanceError] = useState("");
  const latestExercisePerformanceRequestKeyRef = useRef<string | null>(null);
  const [trainingCompletionSummary, setTrainingCompletionSummary] = useState<TrainingCompletionSummary | null>(null);
  const [routineEditorReturnScreen, setRoutineEditorReturnScreen] = useState<Screen | null>(null);
  const [cycleHistory, setCycleHistory] = useState<TrainingCycleSnapshot[]>(() => loadCycleHistory());
  const [persistedActiveCycle, setPersistedActiveCycle] = useState<PersistedTrainingCycle | null>(null);
  const [persistedCycleHistory, setPersistedCycleHistory] = useState<PersistedTrainingCycle[]>([]);
  const [isPersistedCyclesLoading, setIsPersistedCyclesLoading] = useState(false);
  const [isNewCycleConfirmOpen, setIsNewCycleConfirmOpen] = useState(false);
  const isNewCycleTransitionRef = useRef(false);
  const [isDeleteCycleConfirmOpen, setIsDeleteCycleConfirmOpen] = useState(false);
  const [isRoutineSuccessOpen, setIsRoutineSuccessOpen] = useState(false);
  const [isRoutineUpdateConfirmOpen, setIsRoutineUpdateConfirmOpen] = useState(false);

  function clearCycleScopedPlanState() {
    isCycleScopedDisplayLockedRef.current = false;
    setCycleScopedPlan(null);
    setCycleScopedExercises(null);
    setCycleScopedLoadError("");
  }

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseBrowserClient();

    async function bootstrapSession() {
      const recoveryState = getPasswordRecoveryRouteState();
      if (recoveryState === "expired") {
        clearPasswordRecoveryFlow();
        setIsAuthLoading(false);
        setStatusMessage("El enlace de recuperación expiró o ya fue utilizado.");
        setScreenHistory([]);
        setScreen("recovery-expired");
        return;
      }
      if (recoveryState === "active") {
        markPasswordRecoveryFlow();
        setIsAuthLoading(false);
        setStatusMessage("Crea una nueva contraseña para continuar.");
        setScreenHistory([]);
        setScreen("nueva-password");
      } else {
        setIsAuthLoading(true);
        setStatusMessage("Validando sesión...");
      }
      try {
        const authState = await getInitialSupabaseSession();
        if (!isMounted) return;

        applySessionState(authState);
        const currentRecoveryState = getPasswordRecoveryRouteState();
        if (currentRecoveryState === "expired") {
          clearPasswordRecoveryFlow();
          setStatusMessage("El enlace de recuperación expiró o ya fue utilizado.");
          setScreenHistory([]);
          setScreen("recovery-expired");
          return;
        }
        if (currentRecoveryState === "active") {
          markPasswordRecoveryFlow();
          setStatusMessage("Crea una nueva contraseña para continuar.");
          setScreenHistory([]);
          setScreen("nueva-password");
          return;
        }
        if (authState.session) {
          setStatusMessage("");
          await refreshData(authState.dataMode);
          if (isMounted && !restoreActiveFlowForSession(authState.dataMode, authState.user?.id)) {
            setScreen("dashboard");
          }
        } else {
          setStatusMessage(authState.isConfigured ? "Continúa con tu progreso." : getMissingSupabaseMessage());
        }
      } catch (error) {
        if (isMounted) setStatusMessage(translateAuthError(error));
      } finally {
        if (isMounted) setIsAuthLoading(false);
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

      applySessionState(nextState);
      const recoveryState = getPasswordRecoveryRouteState();
      if (recoveryState === "expired") {
        clearPasswordRecoveryFlow();
        setIsAuthLoading(false);
        setStatusMessage("El enlace de recuperación expiró o ya fue utilizado.");
        setScreenHistory([]);
        setScreen("recovery-expired");
        return;
      }
      if (event === "PASSWORD_RECOVERY") {
        markPasswordRecoveryFlow();
        setIsAuthLoading(false);
        setStatusMessage("Crea una nueva contraseña para continuar.");
        setScreenHistory([]);
        setScreen("nueva-password");
        return;
      }
      if (event === "SIGNED_IN") {
        if (recoveryState === "active") {
          markPasswordRecoveryFlow();
          setIsAuthLoading(false);
          setStatusMessage("Crea una nueva contraseña para continuar.");
          setScreenHistory([]);
          setScreen("nueva-password");
          return;
        }
        setStatusMessage("");
        void refreshData(nextState.dataMode).then(() => {
          if (isMounted && !restoreActiveFlowForSession(nextState.dataMode, nextState.user?.id)) {
            setScreen("dashboard");
          }
        });
      }
      if (event === "TOKEN_REFRESHED") {
        setStatusMessage("");
      }
      if (event === "SIGNED_OUT") {
        if (passwordUpdateSuccessRef.current) {
          passwordUpdateSuccessRef.current = false;
          clearUserSessionState("Contraseña actualizada correctamente. Ya puedes iniciar sesión.");
          return;
        }
        clearUserSessionState("Sesión cerrada correctamente.");
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
    saveTrainingPlan(trainingPlan);
  }, [trainingPlan]);

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
      saveActiveFlow({
        version: ACTIVE_FLOW_VERSION,
        updatedAt: Date.now(),
        dataMode,
        userKey: getDraftUserKey(dataMode, supabaseUser?.id),
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
      saveRoutineDraft({
        version: ROUTINE_DRAFT_VERSION,
        updatedAt: Date.now(),
        dataMode,
        userKey: getDraftUserKey(dataMode, supabaseUser?.id),
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

    function persistWorkoutDraft() {
      saveWorkoutDraft({
        version: WORKOUT_DRAFT_VERSION,
        updatedAt: Date.now(),
        dataMode,
        userKey: getDraftUserKey(dataMode, supabaseUser?.id),
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
      clearWorkoutDraft(dataMode, supabaseUser?.id);
    }
  }, [dataMode, hasRecoverableWorkoutStart, hasStartedTraining, screen, supabaseUser?.id]);

  useEffect(() => {
    const isActiveWorkout = screen === "entrenamiento" && hasStartedTraining;
    const isPausedWorkoutOnDashboard = shouldRetainActiveWorkoutAttemptState({ screen, hasStartedTraining });
    if (isActiveWorkout && !activeWorkoutStartedAt) {
      setActiveWorkoutStartedAt(createStableWorkoutStartedAt());
      return;
    }
    if (!isActiveWorkout && !isPausedWorkoutOnDashboard && !hasRecoverableWorkoutStart && (activeWorkoutStartedAt || activeWorkoutAttemptId || pendingReadinessLink)) {
      setActiveWorkoutStartedAt(null);
      resetWorkoutAttemptState();
    }
  }, [activeWorkoutAttemptId, activeWorkoutStartedAt, hasRecoverableWorkoutStart, hasStartedTraining, pendingReadinessLink, screen]);

  useEffect(() => {
    if (screen === "training-summary" && !trainingCompletionSummary) {
      setScreen("dashboard");
    }
  }, [screen, trainingCompletionSummary]);

  const hasSupabaseSession = Boolean(supabaseSession && supabaseUser);
  const canEditProfilePersonalData = Boolean(supabaseUser && getSupabaseBrowserClient());
  const isTrainingCyclesRepositoryActive = trainingCyclesRepositoryEnabled && dataMode === "supabase" && hasSupabaseSession;
  const persistedActiveCyclePlan = isTrainingCyclesRepositoryActive && persistedActiveCycle
    ? createTrainingPlanFromPersistedCycle(persistedActiveCycle, trainingPlan)
    : null;
  const displayTrainingPlan = persistedActiveCyclePlan ?? trainingPlan;
  const isCycleScopedActiveCycle = Boolean(persistedActiveCycle && isCycleScopedTrainingCycle(persistedActiveCycle));
  const isCycleScopedLookupPending = isTrainingCyclesRepositoryActive && isPersistedCyclesLoading && !persistedActiveCycle;
  const selectedExercises = isCycleScopedLookupPending
    ? []
    : isCycleScopedActiveCycle
    ? (cycleScopedExercises ?? [])
    : exercises;
  const displayExercises = dedupeExercisesByDayAndRoutine(selectedExercises);
  const displayEntries = isCycleScopedLookupPending ? [] : entries;
  const displayTrainingSessions = isCycleScopedLookupPending ? [] : trainingSessions;
  const isCycleScopedPlanLoading = (isCycleScopedLookupPending || isCycleScopedActiveCycle) && cycleScopedExercises === null && !cycleScopedLoadError;
  const isCycleScopedPlanEmpty = isCycleScopedActiveCycle && cycleScopedExercises !== null && (
    cycleScopedExercises.length === 0 ||
    cycleScopedPlan?.routines.length === 0
  );
  const isCycleScopedPlanBlocked = isCycleScopedLookupPending || (isCycleScopedActiveCycle && (isCycleScopedPlanLoading || isCycleScopedPlanEmpty || Boolean(cycleScopedLoadError)));
  const cycleScopedPlanBlockerMessage = cycleScopedLoadError ||
    (isCycleScopedLookupPending
      ? "Verificando el ciclo activo antes de mostrar rutinas."
      : isCycleScopedPlanLoading
      ? "Cargando el plan operativo del ciclo activo."
      : "El ciclo activo no tiene rutina, dia y ejercicio cycle-scoped cargados. No se mostraran datos legacy.");
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
  const dashboardCarouselDays = hasRoutinePlan ? routineDays : setupDays;
  const visibleDay = getVisibleTrainingDay(displayExercises, activeRoutineDay);
  const calendarDashboardDay = getCalendarTrainingDay();
  const dashboardDay = dashboardCarouselDays.includes(dashboardDayOverride)
    ? dashboardDayOverride
    : dashboardCarouselDays.includes(calendarDashboardDay)
      ? calendarDashboardDay
      : dashboardCarouselDays[0] ?? calendarDashboardDay;
  const dayExercises = displayExercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay);
  const dashboardExercises = displayExercises.filter((exercise) => (exercise.day ?? dashboardDay) === dashboardDay);
  const activeWorkoutExercise = screen === "entrenamiento" && hasStartedTraining && readiness
    ? dayExercises[activeExerciseIndex] ?? dayExercises[0] ?? null
    : null;
  const activeWorkoutExerciseLineageId = activeWorkoutExercise?.exerciseLineageId ?? null;
  const activeWorkoutExerciseId = activeWorkoutExercise?.id ?? null;
  const visibleRoutine = dayExercises[0]?.routine ?? setupByDay[visibleDay]?.routineName ?? visibleDay;
  const dashboardRoutine = dashboardExercises[0]?.routine ?? setupByDay[dashboardDay]?.routineName ?? dashboardDay;
  const targetSummary = calculateTargetSummary(dayExercises);
  const currentMetrics = metrics.filter((entry) => entry.week === currentWeek);
  const dashboardExerciseIds = new Set(dashboardExercises.map((exercise) => exercise.id));
  const dashboardCurrentMetrics = currentMetrics.filter((entry) => dashboardExerciseIds.has(entry.exerciseId));
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
  const profileViewModel = useMemo(() => buildProfileViewModel({
    displayName: profilePersonalData?.displayName ?? sessionName,
    email: profilePersonalData?.email ?? supabaseUser?.email ?? null,
    dataSource: canEditProfilePersonalData ? "supabase" : dataSource,
    avatarUrl: profileAvatar.avatarUrl,
    avatarPath: profileAvatar.avatarPath ?? profilePersonalData?.avatarPath ?? null,
  }), [canEditProfilePersonalData, dataSource, profileAvatar.avatarPath, profileAvatar.avatarUrl, profilePersonalData?.avatarPath, profilePersonalData?.displayName, profilePersonalData?.email, sessionName, supabaseUser?.email]);
  const refreshProfileAvatar = useCallback(async (options?: { force?: boolean; avatarPath?: string | null; allowProfileLookup?: boolean }) => {
    if (!canEditProfilePersonalData || !supabaseSession) return null;
    if (profileAvatarRefreshInFlightRef.current) return null;

    const now = Date.now();
    if (!options?.force && now - lastProfileAvatarRefreshAtRef.current < PROFILE_AVATAR_REFRESH_THROTTLE_MS) {
      return null;
    }

    lastProfileAvatarRefreshAtRef.current = now;
    profileAvatarRefreshInFlightRef.current = true;
    try {
      let avatarPath = options?.avatarPath ?? profileAvatar.avatarPath ?? profilePersonalData?.avatarPath ?? null;
      if (!avatarPath && options?.allowProfileLookup) {
        const profile = await getProfilePersonalData();
        setProfilePersonalData(profile);
        setSessionName(profile.displayName);
        avatarPath = profile.avatarPath;
        if (!avatarPath) {
          setProfileAvatar({
            avatarPath: null,
            avatarUrl: null,
            avatarUpdatedAt: null,
          });
          setProfileAvatarResetKey((current) => current + 1);
          setProfileAvatarError("");
          return null;
        }
      }

      if (!avatarPath) return null;

      const avatar = await getCurrentProfileAvatar();
      setProfileAvatar(avatar);
      if (avatar.avatarUrl) {
        setProfileAvatarResetKey((current) => current + 1);
      }
      setProfileAvatarError("");
      return avatar;
    } catch {
      setProfileAvatarError("No pudimos actualizar tu foto de perfil. La mostraremos apenas vuelva a estar disponible.");
      return null;
    } finally {
      profileAvatarRefreshInFlightRef.current = false;
    }
  }, [canEditProfilePersonalData, profileAvatar.avatarPath, profilePersonalData?.avatarPath, supabaseSession]);
  const completedTrainingDays = calculateWeeklyCompletedTrainingDays({
    plannedDays: dashboardCarouselDays,
    exercises: displayExercises,
    entries: calendarNormalizedEntries,
    sessions: calendarNormalizedTrainingSessions,
    usesCycleScopedSessions: isCycleScopedActiveCycle,
  });
  const plannedTrainingDays = hasRoutinePlan ? dashboardCarouselDays.length : 0;
  const trainingTopbarMeta = buildTrainingTopbarMeta({
    cycleLabel: getCycleTypeTitle(displayTrainingPlan),
    weekNumber: currentWeek,
    completedDays: completedTrainingDays,
    plannedDays: hasRoutinePlan ? dashboardCarouselDays.length : 0,
  });
  const appNotifications = useMemo(() => buildAppNotifications({
    profile: profileViewModel,
    currentWeek,
    completedDays: completedTrainingDays,
    plannedDays: plannedTrainingDays,
    hasTrainingEntries,
    hasRoutinePlan,
    weeklyEquivalentProgress,
    summary,
    currentMetrics,
  }), [
    completedTrainingDays,
    currentMetrics,
    currentWeek,
    hasRoutinePlan,
    hasTrainingEntries,
    plannedTrainingDays,
    profileViewModel.avatarUrl,
    summary,
    weeklyEquivalentProgress,
  ]);
  const seenNotificationIds = useMemo(() => new Set(seenNotificationRecords.map((record) => record.id)), [seenNotificationRecords]);
  const newNotifications = appNotifications.filter((notification) => !seenNotificationIds.has(notification.id));
  const historyNotifications = appNotifications.filter((notification) => seenNotificationIds.has(notification.id));
  const unseenNotificationCount = newNotifications.length;

  useEffect(() => {
    if (activeWorkoutExerciseLineageId && !activeWorkoutStartedAt) {
      latestExercisePerformanceRequestKeyRef.current = null;
      const idle = getLatestExercisePerformanceIdleState();
      setLatestExercisePerformance(idle.performance);
      setLatestExercisePerformanceLoading(idle.loading);
      setLatestExercisePerformanceError(idle.error);
      return;
    }

    const request = createLatestExercisePerformanceRequest({
      exerciseLineageId: activeWorkoutExerciseLineageId,
      currentSessionId: null,
      beforeTimestamp: activeWorkoutStartedAt,
    });

    latestExercisePerformanceRequestKeyRef.current = request?.key ?? null;

    if (!request) {
      const idle = getLatestExercisePerformanceIdleState();
      setLatestExercisePerformance(idle.performance);
      setLatestExercisePerformanceLoading(idle.loading);
      setLatestExercisePerformanceError(idle.error);
      return;
    }

    const loading = getLatestExercisePerformanceLoadingState();
    setLatestExercisePerformance(loading.performance);
    setLatestExercisePerformanceLoading(loading.loading);
    setLatestExercisePerformanceError(loading.error);

    let isMounted = true;
    void loadLatestExercisePerformanceForRequest({
      request,
      fetcher: getLatestExercisePerformanceByLineage,
      getCurrentRequestKey: () => latestExercisePerformanceRequestKeyRef.current,
    }).then((result) => {
      if (!isMounted || result.stale) return;
      setLatestExercisePerformance(result.performance);
      setLatestExercisePerformanceLoading(result.loading);
      setLatestExercisePerformanceError(result.error);
    });

    return () => {
      isMounted = false;
    };
  }, [activeWorkoutExerciseId, activeWorkoutExerciseLineageId, activeWorkoutStartedAt]);

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
        setProfileAvatar({
          avatarPath: null,
          avatarUrl: null,
          avatarUpdatedAt: null,
        });
        setProfileAvatarLoading(false);
        setProfileAvatarError("");
      }
      return;
    }

    let isMounted = true;
    setProfilePersonalDataLoading(true);
    setProfilePersonalDataError("");
    setProfileAvatarLoading(true);
    setProfileAvatarError("");

    void getProfilePersonalData()
      .then(async (profile) => {
        if (!isMounted) return;
        setProfilePersonalData(profile);
        setSessionName(profile.displayName);
        await refreshProfileAvatar({ force: true, avatarPath: profile.avatarPath });
      })
      .catch((error) => {
        if (!isMounted) return;
        setProfilePersonalDataError(error instanceof Error ? error.message : "No pudimos cargar tu perfil.");
      })
      .finally(() => {
        if (isMounted) {
          setProfilePersonalDataLoading(false);
          setProfileAvatarLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canEditProfilePersonalData, refreshProfileAvatar, screen]);

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

  function applySessionState(authState: SupabaseSessionState) {
    setIsSupabaseConfiguredState(authState.isConfigured);
    setDataMode(authState.dataMode);
    setSupabaseSession(authState.session);
    setSupabaseUser(authState.user);
    setProfilePersonalData(null);
    setProfilePersonalDataError("");
    setProfileAvatar({
      avatarPath: null,
      avatarUrl: null,
      avatarUpdatedAt: null,
    });
    setProfileAvatarResetKey((current) => current + 1);
    setProfileAvatarError("");
    if (authState.user) setSessionName(getSessionDisplayName(authState.user));
  }

  function clearUserSessionState(message: string) {
    clearActiveFlow(dataMode, supabaseUser?.id);
    clearRoutineDraft(dataMode, supabaseUser?.id);
    clearWorkoutDraft(dataMode, supabaseUser?.id);
    resetWorkoutAttemptState();
    setActiveWorkoutStartedAt(null);
    setSupabaseSession(null);
    setSupabaseUser(null);
    setProfilePersonalData(null);
    setProfilePersonalDataLoading(false);
    setProfilePersonalDataError("");
    setProfileAvatar({
      avatarPath: null,
      avatarUrl: null,
      avatarUpdatedAt: null,
    });
    setProfileAvatarResetKey((current) => current + 1);
    setProfileAvatarLoading(false);
    setProfileAvatarError("");
    setDataMode("demo");
    setDataSource("local");
    setExercises([]);
    setEntries([]);
    setTrainingSessions([]);
    setPersistedActiveCycle(null);
    setPersistedCycleHistory([]);
    clearCycleScopedPlanState();
    setExerciseDrafts({});
    setReadiness(null);
    setDailyReadinessRecord(null);
    setDailyReadinessError("");
    setCheckingDailyReadiness(false);
    setSavingDailyReadiness(false);
    setHasStartedTraining(false);
    setScreenHistory([]);
    setIsMenuOpen(false);
    setStatusMessage(message);
    setScreen("login");
  }

  function restoreActiveFlowForSession(mode: DataMode, userId?: string) {
    const activeFlow = loadActiveFlow(mode, userId);
    if (!activeFlow) return false;

    if (activeFlow.flow === "routine_setup" || activeFlow.flow === "routine_edit") {
      return restoreRoutineDraftForSession(mode, userId);
    }

    if (activeFlow.flow === "motivation_form" || activeFlow.flow === "active_workout") {
      return restoreWorkoutDraftForSession(mode, userId);
    }

    if (activeFlow.flow === "training_start") {
      setHasStartedTraining(false);
      setReadiness(null);
      setScreenHistory([]);
      setIsMenuOpen(false);
      setScreen("entrenamiento");
      return true;
    }

    const screenByFlow: Partial<Record<ActiveFlow, Screen>> = {
      dashboard: "dashboard",
      comparison: "comparacion",
      cycle_history: "historial-ciclos",
      profile: "perfil",
    };
    const restoredScreen = screenByFlow[activeFlow.flow];
    if (!restoredScreen) return false;
    setScreenHistory([]);
    setIsMenuOpen(false);
    setScreen(restoredScreen);
    return true;
  }

  function restoreRoutineDraftForSession(mode: DataMode, userId?: string) {
    const draft = loadRoutineDraft(mode, userId);
    if (!draft) return false;

    setSetupDay(draft.setupDay);
    setSetupByDay(draft.setupByDay);
    setTrainingPlan(draft.trainingPlan);
    setIsEditingRoutinePlan(draft.isEditingRoutinePlan);
    setRoutineEditorReturnScreen(draft.routineEditorReturnScreen);
    setActiveRoutineDay(draft.activeRoutineDay);
    setScreenHistory([]);
    setIsMenuOpen(false);
    setStatusMessage("Recuperamos tu avance pendiente.");
    setScreen("registro-entrenamiento");
    return true;
  }

  function restoreWorkoutDraftForSession(mode: DataMode, userId?: string) {
    return restoreWorkoutDraftRecord(loadWorkoutDraft(mode, userId));
  }

  function restoreWorkoutDraftRecord(draft: NonNullable<ReturnType<typeof loadWorkoutDraft>> | null) {
    if (!draft) return false;

    setActiveRoutineDay(draft.activeRoutineDay);
    setActiveExerciseIndex(draft.activeExerciseIndex);
    setActiveWorkoutStartedAt(draft.activeWorkoutStartedAt);
    activeWorkoutAttemptIdRef.current = draft.workoutAttemptId;
    setActiveWorkoutAttemptId(draft.workoutAttemptId);
    setPendingWorkoutReadinessLink(draft.pendingReadinessLink);
    activeWorkoutReadinessContextRef.current = createActiveWorkoutReadinessContext({
      workoutAttemptId: draft.workoutAttemptId,
      cycleId: draft.cycleId,
      cycleDayId: draft.cycleDayId,
      workoutStartedAt: draft.activeWorkoutStartedAt,
      plannedDay: draft.plannedDay,
      plannedDate: draft.plannedDate,
    });
    setHasStartedTraining(draft.hasStartedTraining);
    setReadiness(draft.readiness);
    setExerciseDrafts(draft.exerciseDrafts);
    setIsEditingRoutinePlan(false);
    setScreenHistory([]);
    setIsMenuOpen(false);
    setStatusMessage("Recuperamos tu entrenamiento pendiente.");
    setScreen("entrenamiento");
    return true;
  }

  function restoreActiveWorkoutForNavigation() {
    const draft = loadWorkoutDraft(dataMode, supabaseUser?.id);
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
      setScreenHistory([]);
      setIsMenuOpen(false);
      setScreen("entrenamiento");
      return true;
    }

    if (decision === "restore-draft") {
      return restoreWorkoutDraftRecord(draft);
    }

    return false;
  }

  async function refreshData(mode = dataMode) {
    setIsBusy(true);
    try {
      const next = await loadAppData(mode);
      const shouldPreserveCycleScopedDisplay =
        mode === "supabase" &&
        trainingCyclesRepositoryEnabled &&
        isCycleScopedDisplayLockedRef.current;
      if (!shouldPreserveCycleScopedDisplay) {
        setExercises(next.exercises);
        setEntries(next.entries);
        setTrainingSessions(next.sessions);
        setActiveRoutineDay((current) => getVisibleTrainingDay(next.exercises, current));
        setComparisonDay((current) => getVisibleTrainingDay(next.exercises, current));
        setTrainingPlan((current) => mergeTrainingPlanWithExercises(current, next.exercises));
      }
      setDataSource(next.source);
      setStatusMessage(next.source === "supabase" ? "Progreso actualizado." : "Modo de prueba activo.");
      return next;
    } catch (error) {
      handlePersistenceError(error);
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshProfilePersonalData() {
    if (!canEditProfilePersonalData) {
      setProfilePersonalData(null);
      setProfilePersonalDataLoading(false);
      setProfilePersonalDataError("");
      setProfileAvatar({
        avatarPath: null,
        avatarUrl: null,
        avatarUpdatedAt: null,
      });
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
      setProfilePersonalData(profile);
      setSessionName(profile.displayName);
      await refreshProfileAvatar({ force: true, avatarPath: profile.avatarPath });
      return profile;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No pudimos cargar tu perfil.";
      setProfilePersonalDataError(message);
      return null;
    } finally {
      setProfilePersonalDataLoading(false);
      setProfileAvatarLoading(false);
    }
  }

  async function handleSaveProfilePersonalData(input: ProfilePersonalDataInput) {
    const profile = await updateProfilePersonalData(input);
    setProfilePersonalData(profile);
    setSessionName(profile.displayName);
    return profile;
  }

  async function handleUploadProfileAvatar(file: File) {
    setProfileAvatarError("");
    const avatar = await uploadProfileAvatar(file);
    lastProfileAvatarRefreshAtRef.current = Date.now();
    setProfileAvatar(avatar);
    setProfileAvatarResetKey((current) => current + 1);
    setProfilePersonalData((current) => current
      ? {
        ...current,
        avatarPath: avatar.avatarPath,
        avatarUpdatedAt: avatar.avatarUpdatedAt,
      }
      : current);
  }

  async function handleDeleteProfileAvatar() {
    setProfileAvatarError("");
    const avatar = await deleteProfileAvatar();
    lastProfileAvatarRefreshAtRef.current = 0;
    setProfileAvatar(avatar);
    setProfileAvatarResetKey((current) => current + 1);
    setProfilePersonalData((current) => current
      ? {
        ...current,
        avatarPath: null,
        avatarUpdatedAt: null,
      }
      : current);
  }

  async function refreshPersistedTrainingCycles() {
    if (!isTrainingCyclesRepositoryActive) {
      setPersistedActiveCycle(null);
      setPersistedCycleHistory([]);
      setIsPersistedCyclesLoading(false);
      clearCycleScopedPlanState();
      return;
    }

    setIsPersistedCyclesLoading(true);
    try {
      const [activeCycle, history] = await Promise.all([
        getActiveTrainingCycle(),
        getTrainingCycleHistory(),
      ]);
      setPersistedActiveCycle(activeCycle);
      setPersistedCycleHistory(history);
      if (activeCycle) {
        setTrainingPlan((current) => {
          const next = createTrainingPlanFromPersistedCycle(activeCycle, current);
          saveTrainingPlan(next);
          return next;
        });
        if (isCycleScopedTrainingCycle(activeCycle)) {
          await loadCycleScopedPlanIntoState(activeCycle.id);
        } else {
          clearCycleScopedPlanState();
        }
      } else {
        clearCycleScopedPlanState();
      }
    } catch (error) {
      setStatusMessage(translateTrainingCycleRepositoryError(error));
    } finally {
      setIsPersistedCyclesLoading(false);
    }
  }

  async function loadCycleScopedPlanIntoState(cycleId: string) {
    isCycleScopedDisplayLockedRef.current = true;
    setCycleScopedPlan(null);
    setCycleScopedExercises(null);
    setCycleScopedLoadError("");
    try {
      const scopedPlan = await getCycleScopedTrainingPlan(cycleId);
      const scopedExercises = createExerciseTemplatesFromCycleScopedPlan(scopedPlan);
      const scopedSessionData = await getCycleScopedTrainingSessionData(cycleId, scopedPlan);
      setCycleScopedPlan(scopedPlan);
      setCycleScopedExercises(scopedExercises);
      setEntries(scopedSessionData.entries);
      setTrainingSessions(scopedSessionData.sessions);
      if (scopedExercises.length === 0) {
        setCycleScopedLoadError("El ciclo activo no tiene ejercicios cycle-scoped asociados. Se bloquea el fallback legacy.");
        return;
      }
      setActiveRoutineDay((current) => getVisibleTrainingDay(scopedExercises, current));
      setComparisonDay((current) => getVisibleTrainingDay(scopedExercises, current));
    } catch (error) {
      isCycleScopedDisplayLockedRef.current = false;
      setCycleScopedPlan(null);
      setCycleScopedExercises([]);
      setEntries([]);
      setTrainingSessions([]);
      setCycleScopedLoadError(translateTrainingCycleRepositoryError(error));
      throw error;
    }
  }

  async function createCycleScopedTrainingCycleFromSetup(
    plan: TrainingPlan,
    setupState: Record<string, SetupDayState>,
    activeCycle: PersistedTrainingCycle | null,
  ) {
    if (activeCycle && isProtectedTrainingCycle(activeCycle)) {
      setStatusMessage(PROTECTED_ACTIVE_CYCLE_MESSAGE);
      return false;
    }

    const planInput = createCycleScopedPlanInput(plan, setupState, trainingCyclesSnapshotSource);
    if (!planInput) {
      setTrainingPlan(plan);
      saveTrainingPlan(plan);
      setSetupByDay(setupState);
      setIsEditingRoutinePlan(true);
      setScreen("registro-entrenamiento");
      setStatusMessage("Configura al menos una rutina, un dia y un ejercicio antes de crear el ciclo.");
      return false;
    }

    const plannedStartDate = getSantiagoDateKey(new Date());
    const durationWeeks = getCycleDurationWeeks(plan);
    const plannedEndDate = addDaysToDateKey(plannedStartDate, durationWeeks * 7 - 1);
    const activeCycleToClose = activeCycle?.status === "active" ? activeCycle : null;
    const nextCycleNumber = await getNextTrainingCycleNumber();
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
      });
    }

    const cycleId = await createTrainingCycleWithPlan({
      name: `Ciclo ${nextCycleNumber}`,
      cycleNumber: nextCycleNumber,
      cycleType: plan.cycleType,
      goal: getCycleObjectiveValue(plan),
      durationWeeks,
      plannedStartDate,
      plannedEndDate,
      plan: planInput,
    });

    const scopedPlan = await getCycleScopedTrainingPlan(cycleId);
    const scopedExercises = createExerciseTemplatesFromCycleScopedPlan(scopedPlan);
    isCycleScopedDisplayLockedRef.current = true;
    setTrainingPlan(plan);
    saveTrainingPlan(plan);
    setCycleScopedPlan(scopedPlan);
    setCycleScopedExercises(scopedExercises);
    setCycleScopedLoadError(scopedExercises.length === 0
      ? "El ciclo creado no tiene ejercicios cycle-scoped asociados. Se bloquea el fallback legacy."
      : "");
    setEntries([]);
    setTrainingSessions([]);
    setDataSource("supabase");
    setActiveRoutineDay(getVisibleTrainingDay(scopedExercises, "Lunes"));
    setDashboardDayOverride("");
    setComparisonDay(getVisibleTrainingDay(scopedExercises, "Lunes"));
    setExerciseDrafts({});
    setReadiness(null);
    setHasStartedTraining(false);
    await refreshPersistedTrainingCycles();
    return true;
  }

  useEffect(() => {
    void refreshPersistedTrainingCycles();
  }, [isTrainingCyclesRepositoryActive, supabaseUser?.id]);

  function handlePersistenceError(error: unknown) {
    const message = translatePersistenceError(error);
    setStatusMessage(message);
    if (dataMode === "supabase" && (isSessionExpiredError(error) || message.includes("iniciar sesión"))) {
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
      setDataMode("demo");
      setStatusMessage(getMissingSupabaseMessage());
      await refreshData("demo");
      setStatusMessage(getMissingSupabaseMessage());
      clearAuthForms();
      setScreen("dashboard");
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
        user: session?.user ?? result.data.user ?? null,
      });

      if (!session && mode === "registro") {
        setStatusMessage("Cuenta creada. Revisa tu correo para confirmar el registro.");
        clearAuthForms();
        setScreen("login");
        return;
      }

      setStatusMessage("");
      await refreshData("supabase");
      clearAuthForms();
      setScreen("dashboard");
    } catch (error) {
      setStatusMessage(translateAuthError(error));
    } finally {
      setIsBusy(false);
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

    setIsBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setStatusMessage(translateAuthError(error));
        return;
      }

      setNewPassword("");
      setNewPasswordConfirm("");
      passwordUpdateSuccessRef.current = true;
      await supabase.auth.signOut();
      clearPasswordRecoveryFlow();
      clearPasswordRecoveryUrl();
      setStatusMessage("Contrase\u00f1a actualizada correctamente. Ya puedes iniciar sesi\u00f3n.");
      setScreen("login");
    } catch (error) {
      setStatusMessage(translateAuthError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleResetLocal() {
    if (dataMode === "supabase") {
      setStatusMessage("No se puede realizar esta acción durante tu sesión actual.");
      return;
    }
    resetLocalData();
    void refreshData("demo");
  }

  function navigateTo(nextScreen: Screen) {
    if (nextScreen === screen) {
      setIsMenuOpen(false);
      return;
    }

    if (nextScreen === "dashboard") {
      setTrainingCompletionSummary(null);
    }

    if (nextScreen === "registro-entrenamiento") {
      setSetupByDay(createSetupByDayFromExercises(exercises));
      setSetupDay(getVisibleTrainingDay(exercises, activeRoutineDay));
      setIsEditingRoutinePlan(!hasRoutinePlan);
    } else if (nextScreen === "entrenamiento") {
      if (restoreActiveWorkoutForNavigation()) return;
      setHasStartedTraining(false);
      setReadiness(null);
    } else {
      setIsEditingRoutinePlan(false);
    }
    if (screen !== "login" && screen !== "registro") {
      setScreenHistory((current) => [...current, screen]);
    }
    setScreen(nextScreen);
    setIsMenuOpen(false);
  }

  function goBack() {
    if (screen === "entrenamiento") {
      if (readiness) {
        setScreen("dashboard");
        setScreenHistory([]);
        return;
      }

      if (hasStartedTraining) {
        setHasStartedTraining(false);
        return;
      }
    }

    if (screen === "registro-entrenamiento" && isEditingRoutinePlan && hasRoutinePlan) {
      const target = routineEditorReturnScreen;
      setIsEditingRoutinePlan(false);
      setRoutineEditorReturnScreen(null);

      if (target === "entrenamiento") {
        setHasStartedTraining(false);
        setReadiness(null);
        setScreen("entrenamiento");
        return;
      }

      if (target && target !== "registro-entrenamiento") {
        setScreen(target);
        return;
      }

      return;
    }

    const previous = screenHistory.at(-1);
    if (previous) {
      setScreenHistory((current) => current.slice(0, -1));
      if (previous !== "registro-entrenamiento") {
        setIsEditingRoutinePlan(false);
      }
      setScreen(previous);
      return;
    }

    setScreen("dashboard");
    setScreenHistory([]);
    setIsMenuOpen(false);
  }

  function updateSetupRow(id: string, field: keyof Omit<SetupExerciseRow, "id" | "sourceExerciseId" | "exerciseLineageId">, value: string) {
    setSetupByDay((current) =>
      updateSetupDay(current, setupDay, (state) => ({
        ...state,
        rows: state.rows.map((row) => (
          row.id === id
            ? { ...row, [field]: field === "name" ? value : field === "weight" ? readWeightInput(value, row.weight) : readSetupNumber(value) }
            : row
        )),
      })),
    );
  }

  function updateSetupRoutineName(value: string) {
    setSetupByDay((current) =>
      updateSetupDay(current, setupDay, (state) => ({ ...state, routineName: value })),
    );
  }

  function updateTrainingPlan(patch: Partial<TrainingPlan>) {
    setTrainingPlan((current) => {
      const next = { ...current, ...patch };
      if (patch.trainingDays) {
        const days = sortTrainingDaysByWeekOrder(
          patch.trainingDays.length > 0 ? patch.trainingDays : [setupDay],
        );
        next.trainingDays = days;
        if (!days.includes(setupDay)) setSetupDay(days[0]);
      }
      return next;
    });
  }

  function addSetupRow() {
    setSetupByDay((current) =>
      updateSetupDay(current, setupDay, (state) => ({ ...state, rows: [...state.rows, createSetupRow()] })),
    );
  }

  function removeSetupRow(id: string) {
    const row = setupByDay[setupDay]?.rows.find((item) => item.id === id);
    if (
      isTrainingCyclesRepositoryActive &&
      persistedActiveCycle &&
      isCycleScopedTrainingCycle(persistedActiveCycle) &&
      row?.sourceExerciseId
    ) {
      const hasRegisteredEntry = displayEntries.some((entry) =>
        (entry.trainingCycleExerciseId ?? entry.exerciseId) === row.sourceExerciseId);
      const confirmed = window.confirm(hasRegisteredEntry
        ? "¿Eliminar este ejercicio de la planificacion? El historial anterior se conservara."
        : "¿Eliminar este ejercicio de la planificacion?");
      if (!confirmed) return;
    }

    setSetupByDay((current) =>
      updateSetupDay(current, setupDay, (state) => {
        const isCycleScopedEdit = Boolean(
          isTrainingCyclesRepositoryActive &&
          persistedActiveCycle &&
          isCycleScopedTrainingCycle(persistedActiveCycle),
        );
        return {
          ...state,
          rows: isCycleScopedEdit || state.rows.length > 1
            ? state.rows.filter((row) => row.id !== id)
            : state.rows,
        };
      }),
    );
  }

  function openRoutineEditor(day = visibleDay) {
    setSetupByDay(createSetupByDayFromExercises(displayExercises));
    setSetupDay(day);
    setIsEditingRoutinePlan(true);
    setRoutineEditorReturnScreen(screen);
    if (screen === "entrenamiento") {
      setHasStartedTraining(false);
      setReadiness(null);
    }
    setIsMenuOpen(false);
    setScreen("registro-entrenamiento");
  }

  function cancelRoutineUpdate() {
    const activeDays = getRoutineDays(exercises);
    clearRoutineDraft(dataMode, supabaseUser?.id);
    setTrainingPlan((current) => ({ ...current, trainingDays: activeDays }));
    setSetupByDay(createSetupByDayFromExercises(exercises));
    setSetupDay(activeDays.includes(activeRoutineDay) ? activeRoutineDay : activeDays[0] ?? "Lunes");
    setIsRoutineUpdateConfirmOpen(false);
    setStatusMessage("No se realizaron cambios en la rutina.");
  }

  async function saveInitialRoutine(confirmedRoutineUpdate = false) {
    const dayState = setupByDay[setupDay] ?? createSetupDayState();
    const routineName = dayState.routineName.trim() || setupDay;
    const nonEmptyRows = dayState.rows.filter((row) => row.name.trim());
    const validRows = isTrainingCyclesRepositoryActive
      ? nonEmptyRows
      : dedupeExerciseRowsByName(nonEmptyRows);
    const invalidWeightRow = nonEmptyRows.find((row) => row.weight.trim() !== "" && parseDecimalWeightInput(row.weight) === null);
    if (invalidWeightRow) {
      setStatusMessage(`Completa el peso de "${invalidWeightRow.name.trim()}" con un decimal valido.`);
      return;
    }
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
    const nextIncompleteDay = plannedDays.find((day) => day !== setupDay && !completedDays.includes(day));
    const allPlannedDaysComplete = plannedDays.every((day) => completedDays.includes(day));
    const daysToPersist = plannedDays.filter((day) => nextSetupByDay[day]?.rows.some((row) => row.name.trim()));

    if (validRows.length === 0 && !isCycleScopedRoutineEdit) {
      setStatusMessage("Agrega al menos un ejercicio para crear la rutina.");
      return;
    }

    if (isChangingRoutineDays && !isTrainingCyclesRepositoryActive && !confirmedRoutineUpdate) {
      setIsRoutineUpdateConfirmOpen(true);
      return;
    }

    if (isTrainingCyclesRepositoryActive) {
      setIsRoutineUpdateConfirmOpen(false);
      setSetupByDay(nextSetupByDay);

      if (!allPlannedDaysComplete && nextIncompleteDay) {
        const successMessage = `Rutina de ${setupDay} preparada.`;
        setStatusMessage(`${successMessage} Ahora configura ${nextIncompleteDay}.`);
        setRoutineNotice(successMessage);
        setIsEditingRoutinePlan(true);
        setSetupDay(nextIncompleteDay);
        setScreen("registro-entrenamiento");
        return;
      }

      setIsBusy(true);
      try {
        const activeCycle = await getActiveTrainingCycle();
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
              sortOrder: setupDays.indexOf(day),
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

          const result = await addCycleScopedTrainingDaysAndExercises({
            cycleId: activeCycle.id,
            days,
          });
          await loadCycleScopedPlanIntoState(activeCycle.id);
          clearRoutineDraft(dataMode, supabaseUser?.id);
          setIsEditingRoutinePlan(false);
          setActiveRoutineDay(setupDay);
          setRoutineNotice(
            `${result.daysAdded} dia${result.daysAdded === 1 ? "" : "s"}, ${result.exercisesAdded} ejercicio${result.exercisesAdded === 1 ? "" : "s"} nuevo${result.exercisesAdded === 1 ? "" : "s"}, ${result.exercisesUpdated} editado${result.exercisesUpdated === 1 ? "" : "s"} y ${result.exercisesRetired} retirado${result.exercisesRetired === 1 ? "" : "s"}.`,
          );
          setStatusMessage("Plan cycle-scoped actualizado. El historial anterior se conserva.");
          setIsRoutineSuccessOpen(true);
          setScreen("entrenamiento");
          return;
        }

        const created = await createCycleScopedTrainingCycleFromSetup(trainingPlan, nextSetupByDay, activeCycle);
        if (!created) return;

        clearRoutineDraft(dataMode, supabaseUser?.id);
        setIsEditingRoutinePlan(false);
        setActiveRoutineDay(setupDay);
        setRoutineNotice("Plan cycle-scoped creado correctamente.");
        setStatusMessage("Ciclo y plan operativo creados correctamente en QA.");
        setIsRoutineSuccessOpen(true);
        setScreen("entrenamiento");
      } catch (error) {
        setStatusMessage(translateTrainingCycleRepositoryError(error));
      } finally {
        setIsBusy(false);
      }
      return;
    }

    setIsRoutineUpdateConfirmOpen(false);
    setSetupByDay(nextSetupByDay);
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
          await deleteExercise(exerciseId, dataMode);
        }

        for (const row of rowsToPersist) {
          await saveExercise({
            id: row.sourceExerciseId ?? row.id,
            routine: currentRoutineName,
            day: dayToPersist,
            name: row.name.trim(),
            targetSets: Math.max(1, row.sets || 1),
            targetReps: Math.max(1, row.reps || 1),
            baseWeight: readRequiredWeight(row.weight),
            notes: `Rutina creada para ${dayToPersist}.`,
          }, dataMode);
        }
      }

      const refreshedData = await refreshData(dataMode);
      if (!refreshedData) return;
      setActiveRoutineDay(setupDay);
      setSetupByDay(nextSetupByDay);
      const successMessage = `Rutina de ${setupDay} guardada.`;
      setStatusMessage(nextIncompleteDay ? `${successMessage} Ahora configura ${nextIncompleteDay}.` : "Registro de rutina finalizado.");
      setRoutineNotice(successMessage);
      if (!allPlannedDaysComplete && nextIncompleteDay) {
        setIsEditingRoutinePlan(true);
        setSetupDay(nextIncompleteDay);
        setScreen("registro-entrenamiento");
      } else {
        clearRoutineDraft(dataMode, supabaseUser?.id);
        setIsEditingRoutinePlan(false);
        setActiveRoutineDay(setupDay);
        setReadiness(null);
        setIsRoutineSuccessOpen(true);
      }
    } catch (error) {
      handlePersistenceError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    setIsBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
      clearUserSessionState("Sesión cerrada correctamente.");
    } catch (error) {
      setStatusMessage(translateAuthError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function openRoutineDay(day: string, keepTrainingStarted = false) {
    if (!keepTrainingStarted && restoreActiveWorkoutForNavigation()) return;

    setActiveRoutineDay(day);
    setActiveExerciseIndex(0);
    setRoutineNotice("");
    if (!keepTrainingStarted) {
      setHasStartedTraining(false);
      setReadiness(null);
    }
    setScreen("entrenamiento");
  }

  async function startNewTrainingCycle() {
    if (isNewCycleTransitionRef.current) return;

    if (dataMode === "supabase") {
      if (!isTrainingCyclesRepositoryActive) {
        setStatusMessage("Esta acción estará disponible en el siguiente paso.");
        setIsNewCycleConfirmOpen(false);
        return;
      }

      isNewCycleTransitionRef.current = true;
      setIsBusy(true);
      try {
        const activeCycle = await getActiveTrainingCycle();

        const nextPlan = createControlledNextTrainingPlan();
        const freshSetup = createSetupByDay();
        const activeCycleToClose = activeCycle?.status === "active" ? activeCycle : null;

        if (activeCycleToClose) {
          const endedAt = new Date().toISOString();
          await completeTrainingCycle({
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
          });
        }

        clearActiveFlow(dataMode, supabaseUser?.id);
        clearRoutineDraft(dataMode, supabaseUser?.id);
        clearWorkoutDraft(dataMode, supabaseUser?.id);
        resetWorkoutAttemptState();
        setActiveWorkoutStartedAt(null);
        setPersistedActiveCycle(null);
        clearCycleScopedPlanState();
        setSetupByDay(freshSetup);
        setSetupDay("Lunes");
        setTrainingPlan(nextPlan);
        saveTrainingPlan(nextPlan);
        setExercises([]);
        setEntries([]);
        setTrainingSessions([]);
        setActiveRoutineDay("Lunes");
        setDashboardDayOverride("");
        setComparisonDay("Lunes");
        setExerciseDrafts({});
        setReadiness(null);
        setHasStartedTraining(false);
        setIsEditingRoutinePlan(true);
        setScreen("registro-entrenamiento");
        setStatusMessage(activeCycle
          ? "Ciclo actual finalizado. Configura el nuevo plan antes de crearlo."
          : "Configura el plan del nuevo ciclo antes de crearlo.");
      } catch (error) {
        setStatusMessage(translateTrainingCycleRepositoryError(error));
      } finally {
        isNewCycleTransitionRef.current = false;
        setIsBusy(false);
        setIsNewCycleConfirmOpen(false);
      }
      return;
    }

    const snapshot = createTrainingCycleSnapshot(cycleHistory.length + 1, trainingPlan, exercises, entries);
    clearRoutineDraft(dataMode, supabaseUser?.id);
    const nextHistory = [...cycleHistory, snapshot];
    setCycleHistory(nextHistory);
    saveCycleHistory(nextHistory);

    const nextPlan = createDefaultTrainingPlan();
    replaceLocalData([], []);
    setExercises([]);
    setEntries([]);
    setTrainingSessions([]);
    setSetupByDay(createSetupByDay());
    setSetupDay("Lunes");
    setTrainingPlan(nextPlan);
    saveTrainingPlan(nextPlan);
    setActiveRoutineDay("Lunes");
    setDashboardDayOverride("");
    setComparisonDay("Lunes");
    setExerciseDrafts({});
    setReadiness(null);
    setIsEditingRoutinePlan(true);
    setIsNewCycleConfirmOpen(false);
    setStatusMessage("Ciclo actual finalizado. Ya puedes crear un nuevo ciclo de entrenamiento.");
    setScreen("registro-entrenamiento");
  }

  async function deleteCurrentTrainingCycle() {
    setIsBusy(true);
    try {
      if (isTrainingCyclesRepositoryActive) {
        const activeCycle = persistedActiveCycle ?? await getActiveTrainingCycle();
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
        await cancelTrainingCycle({
          endedAt,
          summarySnapshot: createPersistedCycleSummarySnapshot(
            trainingPlan,
            displayExercises,
            displayEntries,
            activeCycle.startedAt,
            endedAt,
            trainingCyclesSnapshotSource,
          ),
        });

        const nextPlan = createDefaultTrainingPlan();
        clearRoutineDraft(dataMode, supabaseUser?.id);
        clearWorkoutDraft(dataMode, supabaseUser?.id);
        resetWorkoutAttemptState();
        setActiveWorkoutStartedAt(null);
        clearCycleScopedPlanState();
        setTrainingPlan(nextPlan);
        saveTrainingPlan(nextPlan);
        setSetupByDay(createSetupByDay());
        setSetupDay("Lunes");
        setActiveRoutineDay("Lunes");
        setDashboardDayOverride("");
        setComparisonDay("Lunes");
        setExerciseDrafts({});
        setReadiness(null);
        setHasStartedTraining(false);
        setIsEditingRoutinePlan(true);
        setIsDeleteCycleConfirmOpen(false);
        setStatusMessage("Ciclo cancelado. Ya puedes configurar un nuevo ciclo de entrenamiento.");
        setScreen("registro-entrenamiento");
        await refreshPersistedTrainingCycles();
        return;
      }

      await deactivateActiveCycle(dataMode);
      clearRoutineDraft(dataMode, supabaseUser?.id);
      clearWorkoutDraft(dataMode, supabaseUser?.id);
      resetWorkoutAttemptState();
      setActiveWorkoutStartedAt(null);
      await refreshData(dataMode);

      const nextPlan = createDefaultTrainingPlan();
      setTrainingPlan(nextPlan);
      saveTrainingPlan(nextPlan);
      setSetupByDay(createSetupByDay());
      setSetupDay("Lunes");
      setActiveRoutineDay("Lunes");
      setDashboardDayOverride("");
      setComparisonDay("Lunes");
      setExerciseDrafts({});
      setReadiness(null);
      setHasStartedTraining(false);
      setIsEditingRoutinePlan(true);
      setIsDeleteCycleConfirmOpen(false);
      setStatusMessage("Ciclo eliminado. Ya puedes configurar un nuevo ciclo de entrenamiento.");
      setScreen("registro-entrenamiento");
    } catch (error) {
      if (error instanceof TrainingCycleRepositoryError) {
        setStatusMessage(translateTrainingCycleRepositoryError(error));
      } else if (isSessionExpiredError(error)) {
        clearUserSessionState("Tu sesión expiró. Inicia sesión nuevamente.");
      } else {
        setStatusMessage(translatePersistenceError(error));
      }
    } finally {
      setIsBusy(false);
    }
  }

  function updateExerciseDraft(exercise: ExerciseTemplate, patch: Partial<ExerciseDraft>) {
    setExerciseDrafts((current) => ({
      ...current,
      [exercise.id]: {
        ...createExerciseDraft(exercise),
        ...current[exercise.id],
        ...patch,
      },
    }));
  }


  function createActiveWorkoutReadinessContext(input: {
    workoutAttemptId: string | null;
    cycleId: string | null;
    cycleDayId: string | null;
    workoutStartedAt: string | null;
    plannedDay?: string | null;
    plannedDate?: string | null;
  }): ActiveWorkoutReadinessContext | null {
    if (!isNonEmptyString(input.workoutAttemptId) ||
      !isNonEmptyString(input.cycleId) ||
      !isNonEmptyString(input.cycleDayId) ||
      !isNonEmptyString(input.workoutStartedAt)) {
      return null;
    }
    return {
      workoutAttemptId: input.workoutAttemptId,
      cycleId: input.cycleId,
      cycleDayId: input.cycleDayId,
      workoutStartedAt: input.workoutStartedAt,
      plannedDay: input.plannedDay ?? null,
      plannedDate: input.plannedDate ?? null,
    };
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
    saveWorkoutDraft({
      version: WORKOUT_DRAFT_VERSION,
      updatedAt: Date.now(),
      dataMode,
      userKey: getDraftUserKey(dataMode, supabaseUser?.id),
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
  function setPendingWorkoutReadinessLink(link: PendingWorkoutReadinessLink | null) {
    pendingReadinessLinkRef.current = link;
    setPendingReadinessLink(link);
  }

  function resetWorkoutAttemptState() {
    activeWorkoutAttemptIdRef.current = null;
    activeWorkoutReadinessContextRef.current = null;
    setActiveWorkoutAttemptId(null);
    setPendingWorkoutReadinessLink(null);
    setHasRecoverableWorkoutStart(false);
  }

  function markWorkoutStartedAt() {
    setActiveWorkoutStartedAt((current) => current ?? createStableWorkoutStartedAt());
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

    setActiveWorkoutStartedAt(startedAt);
    activeWorkoutAttemptIdRef.current = attemptId;
    setActiveWorkoutAttemptId(attemptId);
    setPendingWorkoutReadinessLink(nextPendingReadinessLink);
    activeWorkoutReadinessContextRef.current = createActiveWorkoutReadinessContext({
      workoutAttemptId: attemptId,
      cycleId,
      cycleDayId,
      workoutStartedAt: startedAt,
      plannedDay,
      plannedDate,
    });
    setHasRecoverableWorkoutStart(false);
    setActiveExerciseIndex(nextActiveExerciseIndex);
    setHasStartedTraining(true);

    saveWorkoutDraft({
      version: WORKOUT_DRAFT_VERSION,
      updatedAt: Date.now(),
      dataMode,
      userKey: getDraftUserKey(dataMode, supabaseUser?.id),
      activeRoutineDay,
      activeExerciseIndex: nextActiveExerciseIndex,
      activeWorkoutStartedAt: startedAt,
      hasStartedTraining: true,
      readiness,
      exerciseDrafts,
      workoutAttemptId: attemptId,
      pendingReadinessLink: nextPendingReadinessLink,
      cycleId,
      cycleDayId,
      plannedDay,
      plannedDate,
    });

    return { startedAt, attemptId, cycleId, cycleDayId, plannedDay, plannedDate, pendingReadinessLink: nextPendingReadinessLink };
  }

  async function startTrainingWithDailyReadiness() {
    if (!tryAcquireWorkoutStartLock(workoutStartInFlightRef)) return;

    try {
      if (checkingDailyReadiness || savingDailyReadiness) return;

      const firstPendingIndex = dayExercises.findIndex((exercise) =>
        !isExerciseRegisteredInCurrentWorkout(exercise, exerciseDrafts));
      const nextActiveExerciseIndex = firstPendingIndex >= 0 ? firstPendingIndex : 0;
      setDailyReadinessError("");
      setRoutineNotice("");

      let startSnapshot: ReturnType<typeof prepareWorkoutStartSnapshot>;
      try {
        startSnapshot = prepareWorkoutStartSnapshot(nextActiveExerciseIndex);
      } catch (error) {
        const message = error instanceof Error ? error.message : "No pudimos preparar el entrenamiento.";
        setDailyReadinessError(message);
        setRoutineNotice(message);
        return;
      }

      let readinessMode: TrainingWorkoutReadinessMode;
      try {
        readinessMode = resolveCurrentReadinessMode();
      } catch (error) {
        const message = error instanceof TrainingWorkoutReadinessFlowError ? error.message : "No pudimos preparar el formulario de entrenamiento.";
        setDailyReadinessError(message);
        setRoutineNotice(message);
        return;
      }

      if (readinessMode === "attempt_v2") {
        return;
      }

      if (dataMode !== "supabase" || !hasSupabaseSession) {
        return;
      }

      setCheckingDailyReadiness(true);
      try {
        const record = await getDailyTrainingReadiness();
        setDailyReadinessRecord(record);
        setReadiness(record?.payload ?? null);
        setHasRecoverableWorkoutStart(false);
      } catch (error) {
        const message = translateDailyReadinessError(error);
        if (trainingWorkoutReadinessV2Enabled && startSnapshot.attemptId) {
          setHasStartedTraining(false);
          setHasRecoverableWorkoutStart(true);
          setDailyReadinessError(message);
          setRoutineNotice(message);
          return;
        }

        clearWorkoutDraft(dataMode, supabaseUser?.id);
        setHasStartedTraining(false);
        setActiveWorkoutStartedAt(null);
        resetWorkoutAttemptState();
        setDailyReadinessError(message);
        setRoutineNotice(message);
      } finally {
        setCheckingDailyReadiness(false);
      }
    } finally {
      releaseWorkoutStartLock(workoutStartInFlightRef);
    }
  }

  async function submitDailyReadiness(value: Omit<TrainingReadiness, "skipped">) {
    await persistDailyReadiness({ ...value, skipped: false });
  }

  async function skipDailyReadiness() {
    await persistDailyReadiness({ skipped: true });
  }

  async function persistDailyReadiness(value: TrainingReadiness) {
    if (!tryAcquireWorkoutStartLock(dailyReadinessSaveInFlightRef)) return;

    try {
      if (savingDailyReadiness) return;
      setDailyReadinessError("");

      let readinessMode: TrainingWorkoutReadinessMode;
      try {
        readinessMode = resolveCurrentReadinessMode();
      } catch (error) {
        const message = error instanceof TrainingWorkoutReadinessFlowError ? error.message : "No pudimos preparar el formulario de entrenamiento.";
        setDailyReadinessError(message);
        return;
      }

      if (readinessMode === "legacy") {
        if (dataMode !== "supabase" || !hasSupabaseSession) {
          setReadiness(value);
          return;
        }

        setSavingDailyReadiness(true);
        try {
          const record = await saveDailyTrainingReadiness(value);
          setDailyReadinessRecord(record);
          setReadiness(record.payload);
        } catch (error) {
          setDailyReadinessError(translateDailyReadinessError(error));
        } finally {
          setSavingDailyReadiness(false);
        }
        return;
      }

      const context = activeWorkoutReadinessContextRef.current;
      if (!context) {
        setDailyReadinessError("No pudimos recuperar la identidad del entrenamiento. Recarga e intenta nuevamente.");
        return;
      }

      let payload: TrainingWorkoutReadinessPayload;
      try {
        payload = toTrainingWorkoutReadinessPayload(value);
      } catch (error) {
        setDailyReadinessError(error instanceof Error ? error.message : "Completa tu formulario diario antes de continuar.");
        return;
      }

      setSavingDailyReadiness(true);
      try {
        const record = await saveTrainingWorkoutReadiness({
          workoutAttemptId: context.workoutAttemptId,
          cycleId: context.cycleId,
          cycleDayId: context.cycleDayId,
          workoutStartedAt: context.workoutStartedAt,
          payload,
        });
        if (record.contextMismatch) {
          setDailyReadinessError("Este intento ya tiene un formulario guardado con informacion diferente. Recarga el entrenamiento para recuperar sus datos.");
          return;
        }
        setDailyReadinessRecord(null);
        setReadiness(record.payload);
        setHasRecoverableWorkoutStart(false);
        setPendingReadinessLink(null);
        persistCurrentWorkoutDraftSnapshot(record.payload);
      } catch (error) {
        setDailyReadinessError(translateTrainingWorkoutReadinessError(error));
      } finally {
        setSavingDailyReadiness(false);
      }
    } finally {
      releaseWorkoutStartLock(dailyReadinessSaveInFlightRef);
    }
  }

  function registerCurrentExercise() {
    if (isBusy) return;

    const exercise = dayExercises[activeExerciseIndex];
    if (!exercise) return;
    if (isExerciseRegisteredInCurrentWorkout(exercise, exerciseDrafts)) {
      const nextPendingIndex = dayExercises.findIndex((item, index) =>
        index > activeExerciseIndex &&
        !isExerciseRegisteredInCurrentWorkout(item, exerciseDrafts));
      if (nextPendingIndex >= 0) setActiveExerciseIndex(nextPendingIndex);
      return;
    }
    const draft = normalizeExerciseDraft(exercise, exerciseDrafts[exercise.id]);
    const requiredReps = draft.reps.slice(0, exercise.targetSets);
    if (draft.weight.trim() === "" || parseDecimalWeightInput(draft.weight) === null || requiredReps.some((value) => value === "")) {
      setRoutineNotice("Completa peso y series antes de registrar el ejercicio.");
      return;
    }
    setRoutineNotice("");
    updateExerciseDraft(exercise, { ...draft, registered: true });
    setActiveExerciseIndex((index) => Math.min(index + 1, Math.max(0, dayExercises.length - 1)));
  }

  async function confirmTrainingWorkoutReadinessLink(pendingLink: PendingWorkoutReadinessLink) {
    const result = await linkTrainingWorkoutReadinessSession({
      workoutAttemptId: pendingLink.workoutAttemptId,
      trainingSessionId: pendingLink.trainingSessionId,
    });

    if (result.trainingSessionId !== pendingLink.trainingSessionId) {
      throw new TrainingWorkoutReadinessLinkFlowError("La vinculacion del formulario no coincide con la sesion guardada.");
    }
    if (!result.linked && !result.alreadyLinked) {
      throw new TrainingWorkoutReadinessLinkFlowError("No pudimos confirmar la vinculacion del formulario con la sesion guardada.");
    }
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
    setPendingWorkoutReadinessLink(input.pendingLink);
    saveWorkoutDraft({
      version: WORKOUT_DRAFT_VERSION,
      updatedAt: Date.now(),
      dataMode,
      userKey: getDraftUserKey(dataMode, supabaseUser?.id),
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
  }

  function finishCompletedWorkout() {
    clearWorkoutDraft(dataMode, supabaseUser?.id);
    resetWorkoutAttemptState();
    setActiveWorkoutStartedAt(null);
    setReadiness(null);
    setHasStartedTraining(false);
    setScreen("dashboard");
  }

  async function buildCompletedTrainingSummarySnapshot(input: {
    sessionId: string;
    validExercises: ExerciseTemplate[];
    capturedExerciseDrafts: Record<string, ExerciseDraft>;
    workoutStartedAt: string | null;
    savedAt: string;
    trainedDate: string;
  }) {
    const historicalEntries = await Promise.allSettled(input.validExercises.map(async (exercise) => {
      if (!exercise.exerciseLineageId) {
        return [exercise.id, { status: "first_reference", latest: null } satisfies TrainingCompletionHistoricalInput] as const;
      }

      const latest = await getLatestExercisePerformanceByLineage({
        exerciseLineageId: exercise.exerciseLineageId,
        currentSessionId: input.sessionId,
      });

      return [
        exercise.id,
        latest
          ? { status: "ready", latest } satisfies TrainingCompletionHistoricalInput
          : { status: "first_reference", latest: null } satisfies TrainingCompletionHistoricalInput,
      ] as const;
    }));

    const historicalByExerciseId: Record<string, TrainingCompletionHistoricalInput> = {};
    historicalEntries.forEach((result, index) => {
      const exercise = input.validExercises[index];
      if (!exercise) return;
      if (result.status === "fulfilled") {
        historicalByExerciseId[result.value[0]] = result.value[1];
      } else {
        historicalByExerciseId[exercise.id] = { status: "unavailable", latest: null };
      }
    });
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
      exercises: input.validExercises.map((exercise) => {
        const draft = normalizeExerciseDraft(exercise, input.capturedExerciseDrafts[exercise.id]);
        return {
          exerciseId: exercise.id,
          exerciseLineageId: exercise.exerciseLineageId ?? null,
          exerciseName: exercise.name,
          targetSets: exercise.targetSets,
          draft: {
            weight: draft.weight,
            reps: draft.reps,
          },
        };
      }),
      historicalByExerciseId,
    });
  }

  async function saveCompletedTraining() {
    if (!tryAcquireWorkoutStartLock(workoutCompletionInFlightRef)) return;
    let saveLockAcquired = false;

    try {
      if (isBusy) return;
      if (!acquireWorkoutSaveLock(isSavingTrainingRef)) return;
      saveLockAcquired = true;

      const recoveredPendingLink = pendingReadinessLinkRef.current;
      if (recoveredPendingLink) {
        setIsBusy(true);
        setRoutineNotice("");
        try {
          await confirmTrainingWorkoutReadinessLink(recoveredPendingLink);
          setStatusMessage("Entrenamiento guardado.");
          finishCompletedWorkout();
        } catch (error) {
          setRoutineNotice(translateTrainingWorkoutReadinessLinkError(error));
        } finally {
          setIsBusy(false);
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

      const isCycleScopedSave = Boolean(
        isTrainingCyclesRepositoryActive &&
        persistedActiveCycle &&
        isCycleScopedTrainingCycle(persistedActiveCycle),
      );
      const shouldLinkWorkoutReadiness = readinessMode === "attempt_v2";
      const readinessContext = activeWorkoutReadinessContextRef.current;
      const capturedWorkoutAttemptId = activeWorkoutAttemptIdRef.current;

      if (shouldLinkWorkoutReadiness) {
        if (!readinessContext || !isNonEmptyString(capturedWorkoutAttemptId)) {
          setRoutineNotice("No pudimos recuperar la identidad del entrenamiento. Recarga e intenta nuevamente.");
          return;
        }
      }

      const savePlan = buildCurrentWorkoutSavePlan(dayExercises, exerciseDrafts);
      const { validExercises } = savePlan;
      if (!savePlan.canSave) {
        setRoutineNotice(savePlan.message ?? incompleteCurrentWorkoutMessage);
        return;
      }

      if (isCycleScopedSave && persistedActiveCycle) {
        if (!cycleScopedPlan) {
          setRoutineNotice("No se pudo cargar el plan cycle-scoped del ciclo activo. No se guardaran datos legacy.");
          return;
        }

        const trainedDate = todayKey;
        const plannedDay = getTrainingDayCode(visibleDay);
        const cycleDay = findCycleScopedDayForTrainingDay(cycleScopedPlan, persistedActiveCycle.id, plannedDay);

        if (!cycleDay) {
          setRoutineNotice("No se encontro el dia cycle-scoped activo. No se guardaran datos legacy.");
          return;
        }

        if (!persistedActiveCycle.plannedStartDate) {
          setRoutineNotice("El ciclo activo no tiene un rango planificado valido. No se guardaran datos legacy.");
          return;
        }

        let plannedDate: string;
        let effectiveWeekNumber: number;
        try {
          effectiveWeekNumber = getCycleCalendarWeekNumber(persistedActiveCycle.plannedStartDate, trainedDate);
          plannedDate = getCycleCalendarPlannedDate({
            plannedStartDate: persistedActiveCycle.plannedStartDate,
            weekNumber: effectiveWeekNumber,
            plannedDay: cycleDay.dayCode,
          });
        } catch {
          setRoutineNotice("No se pudo resolver la fecha planificada dentro del rango del ciclo. No se guardaran datos legacy.");
          return;
        }

        const entriesInput: CycleScopedTrainingSessionEntryInput[] = [];
        for (const exercise of validExercises) {
          const cycleExercise = cycleDay.exercises.find((item) => item.id === exercise.id);
          if (!cycleExercise) {
            setRoutineNotice("No se encontro el ejercicio cycle-scoped planificado. No se guardaran datos legacy.");
            return;
          }

          const draft = normalizeExerciseDraft(exercise, exerciseDrafts[exercise.id]);
          entriesInput.push({
            id: createId(),
            trainingCycleExerciseId: cycleExercise.id,
            exerciseId: cycleExercise.sourceLegacyExerciseId ?? null,
            exerciseLineageId: cycleExercise.exerciseLineageId,
            weight: readRequiredWeight(draft.weight),
            previousWeight: exercise.baseWeight,
            reps: draft.reps.slice(0, exercise.targetSets).map((value) => Number(value) || 0),
            rir: draft.rir,
            notes: `Entrenamiento ${visibleDay}: ${exercise.routine}. ${formatReadinessNote(readiness)}`,
          });
        }

        const capturedActiveRoutineDay = activeRoutineDay;
        const capturedActiveExerciseIndex = activeExerciseIndex;
        const capturedReadiness = readiness;
        const capturedExerciseDrafts = exerciseDrafts;
        const capturedStartedAt = readinessContext?.workoutStartedAt ?? activeWorkoutStartedAt;
        const capturedCycleId = readinessContext?.cycleId ?? persistedActiveCycle.id;
        const capturedCycleDayId = readinessContext?.cycleDayId ?? cycleDay.id;

        if (shouldLinkWorkoutReadiness && !isNonEmptyString(capturedStartedAt)) {
          setRoutineNotice("No pudimos recuperar la identidad temporal del entrenamiento. Recarga e intenta nuevamente.");
          return;
        }

        setIsBusy(true);
        setRoutineNotice("");
        let savedTrainingSessionId: string;
        try {
          savedTrainingSessionId = await createTrainingSessionWithCycleEntries({
            cycleId: persistedActiveCycle.id,
            cycleDayId: cycleDay.id,
            plannedDay,
            plannedDate,
            trainedDate,
            weekNumber: effectiveWeekNumber,
            status: "completed",
            notes: `Entrenamiento ${visibleDay}: ${visibleRoutine}. ${formatReadinessNote(readiness)}`,
            entries: entriesInput,
          });
        } catch (error) {
          setRoutineNotice(handlePersistenceError(error));
          setIsBusy(false);
          return;
        }

        if (shouldLinkWorkoutReadiness) {
          let nextPendingLink: PendingWorkoutReadinessLink;
          try {
            const createdPendingLink = createWorkoutReadinessPendingLink({
              enabled: trainingWorkoutReadinessV2Enabled,
              cycleScoped: true,
              workoutAttemptId: capturedWorkoutAttemptId,
              trainingSessionId: savedTrainingSessionId,
            });
            if (!createdPendingLink) throw new TrainingWorkoutReadinessLinkFlowError();
            nextPendingLink = createdPendingLink;
          } catch (error) {
            setRoutineNotice(translateTrainingWorkoutReadinessLinkError(error));
            setIsBusy(false);
            return;
          }

          persistWorkoutDraftWithPendingLink({
            pendingLink: nextPendingLink,
            workoutAttemptId: nextPendingLink.workoutAttemptId,
            activeWorkoutStartedAt: capturedStartedAt ?? createStableWorkoutStartedAt(),
            plannedDay,
            plannedDate,
            cycleId: capturedCycleId,
            cycleDayId: capturedCycleDayId,
            activeRoutineDay: capturedActiveRoutineDay,
            activeExerciseIndex: capturedActiveExerciseIndex,
            readiness: capturedReadiness,
            exerciseDrafts: capturedExerciseDrafts,
          });

          try {
            await confirmTrainingWorkoutReadinessLink(nextPendingLink);
          } catch (error) {
            setRoutineNotice(translateTrainingWorkoutReadinessLinkError(error));
            setIsBusy(false);
            return;
          }
        }

        const summarySnapshot = await buildCompletedTrainingSummarySnapshot({
          sessionId: savedTrainingSessionId,
          validExercises,
          capturedExerciseDrafts,
          workoutStartedAt: capturedStartedAt,
          savedAt: new Date().toISOString(),
          trainedDate,
        });
        setTrainingCompletionSummary(summarySnapshot);

        setExerciseDrafts((current) => {
          const next = { ...current };
          for (const exercise of validExercises) delete next[exercise.id];
          return next;
        });
        setStatusMessage("Entrenamiento guardado.");
        try {
          finishCompletedWorkout();
          setScreen("training-summary");
        } catch {
          // El entrenamiento ya fue persistido; un fallo local de limpieza no debe habilitar duplicados.
        }

        try {
          const scopedSessionData = await getCycleScopedTrainingSessionData(persistedActiveCycle.id, cycleScopedPlan);
          setEntries(scopedSessionData.entries);
          setTrainingSessions(scopedSessionData.sessions);
        } catch {
          setCycleScopedLoadError("Entrenamiento guardado. Recarga el panel para ver la sesion registrada.");
        } finally {
          setIsBusy(false);
        }
        return;
      }

      setIsBusy(true);
      setRoutineNotice("");
      try {
        const currentWeekDates = getCurrentSantiagoWeekDates();
        const plannedDate = currentWeekDates[visibleDay] ?? todayKey;
        const trainedDate = todayKey;
        const plannedDay = getTrainingDayCode(visibleDay);
        const trainingWeek = getLegacyWeekNumberForTrainingDate(trainingSessions, entries, trainedDate);
        const capturedExerciseDrafts = exerciseDrafts;
        const capturedStartedAt = activeWorkoutStartedAt;
        const savedSession = await saveTrainingSessionWithEntries({
          routine: visibleRoutine,
          plannedDay,
          plannedDate,
          trainedDate,
          weekNumber: trainingWeek,
          status: "completed",
          notes: `Entrenamiento ${visibleDay}: ${visibleRoutine}. ${formatReadinessNote(readiness)}`,
          entries: validExercises.map((exercise) => {
          const draft = normalizeExerciseDraft(exercise, exerciseDrafts[exercise.id]);
          const previous = metrics.filter((entry) => entry.exerciseId === exercise.id).at(-1);
          return {
            id: createId(),
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            routine: exercise.routine,
            targetSets: exercise.targetSets,
            targetReps: exercise.targetReps,
            weight: readRequiredWeight(draft.weight),
            previousWeight: previous?.weight ?? exercise.baseWeight,
            reps: draft.reps.slice(0, exercise.targetSets).map((value) => Number(value) || 0),
            rir: draft.rir,
            notes: `Entrenamiento ${visibleDay}: ${exercise.routine}. ${formatReadinessNote(readiness)}`,
          };
        }),
        }, dataMode);

        const summarySnapshot = await buildCompletedTrainingSummarySnapshot({
          sessionId: savedSession.id,
          validExercises,
          capturedExerciseDrafts,
          workoutStartedAt: capturedStartedAt,
          savedAt: new Date().toISOString(),
          trainedDate,
        });
        setTrainingCompletionSummary(summarySnapshot);
        setTrainingSessions((current) => [...current, savedSession]);
        setEntries((current) => [...current, ...savedSession.entries]);
        setExerciseDrafts((current) => {
          const next = { ...current };
          for (const exercise of validExercises) delete next[exercise.id];
          return next;
        });
        setStatusMessage("Entrenamiento guardado.");
        finishCompletedWorkout();
        setScreen("training-summary");
      } catch (error) {
        const message = handlePersistenceError(error);
        setRoutineNotice(message === "Ya existe un entrenamiento registrado para esta rutina y fecha."
          ? "Ya existe un entrenamiento registrado para esta rutina y fecha. Puedes revisar el resumen o editar el registro existente."
          : message);
      } finally {
        setIsBusy(false);
      }
    } finally {
      if (saveLockAcquired) releaseWorkoutSaveLock(isSavingTrainingRef);
      releaseWorkoutStartLock(workoutCompletionInFlightRef);
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
    if (nextScreen === "recuperar-password") {
      clearPasswordRecoveryFlow();
      clearPasswordRecoveryUrl();
    }
    clearAuthForms();
    setStatusMessage("");
    setScreen(nextScreen);
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

  if (screen === "nueva-password") {
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
    setSeenNotificationRecords((current) => {
      const now = Date.now();
      const recordsById = new Map(current.map((record) => [record.id, record]));
      ids.forEach((id) => {
        if (!recordsById.has(id)) {
          recordsById.set(id, { id, seenAt: now });
        }
      });
      const next = Array.from(recordsById.values())
        .sort((a, b) => a.seenAt - b.seenAt)
        .slice(-SEEN_NOTIFICATIONS_MAX_RECORDS);
      saveSeenNotificationRecords(next);
      return next;
    });
  }

  function toggleNotifications() {
    setIsNotificationPanelOpen((current) => !current);
    setIsMenuOpen(false);
  }

  function openNotificationTarget(notification: AppNotification) {
    markNotificationsSeen([notification.id]);
    setIsNotificationPanelOpen(false);
    setTrainingCompletionSummary(null);
    navigateTo(notification.target);
    scrollToNotificationSection(notification.section);
  }

  function scrollToNotificationSection(section?: AppNotificationSection) {
    if (!section || typeof document === "undefined") return;

    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-section="${section}"]`);
      if (!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("section-highlighted");
      window.setTimeout(() => {
        target.classList.remove("section-highlighted");
      }, NOTIFICATION_SECTION_HIGHLIGHT_MS);
    }, 160);
  }

  const menuScreens = hasTrainingEntries
    ? primaryScreens
    : primaryScreens.filter((item) =>
      item === "dashboard" ||
      item === "entrenamiento" ||
      item === "perfil" ||
      item === "comparacion" ||
      item === "registro-entrenamiento" ||
      (item === "historial-ciclos" && visibleCycleHistoryCount > 0)
    );

  return (
    <main className="app-shell">
      <header className={`topbar ${isTopbarHidden ? "hidden" : ""}`}>
        <button
          className={`icon-button menu-trigger ${isMenuOpen ? "active" : ""}`}
          aria-label="Abrir menú"
          aria-expanded={isMenuOpen}
          onClick={() => {
            setIsNotificationPanelOpen(false);
            setIsMenuOpen((value) => {
              const next = !value;
              if (next) {
                void refreshProfileAvatar({ force: true, allowProfileLookup: true });
              }
              return next;
            });
          }}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
        <div>
          <h1>Organizatech</h1>
          {trainingTopbarMeta ? (
            <p className="topbar-training-meta" aria-label={`${trainingTopbarMeta.cycleLabel}, ${trainingTopbarMeta.weekLabel}, ${trainingTopbarMeta.progressLabel}`}>
              <span>{trainingTopbarMeta.cycleLabel}</span>
              <span>{trainingTopbarMeta.weekLabel}</span>
              <span>{trainingTopbarMeta.progressLabel}</span>
            </p>
          ) : (
            <p className="eyebrow">{hasTrainingEntries ? `Semana ${currentWeek} · ${authModeLabel}` : "Sin registro de entrenamiento"}</p>
          )}
        </div>
        <div className="notification-shell">
          <button
            className="icon-button notification-trigger"
            aria-label="Ver notificaciones"
            aria-expanded={isNotificationPanelOpen}
            onClick={toggleNotifications}
          >
            <Bell size={18} />
            {unseenNotificationCount > 0 ? (
              <span className="notification-badge" aria-label={`${unseenNotificationCount} notificaciones nuevas`}>
                {unseenNotificationCount > 9 ? "+9" : unseenNotificationCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      {isNotificationPanelOpen ? (
        <>
          <button
            className="notification-backdrop"
            aria-label="Cerrar notificaciones"
            onClick={() => setIsNotificationPanelOpen(false)}
          />
          <div className="notification-panel" role="dialog" aria-label="Notificaciones">
            <div className="notification-panel-header">
              <strong>Notificaciones</strong>
              <span>{unseenNotificationCount > 0 ? `${unseenNotificationCount} nuevas` : appNotifications.length > 0 ? "Historial" : "Sin pendientes"}</span>
            </div>
            {appNotifications.length > 0 ? (
              <div className="notification-list">
                {newNotifications.length > 0 ? (
                  <NotificationGroup
                    title="Nuevas"
                    notifications={newNotifications}
                    seenNotificationIds={seenNotificationIds}
                    onOpen={openNotificationTarget}
                  />
                ) : null}
                {historyNotifications.length > 0 ? (
                  <NotificationGroup
                    title="Historial"
                    notifications={historyNotifications}
                    seenNotificationIds={seenNotificationIds}
                    onOpen={openNotificationTarget}
                  />
                ) : null}
              </div>
            ) : (
              <p className="notification-empty">No tienes notificaciones por ahora.</p>
            )}
          </div>
        </>
      ) : null}

      {isMenuOpen && (
        <>
          <button className="menu-backdrop" aria-label="Cerrar menú" onClick={() => setIsMenuOpen(false)} />
          <div className="menu-drawer-shell" role="dialog" aria-label="Menú de navegación">
            <div className="menu-drawer-top">
              <button
                className="drawer-close"
                aria-label="Cerrar menú"
                onClick={() => setIsMenuOpen(false)}
              >
                <span className="drawer-x-line" />
                <span className="drawer-x-line" />
              </button>
            </div>
            <div className="menu-drawer-body">
              <div className="menu-panel" role="menu" aria-label="Menú principal">
                <ProfileMenuHeader
                  profile={profileViewModel}
                  onAvatarImageError={handleProfileAvatarImageError}
                  avatarResetKey={profileAvatarResetKey}
                />
                <div className="menu-grid">
                  {menuScreens.map((item) => (
                    <button
                      key={item}
                      className={`menu-link ${screen === item ? "active" : ""}`}
                      role="menuitem"
                      onClick={() => navigateTo(item)}
                    >
                      {screenLabel(item)}
                    </button>
                  ))}
                </div>
                <div className="menu-account">
                  <button className="logout-button" role="menuitem" onClick={handleLogout} disabled={isBusy}>
                    <LogOut size={17} />
                    Cerrar sesión
                  </button>
                </div>
              </div>
              <button className="drawer-empty" aria-label="Cerrar menú" onClick={() => setIsMenuOpen(false)} />
            </div>
          </div>
        </>
      )}

      {screen !== "dashboard" && screen !== "training-summary" && (
        <div className="section-back-row">
          <button className="button secondary section-back-button" type="button" onClick={goBack}>
            <ChevronLeft size={17} />
            Volver
          </button>
        </div>
      )}

      {screen === "dashboard" && (
        isCycleScopedPlanBlocked ? (
          <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
        ) : (
          <DashboardScreen
            exercises={displayExercises}
            hasTrainingEntries={hasTrainingEntries}
            hasRoutinePlan={hasRoutinePlan}
            usesCycleScopedSessions={isCycleScopedActiveCycle}
            day={dashboardDay}
            weekDays={dashboardCarouselDays}
            routine={dashboardRoutine}
            dayExercises={dashboardExercises}
            summary={summary}
            weeklyEquivalentProgress={weeklyEquivalentProgress}
            currentMetrics={dashboardCurrentMetrics}
            currentWeek={currentWeek}
            entries={calendarNormalizedEntries}
            sessions={calendarNormalizedTrainingSessions}
            startRegistration={() => navigateTo("registro-entrenamiento")}
            goToRoutine={() => openRoutineDay(dashboardDay)}
            viewSummary={(selectedDay) => {
              setComparisonDay(selectedDay);
              navigateTo("comparacion");
            }}
            switchDay={setDashboardDayOverride}
          />
        )
      )}
      {screen === "training-summary" && trainingCompletionSummary && (
        <TrainingCompletionSummaryScreen
          summary={trainingCompletionSummary}
          onDashboard={() => {
            setTrainingCompletionSummary(null);
            setScreen("dashboard");
          }}
        />
      )}
      {screen === "registro-entrenamiento" && isCycleScopedPlanBlocked && !isEditingRoutinePlan && (
        <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
      )}
      {screen === "registro-entrenamiento" && !isCycleScopedPlanBlocked && (!hasRoutinePlan || isEditingRoutinePlan) && (
        <InitialTrainingScreen
          day={setupDay}
          setDay={setSetupDay}
          routineName={setupByDay[setupDay]?.routineName ?? ""}
          setRoutineName={updateSetupRoutineName}
          rows={setupByDay[setupDay]?.rows ?? createSetupRows()}
          updateRow={updateSetupRow}
          addRow={addSetupRow}
          removeRow={removeSetupRow}
          saveRoutine={saveInitialRoutine}
          trainingPlan={trainingPlan}
          updateTrainingPlan={updateTrainingPlan}
          message={statusMessage}
          isBusy={isBusy}
          configuredDays={getConfiguredSetupDays(setupByDay)}
        />
      )}
      {screen === "registro-entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && (
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
      {screen === "entrenamiento" && isCycleScopedPlanBlocked && (
        <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
      )}
      {screen === "entrenamiento" && !isCycleScopedPlanBlocked && !hasRoutinePlan && (
        <EmptyDashboard startRegistration={() => navigateTo("registro-entrenamiento")} />
      )}
      {screen === "entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && !hasStartedTraining && (
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
      {screen === "entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && hasStartedTraining && !readiness && (
        <TrainingReadinessScreen
          onSubmit={submitDailyReadiness}
          onSkip={skipDailyReadiness}
          isSaving={savingDailyReadiness}
          error={dailyReadinessError}
        />
      )}
      {screen === "entrenamiento" && !isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && hasStartedTraining && readiness && (
        <GuidedTrainingScreen
          day={visibleDay}
          routine={visibleRoutine}
          exercises={dayExercises}
          targetSummary={targetSummary}
          activeIndex={activeExerciseIndex}
          setActiveIndex={setActiveExerciseIndex}
          drafts={exerciseDrafts}
          latestExercisePerformance={latestExercisePerformance}
          latestExercisePerformanceLoading={latestExercisePerformanceLoading}
          latestExercisePerformanceError={latestExercisePerformanceError}
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
        isCycleScopedPlanBlocked ? (
          <CycleScopedPlanBlocker message={cycleScopedPlanBlockerMessage} />
        ) : (
          <ComparisonScreenV2
            exercises={displayExercises}
            metrics={metrics}
            currentWeek={currentWeek}
            routineDays={routineDays}
            selectedDay={comparisonDay}
            setSelectedDay={setComparisonDay}
          />
        )
      )}
      {screen === "historial-ciclos" && (
        isTrainingCyclesRepositoryActive
          ? <PersistedCycleHistoryScreen history={persistedCycleHistory} />
          : <CycleHistoryScreen history={cycleHistory} />
      )}
      {screen === "perfil" && (
        <ProfileScreen
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
          onDeleteAvatar={handleDeleteProfileAvatar}
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
            setScreen("dashboard");
          }}
        />
      )}
      {isRoutineUpdateConfirmOpen && (
        <ConfirmRoutineUpdateModal
          onCancel={() => cancelRoutineUpdate()}
          onConfirm={() => void saveInitialRoutine(true)}
        />
      )}

    </main>
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

interface DashboardTrainingCardData {
  day: string;
  status: "completed" | "partial" | "pending";
  registeredCount: number;
  plannedCount: number;
  isToday: boolean;
  exercises: ExerciseTemplate[];
  metrics: ExerciseMetrics[];
  pendingExercises: ExerciseTemplate[];
}

function DashboardScreen({
  exercises,
  hasTrainingEntries,
  hasRoutinePlan,
  usesCycleScopedSessions,
  day,
  weekDays,
  routine,
  dayExercises,
  summary,
  weeklyEquivalentProgress,
  currentMetrics,
  currentWeek,
  entries,
  sessions,
  startRegistration,
  goToRoutine,
  viewSummary,
  switchDay,
}: {
  exercises: ExerciseTemplate[];
  hasTrainingEntries: boolean;
  hasRoutinePlan: boolean;
  usesCycleScopedSessions: boolean;
  day: string;
  weekDays: string[];
  routine: string;
  dayExercises: ExerciseTemplate[];
  summary: ReturnType<typeof calculateWeeklySummary>;
  weeklyEquivalentProgress: WeeklyEquivalentProgressResult;
  currentMetrics: ExerciseMetrics[];
  currentWeek: number;
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  startRegistration: () => void;
  goToRoutine: () => void;
  viewSummary: (day: string) => void;
  switchDay: (day: string) => void;
}) {
  const hasTodayRoutine = dayExercises.length > 0;
  const analytics = buildAnalytics(summary, currentMetrics);
  const coachFeedback = useMemo(() => buildTrainingCoachFeedback(buildTrainingCoachDashboardInput({
    summary,
    currentMetrics,
    entries,
    currentWeek,
    weeklyEquivalentProgress,
  })), [summary, currentMetrics, entries, currentWeek, weeklyEquivalentProgress]);
  const hasCurrentWeekTrainingRecords = entries.some((entry) => (
    entry.week === currentWeek && entry.reps.some((rep) => rep > 0)
  ));
  const hasCurrentWeekMetricRecords = currentMetrics.some((metric) => (
    metric.totalReps > 0 || metric.volumeTotal > 0
  ));
  const isCurrentWeekEmptyCoach = !hasCurrentWeekTrainingRecords && !hasCurrentWeekMetricRecords;
  const displayedCoachFeedback = isCurrentWeekEmptyCoach
    ? buildEmptyCurrentWeekCoachFeedback()
    : coachFeedback;
  const coachVisualStatus = isCurrentWeekEmptyCoach
    ? {
        showScore: false,
        showFactors: false,
        badgeLabel: "Semana nueva",
        label: "Sin registros esta semana",
        detail: "Completa tu primera sesión para generar una lectura de rendimiento.",
        factorLabel: "Datos disponibles",
      }
    : weeklyEquivalentProgress.status === "ready"
    ? { showScore: true, showFactors: true, label: feedbackHeadlineForStatus(displayedCoachFeedback), detail: "Factores de rendimiento", factorLabel: "Factores de rendimiento" }
    : weeklyEquivalentProgress.status === "no_previous"
      ? {
          showScore: false,
          showFactors: true,
          badgeLabel: "Base creada",
          label: "Punto de partida",
          detail: "Tu primera referencia de progreso",
          factorLabel: "Factores del registro actual",
        }
      : {
          showScore: false,
          showFactors: true,
          badgeLabel: "Datos disponibles",
          label: "Sin historial suficiente",
          detail: "Registro actual",
          factorLabel: "Datos disponibles",
        };
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const lastCarouselDay = useRef(day);
  const [activeCarouselDay, setActiveCarouselDay] = useState(day);
  const carouselDays = useMemo(() => hasRoutinePlan ? weekDays : [day], [hasRoutinePlan, weekDays, day]);
  const currentWeekDates = useMemo(() => getCurrentSantiagoWeekDates(), []);
  const currentWeekStart = currentWeekDates.Lunes;
  const activeSessions = useMemo(
    () => sessions.filter((session) => (
      session.status === "completed" &&
      !session.deletedAt &&
      (usesCycleScopedSessions
        ? getSessionEffectiveCalendarWeekStart(session) === currentWeekStart
        : session.calendarWeekStart === currentWeekStart)
    )),
    [sessions, currentWeekStart, usesCycleScopedSessions],
  );

  useEffect(() => {
    setActiveCarouselDay(day);
    lastCarouselDay.current = day;
    const index = carouselDays.indexOf(day);
    const container = carouselRef.current;
    const slide = index >= 0 ? container?.children.item(index) as HTMLElement | null : null;
    const firstSlide = container?.children.item(0) as HTMLElement | null;
    if (container && slide && firstSlide) {
      container.scrollTo({ left: slide.offsetLeft - firstSlide.offsetLeft, behavior: "smooth" });
    }
  }, [day, carouselDays]);

  function getDashboardDayData(item: string) {
    const itemExercises = exercises.filter((exercise) => (exercise.day ?? item) === item);
    const expectedDate = currentWeekDates[item] ?? "";
    const plannedDay = getTrainingDayCode(item);
    const session = findDashboardSessionForDay(activeSessions, itemExercises, expectedDate, plannedDay, usesCycleScopedSessions);
    const sessionEntries = session ? findDashboardEntries(session.entries, itemExercises, expectedDate, usesCycleScopedSessions) : [];
    const allMatchingEntries = usesCycleScopedSessions ? [] : findDashboardEntries(entries, itemExercises, expectedDate, false);
    const fallbackEntries = sessionEntries.length > 0 ? [] : allMatchingEntries;
    const itemEntries = usesCycleScopedSessions
      ? sessionEntries
      : sessionEntries.length > 0
        ? sessionEntries
        : fallbackEntries;
    const itemMetrics = itemEntries.length > 0 ? calculateWeeklyComparison(itemEntries) : [];
    const coverage = usesCycleScopedSessions
      ? getCycleScopedDayCoverage(itemExercises, itemEntries)
      : null;
    const status = coverage?.status ?? (Boolean(session) || fallbackEntries.length > 0 ? "completed" : "pending");
    const isCompleted = status === "completed";
    const pendingExercises = coverage
      ? itemExercises.filter((exercise) =>
        !coverage.registeredIds.has(exercise.trainingCycleExerciseId ?? exercise.id))
      : isCompleted
        ? []
        : itemExercises;

    return {
      day: item,
      title: itemExercises.length > 0 ? `Entrenamiento · ${item}` : `Entrenamiento · ${item}: no registra entrenamientos`,
      exercises: itemExercises,
      metrics: itemMetrics,
      session,
      status,
      registeredCount: coverage?.registeredCount ?? itemMetrics.length,
      plannedCount: coverage?.plannedCount ?? itemExercises.length,
      pendingExercises,
      isToday: expectedDate === getSantiagoDateKey(new Date()),
      hasRoutine: itemExercises.length > 0 || isCompleted,
      isCompleted,
    };
  }

  const activeDayData = getDashboardDayData(activeCarouselDay);
  const activeDayAction = resolveTrainingCarouselAction(activeDayData.status);

  function handleTrainingCarouselScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const children = Array.from(container.children) as HTMLElement[];
    const nearestIndex = resolveActiveCarouselIndex({
      scrollLeft: container.scrollLeft,
      viewportWidth: container.clientWidth,
      slides: children.map((child) => ({
        offsetLeft: child.offsetLeft,
        offsetWidth: child.offsetWidth,
      })),
    });

    const nextDay = carouselDays[nearestIndex] ?? activeCarouselDay;
    if (nextDay !== lastCarouselDay.current) {
      lastCarouselDay.current = nextDay;
      setActiveCarouselDay(nextDay);
      switchDay(nextDay);
    }
  }

  if (!hasRoutinePlan) {
    return <EmptyDashboard startRegistration={startRegistration} />;
  }

  if (!hasTrainingEntries) {
    return (
      <section className="screen">
        <div className="card wide dashboard-empty-progress">
          <p className="eyebrow">Rutina creada</p>
          <h3>Aún no registras progreso</h3>
          <p>Ya tienes tu planificación lista. Para comenzar a medir avances, inicia el entrenamiento del día y registra tus series.</p>
          {hasTodayRoutine ? (
            <button className="button dashboard-routine-button" onClick={goToRoutine}>
              Ir a rutina de entrenamiento
            </button>
          ) : null}
        </div>
        <div className="card wide dashboard-training-card" data-section="training-carousel">
          <div className="dashboard-training-carousel" ref={carouselRef} onScroll={handleTrainingCarouselScroll}>
            {carouselDays.map((item) => {
              const itemData = getDashboardDayData(item);
              const itemModel = buildDashboardTrainingCardModel(itemData);

              return (
                <article className="dashboard-training-slide" key={item}>
                  {itemData.hasRoutine ? (
                    <DashboardTrainingCardContent model={itemModel} />
                  ) : (
                    <p className="eyebrow">No hay rutina registrada para {item}. Puedes agregarla desde Registro de entrenamiento.</p>
                  )}
                </article>
              );
            })}
          </div>
          <DashboardDayDots day={activeCarouselDay} weekDays={carouselDays} />
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <MetricGrid summary={summary} />
      <div className="card wide dashboard-progress-card" data-section="weekly-progress">
        <div className="weekly-progress-summary">
          <div className="weekly-progress-value-block">
            <p className="small-label">Progreso semanal</p>
            {weeklyEquivalentProgress.status === "ready" ? (
              <div className="weekly-progress-comparison-list">
                <span>Volumen semana anterior: <strong>{weeklyEquivalentProgress.previousVolumeLabel}</strong></span>
                <span>Volumen actual: <strong>{weeklyEquivalentProgress.currentVolumeLabel}</strong></span>
                <span className={`weekly-progress-difference ${weeklyEquivalentProgress.tone}`}>
                  Diferencia de volumen: <strong>{weeklyEquivalentProgress.primaryLabel}</strong>
                </span>
                <small className={`weekly-progress-trend-pill ${weeklyEquivalentProgress.tone}`}>{buildWeeklyProgressTrendLabel(weeklyEquivalentProgress)}</small>
              </div>
            ) : (
              <strong className={weeklyEquivalentProgress.tone}>{weeklyEquivalentProgress.primaryLabel}</strong>
            )}
          </div>
          {weeklyEquivalentProgress.status !== "ready" ? (
            <div className="weekly-progress-empty-copy">
              <span>{weeklyEquivalentProgress.detailLabel}</span>
              <small>Completa esta semana para crear tu primera referencia</small>
            </div>
          ) : null}
        </div>
        <WeeklyProgressSvg progress={weeklyEquivalentProgress} />
      </div>
      <div className={`card wide dashboard-training-card ${activeDayData.status}`} data-section="training-carousel">
        <div className="dashboard-training-carousel" ref={carouselRef} onScroll={handleTrainingCarouselScroll}>
          {carouselDays.map((item) => {
            const itemData = getDashboardDayData(item);
            const itemModel = buildDashboardTrainingCardModel(itemData);

            return (
              <article className="dashboard-training-slide" key={item}>
                {itemData.hasRoutine ? (
                  <DashboardTrainingCardContent model={itemModel} />
                ) : (
                  <p className="eyebrow">No hay rutina registrada para {item}. Puedes agregarla desde Registro de entrenamiento.</p>
                )}
              </article>
            );
          })}
        </div>
        {activeDayData.hasRoutine ? (
          <button
            className={`button secondary dashboard-routine-button ${activeDayData.status}`}
            onClick={() => activeDayAction.action === "summary" ? viewSummary(activeDayData.day) : goToRoutine()}
          >
            {activeDayAction.label}
          </button>
        ) : null}
        <DashboardDayDots day={activeCarouselDay} weekDays={carouselDays} />
      </div>
      <div data-section="coach">
        <DashboardCoachCard feedback={displayedCoachFeedback} analytics={analytics} visualStatus={coachVisualStatus} />
      </div>
    </section>
  );
}

function buildDashboardTrainingCardModel(
  itemData: DashboardTrainingCardData,
) {
  const action = resolveTrainingCarouselAction(itemData.status);
  const plannedRows = itemData.metrics.length > 0 ? itemData.pendingExercises : itemData.exercises;
  return buildTrainingCarouselCardModel({
    day: itemData.day,
    routineName: itemData.exercises[0]?.routine ?? null,
    status: itemData.status,
    isToday: itemData.isToday,
    registeredCount: itemData.registeredCount,
    plannedCount: itemData.plannedCount,
    registeredExercises: itemData.metrics,
    plannedExercises: plannedRows,
    actionLabel: action.label,
    maxVisibleExercises: 4,
    formatWeight: formatKg,
  });
}

function DashboardTrainingCardContent({ model }: { model: TrainingCarouselCardModel }) {
  return (
    <div className="dashboard-training-card-content">
      <div className="dashboard-training-heading">
        <span className="dashboard-day-pill">{model.day}</span>
        <span className={`dashboard-status-badge ${model.status}`}>
          {model.statusLabel}
        </span>
      </div>
      <div className={`dashboard-routine-name ${model.status}`}>
        <span>Entrenamiento:</span>
        <strong>{model.routineName}</strong>
      </div>
      <div className="dashboard-exercise-table" role="table" aria-label={`Resumen de entrenamiento ${model.day}`}>
        <div className="dashboard-exercise-table-row heading" role="row">
          <span role="columnheader">Ejercicio</span>
          <span role="columnheader">Series</span>
          <span role="columnheader">Reps</span>
          <span role="columnheader">kg</span>
        </div>
        {model.rows.map((row) => (
          <div className="dashboard-exercise-table-row" role="row" key={`${row.source}-${row.id}`}>
            <strong role="cell" title={row.name}>{row.name}</strong>
            <span role="cell">{row.sets}</span>
            <span role="cell">{row.reps}</span>
            <span role="cell">{row.kg}</span>
          </div>
        ))}
      </div>
      {model.additionalExerciseCount > 0 ? (
        <p className="dashboard-more-exercises">+ {model.additionalExerciseCount} ejercicios más</p>
      ) : null}
    </div>
  );
}

function DashboardDayDots({ day, weekDays }: { day: string; weekDays: string[] }) {
  const activeIndex = Math.max(0, weekDays.indexOf(day));
  return <IndexDots activeIndex={activeIndex} count={weekDays.length} />;
}

function IndexDots({ activeIndex, count }: { activeIndex: number; count: number }) {
  return (
    <div className="dashboard-day-dots" aria-label="Posición del carrusel">
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className={`dashboard-day-dot ${index === activeIndex ? "active" : ""}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function TrainingCompletionSummaryScreen({
  summary,
  onDashboard,
}: {
  summary: TrainingCompletionSummary;
  onDashboard: () => void;
}) {
  const previousDateLabel = summary.exercises.find((exercise) => exercise.comparisonStatus === "ready" && exercise.previousDateLabel)?.previousDateLabel ?? "";
  const currentDateLabel = summary.exercises[0]?.currentDateLabel ?? "";

  return (
    <section className="training-completion-screen">
      <div className="training-completion-title">
        <h2>Resumen de tu entrenamiento</h2>
        <p>Estos fueron tus resultados</p>
      </div>

      <article className="training-completion-card">
        <header className="training-completion-card-header">
          <span className="training-completion-day">{summary.dayLabel}</span>
          <span className="training-completion-status">{summary.statusLabel}</span>
        </header>

        <div className="training-completion-meta">
          <h3><span>Entrenamiento:</span> {summary.workoutName}</h3>
          <p><strong>Fase:</strong> {summary.cycleLabel} | {summary.weekLabel} | {summary.progressLabel}</p>
          <p><strong>Duración:</strong> {summary.durationLabel}</p>
        </div>

        <div className="training-completion-table" role="table" aria-label="Comparación de ejercicios del entrenamiento completado">
          <div role="rowgroup">
            <div className="training-completion-row heading" role="row">
              <span role="columnheader">Ejercicio y Series</span>
              <span role="columnheader">Anterior{previousDateLabel && <small>{previousDateLabel}</small>}</span>
              <span role="columnheader">Actual{currentDateLabel && <small>{currentDateLabel}</small>}</span>
              <span role="columnheader">Resultado</span>
            </div>
          </div>
          <div role="rowgroup">
            {summary.exercises.map((exercise) => (
              <div className="training-completion-row" role="row" key={exercise.exerciseId}>
                <div role="cell" className="exercise-cell">
                  <strong>{exercise.exerciseName}</strong>
                  <span>{exercise.currentSeriesCount} {exercise.currentSeriesCount === 1 ? "serie" : "series"}</span>
                </div>
                <div role="cell">
                  {exercise.comparisonStatus === "ready" ? (
                    <>
                      <span>{exercise.previousTotalReps ?? "—"} reps</span>
                      <span>{exercise.previousWeightLabel}</span>
                    </>
                  ) : (
                    <span className="muted-result">{exercise.comparisonStatus === "first_reference" ? "—" : "No disponible"}</span>
                  )}
                </div>
                <div role="cell">
                  <span>{exercise.currentTotalReps} reps</span>
                  <span>{exercise.currentWeightLabel}</span>
                </div>
                <div role="cell" className="result-cell">
                  {exercise.resultLines.map((line, index) => (
                    <span className={line.tone} key={`${exercise.exerciseId}-${line.label}-${index}`}>{line.label}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button className="button training-completion-button" type="button" onClick={onDashboard}>
          Ir al panel principal
        </button>
      </article>
    </section>
  );
}

function WeeklyProgressSvg({ progress }: { progress: WeeklyEquivalentProgressResult }) {
  const hasPreviousReference = progress.status === "ready";
  const chart = useMemo(() => buildWeeklyProgressChart({
    currentSeries: progress.points.map((point) => ({
      label: point.label,
      value: point.currentVolume,
      comparable: point.currentVolume !== null,
      volume: point.currentVolume,
    })),
    previousSeries: progress.points.map((point) => ({
      label: point.label,
      value: hasPreviousReference ? point.previousVolume : null,
      comparable: hasPreviousReference && point.previousVolume !== null,
      volume: hasPreviousReference ? point.previousVolume : null,
    })),
    unit: "kg",
  }), [hasPreviousReference, progress.points]);
  const [activeIndex, setActiveIndex] = useState(chart.activeIndex);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const labels = chart.labels;
  const currentPoints = chart.currentPoints;
  const previousPoints = chart.previousPoints;
  const chartViewBoxHeight = 144;
  useEffect(() => {
    setActiveIndex(chart.activeIndex);
    setIsTooltipVisible(false);
  }, [chart.activeIndex, labels.length]);
  const activeCurrentPoint = currentPoints[activeIndex] ?? currentPoints.find((point) => point.value !== null) ?? currentPoints[0];
  const activePreviousPoint = previousPoints[activeIndex] ?? previousPoints[0];
  const currentPath = buildSvgPath(currentPoints);
  const previousPath = buildSvgPath(previousPoints);
  const currentAreaPath = buildAreaPath(currentPoints);
  const tooltipAnchorX = activeCurrentPoint?.x ?? activePreviousPoint?.x ?? 240;
  const tooltipLeft = `clamp(68px, ${(tooltipAnchorX / 480) * 100}%, calc(100% - 136px))`;
  const tooltipTop = `clamp(18px, ${((activeCurrentPoint?.y ?? activePreviousPoint?.y ?? 65) / chartViewBoxHeight) * 100}%, calc(100% - 62px))`;
  const tooltipDay = progress.points[activeIndex]?.day ?? activeCurrentPoint?.label ?? "";
  const progressAriaLabel = buildWeeklyProgressAriaLabel(progress);

  return (
    <div
      className="weekly-progress-visual"
      aria-label={progressAriaLabel}
    >
      <div className="weekly-progress-legend" aria-hidden="true">
        <span><i className="current" /> Semana actual</span>
        {hasPreviousReference ? <span><i className="previous" /> Semana anterior</span> : null}
      </div>
      <div className="weekly-chart-stage">
        {isTooltipVisible ? (
          <div className="weekly-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}>
            <strong>{tooltipDay}</strong>
            <span>Semana actual: {formatKgNullable(activeCurrentPoint?.value ?? null)}</span>
            <span>Semana anterior: {formatKgNullable(hasPreviousReference ? activePreviousPoint?.value ?? null : null)}</span>
          </div>
        ) : null}
        <div className="weekly-axis-values" aria-hidden="true">
          {chart.axisLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
        <svg viewBox={`0 0 480 ${chartViewBoxHeight}`} role="img">
          <defs>
            <linearGradient id="weeklyLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#63A2FF" />
              <stop offset="100%" stopColor="#1D5CFF" />
            </linearGradient>
            <filter id="weeklyGlow" x="-20%" y="-80%" width="140%" height="260%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {[18, 42, 65, 89, 112].map((y) => <line className="weekly-grid-line" key={y} x1="6" x2="474" y1={y} y2={y} />)}
          <line className="weekly-zero-line" x1="6" x2="474" y1="112" y2="112" />
          {currentAreaPath ? <path className="weekly-area" d={currentAreaPath} /> : null}
          {hasPreviousReference && previousPath ? <path className="weekly-line previous" d={previousPath} /> : null}
          {currentPath ? <path className="weekly-line current" d={currentPath} stroke="url(#weeklyLine)" filter="url(#weeklyGlow)" /> : null}
          {hasPreviousReference ? previousPoints.map((point, index) => point.y === null ? null : (
            <circle className="weekly-point previous" key={`previous-${point.label}-${index}`} cx={point.x} cy={point.y} r="3" />
          )) : null}
          {currentPoints.map((point, index) => point.y === null ? null : (
            <g
              key={`current-${point.label}-${index}`}
              className="weekly-point-hit"
              role="button"
              tabIndex={0}
              aria-label={`${progress.points[index]?.day ?? point.label}: semana actual ${formatKgNullable(point.value)}, semana anterior ${formatKgNullable(previousPoints[index]?.value ?? null)}`}
              onClick={() => {
                setIsTooltipVisible((current) => index !== activeIndex || !current);
                setActiveIndex(index);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setIsTooltipVisible((current) => index !== activeIndex || !current);
                  setActiveIndex(index);
                }
                if (event.key === "Escape") {
                  setIsTooltipVisible(false);
                }
              }}
            >
              <circle className={index === activeIndex ? "weekly-point-glow active" : "weekly-point-glow"} cx={point.x} cy={point.y} r={index === activeIndex ? 14 : 8} />
              <circle className={index === activeIndex ? "weekly-point current active" : "weekly-point current"} cx={point.x} cy={point.y} r={index === activeIndex ? 5 : 3} />
            </g>
          ))}
        </svg>
      </div>
      <div className="weekly-day-labels" aria-hidden="true">
        {labels.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
      </div>
    </div>
  );
}

function buildSvgPath(points: Array<{ x: number; y: number | null }>) {
  const segments = points.filter((point) => point.y !== null);
  return segments.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function buildAreaPath(points: Array<{ x: number; y: number | null }>) {
  const segments = points.filter((point) => point.y !== null);
  if (segments.length < 2) return "";
  const path = segments.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  return `${path} L ${segments.at(-1)!.x} 132 L ${segments[0].x} 132 Z`;
}

function formatKgNullable(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : formatKg(value);
}

function buildWeeklyProgressAriaLabel(progress: WeeklyEquivalentProgressResult) {
  if (progress.currentEquivalentValue <= 0) return "Progreso semanal: sin datos suficientes para comparar";
  if (progress.status === "ready") {
    return `Progreso semanal: diferencia ${progress.primaryLabel}; semana actual ${progress.currentVolumeLabel}; semana anterior ${progress.previousVolumeLabel}`;
  }
  if (progress.status === "no_previous") {
    return `Progreso semanal: volumen acumulado actual ${progress.primaryLabel}; sin comparación anterior`;
  }
  return "Progreso semanal: sin datos suficientes para comparar";
}

function buildWeeklyProgressTrendLabel(progress: WeeklyEquivalentProgressResult) {
  if (progress.differenceValue > 0) return "Vas por encima del ritmo de la semana anterior";
  if (progress.differenceValue < 0) return "Vas por debajo del ritmo de la semana anterior";
  return "Mantienes un ritmo similar a la semana anterior";
}

function feedbackHeadlineForStatus(feedback: TrainingCoachFeedback) {
  if (feedback.tone === "warning") return "Revisar progreso";
  if (feedback.tone === "positive") return "Buen avance";
  return feedback.headline;
}

function buildEmptyCurrentWeekCoachFeedback(): TrainingCoachFeedback {
  return {
    headline: "Nueva semana iniciada",
    summary: "Aún no hay entrenamientos registrados esta semana. Cuando completes tu primera sesión, Organizatech podrá analizar tu progreso.",
    strengths: [],
    attentions: [],
    nextAdvice: "Registra tu próximo entrenamiento para crear la base de esta semana.",
    tone: "neutral",
    confidence: "low",
    contradictionsResolved: [],
    sourceSignals: ["current_week_empty"],
  };
}

function DashboardCoachCard({
  feedback,
  analytics,
  visualStatus,
}: {
  feedback: TrainingCoachFeedback;
  analytics: AnalyticsSnapshot;
  visualStatus: { showScore: boolean; label: string; detail: string; factorLabel: string; badgeLabel?: string; showFactors?: boolean };
}) {
  const blocks: Array<{ id: string; label: string; insight: CoachInsight }> = [];
  const strength = feedback.strengths[0];
  const attention = feedback.attentions[0];
  const trend = feedback.historicalInsight;
  const hasTrend = Boolean(trend);
  const factors = analytics.factors.slice(0, 4).map(([label, value]) => ({
    label: getCoachFactorLabel(String(label)),
    value: Math.min(100, Math.max(0, Number(value) || 0)),
  }));

  if (strength) blocks.push({ id: "strength", label: "Fortaleza", insight: strength });
  if (attention) blocks.push({ id: "attention", label: "Atención", insight: attention });
  if (feedback.readinessInsight) blocks.push({ id: "readiness", label: "Estado del cuerpo", insight: feedback.readinessInsight });
  blocks.push({
    id: "next",
    label: feedback.nextTarget ? "Próximo objetivo" : "Consejo",
    insight: {
      title: feedback.nextTarget ?? "Siguiente paso",
      body: feedback.nextTarget ? feedback.nextAdvice : feedback.nextAdvice,
      tone: feedback.tone === "warning" ? "warning" : "info",
      priority: 0,
    },
  });

  return (
    <div className={`card wide dashboard-coach-card ${feedback.tone}`}>
      <div className="smart-card-header dashboard-coach-header">
        <div>
          <p className="eyebrow">Coach Organizatech</p>
          <h3>{feedback.headline}</h3>
        </div>
        <Sparkles size={19} />
      </div>
      <div className="coach-status-band">
        {visualStatus.showScore ? (
          <div className={`coach-score ${feedback.tone}`}>
            <strong>{analytics.score}</strong>
            <span>/100</span>
          </div>
        ) : (
          <div className={`coach-status-pill ${feedback.tone}`}>
            <span>{visualStatus.badgeLabel ?? visualStatus.label}</span>
          </div>
        )}
        <div className="coach-status-copy">
          <strong>{visualStatus.label}</strong>
          <span>{visualStatus.detail}</span>
        </div>
      </div>
      {visualStatus.showFactors !== false ? (
        <div className="coach-factor-list" aria-label={visualStatus.factorLabel}>
          <span className="coach-factor-heading">{visualStatus.factorLabel}</span>
          {factors.map((factor) => (
            <div className="coach-factor-row" key={factor.label}>
              <div>
                <span>{factor.label}</span>
                <small>{Math.round(factor.value)}/100</small>
              </div>
              <div className="coach-factor-track" aria-hidden="true">
                <span style={{ width: `${factor.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {trend ? (
        <div className={`coach-trend-block ${trend.tone}`}>
          <span>Tendencia</span>
          <strong>{trend.title}</strong>
          <p>{trend.body}</p>
          {trend.action ? <small>{trend.action}</small> : null}
        </div>
      ) : null}
      <div className="coach-summary-block">
        <span>Lectura rápida</span>
        <p>{feedback.summary}</p>
      </div>
      <div className="coach-insight-grid">
        {blocks.slice(0, hasTrend ? 3 : 4).map((block) => (
          <div className={`coach-insight-block ${block.insight.tone}`} key={block.id}>
            <span>{block.label}</span>
            <strong>{block.insight.title}</strong>
            <p>{block.insight.body}</p>
            {block.insight.action ? <small>{block.insight.action}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function getCoachFactorLabel(label: string) {
  if (label.toLowerCase().includes("cumplimiento")) return "Cumplimiento";
  if (label.toLowerCase().includes("repeticiones")) return "Reps";
  if (label.toLowerCase().includes("carga")) return "Carga";
  if (label.toLowerCase().includes("volumen")) return "Volumen";
  return label;
}

function NotificationGroup({
  title,
  notifications,
  seenNotificationIds,
  onOpen,
}: {
  title: string;
  notifications: AppNotification[];
  seenNotificationIds: Set<string>;
  onOpen: (notification: AppNotification) => void;
}) {
  return (
    <section className="notification-group" aria-label={title}>
      <p className="notification-group-title">{title}</p>
      {notifications.map((notification) => {
        const visual = getNotificationVisual(notification.kind);
        const isSeen = seenNotificationIds.has(notification.id);
        return (
          <button
            type="button"
            className={`notification-item notification-${notification.kind} ${isSeen ? "seen" : "new"}`}
            key={notification.id}
            onClick={() => onOpen(notification)}
          >
            <span className="notification-icon" aria-hidden="true">{visual.icon}</span>
            <span className="notification-copy">
              <span className="notification-item-topline">
                <span className="notification-category">{visual.category}</span>
                <span className="notification-state">{isSeen ? "Visto" : "Nuevo"}</span>
              </span>
              <strong>{notification.title}</strong>
              <span>{notification.summary}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

function getNotificationVisual(kind: AppNotification["kind"]) {
  switch (kind) {
    case "feature":
      return { category: "Nuevo", icon: <Sparkles size={15} /> };
    case "profile":
      return { category: "Perfil", icon: <UserPlus size={15} /> };
    case "week":
      return { category: "Semana", icon: <CalendarDays size={15} /> };
    case "progress":
      return { category: "Progreso", icon: <TrendingUp size={15} /> };
    case "coach":
      return { category: "Coach", icon: <Activity size={15} /> };
  }
}

function loadSeenNotificationRecords() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_NOTIFICATIONS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): SeenNotificationRecord | null => {
        if (typeof item === "string") return { id: item, seenAt: 0 };
        if (
          item &&
          typeof item === "object" &&
          typeof (item as SeenNotificationRecord).id === "string" &&
          typeof (item as SeenNotificationRecord).seenAt === "number"
        ) {
          return {
            id: (item as SeenNotificationRecord).id,
            seenAt: (item as SeenNotificationRecord).seenAt,
          };
        }
        return null;
      })
      .filter((item): item is SeenNotificationRecord => Boolean(item))
      .slice(-SEEN_NOTIFICATIONS_MAX_RECORDS);
  } catch {
    return [];
  }
}

function saveSeenNotificationRecords(records: SeenNotificationRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_NOTIFICATIONS_KEY, JSON.stringify(records.slice(-SEEN_NOTIFICATIONS_MAX_RECORDS)));
  } catch {
    // Las notificaciones siguen funcionando aunque el navegador bloquee localStorage.
  }
}

function buildAppNotifications({
  profile,
  currentWeek,
  completedDays,
  plannedDays,
  hasTrainingEntries,
  hasRoutinePlan,
  weeklyEquivalentProgress,
  summary,
  currentMetrics,
}: {
  profile: ReturnType<typeof buildProfileViewModel>;
  currentWeek: number;
  completedDays: number;
  plannedDays: number;
  hasTrainingEntries: boolean;
  hasRoutinePlan: boolean;
  weeklyEquivalentProgress: WeeklyEquivalentProgressResult;
  summary: ReturnType<typeof calculateWeeklySummary>;
  currentMetrics: ExerciseMetrics[];
}): AppNotification[] {
  const notifications: AppNotification[] = [
    {
      id: "feature-avatar-profile-v1",
      title: "Nueva función disponible",
      summary: "Ahora puedes subir y ajustar tu foto de perfil.",
      target: "perfil",
      section: "profile-avatar",
      kind: "feature",
    },
  ];

  if (!profile.avatarUrl) {
    notifications.push({
      id: "complete-profile-v1",
      title: "Completa tu perfil",
      summary: "Agrega una foto para personalizar tu cuenta.",
      target: "perfil",
      section: "profile-avatar",
      kind: "profile",
    });
  }

  if (hasRoutinePlan && plannedDays > 0) {
    notifications.push({
      id: `weekly-summary-v1-w${currentWeek}-${completedDays}-${plannedDays}`,
      title: "Resumen semanal",
      summary: `Semana ${currentWeek}: llevas ${completedDays} de ${plannedDays} días completados.`,
      target: "dashboard",
      section: "training-carousel",
      kind: "week",
    });
  }

  if (hasTrainingEntries && currentMetrics.length > 0) {
    notifications.push({
      id: `weekly-comparison-v1-w${currentWeek}`,
      title: "Comparación semanal disponible",
      summary: "Revisa cómo avanzaste frente a tu semana anterior.",
      target: "comparacion",
      section: "weekly-comparison",
      kind: "progress",
    });
  }

  if (hasTrainingEntries && weeklyEquivalentProgress.currentEquivalentValue > 0) {
    notifications.push({
      id: `weekly-progress-v1-w${currentWeek}-${Math.round(weeklyEquivalentProgress.currentEquivalentValue)}`,
      title: "Progreso semanal",
      summary: `Tu volumen actual es ${weeklyEquivalentProgress.currentVolumeLabel} esta semana.`,
      target: "dashboard",
      section: "weekly-progress",
      kind: "progress",
    });
  }

  const mainAlert = currentMetrics.find((metric) => metric.repsDifference <= -4 && metric.kgDifference <= 0);
  const loadAdjustment = currentMetrics.find((metric) => metric.repsDifference < 0 && metric.kgDifference > 0);
  if (mainAlert) {
    notifications.push({
      id: `smart-analysis-v1-w${currentWeek}-attention`,
      title: "Análisis inteligente",
      summary: "Detectamos un cambio importante en tu rendimiento.",
      target: "dashboard",
      section: "coach",
      kind: "coach",
    });
  } else if (loadAdjustment || summary.volumeDifference !== 0) {
    notifications.push({
      id: `smart-analysis-v1-w${currentWeek}-progress`,
      title: "Análisis inteligente",
      summary: "Revisa tu lectura del Coach para ajustar el próximo entrenamiento.",
      target: "dashboard",
      section: "coach",
      kind: "coach",
    });
  }

  return notifications;
}

function DashboardSmartInsights({ insights }: { insights: ReturnType<typeof generateSmartInsights> }) {
  const visibleInsights = insights.slice(0, 3);

  return (
    <div className="card wide dashboard-smart-card">
      <div className="smart-card-header">
        <div>
          <p className="eyebrow">Análisis inteligente</p>
          <h3>Alertas para tu entrenamiento</h3>
        </div>
        <Sparkles size={19} />
      </div>
      <div className="insight-list">
        {visibleInsights.map((insight) => (
          <div className={`insight-row smart-insight-row ${getInsightToneClass(insight.tone)}`} key={insight.id}>
            <span className={`insight-icon ${insight.tone === "positivo" ? "ok" : insight.tone === "riesgo" ? "fail" : "keep"}`}>
              {insight.tone === "positivo" ? <ArrowUp size={18} /> : insight.tone === "riesgo" ? <ArrowDown size={18} /> : <Activity size={18} />}
            </span>
            <div className="insight-copy">
              <strong>{insight.title}</strong>
              <p>{insight.detail}</p>
            </div>
            <span className={`badge ${insight.tone === "positivo" ? "ok" : insight.tone === "riesgo" ? "fail" : "keep"}`}>
              {insight.tone === "riesgo" ? "alerta" : insight.tone === "positivo" ? "positivo" : "info"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardMotivationSummary({
  entries,
  currentWeek,
  routineDays,
}: {
  entries: ExerciseEntry[];
  currentWeek: number;
  routineDays: string[];
}) {
  const analysis = buildReadinessAiSummary(entries, currentWeek, routineDays);

  return (
    <div className="card wide motivation-summary-card">
      <div className="smart-card-header">
        <div>
          <p className="eyebrow">Resumen de motivación IA</p>
          <h3>{analysis.title}</h3>
        </div>
        <Sparkles size={19} />
      </div>
      <div className="insight-list">
        {analysis.signals.map((signal) => {
          const label = signal.label.replace(` ${signal.toneLabel}`, "");

          return (
            <div className={`insight-row smart-insight-row compact-insight-row ${signal.tone === "ok" ? "tone-positive" : signal.tone === "fail" ? "tone-negative" : "tone-warning"}`} key={signal.label}>
              <div>
                <strong>{label}</strong>
                <p className="eyebrow">{signal.value}</p>
              </div>
              <span className={`badge ${signal.tone}`}>{signal.toneLabel}</span>
            </div>
          );
        })}
      </div>
      <p className="ai-suggestion">{analysis.suggestion}</p>
    </div>
  );
}

function EmptyDashboard({ startRegistration }: { startRegistration: () => void }) {
  return (
    <section className="empty-dashboard">
      <div className="empty-hero">
        <div className="brand-mark empty-logo">
          <Dumbbell size={30} />
        </div>
        <h2>Organizatech</h2>
        <p>Da tu esfuerzo, nosotros analizamos tu progreso</p>
      </div>
      <button className="start-button" onClick={startRegistration}>
        Empecemos a registrar
      </button>
    </section>
  );
}

function CycleScopedPlanBlocker({ message }: { message: string }) {
  return (
    <section className="screen">
      <div className="card wide cycle-management-card">
        <p className="eyebrow">Plan cycle-scoped</p>
        <h2>Plan operativo no disponible</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

function CycleManagementScreen({
  trainingPlan,
  exercises,
  entries,
  cycleNumber,
  activeCycleName,
  editCurrentCycle,
  requestNewCycle,
  requestDeleteCycle,
}: {
  trainingPlan: TrainingPlan;
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  cycleNumber: number;
  activeCycleName?: string;
  editCurrentCycle: () => void;
  requestNewCycle: () => void;
  requestDeleteCycle: () => void;
}) {
  const activeDays = getActiveRoutineDays(exercises, trainingPlan);
  const activeExercises = exercises.filter((exercise) => activeDays.includes(exercise.day ?? "Lunes"));
  const targetSummary = calculateTargetSummary(activeExercises);
  const metrics = calculateWeeklyComparison(entries);
  const summary = calculateWeeklySummary(metrics, Math.max(1, ...entries.map((entry) => entry.week)));
  const cycleTitle = getCycleTitle(trainingPlan);
  const weeksRegistered = Math.max(1, ...entries.map((entry) => entry.week));

  return (
    <section className="screen">
      <div className="card wide cycle-management-card">
        <p className="eyebrow">Ciclo activo</p>
        <h2>{activeCycleName ?? `Ciclo ${cycleNumber}`} - {cycleTitle}</h2>
        <p className="eyebrow">{getCycleDurationLabel(trainingPlan)} - {activeDays.length} dias - {targetSummary.exerciseCount} ejercicios</p>
        <div className="cycle-summary-line">
          <div><span>Volumen registrado</span><strong>{formatKg(summary.volumeTotal)}</strong></div>
          <div><span>Reps registradas</span><strong>{summary.totalReps}</strong></div>
          <div><span>Semanas</span><strong>{weeksRegistered}</strong></div>
        </div>
        <div className="cycle-management-actions">
          <button className="button secondary" type="button" onClick={editCurrentCycle}>
            <Pencil size={16} />
            Modificar ciclo actual
          </button>
          <button className="button danger-solid" type="button" onClick={requestDeleteCycle}>
            <Trash2 size={16} />
            Eliminar ciclo
          </button>
        </div>
      </div>

      <div className="card wide new-cycle-card">
        <p className="eyebrow">Crear nuevo ciclo de entrenamiento</p>
        <h3>Finalizaremos tu ciclo actual y guardaremos su resumen en Historial ciclo de entrenamiento para que puedas revisarlo cuando quieras.</h3>
        <button className="start-button compact" type="button" onClick={requestNewCycle}>
          Crear nuevo ciclo de entrenamiento
        </button>
      </div>

    </section>
  );
}

function ConfirmDeleteCycleModal({
  isBusy,
  onCancel,
  onConfirm,
}: {
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Eliminar ciclo actual">
      <div className="card confirm-modal">
        <h2>¿Eliminar ciclo actual?</h2>
        <p>Este ciclo dejará de estar visible en tu cuenta. Los datos asociados no se mostrarán en tu progreso actual.</p>
        <p>Esta acción no se puede deshacer desde la aplicación.</p>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>Cancelar</button>
          <button className="button danger-solid" type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? "Eliminando..." : "Sí, eliminar ciclo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmNewCycleModal({
  isBusy,
  onCancel,
  onConfirm,
}: {
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar nuevo ciclo">
      <div className="card confirm-modal">
        <h2>¿Estas seguro?</h2>
        <p>Si decides crear un nuevo ciclo de entrenamiento, finalizaremos el ciclo actual que tienes registrado.</p>
        <div className="modal-actions">
          <button className="button danger-solid" type="button" onClick={onCancel} disabled={isBusy}>No</button>
          <button className="button success-solid" type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? "Finalizando..." : "Si"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmRoutineUpdateModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar modificacion de rutina">
      <div className="card confirm-modal">
        <h2>Actualizar rutina</h2>
        <p>Si modificas esta rutina, se actualizará tu ciclo de entrenamiento actual. Los días eliminados dejarán de aparecer en el ciclo. ¿Quieres continuar?</p>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onCancel}>Cancelar</button>
          <button className="button success-solid" type="button" onClick={onConfirm}>Sí, actualizar rutina</button>
        </div>
      </div>
    </div>
  );
}

function RoutineSuccessModal({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Registro exitoso">
      <div className="card confirm-modal success-modal">
        <div className="success-icon">
          <Save size={22} />
        </div>
        <h3>Registro exitoso</h3>
        <p>Tu rutina quedó guardada correctamente. Ahora puedes revisar el panel principal y comenzar a seguir tu progreso.</p>
        <button className="button success-solid" type="button" onClick={onConfirm}>
          OK
        </button>
      </div>
    </div>
  );
}

function CycleHistoryScreen({ history }: { history: TrainingCycleSnapshot[] }) {
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(history.at(-1)?.id ?? null);

  return (
    <section className="screen">
      <div className="card wide cycle-history-hero">
        <div>
          <p className="eyebrow">Historial ciclo de entrenamiento</p>
          <h2>Ciclos finalizados</h2>
          <p>Revisa el resultado de cada ciclo cerrado: progreso, estado de ánimo y puntos a mejorar para el siguiente bloque.</p>
        </div>
        <span>{history.length}</span>
      </div>
      {history.length === 0 ? (
        <div className="card wide empty-cycle-history">
          <h3>Aún no hay ciclos finalizados</h3>
          <p>Cuando cierres tu ciclo activo, aparecerá aquí como Ciclo 1, Ciclo 2, Ciclo 3 y así sucesivamente.</p>
        </div>
      ) : (
        history.map((cycle) => {
          const isExpanded = expandedCycleId === cycle.id;
          const metrics = calculateWeeklyComparison(cycle.entries);
          const summary = calculateWeeklySummary(metrics, Math.max(1, ...cycle.entries.map((entry) => entry.week)));
          const progress = summarizeCycleProgress(cycle);
          const moodSummary = summarizeCycleMood(cycle.entries);
          const suggestions = createCycleSuggestions(progress, moodSummary);
          return (
            <div className={`card wide cycle-history-card ${isExpanded ? "open" : ""}`} key={cycle.id}>
              <button
                className="cycle-history-toggle"
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpandedCycleId((current) => current === cycle.id ? null : cycle.id)}
              >
                <div>
                  <h3>Resumen {cycle.name} · {getCycleTitle(cycle.plan)}</h3>
                  <span>{formatDate(cycle.createdAt)} - {formatDate(cycle.endedAt)}</span>
                </div>
                <ChevronDown className="cycle-history-chevron" size={22} />
              </button>
              {isExpanded ? (
                <div className="cycle-history-details">
                  <div className="cycle-history-metrics dashboard-metric-grid">
                    <div className="metric">
                      <div className="metric-title-row">
                        <span>Días con rutina</span>
                        <CalendarDays size={18} />
                      </div>
                      <strong>{getRoutineDays(cycle.exercises).length}</strong>
                    </div>
                    <div className="metric">
                      <div className="metric-title-row">
                        <span>Ejercicios</span>
                        <Dumbbell size={18} />
                      </div>
                      <strong>{cycle.exercises.length}</strong>
                    </div>
                    <div className="metric">
                      <div className="metric-title-row">
                        <span>Volumen registrado</span>
                        <BarChart3 size={18} />
                      </div>
                      <strong>{formatKg(summary.volumeTotal)}</strong>
                    </div>
                  </div>
                  <div className="cycle-result-grid">
                    <div className="cycle-result-card success">
                      <div className="cycle-result-title">
                        <span><TrendingUp size={20} /></span>
                        <h3>Subieron reps o peso</h3>
                      </div>
                      <p>{progress.improved.length > 0 ? progress.improved.join(", ") : "Aún no hay ejercicios con mejora clara."}</p>
                    </div>
                    <div className="cycle-result-card warning">
                      <div className="cycle-result-title">
                        <span><Minus size={20} /></span>
                        <h3>Estancados</h3>
                      </div>
                      <p>{progress.stagnant.length > 0 ? progress.stagnant.join(", ") : "No detectamos estancamientos relevantes."}</p>
                    </div>
                    <div className="cycle-result-card info">
                      <div className="cycle-result-title">
                        <span><Smile size={20} /></span>
                        <h3>Estado de ánimo</h3>
                      </div>
                      <p>{moodSummary.message}</p>
                    </div>
                    <div className="cycle-result-card suggestion">
                      <div className="cycle-result-title">
                        <span><Sparkles size={20} /></span>
                        <h3>Sugerencias</h3>
                      </div>
                      <ul>
                        {suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}

function PersistedCycleHistoryScreen({ history }: { history: PersistedTrainingCycle[] }) {
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(history[0]?.id ?? null);

  return (
    <section className="screen">
      <div className="card wide cycle-history-hero">
        <div>
          <p className="eyebrow">Historial ciclo de entrenamiento</p>
          <h2>Ciclos finalizados</h2>
          <p>Revisa los ciclos cerrados guardados desde tu cuenta conectada.</p>
        </div>
        <span>{history.length}</span>
      </div>
      {history.length === 0 ? (
        <div className="card wide empty-cycle-history">
          <h3>Aún no hay ciclos finalizados</h3>
          <p>Cuando cierres tu ciclo activo, aparecerá aquí como historial persistido.</p>
        </div>
      ) : (
        history.map((cycle) => {
          const isExpanded = expandedCycleId === cycle.id;
          const summary = cycle.summarySnapshot ?? {};
          const improvedExercises = readSnapshotStringList(summary, "improvedExercises", 4);
          const stagnantExercises = readSnapshotStringList(summary, "stagnantExercises", 4);
          const moodSummary = readSnapshotMoodSummary(summary);
          const suggestions = readSnapshotStringList(summary, "suggestions", 3);
          return (
            <div className={`card wide cycle-history-card ${isExpanded ? "open" : ""}`} key={cycle.id}>
              <button
                className="cycle-history-toggle"
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpandedCycleId((current) => current === cycle.id ? null : cycle.id)}
              >
                <div>
                  <h3>{cycle.name} · {cycle.status === "completed" ? "Completado" : "Cancelado"}</h3>
                  <span>{formatDate(cycle.startedAt)} - {cycle.endedAt ? formatDate(cycle.endedAt) : "Sin cierre"}</span>
                </div>
                <ChevronDown className="cycle-history-chevron" size={22} />
              </button>
              {isExpanded ? (
                <div className="cycle-history-details">
                  <div className="cycle-history-metrics dashboard-metric-grid">
                    <div className="metric">
                      <div className="metric-title-row">
                        <span>Días con rutina</span>
                        <CalendarDays size={18} />
                      </div>
                      <strong>{readSnapshotNumber(summary, "dayCount")}</strong>
                    </div>
                    <div className="metric">
                      <div className="metric-title-row">
                        <span>Ejercicios</span>
                        <Dumbbell size={18} />
                      </div>
                      <strong>{readSnapshotNumber(summary, "exerciseCount")}</strong>
                    </div>
                    <div className="metric">
                      <div className="metric-title-row">
                        <span>Volumen registrado</span>
                        <BarChart3 size={18} />
                      </div>
                      <strong>{formatKg(readSnapshotNumber(summary, "volumeTotal"))}</strong>
                    </div>
                    <div className="metric">
                      <div className="metric-title-row">
                        <span>Reps registradas</span>
                        <TrendingUp size={18} />
                      </div>
                      <strong>{readSnapshotNumber(summary, "totalReps")}</strong>
                    </div>
                  </div>
                  <div className="cycle-result-grid">
                    <div className="cycle-result-card success">
                      <div className="cycle-result-title">
                        <span><TrendingUp size={20} /></span>
                        <h3>Subieron reps o peso</h3>
                      </div>
                      <p>{formatSnapshotList(improvedExercises, "Aún no hay ejercicios con mejora clara.")}</p>
                    </div>
                    <div className="cycle-result-card warning">
                      <div className="cycle-result-title">
                        <span><Minus size={20} /></span>
                        <h3>Estancados</h3>
                      </div>
                      <p>{formatSnapshotList(stagnantExercises, "No detectamos estancamientos relevantes.")}</p>
                    </div>
                    <div className="cycle-result-card info">
                      <div className="cycle-result-title">
                        <span><Smile size={20} /></span>
                        <h3>Estado de ánimo</h3>
                      </div>
                      <p>{moodSummary.message}</p>
                    </div>
                    <div className="cycle-result-card suggestion">
                      <div className="cycle-result-title">
                        <span><Sparkles size={20} /></span>
                        <h3>Sugerencias</h3>
                      </div>
                      <ul>
                        {suggestions.length > 0
                          ? suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)
                          : <li>Mantén el registro del ciclo para recibir sugerencias más precisas.</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </section>
  );
}

function DashboardAnalytics({ summary, analytics }: { summary: ReturnType<typeof calculateWeeklySummary>; analytics: AnalyticsSnapshot }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  return (
    <div className="card wide dashboard-analytics">
      <div className="analytics-score-row">
        <div className="score compact-score"><div><strong>{analytics.score}</strong><span>/100</span></div></div>
        <div>
          <p className="eyebrow">Analitica integrada</p>
          <h3>{analytics.score >= 80 ? "Progreso solido" : analytics.score >= 60 ? "Buen avance" : "Necesita atencion"}</h3>
          <p className={summary.volumePercentage >= 0 ? "positive" : "danger"}>
            {formatSigned(summary.volumePercentage)}% volumen semanal
          </p>
        </div>
      </div>
      <div>
        <div className="analytics-help-title">
          <h3>Factores de rendimiento</h3>
          <button className="inline-help-button" type="button" onClick={() => setIsHelpOpen((value) => !value)} aria-label="Explicar analitica integrada">
            <HelpCircle size={14} />
          </button>
          {isHelpOpen && (
            <span className="field-help-popover analytics-help-popover" role="dialog">
              El puntaje se calcula con 40% cumplimiento de ejercicios, 25% repeticiones logradas, 20% carga mantenida/subida y 15% volumen total versus objetivo o semana anterior.
            </span>
          )}
        </div>
        {analytics.factors.map(([label, value]) => <ProgressLine key={String(label)} label={String(label)} value={Number(value)} />)}
      </div>
    </div>
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
  updateTrainingPlan: (patch: Partial<TrainingPlan>) => void;
  message: string;
  isBusy: boolean;
  configuredDays: string[];
}) {
  const plannedDays = sortTrainingDaysByWeekOrder(
    trainingPlan.trainingDays.length > 0 ? trainingPlan.trainingDays : [day],
  );
  const completedPlannedDays = plannedDays.filter((item) => configuredDays.includes(item));
  const currentStep = Math.max(1, plannedDays.indexOf(day) + 1);
  const remainingDays = plannedDays.filter((item) => item !== day && !configuredDays.includes(item));
  const isLastPendingDay = remainingDays.length === 0;
  const selectedCycle = trainingCycles.find((cycle) => cycle.id === trainingPlan.cycleType) ?? trainingCycles[0];
  const objectiveOptions = getCycleObjectiveOptions(trainingPlan.cycleType);
  const durationOptions = getCycleDurationOptions(trainingPlan.cycleType);
  const objectiveValue = getCycleObjectiveValue(trainingPlan);
  const objectiveDescription = objectiveDescriptions[objectiveValue] ?? "Este objetivo define cómo Organizatech ordenará la intención principal del bloque.";
  const durationValue = getCycleDurationValue(trainingPlan);
  const visibleMessage = message === "Modo de prueba activo." || message === "Progreso actualizado." ? "" : message;

  function toggleTrainingDay(item: string) {
    const isSelected = plannedDays.includes(item);
    const nextDays = isSelected && plannedDays.length > 1
      ? plannedDays.filter((current) => current !== item)
      : isSelected
        ? plannedDays
        : [...plannedDays, item];

    const sortedDays = sortTrainingDaysByWeekOrder(nextDays);
    updateTrainingPlan({ trainingDays: sortedDays });
    setDay(sortedDays.includes(item) ? item : sortedDays[0]);
  }

  function updateCycleObjective(value: string) {
    if (trainingPlan.cycleType === "macro") updateTrainingPlan({ macroObjective: value });
    if (trainingPlan.cycleType === "meso") updateTrainingPlan({ mesoObjective: value });
    if (trainingPlan.cycleType === "micro") updateTrainingPlan({ microFocus: value });
    if (trainingPlan.cycleType === "session") updateTrainingPlan({ sessionFocus: value });
  }

  function updateCycleDuration(value: string) {
    const numericValue = Number(value);
    if (trainingPlan.cycleType === "macro") updateTrainingPlan({ macroDurationMonths: numericValue });
    if (trainingPlan.cycleType === "meso") updateTrainingPlan({ mesoDurationWeeks: numericValue });
    if (trainingPlan.cycleType === "micro") updateTrainingPlan({ microDurationWeeks: numericValue });
    if (trainingPlan.cycleType === "session") updateTrainingPlan({ sessionDurationDays: numericValue });
  }

  return (
    <section className="setup-screen">
      <div className="setup-card training-cycles-card">
        <div className="setup-section-heading">
          <p className="eyebrow">Planificación deportiva</p>
          <h3>Selecciona tu ciclo de entrenamiento</h3>
        </div>
        <div className="cycle-flow-card">
          <label className="cycle-select-field">
            <span>Ciclo de entrenamiento</span>
            <select
              className="cycle-select"
              value={trainingPlan.cycleType}
              onChange={(event) => updateTrainingPlan({ cycleType: event.target.value as TrainingCycleId })}
            >
              {trainingCycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>{cycle.title}</option>
              ))}
            </select>
          </label>
          <div className="cycle-description">
            <strong>{selectedCycle.title}</strong>
            <p>{selectedCycle.detail}</p>
          </div>
          <label className="cycle-select-field">
            <span>¿Cuál es el objetivo principal?</span>
            <select className="cycle-select" value={objectiveValue} onChange={(event) => updateCycleObjective(event.target.value)}>
              {objectiveOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <div className="cycle-description objective-description">
            <strong>{objectiveValue}</strong>
            <p>{objectiveDescription}</p>
          </div>
          <label className="cycle-select-field">
            <span>Duración</span>
            <select className="cycle-select" value={durationValue} onChange={(event) => updateCycleDuration(event.target.value)}>
              {durationOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="cycle-select-field">
            <span>Selecciona días de entrenamiento</span>
            <div className="cycle-chip-grid days">
              {setupDays.map((item) => (
                <button
                  className={`cycle-chip ${plannedDays.includes(item) ? "active" : ""} ${day === item ? "current" : ""} ${configuredDays.includes(item) ? "configured" : ""}`}
                  key={item}
                  type="button"
                  onClick={() => toggleTrainingDay(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="setup-card routine-day-builder-card">
        <div className="setup-section-heading">
          <p className="eyebrow">Configura tus rutinas por día</p>
          <h3>Rutina {currentStep} de {plannedDays.length} · {day}</h3>
        </div>
        <div className="routine-build-progress">
          <span>{completedPlannedDays.length} de {plannedDays.length} días completados</span>
          <div className="mini-progress-track">
            <div className="mini-progress-fill" style={{ width: `${Math.round((completedPlannedDays.length / plannedDays.length) * 100)}%` }} />
          </div>
        </div>
        <div className="routine-build-days">
          {plannedDays.map((item) => (
            <button
              className={`routine-build-day ${item === day ? "current" : ""} ${configuredDays.includes(item) ? "done" : ""}`}
              key={item}
              type="button"
              onClick={() => setDay(item)}
            >
              <strong>{item}</strong>
              <span>{configuredDays.includes(item) ? "Listo" : item === day ? "Actual" : "Pendiente"}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="setup-card routine-name-card">
        <div className="setup-section-heading">
          <p className="eyebrow">Rutina del día {day}</p>
          <h3>Nombre de la rutina</h3>
        </div>
        <input
          className="setup-name-input"
          placeholder="Ej: Empuje, Jalón, Piernas"
          value={routineName}
          onChange={(event) => setRoutineName(event.target.value)}
        />
      </div>

      <div className="setup-card exercise-builder-card">
        <div className="setup-section-heading">
          <p className="eyebrow">Rutina del día {day}</p>
          <h3>Ejercicios a programar</h3>
        </div>
        <div className="setup-table">
          <div className="setup-table-head">
            <span>Nombre ejercicio</span>
            <span>Series</span>
            <span>Repeticiones</span>
            <span>Kg</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div className="setup-row" key={row.id}>
              <input placeholder={`Ejercicio ${index + 1}`} value={row.name} onChange={(event) => updateRow(row.id, "name", event.target.value)} />
              <input type="number" min={1} placeholder="Series" value={row.sets || ""} onChange={(event) => updateRow(row.id, "sets", event.target.value)} />
              <input type="number" min={1} placeholder="Reps" value={row.reps || ""} onChange={(event) => updateRow(row.id, "reps", event.target.value)} />
              <input inputMode="decimal" placeholder="Kg" value={row.weight || ""} onChange={(event) => updateRow(row.id, "weight", event.target.value)} />
              <button className="row-delete" type="button" aria-label="Eliminar ejercicio" onClick={() => removeRow(row.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="setup-actions">
          <button className="small-yellow-button" type="button" onClick={addRow}>Agregar más</button>
          <button className="start-button compact" type="button" onClick={saveRoutine} disabled={isBusy}>
            {isBusy ? "Guardando..." : isLastPendingDay ? "Finalizar registro de rutina" : "Guardar y continuar"}
          </button>
        </div>
        {visibleMessage ? <p className="setup-message">{visibleMessage}</p> : null}
      </div>
    </section>
  );
}

function TrainingReadinessScreen({
  onSubmit,
  onSkip,
  isSaving,
  error,
}: {
  onSubmit: (value: Omit<TrainingReadiness, "skipped">) => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  isSaving: boolean;
  error: string;
}) {
  const [values, setValues] = useState({
    motivation: 4,
    hydration: 4,
    sleep: 4,
    energy: 4,
  });
  const questions = [
    { key: "motivation", label: "Motivación", detail: "Qué tantas ganas tienes de entrenar hoy." },
    { key: "hydration", label: "Hidratación", detail: "Qué tan bien hidratado sientes tu cuerpo." },
    { key: "sleep", label: "Sueño", detail: "Qué tan reparador fue tu descanso." },
    { key: "energy", label: "Energía física", detail: "Qué tan preparado te sientes para rendir." },
  ] as const;

  return (
    <section className="screen">
      <div className="card wide readiness-card">
        <div className="setup-section-heading">
          <p className="eyebrow">Antes de empezar</p>
          <h3>¿Cómo llegas hoy?</h3>
        </div>
        <div className="readiness-list">
          {questions.map((question) => (
            <div className="readiness-row" key={question.key}>
              <div>
                <div className="readiness-title-row">
                  <strong>{question.label}</strong>
                  <span>{values[question.key]}/7</span>
                </div>
                <p>{question.detail}</p>
              </div>
              <div className="readiness-slider-wrap">
                <input
                  aria-label={question.label}
                  className="readiness-slider"
                  disabled={isSaving}
                  max={7}
                  min={1}
                  type="range"
                  value={values[question.key]}
                  onChange={(event) => setValues((current) => ({ ...current, [question.key]: Number(event.target.value) }))}
                />
                <div className="readiness-slider-scale" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6, 7].map((score) => (
                    <span key={score}>{score}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="two-cols">
          <button className="button secondary" type="button" onClick={onSkip} disabled={isSaving}>
            {isSaving ? "Guardando..." : "Omitir por hoy"}
          </button>
          <button className="button" type="button" onClick={() => onSubmit(values)} disabled={isSaving}>
            {isSaving ? "Guardando..." : "Empezar entrenamiento"}
          </button>
        </div>
        {error ? <p className="setup-message">{error}</p> : null}
      </div>
    </section>
  );
}

function TrainingStartScreen({
  day,
  routine,
  exercises,
  targetSummary,
  routineDays,
  switchDay,
  editRoutine,
  startTraining,
  isStartingTraining,
  notice,
}: {
  day: string;
  routine: string;
  exercises: ExerciseTemplate[];
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  routineDays: string[];
  switchDay: (day: string) => void;
  editRoutine: () => void;
  startTraining: () => void;
  isStartingTraining: boolean;
  notice: string;
}) {
  return (
    <section className="screen">
      <div className="card wide day-switcher-card">
        <div className="section-heading">
          <div>
            <h3>Selecciona rutina o día</h3>
            <p className="eyebrow">Cambia entre tus días registrados para iniciar el entrenamiento.</p>
          </div>
        </div>
        <div className="routine-day-pills">
          {routineDays.map((item) => (
            <button
              key={item}
              className={`routine-day-pill configured ${item === day ? "active" : ""}`}
              type="button"
              onClick={() => switchDay(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="card wide training-start-card">
        <div className="training-start-header">
          <div>
            <p className="eyebrow">Entrenamiento del día {day}</p>
            <h2>{routine}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Editar rutina semanal" onClick={editRoutine}>
            <Pencil size={17} />
          </button>
        </div>
        <p>Cuando estés listo, inicia el entrenamiento. Primero haremos un formulario de motivación rápido y luego verás tus ejercicios.</p>
        <RoutineMetricGrid targetSummary={targetSummary} />
        <div className="training-start-preview">
          {exercises.slice(0, 3).map((exercise) => (
            <div key={exercise.id}>
              <strong>{exercise.name}</strong>
              <span>{exercise.targetSets} series · {exercise.targetReps} reps · {formatKg(exercise.baseWeight)}</span>
            </div>
          ))}
        </div>
        <div className="training-start-actions">
          <button className="start-button" type="button" onClick={startTraining} disabled={isStartingTraining}>
            {isStartingTraining ? "Verificando..." : "Iniciar entrenamiento"}
          </button>
        </div>
        {notice ? <p className="setup-message">{notice}</p> : null}
      </div>
    </section>
  );
}

function GuidedTrainingScreen({
  day,
  routine,
  exercises,
  targetSummary,
  activeIndex,
  setActiveIndex,
  drafts,
  latestExercisePerformance,
  latestExercisePerformanceLoading,
  latestExercisePerformanceError,
  updateDraft,
  registerExercise,
  saveCompletedTraining,
  editRoutine,
  routineDays,
  switchDay,
  notice,
  isBusy,
}: {
  day: string;
  routine: string;
  exercises: ExerciseTemplate[];
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  drafts: Record<string, ExerciseDraft>;
  latestExercisePerformance: LatestExercisePerformance | null;
  latestExercisePerformanceLoading: boolean;
  latestExercisePerformanceError: string;
  updateDraft: (exercise: ExerciseTemplate, patch: Partial<ExerciseDraft>) => void;
  registerExercise: () => void;
  saveCompletedTraining: () => void;
  editRoutine: () => void;
  routineDays: string[];
  switchDay: (day: string) => void;
  notice: string;
  isBusy: boolean;
}) {
  const activeExercise = exercises[activeIndex] ?? exercises[0];
  const draft = activeExercise ? normalizeExerciseDraft(activeExercise, drafts[activeExercise.id]) : null;
  const isExerciseRegistered = (exercise: ExerciseTemplate) =>
    isExerciseRegisteredInCurrentWorkout(exercise, drafts);
  const completedCount = exercises.filter(isExerciseRegistered).length;
  const allRegistered = exercises.length > 0 && completedCount === exercises.length;
  const activeExerciseAlreadyRegistered = activeExercise
    ? isExerciseRegisteredInCurrentWorkout(activeExercise, drafts)
    : false;
  const preview = activeExercise && draft
    ? calculateExerciseMetrics({
        id: `preview-${activeExercise.id}`,
        exerciseId: activeExercise.id,
        exerciseName: activeExercise.name,
        routine: activeExercise.routine,
        week: 1,
        date: new Date().toISOString().slice(0, 10),
        targetSets: activeExercise.targetSets,
        targetReps: activeExercise.targetReps,
        weight: readPreviewWeight(draft.weight, activeExercise.baseWeight),
        previousWeight: activeExercise.baseWeight,
        reps: draft.reps.map((value) => Number(value) || 0),
        rir: draft.rir,
      })
    : null;
  const performancePresentation = activeExercise
    ? buildExerciseLastPerformancePresentation({
        planned: {
          targetSets: activeExercise.targetSets,
          targetReps: activeExercise.targetReps,
          baseWeight: activeExercise.baseWeight,
        },
        latest: latestExercisePerformance,
        loading: latestExercisePerformanceLoading,
        error: latestExercisePerformanceError,
      })
    : null;

  if (!activeExercise || !draft || !preview || !performancePresentation) {
    return (
      <section className="screen">
        <div className="card wide">
          <h3>No hay ejercicios para {day}</h3>
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="card wide day-switcher-card">
        <div className="section-heading">
          <div>
            <h3>Selecciona rutina o día</h3>
            <p className="eyebrow">Cambia entre tus días registrados para seguir entrenando.</p>
          </div>
        </div>
        <div className="routine-day-pills">
          {routineDays.map((item) => (
            <button
              key={item}
              className={`routine-day-pill configured ${item === day ? "active" : ""}`}
              type="button"
              onClick={() => switchDay(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="card wide routine-summary-card">
        <h3>Entrenamiento día {day}</h3>
        <p className="eyebrow">{routine}</p>
        {notice ? <div className={`notice-banner ${notice.includes("Ya existe un entrenamiento") ? "warning" : ""}`}>{notice}</div> : null}
        <p className="eyebrow">Ejercicio {activeIndex + 1} de {exercises.length} · {completedCount} registrados</p>
        <RoutineMetricGrid targetSummary={targetSummary} />
        <button className="button secondary" type="button" onClick={editRoutine}>
          <Pencil size={16} />
          Editar rutina semanal
        </button>
      </div>

      <div className="card wide">
        <div className="section-heading">
          <div>
            <h3>Ejercicios a realizar</h3>
            <p className="eyebrow">Elige el ejercicio, revisa el objetivo y registra tus series.</p>
          </div>
        </div>
        <div className="routine-list">
          {exercises.map((exercise, index) => {
            const isActive = index === activeIndex;
            const isDone = isExerciseRegistered(exercise);

            return (
              <button
                key={exercise.id}
                className={`routine-item ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
                onClick={() => setActiveIndex(index)}
              >
                <span className="routine-item-index">{index + 1}</span>
                <span className="routine-item-main">
                  <strong>{exercise.name}</strong>
                  <small>{exercise.targetSets} series · {exercise.targetReps} reps · {formatKg(exercise.baseWeight)}</small>
                </span>
                <span className="routine-item-status">
                  {isDone ? "Registrado" : isActive ? "Actual" : "Pendiente"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card wide mobile-series-card">
        <div className="series-card-heading">
          <p className="eyebrow">Registro de series</p>
          <h3>{activeExercise.name}</h3>
        </div>
        <div className="series-exercise-card">
          <ExerciseLastPerformancePanel presentation={performancePresentation} exerciseId={activeExercise.id} />
          <label className="series-weight-field">
            <span>Peso usado</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={formatKg(activeExercise.baseWeight)}
              value={draft.weight}
              onChange={(event) => updateDraft(activeExercise, { weight: readWeightInput(event.target.value, draft.weight) })}
            />
          </label>
          <div className="series-rep-grid">
            {draft.reps.map((reps, index) => (
              <label className="series-rep-box" key={index}>
                <span>Serie {index + 1}</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={`${activeExercise.targetReps}`}
                  value={reps}
                  onChange={(event) => {
                    const next = [...draft.reps];
                    next[index] = readOptionalNumber(event.target.value);
                    updateDraft(activeExercise, { reps: next });
                  }}
                />
              </label>
            ))}
          </div>
        </div>
        <SeriesResult entry={preview} />
        {!allRegistered && !activeExerciseAlreadyRegistered ? (
          <button className="button" type="button" onClick={registerExercise}>
            <Save size={17} />
            Registrar serie
          </button>
        ) : !allRegistered ? (
          <button className="button secondary" type="button" disabled>
            Ejercicio ya registrado
          </button>
        ) : (
          <button className="start-button compact" type="button" onClick={saveCompletedTraining} disabled={isBusy}>
            {isBusy ? "Guardando..." : "Guardar entrenamiento"}
          </button>
        )}
      </div>
    </section>
  );
}

function ExerciseLastPerformancePanel({
  presentation,
  exerciseId,
}: {
  presentation: ExerciseLastPerformancePresentation;
  exerciseId: string;
}) {
  return (
    <div className="exercise-reference-card" key={exerciseId}>
      <div className="exercise-reference-header">
        <span>Referencia de hoy</span>
      </div>

      <div className="exercise-reference-block objective">
        <p className="exercise-reference-label">Objetivo</p>
        <strong className="exercise-reference-value">{presentation.objectiveText}</strong>
      </div>

      <div className={`exercise-reference-block detail ${presentation.status}`}>
        {presentation.seriesRows.length > 0 ? (
          <details className="exercise-series-details" key={`series-${exerciseId}`}>
            <summary>
              <span>{presentation.seriesDetailTitle}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="exercise-series-detail-list">
              {presentation.seriesRows.map((row) => (
                <div className="exercise-series-detail-row" key={`${row.label}-${row.value}`}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </details>
        ) : (
          <>
            <p className="exercise-reference-label">{presentation.lastHeaderText}</p>
            {presentation.status === "loading" ? (
              <div className="exercise-performance-skeleton" aria-label="Cargando historial del ejercicio" />
            ) : (
              <strong className="exercise-reference-value muted">{presentation.lastSummaryText}</strong>
            )}
          </>
        )}
      </div>

      <div className="exercise-reference-block goal">
        <p className="exercise-reference-label">Meta de hoy</p>
        <strong className="exercise-reference-value">{presentation.todayGoalText}</strong>
      </div>
    </div>
  );
}

function SeriesResult({ entry }: { entry: ExerciseMetrics }) {
  const result = buildExerciseCurrentResultPresentation({
    totalReps: entry.totalReps,
    targetTotalReps: entry.targetTotalReps,
    completedSets: entry.completedSets,
    targetSets: entry.targetSets,
    actualWeight: entry.weight,
    targetWeight: entry.previousWeight,
  });

  return (
    <div className={`series-result session-summary ${result.tone}`}>
      <p className="series-result-label">Resumen de tu sesión</p>
      <div className="session-summary-hero">
        <strong>{result.headline}</strong>
        <span>{result.message}</span>
      </div>
      <div className="session-summary-grid">
        {result.items.map((item) => (
          <div className={`session-summary-item ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.detail}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
function ComparisonScreenV2({
  exercises,
  metrics,
  currentWeek,
  routineDays,
  selectedDay,
  setSelectedDay,
}: {
  exercises: ExerciseTemplate[];
  metrics: ExerciseMetrics[];
  currentWeek: number;
  routineDays: string[];
  selectedDay: string;
  setSelectedDay: (day: string) => void;
}) {
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const activeDay = routineDays.includes(selectedDay) ? selectedDay : routineDays[0] ?? selectedDay;
  const comparisonModel = useMemo(() => buildWeeklyExerciseComparisonModel({
    plannedExercises: exercises,
    entries: metrics,
    selectedDay: activeDay,
    selectedExerciseId,
    selectedWeek,
    currentWeek,
  }), [activeDay, currentWeek, exercises, metrics, selectedExerciseId, selectedWeek]);

  useEffect(() => {
    if (comparisonModel.selectedExerciseId && comparisonModel.selectedExerciseId !== selectedExerciseId) {
      setSelectedExerciseId(comparisonModel.selectedExerciseId);
    }
  }, [comparisonModel.selectedExerciseId, selectedExerciseId]);

  useEffect(() => {
    if (comparisonModel.selectedWeek !== selectedWeek) {
      setSelectedWeek(comparisonModel.selectedWeek);
    }
  }, [comparisonModel.selectedWeek, selectedWeek]);

  return (
    <section className="screen weekly-comparison-screen" data-section="weekly-comparison">
      <div className="weekly-comparison-shell">
        <div className="weekly-comparison-section select-day-section">
          <div>
            <h3>Selecciona el día</h3>
            <p>Cambia entre tus días registrados para revisar tu progreso.</p>
          </div>
          <label className="weekly-comparison-select" aria-label="Seleccionar día de entrenamiento">
            <select
              value={activeDay}
              onChange={(event) => {
                setSelectedDay(event.target.value);
                setSelectedExerciseId("");
                setSelectedWeek(null);
              }}
            >
              {routineDays.map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </label>
        </div>

        <section className="weekly-comparison-section">
          <h3>Rutina registrada {comparisonModel.selectedDay}</h3>
          <p className="weekly-routine-name">{comparisonModel.plannedRoutine ?? "Sin rutina registrada"}</p>
        </section>

        <section className="weekly-comparison-section">
          <h3>Rutina de entrenamiento registrada</h3>
          <p>Selecciona dentro de la tabla el ejercicio para obtener más detalles.</p>
          <div className="weekly-plan-table" role="table" aria-label="Rutina planificada del día">
            <div role="rowgroup">
              <div className="weekly-plan-row heading" role="row">
                <span role="columnheader">Ejercicios</span>
                <span role="columnheader">Series</span>
                <span role="columnheader">Reps</span>
                <span role="columnheader">KG</span>
              </div>
            </div>
            <div role="rowgroup">
              {comparisonModel.plannedExercises.length > 0 ? comparisonModel.plannedExercises.map((exercise) => (
                <div
                  className={`weekly-plan-row ${exercise.isSelected ? "active" : ""}`}
                  role="row"
                  key={exercise.exerciseId}
                  onClick={() => {
                    setSelectedExerciseId(exercise.exerciseId);
                    setSelectedWeek(null);
                  }}
                >
                  <span role="cell">
                    <button
                      className="weekly-plan-row-button"
                      type="button"
                      aria-pressed={exercise.isSelected}
                      onClick={() => {
                        setSelectedExerciseId(exercise.exerciseId);
                        setSelectedWeek(null);
                      }}
                    >
                      {exercise.name}
                    </button>
                  </span>
                  <span role="cell">{exercise.targetSets}</span>
                  <span role="cell">{exercise.targetReps}</span>
                  <span role="cell">{formatDecimalEs(exercise.baseWeight)}</span>
                </div>
              )) : (
                <div className="weekly-comparison-empty">No hay ejercicios configurados para este día.</div>
              )}
            </div>
          </div>
        </section>

        <section className="weekly-comparison-section">
          <div className="weekly-results-heading">
            <h3>Tus resultados</h3>
            {comparisonModel.availableWeeks.length > 0 ? (
              <label className="weekly-comparison-select week-select" aria-label="Seleccionar semana para comparar">
                <select
                  value={comparisonModel.selectedWeek ?? ""}
                  onChange={(event) => setSelectedWeek(Number(event.target.value))}
                >
                  {comparisonModel.availableWeeks.map((week) => (
                    <option key={week} value={week}>Semana {week}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <WeeklyResultsPanel model={comparisonModel} />
        </section>

        <WeeklyMetricProgressCard
          title="Compara los KG de tus ejercicios"
          helper="Selecciona un ejercicio para saber cómo vas evolucionando semana a semana."
          model={comparisonModel}
          metric="kg"
        />

        <WeeklyMetricProgressCard
          title="Compara las repeticiones de tus ejercicios"
          helper="Selecciona un ejercicio para saber cómo vas evolucionando semana a semana."
          model={comparisonModel}
          metric="reps"
        />
      </div>
    </section>
  );
}

function WeeklyResultsPanel({ model }: { model: WeeklyExerciseComparisonModel }) {
  const baseline = model.resultComparison.baseline;
  const effective = model.resultComparison.effective;

  if (!model.selectedExercise) {
    return <div className="weekly-comparison-empty">Selecciona un día con ejercicios para revisar resultados.</div>;
  }

  if (!baseline) {
    return (
      <div className="weekly-results-card">
        <p className="weekly-results-kicker">Este es tu ejercicio registrado</p>
        <strong>{model.selectedExercise.name} <span>{model.selectedExercise.targetSets} x {model.selectedExercise.targetReps} · {formatKg(model.selectedExercise.baseWeight)}</span></strong>
        <div className="weekly-comparison-empty">Aún no hay registros reales para este ejercicio. Cuando completes una semana, podremos mostrar tu evolución.</div>
      </div>
    );
  }

  const isFirstReferenceOnly = model.emptyState === "insufficient_chart_data";
  const firstReferenceCopy = model.availableWeeks.length <= 1
    ? "Esta es tu primera referencia registrada. Cuando completes otra semana, podremos comparar tu evolución."
    : "Esta es tu primera semana registrada para este ejercicio. Selecciona una semana posterior para comparar tu evolución.";

  return (
    <div className="weekly-results-card">
      <p className="weekly-results-kicker">Este es tu ejercicio registrado</p>
      <strong>{model.selectedExercise.name} <span>{model.selectedExercise.targetSets} x {model.selectedExercise.targetReps} · {formatKg(model.selectedExercise.baseWeight)}</span></strong>
      {model.isUsingFallbackBaseline ? (
        <p className="weekly-results-note">Usaremos tu primera semana registrada como punto de partida.</p>
      ) : null}
      {isFirstReferenceOnly ? (
        <div className="weekly-comparison-empty">{firstReferenceCopy}</div>
      ) : (
        <div className="weekly-results-grid">
          <WeeklySeriesColumn title={`Semana ${baseline.week}`} record={baseline} />
          <WeeklySeriesColumn title={`Semana ${effective?.week ?? "—"}`} record={effective} />
        </div>
      )}
      <p className="weekly-results-note">Primer registro vs semana elegida</p>
    </div>
  );
}

function WeeklySeriesColumn({ title, record }: { title: string; record: WeeklyExerciseComparisonModel["resultComparison"]["baseline"] }) {
  if (!record) {
    return (
      <div className="weekly-series-column">
        <span>{title}</span>
        <div className="weekly-comparison-empty compact">Sin registro real.</div>
      </div>
    );
  }

  return (
    <div className="weekly-series-column">
      <span>{title}</span>
      <small>{formatDate(record.date)}</small>
      {record.reps.map((reps, index) => (
        <div className="weekly-series-pill" key={`${record.entryId}-${index}`}>
          <span>S{index + 1}:</span>
          <strong>{formatKg(record.weight)} · {reps} reps</strong>
        </div>
      ))}
    </div>
  );
}

function WeeklyMetricProgressCard({
  title,
  helper,
  model,
  metric,
}: {
  title: string;
  helper: string;
  model: WeeklyExerciseComparisonModel;
  metric: "kg" | "reps";
}) {
  const summary = metric === "kg" ? model.kgSummary : model.repsSummary;
  const series = metric === "kg" ? model.kgChartSeries : model.repsChartSeries;
  const chartData = series.map((point) => ({ label: point.label, value: point.value, date: point.date }));
  const hasEnoughChartData = series.length > 1;
  const unit = metric === "kg" ? "kg" : "reps";

  return (
    <section className="weekly-comparison-section weekly-metric-card">
      <h3>{title}</h3>
      <p>{helper}</p>
      <div className="weekly-selected-exercise">{model.selectedExercise?.name ?? "Sin ejercicio seleccionado"}</div>

      {hasEnoughChartData ? (
        <div className="weekly-chart-box">
          <ResponsiveContainer width="100%" height={210}>
            <ReLineChart data={chartData} margin={{ top: 18, right: 18, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="rgba(220,231,255,.12)" />
              <XAxis dataKey="label" stroke="#9CA8B8" />
              <YAxis stroke="#9CA8B8" width={38} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value} ${unit}`, metric === "kg" ? "Peso" : "Reps"]} labelFormatter={(label) => `${label}`} />
              <Line type="monotone" dataKey="value" stroke="#3C7AFF" strokeWidth={3} dot={{ r: 5, strokeWidth: 2 }} activeDot={{ r: 7 }} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="weekly-comparison-empty">Aún no hay datos suficientes para graficar este ejercicio.</div>
      )}

      <p className="weekly-chart-copy">
        {metric === "kg"
          ? "El gráfico muestra cómo cambia la carga registrada para este ejercicio durante el ciclo de entrenamiento."
          : "El gráfico muestra cómo cambian las repeticiones registradas para este ejercicio durante el ciclo de entrenamiento."}
      </p>

      <WeeklyMetricSummaryView summary={summary} model={model} metric={metric} />
    </section>
  );
}

function WeeklyMetricSummaryView({
  summary,
  model,
  metric,
}: {
  summary: WeeklyExerciseMetricSummary;
  model: WeeklyExerciseComparisonModel;
  metric: "kg" | "reps";
}) {
  const baseline = model.resultComparison.baseline;
  const effective = model.resultComparison.effective;
  const differenceLabel = formatMetricDifference(summary.difference, metric);
  const toneClass = summary.tone === "positive" ? "positive" : summary.tone === "negative" ? "danger" : "neutral";

  if (summary.status === "unavailable" || !baseline || !effective) {
    return <div className="weekly-comparison-empty">Sin historial suficiente para este ejercicio.</div>;
  }

  if (model.emptyState === "insufficient_chart_data") {
    return (
      <div className="weekly-comparison-empty">
        {model.availableWeeks.length <= 1
          ? "Esta es tu primera referencia registrada para este ejercicio. Cuando registres otra semana, podremos mostrar tu evolución."
          : "Esta es tu primera semana registrada para este ejercicio. Selecciona una semana posterior para ver la evolución."}
      </div>
    );
  }

  return (
    <div className={`weekly-metric-summary ${metric === "reps" ? "reps-summary" : "kg-summary"}`}>
      <div>
        <h4>Cómo iniciaste</h4>
        <strong>{metric === "kg" ? formatKg(baseline.weight) : baseline.repsLabel}</strong>
        <span>Fecha inicio</span>
        <small>{formatDate(baseline.date)}</small>
      </div>
      <div className="weekly-metric-divider" aria-hidden="true" />
      <div>
        <h4>Actualmente</h4>
        <strong>{metric === "kg" ? formatKg(effective.weight) : effective.repsLabel}</strong>
        <span>Fecha actual</span>
        <small>{formatDate(effective.date)}</small>
      </div>
      <p className={`weekly-metric-difference ${toneClass}`}>{differenceLabel}</p>
      {metric === "kg" && summary.difference === 0 ? (
        <p className="weekly-metric-insight">Aún no hay diferencias en peso. Apenas registres una variación, la mostraremos aquí.</p>
      ) : (
        <p className="weekly-metric-insight">{buildMetricInsight(summary.difference, metric)}</p>
      )}
    </div>
  );
}

function formatMetricDifference(value: number | null, metric: "kg" | "reps") {
  if (value === null) return "—";
  const suffix = metric === "kg" ? "kg" : "repes";
  return `${formatSigned(value, metric === "kg" ? 2 : 0)} ${suffix}`;
}

function buildMetricInsight(value: number | null, metric: "kg" | "reps") {
  if (value === null) return "Aún no hay información suficiente para comparar este ejercicio.";
  const absolute = Math.abs(value);
  const label = metric === "kg" ? `${formatDecimalEs(absolute)}kg` : `${formatDecimalEs(absolute)} repes`;
  if (value > 0) return `Aumentaste +${label} desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.`;
  if (value < 0) return `Bajaste -${label} desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.`;
  return metric === "kg"
    ? "Mantienes el mismo peso desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio."
    : "Mantienes las mismas repeticiones desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.";
}

function ExerciseHistorySummaryCard({ summary }: { summary: ExerciseComparisonSummary }) {
  return (
    <div className={`exercise-history-summary ${getTrendTone(summary.trend)}`}>
      <div className="exercise-history-title">
        <div>
          <p className="eyebrow">Ejercicio seleccionado</p>
          <h3>{summary.exerciseName}</h3>
        </div>
        <span>{summary.trend}</span>
      </div>
      <div className="history-summary-grid">
        <div>
          <span>Inicio</span>
          <strong>{formatKg(summary.firstWeight)}</strong>
          <small>Fecha inicio: {formatDate(summary.firstDate)}</small>
        </div>
        <div>
          <span>Actual</span>
          <strong>{formatKg(summary.latestWeight)}</strong>
          <small>Fecha actual: {formatDate(summary.latestDate)}</small>
        </div>
      </div>
      <div className="history-gain-row">
        <span>Ganancia total</span>
        <strong className={summary.weightGain > 0 ? "positive" : summary.weightGain < 0 ? "danger" : "neutral"}>
          {formatSigned(summary.weightGain, 2)} kg en {summary.exerciseName.toLowerCase()}
        </strong>
      </div>
      <p>{summary.insight}</p>
    </div>
  );
}

function ExerciseBestMarkCard({ summary }: { summary: ExerciseComparisonSummary }) {
  return (
    <div className="exercise-best-card">
      <div>
        <p className="eyebrow">Mejor marca registrada</p>
        <h3>{formatKg(summary.bestWeight)}</h3>
      </div>
      <span>Fecha: {formatDate(summary.bestWeightDate)}</span>
    </div>
  );
}

function ExerciseHistoryList({ summary }: { summary: ExerciseComparisonSummary }) {
  return (
    <div className="exercise-history-list">
      <h3>Historial resumido</h3>
      <div className="history-list">
        {summary.history.map((point) => (
          <div className="history-row exercise-history-row" key={`${point.date}-${point.weight}-${point.totalReps}`}>
            <div>
              <strong>{point.weekLabel ?? "Registro"}</strong>
              <span>{formatDate(point.date)}</span>
            </div>
            <div>
              <span>{formatKg(point.weight)}</span>
              <span>{point.totalReps} reps</span>
              <span>volumen {formatKg(point.volumeTotal)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getTrendTone(trend: ExerciseComparisonSummary["trend"]) {
  if (trend === "Mejora") return "ok";
  if (trend === "Retroceso") return "fail";
  return "keep";
}

function buildAnalytics(summary: ReturnType<typeof calculateWeeklySummary>, currentMetrics: ExerciseMetrics[]): AnalyticsSnapshot {
  const targetReps = currentMetrics.reduce((total, entry) => total + entry.targetTotalReps, 0);
  const completedWithLoad = currentMetrics.filter((entry) => entry.totalReps > 0 && entry.kgDifference >= 0).length;
  const repsScore = targetReps > 0 ? clampScore((summary.totalReps / targetReps) * 100) : 0;
  const loadScore = currentMetrics.length > 0 ? clampScore((completedWithLoad / currentMetrics.length) * 100) : 0;
  const volumeScore = clampScore(100 + summary.volumePercentage);
  const score = Math.round(
    summary.complianceRate * 0.4 +
    repsScore * 0.25 +
    loadScore * 0.2 +
    volumeScore * 0.15,
  );
  const factors: Array<[string, number]> = [
    ["Cumplimiento ejercicios", summary.complianceRate],
    ["Repeticiones logradas", repsScore],
    ["Carga mantenida/subida", loadScore],
    ["Volumen vs objetivo/semana anterior", volumeScore],
  ];
  return { score, factors };
  /*
  return (
    <section className="screen">
      <div className="card wide">
        <div className="score"><div><strong>{score}</strong><span>/100</span></div></div>
        <p className="positive" style={{ textAlign: "center" }}>Excelente · +7 pts vs semana anterior</p>
      </div>
      <div className="card wide">
        <h3>Factores de rendimiento</h3>
        {factors.map(([label, value]) => <ProgressLine key={String(label)} label={String(label)} value={Number(value)} />)}
      </div>
    </section>
  );
  */
}

function clampScore(value: number) {
  return Math.min(100, Math.max(0, value));
}

function RoutineMetricGrid({
  targetSummary,
  exerciseLabel = "Ejercicios total",
}: {
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  exerciseLabel?: string;
}) {
  return (
    <div className="metric-grid wide dashboard-metric-grid routine-metric-grid">
      <div className="metric">
        <div className="metric-title-row">
          <span>KG totales de la rutina</span>
          <Dumbbell size={18} />
        </div>
        <strong>{formatKg(targetSummary.totalWeight)}</strong>
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>Total reps</span>
          <Activity size={18} />
        </div>
        <strong>{targetSummary.reps}</strong>
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>{exerciseLabel}</span>
          <CalendarDays size={18} />
        </div>
        <strong>{targetSummary.exerciseCount}</strong>
      </div>
    </div>
  );
}

function MetricGrid({ summary }: { summary: ReturnType<typeof calculateWeeklySummary> }) {
  return (
    <div className="metric-grid wide dashboard-metric-grid">
      <div className="metric">
        <div className="metric-title-row">
          <span>Volumen de trabajo</span>
          <Dumbbell size={18} />
        </div>
        <strong>{formatKg(summary.volumeTotal)}</strong>
        <TrendValue value={summary.volumePercentage} suffix="%" />
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>Total reps</span>
          <Activity size={18} />
        </div>
        <strong>{summary.totalReps}</strong>
        <TrendValue value={summary.repsDifference} />
      </div>
      <div className="metric">
        <div className="metric-title-row">
          <span>Ejercicios</span>
          <CalendarDays size={18} />
        </div>
        <strong>{summary.exerciseCount}</strong>
        <TrendValue value={summary.exerciseDifference} />
      </div>
    </div>
  );
}

function TrendValue({ value, suffix = "" }: { value: number; suffix?: string }) {
  const tone = value > 0 ? "positive" : value < 0 ? "danger" : "neutral";
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : ArrowRight;

  return (
    <span className={`trend ${tone}`}>
      <Icon size={12} strokeWidth={3} />
      {formatSigned(value)}
      {suffix}
    </span>
  );
}

function ExerciseRow({ entry, showVolume = false }: { entry: ExerciseMetrics; showVolume?: boolean }) {
  const tone = getObjectiveTone(entry.objectiveStatus);
  return (
    <div className={`exercise-row ${tone}`}>
      <div>
        <strong>{entry.exerciseName}</strong>
        <div className="exercise-progress">
          <WeightValue value={entry.weight} label="kg actual" />
          <DeltaValue value={entry.repsDifference} suffix="reps" />
          <DeltaValue value={entry.kgDifference} suffix="kg" />
          {showVolume ? <DeltaValue value={entry.volumePercentage} suffix="% volumen" /> : null}
        </div>
      </div>
      <div className="status-stack">
        <StatusBadge status={entry.objectiveStatus} />
        <ChangeBadge value={entry.kgDifference} positive="Subimos kg" negative="Bajamos kg" neutral="Mismo kg" />
        <ChangeBadge value={entry.repsDifference} positive="Subimos reps" negative="Bajamos reps" neutral="Mismas reps" />
      </div>
    </div>
  );
}

function ProgrammedExerciseCard({ exercise, showStatus = true }: { exercise: ExerciseTemplate; showStatus?: boolean }) {
  return (
    <div className="plan-row programmed-exercise-card">
      <div className="programmed-exercise-header">
        <strong>{exercise.name}</strong>
        {showStatus ? <span className="programmed-status">Pendiente</span> : null}
      </div>
      <div className="programmed-exercise-values">
        <span>Series: <b>{exercise.targetSets}</b></span>
        <span>Reps: <b>{exercise.targetReps}</b></span>
        <span>Kg: <b>{formatKg(exercise.baseWeight)}</b></span>
      </div>
    </div>
  );
}

function RegisteredExerciseCard({ entry }: { entry: ExerciseMetrics }) {
  return (
    <div className="registered-exercise-card">
      <strong>{entry.exerciseName}</strong>
      <span className="registered-status">Registrado</span>
    </div>
  );
}

function WeightValue({ value, label }: { value: number; label: string }) {
  return <span className="current-weight-value">{label}: {formatKg(value)}</span>;
}

function DeltaValue({ value, suffix, neutralWhenZero = true }: { value: number; suffix: string; neutralWhenZero?: boolean }) {
  const tone = value > 0 ? "positive" : value < 0 ? "danger" : neutralWhenZero ? "neutral" : "positive";
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : ArrowRight;
  const formattedValue = suffix === "kg" ? formatSigned(value, 2) : formatSigned(value);

  return (
    <span className={`delta-value ${tone}`}>
      <Icon size={12} strokeWidth={3} />
      {neutralWhenZero ? formattedValue : value}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function StatusBadge({ status }: { status: ObjectiveStatus }) {
  const className = getObjectiveTone(status);
  return <span className={`badge ${className}`}>{getObjectiveStatusLabel(status)}</span>;
}

function ChangeBadge({ value, positive, negative, neutral }: { value: number; positive: string; negative: string; neutral: string }) {
  const className = value > 0 ? "ok" : value < 0 ? "fail" : "keep";
  const label = value > 0 ? positive : value < 0 ? negative : neutral;
  return <span className={`badge mini ${className}`}>{label}</span>;
}

function getObjectiveTone(status: ObjectiveStatus) {
  if (status === "Cumplimos" || status === "Mejoramos") return "ok";
  if (status === "No cumplimos") return "fail";
  return "keep";
}

function getInsightToneClass(tone: "positivo" | "alerta" | "riesgo" | "info") {
  if (tone === "positivo") return "tone-positive";
  if (tone === "riesgo") return "tone-negative";
  return "tone-warning";
}

function ProgressLine({ label, value }: { label: string; value: number }) {
  const normalized = Math.min(100, Math.max(0, value));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <span className="eyebrow">{label}</span>
        <span className="eyebrow">{Math.round(normalized)}/100</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${normalized}%` }} />
      </div>
    </div>
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

function createSetupByDay(): Record<string, SetupDayState> {
  return Object.fromEntries(setupDays.map((day) => [day, createSetupDayState()]));
}

function getConfiguredSetupDays(setupByDay: Record<string, SetupDayState>) {
  return setupDays.filter((day) => setupByDay[day]?.rows.some((row) => row.name.trim()));
}

function hasSetupDraftContent(setupByDay: Record<string, SetupDayState>) {
  return setupDays.some((day) => {
    const state = setupByDay[day];
    return Boolean(state?.routineName.trim() || state?.rows.some((row) => row.name.trim() || row.sets || row.reps || row.weight));
  });
}

function createDefaultTrainingPlan(): TrainingPlan {
  return {
    cycleType: "meso",
    macroObjective: "Hipertrofia",
    macroDurationMonths: 6,
    mesoObjective: "Hipertrofia",
    mesoDurationWeeks: 4,
    microDurationWeeks: 1,
    sessionDurationDays: 1,
    trainingDays: ["Lunes"],
    microFocus: "Progresión",
    sessionFocus: "Técnica",
  };
}

function createControlledNextTrainingPlan(): TrainingPlan {
  return {
    ...createDefaultTrainingPlan(),
    // 2.2AK controlled validation path; replace with explicit UI selection in the final product flow.
    cycleType: "micro",
    microFocus: "Descarga",
    microDurationWeeks: 1,
  };
}

function createTrainingPlanFromPersistedCycle(cycle: PersistedTrainingCycle, fallback: TrainingPlan): TrainingPlan {
  const snapshot = cycle.planSnapshot;
  const nestedPlan = readSnapshotRecord(snapshot, "plan");
  const snapshotCycleType = readSnapshotString(snapshot, "cycleType");
  const cycleType = isTrainingCycleId(snapshotCycleType)
    ? snapshotCycleType
    : isTrainingCycleId(cycle.cycleType)
      ? cycle.cycleType
      : fallback.cycleType;
  const goal = readNonEmptyString(cycle.goal) ?? readSnapshotString(snapshot, "goal") ?? getCycleObjectiveValue(fallback);
  const duration = readSnapshotNumber(snapshot, "duration") || readSnapshotNumber(snapshot, "durationWeeks");
  const trainingDays = readSnapshotStringList(snapshot, "trainingDays", setupDays.length).length > 0
    ? readSnapshotStringList(snapshot, "trainingDays", setupDays.length)
    : readSnapshotStringList(nestedPlan, "trainingDays", setupDays.length);
  const next: TrainingPlan = {
    ...fallback,
    cycleType,
    trainingDays: sortTrainingDaysByWeekOrder(
      trainingDays.length > 0 ? trainingDays : fallback.trainingDays,
    ),
  };

  if (cycleType === "macro") {
    next.macroObjective = goal;
    if (duration > 0) next.macroDurationMonths = duration;
  } else if (cycleType === "meso") {
    next.mesoObjective = goal;
    if (duration > 0) next.mesoDurationWeeks = duration;
  } else if (cycleType === "micro") {
    next.microFocus = goal;
    if (duration > 0) next.microDurationWeeks = duration;
  } else {
    next.sessionFocus = goal;
    if (duration > 0) next.sessionDurationDays = duration;
  }

  return next;
}

function createCycleScopedPlanInput(
  plan: TrainingPlan,
  setupByDay: Record<string, SetupDayState>,
  source: string,
): CycleScopedPlanInput | null {
  const plannedDays = sortTrainingDaysByWeekOrder(
    (plan.trainingDays.length > 0 ? plan.trainingDays : ["Lunes"])
      .filter((day) => setupDays.includes(day)),
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

function createExerciseTemplatesFromCycleScopedPlan(plan: CycleScopedTrainingPlan): ExerciseTemplate[] {
  return plan.routines.flatMap((routine) =>
    routine.days.flatMap((day) =>
      day.exercises.map((exercise) => ({
        id: exercise.id,
        cycleId: exercise.cycleId,
        cycleDayId: day.id,
        trainingCycleExerciseId: exercise.id,
        exerciseLineageId: exercise.exerciseLineageId,
        sourceLegacyExerciseId: exercise.sourceLegacyExerciseId,
        routine: getCycleScopedDayRoutineName(day.notes, routine.name),
        day: getSetupDayFromTrainingDayCode(day.dayCode),
        name: exercise.name,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        baseWeight: exercise.baseWeight,
        sideWeight: exercise.sideWeight ?? undefined,
        notes: exercise.notes ?? undefined,
      })),
    ),
  );
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

function isCycleScopedTrainingCycle(cycle: PersistedTrainingCycle) {
  const snapshotSource = readSnapshotString(cycle.planSnapshot, "source");
  return snapshotSource === "cycle-scoped-qa" || snapshotSource === "cycle-scoped";
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

function normalizeTrainingPlan(value: unknown): TrainingPlan {
  const fallback = createDefaultTrainingPlan();
  if (!value || typeof value !== "object") return fallback;

  const parsed = value as Partial<TrainingPlan>;
  const trainingDays = Array.isArray(parsed.trainingDays)
    ? parsed.trainingDays.filter((day) => setupDays.includes(day))
    : fallback.trainingDays;

  return {
    cycleType: isTrainingCycleId(parsed.cycleType) ? parsed.cycleType : fallback.cycleType,
    macroObjective: parsed.macroObjective || fallback.macroObjective,
    macroDurationMonths: macroDurations.includes(Number(parsed.macroDurationMonths)) ? Number(parsed.macroDurationMonths) : fallback.macroDurationMonths,
    mesoObjective: parsed.mesoObjective || fallback.mesoObjective,
    mesoDurationWeeks: mesoDurations.includes(Number(parsed.mesoDurationWeeks)) ? Number(parsed.mesoDurationWeeks) : fallback.mesoDurationWeeks,
    microDurationWeeks: Number(parsed.microDurationWeeks) === 1 ? 1 : fallback.microDurationWeeks,
    sessionDurationDays: Number(parsed.sessionDurationDays) === 1 ? 1 : fallback.sessionDurationDays,
    trainingDays: sortTrainingDaysByWeekOrder(
      trainingDays.length > 0 ? trainingDays : fallback.trainingDays,
    ),
    microFocus: parsed.microFocus || fallback.microFocus,
    sessionFocus: parsed.sessionFocus || fallback.sessionFocus,
  };
}

function normalizeSetupByDay(value: unknown) {
  const fallback = createSetupByDay();
  if (!value || typeof value !== "object") return fallback;

  const parsed = value as Record<string, Partial<SetupDayState> | undefined>;
  return Object.fromEntries(setupDays.map((day) => {
    const state = parsed[day];
    const rows = Array.isArray(state?.rows)
      ? state.rows.map((row) => ({
        id: typeof row.id === "string" ? row.id : createId(),
        sourceExerciseId: typeof row.sourceExerciseId === "string" ? row.sourceExerciseId : undefined,
        exerciseLineageId: typeof row.exerciseLineageId === "string" ? row.exerciseLineageId : null,
        name: typeof row.name === "string" ? row.name : "",
        sets: Number(row.sets) || 0,
        reps: Number(row.reps) || 0,
        weight: formatDecimalEs(readRequiredWeight(row.weight ?? "")),
      }))
      : fallback[day].rows;

    return [day, {
      routineName: typeof state?.routineName === "string" ? state.routineName : "",
      rows: rows.length > 0 ? rows : createSetupRows(),
    }];
  })) as Record<string, SetupDayState>;
}

function loadTrainingPlan(): TrainingPlan {
  if (typeof window === "undefined") return createDefaultTrainingPlan();

  try {
    const saved = window.localStorage.getItem(LOCAL_TRAINING_PLAN_KEY);
    if (!saved) return createDefaultTrainingPlan();
    const parsed = JSON.parse(saved) as Partial<TrainingPlan>;
    const fallback = createDefaultTrainingPlan();
    const trainingDays = Array.isArray(parsed.trainingDays)
      ? parsed.trainingDays.filter((day) => setupDays.includes(day))
      : fallback.trainingDays;

    return {
      cycleType: isTrainingCycleId(parsed.cycleType) ? parsed.cycleType : fallback.cycleType,
      macroObjective: parsed.macroObjective || fallback.macroObjective,
      macroDurationMonths: macroDurations.includes(Number(parsed.macroDurationMonths)) ? Number(parsed.macroDurationMonths) : fallback.macroDurationMonths,
      mesoObjective: parsed.mesoObjective || fallback.mesoObjective,
      mesoDurationWeeks: mesoDurations.includes(Number(parsed.mesoDurationWeeks)) ? Number(parsed.mesoDurationWeeks) : fallback.mesoDurationWeeks,
      microDurationWeeks: Number(parsed.microDurationWeeks) === 1 ? 1 : fallback.microDurationWeeks,
      sessionDurationDays: Number(parsed.sessionDurationDays) === 1 ? 1 : fallback.sessionDurationDays,
      trainingDays: sortTrainingDaysByWeekOrder(
        trainingDays.length > 0 ? trainingDays : fallback.trainingDays,
      ),
      microFocus: parsed.microFocus || fallback.microFocus,
      sessionFocus: parsed.sessionFocus || fallback.sessionFocus,
    };
  } catch {
    return createDefaultTrainingPlan();
  }
}

function saveTrainingPlan(plan: TrainingPlan) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_TRAINING_PLAN_KEY, JSON.stringify({
    ...plan,
    trainingDays: sortTrainingDaysByWeekOrder(plan.trainingDays),
  }));
}

function loadCycleHistory(): TrainingCycleSnapshot[] {
  if (typeof window === "undefined") return [];

  try {
    const saved = window.localStorage.getItem(LOCAL_CYCLE_HISTORY_KEY);
    return saved ? (JSON.parse(saved) as TrainingCycleSnapshot[]) : [];
  } catch {
    return [];
  }
}

function saveCycleHistory(history: TrainingCycleSnapshot[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_CYCLE_HISTORY_KEY, JSON.stringify(history));
}

function getRoutineDraftKey(mode: DataMode, userId?: string) {
  return `${ROUTINE_DRAFT_KEY_PREFIX}:${getDraftUserKey(mode, userId)}`;
}

function getWorkoutDraftKey(mode: DataMode, userId?: string) {
  return getStoredWorkoutDraftKey(mode, userId);
}

function getActiveFlowKey(mode: DataMode, userId?: string) {
  return `${ACTIVE_FLOW_KEY_PREFIX}:${getDraftUserKey(mode, userId)}`;
}

function getActiveFlow(
  screen: Screen,
  hasRoutinePlan: boolean,
  isEditingRoutinePlan: boolean,
  hasStartedTraining: boolean,
  readiness: TrainingReadiness | null,
): ActiveFlow {
  if (screen === "registro-entrenamiento" && (!hasRoutinePlan || isEditingRoutinePlan)) {
    return isEditingRoutinePlan && hasRoutinePlan ? "routine_edit" : "routine_setup";
  }
  if (screen === "entrenamiento") {
    if (hasStartedTraining && readiness) return "active_workout";
    if (hasStartedTraining) return "motivation_form";
    return "training_start";
  }
  if (screen === "comparacion") return "comparison";
  if (screen === "historial-ciclos") return "cycle_history";
  if (screen === "perfil") return "profile";
  return "dashboard";
}

function saveActiveFlow(flow: ActiveFlowState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${ACTIVE_FLOW_KEY_PREFIX}:${flow.userKey}`, JSON.stringify(flow));
}

function loadActiveFlow(mode: DataMode, userId?: string) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getActiveFlowKey(mode, userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ActiveFlowState>;
    const userKey = getDraftUserKey(mode, userId);
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    const isExpired = updatedAt === 0 || Date.now() - updatedAt > ACTIVE_FLOW_MAX_AGE_MS;
    if (
      parsed.version !== ACTIVE_FLOW_VERSION ||
      parsed.userKey !== userKey ||
      parsed.dataMode !== mode ||
      !isActiveFlow(parsed.flow) ||
      isExpired
    ) {
      clearActiveFlow(mode, userId);
      return null;
    }

    return {
      version: ACTIVE_FLOW_VERSION,
      updatedAt,
      dataMode: mode,
      userKey,
      flow: parsed.flow,
    } satisfies ActiveFlowState;
  } catch {
    clearActiveFlow(mode, userId);
    return null;
  }
}

function clearActiveFlow(mode: DataMode, userId?: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getActiveFlowKey(mode, userId));
}

function isActiveFlow(value: unknown): value is ActiveFlow {
  return typeof value === "string" && [
    "dashboard",
    "routine_setup",
    "routine_edit",
    "training_start",
    "motivation_form",
    "active_workout",
    "comparison",
    "cycle_history",
    "profile",
  ].includes(value);
}

function saveRoutineDraft(draft: RoutineDraft) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${ROUTINE_DRAFT_KEY_PREFIX}:${draft.userKey}`, JSON.stringify(draft));
}

function loadRoutineDraft(mode: DataMode, userId?: string) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getRoutineDraftKey(mode, userId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<RoutineDraft>;
    const userKey = getDraftUserKey(mode, userId);
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    const isExpired = updatedAt === 0 || Date.now() - updatedAt > ROUTINE_DRAFT_MAX_AGE_MS;
    if (parsed.version !== ROUTINE_DRAFT_VERSION || parsed.userKey !== userKey || parsed.dataMode !== mode || isExpired) {
      clearRoutineDraft(mode, userId);
      return null;
    }

    const setupDay = typeof parsed.setupDay === "string" && setupDays.includes(parsed.setupDay) ? parsed.setupDay : "Lunes";
    const trainingPlan = normalizeTrainingPlan(parsed.trainingPlan);
    const setupByDay = normalizeSetupByDay(parsed.setupByDay);
    if (!hasSetupDraftContent(setupByDay)) return null;

    return {
      version: ROUTINE_DRAFT_VERSION,
      updatedAt,
      dataMode: mode,
      userKey,
      screen: "registro-entrenamiento" as Screen,
      setupDay,
      setupByDay,
      trainingPlan,
      isEditingRoutinePlan: Boolean(parsed.isEditingRoutinePlan),
      routineEditorReturnScreen: parsed.routineEditorReturnScreen && isAppScreen(parsed.routineEditorReturnScreen)
        ? parsed.routineEditorReturnScreen
        : null,
      activeRoutineDay: typeof parsed.activeRoutineDay === "string" && setupDays.includes(parsed.activeRoutineDay)
        ? parsed.activeRoutineDay
        : setupDay,
    } satisfies RoutineDraft;
  } catch {
    clearRoutineDraft(mode, userId);
    return null;
  }
}

function clearRoutineDraft(mode: DataMode, userId?: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getRoutineDraftKey(mode, userId));
}

function saveWorkoutDraft(draft: WorkoutDraft) {
  saveStoredWorkoutDraft(draft);
}

function loadWorkoutDraft(mode: DataMode, userId?: string) {
  return loadStoredWorkoutDraft({
    mode,
    userId,
    version: WORKOUT_DRAFT_VERSION,
    maxAgeMs: WORKOUT_DRAFT_MAX_AGE_MS,
    setupDays,
    normalizeReadiness: normalizeTrainingReadiness,
    normalizeExerciseDrafts,
  });
}

function clearWorkoutDraft(mode: DataMode, userId?: string) {
  clearStoredWorkoutDraft(mode, userId);
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

function createPersistedCyclePlanSnapshot(plan: TrainingPlan, exercises: ExerciseTemplate[], source: string): PersistedTrainingCycleSnapshot {
  return {
    source,
    cycleType: plan.cycleType,
    goal: getCycleObjectiveValue(plan),
    duration: getCycleDurationValue(plan),
    trainingDays: sortTrainingDaysByWeekOrder(plan.trainingDays),
    exerciseCount: exercises.length,
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

function getNextPersistedCycleNumber(activeCycle: PersistedTrainingCycle | null, history: PersistedTrainingCycle[]) {
  const numbers = [
    activeCycle?.cycleNumber,
    ...history.map((cycle) => cycle.cycleNumber),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return Math.max(0, ...numbers) + 1;
}

function mergeTrainingPlanWithExercises(plan: TrainingPlan, exercises: ExerciseTemplate[]) {
  const routineDays = getRoutineDays(exercises);
  if (routineDays.length === 0) return plan;
  const hasDefaultDays = sameDayList(plan.trainingDays, createDefaultTrainingPlan().trainingDays);
  if (hasDefaultDays) return { ...plan, trainingDays: routineDays };
  return {
    ...plan,
    trainingDays: sortTrainingDaysByWeekOrder(
      plan.trainingDays.filter((day) => setupDays.includes(day)),
    ),
  };
}

function isTrainingCycleId(value: unknown): value is TrainingCycleId {
  return typeof value === "string" && trainingCycles.some((cycle) => cycle.id === value);
}

function getCycleObjectiveOptions(cycleType: TrainingCycleId) {
  if (cycleType === "macro") return macroObjectives;
  if (cycleType === "meso") return mesoObjectives;
  if (cycleType === "micro") return microFocusOptions;
  return sessionFocusOptions;
}

function getCycleDurationOptions(cycleType: TrainingCycleId) {
  if (cycleType === "macro") return macroDurations.map((value) => ({ value, label: `${value} meses` }));
  if (cycleType === "meso") return mesoDurations.map((value) => ({ value, label: `${value} semanas` }));
  if (cycleType === "micro") return [{ value: 1, label: "1 semana" }];
  return [{ value: 1, label: "1 día" }];
}

function getCycleObjectiveValue(plan: TrainingPlan) {
  if (plan.cycleType === "macro") return plan.macroObjective;
  if (plan.cycleType === "meso") return plan.mesoObjective;
  if (plan.cycleType === "micro") return plan.microFocus;
  return plan.sessionFocus;
}

function getCycleDurationValue(plan: TrainingPlan) {
  if (plan.cycleType === "macro") return plan.macroDurationMonths;
  if (plan.cycleType === "meso") return plan.mesoDurationWeeks;
  if (plan.cycleType === "micro") return plan.microDurationWeeks;
  return plan.sessionDurationDays;
}

function getCycleTitle(plan: TrainingPlan) {
  const cycle = trainingCycles.find((item) => item.id === plan.cycleType);
  return `${cycle?.title ?? "Ciclo"} · ${getCycleObjectiveValue(plan)}`;
}

function getCycleTypeTitle(plan: TrainingPlan) {
  const cycle = trainingCycles.find((item) => item.id === plan.cycleType);
  return cycle?.title ?? "Ciclo";
}

function getCycleDurationLabel(plan: TrainingPlan) {
  const unit = plan.cycleType === "macro" ? "meses" : plan.cycleType === "session" ? "dia" : "semanas";
  return `${getCycleDurationValue(plan)} ${unit}`;
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

function buildReadinessAiSummary(entries: ExerciseEntry[], currentWeek: number, routineDays: string[]) {
  const uniqueCheckIns = new Map<string, ReadinessScores>();

  for (const entry of entries.filter((item) => item.week === currentWeek)) {
    const parsed = parseReadiness(entry.notes);
    if (parsed) {
      uniqueCheckIns.set(`${entry.date}-${entry.notes}`, parsed);
    }
  }

  const values = [...uniqueCheckIns.values()];

  if (values.length === 0) {
    return {
      title: "Sin lectura de ánimo todavía",
      suggestion: `Completa el formulario de motivación antes de entrenar. Tienes ${routineDays.length} día${routineDays.length === 1 ? "" : "s"} planificado${routineDays.length === 1 ? "" : "s"}.`,
      signals: [
        { label: "Formulario de motivación pendiente", value: "Aún no hay datos de ánimo", tone: "keep", toneLabel: "info" },
      ],
    };
  }

  const averages = {
    motivation: average(values.map((item) => item.motivation)),
    hydration: average(values.map((item) => item.hydration)),
    sleep: average(values.map((item) => item.sleep)),
    energy: average(values.map((item) => item.energy)),
  };
  const total = average(Object.values(averages));
  const weakest = Object.entries(averages).sort((a, b) => a[1] - b[1])[0];
  const weakestLabel = readinessLabels[weakest[0] as keyof ReadinessScores];
  const title = total >= 5.5 ? "Listo para entrenar" : total >= 4 ? "Entrena con control" : "Baja la exigencia";
  const suggestion = total >= 5.5
    ? "Buen contexto para cumplir la rutina. Sube carga solo si las repeticiones salen limpias."
    : total >= 4
      ? `Cuida ${weakestLabel.toLowerCase()}, calienta mejor y mantén pesos si la técnica no se siente firme.`
      : "Hoy prioriza técnica, descanso entre series y completar sin forzar marcas.";

  return {
    title,
    suggestion,
    signals: [
      createReadinessSignal("Motivación", averages.motivation),
      createReadinessSignal("Hidratación", averages.hydration),
      createReadinessSignal("Sueño", averages.sleep),
      createReadinessSignal("Energía", averages.energy),
    ],
  };
}

function createReadinessSignal(label: string, value: number) {
  const tone = value >= 5.5 ? "ok" : value >= 4 ? "keep" : "fail";
  const toneLabel = value >= 5.5 ? "alto" : value >= 4 ? "medio" : "bajo";
  return {
    label: `${label} ${toneLabel}`,
    value: `${formatReadinessScore(value)}/7`,
    tone,
    toneLabel,
  };
}
const readinessLabels: Record<keyof ReadinessScores, string> = {
  motivation: "Motivación",
  hydration: "Hidratación",
  sleep: "Sueño",
  energy: "Energía física",
};

function average(values: number[]) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function formatReadinessScore(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function readSnapshotNumber(snapshot: PersistedTrainingCycleSnapshot, key: string) {
  const value = snapshot[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readSnapshotString(snapshot: PersistedTrainingCycleSnapshot, key: string) {
  return readNonEmptyString(snapshot[key]);
}

function readSnapshotRecord(snapshot: PersistedTrainingCycleSnapshot, key: string): PersistedTrainingCycleSnapshot {
  const value = snapshot[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PersistedTrainingCycleSnapshot
    : {};
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readSnapshotStringList(snapshot: PersistedTrainingCycleSnapshot, key: string, limit: number) {
  const value = snapshot[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, limit);
}

function readSnapshotMoodSummary(snapshot: PersistedTrainingCycleSnapshot) {
  const fallback = {
    score: null as number | null,
    message: "No hay suficientes formularios de motivación para resumir el estado de ánimo.",
  };
  const value = snapshot.moodSummary;
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;

  const score = "score" in value && typeof value.score === "number" && Number.isFinite(value.score)
    ? value.score
    : null;
  const message = "message" in value && typeof value.message === "string" && value.message.trim().length > 0
    ? value.message
    : fallback.message;

  return { score, message };
}

function formatSnapshotList(items: string[], fallback: string) {
  return items.length > 0 ? items.join(", ") : fallback;
}

function translateTrainingCycleRepositoryError(error: unknown) {
  if (error instanceof CycleScopedTrainingRepositoryError) {
    if (error.code === "session_required") return "Debes iniciar sesion para gestionar el plan del ciclo.";
    if (error.code === "session_expired") return "Tu sesion expiro. Inicia sesion nuevamente.";
    if (error.code === "invalid_plan") return error.message;
    if (error.code === "active_cycle_exists") return "Ya existe un ciclo activo para tu cuenta.";
    if (error.code === "permission_denied") return "No tienes permisos para gestionar este plan de ciclo.";
    return "No pudimos completar la accion sobre el plan del ciclo.";
  }

  if (error instanceof TrainingCycleRepositoryError) {
    if (error.code === "session_required") return "Debes iniciar sesión para gestionar ciclos.";
    if (error.code === "session_expired") return "Tu sesión expiró. Inicia sesión nuevamente.";
    if (error.code === "active_cycle_exists") return "Ya existe un ciclo activo para tu cuenta.";
    if (error.code === "active_cycle_missing") return "No existe un ciclo activo para finalizar.";
    if (error.code === "protected_cycle") return PROTECTED_ACTIVE_CYCLE_MESSAGE;
    if (error.code === "permission_denied") return "No tienes permisos para acceder a este ciclo.";
    return "No pudimos completar la acción sobre ciclos.";
  }

  return translatePersistenceError(error);
}



function translateTrainingWorkoutReadinessError(error: unknown) {
  if (error instanceof TrainingWorkoutReadinessRepositoryError) {
    if (error.code === "session_required") return "Inicia sesion para confirmar tu formulario de entrenamiento.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "No pudimos confirmar tu formulario de entrenamiento. Intentalo nuevamente.";
}

function translateTrainingWorkoutReadinessLinkError(error: unknown) {
  if (error instanceof TrainingWorkoutReadinessLinkFlowError) return error.message;
  if (error instanceof TrainingWorkoutReadinessRepositoryError) {
    if (error.code === "session_required") return "Inicia sesion para completar la vinculacion del entrenamiento.";
    return "El entrenamiento quedo guardado, pero falta completar su vinculacion. Vuelve a intentar finalizar.";
  }
  return "El entrenamiento quedo guardado, pero falta completar su vinculacion. Vuelve a intentar finalizar.";
}
function translateDailyReadinessError(error: unknown) {
  if (error instanceof TrainingDailyReadinessRepositoryError) {
    if (error.code === "session_required") return "Debes iniciar sesion para registrar tu formulario diario.";
    if (error.code === "session_expired") return "Tu sesion expiro. Inicia sesion nuevamente.";
    if (error.code === "invalid_payload") return error.message;
    if (error.code === "permission_denied") return "No tienes permisos para registrar este formulario.";
    return "No pudimos confirmar tu formulario diario. Intentalo nuevamente.";
  }

  return translatePersistenceError(error);
}

function createSetupByDayFromExercises(exercises: ExerciseTemplate[]): Record<string, SetupDayState> {
  const byDay = createSetupByDay();

  for (const exercise of dedupeExercisesByDayAndRoutine(exercises)) {
    const day = exercise.day && setupDays.includes(exercise.day) ? exercise.day : "Lunes";
    const current = byDay[day];
    const isEmpty = current.rows.every((row) => !row.name.trim());

    byDay[day] = {
      routineName: current.routineName || exercise.routine || day,
      rows: [
        ...(isEmpty ? [] : current.rows),
        {
          id: exercise.id,
          sourceExerciseId: exercise.id,
          exerciseLineageId: exercise.exerciseLineageId,
          name: exercise.name,
          sets: exercise.targetSets,
          reps: exercise.targetReps,
          weight: formatDecimalEs(exercise.baseWeight),
        },
      ],
    };
  }

  return byDay;
}

function updateSetupDay(
  current: Record<string, SetupDayState>,
  day: string,
  updater: (state: SetupDayState) => SetupDayState,
) {
  return {
    ...current,
    [day]: updater(current[day] ?? createSetupDayState()),
  };
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

function createExerciseDraft(exercise: ExerciseTemplate): ExerciseDraft {
  return {
    weight: "",
    rir: "",
    reps: Array.from({ length: exercise.targetSets }, () => ""),
    registered: false,
  };
}

function normalizeExerciseDraft(exercise: ExerciseTemplate, draft?: ExerciseDraft): ExerciseDraft {
  const fallback = createExerciseDraft(exercise);
  if (!draft) return fallback;

  return {
    ...fallback,
    ...draft,
    reps: Array.from({ length: exercise.targetSets }, (_, index) => draft.reps[index] ?? ""),
  };
}

function normalizeExerciseDrafts(value: unknown): Record<string, ExerciseDraft> {
  if (!value || typeof value !== "object") return {};

  const parsed = value as Record<string, Partial<ExerciseDraft> | undefined>;
  return Object.fromEntries(Object.entries(parsed).flatMap(([id, draft]) => {
    if (!draft || typeof id !== "string") return [];
    const reps = Array.isArray(draft.reps)
      ? draft.reps.map((item) => (item === "" ? "" : Number(item) || 0))
      : [];

    return [[id, {
      weight: typeof draft.weight === "string"
        ? readWeightInput(draft.weight, "")
        : draft.weight === undefined
          ? ""
          : formatDecimalEs(Number(draft.weight) || 0),
      rir: typeof draft.rir === "string" ? draft.rir : "",
      reps,
      registered: Boolean(draft.registered),
    } satisfies ExerciseDraft]];
  }));
}

function normalizeTrainingReadiness(value: unknown): TrainingReadiness | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<TrainingReadiness>;
  return {
    motivation: normalizeReadinessScore(parsed.motivation),
    hydration: normalizeReadinessScore(parsed.hydration),
    sleep: normalizeReadinessScore(parsed.sleep),
    energy: normalizeReadinessScore(parsed.energy),
    skipped: Boolean(parsed.skipped),
  };
}

function normalizeReadinessScore(value: unknown) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 7 ? score : undefined;
}

function calculateTargetSummary(exercises: ExerciseTemplate[]) {
  return exercises.reduce(
    (summary, exercise) => {
      const reps = exercise.targetSets * exercise.targetReps;
      return {
        totalWeight: summary.totalWeight + exercise.baseWeight,
        volume: summary.volume + reps * exercise.baseWeight,
        reps: summary.reps + reps,
        exerciseCount: summary.exerciseCount + 1,
      };
    },
    { totalWeight: 0, volume: 0, reps: 0, exerciseCount: 0 },
  );
}

function calculateRegisteredDashboardSummary(metrics: ExerciseMetrics[]) {
  return metrics.reduce(
    (summary, entry) => ({
      totalWeight: summary.totalWeight + entry.weight,
      totalReps: summary.totalReps + entry.totalReps,
      exerciseCount: summary.exerciseCount + 1,
    }),
    { totalWeight: 0, totalReps: 0, exerciseCount: 0 },
  );
}

function calculateWeeklyCompletedTrainingDays({
  plannedDays,
  exercises,
  entries,
  sessions,
  usesCycleScopedSessions,
}: {
  plannedDays: string[];
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

function normalizeCycleScopedSessionsByCalendarWeek(sessions: TrainingSession[], plannedStartDate: string) {
  return sessions.map((session) => {
    const effectiveWeekNumber = getSessionEffectiveCycleWeekNumber(plannedStartDate, session) ?? session.weekNumber;
    const effectiveCalendarWeekStart = getSessionEffectiveCalendarWeekStart(session) ?? session.calendarWeekStart;
    const normalizedEntries = session.entries.map((entry) => ({
      ...entry,
      week: getSessionEffectiveCycleWeekNumber(plannedStartDate, { trainedDate: entry.date }) ?? effectiveWeekNumber,
    }));
    return {
      ...session,
      weekNumber: effectiveWeekNumber,
      calendarWeekStart: effectiveCalendarWeekStart,
      entries: normalizedEntries,
    };
  });
}

function normalizeCycleScopedEntriesByCalendarWeek(entries: ExerciseEntry[], plannedStartDate: string) {
  return entries.map((entry) => ({
    ...entry,
    week: getSessionEffectiveCycleWeekNumber(plannedStartDate, { trainedDate: entry.date }) ?? entry.week,
  }));
}

function findDashboardSessionForDay(
  sessions: TrainingSession[],
  dayExercises: ExerciseTemplate[],
  expectedDate: string,
  plannedDay: TrainingDayCode,
  usesCycleScopedSessions: boolean,
) {
  return sessions.find((candidate) => {
    if (!usesCycleScopedSessions) {
      return candidate.plannedDate === expectedDate || candidate.plannedDay === plannedDay;
    }

    const candidateEntries = findDashboardEntries(candidate.entries, dayExercises, expectedDate, true);
    if (candidateEntries.length > 0) return true;

    const cycleDayIds = new Set(dayExercises.map((exercise) => exercise.cycleDayId).filter(Boolean));
    return Boolean(candidate.cycleDayId && cycleDayIds.has(candidate.cycleDayId)) || candidate.plannedDay === plannedDay;
  });
}

function findDashboardEntries(
  entries: ExerciseEntry[],
  dayExercises: ExerciseTemplate[],
  expectedDate: string,
  usesCycleScopedSessions: boolean,
) {
  if (!expectedDate || dayExercises.length === 0) return [];
  const dayExerciseIds = new Set(dayExercises.map((exercise) => getDashboardExerciseIdentity(exercise, usesCycleScopedSessions)));
  const shouldMatchEntryDate = !usesCycleScopedSessions;
  return entries.filter((entry) => (
    (!shouldMatchEntryDate || normalizeEntryDateKey(entry.date) === expectedDate) &&
    dayExerciseIds.has(getDashboardEntryExerciseIdentity(entry, usesCycleScopedSessions))
  ));
}

function getDashboardExerciseIdentity(exercise: ExerciseTemplate, usesCycleScopedSessions: boolean) {
  return usesCycleScopedSessions ? exercise.trainingCycleExerciseId ?? exercise.id : exercise.id;
}

function getDashboardEntryExerciseIdentity(entry: ExerciseEntry, usesCycleScopedSessions: boolean) {
  return usesCycleScopedSessions ? entry.trainingCycleExerciseId ?? entry.exerciseId : entry.exerciseId;
}

function normalizeEntryDateKey(value: string) {
  return value.slice(0, 10);
}

function getVisibleTrainingDay(exercises: ExerciseTemplate[], current: string) {
  if (exercises.some((exercise) => exercise.day === current)) return current;

  const today = new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date());
  const normalizedToday = setupDays.find((day) => removeAccents(day.toLowerCase()) === removeAccents(today.toLowerCase()));
  if (normalizedToday && exercises.some((exercise) => exercise.day === normalizedToday)) return normalizedToday;

  return exercises.find((exercise) => exercise.day)?.day ?? current;
}

function getCalendarTrainingDay() {
  const today = new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date());
  const normalizedToday = setupDays.find((day) => removeAccents(day.toLowerCase()) === removeAccents(today.toLowerCase()));
  return normalizedToday ?? "Lunes";
}

function getCurrentSantiagoWeekDates(reference = new Date()) {
  const todayKey = getSantiagoDateKey(reference);
  const todayDate = parseDateKeyAsLocalNoon(todayKey);
  const todayName = getTrainingDayFromDate(todayKey);
  const todayIndex = Math.max(0, setupDays.indexOf(todayName));
  const mondayDate = new Date(todayDate);
  mondayDate.setDate(todayDate.getDate() - todayIndex);

  return Object.fromEntries(setupDays.map((day, index) => {
    const date = new Date(mondayDate);
    date.setDate(mondayDate.getDate() + index);
    return [day, getLocalDateKey(date)];
  }));
}

function getSantiagoDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function getTrainingDayFromDate(value: string) {
  const date = parseDateKeyAsLocalNoon(value);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    timeZone: "America/Santiago",
  }).format(date);
  return setupDays.find((day) => removeAccents(day.toLowerCase()) === removeAccents(weekday.toLowerCase())) ?? "";
}

function parseDateKeyAsLocalNoon(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function getLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTrainingDayCode(day: string): TrainingDayCode {
  const mapping: Record<string, TrainingDayCode> = {
    Lunes: "monday",
    Martes: "tuesday",
    Miércoles: "wednesday",
    Jueves: "thursday",
    Viernes: "friday",
    Sábado: "saturday",
    Domingo: "sunday",
  };
  return mapping[day] ?? "monday";
}

function getSetupDayFromTrainingDayCode(dayCode: TrainingDayCode) {
  const mapping: Record<TrainingDayCode, string> = {
    monday: setupDays[0],
    tuesday: setupDays[1],
    wednesday: setupDays[2],
    thursday: setupDays[3],
    friday: setupDays[4],
    saturday: setupDays[5],
    sunday: setupDays[6],
  };
  return mapping[dayCode];
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

function getRoutineDays(exercises: ExerciseTemplate[]) {
  const days = setupDays.filter((day) => exercises.some((exercise) => (exercise.day ?? "Lunes") === day));
  return days.length > 0 ? days : ["Lunes"];
}

function getActiveRoutineDays(exercises: ExerciseTemplate[], plan: TrainingPlan) {
  const routineDays = getRoutineDays(exercises);
  const plannedDays = sortTrainingDaysByWeekOrder(
    plan.trainingDays.filter((day) => setupDays.includes(day)),
  );
  if (plannedDays.length === 0) return routineDays;

  const activeDays = plannedDays.filter((day) => exercises.some((exercise) => (exercise.day ?? "Lunes") === day));
  const persistedRoutineDays = routineDays.filter((day) => !activeDays.includes(day));
  return sortTrainingDaysByWeekOrder(
    activeDays.length > 0 ? [...activeDays, ...persistedRoutineDays] : routineDays,
  );
}

function sameDayList(left: string[], right: string[]) {
  const normalizedLeft = sortTrainingDaysByWeekOrder(left.filter((day) => setupDays.includes(day)));
  const normalizedRight = sortTrainingDaysByWeekOrder(right.filter((day) => setupDays.includes(day)));
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((day, index) => day === normalizedRight[index]);
}

function isAppScreen(value: unknown): value is Screen {
  return typeof value === "string" && (
    value === "login" ||
    value === "registro" ||
    value === "recuperar-password" ||
    value === "nueva-password" ||
    value === "recovery-expired" ||
    value === "dashboard" ||
    value === "entrenamiento" ||
    value === "training-summary" ||
    value === "registro-entrenamiento" ||
    value === "comparacion" ||
    value === "historial-ciclos" ||
    value === "perfil"
  );
}

function dedupeMetricsByWeekAndExercise(metrics: ExerciseMetrics[]) {
  const byWeekAndExercise = new Map<string, ExerciseMetrics>();
  for (const entry of metrics) {
    byWeekAndExercise.set(`${entry.week}:${entry.exerciseId}`, entry);
  }
  return Array.from(byWeekAndExercise.values());
}

function getWeekNumbers(metrics: ExerciseMetrics[]) {
  return Array.from(new Set(metrics.map((entry) => entry.week))).sort((a, b) => b - a);
}

function getSafeSelectedWeek(weekNumbers: number[], activeWeek: number, currentWeek: number) {
  if (weekNumbers.includes(activeWeek)) return activeWeek;
  return weekNumbers[0] ?? currentWeek;
}

function getWeeklyComparisonContext(metrics: ExerciseMetrics[], week: number, day: string) {
  const weeks = Array.from(new Set(metrics.map((entry) => entry.week))).sort((a, b) => a - b);
  const hasExactPreviousWeek = weeks.includes(week - 1);
  const latestPreviousWeek = [...weeks].reverse().find((candidate) => candidate < week);

  if (week <= 1 || !latestPreviousWeek) {
    return {
      title: `Rutina registrada vs Semana ${week} | ${day}`,
      detail: `Semana ${week} se compara contra la rutina registrada de ${day}.`,
      referenceWeek: null,
    };
  }

  if (hasExactPreviousWeek) {
    return {
      title: `Semana ${latestPreviousWeek} vs Semana ${week} | ${day}`,
      detail: `Semana ${week} se compara contra Semana ${latestPreviousWeek}, solo con ejercicios de ${day}.`,
      referenceWeek: latestPreviousWeek,
    };
  }

  return {
    title: `Último registro disponible vs Semana ${week} | ${day}`,
    detail: `No hay Semana ${week - 1} registrada para ${day}; se compara contra Semana ${latestPreviousWeek}.`,
    referenceWeek: latestPreviousWeek,
  };
}

function removeAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function validateSignupEmail(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  if (/\s/.test(rawEmail)) return "El correo no debe contener espacios.";
  if (!isValidSignupEmailFormat(email)) return "Ingresa un correo válido para poder confirmar tu cuenta.";

  const [localPart, domain] = email.split("@");
  if (blockedSignupDomains.has(domain) || blockedSignupLocalParts.has(localPart)) {
    return "No uses correos de prueba. Necesitamos un correo real para confirmar tu cuenta.";
  }

  return null;
}

function getPasswordRecoveryRedirectUrl() {
  if (typeof window === "undefined") return "https://organizatech.cl?flow=password-recovery";
  const url = new URL(window.location.origin);
  url.searchParams.set("flow", "password-recovery");
  return url.toString();
}

function getInitialAuthScreen(): Screen {
  const recoveryState = getPasswordRecoveryRouteState();
  if (recoveryState === "expired") return "recovery-expired";
  if (recoveryState === "active") return "nueva-password";
  return "login";
}

function getPasswordRecoveryRouteState(): "none" | "active" | "expired" {
  if (typeof window === "undefined") return "none";

  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);

  const errorCode = searchParams.get("error_code") ?? hashParams.get("error_code");
  const error = searchParams.get("error") ?? hashParams.get("error");
  if (errorCode === "otp_expired" || error === "access_denied") return "expired";

  if (searchParams.get("flow") === "password-recovery") return "active";
  if (searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery") return "active";

  if (
    window.sessionStorage.getItem(PASSWORD_RECOVERY_FLOW_KEY) === "true" ||
    window.localStorage.getItem(PASSWORD_RECOVERY_FLOW_KEY) === "true"
  ) {
    return "active";
  }

  return "none";
}

function isPasswordRecoveryFlow() {
  return getPasswordRecoveryRouteState() === "active";
}

function markPasswordRecoveryFlow() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PASSWORD_RECOVERY_FLOW_KEY, "true");
  window.localStorage.setItem(PASSWORD_RECOVERY_FLOW_KEY, "true");
}

function clearPasswordRecoveryFlow() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
  window.localStorage.removeItem(PASSWORD_RECOVERY_FLOW_KEY);
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

function isValidSignupEmailFormat(email: string) {
  if (email.length < 6 || email.length > 254) return false;
  if ((email.match(/@/g) ?? []).length !== 1) return false;

  const [localPart, domain] = email.split("@");
  if (!localPart || !domain || localPart.length > 64) return false;
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;

  const labels = domain.split(".");
  const extension = labels.at(-1) ?? "";
  if (labels.length < 2 || extension.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)) return false;

  return true;
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

function readPreviewWeight(value: string, fallback: number) {
  return parseDecimalWeightInput(value) ?? fallback;
}

function readOptionalNumber(value: string): number | "" {
  if (value.trim() === "") return "";
  return parseDecimalWeightInput(value) ?? "";
}

function screenLabel(screen: Screen) {
  const labels: Record<Screen, string> = {
    login: "Iniciar sesión",
    registro: "Registro",
    "recuperar-password": "Recuperar contraseña",
    "nueva-password": "Nueva contraseña",
    "recovery-expired": "Enlace expirado",
    dashboard: "Panel principal",
    entrenamiento: "Entrenemos",
    "training-summary": "Resumen de entrenamiento",
    "registro-entrenamiento": "Modificar ciclo de entrenamiento",
    "historial-ciclos": "Historial ciclo de entrenamiento",
    comparacion: "Comparación semanal",
    perfil: "Mi perfil",
  };
  return labels[screen];
}

function formatReadinessNote(value: TrainingReadiness | null) {
  if (!value) return "Formulario de motivación no registrado.";
  if (value.skipped) return "Formulario de motivación omitido: usuario no quiso registrar.";
  return `Formulario de motivación: motivacion ${value.motivation}/7, hidratacion ${value.hydration}/7, sueño ${value.sleep}/7, energia ${value.energy}/7.`;
}

const tooltipStyle = {
  background: "#101B27",
  border: "1px solid rgba(220,231,255,.14)",
  borderRadius: 8,
  color: "#FFFFFF",
};
