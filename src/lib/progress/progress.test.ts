import assert from "node:assert/strict";
import { calculateExerciseMetrics, calculateObjectiveStatus, calculateWeeklySummary } from "./calculations";
import { buildExerciseComparisonSummary } from "./exercise-history";
import { formatKg, formatSignedKg, parseDecimalWeightInput } from "./weight-format";

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

const decimalMetric = calculateExerciseMetrics({
  id: "decimal",
  exerciseId: "press-decimal",
  exerciseName: "Press decimal",
  routine: "Pecho",
  week: 1,
  date: "2026-06-15",
  targetSets: 2,
  targetReps: 10,
  weight: 12.5,
  previousWeight: 12,
  reps: [10, 10],
});

assert.equal(parseDecimalWeightInput("2.5"), 2.5, "acepta punto decimal");
assert.equal(parseDecimalWeightInput("2,5"), 2.5, "acepta coma decimal");
assert.equal(parseDecimalWeightInput("12,25"), 12.25, "preserva dos decimales con coma");
assert.equal(parseDecimalWeightInput("2,5,5"), null, "rechaza mas de un separador decimal");
assert.equal(parseDecimalWeightInput("abc"), null, "rechaza texto no numerico");
assert.equal(decimalMetric.kgDifference, 0.5, "calcula subida decimal de peso");
assert.equal(decimalMetric.volumeTotal, 250, "calcula volumen con peso decimal");
assert.equal(formatKg(12.5), "12,5 kg", "formatea peso decimal con coma");
assert.equal(formatKg(2), "2 kg", "evita ceros decimales innecesarios");
assert.equal(formatSignedKg(-0.5), "-0,5 kg", "formatea bajada decimal sin error de precision");

const maintained = calculateExerciseMetrics({
  id: "2",
  exerciseId: "crossover",
  exerciseName: "Inclinado crossover",
  routine: "Pecho Hombro Tríceps",
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

const improvedHistory = buildExerciseComparisonSummary([
  makeHistoryMetric("sentadilla-1", 1, "2026-03-12", 100, [12]),
  makeHistoryMetric("sentadilla-2", 5, "2026-05-18", 150, [6]),
]);
assert.equal(improvedHistory?.weightGain, 50, "calcula ganancia total de peso");
assert.equal(improvedHistory?.trend, "Mejora", "detecta mejora cuando sube el peso");
assert.match(improvedHistory?.insight ?? "", /mejora clara|mejora sostenida/i, "contextualiza reps menores con más carga");

const maintainedHistory = buildExerciseComparisonSummary([
  makeHistoryMetric("press-1", 1, "2026-03-12", 100, [10]),
  makeHistoryMetric("press-2", 2, "2026-03-19", 100, [10]),
]);
assert.equal(maintainedHistory?.weightGain, 0, "calcula peso mantenido");
assert.equal(maintainedHistory?.trend, "Mantenimiento", "detecta mantenimiento");

const regressionHistory = buildExerciseComparisonSummary([
  makeHistoryMetric("deadlift-1", 1, "2026-03-12", 120, [10]),
  makeHistoryMetric("deadlift-2", 2, "2026-03-19", 100, [10]),
]);
assert.equal(regressionHistory?.weightGain, -20, "calcula retroceso de peso");
assert.equal(regressionHistory?.trend, "Retroceso", "detecta retroceso");

const singleHistory = buildExerciseComparisonSummary([
  makeHistoryMetric("row-1", 1, "2026-03-12", 100, [12]),
]);
assert.equal(singleHistory?.weightGain, 0, "un solo registro no tiene ganancia");
assert.equal(singleHistory?.trend, "Información insuficiente", "un solo registro no fuerza tendencia");

console.log("Pruebas de progreso OK");

function makeHistoryMetric(id: string, week: number, date: string, weight: number, reps: number[]) {
  return calculateExerciseMetrics({
    id,
    exerciseId: id.split("-")[0],
    exerciseName: "Sentadilla",
    routine: "Piernas",
    week,
    date,
    targetSets: reps.length,
    targetReps: 10,
    weight,
    previousWeight: weight,
    reps,
  });
}
