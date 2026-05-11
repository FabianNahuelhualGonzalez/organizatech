import assert from "node:assert/strict";
import { calculateExerciseMetrics, calculateObjectiveStatus } from "./calculations";

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

console.log("Pruebas de progreso OK");
