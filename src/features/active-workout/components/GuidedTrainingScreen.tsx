import { Pencil } from "lucide-react";

import styles from "@/features/active-workout/active-workout.module.css";
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
import {
  incompleteCurrentExerciseMessage,
  isExerciseRegisteredInCurrentWorkout,
} from "@/lib/training/workout-registration";
import { IconButton } from "@/ui/buttons/icon-button";
import { RoutineMetricGrid } from "@/ui/data-display/metric-grid";
import { ExerciseLastPerformancePanel } from "@/features/active-workout/components/ExerciseLastPerformancePanel";
import { SeriesResult } from "@/features/active-workout/components/SeriesResult";

/**
 * Pantalla de entrenamiento guiado. TRAIN-UI-01 cambia únicamente su presentación visual y
 * conserva el boundary extraído en P3-30: mismos callbacks, drafts y estados productivos.
 *
 * Componente puro de presentación, sin hooks, estado propio ni efectos. No accede a storage,
 * Supabase, repositories, navegación ni sesión: todo llega por props desde el composition root.
 * Reutiliza el normalizador canónico `normalizeExerciseDraft` (P3-29) y las presentaciones de
 * historial/objetivos; no crea fuentes de verdad alternativas.
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

function isIntermediateDecimalWeightInput(value: string) {
  const normalized = value.trim();
  return isDecimalWeightDraftInput(value) && (
    normalized.endsWith(",") || normalized.endsWith(".")
  );
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
  const hasSubmittedInvalidWeight = draft
    ? notice === incompleteCurrentExerciseMessage && (
        parseDecimalWeightInput(draft.weight) === null &&
        !isIntermediateDecimalWeightInput(draft.weight)
      )
    : false;

  if (!activeExercise || !draft || !preview || !performancePresentation) {
    return (
      <section className={`screen ${styles.screen}`}>
        <div className={`card wide ${styles.workoutCard}`}>
          <h3>No hay ejercicios para {day}</h3>
        </div>
      </section>
    );
  }

  return (
    <section className={`screen ${styles.screen}`} aria-labelledby="guided-routine-title">
      <article className={`card wide routine-summary-card mobile-series-card ${styles.workoutCard}`}>
        <header className={styles.routineHeader}>
          <div className={styles.routineTitle}>
            <h2 id="guided-routine-title">Rutina registrada {day}</h2>
            <p>{routine}</p>
          </div>

          <div className={styles.routineControls}>
            <label className={styles.daySelector}>
              <span className={styles.srOnly}>Día de entrenamiento</span>
              <select value={day} onChange={(event) => switchDay(event.target.value)}>
                {routineDays.map((item) => (
                  <option value={item} key={item}>{item}</option>
                ))}
              </select>
            </label>
            <IconButton
              className={styles.editRoutineButton}
              type="button"
              aria-label="Editar rutina semanal"
              onClick={editRoutine}
            >
              <Pencil size={17} aria-hidden="true" />
            </IconButton>
          </div>
        </header>

        {notice ? (
          <p
            className={`${styles.notice} ${notice.includes("Ya existe un entrenamiento") ? styles.warningNotice : ""}`}
            role="status"
            aria-live="polite"
          >
            {notice}
          </p>
        ) : null}
        <div className={styles.srOnly} aria-hidden="true">
          <RoutineMetricGrid targetSummary={targetSummary} />
        </div>
        <p className={styles.srOnly}>
          Ejercicio {activeIndex + 1} de {exercises.length}; {completedCount} registrados.
        </p>

        <section className={styles.planSection} aria-labelledby="guided-plan-title">
          <div className={styles.sectionHeading}>
            <h3 id="guided-plan-title">Pauta de entrenamiento registrada</h3>
            <p>Selecciona un ejercicio dentro de la tabla para obtener los detalles.</p>
          </div>

          <div
            className={styles.exerciseTable}
            role="group"
            aria-label={`Ejercicios de ${routine} para ${day}`}
          >
            <div className={styles.tableHeader} aria-hidden="true">
              <span>Ejercicios</span>
              <span>Series</span>
              <span>Reps</span>
              <span>KG</span>
            </div>
            <div className={styles.exerciseRows}>
              {exercises.map((exercise, index) => {
                const isActive = index === activeIndex;
                const isDone = isExerciseRegistered(exercise);

                return (
                  <button
                    className={styles.selectableTableRow}
                    type="button"
                    aria-pressed={isActive}
                    aria-label={`${exercise.name}: ${exercise.targetSets} series, ${exercise.targetReps} repeticiones, ${formatKg(exercise.baseWeight)}${isDone ? ", registrado" : ""}`}
                    data-complete={isDone ? "true" : undefined}
                    onClick={() => setActiveIndex(index)}
                    key={exercise.id}
                  >
                    <span className={styles.exerciseNameCell}>
                      {exercise.name}
                      {isDone ? <span className={styles.rowStatus} aria-hidden="true">✓</span> : null}
                    </span>
                    <span>{exercise.targetSets}</span>
                    <span>{exercise.targetReps}</span>
                    <span>{formatKg(exercise.baseWeight)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className={styles.selectedExercise} aria-labelledby="selected-exercise-title">
          <p className={styles.overline}>Ejercicio que seleccionaste</p>
          <div className={styles.selectedExerciseHeading}>
            <h3 id="selected-exercise-title">{activeExercise.name}</h3>
            <strong>{performancePresentation.objectiveText}</strong>
          </div>
          <ExerciseLastPerformancePanel
            presentation={performancePresentation}
            exerciseId={activeExercise.id}
            observationPresentation={observationPresentation}
            observationValue={draft.observation}
            onObservationChange={(value) => updateDraft(activeExercise, { observation: value })}
          />
        </section>

        <section className={styles.newRecord} aria-labelledby="new-record-title">
          <h3 id="new-record-title">Nuevo registro</h3>
          <label className="series-weight-field">
            <span>KG utilizado</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={formatKg(activeExercise.baseWeight)}
              value={draft.weight}
              aria-invalid={hasSubmittedInvalidWeight || undefined}
              aria-describedby={`exercise-weight-hint${hasSubmittedInvalidWeight ? " exercise-weight-error" : ""}`}
              onChange={(event) => updateDraft(activeExercise, { weight: readWeightInput(event.target.value, draft.weight) })}
            />
            <small id="exercise-weight-hint">Puedes usar coma o punto para pesos decimales.</small>
          </label>
          {hasSubmittedInvalidWeight ? (
            <p className={styles.fieldError} id="exercise-weight-error" role="alert">
              Ingresa un peso válido igual o mayor que cero.
            </p>
          ) : null}
          <p className={styles.repGridLabel}>Repeticiones por series</p>
          <div>
            <div className="series-rep-grid">
              {draft.reps.map((reps, index) => (
                <label className="series-rep-box" key={index}>
                  <span>Serie {index + 1}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    placeholder={`${activeExercise.targetReps}`}
                    value={reps}
                    aria-label={`Repeticiones de la serie ${index + 1}`}
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
        </section>

        <SeriesResult entry={preview} />

        <div className={styles.actionRow}>
          {!allRegistered && !activeExerciseAlreadyRegistered ? (
            <button className={`button ${styles.primaryAction}`} type="button" onClick={registerExercise}>
              Registrar serie
            </button>
          ) : !allRegistered ? (
            <button className={`button secondary ${styles.primaryAction}`} type="button" disabled>
              Ejercicio ya registrado
            </button>
          ) : (
            <button
              className={`start-button compact ${styles.primaryAction}`}
              type="button"
              onClick={saveCompletedTraining}
              disabled={isBusy}
              aria-busy={isBusy}
            >
              {isBusy ? "Guardando..." : "Guardar entrenamiento"}
            </button>
          )}
        </div>
      </article>
    </section>
  );
}
