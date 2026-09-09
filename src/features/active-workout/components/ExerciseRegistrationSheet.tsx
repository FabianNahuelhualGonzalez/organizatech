"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import styles from "@/features/active-workout/active-workout.module.css";
import { ExerciseGoalsCard } from "@/features/active-workout/components/ExerciseGoalsCard";
import { ExerciseLastPerformancePanel } from "@/features/active-workout/components/ExerciseLastPerformancePanel";
import type { AdvancedWorkoutExerciseIntegration } from "@/lib/training/advanced-workout-execution-contract";
import {
  buildActiveWorkoutSheetGoals,
  getActiveWorkoutSeriesColumns,
  type ActiveWorkoutRegistrationCommit,
  type ActiveWorkoutSheetPanel,
} from "@/features/active-workout/model/active-workout-sheet";
import type { ActiveWorkoutHistoryPublicationStatus } from "@/features/active-workout/model/active-workout-history-prefetch-controller";
import { formatDecimalEs } from "@/lib/progress/weight-format";
import type { ExerciseTemplate } from "@/lib/progress/types";
import type { ExerciseLastObservationPresentation } from "@/lib/training/exercise-last-observation-presentation";
import type { ExerciseLastPerformancePresentation } from "@/lib/training/exercise-last-performance-presentation";
import type { ExerciseDraft } from "@/lib/training/training-exercise-draft";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type SeriesGridStyle = CSSProperties & {
  "--active-workout-series-columns": number;
  "--active-workout-series-max-width": string;
};

export interface ExerciseRegistrationSheetProps {
  exercise: ExerciseTemplate;
  exerciseIndex: number;
  exerciseCount: number;
  draft: ExerciseDraft;
  registrationComplete: boolean;
  registrationCommit: ActiveWorkoutRegistrationCommit | null;
  isBusy: boolean;
  performancePresentation: ExerciseLastPerformancePresentation;
  performanceStatus: ActiveWorkoutHistoryPublicationStatus;
  observationPresentation: ExerciseLastObservationPresentation;
  observationValue: string;
  retryExerciseHistory: () => void;
  openReferencePanel: ActiveWorkoutSheetPanel | null;
  onToggleReferencePanel: (panel: ActiveWorkoutSheetPanel) => void;
  onWeightChange: (value: string) => void;
  onRepetitionsChange: (index: number, value: string) => void;
  onObservationChange: (value: string) => void;
  onCommitRegistration: (action: ActiveWorkoutRegistrationCommit) => void;
  onClose: () => void;
  advancedExecution?: AdvancedWorkoutExerciseIntegration;
}

export function ExerciseRegistrationSheet({
  exercise,
  exerciseIndex,
  exerciseCount,
  draft,
  registrationComplete,
  registrationCommit,
  isBusy,
  performancePresentation,
  performanceStatus,
  observationPresentation,
  observationValue,
  retryExerciseHistory,
  openReferencePanel,
  onToggleReferencePanel,
  onWeightChange,
  onRepetitionsChange,
  onObservationChange,
  onCommitRegistration,
  onClose,
  advancedExecution,
}: ExerciseRegistrationSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const weightInputRef = useRef<HTMLInputElement>(null);
  const titleId = `exercise-sheet-title-${exercise.id}`;
  const descriptionId = `exercise-sheet-description-${exercise.id}`;
  const goals = buildActiveWorkoutSheetGoals(exercise, draft);
  const columns = getActiveWorkoutSeriesColumns(exercise.targetSets);
  const hasTwoRows = exercise.targetSets > columns;
  const seriesGridStyle: SeriesGridStyle = {
    "--active-workout-series-columns": columns,
    "--active-workout-series-max-width": `${columns * 76 + Math.max(0, columns - 1) * 5}px`,
  };

  useLayoutEffect(() => {
    weightInputRef.current?.focus({ preventScroll: true });
  }, [exercise.id]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function trapDialogFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const registerLabel = goals.canRegister
    ? draft.registered ? "Actualizar registro" : "Registrar y cerrar"
    : goals.weightError === "missing"
      ? "Anota el peso"
      : goals.weightError === "invalid"
        ? "Corrige el peso"
      : goals.filledSets === 0
        ? "Anota al menos una serie"
        : "Completa las series";

  return (
    <>
      <button
        className={styles.workoutSheetScrim}
        type="button"
        aria-label="Cerrar"
        tabIndex={-1}
        onPointerDown={(event) => event.preventDefault()}
        onClick={onClose}
      />
      <div
        className={styles.workoutSheet}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={trapDialogFocus}
      >
        <div className={styles.workoutSheetGrip} aria-hidden="true"><span /></div>
        <header className={styles.workoutSheetHeader}>
          <div>
            <div className={styles.workoutSheetEyebrow}>
              <span>EJERCICIO {exerciseIndex + 1} DE {exerciseCount}</span>
              {registrationComplete ? <span className={styles.workoutSheetRegistered}>✓ REGISTRADO</span> : null}
            </div>
            <h2 id={titleId} title={exercise.name}>{exercise.name}</h2>
            <p id={descriptionId}>
              Objetivo {exercise.targetSets} × {exercise.targetReps} × {formatDecimalEs(exercise.baseWeight)}kg
            </p>
          </div>
          <button className={styles.workoutSheetClose} type="button" aria-label="Cerrar" onClick={onClose}>
            <span><X size={14} aria-hidden="true" /></span>
          </button>
        </header>

        <div className={styles.workoutSheetBody}>
          {advancedExecution ? (
            advancedExecution.renderRegistrationFields(weightInputRef)
          ) : (
            <div className={styles.workoutCapture} data-rows={hasTwoRows ? "2" : "1"}>
              <label className={styles.workoutWeightField}>
                <span>KG utilizado</span>
                <span className={styles.workoutWeightInput}>
                  <input
                    ref={weightInputRef}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={formatDecimalEs(exercise.baseWeight)}
                    value={draft.weight}
                    onChange={(event) => onWeightChange(event.target.value)}
                  />
                  <span aria-hidden="true">kg</span>
                </span>
              </label>

              <fieldset className={styles.workoutSeriesField}>
                <legend>
                  <span>Repeticiones por serie</span>
                  <span>{goals.filledSets}/{exercise.targetSets}</span>
                </legend>
                <div className={styles.workoutSeriesGrid} style={seriesGridStyle}>
                  {draft.reps.map((repetitions, index) => {
                    const isFilled = repetitions !== "";
                    return (
                      <label className={styles.workoutSeriesInput} data-filled={isFilled} key={index}>
                        <span>S{index + 1}</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          placeholder="–"
                          value={repetitions}
                          aria-label={`Repeticiones de la serie ${index + 1} de ${exercise.targetSets}`}
                          onChange={(event) => onRepetitionsChange(index, event.target.value)}
                        />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}

          <ExerciseGoalsCard goals={goals} />

          <ExerciseLastPerformancePanel
            presentation={performancePresentation}
            historyStatus={performanceStatus}
            exerciseId={exercise.id}
            targetSets={exercise.targetSets}
            observationPresentation={observationPresentation}
            observationValue={observationValue}
            onObservationChange={onObservationChange}
            openPanel={openReferencePanel}
            onTogglePanel={onToggleReferencePanel}
            retryExerciseHistory={retryExerciseHistory}
          />
        </div>

        <footer className={styles.workoutSheetFooter}>
          <button
            className={styles.workoutPrimaryButton}
            type="button"
            disabled={!registrationCommit || isBusy}
            aria-busy={isBusy || undefined}
            onClick={() => {
              if (registrationCommit) onCommitRegistration(registrationCommit);
            }}
          >
            {registerLabel}
          </button>
        </footer>
      </div>
    </>
  );
}
