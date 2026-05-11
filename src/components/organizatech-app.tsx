"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bell,
  CalendarDays,
  Database,
  Dumbbell,
  Lock,
  LogOut,
  Mail,
  Pencil,
  Plus,
  Save,
  Settings,
  Sparkles,
  Trash2,
  User,
  UserPlus,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as ReLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  deleteExercise,
  loadAppData,
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
import type { ExerciseEntry, ExerciseMetrics, ExerciseTemplate, ObjectiveStatus, RoutineName } from "@/lib/progress/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Screen =
  | "login"
  | "registro"
  | "dashboard"
  | "entrenamiento"
  | "comparacion"
  | "historial"
  | "analitica"
  | "perfil"
  | "graficos"
  | "resumen"
  | "inteligente";

const primaryScreens: Screen[] = ["dashboard", "entrenamiento", "comparacion", "historial", "analitica", "perfil", "graficos", "resumen", "inteligente"];
const routines: RoutineName[] = ["Pecho Hombro Tríceps", "Espalda Bíceps Abdomen", "Piernas"];
const setupDays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

interface SetupExerciseRow {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight: number;
}

interface SetupDayState {
  routineName: string;
  rows: SetupExerciseRow[];
}

interface ExerciseDraft {
  weight: number;
  rir: string;
  reps: number[];
  registered: boolean;
}

export function OrganizatechApp() {
  const [screen, setScreen] = useState<Screen>("login");
  const [sessionName, setSessionName] = useState("Fabian");
  const [statusMessage, setStatusMessage] = useState("Modo demo activo. Conecta Supabase para persistencia real.");
  const [dataSource, setDataSource] = useState<DataSource>("local");
  const [isBusy, setIsBusy] = useState(false);
  const [exercises, setExercises] = useState<ExerciseTemplate[]>([]);
  const [entries, setEntries] = useState<ExerciseEntry[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [editingExercise, setEditingExercise] = useState<ExerciseTemplate | null>(null);
  const [formReps, setFormReps] = useState([12, 11, 10, 9]);
  const [formWeight, setFormWeight] = useState(90);
  const [formRir, setFormRir] = useState("RIR 1-2");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [setupDay, setSetupDay] = useState("Lunes");
  const [setupByDay, setSetupByDay] = useState<Record<string, SetupDayState>>(() => createSetupByDay());
  const [activeRoutineDay, setActiveRoutineDay] = useState("Lunes");
  const [activeExerciseIndex, setActiveExerciseIndex] = useState(0);
  const [exerciseDrafts, setExerciseDrafts] = useState<Record<string, ExerciseDraft>>({});

  useEffect(() => {
    void refreshData();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const metrics = useMemo(() => calculateWeeklyComparison(entries), [entries]);
  const currentWeek = Math.max(1, ...entries.map((entry) => entry.week));
  const hasTrainingEntries = entries.length > 0;
  const hasRoutinePlan = exercises.length > 0;
  const visibleDay = getVisibleTrainingDay(exercises, activeRoutineDay);
  const dayExercises = exercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay);
  const visibleRoutine = dayExercises[0]?.routine ?? setupByDay[visibleDay]?.routineName ?? visibleDay;
  const targetSummary = calculateTargetSummary(dayExercises);
  const currentMetrics = metrics.filter((entry) => entry.week === currentWeek);
  const previousSummary = calculateWeeklySummary(metrics, Math.max(1, currentWeek - 1));
  const summary = calculateWeeklySummary(metrics, currentWeek);
  const insights = generateSmartInsights(summary, currentMetrics);
  const selectedExercise = exercises.find((exercise) => exercise.id === selectedExerciseId) ?? exercises[0];
  const selectedHistory = selectedExercise ? metrics.filter((entry) => entry.exerciseId === selectedExercise.id) : [];
  const nextWeek = entries.length > 0 ? currentWeek + 1 : 1;
  const previewEntry = selectedExercise
    ? calculateExerciseMetrics({
        id: "preview",
        exerciseId: selectedExercise.id,
        exerciseName: selectedExercise.name,
        routine: selectedExercise.routine,
        week: nextWeek,
        date: new Date().toISOString().slice(0, 10),
        targetSets: selectedExercise.targetSets,
        targetReps: selectedExercise.targetReps,
        weight: formWeight,
        previousWeight: selectedHistory.at(-1)?.weight ?? selectedExercise.baseWeight,
        reps: formReps.slice(0, selectedExercise.targetSets),
        notes: selectedExercise.notes,
        rir: formRir,
      })
    : null;

  async function refreshData() {
    setIsBusy(true);
    try {
      const next = await loadAppData();
      setExercises(next.exercises);
      setEntries(next.entries);
      setDataSource(next.source);
      setSelectedExerciseId((current) => current || next.exercises[0]?.id || "");
      setActiveRoutineDay((current) => getVisibleTrainingDay(next.exercises, current));
      setStatusMessage(next.source === "supabase" ? "Datos sincronizados con Supabase." : "Datos guardados en este dispositivo.");
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleAuth(mode: "login" | "registro", formData: FormData) {
    const name = String(formData.get("name") || "Fabian");
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    const supabase = getSupabaseBrowserClient();
    setSessionName(name || email.split("@")[0] || "Fabian");

    if (!supabase) {
      setStatusMessage("Sesión demo iniciada. Agrega variables de Supabase para autenticación real.");
      await refreshData();
      setScreen("dashboard");
      return;
    }

    setIsBusy(true);
    const result =
      mode === "registro"
        ? await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } })
        : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setStatusMessage(result.error.message);
      setIsBusy(false);
      return;
    }

    setStatusMessage("Sesión iniciada con Supabase.");
    await refreshData();
    setIsBusy(false);
    setScreen("dashboard");
  }

  async function handleSaveExercise(formData: FormData) {
    const exercise: ExerciseTemplate = {
      id: String(formData.get("id") || crypto.randomUUID()),
      name: String(formData.get("name") || "").trim(),
      routine: String(formData.get("routine") || routines[0]) as RoutineName,
      targetSets: Number(formData.get("targetSets") || 4),
      targetReps: Number(formData.get("targetReps") || 10),
      baseWeight: Number(formData.get("baseWeight") || 0),
      sideWeight: optionalNumber(formData.get("sideWeight")),
      notes: String(formData.get("notes") || "").trim() || undefined,
    };

    if (!exercise.name) {
      setStatusMessage("El nombre del ejercicio es obligatorio.");
      return;
    }

    setIsBusy(true);
    try {
      const saved = await saveExercise(exercise);
      await refreshData();
      setSelectedExerciseId(saved.id);
      setEditingExercise(null);
      setStatusMessage("Ejercicio guardado.");
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteExercise(exerciseId: string) {
    const exercise = exercises.find((item) => item.id === exerciseId);
    if (!exercise) return;
    if (!window.confirm(`¿Eliminar ${exercise.name} y su historial?`)) return;

    setIsBusy(true);
    try {
      await deleteExercise(exerciseId);
      await refreshData();
      setStatusMessage("Ejercicio eliminado.");
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveTraining() {
    if (!previewEntry) return;
    setIsBusy(true);
    try {
      const saved = await saveTrainingEntry({
        ...previewEntry,
        id: crypto.randomUUID(),
        week: nextWeek,
        date: new Date().toISOString().slice(0, 10),
      });
      setEntries((current) => [...current, saved]);
      setStatusMessage("Entrenamiento guardado.");
      setScreen("resumen");
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function handleResetLocal() {
    resetLocalData();
    void refreshData();
  }

  function navigateTo(nextScreen: Screen) {
    setScreen(nextScreen);
    setIsMenuOpen(false);
  }

  function selectExerciseForTraining(exerciseId: string) {
    const exercise = exercises.find((item) => item.id === exerciseId);
    setSelectedExerciseId(exerciseId);
    setFormWeight(exercise?.baseWeight ?? formWeight);
    setFormReps(Array.from({ length: exercise?.targetSets ?? 4 }, () => exercise?.targetReps ?? 10));
  }

  function updateSetupRow(id: string, field: keyof Omit<SetupExerciseRow, "id">, value: string) {
    setSetupByDay((current) =>
      updateSetupDay(current, setupDay, (state) => ({
        ...state,
        rows: state.rows.map((row) => (
          row.id === id
            ? { ...row, [field]: field === "name" ? value : Number(value) }
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

  async function saveInitialRoutine() {
    const dayState = setupByDay[setupDay] ?? createSetupDayState();
    const routineName = dayState.routineName.trim() || setupDay;
    const validRows = dayState.rows.filter((row) => row.name.trim());

    if (validRows.length === 0) {
      setStatusMessage("Agrega al menos un ejercicio para crear la rutina.");
      return;
    }

    setIsBusy(true);
    try {
      let firstExerciseId = "";
      for (const row of validRows) {
        const exercise = await saveExercise({
          id: crypto.randomUUID(),
          routine: routineName,
          day: setupDay,
          name: row.name.trim(),
          targetSets: Math.max(1, row.sets || 1),
          targetReps: Math.max(1, row.reps || 1),
          baseWeight: Math.max(0, row.weight || 0),
          notes: `Rutina creada para ${setupDay}.`,
        });

        if (!firstExerciseId) firstExerciseId = exercise.id;
      }

      await refreshData();
      if (firstExerciseId) setSelectedExerciseId(firstExerciseId);
      setActiveRoutineDay(setupDay);
      setStatusMessage("Rutina inicial registrada.");
      setScreen("dashboard");
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLogout() {
    setIsBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (supabase) await supabase.auth.signOut();
      setIsMenuOpen(false);
      setScreen("login");
      setStatusMessage("Sesión cerrada correctamente.");
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function openRoutineDay(day: string) {
    const firstExercise = exercises.find((exercise) => (exercise.day ?? day) === day);
    setActiveRoutineDay(day);
    setActiveExerciseIndex(0);
    if (firstExercise) selectExerciseForTraining(firstExercise.id);
    setScreen("entrenamiento");
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
    const draft = exerciseDrafts[exercise.id] ?? createExerciseDraft(exercise);
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
        const draft = exerciseDrafts[exercise.id] ?? createExerciseDraft(exercise);
        const previous = metrics.filter((entry) => entry.exerciseId === exercise.id).at(-1);
        const saved = await saveTrainingEntry({
          id: crypto.randomUUID(),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          routine: exercise.routine,
          week: nextWeek,
          date: new Date().toISOString().slice(0, 10),
          targetSets: exercise.targetSets,
          targetReps: exercise.targetReps,
          weight: draft.weight,
          previousWeight: previous?.weight ?? exercise.baseWeight,
          reps: draft.reps.slice(0, exercise.targetSets),
          rir: draft.rir,
          notes: `Entrenamiento ${visibleDay}: ${exercise.routine}`,
        });
        savedEntries.push(saved);
      }

      setEntries((current) => [...current, ...savedEntries]);
      setExerciseDrafts((current) => {
        const next = { ...current };
        for (const exercise of validExercises) delete next[exercise.id];
        return next;
      });
      setStatusMessage("Entrenamiento guardado.");
      setScreen("dashboard");
    } catch (error) {
      setStatusMessage(readError(error));
    } finally {
      setIsBusy(false);
    }
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

  const menuScreens = hasTrainingEntries ? primaryScreens : primaryScreens.filter((item) => item === "dashboard" || item === "entrenamiento");

  return (
    <main className="app-shell">
      <header className="topbar">
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
          <p className="eyebrow">{hasTrainingEntries ? `Semana ${currentWeek} · ${dataSource === "supabase" ? "Supabase" : "Demo local"}` : "Sin registro de entrenamiento"}</p>
        </div>
        <button className="icon-button" aria-label="Notificaciones" onClick={() => setScreen("inteligente")}>
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
                  <span className="badge keep">{dataSource === "supabase" ? "Supabase" : "Local"}</span>
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

      {screen === "dashboard" && (
        <DashboardScreen
          exercises={exercises}
          hasTrainingEntries={hasTrainingEntries}
          hasRoutinePlan={hasRoutinePlan}
          day={visibleDay}
          routine={visibleRoutine}
          targetSummary={targetSummary}
          dayExercises={dayExercises}
          summary={summary}
          currentMetrics={currentMetrics}
          startRegistration={() => setScreen("entrenamiento")}
          goToRoutine={() => openRoutineDay(visibleDay)}
        />
      )}
      {screen === "entrenamiento" && !hasRoutinePlan && (
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
          isBusy={isBusy}
        />
      )}
      {screen === "entrenamiento" && hasRoutinePlan && (
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
          isBusy={isBusy}
        />
      )}
      {screen === "comparacion" && <ComparisonScreen currentMetrics={currentMetrics} summary={summary} previousSummary={previousSummary} />}
      {screen === "historial" && (
        <HistoryScreen exercises={exercises} selectedExerciseId={selectedExerciseId} setSelectedExerciseId={setSelectedExerciseId} history={selectedHistory} />
      )}
      {screen === "analitica" && <AnalyticsScreen summary={summary} currentMetrics={currentMetrics} />}
      {screen === "perfil" && <ProfileScreen name={sessionName} summary={summary} dataSource={dataSource} refreshData={refreshData} resetLocal={handleResetLocal} />}
      {screen === "graficos" && <ChartsScreen metrics={metrics} currentMetrics={currentMetrics} />}
      {screen === "resumen" && <WeeklySummaryScreen summary={summary} currentMetrics={currentMetrics} />}
      {screen === "inteligente" && <SmartScreen insights={insights} />}

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
  routine,
  targetSummary,
  dayExercises,
  summary,
  currentMetrics,
  startRegistration,
  goToRoutine,
}: {
  exercises: ExerciseTemplate[];
  hasTrainingEntries: boolean;
  hasRoutinePlan: boolean;
  day: string;
  routine: string;
  targetSummary: { volume: number; reps: number; exerciseCount: number };
  dayExercises: ExerciseTemplate[];
  summary: ReturnType<typeof calculateWeeklySummary>;
  currentMetrics: ExerciseMetrics[];
  startRegistration: () => void;
  goToRoutine: () => void;
}) {
  const chartData = currentMetrics.map((entry) => ({ name: entry.exerciseName, volumen: entry.volumeTotal }));
  const todayLabel = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  const registeredTraining = currentMetrics[0]?.routine ?? exercises[0]?.routine ?? "Pecho Hombro Tríceps";
  const routinePreview = currentMetrics.filter((entry) => entry.routine === registeredTraining);

  if (!hasRoutinePlan) {
    return <EmptyDashboard startRegistration={startRegistration} />;
  }

  if (!hasTrainingEntries) {
    return (
      <section className="screen">
        <div className="card wide routine-summary-card">
          <p className="eyebrow">{routine}</p>
          <h3>Entrenamiento del día {day}</h3>
          <div className="metric-grid">
            <div className="metric"><span>Volumen total entrenamiento</span><strong>{formatKg(targetSummary.volume)}</strong></div>
            <div className="metric"><span>Total reps</span><strong>{targetSummary.reps}</strong></div>
            <div className="metric"><span>Ejercicios total entrenamiento</span><strong>{targetSummary.exerciseCount}</strong></div>
          </div>
        </div>
        <div className="card wide">
          <h3>Ejercicios a realizar · {day}</h3>
          <div className="plan-list">
            {dayExercises.map((exercise) => (
              <div className="plan-row" key={exercise.id}>
                <strong>{exercise.name}</strong>
                <span>{exercise.targetSets} series</span>
                <span>{exercise.targetReps} reps</span>
                <span>{exercise.baseWeight} kg</span>
              </div>
            ))}
          </div>
          <button className="button secondary" style={{ width: "100%", marginTop: 12 }} onClick={goToRoutine}>
            Ir a rutina
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="card wide">
        <p className="small-label">Vista progreso semanal</p>
        <strong className={summary.volumePercentage >= 0 ? "positive" : "danger"} style={{ fontSize: 38 }}>
          {formatSigned(summary.volumePercentage)}%
        </strong>
        <div className="chart-wrap" style={{ height: 130 }}>
          <ResponsiveContainer>
            <ReLineChart data={chartData}>
              <Line type="monotone" dataKey="volumen" stroke="#3C7AFF" strokeWidth={3} dot={false} />
              <Tooltip contentStyle={tooltipStyle} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <MetricGrid summary={summary} />
      <div className="card wide">
        <h3>Entrenamiento de hoy {todayLabel} · {registeredTraining}</h3>
        <div className="exercise-list">
          {routinePreview.slice(0, 4).map((entry) => <ExerciseRow key={entry.id} entry={entry} />)}
        </div>
        <button className="button secondary" style={{ width: "100%", marginTop: 12 }} onClick={goToRoutine}>
          Ir a rutina
        </button>
      </div>
    </section>
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
  isBusy,
}: {
  day: string;
  setDay: (value: string) => void;
  routineName: string;
  setRoutineName: (value: string) => void;
  rows: SetupExerciseRow[];
  updateRow: (id: string, field: keyof Omit<SetupExerciseRow, "id">, value: string) => void;
  addRow: () => void;
  removeRow: (id: string) => void;
  saveRoutine: () => void;
  isBusy: boolean;
}) {
  return (
    <section className="setup-screen">
      <div className="setup-card">
        <h3>Selecciona día de entrenamiento</h3>
        <div className="day-grid">
          {setupDays.map((item) => (
            <button
              key={item}
              className={`day-pill ${day === item ? "active" : ""}`}
              onClick={() => setDay(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="setup-card">
        <h3>Nombra tu rutina del día {day}</h3>
        <input
          className="setup-name-input"
          placeholder="Ingrese nombre"
          value={routineName}
          onChange={(event) => setRoutineName(event.target.value)}
        />
      </div>

      <div className="setup-card">
        <h3>Ingrese ejercicios</h3>
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
              <input type="number" placeholder="Series" value={row.sets || ""} onChange={(event) => updateRow(row.id, "sets", event.target.value)} />
              <input type="number" placeholder="Reps" value={row.reps || ""} onChange={(event) => updateRow(row.id, "reps", event.target.value)} />
              <input type="number" placeholder="Kg" value={row.weight || ""} onChange={(event) => updateRow(row.id, "weight", event.target.value)} />
              <button className="row-delete" aria-label="Eliminar ejercicio" onClick={() => removeRow(row.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="setup-actions">
          <button className="small-green-button" onClick={addRow}>Agregar más</button>
          <button className="start-button compact" onClick={saveRoutine} disabled={isBusy}>
            {isBusy ? "Guardando..." : "Guardar rutina"}
          </button>
        </div>
      </div>
    </section>
  );
}

function TrainingScreen({
  exercises,
  selectedExerciseId,
  setSelectedExerciseId,
  formReps,
  setFormReps,
  formWeight,
  setFormWeight,
  formRir,
  setFormRir,
  previewEntry,
  editingExercise,
  setEditingExercise,
  saveTraining,
  saveExercise,
  deleteExercise,
  isBusy,
}: {
  exercises: ExerciseTemplate[];
  selectedExerciseId: string;
  setSelectedExerciseId: (value: string) => void;
  formReps: number[];
  setFormReps: (value: number[]) => void;
  formWeight: number;
  setFormWeight: (value: number) => void;
  formRir: string;
  setFormRir: (value: string) => void;
  previewEntry: ExerciseMetrics;
  editingExercise: ExerciseTemplate | null;
  setEditingExercise: (exercise: ExerciseTemplate | null) => void;
  saveTraining: () => void;
  saveExercise: (data: FormData) => void;
  deleteExercise: (exerciseId: string) => void;
  isBusy: boolean;
}) {
  const selected = exercises.find((exercise) => exercise.id === selectedExerciseId) ?? exercises[0];
  const draft = editingExercise ?? selected;

  return (
    <section className="screen">
      <div className="card wide">
        <h2>Nuevo entrenamiento</h2>
        <p className="eyebrow"><CalendarDays size={13} /> Semana {previewEntry.week}</p>
        <div className="metric-grid">
          <div className="metric"><span>Volumen total</span><strong>{formatKg(previewEntry.volumeTotal)}</strong></div>
          <div className="metric"><span>Total reps</span><strong>{previewEntry.totalReps}</strong></div>
          <div className="metric"><span>Objetivo</span><strong>{previewEntry.targetTotalReps}</strong></div>
        </div>
      </div>

      <div className="card wide form-grid">
        <div className="row-actions">
          <h3>Registro de series</h3>
          <button className="icon-button" aria-label="Crear ejercicio" onClick={() => setEditingExercise(newExercise())}>
            <Plus size={17} />
          </button>
          <button className="icon-button" aria-label="Editar ejercicio" onClick={() => setEditingExercise(selected)}>
            <Pencil size={17} />
          </button>
          <button className="icon-button danger-button" aria-label="Eliminar ejercicio" onClick={() => deleteExercise(selected.id)}>
            <Trash2 size={17} />
          </button>
        </div>
        <label className="field">
          <span>Ejercicio</span>
          <select value={selectedExerciseId} onChange={(event) => setSelectedExerciseId(event.target.value)}>
            {exercises.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
            ))}
          </select>
        </label>
        <div className="two-cols">
          <TextNumber label="Peso" value={formWeight} onChange={setFormWeight} />
          <label className="field">
            <span>RIR</span>
            <input value={formRir} onChange={(event) => setFormRir(event.target.value)} />
          </label>
        </div>
        <div className="two-cols">
          {formReps.map((reps, index) => (
            <TextNumber
              key={index}
              label={`Serie ${index + 1}`}
              value={reps}
              onChange={(value) => {
                const next = [...formReps];
                next[index] = value;
                setFormReps(next);
              }}
            />
          ))}
        </div>
        <ExerciseRow entry={previewEntry} />
        <button className="button" onClick={saveTraining} disabled={isBusy}>
          <Save size={17} />
          Guardar entrenamiento
        </button>
      </div>

      {editingExercise && (
        <ExerciseForm exercise={draft} onCancel={() => setEditingExercise(null)} onSubmit={saveExercise} />
      )}
    </section>
  );
}

function ExerciseForm({ exercise, onSubmit, onCancel }: { exercise: ExerciseTemplate; onSubmit: (data: FormData) => void; onCancel: () => void }) {
  return (
    <form className="card wide form-grid" action={onSubmit}>
      <input name="id" type="hidden" defaultValue={exercise.id} />
      <h3>{exercise.name ? "Editar ejercicio" : "Crear ejercicio"}</h3>
      <TextField name="name" label="Nombre" defaultValue={exercise.name} />
      <label className="field">
        <span>Rutina</span>
        <select name="routine" defaultValue={exercise.routine}>
          {routines.map((routine) => <option key={routine}>{routine}</option>)}
        </select>
      </label>
      <div className="two-cols">
        <TextField name="targetSets" label="Series objetivo" type="number" defaultValue={String(exercise.targetSets)} />
        <TextField name="targetReps" label="Reps objetivo" type="number" defaultValue={String(exercise.targetReps)} />
      </div>
      <div className="two-cols">
        <TextField name="baseWeight" label="Peso base" type="number" defaultValue={String(exercise.baseWeight)} />
        <TextField name="sideWeight" label="Kg por lado" type="number" defaultValue={String(exercise.sideWeight ?? "")} />
      </div>
      <label className="field">
        <span>Notas</span>
        <textarea name="notes" defaultValue={exercise.notes ?? ""} />
      </label>
      <div className="two-cols">
        <button className="button secondary" type="button" onClick={onCancel}>Cancelar</button>
        <button className="button" type="submit">Guardar ejercicio</button>
      </div>
    </form>
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
  isBusy,
}: {
  day: string;
  routine: string;
  exercises: ExerciseTemplate[];
  targetSummary: { volume: number; reps: number; exerciseCount: number };
  activeIndex: number;
  setActiveIndex: (value: number) => void;
  drafts: Record<string, ExerciseDraft>;
  updateDraft: (exercise: ExerciseTemplate, patch: Partial<ExerciseDraft>) => void;
  registerExercise: () => void;
  saveCompletedTraining: () => void;
  isBusy: boolean;
}) {
  const activeExercise = exercises[activeIndex] ?? exercises[0];
  const draft = activeExercise ? (drafts[activeExercise.id] ?? createExerciseDraft(activeExercise)) : null;
  const completedCount = exercises.filter((exercise) => drafts[exercise.id]?.registered).length;
  const allRegistered = exercises.length > 0 && completedCount === exercises.length;
  const preview = activeExercise && draft
    ? calculateExerciseMetrics({
        id: "preview",
        exerciseId: activeExercise.id,
        exerciseName: activeExercise.name,
        routine: activeExercise.routine,
        week: 1,
        date: new Date().toISOString().slice(0, 10),
        targetSets: activeExercise.targetSets,
        targetReps: activeExercise.targetReps,
        weight: draft.weight,
        previousWeight: activeExercise.baseWeight,
        reps: draft.reps,
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
      <div className="card wide routine-summary-card">
        <p className="eyebrow">{routine}</p>
        <h3>Entrenamiento día {day}</h3>
        <p className="eyebrow">Ejercicio {activeIndex + 1} de {exercises.length} · {completedCount} registrados</p>
        <div className="metric-grid">
          <div className="metric"><span>Volumen total entrenamiento</span><strong>{formatKg(targetSummary.volume)}</strong></div>
          <div className="metric"><span>Total reps</span><strong>{targetSummary.reps}</strong></div>
          <div className="metric"><span>Ejercicios total</span><strong>{targetSummary.exerciseCount}</strong></div>
        </div>
      </div>

      <div className="card wide">
        <h3>Ejercicios a realizar</h3>
        <div className="routine-tabs">
          {exercises.map((exercise, index) => (
            <button
              key={exercise.id}
              className={`routine-tab ${index === activeIndex ? "active" : ""} ${drafts[exercise.id]?.registered ? "done" : ""}`}
              onClick={() => setActiveIndex(index)}
            >
              {exercise.name}
            </button>
          ))}
        </div>
      </div>

      <div className="card wide form-grid">
        <h3>Registro de series</h3>
        <label className="field">
          <span>Ejercicio</span>
          <select value={activeExercise.id} onChange={(event) => setActiveIndex(Math.max(0, exercises.findIndex((exercise) => exercise.id === event.target.value)))}>
            {exercises.map((exercise) => (
              <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
            ))}
          </select>
        </label>
        <div className="two-cols">
          <TextNumber label="Peso" value={draft.weight} onChange={(value) => updateDraft(activeExercise, { weight: value })} />
          <label className="field">
            <span>RIR</span>
            <input value={draft.rir} onChange={(event) => updateDraft(activeExercise, { rir: event.target.value })} />
          </label>
        </div>
        <div className="two-cols">
          {draft.reps.map((reps, index) => (
            <TextNumber
              key={index}
              label={`Serie ${index + 1}`}
              value={reps}
              onChange={(value) => {
                const next = [...draft.reps];
                next[index] = value;
                updateDraft(activeExercise, { reps: next });
              }}
            />
          ))}
        </div>
        <ExerciseRow entry={preview} />
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

function ComparisonScreen({ currentMetrics, summary, previousSummary }: { currentMetrics: ExerciseMetrics[]; summary: ReturnType<typeof calculateWeeklySummary>; previousSummary: ReturnType<typeof calculateWeeklySummary> }) {
  return (
    <section className="screen">
      <div className="segmented wide">
        <button className="tab active">Semana {summary.week}</button>
        <button className="tab">vs</button>
        <button className="tab">Semana {previousSummary.week}</button>
      </div>
      <MetricGrid summary={summary} />
      <div className="card wide">
        <h3>Ejercicios</h3>
        <div className="exercise-list">
          {currentMetrics.map((entry) => <ExerciseRow key={entry.id} entry={entry} showVolume />)}
        </div>
      </div>
    </section>
  );
}

function HistoryScreen({ exercises, selectedExerciseId, setSelectedExerciseId, history }: { exercises: ExerciseTemplate[]; selectedExerciseId: string; setSelectedExerciseId: (value: string) => void; history: ExerciseMetrics[] }) {
  const current = history.at(-1);
  return (
    <section className="screen">
      <div className="card wide form-grid">
        <label className="field">
          <span>Ejercicio</span>
          <select value={selectedExerciseId} onChange={(event) => setSelectedExerciseId(event.target.value)}>
            {exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
          </select>
        </label>
        {current ? <ExerciseRow entry={current} showVolume /> : <p className="eyebrow">Aún no hay historial para este ejercicio.</p>}
      </div>
      <div className="card wide">
        <h3>Evolución de rendimiento</h3>
        <div className="chart-wrap">
          <ResponsiveContainer>
            <ReLineChart data={history.map((entry) => ({ semana: `S${entry.week}`, peso: entry.weight, volumen: entry.volumeTotal }))}>
              <CartesianGrid stroke="rgba(255,255,255,.08)" />
              <XAxis dataKey="semana" stroke="#9CA8B8" />
              <YAxis stroke="#9CA8B8" />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="peso" stroke="#3C7AFF" strokeWidth={3} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card wide">
        <h3>Historial de entrenamientos</h3>
        <div className="history-list">
          {history.map((entry) => (
            <div className="history-row" key={entry.id}>
              <span>Semana {entry.week}</span>
              <strong>{entry.weight} kg · {entry.reps.join(" / ")}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AnalyticsScreen({ summary, currentMetrics }: { summary: ReturnType<typeof calculateWeeklySummary>; currentMetrics: ExerciseMetrics[] }) {
  const score = Math.min(100, Math.max(0, Math.round(72 + summary.complianceRate * 0.18 + Math.max(summary.volumePercentage, 0) * 0.5)));
  const factors = [
    ["Volumen", Math.min(100, 82 + summary.volumePercentage)],
    ["Repeticiones", Math.min(100, 78 + summary.repsDifference)],
    ["Carga", currentMetrics.filter((entry) => entry.kgDifference > 0).length * 20],
    ["Consistencia", summary.complianceRate],
  ];
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

function ChartsScreen({ metrics, currentMetrics }: { metrics: ExerciseMetrics[]; currentMetrics: ExerciseMetrics[] }) {
  const lastWeek = Math.max(4, ...metrics.map((entry) => entry.week));
  const weekly = Array.from({ length: lastWeek }, (_, index) => index + 1).map((week) => ({
    semana: `S${week}`,
    reps: metrics.filter((entry) => entry.week === week).reduce((total, entry) => total + entry.totalReps, 0),
    volumen: metrics.filter((entry) => entry.week === week).reduce((total, entry) => total + entry.volumeTotal, 0),
  }));
  return (
    <section className="screen">
      <div className="card wide">
        <h3>Evolución de repeticiones totales</h3>
        <div className="chart-wrap">
          <ResponsiveContainer>
            <ReLineChart data={weekly}>
              <CartesianGrid stroke="rgba(255,255,255,.08)" />
              <XAxis dataKey="semana" stroke="#9CA8B8" />
              <YAxis stroke="#9CA8B8" />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="reps" stroke="#3C7AFF" strokeWidth={3} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="card wide">
        <h3>Reps por ejercicio</h3>
        <div className="chart-wrap">
          <ResponsiveContainer>
            <BarChart data={currentMetrics.map((entry) => ({ name: entry.exerciseName, reps: entry.totalReps }))} layout="vertical">
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" stroke="#9CA8B8" width={110} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="reps" fill="#3C7AFF" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function WeeklySummaryScreen({ summary, currentMetrics }: { summary: ReturnType<typeof calculateWeeklySummary>; currentMetrics: ExerciseMetrics[] }) {
  const pieData = [
    { name: "Cumplimos", value: summary.objectivesOk, color: "#74DF71" },
    { name: "Mantenemos", value: summary.objectivesMaintained, color: "#FFBF4D" },
    { name: "No cumplimos", value: summary.objectivesFailed, color: "#FF5D69" },
  ];
  return (
    <section className="screen">
      <MetricGrid summary={summary} />
      <div className="card wide">
        <h3>Cumplimiento de objetivos</h3>
        <ProgressLine label={`${summary.objectivesOk} de ${summary.exerciseCount} objetivos cumplidos`} value={summary.complianceRate} />
      </div>
      <div className="card wide">
        <h3>Ejercicios</h3>
        <div className="chart-wrap">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieData} innerRadius={46} outerRadius={78} dataKey="value">
                {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="exercise-list">
          {currentMetrics.map((entry) => <ExerciseRow key={entry.id} entry={entry} />)}
        </div>
      </div>
    </section>
  );
}

function SmartScreen({ insights }: { insights: ReturnType<typeof generateSmartInsights> }) {
  return (
    <section className="screen">
      <div className="card wide">
        <h2><Sparkles size={18} /> Análisis inteligente</h2>
        <div className="insight-list">
          {insights.map((insight) => (
            <div className="insight-row" key={insight.id}>
              <div>
                <strong>{insight.title}</strong>
                <p className="eyebrow">{insight.detail}</p>
              </div>
              <span className={`badge ${insight.tone === "positivo" ? "ok" : insight.tone === "riesgo" ? "fail" : "keep"}`}>
                {insight.tone}
              </span>
            </div>
          ))}
        </div>
      </div>
      <button className="button wide">Ver recomendaciones</button>
    </section>
  );
}

function MetricGrid({ summary }: { summary: ReturnType<typeof calculateWeeklySummary> }) {
  return (
    <div className="metric-grid wide">
      <div className="metric">
        <span>Volumen total</span>
        <strong>{formatKg(summary.volumeTotal)}</strong>
        <TrendValue value={summary.volumePercentage} suffix="%" />
      </div>
      <div className="metric">
        <span>Total reps</span>
        <strong>{summary.totalReps}</strong>
        <TrendValue value={summary.repsDifference} />
      </div>
      <div className="metric">
        <span>Ejercicios</span>
        <strong>{summary.exerciseCount}</strong>
        <TrendValue value={summary.objectivesOk} />
      </div>
    </div>
  );
}

function TrendValue({ value, suffix = "" }: { value: number; suffix?: string }) {
  const isPositive = value >= 0;
  const Icon = isPositive ? ArrowUp : ArrowDown;

  return (
    <span className={`trend ${isPositive ? "positive" : "danger"}`}>
      <Icon size={12} strokeWidth={3} />
      {formatSigned(value)}
      {suffix}
    </span>
  );
}

function ExerciseRow({ entry, showVolume = false }: { entry: ExerciseMetrics; showVolume?: boolean }) {
  return (
    <div className="exercise-row">
      <div>
        <strong>{entry.exerciseName}</strong>
        <p className="eyebrow">
          {entry.weight}kg · {formatSigned(entry.repsDifference)} reps · {formatSigned(entry.kgDifference)} kg
          {showVolume ? ` · ${formatSigned(entry.volumePercentage)}% volumen` : ""}
        </p>
      </div>
      <StatusBadge status={entry.objectiveStatus} />
    </div>
  );
}

function StatusBadge({ status }: { status: ObjectiveStatus }) {
  const className = status === "Cumplimos" ? "ok" : status === "No cumplimos" ? "fail" : "keep";
  return <span className={`badge ${className}`}>{status}</span>;
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

function TextNumber({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function newExercise(): ExerciseTemplate {
  return {
    id: crypto.randomUUID(),
    routine: "Pecho Hombro Tríceps",
    name: "",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 0,
  };
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
    id: crypto.randomUUID(),
    name: "",
    sets: 4,
    reps: 10,
    weight: 0,
  };
}

function createExerciseDraft(exercise: ExerciseTemplate): ExerciseDraft {
  return {
    weight: exercise.baseWeight,
    rir: "RIR 1-2",
    reps: Array.from({ length: exercise.targetSets }, () => exercise.targetReps),
    registered: false,
  };
}

function calculateTargetSummary(exercises: ExerciseTemplate[]) {
  return exercises.reduce(
    (summary, exercise) => {
      const reps = exercise.targetSets * exercise.targetReps;
      return {
        volume: summary.volume + reps * exercise.baseWeight,
        reps: summary.reps + reps,
        exerciseCount: summary.exerciseCount + 1,
      };
    },
    { volume: 0, reps: 0, exerciseCount: 0 },
  );
}

function getVisibleTrainingDay(exercises: ExerciseTemplate[], current: string) {
  if (exercises.some((exercise) => exercise.day === current)) return current;

  const today = new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date());
  const normalizedToday = setupDays.find((day) => removeAccents(day.toLowerCase()) === removeAccents(today.toLowerCase()));
  if (normalizedToday && exercises.some((exercise) => exercise.day === normalizedToday)) return normalizedToday;

  return exercises.find((exercise) => exercise.day)?.day ?? current;
}

function removeAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function screenLabel(screen: Screen) {
  const labels: Record<Screen, string> = {
    login: "Iniciar sesión",
    registro: "Registro",
    dashboard: "Panel principal",
    entrenamiento: "Entrenamiento",
    comparacion: "Comparación",
    historial: "Historial",
    analitica: "Analítica",
    perfil: "Perfil",
    graficos: "Gráficos",
    resumen: "Resumen",
    inteligente: "Análisis inteligente",
  };
  return labels[screen];
}

function optionalNumber(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  if (!raw.trim()) return undefined;
  return Number(raw);
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}

function formatKg(value: number) {
  return `${Math.round(value).toLocaleString("es-CL")} kg`;
}

const tooltipStyle = {
  background: "#101B27",
  border: "1px solid rgba(220,231,255,.14)",
  borderRadius: 8,
  color: "#FFFFFF",
};
