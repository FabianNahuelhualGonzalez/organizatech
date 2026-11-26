import type { TrainingCycleRpcDayPlan, TrainingCycleRpcExercisePlan, TrainingCycleRpcPlan,
  TrainingCycleRpcSnapshot, TrainingCycleSnapshotExercise } from
  "@/features/training-cycle-builder/data/training-cycle-rpc-types";

export function editableExercise(source: TrainingCycleSnapshotExercise): TrainingCycleRpcExercisePlan {
  return {
    ...(source.source.kind === "catalog" ? { catalogExerciseId: source.source.id }
      : { customExerciseId: source.source.id }),
    order: source.order, technique: source.technique, videoUrl: source.videoUrl,
    sets: source.sets.map((set) => ({ order: set.order, targetReps: set.targetReps,
      targetKg: set.targetKg, toFailure: set.toFailure,
      drops: set.drops.map((drop) => ({ order: drop.order, kg: drop.kg, reps: drop.reps })) })),
  };
}

export function editablePlan(snapshot: TrainingCycleRpcSnapshot): TrainingCycleRpcPlan {
  return {
    ...(snapshot.plan.scheduleMode === "flexible" ? { scheduleMode: "flexible" as const } : {}),
    days: snapshot.plan.days.map((day) => ({ day: day.day, name: day.name,
      order: day.order, exercises: day.exercises.map(editableExercise) })),
  };
}

export function replaceRoutine(plan: TrainingCycleRpcPlan, index: number,
  next: TrainingCycleRpcDayPlan | null): TrainingCycleRpcPlan {
  const days = [...plan.days];
  if (next === null) days.splice(index, 1);
  else if (index === days.length) days.push(next);
  else days[index] = next;
  return { ...(plan.scheduleMode ? { scheduleMode: plan.scheduleMode } : {}),
    days: days.map((day, order) => ({ ...day, order })) };
}
