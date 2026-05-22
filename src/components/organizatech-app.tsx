"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
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
  Database,
  Dumbbell,
  HelpCircle,
  Lock,
  LogOut,
  Mail,
  Minus,
  Pencil,
  Save,
  Settings,
  Smile,
  Sparkles,
  Trash2,
  TrendingUp,
  User,
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
  loadAppData,
  replaceLocalData,
  resetLocalData,
  saveExercise,
  saveTrainingEntry,
  type DataSource,
} from "@/lib/data/repository";
import {
  calculateExerciseMetrics,
  calculateWeeklyComparison,
  calculateWeeklySummary,
  formatSigned,
  generateSmartInsights,
} from "@/lib/progress/calculations";
import { buildExerciseComparisonSummary, getExerciseHistory } from "@/lib/progress/exercise-history";
import type { ExerciseComparisonSummary, ExerciseEntry, ExerciseMetrics, ExerciseTemplate, ObjectiveStatus } from "@/lib/progress/types";
import { isSessionExpiredError, translateAuthError, translatePersistenceError } from "@/lib/supabase/auth-errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getInitialSupabaseSession,
  getMissingSupabaseMessage,
  getSessionDisplayName,
  type DataMode,
  type SupabaseSessionState,
} from "@/lib/supabase/session";

type Screen =
  | "login"
  | "registro"
  | "dashboard"
  | "entrenamiento"
  | "registro-entrenamiento"
  | "comparacion"
  | "historial-ciclos"
  | "perfil";

const primaryScreens: Screen[] = ["dashboard", "entrenamiento", "registro-entrenamiento", "historial-ciclos", "comparacion"];
const setupDays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const LOCAL_TRAINING_PLAN_KEY = "organizatech:training-plan";
const LOCAL_CYCLE_HISTORY_KEY = "organizatech:cycle-history";
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
  name: string;
  sets: number;
  reps: number;
  weight: number;
}

interface SetupDayState {
  routineName: string;
  rows: SetupExerciseRow[];
}

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
  weight: number | "";
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

interface TrainingCycleSnapshot {
  id: string;
  name: string;
  createdAt: string;
  endedAt: string;
  plan: TrainingPlan;
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
}

export function OrganizatechApp() {
  const [screen, setScreen] = useState<Screen>("login");
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
  const [sessionName, setSessionName] = useState("Fabian");
  const [statusMessage, setStatusMessage] = useState("Validando sesión...");
  const [dataSource, setDataSource] = useState<DataSource>("local");
  const [dataMode, setDataMode] = useState<DataMode>("demo");
  const [supabaseSession, setSupabaseSession] = useState<SupabaseSessionState["session"]>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseSessionState["user"]>(null);
  const [isSupabaseConfiguredState, setIsSupabaseConfiguredState] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [exercises, setExercises] = useState<ExerciseTemplate[]>([]);
  const [entries, setEntries] = useState<ExerciseEntry[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
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
  const [hasStartedTraining, setHasStartedTraining] = useState(false);
  const [routineEditorReturnScreen, setRoutineEditorReturnScreen] = useState<Screen | null>(null);
  const [cycleHistory, setCycleHistory] = useState<TrainingCycleSnapshot[]>(() => loadCycleHistory());
  const [isNewCycleConfirmOpen, setIsNewCycleConfirmOpen] = useState(false);
  const [isRoutineSuccessOpen, setIsRoutineSuccessOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = getSupabaseBrowserClient();

    async function bootstrapSession() {
      setIsAuthLoading(true);
      setStatusMessage("Validando sesión...");
      try {
        const authState = await getInitialSupabaseSession();
        if (!isMounted) return;

        applySessionState(authState);
        if (authState.session) {
          setStatusMessage("Sesión recuperada con Supabase.");
          await refreshData(authState.dataMode);
          if (isMounted) setScreen("dashboard");
        } else {
          setStatusMessage(authState.isConfigured ? "Inicia sesión para sincronizar tus datos con Supabase." : getMissingSupabaseMessage());
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
      if (event === "SIGNED_IN") {
        setStatusMessage("Sesión iniciada con Supabase.");
        void refreshData(nextState.dataMode).then(() => {
          if (isMounted) setScreen("dashboard");
        });
      }
      if (event === "TOKEN_REFRESHED") {
        setStatusMessage("Sesión Supabase actualizada.");
      }
      if (event === "SIGNED_OUT") {
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

  const metrics = useMemo(() => calculateWeeklyComparison(entries), [entries]);
  const currentWeek = Math.max(1, ...entries.map((entry) => entry.week));
  const nextWeek = entries.length > 0 ? currentWeek + 1 : 1;
  const hasTrainingEntries = entries.length > 0;
  const hasRoutinePlan = exercises.length > 0;
  const routineDays = getRoutineDays(exercises);
  const dashboardCarouselDays = hasRoutinePlan ? routineDays : setupDays;
  const visibleDay = getVisibleTrainingDay(exercises, activeRoutineDay);
  const calendarDashboardDay = getCalendarTrainingDay();
  const dashboardDay = dashboardCarouselDays.includes(dashboardDayOverride)
    ? dashboardDayOverride
    : dashboardCarouselDays.includes(calendarDashboardDay)
      ? calendarDashboardDay
      : dashboardCarouselDays[0] ?? calendarDashboardDay;
  const dayExercises = exercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay);
  const dashboardExercises = exercises.filter((exercise) => (exercise.day ?? dashboardDay) === dashboardDay);
  const visibleRoutine = dayExercises[0]?.routine ?? setupByDay[visibleDay]?.routineName ?? visibleDay;
  const dashboardRoutine = dashboardExercises[0]?.routine ?? setupByDay[dashboardDay]?.routineName ?? dashboardDay;
  const targetSummary = calculateTargetSummary(dayExercises);
  const currentMetrics = metrics.filter((entry) => entry.week === currentWeek);
  const dashboardExerciseIds = new Set(dashboardExercises.map((exercise) => exercise.id));
  const dashboardCurrentMetrics = currentMetrics.filter((entry) => dashboardExerciseIds.has(entry.exerciseId));
  const summary = calculateWeeklySummary(metrics, currentWeek);
  const insights = generateSmartInsights(summary, currentMetrics);
  const hasSupabaseSession = Boolean(supabaseSession && supabaseUser);
  const authModeLabel = dataMode === "supabase" && hasSupabaseSession ? "Supabase" : isSupabaseConfiguredState ? "Supabase listo" : "Demo local";

  function applySessionState(authState: SupabaseSessionState) {
    setIsSupabaseConfiguredState(authState.isConfigured);
    setDataMode(authState.dataMode);
    setSupabaseSession(authState.session);
    setSupabaseUser(authState.user);
    if (authState.user) setSessionName(getSessionDisplayName(authState.user));
  }

  function clearUserSessionState(message: string) {
    setSupabaseSession(null);
    setSupabaseUser(null);
    setDataMode("demo");
    setDataSource("local");
    setExercises([]);
    setEntries([]);
    setExerciseDrafts({});
    setReadiness(null);
    setHasStartedTraining(false);
    setScreenHistory([]);
    setIsMenuOpen(false);
    setStatusMessage(message);
    setScreen("login");
  }

  async function refreshData(mode = dataMode) {
    setIsBusy(true);
    try {
      const next = await loadAppData(mode);
      setExercises(next.exercises);
      setEntries(next.entries);
      setDataSource(next.source);
      setActiveRoutineDay((current) => getVisibleTrainingDay(next.exercises, current));
      setComparisonDay((current) => getVisibleTrainingDay(next.exercises, current));
      setTrainingPlan((current) => mergeTrainingPlanWithExercises(current, next.exercises));
      setStatusMessage(next.source === "supabase" ? "Datos sincronizados con Supabase." : "Datos guardados en este dispositivo.");
    } catch (error) {
      handlePersistenceError(error);
    } finally {
      setIsBusy(false);
    }
  }

  function handlePersistenceError(error: unknown) {
    const message = translatePersistenceError(error);
    setStatusMessage(message);
    if (dataMode === "supabase" && (isSessionExpiredError(error) || message.includes("iniciar sesión"))) {
      clearUserSessionState(message);
    }
  }

  async function handleAuth(mode: "login" | "registro", formData: FormData) {
    const name = String(formData.get("name") || "Fabian");
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    const confirm = String(formData.get("confirm") || "");
    const supabase = getSupabaseBrowserClient();
    setSessionName(name || email.split("@")[0] || "Fabian");

    if (mode === "registro" && password !== confirm) {
      setStatusMessage("Las contraseñas no coinciden.");
      return;
    }

    if (!supabase) {
      setDataMode("demo");
      setStatusMessage(getMissingSupabaseMessage());
      await refreshData("demo");
      setStatusMessage(getMissingSupabaseMessage());
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

      const session = result.data.session;
      applySessionState({
        isConfigured: true,
        dataMode: session ? "supabase" : "demo",
        session,
        user: session?.user ?? result.data.user ?? null,
      });

      if (!session && mode === "registro") {
        setStatusMessage("Cuenta creada. Revisa tu correo para confirmar el acceso antes de iniciar sesión.");
        setScreen("login");
        return;
      }

      setStatusMessage("Sesión iniciada con Supabase.");
      await refreshData("supabase");
      setScreen("dashboard");
    } catch (error) {
      setStatusMessage(translateAuthError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleResetLocal() {
    if (dataMode === "supabase") {
      setStatusMessage("No se puede restaurar demo mientras usas una sesión Supabase.");
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

    if (nextScreen === "registro-entrenamiento") {
      setSetupByDay(createSetupByDayFromExercises(exercises));
      setSetupDay(getVisibleTrainingDay(exercises, activeRoutineDay));
      setIsEditingRoutinePlan(!hasRoutinePlan);
    } else if (nextScreen === "entrenamiento") {
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
        setReadiness(null);
        setHasStartedTraining(false);
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

  function updateSetupRow(id: string, field: keyof Omit<SetupExerciseRow, "id" | "sourceExerciseId">, value: string) {
    setSetupByDay((current) =>
      updateSetupDay(current, setupDay, (state) => ({
        ...state,
        rows: state.rows.map((row) => (
          row.id === id
            ? { ...row, [field]: field === "name" ? value : readSetupNumber(value) }
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
        const days = patch.trainingDays.length > 0 ? patch.trainingDays : [setupDay];
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
    setSetupByDay((current) =>
      updateSetupDay(current, setupDay, (state) => ({
        ...state,
        rows: state.rows.length > 1 ? state.rows.filter((row) => row.id !== id) : state.rows,
      })),
    );
  }

  function openRoutineEditor(day = visibleDay) {
    setSetupByDay(createSetupByDayFromExercises(exercises));
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

  async function saveInitialRoutine() {
    const dayState = setupByDay[setupDay] ?? createSetupDayState();
    const routineName = dayState.routineName.trim() || setupDay;
    const validRows = dayState.rows.filter((row) => row.name.trim());
    const plannedDays = trainingPlan.trainingDays.length > 0 ? trainingPlan.trainingDays : [setupDay];
    const savedDayState = {
      routineName,
      rows: validRows.map((row) => ({
        ...row,
        sourceExerciseId: row.sourceExerciseId ?? row.id,
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

    if (validRows.length === 0) {
      setStatusMessage("Agrega al menos un ejercicio para crear la rutina.");
      return;
    }

    setSetupByDay(nextSetupByDay);
    setIsBusy(true);
    try {
      for (const dayToPersist of daysToPersist) {
        const state = nextSetupByDay[dayToPersist] ?? createSetupDayState();
        const currentRoutineName = state.routineName.trim() || dayToPersist;
        const rowsToPersist = state.rows.filter((row) => row.name.trim());

        for (const row of rowsToPersist) {
          await saveExercise({
            id: row.sourceExerciseId ?? row.id,
            routine: currentRoutineName,
            day: dayToPersist,
            name: row.name.trim(),
            targetSets: Math.max(1, row.sets || 1),
            targetReps: Math.max(1, row.reps || 1),
            baseWeight: Math.max(0, row.weight || 0),
            notes: `Rutina creada para ${dayToPersist}.`,
          }, dataMode);
        }
      }

      await refreshData(dataMode);
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
    if (dataMode === "supabase") {
      setStatusMessage("El cierre de ciclos con persistencia Supabase se habilitará en el siguiente paso.");
      setIsNewCycleConfirmOpen(false);
      return;
    }

    const snapshot = createTrainingCycleSnapshot(cycleHistory.length + 1, trainingPlan, exercises, entries);
    const nextHistory = [...cycleHistory, snapshot];
    setCycleHistory(nextHistory);
    saveCycleHistory(nextHistory);

    const nextPlan = createDefaultTrainingPlan();
    replaceLocalData([], []);
    setExercises([]);
    setEntries([]);
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

  function registerCurrentExercise() {
    const exercise = dayExercises[activeExerciseIndex];
    if (!exercise) return;
    const draft = normalizeExerciseDraft(exercise, exerciseDrafts[exercise.id]);
    const requiredReps = draft.reps.slice(0, exercise.targetSets);
    if (draft.weight === "" || requiredReps.some((value) => value === "")) {
      setStatusMessage("Completa peso y series antes de registrar el ejercicio.");
      return;
    }
    updateExerciseDraft(exercise, { ...draft, registered: true });
    setActiveExerciseIndex((index) => Math.min(index + 1, Math.max(0, dayExercises.length - 1)));
  }

  async function saveCompletedTraining() {
    const validExercises = dayExercises.filter((exercise) => exerciseDrafts[exercise.id]?.registered);
    if (validExercises.length !== dayExercises.length) {
      setStatusMessage("Registra todos los ejercicios antes de guardar el entrenamiento.");
      return;
    }

    setIsBusy(true);
    try {
      const savedEntries: ExerciseEntry[] = [];
      for (const exercise of validExercises) {
        const draft = normalizeExerciseDraft(exercise, exerciseDrafts[exercise.id]);
        const previous = metrics.filter((entry) => entry.exerciseId === exercise.id).at(-1);
        const saved = await saveTrainingEntry({
          id: createId(),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          routine: exercise.routine,
          week: nextWeek,
          date: new Date().toISOString().slice(0, 10),
          targetSets: exercise.targetSets,
          targetReps: exercise.targetReps,
          weight: Number(draft.weight) || 0,
          previousWeight: previous?.weight ?? exercise.baseWeight,
          reps: draft.reps.slice(0, exercise.targetSets).map((value) => Number(value) || 0),
          rir: draft.rir,
          notes: `Entrenamiento ${visibleDay}: ${exercise.routine}. ${formatReadinessNote(readiness)}`,
        }, dataMode);
        savedEntries.push(saved);
      }

      setEntries((current) => [...current, ...savedEntries]);
      setExerciseDrafts((current) => {
        const next = { ...current };
        for (const exercise of validExercises) delete next[exercise.id];
        return next;
      });
      setStatusMessage("Entrenamiento guardado.");
      setReadiness(null);
      setHasStartedTraining(false);
      setScreen("dashboard");
    } catch (error) {
      handlePersistenceError(error);
    } finally {
      setIsBusy(false);
    }
  }

  async function loadComparisonDemoData() {
    if (dataMode === "supabase") {
      setStatusMessage("Los datos de prueba solo están disponibles en modo demo/local.");
      return;
    }

    if (exercises.length === 0) {
      setStatusMessage("Crea una rutina antes de cargar datos de prueba.");
      return;
    }

    setIsBusy(true);
    try {
      const savedEntries: ExerciseEntry[] = [];
      const baseDate = new Date().toISOString().slice(0, 10);

      for (const exercise of exercises) {
        const weekOneReps = Array.from({ length: exercise.targetSets }, () => exercise.targetReps);
        const weekTwoReps = createDemoWeekTwoReps(exercise);
        const weekTwoWeight = createDemoWeekTwoWeight(exercise);

        const weekOne = await saveTrainingEntry({
          id: createId(),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          routine: exercise.routine,
          week: 1,
          date: baseDate,
          targetSets: exercise.targetSets,
          targetReps: exercise.targetReps,
          weight: exercise.baseWeight,
          previousWeight: exercise.baseWeight,
          reps: weekOneReps,
          rir: "RIR 1-2",
          notes: `Datos demo semana 1: ${exercise.day ?? "Lunes"}.`,
        }, dataMode);

        const weekTwo = await saveTrainingEntry({
          id: createId(),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          routine: exercise.routine,
          week: 2,
          date: baseDate,
          targetSets: exercise.targetSets,
          targetReps: exercise.targetReps,
          weight: weekTwoWeight,
          previousWeight: exercise.baseWeight,
          reps: weekTwoReps,
          rir: "RIR 1-2",
          notes: `Datos demo semana 2: ${exercise.day ?? "Lunes"}.`,
        }, dataMode);

        savedEntries.push(weekOne, weekTwo);
      }

      setEntries((current) => [...current, ...savedEntries]);
      setStatusMessage("Datos de prueba cargados para comparar semana 2 vs semana 1.");
    } catch (error) {
      handlePersistenceError(error);
    } finally {
      setIsBusy(false);
    }
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
        <AuthScreen mode="login" message={statusMessage} isBusy={isBusy} onSubmit={(data) => handleAuth("login", data)} onSwitch={() => setScreen("registro")} />
      </main>
    );
  }

  if (screen === "registro") {
    return (
      <main className="app-shell">
        <AuthScreen mode="registro" message={statusMessage} isBusy={isBusy} onSubmit={(data) => handleAuth("registro", data)} onSwitch={() => setScreen("login")} />
      </main>
    );
  }

  const menuScreens = hasTrainingEntries
    ? primaryScreens
    : primaryScreens.filter((item) =>
      item === "dashboard" ||
      item === "entrenamiento" ||
      item === "registro-entrenamiento" ||
      (item === "historial-ciclos" && cycleHistory.length > 0)
    );

  return (
    <main className="app-shell">
      <header className={`topbar ${isTopbarHidden ? "hidden" : ""}`}>
        <button
          className={`icon-button menu-trigger ${isMenuOpen ? "active" : ""}`}
          aria-label="Abrir menú"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((value) => !value)}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
        <div>
          <h1>Organizatech</h1>
          <p className="eyebrow">{hasTrainingEntries ? `Semana ${currentWeek} · ${authModeLabel}` : "Sin registro de entrenamiento"}</p>
        </div>
        <button className="icon-button" aria-label="Ver alertas del panel principal" onClick={() => setScreen("dashboard")}>
          <Bell size={18} />
        </button>
      </header>

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
                <div className="menu-panel-header">
                  <div>
                    <p className="eyebrow">Bienvenido</p>
                    <h3>{sessionName}</h3>
                  </div>
                  <button className="profile-shortcut" type="button" role="menuitem" onClick={() => navigateTo("perfil")}>
                    Mi perfil
                  </button>
                </div>
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
                  <p className="eyebrow">Cuenta</p>
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

      {screen !== "dashboard" && (
        <div className="section-back-row">
          <button className="button secondary section-back-button" type="button" onClick={goBack}>
            <ChevronLeft size={17} />
            Volver
          </button>
        </div>
      )}

      {screen === "dashboard" && (
        <DashboardScreen
          exercises={exercises}
          hasTrainingEntries={hasTrainingEntries}
          hasRoutinePlan={hasRoutinePlan}
          day={dashboardDay}
          weekDays={dashboardCarouselDays}
          routineDays={routineDays}
          calendarDay={calendarDashboardDay}
          routine={dashboardRoutine}
          dayExercises={dashboardExercises}
          summary={summary}
          currentMetrics={dashboardCurrentMetrics}
          insights={insights}
          currentWeek={currentWeek}
          entries={entries}
          startRegistration={() => navigateTo("registro-entrenamiento")}
          goToRoutine={() => openRoutineDay(dashboardDay)}
          switchDay={setDashboardDayOverride}
        />
      )}
      {screen === "registro-entrenamiento" && (!hasRoutinePlan || isEditingRoutinePlan) && (
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
      {screen === "registro-entrenamiento" && hasRoutinePlan && !isEditingRoutinePlan && (
        <CycleManagementScreen
          trainingPlan={trainingPlan}
          exercises={exercises}
          entries={entries}
          cycleNumber={cycleHistory.length + 1}
          editCurrentCycle={() => openRoutineEditor(visibleDay)}
          requestNewCycle={() => setIsNewCycleConfirmOpen(true)}
        />
      )}
      {screen === "entrenamiento" && !hasRoutinePlan && (
        <EmptyDashboard startRegistration={() => navigateTo("registro-entrenamiento")} />
      )}
      {screen === "entrenamiento" && hasRoutinePlan && !isEditingRoutinePlan && !hasStartedTraining && (
        <TrainingStartScreen
          day={visibleDay}
          routine={visibleRoutine}
          exercises={dayExercises}
          targetSummary={targetSummary}
          routineDays={routineDays}
          switchDay={(day) => openRoutineDay(day)}
          editRoutine={() => openRoutineEditor(visibleDay)}
          startTraining={() => setHasStartedTraining(true)}
        />
      )}
      {screen === "entrenamiento" && hasRoutinePlan && !isEditingRoutinePlan && hasStartedTraining && !readiness && (
        <TrainingReadinessScreen
          onSubmit={(value) => setReadiness({ ...value, skipped: false })}
          onSkip={() => setReadiness({ skipped: true })}
        />
      )}
      {screen === "entrenamiento" && hasRoutinePlan && !isEditingRoutinePlan && hasStartedTraining && readiness && (
        <GuidedTrainingScreen
          day={visibleDay}
          routine={visibleRoutine}
          exercises={dayExercises}
          targetSummary={targetSummary}
          activeIndex={activeExerciseIndex}
          setActiveIndex={setActiveExerciseIndex}
          drafts={exerciseDrafts}
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
        <ComparisonScreenV2
          exercises={exercises}
          metrics={metrics}
          currentWeek={currentWeek}
          selectedDay={comparisonDay}
          setSelectedDay={setComparisonDay}
          loadDemoData={loadComparisonDemoData}
          isBusy={isBusy}
        />
      )}
      {screen === "historial-ciclos" && <CycleHistoryScreen history={cycleHistory} />}
      {screen === "perfil" && <ProfileScreen name={sessionName} summary={summary} dataSource={dataSource} refreshData={refreshData} resetLocal={handleResetLocal} />}
      {isNewCycleConfirmOpen && (
        <ConfirmNewCycleModal
          onCancel={() => setIsNewCycleConfirmOpen(false)}
          onConfirm={() => void startNewTrainingCycle()}
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

    </main>
  );
}

function AuthScreen({
  mode,
  message,
  isBusy,
  onSubmit,
  onSwitch,
}: {
  mode: "login" | "registro";
  message: string;
  isBusy: boolean;
  onSubmit: (data: FormData) => void;
  onSwitch: () => void;
}) {
  const isRegister = mode === "registro";
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
      <form className="card form-grid" action={onSubmit}>
        <h2>{isRegister ? "Crea tu cuenta" : "Iniciar sesión"}</h2>
        {isRegister && <TextField name="name" label="Nombre" defaultValue="Fabian" />}
        <TextField name="email" label="Correo electrónico" defaultValue="tu@email.com" type="email" />
        <TextField name="password" label="Contraseña" defaultValue="organizatech" type="password" />
        {isRegister && <TextField name="confirm" label="Confirmar contraseña" defaultValue="organizatech" type="password" />}
        <p className="eyebrow">{message}</p>
        <button className="button" type="submit" disabled={isBusy}>
          {isRegister ? <UserPlus size={17} /> : <Lock size={17} />}
          {isBusy ? "Procesando..." : isRegister ? "Crear cuenta" : "Iniciar sesión"}
        </button>
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

function DashboardScreen({
  exercises,
  hasTrainingEntries,
  hasRoutinePlan,
  day,
  weekDays,
  routineDays,
  calendarDay,
  routine,
  dayExercises,
  summary,
  currentMetrics,
  insights,
  currentWeek,
  entries,
  startRegistration,
  goToRoutine,
  switchDay,
}: {
  exercises: ExerciseTemplate[];
  hasTrainingEntries: boolean;
  hasRoutinePlan: boolean;
  day: string;
  weekDays: string[];
  routineDays: string[];
  calendarDay: string;
  routine: string;
  dayExercises: ExerciseTemplate[];
  summary: ReturnType<typeof calculateWeeklySummary>;
  currentMetrics: ExerciseMetrics[];
  insights: ReturnType<typeof generateSmartInsights>;
  currentWeek: number;
  entries: ExerciseEntry[];
  startRegistration: () => void;
  goToRoutine: () => void;
  switchDay: (day: string) => void;
}) {
  const hasTodayRoutine = dayExercises.length > 0;
  const analytics = buildAnalytics(summary, currentMetrics);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const lastCarouselDay = useRef(day);
  const [activeCarouselDay, setActiveCarouselDay] = useState(day);
  const carouselDays = useMemo(() => hasRoutinePlan ? weekDays : [day], [hasRoutinePlan, weekDays, day]);
  const allWeekMetrics = useMemo(
    () => calculateWeeklyComparison(entries).filter((entry) => entry.week === currentWeek),
    [entries, currentWeek],
  );

  useEffect(() => {
    setActiveCarouselDay(day);
    lastCarouselDay.current = day;
    const index = carouselDays.indexOf(day);
    const container = carouselRef.current;
    const slide = index >= 0 ? container?.children.item(index) as HTMLElement | null : null;
    if (container && slide) {
      container.scrollTo({ left: slide.offsetLeft - container.offsetLeft, behavior: "smooth" });
    }
  }, [day, carouselDays]);

  function getDashboardDayData(item: string) {
    const date = getDateForWeekday(item, calendarDay);
    const dateLabel = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
    const prefix = item === calendarDay ? "Entrenamiento de hoy" : "Entrenamiento";
    const itemExercises = exercises.filter((exercise) => (exercise.day ?? item) === item);
    const exerciseIds = new Set(itemExercises.map((exercise) => exercise.id));
    const itemMetrics = allWeekMetrics.filter((entry) => exerciseIds.has(entry.exerciseId));
    const itemRoutine = itemMetrics[0]?.routine ?? itemExercises[0]?.routine ?? (item === day ? routine : item);
    const preview = itemMetrics.filter((entry) => entry.routine === itemRoutine);

    return {
      day: item,
      title: itemExercises.length > 0 ? `${prefix} ${dateLabel} | ${item}` : `Entrenamiento ${dateLabel} | ${item}: no registra entrenamientos`,
      exercises: itemExercises,
      metrics: preview,
      hasRoutine: itemExercises.length > 0,
    };
  }

  const activeDayData = getDashboardDayData(activeCarouselDay);

  function handleTrainingCarouselScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const children = Array.from(container.children) as HTMLElement[];
    const center = container.scrollLeft + container.clientWidth / 2;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    children.forEach((child, index) => {
      const childCenter = child.offsetLeft + child.offsetWidth / 2;
      const distance = Math.abs(childCenter - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
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
        <div className="card wide dashboard-training-card">
          <div className="dashboard-training-carousel" ref={carouselRef} onScroll={handleTrainingCarouselScroll}>
            {carouselDays.map((item) => {
              const itemData = getDashboardDayData(item);
              const itemSummary = calculateTargetSummary(itemData.exercises);

              return (
                <article className="dashboard-training-slide" key={item}>
                  <p className="eyebrow">{itemData.exercises[0]?.routine ?? item}</p>
                  <h3>{itemData.title}</h3>
                  {itemData.hasRoutine ? (
                    <>
                      <RoutineMetricGrid targetSummary={itemSummary} exerciseLabel="Ejercicios total" />
                      <div className="exercise-preview-section">
                        <h3>Ejercicios a realizar · {item}</h3>
                        <div className="exercise-preview-carousel">
                          {itemData.exercises.map((exercise) => (
                            <article className="exercise-preview-slide" key={exercise.id}>
                              <ProgrammedExerciseCard exercise={exercise} />
                            </article>
                          ))}
                        </div>
                      </div>
                    </>
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
      <div className="card wide dashboard-progress-card">
        <div className="weekly-progress-summary">
          <p className="small-label">Vista progreso semanal</p>
          <strong className={summary.volumePercentage >= 0 ? "positive" : "danger"}>
            {formatSigned(summary.volumePercentage)}%
          </strong>
          <span>vs semana anterior</span>
        </div>
        <WeeklyProgressSvg value={summary.volumePercentage} />
      </div>
      <div className={`card wide dashboard-training-card ${activeDayData.metrics[0] ? getObjectiveTone(activeDayData.metrics[0].objectiveStatus) : ""}`}>
        <div className="dashboard-training-carousel" ref={carouselRef} onScroll={handleTrainingCarouselScroll}>
          {carouselDays.map((item) => {
            const itemData = getDashboardDayData(item);

            return (
              <article className="dashboard-training-slide" key={item}>
                <h3>{itemData.title}</h3>
                {itemData.hasRoutine ? (
                  <div className="exercise-list">
                    {itemData.metrics.length > 0
                      ? itemData.metrics.slice(0, 4).map((entry) => <ExerciseRow key={entry.id} entry={entry} />)
                      : itemData.exercises.slice(0, 4).map((exercise) => (
                        <ProgrammedExerciseCard exercise={exercise} key={exercise.id} />
                      ))}
                  </div>
                ) : (
                  <p className="eyebrow">No hay rutina registrada para {item}. Puedes agregarla desde Registro de entrenamiento.</p>
                )}
              </article>
            );
          })}
        </div>
        {activeDayData.hasRoutine ? (
          <button className="button secondary dashboard-routine-button" onClick={goToRoutine}>
            Ir a rutina
          </button>
        ) : null}
        <DashboardDayDots day={activeCarouselDay} weekDays={carouselDays} />
      </div>
      <DashboardSmartInsights insights={insights} />
      <DashboardMotivationSummary entries={entries} currentWeek={currentWeek} routineDays={routineDays} />
      <DashboardAnalytics summary={summary} analytics={analytics} />
    </section>
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
function WeeklyProgressSvg({ value }: { value: number }) {
  const [activeIndex, setActiveIndex] = useState(6);
  const clampedValue = Math.max(-4, Math.min(4, value));
  const values = [-0.8, -0.5, 0.2, 1.2, 0.5, 0.8, clampedValue];
  const labels = ["L", "M", "X", "J", "V", "S", "D"];
  const points = values.map((item, index) => {
    const x = 18 + index * 69;
    const y = 84 - ((item + 4) / 8) * 66;
    return { x, y, value: item, label: labels[index] };
  });
  const activePoint = points[activeIndex] ?? points.at(-1)!;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const areaPath = `${path} L ${points.at(-1)!.x} 112 L ${points[0].x} 112 Z`;

  return (
    <div className="weekly-progress-visual" aria-label={`Progreso semanal ${formatSigned(value)}%`}>
      <div className="weekly-tooltip" style={{ left: `${(activePoint.x / 480) * 100}%`, top: activePoint.y }}>
        <strong>{activePoint.label}</strong>
        <span>{formatSigned(activePoint.value)}%</span>
      </div>
      <div className="weekly-axis-values" aria-hidden="true">
        <span>+4%</span>
        <span>+2%</span>
        <span>0%</span>
        <span>-2%</span>
        <span>-4%</span>
      </div>
      <svg viewBox="0 0 480 128" role="img">
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
        {[16, 32, 48, 64, 80].map((y) => <line className="weekly-grid-line" key={y} x1="8" x2="456" y1={y} y2={y} />)}
        <line className="weekly-zero-line" x1="8" x2="456" y1="64" y2="64" />
        <path className="weekly-area" d={areaPath} />
        <path className="weekly-line" d={path} stroke="url(#weeklyLine)" filter="url(#weeklyGlow)" />
        {points.map((point, index) => (
          <g
            key={point.label}
            className="weekly-point-hit"
            role="button"
            tabIndex={0}
            aria-label={`${point.label}: ${formatSigned(point.value)}%`}
            onClick={() => setActiveIndex(index)}
            onMouseEnter={() => setActiveIndex(index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") setActiveIndex(index);
            }}
          >
            <circle className={index === activeIndex ? "weekly-point-glow active" : "weekly-point-glow"} cx={point.x} cy={point.y} r={index === activeIndex ? 14 : 8} />
            <circle className={index === activeIndex ? "weekly-point active" : "weekly-point"} cx={point.x} cy={point.y} r={index === activeIndex ? 5 : 3} />
          </g>
        ))}
      </svg>
      <div className="weekly-day-labels" aria-hidden="true">
        {labels.map((item) => <span key={item}>{item}</span>)}
      </div>
    </div>
  );
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
          <div className="insight-row smart-insight-row" key={insight.id}>
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
            <div className="insight-row smart-insight-row compact-insight-row" key={signal.label}>
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

function CycleManagementScreen({
  trainingPlan,
  exercises,
  entries,
  cycleNumber,
  editCurrentCycle,
  requestNewCycle,
}: {
  trainingPlan: TrainingPlan;
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  cycleNumber: number;
  editCurrentCycle: () => void;
  requestNewCycle: () => void;
}) {
  const targetSummary = calculateTargetSummary(exercises);
  const metrics = calculateWeeklyComparison(entries);
  const summary = calculateWeeklySummary(metrics, Math.max(1, ...entries.map((entry) => entry.week)));
  const cycleTitle = getCycleTitle(trainingPlan);
  const weeksRegistered = Math.max(1, ...entries.map((entry) => entry.week));

  return (
    <section className="screen">
      <div className="card wide cycle-management-card">
        <p className="eyebrow">Ciclo activo</p>
        <h2>Ciclo {cycleNumber} - {cycleTitle}</h2>
        <p className="eyebrow">{getCycleDurationLabel(trainingPlan)} - {getRoutineDays(exercises).length} dias - {targetSummary.exerciseCount} ejercicios</p>
        <div className="cycle-summary-line">
          <div><span>Volumen registrado</span><strong>{formatKg(summary.volumeTotal)}</strong></div>
          <div><span>Reps registradas</span><strong>{summary.totalReps}</strong></div>
          <div><span>Semanas</span><strong>{weeksRegistered}</strong></div>
        </div>
        <button className="button secondary" type="button" onClick={editCurrentCycle}>
          <Pencil size={16} />
          Modificar ciclo actual
        </button>
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

function ConfirmNewCycleModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar nuevo ciclo">
      <div className="card confirm-modal">
        <h2>¿Estas seguro?</h2>
        <p>Si decides crear un nuevo ciclo de entrenamiento, finalizaremos el ciclo actual que tienes registrado.</p>
        <div className="modal-actions">
          <button className="button danger-solid" type="button" onClick={onCancel}>No</button>
          <button className="button success-solid" type="button" onClick={onConfirm}>Si</button>
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
  updateRow: (id: string, field: keyof Omit<SetupExerciseRow, "id" | "sourceExerciseId">, value: string) => void;
  addRow: () => void;
  removeRow: (id: string) => void;
  saveRoutine: () => void;
  trainingPlan: TrainingPlan;
  updateTrainingPlan: (patch: Partial<TrainingPlan>) => void;
  message: string;
  isBusy: boolean;
  configuredDays: string[];
}) {
  const plannedDays = trainingPlan.trainingDays.length > 0 ? trainingPlan.trainingDays : [day];
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
  const visibleMessage = message === "Datos guardados en este dispositivo." ? "" : message;

  function toggleTrainingDay(item: string) {
    const isSelected = plannedDays.includes(item);
    const nextDays = isSelected && plannedDays.length > 1
      ? plannedDays.filter((current) => current !== item)
      : isSelected
        ? plannedDays
        : [...plannedDays, item];

    updateTrainingPlan({ trainingDays: nextDays });
    setDay(nextDays.includes(item) ? item : nextDays[0]);
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
              <input type="number" min={0} placeholder="Kg" value={row.weight || ""} onChange={(event) => updateRow(row.id, "weight", event.target.value)} />
              <button className="row-delete" aria-label="Eliminar ejercicio" onClick={() => removeRow(row.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="setup-actions">
          <button className="small-yellow-button" type="button" onClick={addRow}>Agregar más</button>
          <button className="start-button compact" onClick={saveRoutine} disabled={isBusy}>
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
}: {
  onSubmit: (value: Omit<TrainingReadiness, "skipped">) => void;
  onSkip: () => void;
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
          <button className="button secondary" type="button" onClick={onSkip}>
            Omitir por hoy
          </button>
          <button className="button" type="button" onClick={() => onSubmit(values)}>
            Empezar entrenamiento
          </button>
        </div>
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
}: {
  day: string;
  routine: string;
  exercises: ExerciseTemplate[];
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  routineDays: string[];
  switchDay: (day: string) => void;
  editRoutine: () => void;
  startTraining: () => void;
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
              <span>{exercise.targetSets} series · {exercise.targetReps} reps · {exercise.baseWeight} kg</span>
            </div>
          ))}
        </div>
        <div className="training-start-actions">
          <button className="start-button" type="button" onClick={startTraining}>
            Iniciar entrenamiento
          </button>
        </div>
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
  const completedCount = exercises.filter((exercise) => drafts[exercise.id]?.registered).length;
  const allRegistered = exercises.length > 0 && completedCount === exercises.length;
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
        weight: Number(draft.weight) || 0,
        previousWeight: activeExercise.baseWeight,
        reps: draft.reps.map((value) => Number(value) || 0),
        rir: draft.rir,
      })
    : null;

  if (!activeExercise || !draft || !preview) {
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
        {notice ? <div className="notice-banner">{notice}</div> : null}
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
            const isDone = Boolean(drafts[exercise.id]?.registered);

            return (
              <button
                key={exercise.id}
                className={`routine-item ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
                onClick={() => setActiveIndex(index)}
              >
                <span className="routine-item-index">{index + 1}</span>
                <span className="routine-item-main">
                  <strong>{exercise.name}</strong>
                  <small>{exercise.targetSets} series · {exercise.targetReps} reps · {exercise.baseWeight} kg</small>
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
          <div className="series-exercise-top">
            <div>
              <span>Objetivo de tu rutina</span>
              <strong>{activeExercise.baseWeight} kg · {activeExercise.targetReps} reps</strong>
            </div>
            <span>{activeExercise.targetSets} series</span>
          </div>
          <label className="series-weight-field">
            <span>Peso usado</span>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              placeholder={`${activeExercise.baseWeight} kg`}
              value={draft.weight}
              onChange={(event) => updateDraft(activeExercise, { weight: readOptionalNumber(event.target.value) })}
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
        {!allRegistered ? (
          <button className="button" onClick={registerExercise}>
            <Save size={17} />
            Registrar serie
          </button>
        ) : (
          <button className="start-button compact" onClick={saveCompletedTraining} disabled={isBusy}>
            {isBusy ? "Guardando..." : "Guardar entrenamiento"}
          </button>
        )}
      </div>
    </section>
  );
}

function SeriesResult({ entry }: { entry: ExerciseMetrics }) {
  const tone = getObjectiveTone(entry.objectiveStatus);

  return (
    <div className={`series-result ${tone}`}>
      <p className="series-result-label">Nuevo registro</p>
      <div className="series-result-header">
        <span>kg actual</span>
        <strong>{entry.weight} kg</strong>
      </div>
      <div className="series-result-deltas">
        <DeltaValue value={entry.repsDifference} suffix="reps" />
        <DeltaValue value={entry.kgDifference} suffix="kg" />
      </div>
      <div className="series-result-badges">
        <StatusBadge status={entry.objectiveStatus} />
        <ChangeBadge value={entry.kgDifference} positive="Subimos kg" negative="Bajamos kg" neutral="Mismo kg" />
        <ChangeBadge value={entry.repsDifference} positive="Subimos reps" negative="Bajamos reps" neutral="Mismas reps" />
      </div>
    </div>
  );
}
function ComparisonScreenV2({
  exercises,
  metrics,
  currentWeek,
  selectedDay,
  setSelectedDay,
  loadDemoData,
  isBusy,
}: {
  exercises: ExerciseTemplate[];
  metrics: ExerciseMetrics[];
  currentWeek: number;
  selectedDay: string;
  setSelectedDay: (day: string) => void;
  loadDemoData: () => void;
  isBusy: boolean;
}) {
  const [activeView, setActiveView] = useState<"plan" | "week">("plan");
  const [activeWeek, setActiveWeek] = useState(currentWeek);
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [isExercisePickerOpen, setIsExercisePickerOpen] = useState(false);
  const routineDays = getRoutineDays(exercises);
  const activeDay = routineDays.includes(selectedDay) ? selectedDay : routineDays[0];
  const dayExercises = exercises.filter((exercise) => (exercise.day ?? "Lunes") === activeDay);
  const dayExerciseIds = new Set(dayExercises.map((exercise) => exercise.id));
  const dayMetrics = dedupeMetricsByWeekAndExercise(metrics.filter((entry) => dayExerciseIds.has(entry.exerciseId)));
  const weekNumbers = getWeekNumbers(dayMetrics);
  const selectedWeek = activeView === "week" ? getSafeSelectedWeek(weekNumbers, activeWeek, currentWeek) : 0;
  const currentMetrics = dayMetrics.filter((entry) => entry.week === selectedWeek);
  const targetSummary = calculateTargetSummary(dayExercises);
  const routineName = dayExercises[0]?.routine ?? activeDay;
  const comparisonContext = getWeeklyComparisonContext(dayMetrics, selectedWeek, activeDay);
  const title = activeView === "plan"
    ? `Rutina registrada ${activeDay}`
    : comparisonContext.title;
  const visibleMetrics = activeView === "plan" ? [] : currentMetrics;
  const listTitle = activeView === "plan"
    ? `Listado de rutina registrada día ${activeDay} | ${routineName}`
    : `Ejercicios comparados | Semana ${selectedWeek}`;
  const allComparableExercises = exercises.filter((exercise) => exercise.name.trim().length > 0);
  const selectedExercise = allComparableExercises.find((exercise) => exercise.id === selectedExerciseId) ?? allComparableExercises[0];
  const selectedHistory = selectedExercise
    ? getExerciseHistory(dedupeMetricsByWeekAndExercise(metrics), selectedExercise.id)
    : [];
  const historySummary = buildExerciseComparisonSummary(selectedHistory, selectedExercise?.name);
  const chartData = historySummary?.history.map((entry) => ({
    label: entry.weekLabel?.replace("Semana ", "S") ?? formatDate(entry.date),
    peso: entry.weight,
  })) ?? [];

  useEffect(() => {
    if (!selectedExerciseId || !allComparableExercises.some((exercise) => exercise.id === selectedExerciseId)) {
      setSelectedExerciseId(allComparableExercises[0]?.id ?? "");
      setIsExercisePickerOpen(false);
    }
  }, [allComparableExercises, selectedExerciseId]);

  useEffect(() => {
    if (activeView === "week" && weekNumbers.length > 0 && !weekNumbers.includes(activeWeek)) {
      setActiveWeek(weekNumbers[0]);
    }
  }, [activeView, activeWeek, weekNumbers]);

  return (
    <section className="screen">
      <div className="card wide">
        <div className="section-heading">
          <div>
            <h3>Selecciona rutina o dia</h3>
            <p className="eyebrow">Cambia entre tus dias registrados para revisar el progreso.</p>
          </div>
        </div>
        <div className="routine-day-pills">
          {routineDays.map((day) => (
            <button
              key={day}
              className={`routine-day-pill configured ${day === activeDay ? "active" : ""}`}
              type="button"
              onClick={() => {
                setSelectedDay(day);
                setActiveView("plan");
                setIsExercisePickerOpen(false);
              }}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      <div className="card wide comparison-hero">
        <p className="eyebrow">Comparacion semanal</p>
        <h3>{title}</h3>
        <p className="eyebrow">{activeDay} | {routineName}</p>
        <div className="comparison-chip-row">
          <button className={`compare-chip ${activeView === "plan" ? "active" : ""}`} type="button" onClick={() => setActiveView("plan")}>Rutina registrada</button>
          <span className="compare-chip">vs</span>
          {weekNumbers.map((week) => (
            <button
              key={week}
              className={`compare-chip ${activeView === "week" && activeWeek === week ? "active" : ""}`}
              type="button"
              onClick={() => {
                setActiveWeek(week);
                setActiveView("week");
              }}
            >
              Semana {week}
            </button>
          ))}
        </div>
        {activeView === "week" ? <p className="eyebrow comparison-reference-note">{comparisonContext.detail}</p> : null}
        {activeView === "plan" ? (
          <RoutineMetricGrid targetSummary={targetSummary} exerciseLabel="Ejercicios" />
        ) : (
          <MetricGrid summary={calculateWeeklySummary(dayMetrics, selectedWeek)} />
        )}
        <button className="button secondary" type="button" onClick={loadDemoData} disabled={isBusy}>
          {isBusy ? "Cargando..." : "Cargar datos de prueba"}
        </button>
      </div>

      <div className="card wide">
        <h3>{listTitle}</h3>
        <div className="exercise-list">
          {activeView !== "plan" && visibleMetrics.length > 0
            ? visibleMetrics.map((entry) => <ExerciseRow key={entry.id} entry={entry} showVolume />)
            : dayExercises.map((exercise) => (
              <ProgrammedExerciseCard exercise={exercise} key={exercise.id} showStatus={false} />
            ))}
        </div>
      </div>

      <div className="card wide exercise-week-card">
        <div className="section-heading">
          <div>
            <h3>Comparar ejercicio por semana</h3>
            <p className="eyebrow">Selecciona un ejercicio para ver cómo cambia semana a semana.</p>
          </div>
        </div>

        <div className="custom-select">
          <button className="custom-select-trigger" type="button" onClick={() => setIsExercisePickerOpen((value) => !value)}>
            <span>{selectedExercise?.name ?? "Selecciona ejercicio"}</span>
            <ChevronDown size={17} />
          </button>
          {isExercisePickerOpen ? (
            <div className="custom-select-menu">
              {allComparableExercises.map((exercise) => (
                <button
                  key={exercise.id}
                  className={`custom-select-option ${exercise.id === selectedExercise?.id ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setSelectedExerciseId(exercise.id);
                    setIsExercisePickerOpen(false);
                  }}
                >
                  {exercise.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {historySummary ? (
          <>
            <ExerciseHistorySummaryCard summary={historySummary} />
            <ExerciseBestMarkCard summary={historySummary} />

            <div className="exercise-history-chart">
              <h3>Evolución histórica del peso</h3>
              <p className="eyebrow">El gráfico muestra cómo cambia la carga registrada para este ejercicio en el tiempo.</p>
              <div className="chart-wrap">
                <ResponsiveContainer>
                  <ReLineChart data={chartData}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" />
                    <XAxis dataKey="label" stroke="#9CA8B8" />
                    <YAxis stroke="#9CA8B8" />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="peso" stroke="#3C7AFF" strokeWidth={3} dot={{ r: 4 }} />
                  </ReLineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <ExerciseHistoryList summary={historySummary} />
          </>
        ) : (
          <div className="exercise-focus-card">
            <h3>Sin historial para este ejercicio</h3>
            <p>Aún no tienes historial para este ejercicio. Regístralo en un entrenamiento para ver su evolución.</p>
          </div>
        )}
      </div>
    </section>
  );
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
          {formatSigned(summary.weightGain)} kg en {summary.exerciseName.toLowerCase()}
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

function ProfileScreen({ name, summary, dataSource, refreshData, resetLocal }: { name: string; summary: ReturnType<typeof calculateWeeklySummary>; dataSource: DataSource; refreshData: () => void; resetLocal: () => void }) {
  return (
    <section className="screen">
      <div className="card wide">
        <div className="brand">
          <div className="brand-mark"><User size={22} /></div>
          <div>
            <h2>{name}</h2>
            <p className="eyebrow">{dataSource === "supabase" ? "Cuenta conectada" : "Perfil demo local"}</p>
          </div>
          <button className="icon-button" aria-label="Configuración" style={{ marginLeft: "auto" }}><Settings size={17} /></button>
        </div>
      </div>
      <div className="metric-grid">
        <div className="metric"><span>Entrenamientos</span><strong>48</strong></div>
        <div className="metric"><span>Semanas</span><strong>{summary.week + 8}</strong></div>
        <div className="metric"><span>Racha actual</span><strong>4</strong></div>
      </div>
      <div className="card wide">
        <h3>Datos</h3>
        <div className="two-cols">
          <button className="button secondary" type="button" onClick={refreshData}><Database size={17} /> Sincronizar</button>
          <button className="button secondary" type="button" onClick={resetLocal}>Restaurar demo</button>
        </div>
      </div>
      <div className="card wide">
        <h3>Objetivos</h3>
        <ProgressLine label="Fuerza" value={85} />
        <ProgressLine label="Volumen muscular" value={60} />
        <ProgressLine label="Definición" value={30} />
      </div>
    </section>
  );
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
        <span>Kg: <b>{exercise.baseWeight}</b></span>
      </div>
    </div>
  );
}

function WeightValue({ value, label }: { value: number; label: string }) {
  return <span className="current-weight-value">{label}: {value} kg</span>;
}

function DeltaValue({ value, suffix, neutralWhenZero = true }: { value: number; suffix: string; neutralWhenZero?: boolean }) {
  const tone = value > 0 ? "positive" : value < 0 ? "danger" : neutralWhenZero ? "neutral" : "positive";
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : ArrowRight;

  return (
    <span className={`delta-value ${tone}`}>
      <Icon size={12} strokeWidth={3} />
      {neutralWhenZero ? formatSigned(value) : value}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

function StatusBadge({ status }: { status: ObjectiveStatus }) {
  const className = getObjectiveTone(status);
  return <span className={`badge ${className}`}>{status}</span>;
}

function ChangeBadge({ value, positive, negative, neutral }: { value: number; positive: string; negative: string; neutral: string }) {
  const className = value > 0 ? "ok" : value < 0 ? "fail" : "keep";
  const label = value > 0 ? positive : value < 0 ? negative : neutral;
  return <span className={`badge mini ${className}`}>{label}</span>;
}

function getObjectiveTone(status: ObjectiveStatus) {
  if (status === "Cumplimos") return "ok";
  if (status === "No cumplimos") return "fail";
  return "keep";
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

function TextField({ name, label, defaultValue = "", type = "text" }: { name: string; label: string; defaultValue?: string; type?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} />
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
      trainingDays: trainingDays.length > 0 ? trainingDays : fallback.trainingDays,
      microFocus: parsed.microFocus || fallback.microFocus,
      sessionFocus: parsed.sessionFocus || fallback.sessionFocus,
    };
  } catch {
    return createDefaultTrainingPlan();
  }
}

function saveTrainingPlan(plan: TrainingPlan) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_TRAINING_PLAN_KEY, JSON.stringify(plan));
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

function mergeTrainingPlanWithExercises(plan: TrainingPlan, exercises: ExerciseTemplate[]) {
  const routineDays = getRoutineDays(exercises);
  if (routineDays.length === 0) return plan;
  const mergedDays = Array.from(new Set([...plan.trainingDays, ...routineDays])).filter((day) => setupDays.includes(day));
  return { ...plan, trainingDays: mergedDays.length > 0 ? mergedDays : plan.trainingDays };
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

function createSetupByDayFromExercises(exercises: ExerciseTemplate[]): Record<string, SetupDayState> {
  const byDay = createSetupByDay();

  for (const exercise of exercises) {
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
          name: exercise.name,
          sets: exercise.targetSets,
          reps: exercise.targetReps,
          weight: exercise.baseWeight,
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
    weight: 0,
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

function createDemoWeekTwoReps(exercise: ExerciseTemplate) {
  const reps = Array.from({ length: exercise.targetSets }, () => exercise.targetReps);
  const name = removeAccents(exercise.name.toLowerCase());

  if (name.includes("pecho") || name.includes("press")) {
    reps[0] = reps[0] + 1;
  }

  if (name.includes("triceps") || name.includes("peso muerto")) {
    return reps.map((value) => Math.max(1, value - 2));
  }

  return reps;
}

function createDemoWeekTwoWeight(exercise: ExerciseTemplate) {
  const name = removeAccents(exercise.name.toLowerCase());
  if (name.includes("triceps")) return exercise.baseWeight + 10;
  if (name.includes("peso muerto")) return exercise.baseWeight + 10;
  return exercise.baseWeight;
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

function getDateForWeekday(day: string, calendarDay: string) {
  const today = new Date();
  const currentIndex = setupDays.indexOf(calendarDay);
  const targetIndex = setupDays.indexOf(day);
  if (currentIndex < 0 || targetIndex < 0) return today;

  const target = new Date(today);
  target.setDate(today.getDate() + targetIndex - currentIndex);
  return target;
}

function getRoutineDays(exercises: ExerciseTemplate[]) {
  const days = setupDays.filter((day) => exercises.some((exercise) => (exercise.day ?? "Lunes") === day));
  return days.length > 0 ? days : ["Lunes"];
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

function readSetupNumber(value: string) {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readOptionalNumber(value: string): number | "" {
  if (value.trim() === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function screenLabel(screen: Screen) {
  const labels: Record<Screen, string> = {
    login: "Iniciar sesión",
    registro: "Registro",
    dashboard: "Panel principal",
    entrenamiento: "Entrenamiento",
    "registro-entrenamiento": "Registro de entrenamiento",
    "historial-ciclos": "Historial ciclo de entrenamiento",
    comparacion: "Comparación semanal",
    perfil: "Perfil",
  };
  return labels[screen];
}

function formatKg(value: number) {
  return `${Math.round(value).toLocaleString("es-CL")} kg`;
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


