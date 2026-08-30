import type { ExerciseEntry } from "@/lib/progress/types";

import {
  TRAINING_CYCLE_WEEK_DAYS,
  type TrainingCycleBuilderInitialViewModel,
  type TrainingCycleCatalogExerciseViewModel,
  type TrainingCycleDayDraft,
  type TrainingCycleDraftViewModel,
  type TrainingCycleExerciseDraft,
  type TrainingCycleExerciseSource,
  type TrainingCycleRecommendationViewModel,
  type TrainingCycleSetDraft,
  type TrainingCycleWeekDay,
} from "../components/training-cycle-builder-contracts";
import {
  rpcMuscleToCanonical,
  rpcMuscleToUi,
} from "../data/training-cycle-rpc-mappers";
import type {
  TrainingCycleCatalogItem,
  TrainingCycleDraftSnapshot,
  TrainingCycleRpcExercisePlan,
  TrainingCycleRpcPlan,
  TrainingCycleRpcSnapshot,
  TrainingCycleSnapshotExercise,
} from "../data/training-cycle-rpc-types";
import {
  recommendLoadFromRecentHistory,
  type ExerciseHistoryObservation,
} from "../model/recommendations";
import type { ExerciseDraft as DomainExerciseDraft } from "../model/types";

const NO_HISTORY_RECOMMENDATION: TrainingCycleRecommendationViewModel = Object.freeze({
  hasHistory: false,
  title: "Todavía no tenemos historial de este ejercicio",
  body: "Puedes definir la carga manualmente. Cuando existan sesiones comparables mostraremos una referencia.",
  source: "Sin datos suficientes para calcular una sugerencia.",
});

export interface BuildTrainingCycleProductViewModelInput {
  readonly todayIsoDate: string;
  readonly catalog: readonly TrainingCycleCatalogItem[];
  readonly entries: readonly ExerciseEntry[];
  readonly activeCycle: TrainingCycleRpcSnapshot | null;
  readonly draft: TrainingCycleDraftSnapshot | null;
  readonly sourceCycle: TrainingCycleRpcSnapshot | null;
  readonly lastCycle: TrainingCycleRpcSnapshot | null;
}

function sourceKey(source: TrainingCycleExerciseSource) {
  return `${source.kind}:${source.id}`;
}

function sameSource(
  left: TrainingCycleExerciseSource,
  right: TrainingCycleExerciseSource,
) {
  return left.kind === right.kind && left.id === right.id;
}

function rpcExerciseSource(exercise: TrainingCycleRpcExercisePlan): TrainingCycleExerciseSource {
  return exercise.catalogExerciseId
    ? { kind: "catalog", id: exercise.catalogExerciseId }
    : { kind: "custom", id: exercise.customExerciseId as string };
}

function addCalendarDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function cycleDurationDays(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function emptyRoutines(): Readonly<Record<TrainingCycleWeekDay, TrainingCycleDayDraft>> {
  return Object.fromEntries(TRAINING_CYCLE_WEEK_DAYS.map((day) => [
    day,
    { day, name: "", exercises: [] },
  ])) as unknown as Readonly<Record<TrainingCycleWeekDay, TrainingCycleDayDraft>>;
}

function findSnapshotExercise(
  snapshot: TrainingCycleRpcSnapshot | null,
  dayCode: string,
  exercise: TrainingCycleRpcExercisePlan,
): TrainingCycleSnapshotExercise | null {
  const day = snapshot?.plan.days.find((candidate) => candidate.day === dayCode);
  if (!day) return null;
  const source = rpcExerciseSource(exercise);
  return day.exercises.find((candidate) => (
    candidate.order === exercise.order && sameSource(candidate.source, source)
  )) ?? null;
}

function comparableEntries(
  entries: readonly ExerciseEntry[],
  snapshotExercise: TrainingCycleSnapshotExercise | null,
) {
  if (!snapshotExercise) return [];
  return entries.filter((entry) => {
    if (entry.exerciseLineageId && entry.exerciseLineageId === snapshotExercise.exerciseLineageId) {
      return true;
    }
    return Boolean(
      snapshotExercise.legacyCycleExerciseId
      && entry.trainingCycleExerciseId === snapshotExercise.legacyCycleExerciseId,
    );
  });
}

function toHistory(entries: readonly ExerciseEntry[]): readonly ExerciseHistoryObservation[] {
  return entries.flatMap((entry) => {
    const sessionId = entry.sessionId?.trim() || entry.id.trim();
    if (!sessionId || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return [];
    return entry.reps.flatMap((completedReps) => {
      if (!Number.isSafeInteger(completedReps) || completedReps < 1) return [];
      if (!Number.isFinite(entry.weight) || entry.weight < 0) return [];
      return [{
        sessionId,
        performedOn: entry.date,
        loadKg: entry.weight,
        completedReps,
        toFailure: entry.rir?.trim() === "0",
      }];
    });
  });
}

function buildRecommendation(input: {
  readonly exerciseId: string;
  readonly source: TrainingCycleExerciseSource;
  readonly name: string;
  readonly muscleGroup: TrainingCycleCatalogItem["muscleGroup"];
  readonly snapshotExercise: TrainingCycleSnapshotExercise | null;
  readonly sets: readonly TrainingCycleSetDraft[];
  readonly goal: TrainingCycleDraftViewModel["goal"];
  readonly todayIsoDate: string;
  readonly entries: readonly ExerciseEntry[];
}): TrainingCycleRecommendationViewModel {
  const historyEntries = comparableEntries(input.entries, input.snapshotExercise);
  if (!input.snapshotExercise || historyEntries.length === 0) return NO_HISTORY_RECOMMENDATION;
  const domainExercise: DomainExerciseDraft = {
    id: input.exerciseId,
    sourceExerciseId: input.snapshotExercise.exerciseLineageId,
    source: input.source.kind === "catalog"
      ? { kind: "catalog", catalogExerciseId: input.source.id }
      : { kind: "custom", customExerciseId: input.source.id },
    name: input.name,
    primaryMuscleGroup: rpcMuscleToCanonical(input.muscleGroup),
    loadBasis: "external",
    order: input.snapshotExercise.order + 1,
    technique: input.snapshotExercise.technique,
    videoUrl: input.snapshotExercise.videoUrl,
    sets: input.sets.map((set, index) => ({
      id: set.id,
      sourceSetId: input.snapshotExercise?.sets[index]?.snapshotId ?? null,
      order: index + 1,
      targetReps: Number(set.targetReps),
      targetKg: Number(set.targetKg),
      toFailure: set.toFailure,
      drops: set.drops.map((drop, dropIndex) => ({
        id: drop.id,
        sourceDropId: input.snapshotExercise?.sets[index]?.drops[dropIndex]?.snapshotId ?? null,
        order: dropIndex + 1,
        kg: Number(drop.targetKg),
        reps: Number(drop.targetReps),
      })),
    })),
  };
  const recommendation = recommendLoadFromRecentHistory({
    exercise: domainExercise,
    goal: input.goal,
    asOfDate: input.todayIsoDate,
    history: toHistory(historyEntries),
  });
  if (!recommendation.available) return NO_HISTORY_RECOMMENDATION;
  const latest = [...historyEntries]
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))[0];
  return {
    hasHistory: true,
    title: "Referencia según tu historial",
    body: "Es una estimación, no una garantía. Puedes aceptarla, modificarla o ignorarla.",
    source: `${recommendation.source.sessionCount} sesiones y ${recommendation.source.sampleCount} series comparables de los últimos ${recommendation.source.windowDays} días.`,
    previousPlanLabel: `${input.sets.length} series · ${input.sets[0]?.targetKg ?? "0"} kg`,
    achievedLabel: latest?.reps.join(" · ") ?? undefined,
    estimatedLabel: `Confianza ${recommendation.confidence}`,
    suggestedKg: String(recommendation.setRecommendations[0]?.suggestedLoadKg ?? ""),
    suggestedSets: recommendation.setRecommendations.map((set) => ({
      order: set.order,
      targetReps: set.targetReps,
      suggestedKg: String(set.suggestedLoadKg),
    })),
  };
}

function projectRpcPlan(input: {
  readonly draftId: string;
  readonly goal: TrainingCycleDraftViewModel["goal"];
  readonly startDate: string;
  readonly endDate: string;
  readonly plan: TrainingCycleRpcPlan;
  readonly catalogBySource: ReadonlyMap<string, TrainingCycleCatalogItem>;
  readonly sourceCycle: TrainingCycleRpcSnapshot | null;
  readonly entries: readonly ExerciseEntry[];
  readonly todayIsoDate: string;
}): TrainingCycleDraftViewModel {
  const routines = { ...emptyRoutines() };
  const selectedDays: TrainingCycleWeekDay[] = [];
  for (const day of [...input.plan.days].sort((left, right) => left.order - right.order)) {
    selectedDays.push(day.day);
    const exercises = [...day.exercises]
      .sort((left, right) => left.order - right.order)
      .map((exercise): TrainingCycleExerciseDraft => {
        const source = rpcExerciseSource(exercise);
        const catalogItem = input.catalogBySource.get(sourceKey(source));
        const snapshotExercise = findSnapshotExercise(input.sourceCycle, day.day, exercise);
        if (!catalogItem && !snapshotExercise) {
          throw new Error("training-cycle-unresolved-exercise-source");
        }
        const exerciseId = snapshotExercise?.snapshotId
          ?? `${input.draftId}:${day.day}:exercise:${exercise.order + 1}`;
        const sets = [...exercise.sets]
          .sort((left, right) => left.order - right.order)
          .map((set): TrainingCycleSetDraft => ({
            id: snapshotExercise?.sets.find((candidate) => candidate.order === set.order)?.snapshotId
              ?? `${exerciseId}:set:${set.order + 1}`,
            targetReps: String(set.targetReps),
            targetKg: String(set.targetKg),
            toFailure: set.toFailure,
            drops: [...set.drops].sort((left, right) => left.order - right.order).map((drop) => ({
              id: snapshotExercise?.sets.find((candidate) => candidate.order === set.order)
                ?.drops.find((candidate) => candidate.order === drop.order)?.snapshotId
                ?? `${exerciseId}:set:${set.order + 1}:drop:${drop.order + 1}`,
              targetKg: String(drop.kg),
              targetReps: String(drop.reps),
            })),
          }));
        const name = snapshotExercise?.name ?? catalogItem?.name ?? "";
        const muscleGroup = snapshotExercise?.muscleGroup ?? catalogItem?.muscleGroup;
        if (!name || !muscleGroup) throw new Error("training-cycle-unresolved-exercise-source");
        return {
          id: exerciseId,
          source,
          name,
          muscleGroup: rpcMuscleToUi(muscleGroup),
          technique: exercise.technique,
          videoUrl: exercise.videoUrl ?? catalogItem?.videoUrl ?? "",
          sets,
          recommendation: buildRecommendation({
            exerciseId,
            source,
            name,
            muscleGroup,
            snapshotExercise,
            sets,
            goal: input.goal,
            todayIsoDate: input.todayIsoDate,
            entries: input.entries,
          }),
          recommendationDecision: "idle",
        };
      });
    routines[day.day] = { day: day.day, name: day.name, exercises };
  }
  return {
    draftId: input.draftId,
    goal: input.goal,
    startDate: input.startDate,
    endDate: input.endDate,
    selectedDays,
    routines,
  };
}

function snapshotPlanAsRpc(snapshot: TrainingCycleRpcSnapshot): TrainingCycleRpcPlan {
  return {
    days: snapshot.plan.days.map((day) => ({
      day: day.day,
      name: day.name,
      order: day.order,
      exercises: day.exercises.map((exercise) => ({
        ...(exercise.source.kind === "catalog"
          ? { catalogExerciseId: exercise.source.id }
          : { customExerciseId: exercise.source.id }),
        order: exercise.order,
        technique: exercise.technique,
        videoUrl: exercise.videoUrl,
        sets: exercise.sets.map((set) => ({
          order: set.order,
          targetReps: set.targetReps,
          targetKg: set.targetKg,
          toFailure: set.toFailure,
          drops: set.drops.map((drop) => ({ order: drop.order, kg: drop.kg, reps: drop.reps })),
        })),
      })),
    })),
  };
}

function buildComparison(
  snapshot: TrainingCycleRpcSnapshot | null,
  entries: readonly ExerciseEntry[],
) {
  if (!snapshot) return [];
  return snapshot.plan.days.flatMap((day) => day.exercises).slice(0, 12).map((exercise) => {
    const matching = comparableEntries(entries, exercise)
      .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
    const latest = matching[0];
    const plannedReps = exercise.sets.reduce((sum, set) => sum + set.targetReps, 0);
    const actualReps = latest?.reps.reduce((sum, reps) => sum + Math.max(0, reps), 0) ?? 0;
    return {
      id: exercise.snapshotId,
      exerciseName: exercise.name,
      plannedLabel: `${exercise.sets.length} series · ${plannedReps} reps`,
      actualLabel: latest ? `${latest.reps.join(" · ")} reps` : "Sin registro comparable",
      outcome: actualReps >= plannedReps ? "met" as const : "below" as const,
    };
  });
}

function buildCatalog(
  catalog: readonly TrainingCycleCatalogItem[],
  sourceCycle: TrainingCycleRpcSnapshot | null,
  entries: readonly ExerciseEntry[],
): readonly TrainingCycleCatalogExerciseViewModel[] {
  const previousSources = new Set(
    sourceCycle?.plan.days.flatMap((day) => day.exercises.map((exercise) => sourceKey(exercise.source))) ?? [],
  );
  const recentLineages = new Set(entries.flatMap((entry) => entry.exerciseLineageId ? [entry.exerciseLineageId] : []));
  const recentSources = new Set(sourceCycle?.plan.days.flatMap((day) => day.exercises.flatMap((exercise) => (
    recentLineages.has(exercise.exerciseLineageId) ? [sourceKey(exercise.source)] : []
  ))) ?? []);
  return catalog.map((item) => ({
    id: item.source.id,
    source: item.source,
    name: item.name,
    muscleGroup: rpcMuscleToUi(item.muscleGroup),
    sources: [
      ...(previousSources.has(sourceKey(item.source)) ? ["previous" as const] : []),
      ...(recentSources.has(sourceKey(item.source)) ? ["recent" as const] : []),
      "all" as const,
    ],
  }));
}

function formatCycleLabel(snapshot: TrainingCycleRpcSnapshot | null) {
  if (!snapshot) return "Sin ciclo anterior";
  return `${snapshot.goal} · ${snapshot.startDate} – ${snapshot.endDate}`;
}

export function buildTrainingCycleProductViewModel(
  input: BuildTrainingCycleProductViewModelInput,
): TrainingCycleBuilderInitialViewModel {
  const catalogBySource = new Map(input.catalog.map((item) => [sourceKey(item.source), item]));
  const effectiveSource = input.activeCycle ?? input.sourceCycle ?? input.lastCycle;
  const draft = input.activeCycle
    ? projectRpcPlan({
        draftId: input.activeCycle.sourceDraftId ?? input.activeCycle.cycleId,
        goal: input.activeCycle.goal,
        startDate: input.activeCycle.startDate,
        endDate: input.activeCycle.endDate,
        plan: snapshotPlanAsRpc(input.activeCycle),
        catalogBySource,
        sourceCycle: input.activeCycle,
        entries: input.entries,
        todayIsoDate: input.todayIsoDate,
      })
    : input.draft
      ? projectRpcPlan({
          draftId: input.draft.draftId,
          goal: input.draft.goal,
          startDate: input.draft.startDate,
          endDate: input.draft.endDate,
          plan: input.draft.plan,
          catalogBySource,
          sourceCycle: input.sourceCycle,
          entries: input.entries,
          todayIsoDate: input.todayIsoDate,
        })
      : effectiveSource
        ? projectRpcPlan({
            draftId: `local:${effectiveSource.cycleId}`,
            goal: effectiveSource.goal,
            startDate: addCalendarDays(input.todayIsoDate, 1),
            endDate: addCalendarDays(
              input.todayIsoDate,
              cycleDurationDays(effectiveSource.startDate, effectiveSource.endDate) + 1,
            ),
            plan: snapshotPlanAsRpc(effectiveSource),
            catalogBySource,
            sourceCycle: effectiveSource,
            entries: input.entries,
            todayIsoDate: input.todayIsoDate,
          })
        : {
            draftId: `local:${input.todayIsoDate}`,
            goal: "volume" as const,
            startDate: addCalendarDays(input.todayIsoDate, 1),
            endDate: addCalendarDays(input.todayIsoDate, 43),
            selectedDays: [],
            routines: emptyRoutines(),
          };
  const sessionsForCycle = new Set(input.entries.flatMap((entry) => (
    effectiveSource && entry.cycleId === effectiveSource.cycleId
      ? [entry.sessionId?.trim() || entry.id]
      : []
  )));
  const durationDays = effectiveSource
    ? cycleDurationDays(effectiveSource.startDate, effectiveSource.endDate)
    : cycleDurationDays(draft.startDate, draft.endDate);
  const plannedSessions = Math.max(
    draft.selectedDays.length,
    Math.ceil(durationDays / 7) * draft.selectedDays.length,
  );
  return {
    initialScreen: input.activeCycle ? "active" : "start",
    origin: input.draft ? "resume" : effectiveSource ? "duplicate" : "manual",
    todayIsoDate: input.todayIsoDate,
    activeCycleId: input.activeCycle?.cycleId ?? null,
    activeCycleRevision: input.activeCycle ? String(input.activeCycle.version) : null,
    draft,
    catalog: buildCatalog(input.catalog, effectiveSource, input.entries),
    duplicateComparison: buildComparison(effectiveSource, input.entries),
    hasRecoverableDraft: Boolean(input.draft && !input.activeCycle),
    recoveredDraftLabel: input.draft
      ? `${input.draft.goal} · ${input.draft.startDate} – ${input.draft.endDate}`
      : undefined,
    saveState: "saved",
    activeCycleDaysRemaining: input.activeCycle?.daysUntilEnd,
    activeCycleElapsedDays: input.activeCycle
      ? Math.max(0, cycleDurationDays(input.activeCycle.startDate, input.todayIsoDate))
      : undefined,
    activeCycleTotalDays: input.activeCycle
      ? cycleDurationDays(input.activeCycle.startDate, input.activeCycle.endDate)
      : undefined,
    registeredSessions: sessionsForCycle.size,
    expiryAlerts: [
      { offsetDays: 3, whenLabel: "3 días antes", title: "Quedan 3 días de ciclo", body: "Tu ciclo termina pronto. Si quieres seguir con esta rutina, extiéndelo.", emailEnabled: true },
      { offsetDays: 2, whenLabel: "2 días antes", title: "Quedan 2 días de ciclo", body: "Después del último día el ciclo se cierra y podrás crear el siguiente.", emailEnabled: true },
      { offsetDays: 1, whenLabel: "1 día antes", title: "Mañana termina tu ciclo", body: "Última oportunidad de extenderlo antes de que se cierre.", emailEnabled: true },
      { offsetDays: 0, whenLabel: "El mismo día", title: "Hoy es el último día", body: "Hoy entrenas normal. Mañana el ciclo se cierra automáticamente.", emailEnabled: true },
    ],
    closedSummary: {
      cycleLabel: formatCycleLabel(input.lastCycle ?? effectiveSource),
      completedSessions: sessionsForCycle.size,
      plannedSessions,
    },
    nextSessionLabel: draft.selectedDays[0] ?? "Sin día seleccionado",
    nextSessionDetail: draft.selectedDays[0]
      ? `${draft.routines[draft.selectedDays[0]].name || "Rutina"} · ${draft.routines[draft.selectedDays[0]].exercises.length} ejercicios`
      : "Define tus días y ejercicios",
  };
}

export function findTrainingCycleSourceCycleId(input: {
  readonly draft: TrainingCycleDraftSnapshot | null;
  readonly lastCycle: TrainingCycleRpcSnapshot | null;
}) {
  return input.draft?.sourceCycleId ?? input.lastCycle?.cycleId ?? null;
}
