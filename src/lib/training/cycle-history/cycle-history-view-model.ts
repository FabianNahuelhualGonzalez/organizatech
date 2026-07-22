import { describeCycleHistoryVolumeProgress } from "@/lib/training/cycle-history/cycle-history-metrics";
import type {
  CycleHistoryDetail,
  CycleHistoryListResult,
  CycleHistoryPublicError,
} from "@/lib/training/cycle-history/cycle-history-service";
import type {
  CycleHistoryCycleMetadata,
  CycleHistoryVolumeProgress,
  CycleHistoryVolumeProgressState,
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
  barLabel: string;
  dateRowLabel: string;
}

export interface CycleHistoryMetricCardViewModel {
  label: string;
  value: string;
  caption: string;
}

export type CycleHistoryToneKind = "positive" | "negative" | "neutral";

/**
 * El mensaje de progreso se expone ya partido en `prefix`/`highlight`/`suffix` para
 * que la UI pueda destacar en color solo el fragmento numérico real (ej. "270 kg"),
 * sin alterar ni recalcular el texto exacto ya aprobado que produce
 * `describeCycleHistoryVolumeProgress` (H1-A). `highlight` es `null` cuando el texto
 * no contiene un valor numérico destacable (estados "unchanged"/"insufficient_data").
 */
export interface CycleHistoryVolumeProgressViewModel {
  prefix: string;
  highlight: string | null;
  suffix: string;
  tone: CycleHistoryToneKind;
}

export interface CycleHistoryDetailViewModel {
  cycleId: string;
  metricCards: CycleHistoryMetricCardViewModel[];
  volumeProgress: CycleHistoryVolumeProgressViewModel;
}

export interface CycleHistoryErrorViewModel {
  message: string;
  code: string;
}

/** Construye la barra de presentación de un ciclo. No muta `cycle`. */
export function buildCycleHistoryCardViewModel(cycle: CycleHistoryCycleMetadata): CycleHistoryCardViewModel {
  return {
    cycleId: cycle.cycleId,
    barLabel: buildCycleHistoryBarLabel(cycle),
    dateRowLabel: formatDateRowLabel(cycle.plannedStartDate, cycle.plannedEndDate),
  };
}

/** Construye las barras de la lista completa, preservando el orden recibido. No muta el array de entrada. */
export function buildCycleHistoryListViewModels(
  cycles: readonly CycleHistoryCycleMetadata[],
): CycleHistoryCardViewModel[] {
  return cycles.map(buildCycleHistoryCardViewModel);
}

/**
 * Construye el view model del detalle expandido a partir del contrato real de H1-A/H1-B.
 * Solo lee de `detail`; nunca reasigna ni expone referencias a `detail.breakdown`,
 * `detail.metrics`, `detail.plan` ni `detail.pdfModel` — cada valor de salida es un
 * primitive nuevo construido aquí. El detalle de rutinas/ejercicios/semanas del
 * breakdown ya no se proyecta a un view model de pantalla: el diseño aprobado por
 * Producto (H1-C.2) no lo muestra en la pantalla principal. Ese dato real sigue
 * disponible sin cambios en `detail.breakdown`/`detail.pdfModel` para H1-D y el PDF.
 */
export function buildCycleHistoryDetailViewModel(detail: CycleHistoryDetail): CycleHistoryDetailViewModel {
  const metrics = detail.metrics;

  return {
    cycleId: detail.metadata.cycleId,
    metricCards: [
      {
        label: "Volumen registrado",
        value: formatKg(metrics.totalVolumeKg),
        caption: "Suma real de peso por repeticiones de todas las series registradas en este ciclo.",
      },
      {
        label: "Total volumen progreso",
        value: formatVolumeProgressMetricValue(metrics.volumeProgress),
        caption: "Diferencia real de volumen entre tu primera y última semana registrada.",
      },
      {
        label: "Ejercicios registrados",
        value: String(metrics.registeredExerciseCount),
        caption: "Ejercicios únicos con al menos un registro real en este ciclo.",
      },
    ],
    volumeProgress: {
      ...splitVolumeProgressHighlight(describeCycleHistoryVolumeProgress(metrics.volumeProgress)),
      tone: resolveVolumeProgressTone(metrics.volumeProgress.state),
    },
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

/**
 * Texto de la barra de ciclo: "Ciclo de entrenamiento {n}: {nombre}", con segmentos
 * opcionales de semanas y días de entrenamiento agregados solo cuando existen datos
 * reales. `trainingDayCount` se consume tal cual llega en `cycle.trainingDayCount`
 * (ya resuelto por H1-B.1 desde `training_cycle_days.day_code`) — nunca se recalcula
 * ni se deriva desde `plan`/`breakdown`/`sessions` en esta capa de presentación.
 * Ningún segmento ausente se reemplaza por un rótulo neutro: se omite limpiamente,
 * de modo que nunca queden separadores "|" sobrantes al final de la barra.
 */
function buildCycleHistoryBarLabel(cycle: CycleHistoryCycleMetadata): string {
  const namePart = `Ciclo de entrenamiento ${cycle.cycleNumber}: ${cycle.name}`;
  const segments = [formatWeeksSegment(cycle.durationWeeks), formatTrainingDaysSegment(cycle.trainingDayCount)].filter(
    (segment): segment is string => segment !== null,
  );
  return segments.length > 0 ? `${namePart} | ${segments.join(" | ")}` : namePart;
}

function formatWeeksSegment(durationWeeks: number | null): string | null {
  if (durationWeeks === null || !Number.isFinite(durationWeeks) || durationWeeks <= 0) return null;
  return `${durationWeeks} ${durationWeeks === 1 ? "semana" : "semanas"}`;
}

/**
 * "N día(s) de entrenamiento", respetando singular/plural. `null` (o un valor no
 * finito/no positivo, que no debería ocurrir para un conteo real) omite el segmento
 * por completo — nunca se muestra "0 días" ni "null días" como relleno.
 */
function formatTrainingDaysSegment(trainingDayCount: number | null): string | null {
  if (trainingDayCount === null || !Number.isFinite(trainingDayCount) || trainingDayCount <= 0) return null;
  return `${trainingDayCount} ${trainingDayCount === 1 ? "día" : "días"} de entrenamiento`;
}

/**
 * Fila "Fecha: ..." del ciclo seleccionado. Si falta solo un extremo del rango no
 * repite "Sin información" en ambos lados: usa una variante limpia ("desde ..." /
 * "hasta ..."). Si faltan ambas fechas, usa la ausencia neutral única.
 */
function formatDateRowLabel(startDate: string | null, endDate: string | null): string {
  const start = formatDateKey(startDate);
  const end = formatDateKey(endDate);
  if (start && end) return `${start} | ${end}`;
  if (start) return `desde ${start}`;
  if (end) return `hasta ${end}`;
  return NEUTRAL_MISSING_VALUE_LABEL;
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

/**
 * Valor de la métrica "Total volumen progreso": la diferencia real de volumen entre
 * la primera y la última semana con datos (mismo cálculo que ya usa la oración de
 * progreso). Ausencia neutral cuando no hay suficientes semanas para calcularla —
 * nunca se inventa un valor.
 */
function formatVolumeProgressMetricValue(progress: CycleHistoryVolumeProgress): string {
  if (progress.state === "insufficient_data" || progress.differenceKg === null) {
    return NEUTRAL_MISSING_VALUE_LABEL;
  }
  if (progress.differenceKg === 0) return formatKg(0);
  const sign = progress.differenceKg > 0 ? "+" : "-";
  return `${sign}${formatKg(Math.abs(progress.differenceKg))}`;
}

function resolveVolumeProgressTone(state: CycleHistoryVolumeProgressState): CycleHistoryToneKind {
  if (state === "increase") return "positive";
  if (state === "decrease") return "negative";
  return "neutral";
}

const VOLUME_PROGRESS_HIGHLIGHT_PATTERN = /-?[\d.,]+\s*kg/;

/**
 * Separa el texto ya aprobado de `describeCycleHistoryVolumeProgress` (H1-A) en
 * prefijo/valor-numérico/sufijo, solo para poder destacarlo visualmente. No altera
 * ni recalcula el texto ni el valor: es una segmentación puramente de presentación
 * sobre una cadena ya producida por el dominio.
 */
function splitVolumeProgressHighlight(text: string): { prefix: string; highlight: string | null; suffix: string } {
  const match = VOLUME_PROGRESS_HIGHLIGHT_PATTERN.exec(text);
  if (!match) return { prefix: text, highlight: null, suffix: "" };
  const start = match.index;
  const end = start + match[0].length;
  return { prefix: text.slice(0, start), highlight: match[0], suffix: text.slice(end) };
}
