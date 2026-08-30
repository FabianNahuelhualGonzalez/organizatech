import type { TrainingCyclePlanDayInput } from "../components/training-cycle-builder-contracts";
import type { PersistedTrainingCyclePlan } from "../model/types";
import { isUuid, parseRpcExecution, parseTrainingCycleRpcPlan } from "./training-cycle-rpc-parsers";
import {
  TrainingCycleTransportError,
  type TrainingCycleCanonicalMuscle,
  type TrainingCycleDraftOrigin,
  type TrainingCycleExerciseSource,
  type TrainingCycleRpcExecution,
  type TrainingCycleRpcMuscle,
  type TrainingCycleRpcPlan,
  type TrainingCycleRpcTechnique,
  type TrainingCycleSnapshotPlan,
  type TrainingCycleUiExecution,
  type TrainingCycleUiMuscle,
} from "./training-cycle-rpc-types";

const CONTROL = /[\u0000-\u001f\u007f]/;
const YOUTUBE = /^https:\/\/((www\.|m\.)?youtube\.com\/(watch\?[^\s]*v=[A-Za-z0-9_-]{6,64}[^\s]*|shorts\/[A-Za-z0-9_-]{6,64}[^\s]*|embed\/[A-Za-z0-9_-]{6,64}[^\s]*)|youtu\.be\/[A-Za-z0-9_-]{6,64}[^\s]*)$/;

const MUSCLES = [
  ["Pectoral", "chest", "pectoral"],
  ["Hombros", "shoulders", "hombros"],
  ["Tríceps", "triceps", "triceps"],
  ["Dorsal", "back", "dorsal"],
  ["Bíceps", "biceps", "biceps"],
  ["Trapecio", "trapezius", "trapecio"],
  ["Cuádriceps", "quadriceps", "cuadriceps"],
  ["Femoral", "hamstrings", "femoral"],
  ["Glúteos", "glutes", "gluteos"],
  ["Pantorrillas", "calves", "pantorrillas"],
  ["Pierna completa", "full_leg", "pierna_completa"],
  ["Abdomen", "core", "abdomen"],
] as const satisfies readonly (readonly [TrainingCycleUiMuscle, TrainingCycleCanonicalMuscle, TrainingCycleRpcMuscle])[];

const UI_TO_CANONICAL = new Map(MUSCLES.map(([ui, canonical]) => [ui, canonical]));
const UI_TO_RPC = new Map(MUSCLES.map(([ui, , rpc]) => [ui, rpc]));
const CANONICAL_TO_UI = new Map(MUSCLES.map(([ui, canonical]) => [canonical, ui]));
const CANONICAL_TO_RPC = new Map(MUSCLES.map(([, canonical, rpc]) => [canonical, rpc]));
const RPC_TO_UI = new Map(MUSCLES.map(([ui, , rpc]) => [rpc, ui]));
const RPC_TO_CANONICAL = new Map(MUSCLES.map(([, canonical, rpc]) => [rpc, canonical]));

function invalidInput(message = "Los datos del ciclo no son válidos."): never {
  throw new TrainingCycleTransportError("invalid_input", message);
}

function incompletePlan(message = "Completa la rutina antes de guardarla."): never {
  throw new TrainingCycleTransportError("incomplete_plan", message);
}

function requiredMap<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) invalidInput();
  return value;
}

export function uiMuscleToCanonical(value: TrainingCycleUiMuscle): TrainingCycleCanonicalMuscle {
  return requiredMap(UI_TO_CANONICAL, value);
}

export function uiMuscleToRpc(value: TrainingCycleUiMuscle): TrainingCycleRpcMuscle {
  return requiredMap(UI_TO_RPC, value);
}

export function canonicalMuscleToUi(value: TrainingCycleCanonicalMuscle): TrainingCycleUiMuscle {
  return requiredMap(CANONICAL_TO_UI, value);
}

export function canonicalMuscleToRpc(value: TrainingCycleCanonicalMuscle): TrainingCycleRpcMuscle {
  return requiredMap(CANONICAL_TO_RPC, value);
}

export function rpcMuscleToUi(value: TrainingCycleRpcMuscle): TrainingCycleUiMuscle {
  return requiredMap(RPC_TO_UI, value);
}

export function rpcMuscleToCanonical(value: TrainingCycleRpcMuscle): TrainingCycleCanonicalMuscle {
  return requiredMap(RPC_TO_CANONICAL, value);
}

export function uiTechniqueToRpc(value: TrainingCycleRpcTechnique): TrainingCycleRpcTechnique {
  if (!["linear", "ascending", "descending", "drop_set", "failure"].includes(value)) invalidInput();
  return value;
}

export function rpcTechniqueToUi(value: TrainingCycleRpcTechnique): TrainingCycleRpcTechnique {
  return uiTechniqueToRpc(value);
}

export type TrainingCycleUiOrigin = "duplicate" | "manual" | "suggested" | "resume";
export type TrainingCycleCanonicalOrigin = "manual" | "suggested" | "duplicated";

export function uiOriginToRpc(value: Exclude<TrainingCycleUiOrigin, "resume">): Exclude<TrainingCycleDraftOrigin, "renewal"> {
  if (value === "duplicate") return "duplicate";
  if (value === "manual" || value === "suggested") return value;
  return invalidInput();
}

export function rpcOriginToUi(value: TrainingCycleDraftOrigin): Exclude<TrainingCycleUiOrigin, "resume"> {
  return value === "duplicate" || value === "renewal" ? "duplicate" : value;
}

export function canonicalOriginToRpc(value: TrainingCycleCanonicalOrigin): Exclude<TrainingCycleDraftOrigin, "renewal"> {
  if (value === "duplicated") return "duplicate";
  if (value === "manual" || value === "suggested") return value;
  return invalidInput();
}

export function rpcOriginToCanonical(value: TrainingCycleDraftOrigin): TrainingCycleCanonicalOrigin {
  return value === "duplicate" || value === "renewal" ? "duplicated" : value;
}

export function uiOrderToRpc(value: number, maxUi: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxUi) invalidInput();
  return value - 1;
}

export function rpcOrderToUi(value: number, maxRpc: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maxRpc) invalidInput();
  return value + 1;
}

export function isBackendCompatibleYoutubeUrl(value: string | null): boolean {
  if (value === null) return true;
  return value.length >= 19 && value.length <= 500 && !CONTROL.test(value) && !/\s/.test(value) && YOUTUBE.test(value);
}

function normalizedVideo(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (!isBackendCompatibleYoutubeUrl(normalized)) invalidInput("El enlace de YouTube no es válido.");
  return normalized;
}

function assertUuidSource(source: TrainingCycleExerciseSource): TrainingCycleExerciseSource {
  if (!isUuid(source.id)) invalidInput("El ejercicio no tiene una referencia válida de catálogo.");
  return source;
}

function assertFiniteScale2(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) invalidInput();
  if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    invalidInput("Los kilos admiten un máximo de dos decimales.");
  }
}

function assertPositiveInteger(value: number, max: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) invalidInput();
}

type TrainingCycleBuilderPlanExercise = TrainingCyclePlanDayInput["exercises"][number];

export type TrainingCycleSourceResolver = (
  exercise: TrainingCycleBuilderPlanExercise,
) => TrainingCycleExerciseSource | null;

/**
 * Proyección cerrada desde el contrato visual actual. `resolveSource` es obligatoria porque
 * `catalogId: null` no distingue un custom persistido de un ejercicio aún sólo local.
 */
export function mapBuilderDaysToRpcPlan(
  days: readonly TrainingCyclePlanDayInput[],
  resolveSource: TrainingCycleSourceResolver = (exercise) => exercise.source,
): TrainingCycleRpcPlan {
  if (days.length < 1 || days.length > 7) incompletePlan("Selecciona al menos un día de entrenamiento.");
  let totalExercises = 0;
  let totalSets = 0;
  let totalDrops = 0;
  const seenDays = new Set<string>();

  const rpcDays = days.map((day, dayIndex) => {
    if (seenDays.has(day.day)) invalidInput();
    seenDays.add(day.day);
    const name = day.name.trim();
    if (name.length > 120 || CONTROL.test(name)) invalidInput();
    if (day.exercises.length < 1) incompletePlan("Cada día seleccionado necesita al menos un ejercicio.");
    if (day.exercises.length > 50) invalidInput();

    const exerciseOrders = new Set<number>();
    const exercises = day.exercises.map((exercise) => {
      totalExercises += 1;
      if (totalExercises > 200) invalidInput();
      const order = uiOrderToRpc(exercise.order, 200);
      if (exerciseOrders.has(order)) invalidInput();
      exerciseOrders.add(order);
      const source = resolveSource(exercise);
      if (!source) incompletePlan("Guarda el ejercicio personalizado antes de continuar.");
      assertUuidSource(source);
      if (exercise.sets.length < 1) incompletePlan("Cada ejercicio necesita al menos una serie.");
      if (exercise.sets.length > 20) invalidInput();

      const setOrders = new Set<number>();
      let exerciseDropCount = 0;
      const sets = exercise.sets.map((set) => {
        totalSets += 1;
        if (totalSets > 2_000) invalidInput();
        const setOrder = uiOrderToRpc(set.order, 20);
        if (setOrders.has(setOrder)) invalidInput();
        setOrders.add(setOrder);
        if (set.targetReps === null || set.targetKg === null) incompletePlan();
        assertPositiveInteger(set.targetReps, 1_000);
        assertFiniteScale2(set.targetKg, 0, 99_999.99);
        if (set.drops.length > 8) invalidInput();

        const drops = set.drops.map((drop, dropIndex) => {
          totalDrops += 1;
          exerciseDropCount += 1;
          if (totalDrops > 4_000) invalidInput();
          if (drop.targetReps === null || drop.targetKg === null) incompletePlan();
          assertPositiveInteger(drop.targetReps, 1_000);
          assertFiniteScale2(drop.targetKg, 0, 99_999.99);
          return {
            order: dropIndex,
            kg: drop.targetKg,
            reps: drop.targetReps,
          };
        });

        return {
          order: setOrder,
          targetReps: set.targetReps,
          targetKg: set.targetKg,
          toFailure: set.toFailure,
          drops,
        };
      });

      if (exercise.technique === "drop_set" && exerciseDropCount === 0) {
        incompletePlan("Agrega al menos una descarga para usar Drop set.");
      }
      if (exercise.technique !== "drop_set" && exerciseDropCount > 0) invalidInput();

      const common = {
        order,
        technique: uiTechniqueToRpc(exercise.technique),
        videoUrl: normalizedVideo(exercise.videoUrl),
        sets,
      };
      return source.kind === "catalog"
        ? { ...common, catalogExerciseId: source.id }
        : { ...common, customExerciseId: source.id };
    });

    return { day: day.day, name, order: dayIndex, exercises };
  });

  return parseTrainingCycleRpcPlan({ days: rpcDays });
}

export function isBuilderPlanActivable(
  days: readonly TrainingCyclePlanDayInput[],
  resolveSource?: TrainingCycleSourceResolver,
): boolean {
  try {
    mapBuilderDaysToRpcPlan(days, resolveSource);
    return true;
  } catch (error) {
    if (error instanceof TrainingCycleTransportError) return false;
    throw error;
  }
}

/** Última compuerta antes de cualquier RPC de create/save/edit. */
export function assertRpcPlanActivable(plan: TrainingCycleRpcPlan): TrainingCycleRpcPlan {
  const parsed = parseTrainingCycleRpcPlan(plan);
  if (parsed.days.some((day) => day.exercises.length === 0)) {
    incompletePlan("Cada día seleccionado necesita al menos un ejercicio.");
  }
  return parsed;
}

/** Convierte el plan 1-based del dominio sin redondear ni corregir silenciosamente. */
export function mapDomainPlanToRpcPlan(plan: PersistedTrainingCyclePlan): TrainingCycleRpcPlan {
  const rpc = {
    days: plan.days.map((day) => ({
      day: day.day,
      name: day.name.trim(),
      order: uiOrderToRpc(day.order, 7),
      exercises: day.exercises.map((exercise) => {
        const common = {
          order: uiOrderToRpc(exercise.order, 200),
          technique: uiTechniqueToRpc(exercise.technique),
          videoUrl: normalizedVideo(exercise.videoUrl),
          sets: exercise.sets.map((set) => ({
            order: uiOrderToRpc(set.order, 20),
            targetReps: set.targetReps,
            targetKg: set.targetKg,
            toFailure: set.toFailure,
            drops: set.drops.map((drop) => ({
              order: uiOrderToRpc(drop.order, 8),
              kg: drop.kg,
              reps: drop.reps,
            })),
          })),
        };
        return exercise.catalogExerciseId
          ? { ...common, catalogExerciseId: exercise.catalogExerciseId }
          : { ...common, customExerciseId: exercise.customExerciseId };
      }),
    })),
  };
  return parseTrainingCycleRpcPlan(rpc);
}

export function mapUiExecutionToRpc(value: TrainingCycleUiExecution): TrainingCycleRpcExecution {
  return parseRpcExecution({
    dayId: value.dayId,
    exercises: value.exercises.map((exercise) => ({
      planExerciseId: exercise.planExerciseId,
      order: uiOrderToRpc(exercise.order, 200),
      sets: exercise.sets.map((set) => ({
        planSetId: set.planSetId,
        order: uiOrderToRpc(set.order, 20),
        completed: set.completed,
        reps: set.reps,
        kg: set.kg,
        reachedFailure: set.reachedFailure,
        drops: set.drops.map((drop) => ({
          planDropId: drop.planDropId,
          order: uiOrderToRpc(drop.order, 8),
          completed: drop.completed,
          reps: drop.reps,
          kg: drop.kg,
        })),
      })),
    })),
  });
}

export interface TrainingCycleUiSnapshotPlan {
  readonly days: readonly {
    readonly snapshotId: string;
    readonly day: string;
    readonly name: string;
    readonly order: number;
    readonly exercises: readonly {
      readonly snapshotId: string;
      readonly source: TrainingCycleExerciseSource;
      readonly name: string;
      readonly muscleGroup: TrainingCycleUiMuscle;
      readonly order: number;
      readonly technique: TrainingCycleRpcTechnique;
      readonly videoUrl: string | null;
      readonly sets: readonly {
        readonly snapshotId: string;
        readonly order: number;
        readonly targetReps: number;
        readonly targetKg: number;
        readonly toFailure: boolean;
        readonly drops: readonly {
          readonly snapshotId: string;
          readonly order: number;
          readonly kg: number;
          readonly reps: number;
        }[];
      }[];
    }[];
  }[];
}

export function mapSnapshotPlanToUi(plan: TrainingCycleSnapshotPlan): TrainingCycleUiSnapshotPlan {
  return {
    days: plan.days.map((day) => ({
      snapshotId: day.snapshotId,
      day: day.day,
      name: day.name,
      order: rpcOrderToUi(day.order, 6),
      exercises: day.exercises.map((exercise) => ({
        snapshotId: exercise.snapshotId,
        source: exercise.source,
        name: exercise.name,
        muscleGroup: rpcMuscleToUi(exercise.muscleGroup),
        order: rpcOrderToUi(exercise.order, 199),
        technique: rpcTechniqueToUi(exercise.technique),
        videoUrl: exercise.videoUrl,
        sets: exercise.sets.map((set) => ({
          snapshotId: set.snapshotId,
          order: rpcOrderToUi(set.order, 19),
          targetReps: set.targetReps,
          targetKg: set.targetKg,
          toFailure: set.toFailure,
          drops: set.drops.map((drop) => ({
            snapshotId: drop.snapshotId,
            order: rpcOrderToUi(drop.order, 7),
            kg: drop.kg,
            reps: drop.reps,
          })),
        })),
      })),
    })),
  };
}
