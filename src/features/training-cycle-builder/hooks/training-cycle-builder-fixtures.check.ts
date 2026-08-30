import { TRAINING_CYCLE_WEEK_DAYS } from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import type {
  TrainingCycleBuilderGateway,
  TrainingCycleBuilderInitialViewModel,
  TrainingCycleCatalogExerciseViewModel,
  TrainingCycleDayDraft,
  TrainingCycleExerciseDraft,
  TrainingCycleGenerateSuggestedDraftInput,
  TrainingCycleMuscleGroup,
  TrainingCycleRecommendationViewModel,
  TrainingCycleSetDraft,
  TrainingCycleTechnique,
  TrainingCycleWeekDay,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";

const CONSERVATIVE_RECOMMENDATION: TrainingCycleRecommendationViewModel = {
  hasHistory: false,
  title: "Todavía no tenemos historial de este ejercicio",
  body: "Partimos con una carga conservadora. Ajústala como te acomode y la próxima referencia será más precisa.",
  source: "Sin datos suficientes: sugerencia inicial conservadora.",
};

const HISTORY_RECOMMENDATION: TrainingCycleRecommendationViewModel = {
  hasHistory: true,
  title: "Referencia según tu historial",
  body: "Es una estimación, no una garantía. Puedes aceptarla, modificarla o ignorarla.",
  source: "Basado en tus últimas 3 semanas con este ejercicio.",
  previousPlanLabel: "4×10 · 80 kg",
  achievedLabel: "12 · 11 · 11 · 11 reps",
  estimatedLabel: "≈ 10 reps por serie",
  suggestedKg: "84",
};

function createSets(
  exerciseId: string,
  count: number,
  targetReps: number,
  targetKg: number,
): readonly TrainingCycleSetDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${exerciseId}-set-${index + 1}`,
    targetReps: String(targetReps),
    targetKg: String(targetKg),
    toFailure: false,
    drops: [],
  }));
}

function createExercise(
  id: string,
  name: string,
  muscleGroup: TrainingCycleMuscleGroup,
  count: number,
  targetReps: number,
  targetKg: number,
  technique: TrainingCycleTechnique = "linear",
  videoUrl = "",
  hasHistory = false,
): TrainingCycleExerciseDraft {
  return {
    id,
    source: { kind: "catalog", id },
    name,
    muscleGroup,
    technique,
    videoUrl,
    sets: createSets(id, count, targetReps, targetKg),
    recommendation: hasHistory ? HISTORY_RECOMMENDATION : CONSERVATIVE_RECOMMENDATION,
    recommendationDecision: "idle",
  };
}

function createRoutine(
  day: TrainingCycleWeekDay,
  name: string,
  exercises: readonly TrainingCycleExerciseDraft[],
): TrainingCycleDayDraft {
  return { day, name, exercises };
}

const EMPTY_ROUTINES: Readonly<Record<TrainingCycleWeekDay, TrainingCycleDayDraft>> = {
  monday: createRoutine("monday", "Empuje", [
    createExercise("press-flat", "Press plano con barra", "Pectoral", 4, 10, 80, "linear", "https://youtu.be/AbCdEfGhI_1", true),
    createExercise("press-incline", "Press inclinado con mancuernas", "Pectoral", 4, 12, 28),
    createExercise("press-military", "Press militar", "Hombros", 4, 10, 45, "ascending", "", true),
    createExercise("lateral-raise", "Elevaciones laterales", "Hombros", 3, 15, 10, "descending"),
    createExercise("dips", "Fondos en paralelas", "Tríceps", 3, 12, 0),
    createExercise("triceps-pulley", "Extensión de tríceps en polea", "Tríceps", 3, 15, 25, "drop_set"),
  ]),
  tuesday: createRoutine("tuesday", "Jalón", [
    createExercise("lat-pulldown", "Jalón al pecho", "Dorsal", 4, 10, 60, "linear", "", true),
    createExercise("barbell-row", "Remo con barra", "Dorsal", 4, 10, 70),
    createExercise("barbell-curl", "Curl bíceps con barra", "Bíceps", 3, 12, 30),
  ]),
  wednesday: createRoutine("wednesday", "Piernas", [
    createExercise("squat", "Sentadilla libre", "Cuádriceps", 4, 10, 100, "linear", "", true),
    createExercise("romanian-deadlift", "Peso muerto rumano", "Femoral", 4, 10, 80, "linear", "", true),
    createExercise("leg-extension", "Extensión de cuádriceps", "Cuádriceps", 3, 15, 45),
    createExercise("hip-thrust", "Hip thrust", "Glúteos", 4, 12, 90),
    createExercise("calf-raise", "Elevación de talones sentado", "Pantorrillas", 4, 20, 35),
  ]),
  thursday: createRoutine("thursday", "Empuje ligero", [
    createExercise("press-incline-light", "Press inclinado con mancuernas", "Pectoral", 3, 12, 24),
    createExercise("lateral-raise-light", "Elevaciones laterales", "Hombros", 4, 15, 8),
  ]),
  friday: createRoutine("friday", "Pierna y glúteo", [
    createExercise("bulgarian-split", "Estocadas búlgaras", "Pierna completa", 3, 12, 20),
    createExercise("glute-kickback", "Patada de glúteo en polea", "Glúteos", 3, 15, 20),
    createExercise("romanian-deadlift-friday", "Peso muerto rumano", "Femoral", 4, 10, 75),
  ]),
  saturday: createRoutine("saturday", "", []),
  sunday: createRoutine("sunday", "", []),
};

export const TRAINING_CYCLE_TEST_CATALOG: readonly TrainingCycleCatalogExerciseViewModel[] = [
  ["press-flat", "Press plano con barra", "Pectoral", ["previous", "recent"], true],
  ["press-incline", "Press inclinado con mancuernas", "Pectoral", ["previous", "recent"], false],
  ["cable-fly", "Aperturas en polea", "Pectoral", ["all"], false],
  ["press-military", "Press militar", "Hombros", ["previous", "recent"], true],
  ["lateral-raise", "Elevaciones laterales", "Hombros", ["recent"], false],
  ["dips", "Fondos en paralelas", "Tríceps", ["previous"], false],
  ["triceps-pulley", "Extensión de tríceps en polea", "Tríceps", ["all"], false],
  ["lat-pulldown", "Jalón al pecho", "Dorsal", ["previous", "recent"], true],
  ["barbell-row", "Remo con barra", "Dorsal", ["recent"], false],
  ["barbell-curl", "Curl bíceps con barra", "Bíceps", ["all"], false],
  ["squat", "Sentadilla libre", "Cuádriceps", ["previous", "recent"], true],
  ["bulgarian-split", "Estocadas búlgaras", "Pierna completa", ["recent"], false],
  ["leg-extension", "Extensión de cuádriceps", "Cuádriceps", ["all"], false],
  ["romanian-deadlift", "Peso muerto rumano", "Femoral", ["previous", "recent"], true],
  ["hip-thrust", "Hip thrust", "Glúteos", ["recent"], false],
  ["glute-kickback", "Patada de glúteo en polea", "Glúteos", ["all"], false],
  ["calf-raise", "Elevación de talones sentado", "Pantorrillas", ["all"], false],
].map(([id, name, muscleGroup, sources, hasHistory]) => ({
  id: id as string,
  source: { kind: "catalog" as const, id: id as string },
  name: name as string,
  muscleGroup: muscleGroup as TrainingCycleMuscleGroup,
  sources: sources as readonly ("previous" | "recent" | "all")[],
  recommendation: hasHistory ? HISTORY_RECOMMENDATION : CONSERVATIVE_RECOMMENDATION,
}));

/** Fixture focal explícito; la feature productiva nunca lo importa automáticamente. */
export function createTrainingCycleBuilderTestViewModel(): TrainingCycleBuilderInitialViewModel {
  return {
    todayIsoDate: "2026-10-11",
    activeCycleId: "cycle-local-active",
    activeCycleRevision: "revision-local-1",
    draft: {
      draftId: "cycle-draft-local",
      goal: "volume",
      startDate: "2026-09-01",
      endDate: "2026-10-13",
      selectedDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      routines: EMPTY_ROUTINES,
    },
    catalog: TRAINING_CYCLE_TEST_CATALOG,
    duplicateComparison: [
      { id: "comparison-1", exerciseName: "Press plano", plannedLabel: "4×10 · 80", actualLabel: "4×11 · 80", outcome: "met" },
      { id: "comparison-2", exerciseName: "Press militar", plannedLabel: "4×10 · 45", actualLabel: "4×8 · 45", outcome: "below" },
      { id: "comparison-3", exerciseName: "Sentadilla libre", plannedLabel: "4×10 · 100", actualLabel: "4×11 · 100", outcome: "met" },
      { id: "comparison-4", exerciseName: "Peso muerto rumano", plannedLabel: "4×10 · 80", actualLabel: "4×10 · 80", outcome: "met" },
    ],
    hasRecoverableDraft: true,
    recoveredDraftLabel: "Guardado ayer 21:14 · Fuerza · 4 días",
    saveState: "saved",
    activeCycleDaysRemaining: 2,
    activeCycleElapsedDays: 39,
    activeCycleTotalDays: 42,
    registeredSessions: 32,
    expiryAlerts: [
      { offsetDays: 3, whenLabel: "3 días antes", title: "Quedan 3 días de ciclo", body: "Tu ciclo termina pronto. Si quieres seguir con esta rutina, extiéndelo.", emailEnabled: true },
      { offsetDays: 2, whenLabel: "2 días antes", title: "Quedan 2 días de ciclo", body: "Después del último día el ciclo se cierra y podrás crear el siguiente.", emailEnabled: true },
      { offsetDays: 1, whenLabel: "1 día antes", title: "Mañana termina tu ciclo", body: "Última oportunidad de extenderlo antes de que se cierre.", emailEnabled: true },
      { offsetDays: 0, whenLabel: "El mismo día", title: "Hoy es el último día", body: "Hoy entrenas normal. Mañana el ciclo se cierra automáticamente.", emailEnabled: true },
    ],
    closedSummary: { cycleLabel: "Volumen · 14 jul – 29 ago", completedSessions: 32, plannedSessions: 35 },
    nextSessionLabel: "Mañana · Lunes",
    nextSessionDetail: "Empuje · 6 ejercicios",
  };
}

const TEST_SUGGESTION_SPLITS = [
  ["Full body", "Sentadilla libre", "Pierna completa"],
  ["Torso", "Press plano con barra", "Pectoral"],
  ["Piernas", "Peso muerto rumano", "Femoral"],
  ["Empuje", "Press militar", "Hombros"],
  ["Jalón", "Jalón al pecho", "Dorsal"],
] as const;

/** Motor determinista explícito de test. Su único input son objetivo, días y fechas. */
export function generateTrainingCycleSuggestionForTest(
  input: TrainingCycleGenerateSuggestedDraftInput,
): TrainingCycleBuilderInitialViewModel["draft"] {
  const durationDays = input.durationDays;
  const prescription = {
    strength: { reps: 5, kg: 40, sets: 4 },
    volume: { reps: 10, kg: 30, sets: 4 },
    definition: { reps: 12, kg: 20, sets: 3 },
    deload: { reps: 8, kg: 15, sets: 2 },
  }[input.goal];
  const selected = new Set(input.selectedDays);
  const selectedIndex = new Map(input.selectedDays.map((day, index) => [day, index]));
  const routines = Object.fromEntries(TRAINING_CYCLE_WEEK_DAYS.map((day) => {
    if (!selected.has(day)) return [day, createRoutine(day, "", [])];
    const index = selectedIndex.get(day) ?? 0;
    const split = TEST_SUGGESTION_SPLITS[
      input.selectedDays.length === 1 ? 0 : (index % (TEST_SUGGESTION_SPLITS.length - 1)) + 1
    ];
    const exerciseId = `suggested-${input.goal}-${day}`;
    const setCount = durationDays < 15 ? Math.max(2, prescription.sets - 1) : prescription.sets;
    return [
      day,
      createRoutine(day, split[0], [
        createExercise(
          exerciseId,
          split[1],
          split[2],
          setCount,
          prescription.reps,
          prescription.kg,
        ),
      ]),
    ];
  })) as unknown as Readonly<Record<TrainingCycleWeekDay, TrainingCycleDayDraft>>;
  return {
    draftId: `suggested-test-${input.goal}-${input.startDate}-${input.endDate}`,
    goal: input.goal,
    startDate: input.startDate,
    endDate: input.endDate,
    selectedDays: [...input.selectedDays],
    routines,
  };
}

/** Gateway de test explícito; nunca debe usarse como fallback del boundary productivo. */
export const trainingCycleBuilderTestGateway: TrainingCycleBuilderGateway = {
  async saveDraft() {
    return { status: "saved", savedAtLabel: "Guardado hace un momento" };
  },
  async generateSuggestedDraft(input) {
    return { draft: generateTrainingCycleSuggestionForTest(input) };
  },
  async createCustomExercise(input) {
    return {
      id: "custom-test-id",
      source: { kind: "custom", id: "custom-test-id" },
      name: input.name,
      muscleGroup: input.muscleGroup,
      sources: ["all"],
    };
  },
  async activateCycle() {
    return { cycleId: "cycle-local-active", revision: "revision-local-1", status: "activated" };
  },
  async saveActiveCycle() {
    return { status: "saved", revision: "revision-local-2", savedAtLabel: "Cambios guardados" };
  },
  async extendCycle(input) {
    return { endDate: input.newEndDate, revision: "revision-local-3" };
  },
  async discardDraft() {},
};
