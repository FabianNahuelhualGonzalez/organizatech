import { describeCycleHistoryVolumeProgress } from "@/lib/training/cycle-history/cycle-history-metrics";
import type {
  CycleHistoryDetail,
  CycleHistoryListResult,
  CycleHistoryPublicError,
} from "@/lib/training/cycle-history/cycle-history-service";
import type {
  CycleHistoryCycleMetadata,
  CycleHistoryCycleStatus,
  CycleHistoryExerciseBreakdown,
  CycleHistoryExercisePlan,
  CycleHistoryRoutineBreakdown,
  CycleHistoryVolumeProgressState,
  CycleHistoryWeekRegistration,
} from "@/lib/training/cycle-history/cycle-history-types";

export const NEUTRAL_MISSING_VALUE_LABEL = "Sin información";

/**
 * Estado de presentación de la lista de ciclos. Es un envoltorio propio de H1-C:
 * `CycleHistoryListResult` (H1-B) no modela "idle"/"loading" porque `listCycles()`
 * es una promesa simple sin coordinador propio. La futura integración (H1-D) decide
 * cuándo mostrar "idle" (antes de pedir datos) y "loading" (mientras la promesa está
 * en curso) y entrega el resultado real de H1-B en cuanto resuelve.
 */
export type CycleHistoryListPresentationState =
  | { status: "idle" }
  | { status: "loading" }
  | CycleHistoryListResult;

export interface CycleHistoryCardViewModel {
  cycleId: string;
  eyebrowLabel: string;
  title: string;
  cycleTypeLabel: string | null;
  statusLabel: string;
  dateRangeLabel: string;
  durationLabel: string;
}

export interface CycleHistoryMetricCardViewModel {
  label: string;
  value: string;
  caption: string;
}

export type CycleHistoryToneKind = "positive" | "negative" | "neutral";

export interface CycleHistoryVolumeProgressViewModel {
  text: string;
  tone: CycleHistoryToneKind;
}

export interface CycleHistorySeriesViewModel {
  weightLabel: string;
  repsLabel: string;
  volumeLabel: string;
}

export interface CycleHistoryWeekRowViewModel {
  week: number;
  weekLabel: string;
  series: CycleHistorySeriesViewModel[];
  totalRepsLabel: string;
  volumeLabel: string;
}

export interface CycleHistoryExerciseViewModel {
  key: string;
  name: string;
  planLabel: string | null;
  weeks: CycleHistoryWeekRowViewModel[];
}

export interface CycleHistoryRoutineViewModel {
  key: string;
  name: string;
  exercises: CycleHistoryExerciseViewModel[];
}

export interface CycleHistoryDetailViewModel {
  cycleId: string;
  metricCards: CycleHistoryMetricCardViewModel[];
  volumeProgress: CycleHistoryVolumeProgressViewModel;
  routines: CycleHistoryRoutineViewModel[];
  weeksWithDataLabel: string;
  sessionCountLabel: string;
}

export interface CycleHistoryErrorViewModel {
  message: string;
  code: string;
}

const CYCLE_STATUS_LABELS: Record<CycleHistoryCycleStatus, string> = {
  active: "Activo",
  completed: "Completado",
  cancelled: "Cancelado",
};

/** Construye la tarjeta de presentación de un ciclo. No muta `cycle`. */
export function buildCycleHistoryCardViewModel(cycle: CycleHistoryCycleMetadata): CycleHistoryCardViewModel {
  return {
    cycleId: cycle.cycleId,
    eyebrowLabel: `Ciclo ${cycle.cycleNumber}`,
    title: cycle.name,
    cycleTypeLabel: cycle.cycleType,
    statusLabel: CYCLE_STATUS_LABELS[cycle.status],
    dateRangeLabel: formatDateRangeLabel(cycle.plannedStartDate, cycle.plannedEndDate),
    durationLabel: formatDurationLabel(cycle.durationWeeks),
  };
}

/** Construye las tarjetas de la lista completa, preservando el orden recibido. No muta el array de entrada. */
export function buildCycleHistoryListViewModels(
  cycles: readonly CycleHistoryCycleMetadata[],
): CycleHistoryCardViewModel[] {
  return cycles.map(buildCycleHistoryCardViewModel);
}

/**
 * Construye el view model del detalle expandido a partir del contrato real de H1-A/H1-B.
 * Solo lee de `detail`; nunca reasigna ni expone referencias a `detail.breakdown`,
 * `detail.metrics`, `detail.plan` ni `detail.pdfModel` — cada valor de salida es un
 * primitive o un array/objeto nuevo construido aquí.
 */
export function buildCycleHistoryDetailViewModel(detail: CycleHistoryDetail): CycleHistoryDetailViewModel {
  const metrics = detail.metrics;
  const weeksCount = detail.breakdown.weeksWithData.length;

  return {
    cycleId: detail.metadata.cycleId,
    metricCards: [
      {
        label: "Volumen total registrado",
        value: formatKg(metrics.totalVolumeKg),
        caption: "Suma real de peso por repeticiones de todas las series registradas en este ciclo.",
      },
      {
        label: "Ejercicios registrados",
        value: String(metrics.registeredExerciseCount),
        caption: "Ejercicios únicos con al menos un registro real en este ciclo.",
      },
    ],
    volumeProgress: {
      text: describeCycleHistoryVolumeProgress(metrics.volumeProgress),
      tone: resolveVolumeProgressTone(metrics.volumeProgress.state),
    },
    routines: detail.breakdown.routines.map(buildRoutineViewModel),
    weeksWithDataLabel:
      weeksCount === 0
        ? "Sin semanas registradas"
        : `${weeksCount} ${weeksCount === 1 ? "semana registrada" : "semanas registradas"}`,
    sessionCountLabel: `${detail.sessionCount} ${detail.sessionCount === 1 ? "sesión" : "sesiones"}`,
  };
}

/** Traduce el error público sanitizado de H1-B a un view model de presentación. Nunca expone detalles técnicos. */
export function buildCycleHistoryErrorViewModel(error: CycleHistoryPublicError): CycleHistoryErrorViewModel {
  return { message: error.message, code: error.code };
}

/**
 * Regla de expansión única: al pulsar el mismo ciclo ya expandido, se contrae (null);
 * al pulsar cualquier otro, ese pasa a ser el único expandido. La pantalla H1-C es
 * controlada: esta función es la fuente de verdad de la regla, para que H1-D la
 * reutilice al conectar el estado real en vez de reimplementarla.
 */
export function resolveNextExpandedCycleId(
  currentExpandedCycleId: string | null,
  toggledCycleId: string,
): string | null {
  return currentExpandedCycleId === toggledCycleId ? null : toggledCycleId;
}

/**
 * El botón de descarga de PDF solo debe estar habilitado cuando existe un detalle
 * listo (`status === "ready"`) para el ciclo expandido y no hay una descarga en curso.
 */
export function isCycleHistoryPdfActionDisabled(
  detailStatus: "idle" | "disabled" | "loading" | "empty" | "ready" | "error",
  isPdfActionBusy = false,
): boolean {
  return detailStatus !== "ready" || isPdfActionBusy;
}

const DOM_ID_UNSAFE_CHARACTER_RUN = /[^a-zA-Z0-9_-]+/g;
const DOM_ID_LEADING_OR_TRAILING_DASHES = /^-+|-+$/g;

/**
 * Hash determinista (FNV-1a de 32 bits, sin crypto ni dependencias) usado como sufijo
 * para evitar colisiones entre `cycleId` distintos que, tras remover caracteres no
 * seguros para un id/selector DOM, terminarían compartiendo el mismo texto base
 * (ej. "a/b" y "a?b" comparten el fragmento "a-b" pero deben producir ids distintos).
 */
function hashCycleIdForDomId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Convierte un `cycleId` de dominio (arbitrario) en un fragmento seguro y estable
 * para usar dentro de ids DOM/selectores. El `cycleId` real jamás se modifica: esta
 * función solo produce texto de presentación para atributos `id`/`aria-*`, nunca se
 * usa como valor enviado a `onToggleCycle`/`onRetry`/`onDownloadPdf`.
 */
export function sanitizeCycleHistoryDomId(cycleId: string): string {
  const sanitizedCore = cycleId
    .replace(DOM_ID_UNSAFE_CHARACTER_RUN, "-")
    .replace(DOM_ID_LEADING_OR_TRAILING_DASHES, "");
  const base = sanitizedCore.length > 0 ? sanitizedCore : "cycle";
  return `${base}-${hashCycleIdForDomId(cycleId)}`;
}

/** Id DOM estable del panel de detalle expandido de un ciclo. Debe coincidir con `aria-controls`. */
export function buildCycleHistoryDetailDomId(cycleId: string): string {
  return `cycle-history-detail-${sanitizeCycleHistoryDomId(cycleId)}`;
}

/** Id DOM estable del encabezado de la tarjeta de un ciclo. Debe coincidir con `aria-labelledby`. */
export function buildCycleHistoryHeadingDomId(cycleId: string): string {
  return `cycle-history-heading-${sanitizeCycleHistoryDomId(cycleId)}`;
}

function buildRoutineViewModel(routine: CycleHistoryRoutineBreakdown): CycleHistoryRoutineViewModel {
  return {
    key: routine.routineId,
    name: routine.routineName,
    exercises: routine.exercises.map(buildExerciseViewModel),
  };
}

function buildExerciseViewModel(exercise: CycleHistoryExerciseBreakdown): CycleHistoryExerciseViewModel {
  const weeks = Object.values(exercise.weeks)
    .map(buildWeekRowViewModel)
    .sort((a, b) => a.week - b.week);

  return {
    key: `${exercise.identity.kind}:${exercise.identity.key}`,
    name: exercise.name,
    planLabel: formatExercisePlanLabel(exercise.plan),
    weeks,
  };
}

function buildWeekRowViewModel(registration: CycleHistoryWeekRegistration): CycleHistoryWeekRowViewModel {
  return {
    week: registration.week,
    weekLabel: `Semana ${registration.week}`,
    series: registration.series.map((series) => ({
      weightLabel: formatKg(series.weight),
      repsLabel: series.reps.join(", "),
      volumeLabel: formatKg(series.volume),
    })),
    totalRepsLabel: `${registration.totalReps} ${registration.totalReps === 1 ? "repetición" : "repeticiones"}`,
    volumeLabel: formatKg(registration.volume),
  };
}

function formatExercisePlanLabel(plan: CycleHistoryExercisePlan | null): string | null {
  if (!plan) return null;
  return `${plan.targetSets}x${plan.targetReps} · ${formatKg(plan.baseWeight)}`;
}

function resolveVolumeProgressTone(state: CycleHistoryVolumeProgressState): CycleHistoryToneKind {
  if (state === "increase") return "positive";
  if (state === "decrease") return "negative";
  return "neutral";
}

function formatDurationLabel(durationWeeks: number | null): string {
  if (durationWeeks === null || !Number.isFinite(durationWeeks) || durationWeeks <= 0) {
    return NEUTRAL_MISSING_VALUE_LABEL;
  }
  return `${durationWeeks} ${durationWeeks === 1 ? "semana" : "semanas"}`;
}

function formatDateRangeLabel(startDate: string | null, endDate: string | null): string {
  const start = formatDateKey(startDate);
  const end = formatDateKey(endDate);
  if (!start && !end) return NEUTRAL_MISSING_VALUE_LABEL;
  return `${start ?? NEUTRAL_MISSING_VALUE_LABEL} — ${end ?? NEUTRAL_MISSING_VALUE_LABEL}`;
}

function formatDateKey(value: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatKg(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${Math.round(safeValue).toLocaleString("es-CL")} kg`;
}
