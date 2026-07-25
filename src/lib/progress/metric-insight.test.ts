import assert from "node:assert/strict";

import {
  buildMetricInsight,
  formatMetricDifference,
} from "@/lib/progress/metric-insight";

assert.equal(formatMetricDifference(null, "kg"), "—");
assert.equal(formatMetricDifference(2.345, "kg"), "+2,35 kg");
assert.equal(formatMetricDifference(-3, "reps"), "-3 repes");
assert.equal(formatMetricDifference(0, "reps"), "0 repes");

assert.equal(
  buildMetricInsight(null, "kg"),
  "Aún no hay información suficiente para comparar este ejercicio.",
);
assert.equal(
  buildMetricInsight(2.5, "kg"),
  "Aumentaste +2,5kg desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.",
);
assert.equal(
  buildMetricInsight(-3, "reps"),
  "Bajaste -3 repes desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.",
);
assert.equal(
  buildMetricInsight(0, "kg"),
  "Mantienes el mismo peso desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.",
);
assert.equal(
  buildMetricInsight(0, "reps"),
  "Mantienes las mismas repeticiones desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.",
);
assert.equal(
  buildMetricInsight(2.5, "kg"),
  buildMetricInsight(2.5, "kg"),
  "la presentacion es determinista",
);

console.log("metric-insight tests passed");
