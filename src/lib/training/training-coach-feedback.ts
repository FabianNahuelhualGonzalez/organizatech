export type CoachTone = "positive" | "neutral" | "warning";
export type CoachInsightTone = "positive" | "info" | "warning";
export type CoachConfidence = "low" | "medium" | "high";
export type CoachComparisonStatus = "none" | "first_reference" | "ready";
export type TrainingCoachTrendPhase =
  | "no_history"
  | "first_reference"
  | "initial_comparison"
  | "early_trend"
  | "reliable_history";

export interface CoachInsight {
  title: string;
  body: string;
  action?: string;
  tone: CoachInsightTone;
  priority: number;
}

export interface TrainingCoachFeedback {
  headline: string;
  summary: string;
  strengths: CoachInsight[];
  attentions: CoachInsight[];
  readinessInsight?: CoachInsight;
  historicalInsight?: CoachInsight;
  trendSummary?: string;
  trendSignals?: string[];
  trendWindow?: TrainingCoachTrendWindow;
  nextAdvice: string;
  nextTarget?: string;
  tone: CoachTone;
  confidence: CoachConfidence;
  contradictionsResolved: string[];
  sourceSignals: string[];
}

export interface TrainingCoachExerciseChange {
  id?: string | null;
  name: string;
  kgDifference?: number | null;
  repsDifference?: number | null;
  volumeDifference?: number | null;
  volumePercentage?: number | null;
}

export interface TrainingCoachWorkoutSummary {
  completedExercises?: number | null;
  totalExercises?: number | null;
  completedSets?: number | null;
  totalSets?: number | null;
  volumeDifference?: number | null;
  volumePercentage?: number | null;
  repsDifference?: number | null;
  kgIncreasedExercises?: number | null;
  kgDecreasedExercises?: number | null;
}

export interface TrainingCoachReadiness {
  motivation?: number | null;
  hydration?: number | null;
  sleep?: number | null;
  energy?: number | null;
}

export interface TrainingCoachTrendWindow {
  firstWeek: number;
  lastWeek: number;
  weekCount: number;
}

export interface TrainingCoachWeeklyTrendWeek {
  week: number;
  totalVolume: number | null;
  totalReps: number | null;
  completedExercises: number | null;
  totalExercises: number | null;
  complianceRate: number | null;
  averageKg: number | null;
  increasedLoadExercises: number | null;
}

export interface TrainingCoachWeeklyTrend {
  phase: TrainingCoachTrendPhase;
  availableWeeks: number[];
  weekCount: number;
  currentWeek: number;
  currentWeekComplete: boolean | null;
  isCurrentWeekInProgress: boolean;
  missingWeeks: number[];
  confidence: CoachConfidence;
  trendWindow: TrainingCoachTrendWindow | null;
  weeks: TrainingCoachWeeklyTrendWeek[];
}

export interface TrainingCoachFeedbackInput {
  seed?: string | number | null;
  comparisonStatus: CoachComparisonStatus;
  workout?: TrainingCoachWorkoutSummary | null;
  exercises?: TrainingCoachExerciseChange[] | null;
  readiness?: TrainingCoachReadiness | null;
  currentWeek?: number | null;
  referenceWeek?: number | null;
  weeklyTrend?: TrainingCoachWeeklyTrend | null;
}

type SignalId =
  | "first_reference"
  | "routine_complete"
  | "kg_up_reps_up"
  | "kg_up_reps_down"
  | "same_kg_reps_up"
  | "same_kg_reps_down"
  | "volume_down_complete"
  | "volume_up"
  | "sleep_low_performance_low"
  | "sleep_low_performance_high"
  | "motivation_high_hydration_low"
  | "good_adherence_low_progress"
  | "strong_exercise_drop";

interface DetectedSignal {
  id: SignalId;
  priority: number;
  exercise?: TrainingCoachExerciseChange;
}

interface NormalizedTrainingCoachInput {
  seed: string | number;
  comparisonStatus: CoachComparisonStatus;
  workout: TrainingCoachWorkoutSummary;
  exercises: TrainingCoachExerciseChange[];
  readiness: TrainingCoachReadiness;
  currentWeek: number | null;
  referenceWeek: number | null;
  weeklyTrend: TrainingCoachWeeklyTrend | null;
}

const STRONG_VOLUME_DROP_PERCENTAGE = -20;
const STRONG_REPS_DROP = -4;
const LOW_READINESS = 4;
const HIGH_READINESS = 5.5;
const TREND_MINIMUM_CHANGE_PERCENTAGE = 5;
const TREND_STRONG_DROP_PERCENTAGE = -15;
const HIGH_COMPLIANCE_RATE = 80;

export function buildTrainingCoachFeedback(input: TrainingCoachFeedbackInput): TrainingCoachFeedback {
  const normalized = normalizeInput(input);
  const signals = detectCoachSignals(normalized);
  const historical = buildHistoricalTrendAnalysis(normalized);
  const sourceSignals = [...signals.map((signal) => signal.id), ...historical.signals];
  const contradictionsResolved = [...resolveContradictions(normalized, sourceSignals), ...historical.contradictions];
  const strengths = selectInsights(
    signals.filter((signal) => isStrengthSignal(signal.id)).map((signal) => buildInsight(signal, normalized, "strength")),
    2,
  );
  const attentions = selectInsights(
    signals.filter((signal) => isAttentionSignal(signal.id)).map((signal) => buildInsight(signal, normalized, "attention")),
    2,
  );
  const readinessInsight = buildReadinessInsight(signals, normalized);
  const tone = resolveTone(sourceSignals, contradictionsResolved);
  const headline = resolveHeadline(normalized, sourceSignals, tone);
  const summary = resolveSummary(normalized, sourceSignals, tone);
  const nextTarget = resolveNextTarget(signals);
  const nextAdvice = resolveNextAdvice(normalized, sourceSignals, nextTarget);
  const confidence = resolveConfidence(normalized, sourceSignals);

  return compactFeedback({
    headline,
    summary,
    strengths,
    attentions,
    readinessInsight,
    historicalInsight: historical.insight,
    trendSummary: historical.summary,
    trendSignals: historical.signals.length > 0 ? historical.signals : undefined,
    trendWindow: normalized.weeklyTrend?.trendWindow ?? undefined,
    nextAdvice,
    nextTarget,
    tone,
    confidence,
    contradictionsResolved,
    sourceSignals,
  });
}

export function pickVariant<T>(patternId: string, seed: string | number | null | undefined, variants: readonly T[]): T {
  if (variants.length === 0) {
    throw new Error("pickVariant requiere al menos una variante");
  }

  const hash = hashString(`${patternId}:${String(seed ?? "coach")}`);
  return variants[hash % variants.length]!;
}

function normalizeInput(input: TrainingCoachFeedbackInput): NormalizedTrainingCoachInput {
  return {
    seed: input.seed ?? "coach-organizatech",
    comparisonStatus: input.comparisonStatus,
    workout: sanitizeWorkout(input.workout),
    exercises: (input.exercises ?? []).map(sanitizeExercise).filter((exercise) => exercise.name.length > 0),
    readiness: sanitizeReadiness(input.readiness),
    currentWeek: finiteOrNull(input.currentWeek),
    referenceWeek: finiteOrNull(input.referenceWeek),
    weeklyTrend: sanitizeWeeklyTrend(input.weeklyTrend),
  };
}

function detectCoachSignals(input: NormalizedTrainingCoachInput): DetectedSignal[] {
  const signals: DetectedSignal[] = [];
  const workout = input.workout;
  const exercises = input.exercises;
  const bestProgress = exercises.find((exercise) => positive(exercise.kgDifference) && !negative(exercise.repsDifference));
  const kgUpRepsDown = exercises.find((exercise) => positive(exercise.kgDifference) && negative(exercise.repsDifference));
  const sameKgRepsUp = exercises.find((exercise) => neutral(exercise.kgDifference) && positive(exercise.repsDifference));
  const sameKgRepsDown = exercises.find((exercise) => neutral(exercise.kgDifference) && negative(exercise.repsDifference));
  const strongestDrop = [...exercises]
    .filter((exercise) => safeNumber(exercise.repsDifference) <= STRONG_REPS_DROP && !positive(exercise.kgDifference))
    .sort((a, b) => safeNumber(a.repsDifference) - safeNumber(b.repsDifference))[0];
  const routineComplete = isRoutineComplete(workout);
  const volumePercentage = safeNumber(workout.volumePercentage);
  const volumeDifference = safeNumber(workout.volumeDifference);
  const lowProgress = workout.kgIncreasedExercises === 0 && safeNumber(workout.repsDifference) <= 0 && volumeDifference <= 0;
  const performanceLow = volumePercentage <= STRONG_VOLUME_DROP_PERCENTAGE || Boolean(strongestDrop) || safeNumber(workout.repsDifference) <= STRONG_REPS_DROP;
  const performanceHigh = volumeDifference > 0 || Boolean(bestProgress) || safeNumber(workout.repsDifference) > 0;
  const readiness = input.readiness;

  if (input.comparisonStatus === "none") return signals;
  if (input.comparisonStatus === "first_reference") {
    signals.push({ id: "first_reference", priority: 100 });
    if (routineComplete) signals.push({ id: "routine_complete", priority: 40 });
    return signals;
  }

  if (routineComplete) signals.push({ id: "routine_complete", priority: 40 });
  if (bestProgress) signals.push({ id: "kg_up_reps_up", priority: 95, exercise: bestProgress });
  if (kgUpRepsDown) signals.push({ id: "kg_up_reps_down", priority: 96, exercise: kgUpRepsDown });
  if (sameKgRepsUp) signals.push({ id: "same_kg_reps_up", priority: 75, exercise: sameKgRepsUp });
  if (sameKgRepsDown) signals.push({ id: "same_kg_reps_down", priority: 78, exercise: sameKgRepsDown });
  if (routineComplete && volumeDifference < 0) signals.push({ id: "volume_down_complete", priority: volumePercentage <= STRONG_VOLUME_DROP_PERCENTAGE ? 92 : 70 });
  if (volumeDifference > 0) signals.push({ id: "volume_up", priority: 72 });
  if (strongestDrop) signals.push({ id: "strong_exercise_drop", priority: 98, exercise: strongestDrop });
  if (routineComplete && lowProgress) signals.push({ id: "good_adherence_low_progress", priority: 66 });
  if (isLow(readiness.sleep) && performanceLow) signals.push({ id: "sleep_low_performance_low", priority: 94 });
  if (isLow(readiness.sleep) && performanceHigh) signals.push({ id: "sleep_low_performance_high", priority: 82 });
  if (isHigh(readiness.motivation) && isLow(readiness.hydration)) signals.push({ id: "motivation_high_hydration_low", priority: 76 });

  return dedupeSignals(signals).sort((a, b) => b.priority - a.priority);
}

function buildInsight(signal: DetectedSignal, input: NormalizedTrainingCoachInput, mode: "strength" | "attention"): CoachInsight {
  const seed = input.seed;
  const exerciseName = signal.exercise?.name ?? "tu ejercicio principal";

  if (signal.id === "routine_complete") {
    return {
      title: "Rutina completa",
      body: pickVariant(signal.id, seed, [
        "Cumpliste la sesión completa. Es una base sólida para seguir progresando.",
        "Cerraste todos los ejercicios planificados. Esa consistencia suma mucho.",
        "Completaste la rutina. Ahora el foco puede pasar a calidad y progresión.",
      ]),
      tone: "positive",
      priority: signal.priority,
    };
  }

  if (signal.id === "first_reference") {
    return {
      title: "Registro base creado",
      body: "Este entrenamiento queda como punto de partida para comparar tus próximas semanas.",
      tone: "positive",
      priority: signal.priority,
    };
  }

  if (signal.id === "kg_up_reps_up") {
    return {
      title: "Progreso fuerte",
      body: `${exerciseName} subió carga y mantuvo o mejoró repeticiones. Es una excelente señal de avance.`,
      action: "Mantén esa carga una sesión más; si repites el rendimiento, considera una subida pequeña.",
      tone: "positive",
      priority: signal.priority,
    };
  }

  if (signal.id === "same_kg_reps_up") {
    return {
      title: "Progreso limpio",
      body: `${exerciseName} mejoró repeticiones usando la misma carga. Es una señal controlada y muy útil.`,
      action: "Si lo repites, estarás mejor posicionado para subir peso.",
      tone: "positive",
      priority: signal.priority,
    };
  }

  if (signal.id === "volume_up") {
    return {
      title: "Más volumen acumulado",
      body: `Tu volumen semanal subió ${formatSignedPercent(input.workout.volumePercentage)} frente a la referencia.`,
      action: "Sostén el ritmo y evita subir carga en todos los ejercicios al mismo tiempo.",
      tone: "positive",
      priority: signal.priority,
    };
  }

  if (signal.id === "kg_up_reps_down") {
    return {
      title: "Progresión de carga detectada",
      body: `${exerciseName} bajó ${Math.abs(safeNumber(signal.exercise?.repsDifference))} reps, pero subiste el peso. Es una progresión normal cuando aumentas intensidad y mantienes buena técnica.`,
      action: "Consolida esta carga una sesión más y busca recuperar reps de forma gradual.",
      tone: "info",
      priority: signal.priority,
    };
  }

  if (signal.id === "same_kg_reps_down") {
    return {
      title: "Posible fatiga",
      body: `${exerciseName} mantuvo la carga, pero bajó repeticiones. Puede ser fatiga o menor recuperación.`,
      action: "Prioriza técnica y busca igualar tu registro anterior antes de progresar.",
      tone: "warning",
      priority: signal.priority,
    };
  }

  if (signal.id === "strong_exercise_drop") {
    return {
      title: "Caída fuerte detectada",
      body: `${exerciseName} bajó ${Math.abs(safeNumber(signal.exercise?.repsDifference))} reps. Es el punto más importante a revisar.`,
      action: "Mantén la carga o baja levemente si la técnica se deteriora.",
      tone: "warning",
      priority: signal.priority,
    };
  }

  if (signal.id === "volume_down_complete") {
    return {
      title: "Semana controlada",
      body: `Completaste la rutina, pero el volumen bajó ${formatSignedPercent(input.workout.volumePercentage)}. Puede ser una semana más pesada o con menos acumulación.`,
      action: "Si tu objetivo es hipertrofia, intenta recuperar volumen progresivamente.",
      tone: mode === "strength" ? "info" : "warning",
      priority: signal.priority,
    };
  }

  return {
    title: "Adherencia con bajo progreso",
    body: "Cumpliste bien, pero las métricas de progreso no subieron con claridad.",
    action: "Elige un ejercicio clave y busca una mejora pequeña y medible la próxima sesión.",
    tone: "info",
    priority: signal.priority,
  };
}

function buildReadinessInsight(signals: DetectedSignal[], input: NormalizedTrainingCoachInput): CoachInsight | undefined {
  const seed = input.seed;
  const readinessSignal = signals.find((signal) =>
    signal.id === "sleep_low_performance_low" ||
    signal.id === "sleep_low_performance_high" ||
    signal.id === "motivation_high_hydration_low"
  );

  if (!readinessSignal) return undefined;

  if (readinessSignal.id === "sleep_low_performance_low") {
    return {
      title: "Recuperación limitada",
      body: pickVariant(readinessSignal.id, seed, [
        "Tu rendimiento bajó y el sueño no acompañó. Tiene sentido cuidar la exigencia.",
        "La baja de rendimiento puede estar relacionada con el descanso. No conviene forzar marcas.",
      ]),
      action: "Mantén cargas y prioriza técnica.",
      tone: "warning",
      priority: readinessSignal.priority,
    };
  }

  if (readinessSignal.id === "sleep_low_performance_high") {
    return {
      title: "Buen rendimiento pese al sueño",
      body: "Rendiste bien incluso con sueño bajo. Es una buena señal, pero no conviene abusar de esa condición.",
      action: "Aprovecha el progreso y cuida la recuperación antes de seguir subiendo carga.",
      tone: "info",
      priority: readinessSignal.priority,
    };
  }

  return {
    title: "Hidratación a mejorar",
    body: "La motivación estuvo alta, pero la hidratación puede limitar el rendimiento en series pesadas.",
    action: "Mejora hidratación antes de buscar nuevas marcas.",
    tone: "info",
    priority: readinessSignal.priority,
  };
}

function buildHistoricalTrendAnalysis(input: NormalizedTrainingCoachInput): {
  insight?: CoachInsight;
  summary?: string;
  signals: string[];
  contradictions: string[];
} {
  const trend = input.weeklyTrend;
  if (!trend || trend.phase === "no_history" || trend.phase === "first_reference") {
    return { signals: [], contradictions: [] };
  }

  const weeks = trend.weeks
    .filter((week) => safeNumber(week.totalVolume) > 0 || safeNumber(week.totalReps) > 0 || safeNumber(week.completedExercises) > 0)
    .sort((a, b) => a.week - b.week);
  if (weeks.length < 2) return { signals: [], contradictions: [] };

  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  const previousWeeks = weeks.slice(0, -1);
  const signals: string[] = [];
  const contradictions: string[] = [];
  const volumeChange = percentageChange(first.totalVolume, last.totalVolume);
  const repsChange = percentageChange(first.totalReps, last.totalReps);
  const loadChange = percentageChange(first.averageKg, last.averageKg);
  const averageCompliance = averageNumber(weeks.map((week) => week.complianceRate));
  const currentWeekIncomplete = trend.isCurrentWeekInProgress || trend.currentWeekComplete === false;
  const recentDrop = previousWeeks.length >= 2
    ? percentageChange(averageNumber(previousWeeks.map((week) => week.totalVolume)), last.totalVolume)
    : null;
  const volumeUp = safeNumber(volumeChange) >= TREND_MINIMUM_CHANGE_PERCENTAGE;
  const repsUp = safeNumber(repsChange) >= TREND_MINIMUM_CHANGE_PERCENTAGE;
  const loadUp = safeNumber(loadChange) >= TREND_MINIMUM_CHANGE_PERCENTAGE ||
    safeNumber(last.increasedLoadExercises) > safeNumber(first.increasedLoadExercises);
  const volumeFlat = withinRange(volumeChange, TREND_MINIMUM_CHANGE_PERCENTAGE);
  const repsFlat = withinRange(repsChange, TREND_MINIMUM_CHANGE_PERCENTAGE);
  const loadFlat = withinRange(loadChange, TREND_MINIMUM_CHANGE_PERCENTAGE);
  const highCompliance = safeNumber(averageCompliance) >= HIGH_COMPLIANCE_RATE;
  const irregularCompliance = weeks.some((week) => safeNumber(week.complianceRate) > 0 && safeNumber(week.complianceRate) < HIGH_COMPLIANCE_RATE);

  if (trend.phase === "initial_comparison") {
    signals.push("historical_initial_comparison");
    return {
      summary: "Ya existe una comparación inicial, pero aún falta historial para detectar una tendencia real.",
      signals,
      contradictions,
    };
  }

  if (trend.phase === "early_trend") signals.push("historical_early_trend");
  if (trend.phase === "reliable_history") signals.push("historical_reliable_history");
  if (trend.phase === "reliable_history" && volumeUp && repsChange !== null && repsChange >= 0 && highCompliance) {
    signals.push("historical_sustained_progress");
  }
  if (volumeUp) signals.push("historical_volume_up");
  if (loadUp) signals.push("historical_load_up");
  if (repsUp && !loadUp) signals.push("historical_reps_up");
  if (weeks.length >= 3 && volumeFlat && repsFlat && loadFlat) signals.push("historical_stable_low_progress");
  if (weeks.length >= 3 && highCompliance && volumeFlat && repsFlat && loadFlat) signals.push("historical_high_adherence_low_progress");
  if (highCompliance) signals.push("historical_high_consistency");
  if (irregularCompliance) signals.push("historical_irregular_consistency");
  if (!currentWeekIncomplete && safeNumber(recentDrop) <= TREND_STRONG_DROP_PERCENTAGE) {
    signals.push("historical_recent_drop");
  }
  if ((loadUp && safeNumber(volumeChange) <= -TREND_MINIMUM_CHANGE_PERCENTAGE) ||
    (repsUp && irregularCompliance) ||
    (volumeUp && isLow(input.readiness.sleep))) {
    signals.push("historical_mixed_progress");
    contradictions.push("historical_positive_and_caution_signals");
  }
  if (currentWeekIncomplete && safeNumber(recentDrop) <= TREND_STRONG_DROP_PERCENTAGE) {
    contradictions.push("recent_drop_blocked_by_incomplete_week");
  }

  const insight = resolveHistoricalInsight({
    trend,
    signals,
    volumeChange,
    repsChange,
    loadChange,
    averageCompliance,
  });

  return {
    insight,
    summary: insight?.body,
    signals: dedupeStrings(signals),
    contradictions: dedupeStrings(contradictions),
  };
}

function resolveHistoricalInsight({
  trend,
  signals,
  volumeChange,
  repsChange,
  loadChange,
  averageCompliance,
}: {
  trend: TrainingCoachWeeklyTrend;
  signals: string[];
  volumeChange: number | null;
  repsChange: number | null;
  loadChange: number | null;
  averageCompliance: number | null;
}): CoachInsight | undefined {
  const window = trend.trendWindow;
  const weekCopy = window ? `En estas ${window.weekCount} semanas` : "En tus semanas registradas";
  const prioritySignal = pickHistoricalPriority(signals);

  if (trend.phase === "early_trend" && signals.length > 0) {
    return {
      title: "Primera señal de tendencia",
      body: `En tus últimas semanas aparece una primera señal: ${buildTrendEvidenceCopy({ volumeChange, repsChange, loadChange })}. Aún conviene leerlo con prudencia.`,
      action: "Suma una semana más antes de sacar conclusiones fuertes.",
      tone: "info",
      priority: 60,
    };
  }

  if (prioritySignal === "historical_recent_drop") {
    return {
      title: "Progreso positivo con atención reciente",
      body: `${weekCopy} hay historial útil, pero la última semana bajó frente a tu tendencia. Si fue puntual no es grave; si se repite, conviene ajustar carga o recuperación.`,
      action: "Revisa recuperación y busca estabilizar volumen antes de aumentar exigencia.",
      tone: "warning",
      priority: 96,
    };
  }

  if (prioritySignal === "historical_mixed_progress") {
    return {
      title: "Progreso mixto",
      body: `${weekCopy} aparecen señales positivas, pero también puntos a cuidar. La progresión no viene por una sola métrica.`,
      action: "Consolida reps y técnica antes de seguir aumentando carga.",
      tone: "info",
      priority: 92,
    };
  }

  if (prioritySignal === "historical_high_adherence_low_progress") {
    return {
      title: "Constancia con poca progresión",
      body: `${weekCopy} tu cumplimiento se mantiene alto, pero volumen, reps y carga están bastante estables. Estás siendo constante; falta convertirlo en progresión real.`,
      action: "Elige un ejercicio clave y busca una mejora pequeña medible.",
      tone: "info",
      priority: 88,
    };
  }

  if (prioritySignal === "historical_sustained_progress") {
    return {
      title: "Progreso sostenido",
      body: `${weekCopy} vienes progresando de forma sólida: acumulaste más volumen y mantuviste buena consistencia.`,
      action: "Mantén el ritmo y evita acelerar todas las cargas al mismo tiempo.",
      tone: "positive",
      priority: 86,
    };
  }

  if (prioritySignal === "historical_stable_low_progress") {
    return {
      title: "Rendimiento estable",
      body: `${weekCopy} tu rendimiento viene estable, pero con poca progresión. No es un problema, aunque puede ser señal para ajustar reps, carga o recuperación.`,
      action: "Busca recuperar reps antes de subir peso de forma agresiva.",
      tone: "info",
      priority: 82,
    };
  }

  if (prioritySignal === "historical_volume_up") {
    return {
      title: "Volumen en aumento",
      body: `${weekCopy} tu volumen total aumentó desde tu primera referencia. Eso indica que estás acumulando más trabajo.`,
      action: "Sostén la progresión sin sacrificar técnica.",
      tone: "positive",
      priority: 78,
    };
  }

  if (prioritySignal === "historical_load_up") {
    return {
      title: "Carga en aumento",
      body: `${weekCopy} tu progreso viene principalmente por mayor intensidad.`,
      action: "No subas peso si las reps caen fuerte; consolida primero.",
      tone: "positive",
      priority: 74,
    };
  }

  if (prioritySignal === "historical_reps_up") {
    return {
      title: "Repeticiones en aumento",
      body: `${weekCopy} mejoraste rendimiento sin depender únicamente de subir peso.`,
      action: "Confirma esa mejora una semana más antes de aumentar carga.",
      tone: "positive",
      priority: 72,
    };
  }

  if (prioritySignal === "historical_high_consistency") {
    return {
      title: "Consistencia alta",
      body: `${weekCopy} tu mayor fortaleza es la constancia, con un cumplimiento promedio cercano a ${Math.round(safeNumber(averageCompliance))}%.`,
      action: "Usa esa base para buscar una progresión pequeña y controlada.",
      tone: "positive",
      priority: 68,
    };
  }

  if (prioritySignal === "historical_irregular_consistency") {
    return {
      title: "Consistencia irregular",
      body: `${weekCopy} el progreso puede verse limitado por irregularidad en el cumplimiento.`,
      action: "Prioriza completar la rutina antes de exigir nuevas subidas.",
      tone: "info",
      priority: 66,
    };
  }

  return undefined;
}

function pickHistoricalPriority(signals: string[]) {
  const order = [
    "historical_recent_drop",
    "historical_mixed_progress",
    "historical_high_adherence_low_progress",
    "historical_sustained_progress",
    "historical_stable_low_progress",
    "historical_volume_up",
    "historical_load_up",
    "historical_reps_up",
    "historical_high_consistency",
    "historical_irregular_consistency",
  ];
  return order.find((signal) => signals.includes(signal));
}

function buildTrendEvidenceCopy({
  volumeChange,
  repsChange,
  loadChange,
}: {
  volumeChange: number | null;
  repsChange: number | null;
  loadChange: number | null;
}) {
  const evidence: string[] = [];
  if (safeNumber(volumeChange) >= TREND_MINIMUM_CHANGE_PERCENTAGE) evidence.push("el volumen empieza a subir");
  if (safeNumber(repsChange) >= TREND_MINIMUM_CHANGE_PERCENTAGE) evidence.push("las repeticiones mejoran");
  if (safeNumber(loadChange) >= TREND_MINIMUM_CHANGE_PERCENTAGE) evidence.push("la carga promedio aumenta");
  if (evidence.length === 0) return "el rendimiento viene estable";
  return evidence.join(", ");
}

function resolveContradictions(input: NormalizedTrainingCoachInput, signals: string[]) {
  const contradictions: string[] = [];
  const hasPositiveLoad = signals.includes("kg_up_reps_up") || signals.includes("same_kg_reps_up") || safeNumber(input.workout.kgIncreasedExercises) > 0;
  const strongVolumeDrop = safeNumber(input.workout.volumePercentage) <= STRONG_VOLUME_DROP_PERCENTAGE;

  if (hasPositiveLoad && strongVolumeDrop) contradictions.push("positive_load_with_strong_volume_drop");
  if (signals.includes("sleep_low_performance_low")) contradictions.push("low_readiness_explains_low_performance");
  if (signals.includes("sleep_low_performance_high")) contradictions.push("low_readiness_but_high_performance");

  return contradictions;
}

function resolveTone(signals: string[], contradictions: string[]): CoachTone {
  if (contradictions.length > 0) return "neutral";
  if (signals.includes("strong_exercise_drop") || signals.includes("sleep_low_performance_low")) return "warning";
  if (signals.includes("volume_down_complete") || signals.includes("kg_up_reps_down")) return "neutral";
  if (signals.includes("kg_up_reps_up") || signals.includes("same_kg_reps_up") || signals.includes("routine_complete")) return "positive";
  return "neutral";
}

function resolveHeadline(input: NormalizedTrainingCoachInput, signals: string[], tone: CoachTone) {
  if (signals.includes("first_reference")) return "Primer punto de partida";
  if (input.comparisonStatus === "none") return "Aún falta historial";
  if (signals.includes("kg_up_reps_down")) return "Progresión de carga detectada";
  if (signals.includes("volume_down_complete")) return "Semana controlada";
  if (tone === "neutral" && hasPositiveAndNegative(signals)) return "Progreso mixto";
  if (signals.includes("kg_up_reps_up")) return "Progreso fuerte";
  if (signals.includes("same_kg_reps_up")) return "Progreso limpio";
  if (signals.includes("strong_exercise_drop")) return "Atención al rendimiento";
  if (signals.includes("routine_complete")) return "Buen cumplimiento";
  return "Lectura del entrenamiento";
}

function resolveSummary(input: NormalizedTrainingCoachInput, signals: string[], tone: CoachTone) {
  if (signals.includes("first_reference")) {
    return "Este registro será tu base para comparar la evolución cuando tengas más semanas completadas.";
  }

  if (input.comparisonStatus === "none") {
    return "Todavía no hay comparación suficiente. Registra más entrenamientos para recibir una lectura más precisa.";
  }

  if (signals.includes("volume_down_complete") && safeNumber(input.workout.kgIncreasedExercises) > 0) {
    return "Tu progreso fue mixto: subiste carga en algunos ejercicios, pero acumulaste menos volumen semanal.";
  }

  if (tone === "warning") {
    return "Hay señales que conviene revisar antes de forzar progresión.";
  }

  if (tone === "positive") {
    return "La sesión deja señales positivas y una base clara para seguir progresando.";
  }

  return "La lectura es mixta: hay puntos buenos, pero también señales para ajustar la próxima sesión.";
}

function resolveNextAdvice(input: NormalizedTrainingCoachInput, signals: string[], nextTarget?: string) {
  if (signals.includes("first_reference")) return "Repite esta base una vez más y busca mantener técnica, carga y repeticiones antes de acelerar la progresión.";
  if (signals.includes("sleep_low_performance_low")) return "No fuerces marcas si el descanso sigue bajo; prioriza técnica y consistencia.";
  if (signals.includes("kg_up_reps_down")) return "Consolida la nueva carga y busca recuperar repeticiones antes de aumentar otra vez el peso.";
  if (signals.includes("strong_exercise_drop")) return nextTarget ?? "Elige el ejercicio con mayor caída y busca igualar el registro anterior.";
  if (signals.includes("same_kg_reps_up")) return "Mantén el peso y confirma la mejora de reps; luego considera una subida pequeña.";
  if (signals.includes("kg_up_reps_up")) return "Consolida una sesión más ese avance antes de aumentar nuevamente la carga.";
  if (signals.includes("volume_down_complete")) return "Recupera volumen de forma gradual sin sacrificar técnica.";
  return "Define una mejora pequeña para la próxima sesión: más reps limpias o una carga levemente superior.";
}

function resolveNextTarget(signals: DetectedSignal[]) {
  const targetSignal = signals.find((signal) =>
    signal.exercise && (signal.id === "strong_exercise_drop" || signal.id === "kg_up_reps_down" || signal.id === "same_kg_reps_up" || signal.id === "kg_up_reps_up")
  );
  if (!targetSignal?.exercise) return undefined;

  const reps = safeNumber(targetSignal.exercise.repsDifference);
  if (targetSignal.id === "kg_up_reps_down") {
    return `Objetivo próximo: sostener la nueva carga en ${targetSignal.exercise.name} y recuperar reps de a poco.`;
  }
  if (reps < 0) return formatRepsRecoveryTarget(Math.abs(reps), targetSignal.exercise.name);
  if (reps > 0) return `Objetivo próximo: sostener el progreso de ${targetSignal.exercise.name} una sesión más.`;
  return `Objetivo próximo: repetir ${targetSignal.exercise.name} con técnica estable.`;
}

function formatRepsRecoveryTarget(lostReps: number, exerciseName: string) {
  const rounded = Math.trunc(Math.abs(lostReps));
  if (rounded <= 1) return `Suma 1 rep más para recuperar tu marca anterior en ${exerciseName}.`;
  return `Suma al menos 1 rep más o intenta recuperar las ${rounded} reps perdidas en ${exerciseName}.`;
}

function resolveConfidence(input: NormalizedTrainingCoachInput, signals: string[]): CoachConfidence {
  if (input.comparisonStatus === "none" || input.exercises.length === 0) return "low";
  if (input.weeklyTrend?.confidence === "high") return "high";
  if (input.weeklyTrend?.confidence === "medium" && input.exercises.length >= 2) return "medium";
  if (signals.includes("first_reference") || input.exercises.length < 2) return "medium";
  return "high";
}

function selectInsights(insights: CoachInsight[], limit: number) {
  return insights
    .sort((a, b) => b.priority - a.priority)
    .filter((insight, index, items) => items.findIndex((item) => item.title === insight.title) === index)
    .slice(0, limit);
}

function compactFeedback(feedback: TrainingCoachFeedback): TrainingCoachFeedback {
  return {
    ...feedback,
    headline: ensureText(feedback.headline, "Coach Organizatech"),
    summary: ensureText(feedback.summary, "Registra más datos para recibir una lectura precisa."),
    nextAdvice: ensureText(feedback.nextAdvice, "Mantén una mejora pequeña y medible en la próxima sesión."),
  };
}

function isStrengthSignal(id: SignalId) {
  return id === "first_reference" || id === "routine_complete" || id === "kg_up_reps_up" || id === "same_kg_reps_up" || id === "volume_up";
}

function isAttentionSignal(id: SignalId) {
  return id === "kg_up_reps_down" || id === "same_kg_reps_down" || id === "volume_down_complete" || id === "strong_exercise_drop" || id === "good_adherence_low_progress";
}

function hasPositiveAndNegative(signals: string[]) {
  return signals.some((id) => isStrengthSignal(id as SignalId)) && signals.some((id) => isAttentionSignal(id as SignalId));
}

function isRoutineComplete(workout: TrainingCoachWorkoutSummary) {
  const completedExercises = safeNumber(workout.completedExercises);
  const totalExercises = safeNumber(workout.totalExercises);
  return totalExercises > 0 && completedExercises >= totalExercises;
}

function sanitizeWorkout(input?: TrainingCoachWorkoutSummary | null): TrainingCoachWorkoutSummary {
  return {
    completedExercises: finiteOrNull(input?.completedExercises),
    totalExercises: finiteOrNull(input?.totalExercises),
    completedSets: finiteOrNull(input?.completedSets),
    totalSets: finiteOrNull(input?.totalSets),
    volumeDifference: finiteOrNull(input?.volumeDifference),
    volumePercentage: finiteOrNull(input?.volumePercentage),
    repsDifference: finiteOrNull(input?.repsDifference),
    kgIncreasedExercises: finiteOrNull(input?.kgIncreasedExercises),
    kgDecreasedExercises: finiteOrNull(input?.kgDecreasedExercises),
  };
}

function sanitizeExercise(input: TrainingCoachExerciseChange): TrainingCoachExerciseChange {
  return {
    id: input.id ?? null,
    name: ensureText(input.name, ""),
    kgDifference: finiteOrNull(input.kgDifference),
    repsDifference: finiteOrNull(input.repsDifference),
    volumeDifference: finiteOrNull(input.volumeDifference),
    volumePercentage: finiteOrNull(input.volumePercentage),
  };
}

function sanitizeReadiness(input?: TrainingCoachReadiness | null): TrainingCoachReadiness {
  return {
    motivation: finiteOrNull(input?.motivation),
    hydration: finiteOrNull(input?.hydration),
    sleep: finiteOrNull(input?.sleep),
    energy: finiteOrNull(input?.energy),
  };
}

function sanitizeWeeklyTrend(input?: TrainingCoachWeeklyTrend | null): TrainingCoachWeeklyTrend | null {
  if (!input) return null;
  const availableWeeks = [...new Set((input.availableWeeks ?? [])
    .map((week) => safeInteger(week))
    .filter((week) => week > 0))]
    .sort((a, b) => a - b);
  const weeks = (input.weeks ?? [])
    .map((week) => ({
      week: safeInteger(week.week),
      totalVolume: finiteOrNull(week.totalVolume),
      totalReps: finiteOrNull(week.totalReps),
      completedExercises: finiteOrNull(week.completedExercises),
      totalExercises: finiteOrNull(week.totalExercises),
      complianceRate: finiteOrNull(week.complianceRate),
      averageKg: finiteOrNull(week.averageKg),
      increasedLoadExercises: finiteOrNull(week.increasedLoadExercises),
    }))
    .filter((week) => week.week > 0)
    .sort((a, b) => a.week - b.week);
  const weekCount = availableWeeks.length > 0 ? availableWeeks.length : weeks.length;
  const firstWeek = availableWeeks[0] ?? weeks[0]?.week ?? null;
  const lastWeek = availableWeeks[availableWeeks.length - 1] ?? weeks[weeks.length - 1]?.week ?? null;
  const phase = sanitizeTrendPhase(input.phase, weekCount);
  const confidence = sanitizeConfidence(input.confidence, weekCount);

  return {
    phase,
    availableWeeks,
    weekCount,
    currentWeek: safeInteger(input.currentWeek),
    currentWeekComplete: typeof input.currentWeekComplete === "boolean" ? input.currentWeekComplete : null,
    isCurrentWeekInProgress: Boolean(input.isCurrentWeekInProgress),
    missingWeeks: [...new Set((input.missingWeeks ?? [])
      .map((week) => safeInteger(week))
      .filter((week) => week > 0))]
      .sort((a, b) => a - b),
    confidence,
    trendWindow: firstWeek && lastWeek && weekCount > 0
      ? {
          firstWeek,
          lastWeek,
          weekCount,
        }
      : null,
    weeks,
  };
}

function sanitizeTrendPhase(phase: TrainingCoachTrendPhase, weekCount: number): TrainingCoachTrendPhase {
  if (phase === "no_history" || phase === "first_reference" || phase === "initial_comparison" || phase === "early_trend" || phase === "reliable_history") {
    return phase;
  }
  if (weekCount <= 0) return "no_history";
  if (weekCount === 1) return "first_reference";
  if (weekCount === 2) return "initial_comparison";
  if (weekCount === 3) return "early_trend";
  return "reliable_history";
}

function sanitizeConfidence(confidence: CoachConfidence, weekCount: number): CoachConfidence {
  if (confidence === "low" || confidence === "medium" || confidence === "high") return confidence;
  if (weekCount >= 4) return "high";
  if (weekCount >= 3) return "medium";
  return "low";
}

function dedupeSignals(signals: DetectedSignal[]) {
  const map = new Map<SignalId, DetectedSignal>();
  for (const signal of signals) {
    const current = map.get(signal.id);
    if (!current || signal.priority > current.priority) map.set(signal.id, signal);
  }
  return [...map.values()];
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function isLow(value: number | null | undefined) {
  return safeNumber(value) > 0 && safeNumber(value) < LOW_READINESS;
}

function isHigh(value: number | null | undefined) {
  return safeNumber(value) >= HIGH_READINESS;
}

function positive(value: number | null | undefined) {
  return safeNumber(value) > 0;
}

function negative(value: number | null | undefined) {
  return safeNumber(value) < 0;
}

function neutral(value: number | null | undefined) {
  return safeNumber(value) === 0;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeInteger(value: unknown) {
  return Number.isInteger(value) ? Number(value) : 0;
}

function averageNumber(values: Array<number | null | undefined>) {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length > 0 ? finite.reduce((total, value) => total + value, 0) / finite.length : null;
}

function percentageChange(first: number | null | undefined, last: number | null | undefined) {
  const initial = safeNumber(first);
  const final = safeNumber(last);
  if (initial <= 0 || !Number.isFinite(initial) || !Number.isFinite(final)) return null;
  return ((final - initial) / initial) * 100;
}

function withinRange(value: number | null | undefined, range: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  return Math.abs(value) <= range;
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function ensureText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function formatSignedPercent(value: number | null | undefined) {
  const number = safeNumber(value);
  const rounded = Math.round(number);
  return `${number > 0 ? "+" : ""}${rounded}%`;
}
