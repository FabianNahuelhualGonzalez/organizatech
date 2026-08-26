"use client";

import { Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import styles from "@/features/active-workout/active-workout.module.css";
import { ExerciseRegistrationSheet } from "@/features/active-workout/components/ExerciseRegistrationSheet";
import {
  canSaveActiveWorkoutDrafts,
  closeActiveWorkoutSheet,
  createActiveWorkoutRegistrationCommit,
  createActiveWorkoutSheetScopeKey,
  createActiveWorkoutSheetState,
  isActiveWorkoutRegistrationComplete,
  openActiveWorkoutSheet,
  reconcileActiveWorkoutSheet,
  resolveActiveWorkoutRovingExerciseId,
  toggleActiveWorkoutSheetPanel,
  type ActiveWorkoutRegistrationCommit,
} from "@/features/active-workout/model/active-workout-sheet";
import type { ActiveWorkoutHistoryPublicationStatus } from "@/features/active-workout/model/active-workout-history-prefetch-controller";
import type { ActiveWorkoutCompletionStatus } from "@/features/active-workout/model/active-workout-boundary-contract";
import type { ExerciseTemplate } from "@/lib/progress/types";
import {
  formatDecimalEs,
  formatKg,
  isDecimalWeightDraftInput,
  parseDecimalWeightInput,
} from "@/lib/progress/weight-format";
import {
  buildExerciseLastObservationPresentation,
  type ExerciseLastObservationPresentationInput,
} from "@/lib/training/exercise-last-observation-presentation";
import {
  buildExerciseLastPerformancePresentation,
  type ExerciseLastPerformancePresentationInput,
} from "@/lib/training/exercise-last-performance-presentation";
import { normalizeExerciseDraft, type ExerciseDraft } from "@/lib/training/training-exercise-draft";
import { IconButton } from "@/ui/buttons/icon-button";

type EditableExerciseDraftPatch = Partial<Pick<ExerciseDraft, "weight" | "reps" | "observation">>;

function readWeightInput(value: string, fallback: string) {
  return isDecimalWeightDraftInput(value) ? value : fallback;
}

function readOptionalNumber(value: string): number | "" {
  if (value.trim() === "") return "";
  return parseDecimalWeightInput(value) ?? "";
}

export interface ActiveWorkoutSheetBoundaryProps {
  day: string;
  routine: string;
  exercises: ExerciseTemplate[];
  targetSummary: { totalWeight: number; volume: number; reps: number; exerciseCount: number };
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  drafts: Record<string, ExerciseDraft>;
  latestExercisePerformance: ExerciseLastPerformancePresentationInput["latest"];
  latestExercisePerformanceError: string;
  latestExerciseObservation: ExerciseLastObservationPresentationInput["observation"];
  latestExerciseObservationLoading: boolean;
  latestExerciseObservationError: string;
  latestExerciseObservationDidQuery: boolean;
  updateDraft: (exercise: ExerciseTemplate, patch: Partial<ExerciseDraft>) => void;
  registerExercise: () => void;
  saveCompletedTraining: () => void;
  saveCompletedTrainingStatus: ActiveWorkoutCompletionStatus;
  retrySaveCompletedTraining: () => void;
  editRoutine: () => void;
  routineDays: string[];
  switchDay: (day: string) => void;
  notice: string;
  isBusy: boolean;
  latestExercisePerformanceStatus: ActiveWorkoutHistoryPublicationStatus;
  retryExerciseHistory: () => void;
}

/**
 * Owner feature-local de selección explícita, roving focus y ciclo modal. Mantiene un único
 * origen de datos: los drafts/callbacks productivos recibidos; nunca importa repositories.
 */
export function ActiveWorkoutSheetBoundary({
  day,
  routine,
  exercises,
  activeIndex,
  setActiveIndex,
  drafts,
  latestExercisePerformance,
  latestExercisePerformanceError,
  latestExerciseObservation,
  latestExerciseObservationLoading,
  latestExerciseObservationError,
  latestExerciseObservationDidQuery,
  updateDraft,
  registerExercise,
  saveCompletedTraining,
  saveCompletedTrainingStatus,
  retrySaveCompletedTraining,
  editRoutine,
  routineDays,
  switchDay,
  notice,
  isBusy,
  latestExercisePerformanceStatus,
  retryExerciseHistory,
}: ActiveWorkoutSheetBoundaryProps) {
  const selectedExercise = exercises[activeIndex] ?? exercises[0] ?? null;
  const exerciseIds = useMemo(() => exercises.map((exercise) => exercise.id), [exercises]);
  const scopeKey = useMemo(
    () => createActiveWorkoutSheetScopeKey({ day, routine, exercises }),
    [day, exercises, routine],
  );
  const [sheetState, setSheetState] = useState(createActiveWorkoutSheetState);
  const [rovingExerciseId, setRovingExerciseId] = useState<string | null>(
    () => selectedExercise?.id ?? null,
  );
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusExerciseIdRef = useRef<string | null>(null);

  const openExerciseIndex = sheetState.openExerciseId === null
    ? -1
    : exercises.findIndex((exercise) => exercise.id === sheetState.openExerciseId);
  const openExercise = openExerciseIndex >= 0 ? exercises[openExerciseIndex] : null;
  const canMountSheet = Boolean(
    openExercise &&
    selectedExercise?.id === openExercise.id &&
    sheetState.openScopeKey === scopeKey,
  );
  const activeExercise = canMountSheet ? openExercise : selectedExercise;
  const draft = activeExercise
    ? normalizeExerciseDraft(activeExercise, drafts[activeExercise.id])
    : null;
  const completedCount = exercises.filter((exercise) =>
    isActiveWorkoutRegistrationComplete(exercise, drafts[exercise.id])
  ).length;
  const allRegistrationsComplete = exercises.length > 0 && completedCount === exercises.length;
  const canSaveTraining = canSaveActiveWorkoutDrafts(exercises, drafts);
  const remainingExercises = Math.max(0, exercises.length - completedCount);
  const isDuplicateConflict = notice.includes("Ya existe un entrenamiento");
  const currentRovingExerciseId = rovingExerciseId && exerciseIds.includes(rovingExerciseId)
    ? rovingExerciseId
    : selectedExercise?.id ?? exerciseIds[0] ?? null;

  const performanceStatus = latestExercisePerformanceStatus;
  const performancePresentation = activeExercise
    ? buildExerciseLastPerformancePresentation({
        planned: {
          targetSets: activeExercise.targetSets,
          targetReps: activeExercise.targetReps,
          baseWeight: activeExercise.baseWeight,
        },
        latest: latestExercisePerformance,
        loading: performanceStatus === "loading",
        error: performanceStatus === "error" ? latestExercisePerformanceError : "",
      })
    : null;
  const observationPresentation = buildExerciseLastObservationPresentation({
    observation: latestExerciseObservation,
    loading: latestExerciseObservationLoading,
    error: latestExerciseObservationError,
    hasQueried: latestExerciseObservationDidQuery,
  });

  useEffect(() => {
    setRovingExerciseId((current) => current && exerciseIds.includes(current)
      ? current
      : selectedExercise?.id ?? exerciseIds[0] ?? null);
  }, [exerciseIds, selectedExercise?.id]);

  useEffect(() => {
    const reconciliation = reconcileActiveWorkoutSheet(sheetState, {
      scopeKey,
      exerciseIds,
      selectedExerciseId: selectedExercise?.id ?? null,
    });
    if (!reconciliation.didClose) return;

    pendingFocusExerciseIdRef.current = reconciliation.focusExerciseId;
    if (reconciliation.focusExerciseId) {
      setRovingExerciseId(reconciliation.focusExerciseId);
    }
    setSheetState(reconciliation.state);
  }, [exerciseIds, scopeKey, selectedExercise?.id, sheetState]);

  useEffect(() => {
    if (sheetState.openExerciseId !== null) return;
    const exerciseId = pendingFocusExerciseIdRef.current;
    if (!exerciseId) return;
    if (!exerciseIds.includes(exerciseId)) {
      pendingFocusExerciseIdRef.current = null;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      rowRefs.current.get(exerciseId)?.focus({ preventScroll: true });
      pendingFocusExerciseIdRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exerciseIds, sheetState.openExerciseId]);

  function openExerciseSheet(exercise: ExerciseTemplate, index: number) {
    setRovingExerciseId(exercise.id);
    setActiveIndex(index);
    setSheetState((current) => openActiveWorkoutSheet(current, exercise.id, scopeKey));
  }

  function moveExerciseFocus(event: KeyboardEvent<HTMLButtonElement>, exerciseId: string) {
    const nextExerciseId = resolveActiveWorkoutRovingExerciseId({
      key: event.key,
      currentExerciseId: exerciseId,
      exerciseIds,
    });
    if (!nextExerciseId) return;

    event.preventDefault();
    setRovingExerciseId(nextExerciseId);
    rowRefs.current.get(nextExerciseId)?.focus({ preventScroll: true });
  }

  function closeExerciseSheet() {
    const focusExerciseId = sheetState.openerExerciseId &&
      exerciseIds.includes(sheetState.openerExerciseId)
      ? sheetState.openerExerciseId
      : null;
    pendingFocusExerciseIdRef.current = focusExerciseId;
    if (focusExerciseId) setRovingExerciseId(focusExerciseId);
    setSheetState((current) => closeActiveWorkoutSheet(current));
  }

  function commitExerciseRegistration(action: ActiveWorkoutRegistrationCommit) {
    if (!activeExercise || action.exerciseId !== activeExercise.id) return;
    if (action.mode === "register") registerExercise();
    closeExerciseSheet();
  }

  function updateSelectedExerciseDraft(patch: EditableExerciseDraftPatch) {
    if (!activeExercise) return;
    updateDraft(activeExercise, patch);
  }

  if (!selectedExercise || !activeExercise || !draft || !performancePresentation) {
    return (
      <div className={styles.guidedEmpty}>
        <h2 id="guided-routine-title">No hay ejercicios para {day}</h2>
      </div>
    );
  }

  const registrationComplete = isActiveWorkoutRegistrationComplete(
    activeExercise,
    drafts[activeExercise.id],
  );
  const registrationCommit = createActiveWorkoutRegistrationCommit(activeExercise, draft);
  const isSavingCompletion = saveCompletedTrainingStatus === "saving";
  const finishButtonLabel = isSavingCompletion
    ? "Guardando…"
    : allRegistrationsComplete
      ? "Guardar entrenamiento"
      : remainingExercises === 1
        ? "Falta 1 ejercicio"
        : `Faltan ${remainingExercises} ejercicios`;

  return (
    <>
      <div className={styles.guidedBackground} inert={canMountSheet ? true : undefined}>
        <article className={styles.guidedRoutinePanel}>
          <header className={styles.guidedRoutineHeader}>
            <div>
              <h2 id="guided-routine-title">Rutina registrada {day}</h2>
              <p>{routine}</p>
            </div>

            <div className={styles.guidedRoutineControls}>
              <label className={styles.guidedDaySelector}>
                <span className={styles.srOnly}>Día de entrenamiento</span>
                <select value={day} onChange={(event) => switchDay(event.target.value)}>
                  {routineDays.map((item) => (
                    <option value={item} key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <IconButton
                className={styles.guidedEditRoutine}
                type="button"
                aria-label="Editar rutina semanal"
                onClick={editRoutine}
              >
                <Pencil size={15} aria-hidden="true" />
              </IconButton>
            </div>
          </header>

          {notice && saveCompletedTrainingStatus !== "error" ? (
            <p
              className={styles.guidedNotice}
              data-kind={isDuplicateConflict ? "conflict" : "neutral"}
              role="status"
              aria-live="polite"
            >
              {notice}
            </p>
          ) : null}

          <section className={styles.guidedPlan} aria-labelledby="guided-plan-title">
            <div className={styles.guidedPlanHeading}>
              <h3 id="guided-plan-title">Pauta de entrenamiento registrada</h3>
              <p>Selecciona el ejercicio dentro de la tabla para obtener los detalles</p>
            </div>

            <div
              className={styles.guidedExerciseTable}
              role="listbox"
              aria-label={`Ejercicios de ${routine} para ${day}`}
            >
              <div className={styles.guidedTableHeader} aria-hidden="true">
                <span>Ejercicios</span>
                <span>Series</span>
                <span>Reps</span>
                <span>KG</span>
              </div>
              <div className={styles.guidedExerciseRows}>
                {exercises.map((exercise, index) => {
                  const isSelected = exercise.id === selectedExercise.id;
                  const isComplete = isActiveWorkoutRegistrationComplete(
                    exercise,
                    drafts[exercise.id],
                  );

                  return (
                    <button
                      className={styles.guidedExerciseRow}
                      ref={(node) => {
                        if (node) rowRefs.current.set(exercise.id, node);
                        else rowRefs.current.delete(exercise.id);
                      }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={currentRovingExerciseId === exercise.id ? 0 : -1}
                      aria-label={`${exercise.name}: ${exercise.targetSets} series, ${exercise.targetReps} repeticiones, ${formatKg(exercise.baseWeight)}${isComplete ? ", registrado" : ""}`}
                      data-done={isComplete}
                      data-exercise-id={exercise.id}
                      title={exercise.name}
                      onFocus={() => setRovingExerciseId(exercise.id)}
                      onClick={() => openExerciseSheet(exercise, index)}
                      onKeyDown={(event) => moveExerciseFocus(event, exercise.id)}
                      key={exercise.id}
                    >
                      <span className={styles.guidedExerciseName}>
                        <span className={styles.guidedRowCheck} data-visible={isComplete} aria-hidden="true">✓</span>
                        <span>{exercise.name}</span>
                      </span>
                      <span>{exercise.targetSets}</span>
                      <span>{exercise.targetReps}</span>
                      <span>{formatDecimalEs(exercise.baseWeight)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section
            className={styles.guidedSessionProgress}
            data-complete={allRegistrationsComplete}
            aria-live="polite"
          >
            <div>
              <strong>Avance de la sesión</strong>
              <span>{completedCount} de {exercises.length} ejercicios registrados</span>
            </div>
            <strong>{Math.round((completedCount / exercises.length) * 100)}%</strong>
          </section>
        </article>

        <footer className={styles.guidedSessionFooter}>
          {saveCompletedTrainingStatus === "error" ? (
            <div className={styles.guidedSaveError} role="alert">
              <strong>No se pudo guardar el entrenamiento</strong>
              <span>Tus registros siguen aquí. Vuelve a intentarlo.</span>
            </div>
          ) : null}
          <button
            className={styles.workoutPrimaryButton}
            type="button"
            onClick={saveCompletedTrainingStatus === "error"
              ? retrySaveCompletedTraining
              : saveCompletedTraining}
            disabled={!canSaveTraining || isBusy}
            aria-busy={isSavingCompletion || undefined}
          >
            {isSavingCompletion ? <span className={styles.workoutSpinner} aria-hidden="true" /> : null}
            {saveCompletedTrainingStatus === "error" ? "Reintentar guardado" : finishButtonLabel}
          </button>
        </footer>
      </div>

      {canMountSheet ? (
        <ExerciseRegistrationSheet
          exercise={activeExercise}
          exerciseIndex={openExerciseIndex}
          exerciseCount={exercises.length}
          draft={draft}
          registrationComplete={registrationComplete}
          registrationCommit={registrationCommit}
          isBusy={isBusy}
          performancePresentation={performancePresentation}
          performanceStatus={performanceStatus}
          observationPresentation={observationPresentation}
          retryExerciseHistory={retryExerciseHistory}
          openReferencePanel={sheetState.expandedPanel}
          onToggleReferencePanel={(panel) => {
            setSheetState((current) => toggleActiveWorkoutSheetPanel(current, panel));
          }}
          onWeightChange={(value) => updateSelectedExerciseDraft({
            weight: readWeightInput(value, draft.weight),
          })}
          onRepetitionsChange={(index, value) => {
            const next = [...draft.reps];
            next[index] = readOptionalNumber(value);
            updateSelectedExerciseDraft({ reps: next });
          }}
          observationValue={draft.observation}
          onObservationChange={(value) => updateSelectedExerciseDraft({ observation: value })}
          onCommitRegistration={commitExerciseRegistration}
          onClose={closeExerciseSheet}
        />
      ) : null}
    </>
  );
}
