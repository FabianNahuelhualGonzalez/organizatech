import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingCycleCatalogItem } from "../data/training-cycle-rpc-types";
import { DEFAULT_EXERCISE_CATALOG } from "../model/catalog";
import { canonicalMuscleToRpc } from "../data/training-cycle-rpc-mappers";
import { generateProductTrainingCycleSuggestion } from "./training-cycle-product-suggestion";

const catalog: readonly TrainingCycleCatalogItem[] = DEFAULT_EXERCISE_CATALOG.entries.map((item, index) => ({
  source: { kind: "catalog", id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` },
  name: item.canonicalName,
  muscleGroup: canonicalMuscleToRpc(item.primaryMuscleGroup),
  videoUrl: item.videoUrl,
}));

test("la rutina sugerida conserva criterios y reemplaza slugs por UUID reales", () => {
  const result = generateProductTrainingCycleSuggestion({
    goal: "volume",
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    durationDays: 42,
    selectedDays: ["monday", "wednesday", "friday"],
  }, catalog);
  assert.equal(result.goal, "volume");
  assert.deepEqual(result.selectedDays, ["monday", "wednesday", "friday"]);
  assert.ok(result.routines.monday.exercises.length > 0);
  assert.match(result.routines.monday.exercises[0]?.source.id ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal(result.routines.monday.exercises[0]?.sets[0]?.targetKg, "0");
});

test("falla cerrado cuando el backend no tiene un ejercicio de la plantilla", () => {
  assert.throws(() => generateProductTrainingCycleSuggestion({
    goal: "strength",
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    durationDays: 42,
    selectedDays: ["monday"],
  }, catalog.filter((item) => item.name !== "Plancha")), /catalog-mismatch/);
});
