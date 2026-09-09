import { volumeUnitProduct, volumeUnitsToKg } from "./numbers";
import type { ExerciseDraft, TrainingCycleDraft } from "./types";

export type ProgrammedVolumeStatus = "complete" | "partial" | "invalid";

export interface ProgrammedVolumeMetrics {
  /** Volumen cuantificable. Si `status` es partial, no representa el volumen corporal omitido. */
  readonly knownKg: number;
  readonly mainSetsKg: number;
  readonly dropsKg: number;
  readonly externalLoadKg: number;
  readonly bodyweightKg: number;
  readonly status: ProgrammedVolumeStatus;
  readonly unquantifiedBodyweightReps: number;
  readonly invalidValueCount: number;
}

export interface ProgrammedCycleMetrics {
  readonly exerciseCount: number;
  /** Cuenta series principales; los descensos no son series independientes. */
  readonly setCount: number;
  /** Incluye repeticiones de descensos de drop set. */
  readonly repCount: number;
  readonly dropCount: number;
  readonly volume: ProgrammedVolumeMetrics;
}

export interface ProgrammedMetricsOptions {
  /** Peso efectivo del usuario; sólo se usa para ejercicios `loadBasis: bodyweight`. */
  readonly bodyWeightKg?: number;
}

export function calculateProgrammedCycleMetrics(
  draft: TrainingCycleDraft,
  options: ProgrammedMetricsOptions = {},
): ProgrammedCycleMetrics {
  let exerciseCount = 0;
  let setCount = 0;
  let repCount = 0;
  let dropCount = 0;
  let mainUnits = 0;
  let dropUnits = 0;
  let externalUnits = 0;
  let bodyweightUnits = 0;
  let unquantifiedBodyweightReps = 0;
  let invalidValueCount = 0;
  const validBodyWeight = Number.isFinite(options.bodyWeightKg)
    && (options.bodyWeightKg ?? 0) > 0
    ? options.bodyWeightKg as number
    : null;

  for (const day of draft.selectedDays) {
    const routine = draft.routines[day];
    for (const exercise of routine?.exercises ?? []) {
      exerciseCount += 1;
      for (const set of exercise.sets) {
        setCount += 1;
        if (!isValidRepCount(set.targetReps) || !isValidLoad(set.targetKg)) {
          invalidValueCount += 1;
        } else {
          repCount += set.targetReps;
          const volume = calculateLoadVolume(exercise, set.targetKg, set.targetReps, validBodyWeight);
          mainUnits += volume.totalUnits;
          externalUnits += volume.externalUnits;
          bodyweightUnits += volume.bodyweightUnits;
          unquantifiedBodyweightReps += volume.unquantifiedBodyweightReps;
        }
        for (const drop of set.drops) {
          dropCount += 1;
          if (!isValidRepCount(drop.reps) || !isValidLoad(drop.kg)) {
            invalidValueCount += 1;
            continue;
          }
          repCount += drop.reps;
          const volume = calculateLoadVolume(exercise, drop.kg, drop.reps, validBodyWeight);
          dropUnits += volume.totalUnits;
          externalUnits += volume.externalUnits;
          bodyweightUnits += volume.bodyweightUnits;
          unquantifiedBodyweightReps += volume.unquantifiedBodyweightReps;
        }
      }
    }
  }

  const status: ProgrammedVolumeStatus = invalidValueCount > 0
    ? "invalid"
    : unquantifiedBodyweightReps > 0 ? "partial" : "complete";
  return {
    exerciseCount,
    setCount,
    repCount,
    dropCount,
    volume: {
      knownKg: volumeUnitsToKg(mainUnits + dropUnits),
      mainSetsKg: volumeUnitsToKg(mainUnits),
      dropsKg: volumeUnitsToKg(dropUnits),
      externalLoadKg: volumeUnitsToKg(externalUnits),
      bodyweightKg: volumeUnitsToKg(bodyweightUnits),
      status,
      unquantifiedBodyweightReps,
      invalidValueCount,
    },
  };
}

function calculateLoadVolume(
  exercise: ExerciseDraft,
  externalKg: number,
  reps: number,
  bodyWeightKg: number | null,
) {
  const externalUnits = volumeUnitProduct(externalKg, reps);
  if (exercise.loadBasis !== "bodyweight") {
    return { totalUnits: externalUnits, externalUnits, bodyweightUnits: 0, unquantifiedBodyweightReps: 0 };
  }
  if (bodyWeightKg === null) {
    return {
      totalUnits: externalUnits,
      externalUnits,
      bodyweightUnits: 0,
      unquantifiedBodyweightReps: reps,
    };
  }
  const bodyweightUnits = volumeUnitProduct(bodyWeightKg, reps);
  return {
    totalUnits: externalUnits + bodyweightUnits,
    externalUnits,
    bodyweightUnits,
    unquantifiedBodyweightReps: 0,
  };
}

function isValidRepCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isValidLoad(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
