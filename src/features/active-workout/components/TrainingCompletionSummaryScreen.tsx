"use client";

import { useEffect, useRef, useState } from "react";

import { ShareWorkoutCard } from "@/features/progress/components/share-workout-card";
import {
  executeWorkoutShareAction,
  type WorkoutShareActionResult,
} from "@/lib/training/workout-share-action";
import {
  buildWorkoutShareCardModel,
  buildWorkoutShareTextPayload,
} from "@/lib/training/workout-share-model";
import type { TrainingCompletionSummary } from "@/lib/training/training-completion-summary";

const workoutShareStatusByResult = {
  shared: { message: "Entrenamiento compartido.", tone: "polite" },
  copied: { message: "Resumen copiado al portapapeles.", tone: "polite" },
  cancelled: { message: "Compartir cancelado.", tone: "polite" },
  unavailable: { message: "No se pudo compartir ni copiar en este dispositivo.", tone: "error" },
  failed: { message: "No se pudo compartir el entrenamiento. Inténtalo nuevamente.", tone: "error" },
} as const satisfies Record<WorkoutShareActionResult["kind"], {
  readonly message: string;
  readonly tone: "polite" | "error";
}>;

type WorkoutShareStatus = (typeof workoutShareStatusByResult)[keyof typeof workoutShareStatusByResult];

export interface TrainingCompletionSummaryScreenProps {
  summary: TrainingCompletionSummary;
  onDashboard: () => void;
}

export function TrainingCompletionSummaryScreen({ summary, onDashboard }: TrainingCompletionSummaryScreenProps) {
  const shareModel = buildWorkoutShareCardModel(summary);
  const shareInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const [isSharing, setIsSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<WorkoutShareStatus | null>(null);
  const previousDateLabel = summary.exercises.find((exercise) => exercise.comparisonStatus === "ready" && exercise.previousDateLabel)?.previousDateLabel ?? "";
  const currentDateLabel = summary.exercises[0]?.currentDateLabel ?? "";

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function handleShareWorkout() {
    if (!shareModel || shareInFlightRef.current) return;

    shareInFlightRef.current = true;
    setIsSharing(true);
    setShareStatus(null);

    try {
      const payload = buildWorkoutShareTextPayload(shareModel);
      const canUseNavigator = typeof navigator !== "undefined";
      const result = await executeWorkoutShareAction(payload, {
        share: canUseNavigator && typeof navigator.share === "function"
          ? () => navigator.share({
            title: payload.title,
            text: payload.text,
          })
          : undefined,
        copyText: canUseNavigator && typeof navigator.clipboard?.writeText === "function"
          ? () => navigator.clipboard.writeText(payload.text)
          : undefined,
      });

      if (isMountedRef.current) {
        setShareStatus(workoutShareStatusByResult[result.kind]);
      }
    } catch {
      if (isMountedRef.current) {
        setShareStatus(workoutShareStatusByResult.failed);
      }
    } finally {
      shareInFlightRef.current = false;
      if (isMountedRef.current) {
        setIsSharing(false);
      }
    }
  }

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

        {shareModel ? (
          <ShareWorkoutCard
            model={shareModel}
            onShare={handleShareWorkout}
            isSharing={isSharing}
            statusMessage={shareStatus?.message}
            statusTone={shareStatus?.tone}
          />
        ) : null}

        <button className="button training-completion-button" type="button" onClick={onDashboard}>
          Ir al panel principal
        </button>
      </article>
    </section>
  );
}
