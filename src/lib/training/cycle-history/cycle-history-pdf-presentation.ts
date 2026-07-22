import type { CycleHistoryPdfModel } from "@/lib/training/cycle-history/cycle-history-pdf-model";
import type {
  CycleHistoryExercisePlan,
  CycleHistoryWeekRegistration,
} from "@/lib/training/cycle-history/cycle-history-types";

export interface CycleHistoryPdfField {
  label: string;
  value: string;
}

export interface CycleHistoryPdfTablePresentation {
  routineName: string;
  weeks: number[];
  head: string[];
  rows: string[][];
}

export interface CycleHistoryPdfRoutinePresentation {
  routineId: string;
  routineName: string;
  tables: CycleHistoryPdfTablePresentation[];
}

export interface CycleHistoryPdfPresentation {
  filename: string;
  generatedAtLabel: string | null;
  documentTitle: string;
  cycleFields: CycleHistoryPdfField[];
  personalFields: CycleHistoryPdfField[];
  metricFields: CycleHistoryPdfField[];
  routines: CycleHistoryPdfRoutinePresentation[];
  emptyMessage: string | null;
}

const NUMBER_FORMATTER = new Intl.NumberFormat("es-CL", {
  maximumFractionDigits: 2,
});

const STATUS_LABELS: Record<CycleHistoryPdfModel["cycle"]["status"], string> = {
  active: "Activo",
  completed: "Completado",
  cancelled: "Cancelado",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Hombre",
  female: "Mujer",
  non_binary: "No binario",
  prefer_not_to_say: "Prefiero no decir",
};

export function buildCycleHistoryPdfPresentation(
  model: CycleHistoryPdfModel,
): CycleHistoryPdfPresentation {
  const cycleFields: CycleHistoryPdfField[] = [];
  appendTextField(cycleFields, "Tipo de ciclo", model.cycle.cycleType);
  cycleFields.push({ label: "Estado", value: STATUS_LABELS[model.cycle.status] });
  appendDateField(cycleFields, "Fecha de inicio", model.cycle.plannedStartDate);
  appendDateField(cycleFields, "Fecha de término", model.cycle.plannedEndDate);
  if (isPositiveFiniteNumber(model.cycle.durationWeeks)) {
    cycleFields.push({
      label: "Duración",
      value: `${model.cycle.durationWeeks} ${model.cycle.durationWeeks === 1 ? "semana" : "semanas"}`,
    });
  }
  cycleFields.push({
    label: "Semanas con registros",
    value: String(model.cycle.weeksWithDataCount),
  });

  const personalFields = buildPersonalFields(model);
  const metricFields = buildMetricFields(model);
  const routines = model.routines.map((routine) => ({
    routineId: routine.routineId,
    routineName: cleanText(routine.routineName),
    tables: routine.weekBlocks.map((weeks) => buildRoutineTable(routine.routineName, routine.exercises, weeks)),
  }));
  const hasTables = routines.some((routine) => routine.tables.length > 0);

  return {
    filename: model.filename,
    generatedAtLabel: formatDateKey(model.generatedAt),
    documentTitle: `Ciclo de entrenamiento ${model.cycle.cycleNumber}: ${cleanText(model.cycle.name)}`,
    cycleFields,
    personalFields,
    metricFields,
    routines,
    emptyMessage: hasTables ? null : "Este ciclo no tiene semanas registradas.",
  };
}

function buildPersonalFields(model: CycleHistoryPdfModel): CycleHistoryPdfField[] {
  const fields: CycleHistoryPdfField[] = [];
  appendTextField(fields, "Nombre", model.personalData.fullName);
  appendTextField(fields, "Correo", model.personalData.email);
  appendDateField(fields, "Fecha de nacimiento", model.personalData.birthDate);
  if (isNonNegativeFiniteNumber(model.personalData.age)) {
    fields.push({ label: "Edad", value: `${model.personalData.age} años` });
  }
  if (model.personalData.gender && model.personalData.gender !== "not_specified") {
    appendTextField(
      fields,
      "Género",
      GENDER_LABELS[model.personalData.gender] ?? model.personalData.gender,
    );
  }
  appendTextField(fields, "Teléfono", model.personalData.phoneNumber);
  return fields;
}

function buildMetricFields(model: CycleHistoryPdfModel): CycleHistoryPdfField[] {
  const fields: CycleHistoryPdfField[] = [
    { label: "Volumen total registrado", value: formatKg(model.metrics.totalVolumeKg) },
    { label: "Ejercicios registrados", value: String(model.metrics.registeredExerciseCount) },
    { label: "Progreso de volumen", value: cleanText(model.metrics.volumeProgressText) },
  ];
  const progress = model.metrics.volumeProgress;
  if (progress.firstWeek !== null && progress.firstWeekVolume !== null) {
    fields.push({
      label: "Primera semana registrada",
      value: `Semana ${progress.firstWeek} · ${formatKg(progress.firstWeekVolume)}`,
    });
  }
  if (progress.lastWeek !== null && progress.lastWeekVolume !== null) {
    fields.push({
      label: "Última semana registrada",
      value: `Semana ${progress.lastWeek} · ${formatKg(progress.lastWeekVolume)}`,
    });
  }
  return fields;
}

function buildRoutineTable(
  routineName: string,
  exercises: CycleHistoryPdfModel["routines"][number]["exercises"],
  weeks: number[],
): CycleHistoryPdfTablePresentation {
  if (weeks.length === 0 || weeks.length > 2) {
    throw new Error("Cada bloque PDF debe contener una o dos semanas.");
  }

  return {
    routineName: cleanText(routineName),
    weeks: [...weeks],
    head: ["Ejercicio", "Objetivo", ...weeks.map((week) => `Semana ${week}`)],
    rows: exercises.map((exercise) => [
      cleanText(exercise.name),
      formatExercisePlan(exercise.plan),
      ...weeks.map((week) => formatWeekRegistration(exercise.weeks[week])),
    ]),
  };
}

function formatExercisePlan(plan: CycleHistoryExercisePlan | null): string {
  if (!plan) return "Sin objetivo registrado";
  return [
    `${formatNumber(plan.targetSets)} series`,
    `${formatNumber(plan.targetReps)} reps`,
    formatKg(plan.baseWeight),
  ].join(" · ");
}

function formatWeekRegistration(registration: CycleHistoryWeekRegistration | undefined): string {
  if (!registration) return "Sin registro";

  const entries = registration.series.map((series, index) => [
    `Registro ${index + 1} · Peso: ${formatKg(series.weight)}`,
    `Series registradas: ${series.reps.length} · Repeticiones: ${series.reps.map(formatNumber).join("/")}`,
    `Volumen: ${formatKg(series.volume)}`,
  ].join("\n"));

  return [
    ...entries,
    `Total reps: ${formatNumber(registration.totalReps)}`,
    `Volumen total: ${formatKg(registration.volume)}`,
  ].join("\n");
}

function appendTextField(fields: CycleHistoryPdfField[], label: string, value: string | null) {
  if (!value?.trim()) return;
  fields.push({ label, value: cleanText(value) });
}

function appendDateField(fields: CycleHistoryPdfField[], label: string, value: string | null) {
  const formatted = formatDateKey(value);
  if (formatted) fields.push({ label, value: formatted });
}

function formatDateKey(value: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatKg(value: number): string {
  return `${formatNumber(value)} kg`;
}

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

function isNonNegativeFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function isPositiveFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
}
