import {
  NEUTRAL_MISSING_VALUE_LABEL,
  type CycleHistoryDetailViewModel,
} from "@/lib/training/cycle-history/cycle-history-view-model";

import styles from "./cycle-history.module.css";

export function CycleHistoryRoutineBreakdown({ detail }: { detail: CycleHistoryDetailViewModel }) {
  if (detail.routines.length === 0) {
    return <p className={styles.breakdownEmpty}>Este ciclo no tiene rutinas planificadas.</p>;
  }

  return (
    <div className={styles.breakdown}>
      {detail.routines.map((routine) => (
        <section className={styles.routineBlock} key={routine.key} aria-label={`Rutina ${routine.name}`}>
          <h2 className={styles.routineName}>{routine.name}</h2>
          {routine.exercises.length === 0 ? (
            <p className={styles.breakdownEmpty}>Esta rutina no tiene ejercicios planificados.</p>
          ) : (
            <div className={styles.exerciseList}>
              {routine.exercises.map((exercise) => (
                <article className={styles.exerciseBlock} key={exercise.key}>
                  <div className={styles.exerciseHeading}>
                    <h3 className={styles.exerciseName}>{exercise.name}</h3>
                    <span className={styles.exercisePlan}>
                      {exercise.planLabel ?? NEUTRAL_MISSING_VALUE_LABEL}
                    </span>
                  </div>
                  {exercise.weeks.length === 0 ? (
                    <p className={styles.breakdownEmpty}>Sin registros para este ejercicio.</p>
                  ) : (
                    <div className={styles.weekTableWrapper}>
                      <table className={styles.weekTable}>
                        <caption className={styles.visuallyHidden}>
                          Registros semanales de {exercise.name}
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Semana</th>
                            <th scope="col">Detalle</th>
                            <th scope="col">Total reps</th>
                            <th scope="col">Volumen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {exercise.weeks.map((week) => (
                            <tr key={week.week}>
                              <th scope="row">{week.weekLabel}</th>
                              <td>
                                {week.series.map((series, index) => (
                                  <div key={index}>
                                    {series.weightLabel} · {series.repsLabel}
                                  </div>
                                ))}
                              </td>
                              <td>{week.totalRepsLabel}</td>
                              <td>{week.volumeLabel}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
