import { Pencil, Save } from "lucide-react";

import { calculateExerciseMetrics } from "@/lib/progress/calculations";
import type { ExerciseTemplate } from "@/lib/progress/types";
import { formatKg, isDecimalWeightDraftInput, parseDecimalWeightInput } from "@/lib/progress/weight-format";
import {
  buildExerciseLastObservationPresentation,
  type ExerciseLastObservationPresentationInput,
} from "@/lib/training/exercise-last-observation-presentation";
import {
  buildExerciseLastPerformancePresentation,
  type ExerciseLastPerformancePresentationInput,
} from "@/lib/training/exercise-last-performance-presentation";
import { normalizeExerciseDraft, type ExerciseDraft } from "@/lib/training/training-exercise-draft";
import { isExerciseRegisteredInCurrentWorkout } from "@/lib/training/workout-registration";
import { RoutineMetricGrid } from "@/ui/data-display/metric-grid";
import { ExerciseLastPerformancePanel } from "@/features/active-workout/components/ExerciseLastPerformancePanel";
import { SeriesResult } from "@/features/active-workout/components/SeriesResult";

/**
 * Pantalla de entrenamiento guiado (P3-30): extracción MECÁNICA de la función inline
 * `GuidedTrainingScreen` que vivía en `organizatech-app.tsx`. Sin rediseño, sin cambios
 * funcionales ni visuales: mismos textos, DOM, classNames, callbacks y estados disabled.
 *
 * Componente puro de presentación, sin hooks, sin estado propio, sin efectos. No accede a
 * storage, Supabase, repositories, navegación ni sesión: todo llega por props desde el root.
 *
 * Reutiliza el normalizador canónico `normalizeExerciseDraft` (P3-29) — no lo duplica.
 *
 * NOTA sobre los tipos de `latestExercisePerformance`/`latestExerciseObservation`: se declaran
 * mediante los tipos de entrada de las presentaciones (`...PresentationInput["latest"]` y
 * `...PresentationInput["observation"]`), que resuelven EXACTAMENTE a
 * `LatestExercisePerformance | null` y `LatestExerciseObservation | null`. Se evita importar
 * directamente desde `*-repository` porque el contrato visual de active-workout prohíbe que un
 * componente importe repositories, incluso sólo para tipos. La semántica de las props es idéntica.
 */

/**
 * Helpers de lectura de inputs, movidos íntegros desde el root junto con el componente: eran de
 * uso exclusivo de esta pantalla. Se apoyan en los primitivos canónicos de
 * `@/lib/progress/weight-format`, sin reimplementar el parsing decimal.
 *
 * `readWeightInput` es la única excepción: el root conserva su propia copia porque Routine Builder
 * también la usa y un contrato vigente la fija ahí (`training-routine-type-integration-contract`).
 * Aquí se declara el mismo wrapper de una línea sobre `isDecimalWeightDraftInput` para preservar
 * la forma exacta de la llamada en el JSX, sin importar el root ni alterar el comportamiento.
 */
function readWeightInput(value: string, fallback: string) {
  return isDecimalWeightDraftInput(value) ? value : fallback;
}

function readPreviewWeight(value: string, fallback: number) {
  return parseDecimalWeightInput(value) ?? fallback;
}

function readOptionalNumber(value: string): number | "" {
  if (value.trim() === "") return "";
  return parseDecimalWeightInput(value) ?? "";
}

export interface GuidedTrainingScreenProps {
  day: string;
  routine: string;
  exercises: ExerciseTemplate[];
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  drafts: Record<string, ExerciseDraft>;
  latestExercisePerformance: ExerciseLastPerformancePresentationInput["latest"];
  latestExercisePerformanceLoading: boolean;
  latestExercisePerformanceError: string;
  latestExerciseObservation: ExerciseLastObservationPresentationInput["observation"];
  latestExerciseObservationLoading: boolean;
  latestExerciseObservationError: string;
  latestExerciseObservationDidQuery: boolean;
  updateDraft: (exercise: ExerciseTemplate, patch: Partial<ExerciseDraft>) => void;
  registerExercise: () => void;
  saveCompletedTraining: () => void;
  editRoutine: () => void;
  routineDays: string[];
  switchDay: (day: string) => void;
  notice: string;
  isBusy: boolean;
}

export function GuidedTrainingScreen({
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
  latestExerciseObservation,
  latestExerciseObservationLoading,
  latestExerciseObservationError,
  latestExerciseObservationDidQuery,
  updateDraft,
  registerExercise,
  saveCompletedTraining,
  editRoutine,
  routineDays,
  switchDay,
  notice,
  isBusy,
}: GuidedTrainingScreenProps) {
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
  const observationPresentation = buildExerciseLastObservationPresentation({
    observation: latestExerciseObservation,
    loading: latestExerciseObservationLoading,
    error: latestExerciseObservationError,
    hasQueried: latestExerciseObservationDidQuery,
  });

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
          <ExerciseLastPerformancePanel
            presentation={performancePresentation}
            exerciseId={activeExercise.id}
            observationPresentation={observationPresentation}
            observationValue={draft.observation}
            onObservationChange={(value) => updateDraft(activeExercise, { observation: value })}
          />
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
