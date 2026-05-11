import type { ExerciseEntry, ExerciseTemplate } from "@/lib/progress/types";

export const exerciseTemplates: ExerciseTemplate[] = [
  {
    id: "press-banca",
    routine: "Pecho Hombro Tríceps",
    name: "Press Banca",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 90,
    sideWeight: 35,
    notes: "Mejorar técnica; controlar tercera y cuarta serie.",
  },
  {
    id: "peso-muerto",
    routine: "Espalda Bíceps Abdomen",
    name: "Peso Muerto",
    targetSets: 4,
    targetReps: 9,
    baseWeight: 140,
    notes: "Priorizar tensión y recorrido estable.",
  },
  {
    id: "sentadilla",
    routine: "Piernas",
    name: "Sentadilla",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 120,
    notes: "Mantener profundidad y braceo.",
  },
  {
    id: "press-militar",
    routine: "Pecho Hombro Tríceps",
    name: "Press Militar",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 40,
    notes: "Fatiga posible; evaluar deload si cae otra semana.",
  },
  {
    id: "dominadas",
    routine: "Espalda Bíceps Abdomen",
    name: "Dominadas",
    targetSets: 4,
    targetReps: 8,
    baseWeight: 0,
    notes: "Peso corporal.",
  },
];

const weekDates: Record<number, string> = {
  1: "2026-05-03",
  2: "2026-05-10",
  3: "2026-05-17",
  4: "2026-05-24",
};

export const demoEntries: ExerciseEntry[] = [
  entry("press-banca", 1, 75, 75, [8, 7, 7, 6]),
  entry("press-banca", 2, 80, 75, [8, 8, 8, 7]),
  entry("press-banca", 3, 85, 80, [10, 10, 9, 9]),
  entry("press-banca", 4, 90, 85, [12, 11, 10, 9], "RIR 1-2"),
  entry("peso-muerto", 1, 120, 120, [8, 7, 7, 6]),
  entry("peso-muerto", 2, 130, 120, [8, 8, 7, 7]),
  entry("peso-muerto", 3, 130, 130, [10, 10, 9, 8]),
  entry("peso-muerto", 4, 140, 130, [10, 9, 8, 8], "RIR 1-2"),
  entry("sentadilla", 1, 105, 105, [8, 7, 7, 6]),
  entry("sentadilla", 2, 110, 105, [9, 8, 8, 7]),
  entry("sentadilla", 3, 115, 110, [10, 9, 9, 8]),
  entry("sentadilla", 4, 120, 115, [10, 10, 9, 8], "RIR 1-3"),
  entry("press-militar", 1, 35, 35, [10, 10, 9, 8]),
  entry("press-militar", 2, 40, 35, [10, 9, 9, 8]),
  entry("press-militar", 3, 42, 40, [9, 8, 8, 7]),
  entry("press-militar", 4, 40, 42, [8, 8, 7, 7], "RIR 2"),
  entry("dominadas", 1, 0, 0, [7, 7, 6, 6]),
  entry("dominadas", 2, 0, 0, [8, 7, 7, 6]),
  entry("dominadas", 3, 0, 0, [8, 8, 7, 7]),
  entry("dominadas", 4, 0, 0, [9, 8, 8, 7]),
];

function entry(exerciseId: string, week: number, weight: number, previousWeight: number, reps: number[], rir?: string): ExerciseEntry {
  const template = exerciseTemplates.find((exercise) => exercise.id === exerciseId);
  if (!template) throw new Error(`Ejercicio demo no encontrado: ${exerciseId}`);

  return {
    id: `${exerciseId}-s${week}`,
    exerciseId,
    exerciseName: template.name,
    routine: template.routine,
    week,
    date: weekDates[week],
    targetSets: template.targetSets,
    targetReps: template.targetReps,
    weight,
    previousWeight,
    reps,
    notes: template.notes,
    rir,
  };
}
