import { Pencil, Trash2 } from "lucide-react";

import { Card } from "@/ui/layout/card";
import { calculateWeeklyComparison, calculateWeeklySummary } from "@/lib/progress/calculations";
import type { ExerciseEntry, ExerciseTemplate } from "@/lib/progress/types";
import { formatKg } from "@/lib/progress/weight-format";
import {
  calculateTargetSummary,
  getActiveRoutineDays,
  getCycleDurationValue,
  getCycleObjectiveValue,
} from "@/lib/training/training-plan-calculations";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import { TRAINING_CYCLE_PRESENTATIONS } from "@/features/training-plan/model/training-cycle-presentation";

function getCycleTitle(plan: TrainingPlan) {
  const cycle = TRAINING_CYCLE_PRESENTATIONS.find((item) => item.id === plan.cycleType);
  return `${cycle?.title ?? "Ciclo"} · ${getCycleObjectiveValue(plan)}`;
}

function getCycleDurationLabel(plan: TrainingPlan) {
  const unit = plan.cycleType === "macro" ? "meses" : plan.cycleType === "session" ? "dia" : "semanas";
  return `${getCycleDurationValue(plan)} ${unit}`;
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
      <Card wide className="cycle-management-card">
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
      </Card>

      <Card wide className="new-cycle-card">
        <p className="eyebrow">Crear nuevo ciclo de entrenamiento</p>
        <h3>Finalizaremos tu ciclo actual y guardaremos su resumen en Historial ciclo de entrenamiento para que puedas revisarlo cuando quieras.</h3>
        <button className="start-button compact" type="button" onClick={requestNewCycle}>
          Crear nuevo ciclo de entrenamiento
        </button>
      </Card>

    </section>
  );
}
