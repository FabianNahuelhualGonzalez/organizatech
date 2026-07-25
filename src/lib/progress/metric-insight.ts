import { formatSigned } from "@/lib/progress/calculations";
import { formatDecimalEs } from "@/lib/progress/weight-format";

export type ProgressMetric = "kg" | "reps";

export function formatMetricDifference(value: number | null, metric: ProgressMetric) {
  if (value === null) return "—";
  const suffix = metric === "kg" ? "kg" : "repes";
  return `${formatSigned(value, metric === "kg" ? 2 : 0)} ${suffix}`;
}

export function buildMetricInsight(value: number | null, metric: ProgressMetric) {
  if (value === null) return "Aún no hay información suficiente para comparar este ejercicio.";
  const absolute = Math.abs(value);
  const label = metric === "kg" ? `${formatDecimalEs(absolute)}kg` : `${formatDecimalEs(absolute)} repes`;
  if (value > 0) return `Aumentaste +${label} desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.`;
  if (value < 0) return `Bajaste -${label} desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.`;
  return metric === "kg"
    ? "Mantienes el mismo peso desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio."
    : "Mantienes las mismas repeticiones desde tu inicio hasta tu última fecha de entrenamiento en este ejercicio.";
}
