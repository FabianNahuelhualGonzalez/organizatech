import type { ExerciseTemplate } from "@/lib/progress/types";
import { formatDecimalEs } from "@/lib/progress/weight-format";
import { dedupeExercisesByDayAndRoutine } from "@/lib/training/training-exercise-selection";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import type {
  SetupDayState,
  SetupExerciseRow,
} from "@/lib/training/training-routine-draft";

export interface RoutineBuilderSetupDaySeed {
  readonly routineName: string;
  readonly rows: readonly SetupExerciseRow[];
}

export interface CreateSetupByDayFromExercisesInput {
  readonly exercises: readonly ExerciseTemplate[];
  /**
   * Estado base con los IDs de filas vacías ya asignados por el caller.
   * El mapper lo clona y nunca genera IDs por su cuenta.
   */
  readonly initialSetupByDay: Readonly<Record<string, RoutineBuilderSetupDaySeed>>;
}

/**
 * Reconstruye el borrador editable desde ejercicios productivos con la misma
 * semántica del adapter actual del root. Lineage ya viene resuelto en cada
 * ExerciseTemplate por su frontera legacy o cycle-scoped y aquí solo se preserva.
 */
export function createSetupByDayFromExercises({
  exercises,
  initialSetupByDay,
}: CreateSetupByDayFromExercisesInput): Record<string, SetupDayState> {
  const byDay = cloneSetupByDay(initialSetupByDay);

  for (const exercise of dedupeExercisesByDayAndRoutine([...exercises])) {
    const day = resolveSetupDay(exercise.day);
    const current = byDay[day];
    const isEmpty = current.rows.every((row) => !row.name.trim());

    byDay[day] = {
      routineName: current.routineName || exercise.routine || day,
      rows: [
        ...(isEmpty ? [] : current.rows),
        {
          id: exercise.id,
          sourceExerciseId: exercise.id,
          exerciseLineageId: exercise.exerciseLineageId,
          name: exercise.name,
          sets: exercise.targetSets,
          reps: exercise.targetReps,
          weight: formatDecimalEs(exercise.baseWeight),
        },
      ],
    };
  }

  return byDay;
}

function cloneSetupByDay(
  setupByDay: Readonly<Record<string, RoutineBuilderSetupDaySeed>>,
): Record<string, SetupDayState> {
  return Object.fromEntries(
    Object.entries(setupByDay).map(([day, state]) => [
      day,
      {
        routineName: state.routineName,
        rows: state.rows.map((row) => ({ ...row })),
      },
    ]),
  );
}

function resolveSetupDay(day: string | undefined) {
  return day && TRAINING_DAY_LABELS.some((label) => label === day)
    ? day
    : "Lunes";
}
