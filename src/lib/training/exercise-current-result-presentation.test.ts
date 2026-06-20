import { strict as assert } from "node:assert";

import { buildExerciseCurrentResultPresentation } from "@/lib/training/exercise-current-result-presentation";

{
  const view = buildExerciseCurrentResultPresentation({
    totalReps: 29,
    targetTotalReps: 30,
    completedSets: 3,
    targetSets: 3,
    actualWeight: 100,
    targetWeight: 100,
  });
  assert.equal(view.headline, "29 de 30 repeticiones");
  assert.equal(view.message, "Te faltó 1 repetición para completar el objetivo de hoy");
  assert.deepEqual(view.items, [
    { label: "Peso", value: "100 kg de 100 kg", detail: "Objetivo alcanzado", tone: "success" },
    { label: "Series", value: "3 de 3", detail: "Completas", tone: "success" },
    { label: "Repeticiones", value: "29 de 30", detail: "Faltó 1", tone: "partial" },
  ]);
}

{
  const view = buildExerciseCurrentResultPresentation({
    totalReps: 27,
    targetTotalReps: 30,
    completedSets: 2,
    targetSets: 3,
    actualWeight: 99,
    targetWeight: 100,
  });
  assert.equal(view.message, "Te faltaron 3 repeticiones para completar el objetivo de hoy");
  assert.equal(view.items.find((item) => item.label === "Peso")?.detail, "1 kg bajo el objetivo");
  assert.equal(view.items.find((item) => item.label === "Series")?.detail, "Faltó 1 serie");
  assert.equal(view.items.find((item) => item.label === "Repeticiones")?.detail, "Faltaron 3");
}

{
  const view = buildExerciseCurrentResultPresentation({
    totalReps: 30,
    targetTotalReps: 30,
    completedSets: 3,
    targetSets: 3,
    actualWeight: 100,
    targetWeight: 100,
  });
  assert.equal(view.tone, "success");
  assert.equal(view.message, "Completaste el objetivo planificado para hoy");
}

{
  const view = buildExerciseCurrentResultPresentation({
    totalReps: 32,
    targetTotalReps: 30,
    completedSets: 4,
    targetSets: 3,
    actualWeight: 102,
    targetWeight: 100,
  });
  assert.equal(view.tone, "improved");
  assert.equal(view.message, "Superaste el objetivo por 2 repeticiones");
  assert.equal(view.items.find((item) => item.label === "Peso")?.detail, "2 kg sobre el objetivo");
  assert.equal(view.items.find((item) => item.label === "Series")?.detail, "1 serie adicional");
  assert.equal(view.items.find((item) => item.label === "Repeticiones")?.detail, "2 adicionales");
}

{
  const view = buildExerciseCurrentResultPresentation({
    totalReps: 33,
    targetTotalReps: 30,
    completedSets: 5,
    targetSets: 3,
    actualWeight: null,
    targetWeight: null,
  });
  assert(!view.items.some((item) => item.label === "Peso"));
  assert.equal(view.items.find((item) => item.label === "Series")?.detail, "2 series adicionales");
}

{
  const view = buildExerciseCurrentResultPresentation({
    totalReps: 29,
    targetTotalReps: null,
    completedSets: null,
    targetSets: null,
    actualWeight: null,
    targetWeight: null,
  });
  assert.equal(view.headline, "29 repeticiones realizadas");
  assert.equal(view.message, "Completa tus series para evaluar el objetivo de hoy");
  assert.equal(view.items[0]?.detail, "Objetivo por rango definido en la rutina");
}

{
  const view = buildExerciseCurrentResultPresentation({
    totalReps: null,
    targetTotalReps: null,
    completedSets: null,
    targetSets: null,
    actualWeight: null,
    targetWeight: null,
  });
  const serialized = JSON.stringify(view);
  assert.equal(view.headline, "Registra tus series para ver el resumen");
  assert(!serialized.includes("0 kg"));
  assert(!serialized.includes("0 series"));
  assert(!serialized.includes("null"));
  assert(!serialized.includes("undefined"));
  assert(!serialized.includes("NaN"));
}

console.log("exercise-current-result-presentation tests passed");
