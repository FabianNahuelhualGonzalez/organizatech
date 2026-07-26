import { Pencil, Trash2 } from "lucide-react";

import { calculateWeeklyComparison, calculateWeeklySummary } from "@/lib/progress/calculations";
import type { ExerciseEntry, ExerciseTemplate } from "@/lib/progress/types";
import { formatKg } from "@/lib/progress/weight-format";
import type { TrainingCycleId } from "@/lib/training/training-cycle-id";
import { sortTrainingDaysByWeekOrder, TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import type { TrainingPlan } from "@/lib/training/training-plan-model";

/**
 * Copias locales privadas de helpers todavía no extraídos a `src/lib` (organizatech-app.tsx:
 * setupDays 343, trainingCycles 349, getCycleObjectiveValue 6638, getCycleDurationValue 6645,
 * getCycleTitle 6652, getCycleDurationLabel 6662, getRoutineDays 7199, getActiveRoutineDays 7204,
 * calculateTargetSummary 6890). Se duplican aquí, sin modificar su lógica, para no importar desde
 * organizatech-app.tsx ni introducir una carpeta shared/common en esta fase. `trainingCycles` se
 * recorta a los campos que este componente realmente lee (id/title) — el original también incluye
 * `summary`/`detail`, usados solo por la pantalla de configuración de rutina (no preparada aquí).
 */
const setupDays: string[] = [...TRAINING_DAY_LABELS];

const trainingCycles: ReadonlyArray<{ id: TrainingCycleId; title: string }> = [
  { id: "macro", title: "Macrociclo" },
  { id: "meso", title: "Mesociclo" },
  { id: "micro", title: "Microciclo" },
  { id: "session", title: "Sesión de entrenamiento" },
];

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

export interface CycleManagementScreenProps {
  trainingPlan: TrainingPlan;
  exercises: ExerciseTemplate[];
  entries: ExerciseEntry[];
  cycleNumber: number;
  activeCycleName?: string;
  editCurrentCycle: () => void;
  requestNewCycle: () => void;
  requestDeleteCycle: () => void;
}

export function CycleManagementScreen({
  trainingPlan,
  exercises,
  entries,
  cycleNumber,
  activeCycleName,
  editCurrentCycle,
  requestNewCycle,
  requestDeleteCycle,
}: CycleManagementScreenProps) {
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
