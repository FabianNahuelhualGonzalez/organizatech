import type { Ref } from "react";

import styles from "@/features/training-cycle-builder/active-workout/components/training-cycle-execution.module.css";
import type {
  ResolvedAdvancedWorkoutExercise,
  TrainingCycleExecutionDropPatch,
  TrainingCycleExecutionExerciseDraft,
  TrainingCycleExecutionSetPatch,
} from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";
import { formatDecimalEs } from "@/lib/progress/weight-format";

export interface AdvancedExerciseExecutionFieldsProps {
  readonly resolved: ResolvedAdvancedWorkoutExercise;
  readonly draft: TrainingCycleExecutionExerciseDraft;
  readonly initialControlRef: Ref<HTMLInputElement>;
  readonly onSetChange: (
    planSetId: string,
    patch: TrainingCycleExecutionSetPatch,
  ) => void;
  readonly onDropChange: (
    planSetId: string,
    planDropId: string,
    patch: TrainingCycleExecutionDropPatch,
  ) => void;
}

export function AdvancedExerciseExecutionFields({
  resolved,
  draft,
  initialControlRef,
  onSetChange,
  onDropChange,
}: AdvancedExerciseExecutionFieldsProps) {
  const draftBySetId = new Map(draft.sets.map((set) => [set.planSetId, set]));

  return (
    <div className={styles.execution} data-technique={resolved.plan.technique}>
      {resolved.plan.safeVideoUrl ? (
        <a
          className={styles.videoLink}
          href={resolved.plan.safeVideoUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver video
        </a>
      ) : null}

      {resolved.plan.sets.map((setPlan, setIndex) => {
        const set = draftBySetId.get(setPlan.snapshotId);
        if (!set) return null;
        const draftByDropId = new Map(set.drops.map((drop) => [drop.planDropId, drop]));

        return (
          <fieldset className={styles.setCard} key={setPlan.snapshotId}>
            <legend>Serie {setIndex + 1}</legend>
            <div className={styles.setHeader}>
              <span className={styles.target}>
                {setPlan.targetReps} reps · {formatDecimalEs(setPlan.targetKg)} kg
              </span>
              <label className={styles.completedControl}>
                <input
                  ref={setIndex === 0 ? initialControlRef : undefined}
                  type="checkbox"
                  checked={set.completed}
                  onChange={(event) => onSetChange(set.planSetId, {
                    completed: event.target.checked,
                  })}
                />
                Completada
              </label>
            </div>

            <div className={styles.values}>
              <label className={styles.valueField}>
                Repeticiones
                <input
                  type="number"
                  min={0}
                  max={1_000}
                  step={1}
                  inputMode="numeric"
                  value={set.reps}
                  aria-label={`Repeticiones de la serie ${setIndex + 1}`}
                  onChange={(event) => onSetChange(set.planSetId, { reps: event.target.value })}
                />
              </label>
              <label className={styles.valueField}>
                KG
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={set.kg}
                  aria-label={`KG de la serie ${setIndex + 1}`}
                  onChange={(event) => onSetChange(set.planSetId, { kg: event.target.value })}
                />
              </label>
            </div>

            <div className={styles.setOptions}>
              <label className={styles.failureControl}>
                <input
                  type="checkbox"
                  checked={set.reachedFailure}
                  disabled={!set.completed}
                  onChange={(event) => onSetChange(set.planSetId, {
                    reachedFailure: event.target.checked,
                  })}
                />
                Fallo
              </label>
              {setPlan.toFailure ? <span className={styles.target}>Fallo planificado</span> : null}
            </div>

            {setPlan.drops.length > 0 ? (
              <div className={styles.drops}>
                {setPlan.drops.map((dropPlan, dropIndex) => {
                  const drop = draftByDropId.get(dropPlan.snapshotId);
                  if (!drop) return null;
                  return (
                    <div className={styles.dropRow} key={dropPlan.snapshotId}>
                      <div className={styles.dropHeader}>
                        <strong>Drop {dropIndex + 1}</strong>
                        <span className={styles.target}>
                          {dropPlan.targetReps} reps · {formatDecimalEs(dropPlan.targetKg)} kg
                        </span>
                        <label className={styles.completedControl}>
                          <input
                            type="checkbox"
                            checked={drop.completed}
                            disabled={!set.completed}
                            onChange={(event) => onDropChange(
                              set.planSetId,
                              drop.planDropId,
                              { completed: event.target.checked },
                            )}
                          />
                          Completado
                        </label>
                      </div>
                      <div className={styles.values}>
                        <label className={styles.valueField}>
                          Repeticiones
                          <input
                            type="number"
                            min={0}
                            max={1_000}
                            step={1}
                            inputMode="numeric"
                            value={drop.reps}
                            aria-label={`Repeticiones del drop ${dropIndex + 1} de la serie ${setIndex + 1}`}
                            onChange={(event) => onDropChange(
                              set.planSetId,
                              drop.planDropId,
                              { reps: event.target.value },
                            )}
                          />
                        </label>
                        <label className={styles.valueField}>
                          KG
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={drop.kg}
                            aria-label={`KG del drop ${dropIndex + 1} de la serie ${setIndex + 1}`}
                            onChange={(event) => onDropChange(
                              set.planSetId,
                              drop.planDropId,
                              { kg: event.target.value },
                            )}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}
