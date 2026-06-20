export type ExerciseCurrentResultTone = "success" | "partial" | "improved";

export interface ExerciseCurrentResultInput {
  totalReps: number | null;
  targetTotalReps: number | null;
  completedSets: number | null;
  targetSets: number | null;
  actualWeight?: number | null;
  targetWeight?: number | null;
}

export interface ExerciseCurrentResultItem {
  label: string;
  value: string;
  detail: string;
  tone: ExerciseCurrentResultTone;
}

export interface ExerciseCurrentResultPresentation {
  tone: ExerciseCurrentResultTone;
  headline: string;
  message: string;
  items: ExerciseCurrentResultItem[];
}

export function buildExerciseCurrentResultPresentation(
  input: ExerciseCurrentResultInput,
): ExerciseCurrentResultPresentation {
  const totalReps = readNonNegativeNumber(input.totalReps);
  const targetTotalReps = readPositiveNumber(input.targetTotalReps);
  const completedSets = readNonNegativeNumber(input.completedSets);
  const targetSets = readPositiveNumber(input.targetSets);
  const actualWeight = readNumber(input.actualWeight);
  const targetWeight = readNumber(input.targetWeight);

  const repsDiff = totalReps !== null && targetTotalReps !== null ? totalReps - targetTotalReps : null;
  const tone = readOverallTone(repsDiff);
  const items: ExerciseCurrentResultItem[] = [];

  if (actualWeight !== null && targetWeight !== null) {
    items.push({
      label: "Peso",
      value: `${formatNumber(actualWeight)} kg de ${formatNumber(targetWeight)} kg`,
      detail: formatWeightDetail(actualWeight - targetWeight),
      tone: readTone(actualWeight - targetWeight),
    });
  }

  if (completedSets !== null && targetSets !== null) {
    items.push({
      label: "Series",
      value: `${formatNumber(completedSets)} de ${formatNumber(targetSets)}`,
      detail: formatSeriesDetail(completedSets - targetSets),
      tone: readTone(completedSets - targetSets),
    });
  }

  if (totalReps !== null && targetTotalReps !== null) {
    items.push({
      label: "Repeticiones",
      value: `${formatNumber(totalReps)} de ${formatNumber(targetTotalReps)}`,
      detail: formatRepsDetail(repsDiff ?? 0),
      tone: readTone(repsDiff ?? 0),
    });
  } else if (totalReps !== null) {
    items.push({
      label: "Repeticiones",
      value: `${formatNumber(totalReps)} realizadas`,
      detail: "Objetivo por rango definido en la rutina",
      tone: "partial",
    });
  }

  return {
    tone,
    headline: formatHeadline(totalReps, targetTotalReps),
    message: formatPrimaryMessage(repsDiff),
    items,
  };
}

function formatHeadline(totalReps: number | null, targetTotalReps: number | null) {
  if (totalReps !== null && targetTotalReps !== null) {
    return `${formatNumber(totalReps)} de ${formatNumber(targetTotalReps)} repeticiones`;
  }

  if (totalReps !== null) {
    return `${formatNumber(totalReps)} repeticiones realizadas`;
  }

  return "Registra tus series para ver el resumen";
}

function formatPrimaryMessage(repsDiff: number | null) {
  if (repsDiff === null) return "Completa tus series para evaluar el objetivo de hoy";
  if (repsDiff === 0) return "Completaste el objetivo planificado para hoy";
  if (repsDiff > 0) {
    return `Superaste el objetivo por ${formatNumber(repsDiff)} ${repsDiff === 1 ? "repetición" : "repeticiones"}`;
  }

  const missing = Math.abs(repsDiff);
  return missing === 1
    ? "Te faltó 1 repetición para completar el objetivo de hoy"
    : `Te faltaron ${formatNumber(missing)} repeticiones para completar el objetivo de hoy`;
}

function formatWeightDetail(diff: number) {
  if (diff === 0) return "Objetivo alcanzado";
  const amount = formatNumber(Math.abs(diff));
  return diff > 0 ? `${amount} kg sobre el objetivo` : `${amount} kg bajo el objetivo`;
}

function formatSeriesDetail(diff: number) {
  if (diff === 0) return "Completas";
  const amount = formatNumber(Math.abs(diff));
  if (diff > 0) return diff === 1 ? "1 serie adicional" : `${amount} series adicionales`;
  return diff === -1 ? "Faltó 1 serie" : `Faltaron ${amount} series`;
}

function formatRepsDetail(diff: number) {
  if (diff === 0) return "Objetivo alcanzado";
  const amount = formatNumber(Math.abs(diff));
  if (diff > 0) return diff === 1 ? "1 adicional" : `${amount} adicionales`;
  return diff === -1 ? "Faltó 1" : `Faltaron ${amount}`;
}

function readOverallTone(repsDiff: number | null): ExerciseCurrentResultTone {
  if (repsDiff === null) return "partial";
  if (repsDiff > 0) return "improved";
  if (repsDiff === 0) return "success";
  return "partial";
}

function readTone(diff: number): ExerciseCurrentResultTone {
  if (diff > 0) return "improved";
  if (diff === 0) return "success";
  return "partial";
}

function readPositiveNumber(value: unknown) {
  const parsed = readNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function readNonNegativeNumber(value: unknown) {
  const parsed = readNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function readNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(value);
}
