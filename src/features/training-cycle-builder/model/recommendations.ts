import {
  addCalendarDays,
  compareISOCalendarDates,
  isISOCalendarDate,
} from "./dates";
import { clampNumber, roundDecimal, roundToIncrement } from "./numbers";
import {
  isTrainingGoal,
  type ExerciseDraft,
  type LoadBasis,
  type TrainingGoal,
} from "./types";

export interface ExerciseHistoryObservation {
  readonly sessionId: string;
  readonly performedOn: string;
  readonly loadKg: number;
  readonly completedReps: number;
  readonly toFailure: boolean;
}

export interface LoadRecommendationPolicy {
  readonly windowDays: number;
  readonly minimumSessions: number;
  readonly minimumSamples: number;
  readonly mediumConfidenceSessions: number;
  readonly mediumConfidenceSamples: number;
  readonly highConfidenceSessions: number;
  readonly highConfidenceSamples: number;
  readonly maxObservedReps: number;
  readonly maxObservedLoadKg: number;
  readonly maxTargetReps: number;
  readonly maxEstimatedReps: number;
  readonly maxSuggestedLoadKg: number;
  readonly conservativePercentile: number;
  readonly safetyFactor: number;
  readonly loadIncrementKg: number;
  readonly repRangeUncertainty: number;
  /** Tope de aumento frente a una carga planificada positiva. */
  readonly maxIncreaseFractionFromPlanned: number;
}

export const DEFAULT_LOAD_RECOMMENDATION_POLICY: LoadRecommendationPolicy = Object.freeze({
  windowDays: 21,
  minimumSessions: 2,
  minimumSamples: 3,
  mediumConfidenceSessions: 3,
  mediumConfidenceSamples: 6,
  highConfidenceSessions: 5,
  highConfidenceSamples: 10,
  maxObservedReps: 15,
  maxObservedLoadKg: 5_000,
  maxTargetReps: 15,
  maxEstimatedReps: 30,
  maxSuggestedLoadKg: 5_000,
  conservativePercentile: 0.25,
  safetyFactor: 0.95,
  loadIncrementKg: 0.5,
  repRangeUncertainty: 2,
  maxIncreaseFractionFromPlanned: 0.05,
});

export interface LoadRecommendationInput {
  /** Captura la identidad y todas las series para que la recomendación no pueda reutilizarse en otro ejercicio. */
  readonly exercise: ExerciseDraft;
  readonly goal: TrainingGoal;
  readonly asOfDate: string;
  readonly history: readonly ExerciseHistoryObservation[];
  readonly policy?: LoadRecommendationPolicy;
}

export type RecommendationConfidence = "none" | "low" | "medium" | "high";

export interface EstimatedRepRange {
  readonly min: number;
  readonly max: number;
  readonly qualifier: "estimate_not_guarantee";
}

export interface RecommendationSourceSummary {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly windowDays: number;
  readonly sampleCount: number;
  readonly sessionCount: number;
  readonly excludedSampleCount: number;
}

export interface RecommendationSetBinding {
  readonly setId: string;
  readonly sourceSetId: string | null;
  readonly order: number;
  readonly targetReps: number;
  readonly plannedLoadKg: number;
  readonly toFailure: boolean;
}

export interface ExerciseRecommendationBinding {
  readonly exerciseId: string;
  readonly sourceExerciseId: string | null;
  readonly exerciseLineageId: string;
  readonly loadBasis: LoadBasis;
  readonly sets: readonly RecommendationSetBinding[];
}

export interface SetLoadRecommendation {
  readonly setId: string;
  readonly sourceSetId: string | null;
  readonly order: number;
  readonly targetReps: number;
  readonly plannedLoadKg: number;
  readonly suggestedLoadKg: number;
  readonly increaseLimitApplied: boolean;
  readonly estimatedRepsAtSuggestedLoad: EstimatedRepRange;
  readonly estimatedRepsAtPlannedLoad: EstimatedRepRange | null;
  readonly explanation: readonly string[];
}

interface RecommendationShared {
  readonly autoApply: false;
  readonly requiresUserConfirmation: true;
  readonly confidence: RecommendationConfidence;
  readonly source: RecommendationSourceSummary;
  readonly targetRepRange: Readonly<{ min: number; max: number }>;
  readonly explanation: readonly string[];
}

export type LoadRecommendation =
  | (RecommendationShared & {
    readonly available: false;
    readonly reason: "invalid_input" | "unsupported_bodyweight" | "insufficient_history";
    readonly recommendationId: null;
    readonly binding: null;
    readonly setRecommendations: readonly [];
  })
  | (RecommendationShared & {
    readonly available: true;
    readonly reason: null;
    readonly recommendationId: string;
    readonly binding: ExerciseRecommendationBinding;
    readonly setRecommendations: readonly SetLoadRecommendation[];
    readonly model: Readonly<{
      id: "epley_conservative_per_set_v2";
      conservativeEstimatedOneRepMaxKg: number;
      percentile: number;
      safetyFactor: number;
      maxIncreaseFractionFromPlanned: number;
    }>;
  });

const REP_RANGES: Readonly<Record<TrainingGoal, Readonly<{ min: number; max: number }>>> = Object.freeze({
  strength: { min: 3, max: 6 },
  volume: { min: 8, max: 12 },
  definition: { min: 10, max: 15 },
  deload: { min: 6, max: 10 },
});

/**
 * Estima una carga y rangos de repeticiones para cada serie configurada. Nunca promete una
 * cantidad exacta y nunca muta ni aplica automáticamente la recomendación.
 */
export function recommendLoadFromRecentHistory(input: LoadRecommendationInput): LoadRecommendation {
  const policy = input.policy ?? DEFAULT_LOAD_RECOMMENDATION_POLICY;
  const validPolicy = isValidPolicy(policy);
  const validGoal = isTrainingGoal(input.goal);
  const targetRepRange = validGoal ? REP_RANGES[input.goal] : REP_RANGES.deload;
  const safeWindowDays = Number.isSafeInteger(policy.windowDays) && policy.windowDays > 0
    ? policy.windowDays
    : 0;
  const emptySource = sourceSummary(
    input.asOfDate,
    input.asOfDate,
    safeWindowDays,
    0,
    0,
    input.history.length,
  );
  const binding = validPolicy ? createExerciseBinding(input.exercise, policy) : null;
  if (!isISOCalendarDate(input.asOfDate) || !validGoal || !validPolicy || binding === null) {
    return unavailable(
      "invalid_input",
      "No se pudo evaluar el historial porque el ejercicio, sus series o la política no son válidos.",
      targetRepRange,
      emptySource,
    );
  }

  const windowStart = addCalendarDays(input.asOfDate, -(policy.windowDays - 1));
  if (binding.loadBasis === "bodyweight") {
    return unavailable(
      "unsupported_bodyweight",
      "No sugerimos una carga para peso corporal sin una medición efectiva comparable.",
      targetRepRange,
      sourceSummary(windowStart, input.asOfDate, policy.windowDays, 0, 0, input.history.length),
    );
  }

  const valid = input.history.filter((observation) => isUsableObservation(
    observation,
    windowStart,
    input.asOfDate,
    policy,
  ));
  const sessions = new Set(valid.map((observation) => observation.sessionId.trim()));
  const source = sourceSummary(
    windowStart,
    input.asOfDate,
    policy.windowDays,
    valid.length,
    sessions.size,
    input.history.length - valid.length,
  );
  if (valid.length < policy.minimumSamples || sessions.size < policy.minimumSessions) {
    return unavailable(
      "insufficient_history",
      `Hay ${sessions.size} sesiones y ${valid.length} series comparables; la política requiere al menos ${policy.minimumSessions} sesiones y ${policy.minimumSamples} series.`,
      targetRepRange,
      source,
    );
  }

  const estimates = valid
    .map((observation) => observation.loadKg * (1 + observation.completedReps / 30))
    .sort((left, right) => left - right);
  const percentileValue = percentile(estimates, policy.conservativePercentile);
  const conservativeOneRepMax = percentileValue * policy.safetyFactor;
  const setRecommendations = binding.sets.map((set) => recommendSetLoad(
    set,
    conservativeOneRepMax,
    policy,
  ));
  const confidence = calculateConfidence(valid, sessions.size, estimates, policy);
  const recommendationId = createRecommendationId(
    binding,
    input.asOfDate,
    input.goal,
    valid.length,
    sessions.size,
    conservativeOneRepMax,
  );

  return {
    available: true,
    reason: null,
    recommendationId,
    binding,
    setRecommendations,
    autoApply: false,
    requiresUserConfirmation: true,
    confidence,
    source,
    targetRepRange,
    explanation: [
      `Se usaron ${valid.length} series de ${sessions.size} sesiones dentro de los últimos ${policy.windowDays} días.`,
      `Se tomó el percentil ${Math.round(policy.conservativePercentile * 100)} de las estimaciones y se aplicó un margen conservador de ${Math.round((1 - policy.safetyFactor) * 100)}%.`,
      `Cada serie se calculó según sus repeticiones objetivo y se redondeó hacia abajo al incremento de ${policy.loadIncrementKg} kg.`,
      `Un aumento sobre una carga ya planificada se limita a ${Math.round(policy.maxIncreaseFractionFromPlanned * 100)}%.`,
      "Todos los rangos de repeticiones son estimaciones, no garantías; cada carga requiere aceptación explícita.",
    ],
    model: {
      id: "epley_conservative_per_set_v2",
      conservativeEstimatedOneRepMaxKg: roundDecimal(conservativeOneRepMax, 2),
      percentile: policy.conservativePercentile,
      safetyFactor: policy.safetyFactor,
      maxIncreaseFractionFromPlanned: policy.maxIncreaseFractionFromPlanned,
    },
  };
}

export function applyAcceptedLoadRecommendation(
  exercise: ExerciseDraft,
  recommendation: LoadRecommendation,
  acceptance: Readonly<{ accepted: boolean; recommendationId: string }>,
): { readonly ok: true; readonly exercise: ExerciseDraft; readonly appliedByUser: true } | {
  readonly ok: false;
  readonly reason:
    | "recommendation_unavailable"
    | "confirmation_required"
    | "recommendation_mismatch"
    | "exercise_mismatch"
    | "plan_changed";
} {
  if (!recommendation.available) return { ok: false, reason: "recommendation_unavailable" };
  if (!acceptance.accepted) return { ok: false, reason: "confirmation_required" };
  if (acceptance.recommendationId !== recommendation.recommendationId) {
    return { ok: false, reason: "recommendation_mismatch" };
  }

  const exerciseId = exercise.id.trim();
  const sourceExerciseId = exercise.sourceExerciseId?.trim() || null;
  const exerciseLineageId = sourceExerciseId ?? exerciseId;
  if (
    exerciseId !== recommendation.binding.exerciseId
    || sourceExerciseId !== recommendation.binding.sourceExerciseId
    || exerciseLineageId !== recommendation.binding.exerciseLineageId
    || exercise.loadBasis !== recommendation.binding.loadBasis
  ) return { ok: false, reason: "exercise_mismatch" };

  if (
    recommendation.binding.sets.length !== exercise.sets.length
    || recommendation.setRecommendations.length !== exercise.sets.length
  ) return { ok: false, reason: "plan_changed" };

  const recommendationBySetId = new Map<string, SetLoadRecommendation>();
  for (const setRecommendation of recommendation.setRecommendations) {
    if (
      recommendationBySetId.has(setRecommendation.setId)
      || !isApplicableSetRecommendation(setRecommendation)
    ) return { ok: false, reason: "recommendation_mismatch" };
    recommendationBySetId.set(setRecommendation.setId, setRecommendation);
  }

  for (const bindingSet of recommendation.binding.sets) {
    const currentSet = exercise.sets.find((set) => set.id.trim() === bindingSet.setId);
    const setRecommendation = recommendationBySetId.get(bindingSet.setId);
    if (!currentSet || !setRecommendation) return { ok: false, reason: "plan_changed" };
    const currentSourceSetId = currentSet.sourceSetId?.trim() || null;
    if (
      currentSourceSetId !== bindingSet.sourceSetId
      || currentSet.order !== bindingSet.order
      || currentSet.targetReps !== bindingSet.targetReps
      || currentSet.targetKg !== bindingSet.plannedLoadKg
      || currentSet.toFailure !== bindingSet.toFailure
    ) return { ok: false, reason: "plan_changed" };
    if (
      setRecommendation.sourceSetId !== bindingSet.sourceSetId
      || setRecommendation.order !== bindingSet.order
      || setRecommendation.targetReps !== bindingSet.targetReps
      || setRecommendation.plannedLoadKg !== bindingSet.plannedLoadKg
    ) return { ok: false, reason: "recommendation_mismatch" };
  }

  return {
    ok: true,
    appliedByUser: true,
    exercise: {
      ...exercise,
      sets: exercise.sets.map((set) => ({
        ...set,
        targetKg: recommendationBySetId.get(set.id.trim())?.suggestedLoadKg ?? set.targetKg,
      })),
    },
  };
}

function recommendSetLoad(
  set: RecommendationSetBinding,
  conservativeOneRepMaxKg: number,
  policy: LoadRecommendationPolicy,
): SetLoadRecommendation {
  const rawLoad = conservativeOneRepMaxKg / (1 + set.targetReps / 30);
  let suggestedLoadKg = Math.min(
    policy.maxSuggestedLoadKg,
    Math.max(policy.loadIncrementKg, roundToIncrement(rawLoad, policy.loadIncrementKg, "down")),
  );
  let increaseLimitApplied = false;
  if (set.plannedLoadKg > 0) {
    const increaseCeiling = Math.max(
      policy.loadIncrementKg,
      roundToIncrement(
        set.plannedLoadKg * (1 + policy.maxIncreaseFractionFromPlanned),
        policy.loadIncrementKg,
        "down",
      ),
    );
    if (suggestedLoadKg > increaseCeiling) {
      suggestedLoadKg = increaseCeiling;
      increaseLimitApplied = true;
    }
  }

  const estimatedRepsAtSuggestedLoad = estimateRepRange(
    conservativeOneRepMaxKg,
    suggestedLoadKg,
    policy.repRangeUncertainty,
    policy.maxEstimatedReps,
  );
  const estimatedRepsAtPlannedLoad = set.plannedLoadKg > 0
    ? estimateRepRange(
      conservativeOneRepMaxKg,
      set.plannedLoadKg,
      policy.repRangeUncertainty,
      policy.maxEstimatedReps,
    )
    : null;
  const explanation = [
    `Serie ${set.order}: para el objetivo configurado de ${set.targetReps} repeticiones se sugiere ${suggestedLoadKg} kg desde el historial reciente.`,
    `Con ${suggestedLoadKg} kg se estima un rango de ${estimatedRepsAtSuggestedLoad.min}-${estimatedRepsAtSuggestedLoad.max} repeticiones; no es una promesa de rendimiento.`,
    estimatedRepsAtPlannedLoad === null
      ? "No había una carga planificada positiva para comparar esta serie."
      : `Con la carga planificada de ${set.plannedLoadKg} kg se estima un rango de ${estimatedRepsAtPlannedLoad.min}-${estimatedRepsAtPlannedLoad.max} repeticiones.`,
  ];
  return {
    setId: set.setId,
    sourceSetId: set.sourceSetId,
    order: set.order,
    targetReps: set.targetReps,
    plannedLoadKg: set.plannedLoadKg,
    suggestedLoadKg,
    increaseLimitApplied,
    estimatedRepsAtSuggestedLoad,
    estimatedRepsAtPlannedLoad,
    explanation: increaseLimitApplied
      ? [...explanation, `El aumento quedó limitado a ${Math.round(policy.maxIncreaseFractionFromPlanned * 100)}% sobre la carga planificada.`]
      : explanation,
  };
}

function unavailable(
  reason: Extract<LoadRecommendation, { available: false }>["reason"],
  explanation: string,
  targetRepRange: Readonly<{ min: number; max: number }>,
  source: RecommendationSourceSummary,
): LoadRecommendation {
  return {
    available: false,
    reason,
    recommendationId: null,
    binding: null,
    setRecommendations: [],
    autoApply: false,
    requiresUserConfirmation: true,
    confidence: "none",
    source,
    targetRepRange,
    explanation: [explanation, "No se aplicó ningún cambio al plan."],
  };
}

function createExerciseBinding(
  exercise: ExerciseDraft,
  policy: LoadRecommendationPolicy,
): ExerciseRecommendationBinding | null {
  if (!exercise || typeof exercise !== "object") return null;
  const exerciseId = exercise.id.trim();
  const sourceExerciseId = exercise.sourceExerciseId?.trim() || null;
  if (
    !exerciseId
    || (exercise.sourceExerciseId !== null && sourceExerciseId === null)
    || (exercise.loadBasis !== "external" && exercise.loadBasis !== "bodyweight")
    || exercise.sets.length < 1
  ) return null;

  const sortedSets = [...exercise.sets].sort((left, right) => left.order - right.order);
  const setIds = new Set<string>();
  const bindings: RecommendationSetBinding[] = [];
  for (let index = 0; index < sortedSets.length; index += 1) {
    const set = sortedSets[index];
    const setId = set.id.trim();
    const sourceSetId = set.sourceSetId?.trim() || null;
    if (
      !setId
      || setIds.has(setId)
      || (set.sourceSetId !== null && sourceSetId === null)
      || set.order !== index + 1
      || !Number.isSafeInteger(set.targetReps)
      || set.targetReps < 1
      || set.targetReps > policy.maxTargetReps
      || !Number.isFinite(set.targetKg)
      || set.targetKg < 0
      || set.targetKg > policy.maxSuggestedLoadKg
      || (set.targetKg > 0 && set.targetKg < policy.loadIncrementKg)
      || typeof set.toFailure !== "boolean"
    ) return null;
    setIds.add(setId);
    bindings.push({
      setId,
      sourceSetId,
      order: set.order,
      targetReps: set.targetReps,
      plannedLoadKg: set.targetKg,
      toFailure: set.toFailure,
    });
  }
  return {
    exerciseId,
    sourceExerciseId,
    exerciseLineageId: sourceExerciseId ?? exerciseId,
    loadBasis: exercise.loadBasis,
    sets: bindings,
  };
}

function isUsableObservation(
  observation: ExerciseHistoryObservation,
  windowStart: string,
  asOfDate: string,
  policy: LoadRecommendationPolicy,
): boolean {
  return Boolean(observation.sessionId.trim())
    && isISOCalendarDate(observation.performedOn)
    && compareISOCalendarDates(observation.performedOn, windowStart) >= 0
    && compareISOCalendarDates(observation.performedOn, asOfDate) <= 0
    && Number.isFinite(observation.loadKg)
    && observation.loadKg > 0
    && observation.loadKg <= policy.maxObservedLoadKg
    && Number.isSafeInteger(observation.completedReps)
    && observation.completedReps >= 1
    && observation.completedReps <= policy.maxObservedReps
    && typeof observation.toFailure === "boolean";
}

function estimateRepRange(
  estimatedOneRepMaxKg: number,
  loadKg: number,
  uncertainty: number,
  maxEstimatedReps: number,
): EstimatedRepRange {
  const point = 30 * (estimatedOneRepMaxKg / loadKg - 1);
  const boundedPoint = clampNumber(point, 1, maxEstimatedReps);
  return {
    min: Math.max(1, Math.floor(boundedPoint - uncertainty)),
    max: Math.min(maxEstimatedReps, Math.ceil(boundedPoint + uncertainty)),
    qualifier: "estimate_not_guarantee",
  };
}

function calculateConfidence(
  observations: readonly ExerciseHistoryObservation[],
  sessionCount: number,
  estimates: readonly number[],
  policy: LoadRecommendationPolicy,
): RecommendationConfidence {
  const mean = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
  const variance = estimates.reduce((sum, value) => sum + (value - mean) ** 2, 0) / estimates.length;
  const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 1;
  if (
    sessionCount >= policy.highConfidenceSessions
    && observations.length >= policy.highConfidenceSamples
    && coefficientOfVariation <= 0.08
  ) return "high";
  if (
    sessionCount >= policy.mediumConfidenceSessions
    && observations.length >= policy.mediumConfidenceSamples
    && coefficientOfVariation <= 0.15
  ) return "medium";
  return "low";
}

function percentile(sortedValues: readonly number[], fraction: number): number {
  const index = Math.floor((sortedValues.length - 1) * fraction);
  return sortedValues[index] ?? 0;
}

function isValidPolicy(policy: LoadRecommendationPolicy): boolean {
  return Number.isSafeInteger(policy.windowDays)
    && policy.windowDays > 0
    && policy.windowDays <= 42
    && Number.isSafeInteger(policy.minimumSessions)
    && policy.minimumSessions >= 2
    && Number.isSafeInteger(policy.minimumSamples)
    && policy.minimumSamples >= 3
    && Number.isSafeInteger(policy.mediumConfidenceSessions)
    && policy.mediumConfidenceSessions >= policy.minimumSessions
    && Number.isSafeInteger(policy.mediumConfidenceSamples)
    && policy.mediumConfidenceSamples >= policy.minimumSamples
    && Number.isSafeInteger(policy.highConfidenceSessions)
    && policy.highConfidenceSessions >= policy.mediumConfidenceSessions
    && Number.isSafeInteger(policy.highConfidenceSamples)
    && policy.highConfidenceSamples >= policy.mediumConfidenceSamples
    && Number.isSafeInteger(policy.maxObservedReps)
    && policy.maxObservedReps > 0
    && policy.maxObservedReps <= 15
    && Number.isFinite(policy.maxObservedLoadKg)
    && policy.maxObservedLoadKg > 0
    && policy.maxObservedLoadKg <= 5_000
    && Number.isSafeInteger(policy.maxTargetReps)
    && policy.maxTargetReps > 0
    && policy.maxTargetReps <= 15
    && policy.maxTargetReps <= policy.maxObservedReps
    && Number.isSafeInteger(policy.maxEstimatedReps)
    && policy.maxEstimatedReps >= policy.maxTargetReps
    && policy.maxEstimatedReps <= 30
    && Number.isFinite(policy.maxSuggestedLoadKg)
    && policy.maxSuggestedLoadKg > 0
    && policy.maxSuggestedLoadKg <= 5_000
    && policy.maxSuggestedLoadKg <= policy.maxObservedLoadKg
    && Number.isFinite(policy.conservativePercentile)
    && policy.conservativePercentile >= 0
    && policy.conservativePercentile <= 0.5
    && Number.isFinite(policy.safetyFactor)
    && policy.safetyFactor > 0
    && policy.safetyFactor <= 0.95
    && Number.isFinite(policy.loadIncrementKg)
    && policy.loadIncrementKg > 0
    && policy.loadIncrementKg <= policy.maxSuggestedLoadKg
    && Number.isSafeInteger(policy.repRangeUncertainty)
    && policy.repRangeUncertainty > 0
    && policy.repRangeUncertainty < policy.maxEstimatedReps
    && Number.isFinite(policy.maxIncreaseFractionFromPlanned)
    && policy.maxIncreaseFractionFromPlanned >= 0
    && policy.maxIncreaseFractionFromPlanned <= 0.1;
}

function isApplicableSetRecommendation(recommendation: SetLoadRecommendation): boolean {
  return Boolean(recommendation.setId.trim())
    && Number.isSafeInteger(recommendation.order)
    && recommendation.order > 0
    && Number.isSafeInteger(recommendation.targetReps)
    && recommendation.targetReps > 0
    && Number.isFinite(recommendation.plannedLoadKg)
    && recommendation.plannedLoadKg >= 0
    && Number.isFinite(recommendation.suggestedLoadKg)
    && recommendation.suggestedLoadKg > 0
    && recommendation.suggestedLoadKg <= DEFAULT_LOAD_RECOMMENDATION_POLICY.maxSuggestedLoadKg;
}

function createRecommendationId(
  binding: ExerciseRecommendationBinding,
  asOfDate: string,
  goal: TrainingGoal,
  sampleCount: number,
  sessionCount: number,
  conservativeOneRepMaxKg: number,
): string {
  const setSignature = binding.sets.map((set) => [
    set.setId,
    set.sourceSetId ?? "none",
    set.order,
    set.targetReps,
    set.plannedLoadKg,
    set.toFailure ? 1 : 0,
  ].map(encodeRecommendationPart).join(",")).join(";");
  return [
    "load-rec-v2",
    binding.exerciseId,
    binding.sourceExerciseId ?? "none",
    binding.exerciseLineageId,
    asOfDate,
    goal,
    sampleCount,
    sessionCount,
    roundDecimal(conservativeOneRepMaxKg, 2),
    setSignature,
  ].map(encodeRecommendationPart).join(":");
}

function encodeRecommendationPart(value: string | number): string {
  return encodeURIComponent(String(value));
}

function sourceSummary(
  windowStart: string,
  windowEnd: string,
  windowDays: number,
  sampleCount: number,
  sessionCount: number,
  excludedSampleCount: number,
): RecommendationSourceSummary {
  return { windowStart, windowEnd, windowDays, sampleCount, sessionCount, excludedSampleCount };
}
