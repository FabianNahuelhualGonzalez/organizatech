import type { ExerciseTemplate } from "@/lib/progress/types";
import { formatDecimalEs } from "@/lib/progress/weight-format";
import { dedupeExercisesByDayAndRoutine } from "@/lib/training/training-exercise-selection";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import type {
  SetupDayState,
  SetupExerciseRow,
} from "@/lib/training/training-routine-draft";

type TrainingDayLabel = (typeof TRAINING_DAY_LABELS)[number];

export interface RoutineBuilderSetupDaySeed {
  readonly routineName: string;
  readonly rows: readonly SetupExerciseRow[];
}

export interface RoutineBuilderExercisePlacementInput {
  readonly exercise: ExerciseTemplate;
  readonly visualRowId?: string | null;
}

export type RoutineBuilderUnknownDayPolicy = "fallback_to_monday" | "reject";
export type RoutineBuilderExistingRowsPolicy = "reject_non_empty" | "append";

export interface CreateSetupByDayFromExercisesInput {
  readonly placements: readonly RoutineBuilderExercisePlacementInput[];
  readonly initialSetupByDay: Readonly<Record<TrainingDayLabel, RoutineBuilderSetupDaySeed>>;
  readonly unknownDayPolicy: RoutineBuilderUnknownDayPolicy;
  readonly existingRowsPolicy: RoutineBuilderExistingRowsPolicy;
}

export type RoutineBuilderVisualRowLocation =
  | {
    readonly source: "placement";
    readonly placementIndex: number;
    readonly exerciseId: string;
  }
  | {
    readonly source: "seed";
    readonly day: TrainingDayLabel;
    readonly rowIndex: number;
  };

export interface RoutineBuilderUnknownDayPlacement {
  readonly placementIndex: number;
  readonly exerciseId: string;
  readonly day: string | undefined;
}

export type RoutineBuilderExerciseMappingResult =
  | {
    readonly kind: "ready";
    readonly setupByDay: Record<string, SetupDayState>;
  }
  | {
    readonly kind: "blocked";
    readonly reason: "missing_visual_row_id";
    readonly location: RoutineBuilderVisualRowLocation;
  }
  | {
    readonly kind: "blocked";
    readonly reason: "duplicate_visual_row_id";
    readonly visualRowId: string;
    readonly locations: readonly [RoutineBuilderVisualRowLocation, RoutineBuilderVisualRowLocation];
  }
  | {
    readonly kind: "blocked";
    readonly reason: "unknown_day";
    readonly placements: readonly RoutineBuilderUnknownDayPlacement[];
  }
  | {
    readonly kind: "blocked";
    readonly reason: "non_empty_seed";
    readonly days: readonly TrainingDayLabel[];
  };

interface PreparedPlacement {
  readonly exercise: ExerciseTemplate;
  readonly visualRowId: string;
  readonly placementIndex: number;
  readonly day: TrainingDayLabel;
}

interface IndexedPlacement extends RoutineBuilderExercisePlacementInput {
  readonly placementIndex: number;
}

interface PreparedRow {
  readonly row: SetupExerciseRow;
  readonly location: RoutineBuilderVisualRowLocation;
}

interface PreparedDay {
  readonly day: TrainingDayLabel;
  readonly routineName: string;
  readonly rows: readonly PreparedRow[];
}

/**
 * Reconstruye el borrador editable sin generar identidad. El caller asigna un
 * visualRowId por placement y el mapper conserva exercise.id solo como
 * sourceExerciseId. El dedupe canonico define primero los placements efectivos:
 * solo esos ganadores pueden bloquear por su ID o dia. La identidad completa
 * del seed y sus colisiones se validan despues de armar el resultado. Un estado
 * blocked nunca incluye un setupByDay parcial. Las politicas de dias desconocidos
 * y seed existente son obligatorias para evitar fallbacks implicitos.
 */
export function createSetupByDayFromExercises({
  placements,
  initialSetupByDay,
  unknownDayPolicy,
  existingRowsPolicy,
}: CreateSetupByDayFromExercisesInput): RoutineBuilderExerciseMappingResult {
  const winningPlacements = dedupePlacements(placements);
  const preparedPlacements: PreparedPlacement[] = [];
  const unknownDayPlacements: RoutineBuilderUnknownDayPlacement[] = [];

  for (const placement of winningPlacements) {
    const location: RoutineBuilderVisualRowLocation = {
      source: "placement",
      placementIndex: placement.placementIndex,
      exerciseId: placement.exercise.id,
    };
    if (!isNonEmptyVisualRowId(placement.visualRowId)) {
      return { kind: "blocked", reason: "missing_visual_row_id", location };
    }

    const canonicalDay = readCanonicalDay(placement.exercise.day);
    if (!canonicalDay) {
      unknownDayPlacements.push({
        placementIndex: placement.placementIndex,
        exerciseId: placement.exercise.id,
        day: placement.exercise.day,
      });
    }
    preparedPlacements.push({
      exercise: placement.exercise,
      visualRowId: placement.visualRowId,
      placementIndex: placement.placementIndex,
      day: canonicalDay ?? "Lunes",
    });
  }

  if (unknownDayPolicy === "reject" && unknownDayPlacements.length > 0) {
    return { kind: "blocked", reason: "unknown_day", placements: unknownDayPlacements };
  }

  const nonEmptySeedDays = TRAINING_DAY_LABELS.filter((day) => (
    initialSetupByDay[day].rows.some((row) => row.name.trim().length > 0)
  ));
  if (existingRowsPolicy === "reject_non_empty" && nonEmptySeedDays.length > 0) {
    return { kind: "blocked", reason: "non_empty_seed", days: nonEmptySeedDays };
  }

  const placementsByDay = groupPlacementsByDay(preparedPlacements);
  const preparedDays = TRAINING_DAY_LABELS.map((day) => prepareDay(
    day,
    initialSetupByDay[day],
    placementsByDay.get(day) ?? [],
  ));
  const identityBlock = validatePreparedRowIdentity(preparedDays);
  if (identityBlock) return identityBlock;

  return {
    kind: "ready",
    setupByDay: Object.fromEntries(preparedDays.map((preparedDay) => [
      preparedDay.day,
      {
        routineName: preparedDay.routineName,
        rows: preparedDay.rows.map(({ row }) => ({ ...row })),
      },
    ])),
  };
}

function isNonEmptyVisualRowId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readCanonicalDay(day: string | undefined): TrainingDayLabel | null {
  return TRAINING_DAY_LABELS.find((label) => label === day) ?? null;
}

function dedupePlacements(
  placements: readonly RoutineBuilderExercisePlacementInput[],
): IndexedPlacement[] {
  const indexedPlacements = placements.map((placement, placementIndex) => ({
    ...placement,
    placementIndex,
  }));
  const exerciseCopies = indexedPlacements.map((placement) => ({ ...placement.exercise }));
  const placementByExerciseCopy = new Map(
    exerciseCopies.map((exercise, index) => [exercise, indexedPlacements[index]]),
  );
  return dedupeExercisesByDayAndRoutine(exerciseCopies)
    .map((exercise) => placementByExerciseCopy.get(exercise) as IndexedPlacement);
}

function groupPlacementsByDay(placements: readonly PreparedPlacement[]) {
  const byDay = new Map<TrainingDayLabel, PreparedPlacement[]>();
  for (const placement of placements) {
    const dayPlacements = byDay.get(placement.day) ?? [];
    dayPlacements.push(placement);
    byDay.set(placement.day, dayPlacements);
  }
  return byDay;
}

function prepareDay(
  day: TrainingDayLabel,
  seed: RoutineBuilderSetupDaySeed,
  placements: readonly PreparedPlacement[],
): PreparedDay {
  const seedIsPlaceholder = seed.rows.every((row) => !row.name.trim());
  const retainedSeedRows = placements.length > 0 && seedIsPlaceholder ? [] : seed.rows;
  const mappedRoutineName = placements.find(({ exercise }) => Boolean(exercise.routine))
    ?.exercise.routine;
  const routineName = placements.length > 0
    ? seed.routineName || mappedRoutineName || day
    : seed.routineName;
  const rows: PreparedRow[] = [
    ...retainedSeedRows.map((row, rowIndex) => ({
      row: { ...row },
      location: { source: "seed", day, rowIndex } as const,
    })),
    ...placements.map((placement) => ({
      row: {
        id: placement.visualRowId,
        sourceExerciseId: placement.exercise.id,
        exerciseLineageId: placement.exercise.exerciseLineageId,
        name: placement.exercise.name,
        sets: placement.exercise.targetSets,
        reps: placement.exercise.targetReps,
        weight: formatDecimalEs(placement.exercise.baseWeight),
      },
      location: {
        source: "placement",
        placementIndex: placement.placementIndex,
        exerciseId: placement.exercise.id,
      } as const,
    })),
  ];

  return { day, routineName, rows };
}

function validatePreparedRowIdentity(
  days: readonly PreparedDay[],
): Extract<RoutineBuilderExerciseMappingResult, { kind: "blocked" }> | null {
  const seen = new Map<string, RoutineBuilderVisualRowLocation>();
  for (const day of days) {
    for (const preparedRow of day.rows) {
      if (!isNonEmptyVisualRowId(preparedRow.row.id)) {
        return {
          kind: "blocked",
          reason: "missing_visual_row_id",
          location: preparedRow.location,
        };
      }
      const existingLocation = seen.get(preparedRow.row.id);
      if (existingLocation) {
        return {
          kind: "blocked",
          reason: "duplicate_visual_row_id",
          visualRowId: preparedRow.row.id,
          locations: [existingLocation, preparedRow.location],
        };
      }
      seen.set(preparedRow.row.id, preparedRow.location);
    }
  }
  return null;
}
