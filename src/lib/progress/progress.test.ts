import assert from "node:assert/strict";
import { calculateExerciseMetrics, calculateObjectiveStatus, calculateWeeklySummary } from "./calculations";

assert.equal(calculateObjectiveStatus(2, 0), "Cumplimos", "clasifica Cumplimos si suben repeticiones");

assert.equal(calculateObjectiveStatus(-2, 5), "Cumplimos", "clasifica Cumplimos si sube carga aunque bajen repeticiones");

assert.equal(calculateObjectiveStatus(0, -5), "No cumplimos", "clasifica No cumplimos si baja la carga");

const result = calculateExerciseMetrics({
  id: "1",
  exerciseId: "press",
  exerciseName: "Press Banca",
  routine: "Pecho Hombro Tríceps",
  week: 4,
  date: "2026-05-24",
  targetSets: 4,
  targetReps: 10,
  weight: 90,
  previousWeight: 85,
  reps: [12, 11, 10, 9],
});

assert.equal(result.totalReps, 42, "calcula total de repeticiones");
assert.equal(result.volumeTotal, 3780, "calcula volumen como reps por peso");
assert.equal(result.objectiveStatus, "Cumplimos", "clasifica progreso combinado");

const maintained = calculateExerciseMetrics({
  id: "2",
  exerciseId: "crossover",
  exerciseName: "Inclinado crossover",
  routine: "Pecho Hombro TrÃ­ceps",
  week: 1,
  date: "2026-05-13",
  targetSets: 4,
  targetReps: 10,
  weight: 45,
  previousWeight: 45,
  reps: [10, 10, 10, 10],
});

const firstWeekSummary = calculateWeeklySummary([result, maintained], 4);
assert.equal(firstWeekSummary.repsDifference, 2, "compara reps contra objetivo cuando no hay semana anterior");
assert.equal(firstWeekSummary.exerciseDifference, 0, "no cuenta objetivos cumplidos como ejercicios nuevos");

console.log("Pruebas de progreso OK");
