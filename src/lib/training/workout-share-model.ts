import type { TrainingCompletionSummary } from "@/lib/training/training-completion-summary";

export interface WorkoutShareCardDetailLine {
  readonly label: string;
  readonly value: string;
}

export interface WorkoutShareCardModel {
  readonly title: string;
  readonly periodLabel: string;
  readonly detailLines: readonly WorkoutShareCardDetailLine[];
  readonly footer?: string;
}

export interface WorkoutShareTextPayload {
  readonly title: string;
  readonly text: string;
}

const FALLBACK_WORKOUT_TITLE = "Entrenamiento completado";
const FALLBACK_PERIOD_LABEL = "Periodo no disponible";
const FALLBACK_STATUS_LABEL = "Completado";
const FALLBACK_DURATION_LABEL = "Duración no disponible";
const SHARE_PAYLOAD_TITLE = "Entrenamiento completado - Organizatech";
const REDACTED_TEXT = "[redactado]";

const MAX_TITLE_LENGTH = 96;
const MAX_PERIOD_FRAGMENT_LENGTH = 64;
const MAX_PERIOD_LABEL_LENGTH = 208;
const MAX_DETAIL_LABEL_LENGTH = 96;
const MAX_DETAIL_VALUE_LENGTH = 160;
const MAX_FOOTER_LENGTH = 160;
const MAX_SANITIZATION_INPUT_LENGTH = 4096;
const MAX_SAFE_QUANTITY = Number.MAX_SAFE_INTEGER;
const MAX_WEIGHT_DECIMALS = 2;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CHARACTER_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const EMAIL_PATTERN = /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/giu;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const JWT_PATTERN = /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/giu;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/=-]+/giu;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(?:owner[_ -]?id|user[_ -]?id|profile[_ -]?id|session[_ -]?id|exercise[_ -]?id|exercise[_ -]?lineage[_ -]?id|cycle[_ -]?id|cycle[_ -]?day[_ -]?id|training[_ -]?cycle[_ -]?exercise[_ -]?id|e-?mail|notes?|observations?|rir|readiness)\b\s*(?::|=|\s)\s*[^\s,;|]+/giu;
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|secret)\b\s*(?::|=|\s)\s*[^\s,;|]+/giu;
const SENSITIVE_FIELD_PATTERN = /\b(?:owner[_ -]?id|user[_ -]?id|profile[_ -]?id|session[_ -]?id|exercise[_ -]?id|exercise[_ -]?lineage[_ -]?id|cycle[_ -]?id|cycle[_ -]?day[_ -]?id|training[_ -]?cycle[_ -]?exercise[_ -]?id|e-?mail|notes?|observations?|rir|readiness|bearer|tokens?|secrets?)\b/giu;
const REDACTION_PATTERN = /\[redactado\]/giu;
const USEFUL_TEXT_PATTERN = /[\p{L}\p{N}]/u;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))?$/;
const ISOLATED_SURROGATE_PATTERN = /[\uD800-\uDFFF]/gu;
const GRAPHEME_SEGMENTER = new Intl.Segmenter("es", { granularity: "grapheme" });

export function buildWorkoutShareCardModel(
  summary: Readonly<TrainingCompletionSummary>,
): WorkoutShareCardModel | null {
  const exerciseLines = summary.exercises.flatMap((exercise) => {
    const exerciseName = sanitizeUsefulText(exercise.exerciseName, MAX_DETAIL_LABEL_LENGTH);
    if (!exerciseName) return [];

    const seriesCount = sanitizeQuantity(exercise.currentSeriesCount);
    const totalReps = sanitizeQuantity(exercise.currentTotalReps);
    const weightLabel = formatWeight(exercise.currentWeight);

    return [{
      label: exerciseName,
      value: `${seriesCount} ${seriesCount === 1 ? "serie" : "series"} · ${totalReps} ${totalReps === 1 ? "repetición" : "repeticiones"} · ${weightLabel}`,
    } satisfies WorkoutShareCardDetailLine];
  });

  if (exerciseLines.length === 0) return null;

  const title = sanitizeUsefulText(summary.workoutName, MAX_TITLE_LENGTH) ?? FALLBACK_WORKOUT_TITLE;
  const periodLabel = buildPeriodLabel(summary);
  const statusLabel = sanitizeUsefulText(summary.statusLabel, MAX_DETAIL_VALUE_LENGTH)
    ?? FALLBACK_STATUS_LABEL;
  const durationLabel = sanitizeUsefulText(summary.durationLabel, MAX_DETAIL_VALUE_LENGTH)
    ?? FALLBACK_DURATION_LABEL;
  const footer = sanitizeUsefulText(summary.progressLabel, MAX_FOOTER_LENGTH);

  const detailLines: WorkoutShareCardDetailLine[] = [
    { label: "Estado", value: statusLabel },
    { label: "Duración", value: durationLabel },
    ...exerciseLines,
  ];

  return footer
    ? { title, periodLabel, detailLines, footer }
    : { title, periodLabel, detailLines };
}

export function buildWorkoutShareTextPayload(
  model: Readonly<WorkoutShareCardModel>,
): WorkoutShareTextPayload {
  const title = sanitizeUsefulText(model.title, MAX_TITLE_LENGTH) ?? FALLBACK_WORKOUT_TITLE;
  const periodLabel = sanitizeUsefulText(model.periodLabel, MAX_PERIOD_LABEL_LENGTH)
    ?? FALLBACK_PERIOD_LABEL;
  const detailLines = model.detailLines.flatMap((line) => {
    const label = sanitizeUsefulText(line.label, MAX_DETAIL_LABEL_LENGTH);
    const value = sanitizeUsefulText(line.value, MAX_DETAIL_VALUE_LENGTH);
    return label && value ? [`${label}: ${value}`] : [];
  });
  const footer = model.footer
    ? sanitizeUsefulText(model.footer, MAX_FOOTER_LENGTH)
    : null;
  const sections = [
    `Organizatech\n${title}\n${periodLabel}`,
    detailLines.join("\n"),
    footer ?? "",
  ].filter((section) => section !== "");

  return {
    title: SHARE_PAYLOAD_TITLE,
    text: sections.join("\n\n"),
  };
}

export function buildWorkoutShareImageFilename(input: {
  generatedAt: string;
}): string {
  const dateKey = resolveValidDateKey(input.generatedAt) ?? "0000-00-00";
  return `organizatech-entrenamiento-${dateKey}.png`;
}

function buildPeriodLabel(summary: Readonly<TrainingCompletionSummary>): string {
  const fragments = [summary.dayLabel, summary.cycleLabel, summary.weekLabel]
    .map((fragment) => sanitizeUsefulText(fragment, MAX_PERIOD_FRAGMENT_LENGTH))
    .filter((fragment): fragment is string => fragment !== null);
  if (fragments.length === 0) return FALLBACK_PERIOD_LABEL;
  return sanitizeText(fragments.join(" · "), MAX_PERIOD_LABEL_LENGTH);
}

function sanitizeUsefulText(value: unknown, maxLength: number): string | null {
  const sanitized = sanitizeText(value, maxLength);
  if (!sanitized) return null;
  const withoutRedactions = sanitized.replace(REDACTION_PATTERN, "");
  return USEFUL_TEXT_PATTERN.test(withoutRedactions) ? sanitized : null;
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";

  const normalized = normalizeAndTruncateGraphemes(value, MAX_SANITIZATION_INPUT_LENGTH)
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(BIDI_CHARACTER_PATTERN, "")
    .replace(EMAIL_PATTERN, REDACTED_TEXT)
    .replace(UUID_PATTERN, REDACTED_TEXT)
    .replace(JWT_PATTERN, REDACTED_TEXT)
    .replace(BEARER_PATTERN, REDACTED_TEXT)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, REDACTED_TEXT)
    .replace(SECRET_ASSIGNMENT_PATTERN, REDACTED_TEXT)
    .replace(SENSITIVE_FIELD_PATTERN, REDACTED_TEXT)
    .replace(/\s+/g, " ")
    .trim();

  return truncateGraphemes(normalized, maxLength).trim();
}

function normalizeAndTruncateGraphemes(value: string, maxLength: number): string {
  const normalized = value
    .normalize("NFKC")
    .replace(ISOLATED_SURROGATE_PATTERN, "");
  return truncateGraphemesByUtf16Length(normalized, maxLength);
}

function truncateGraphemes(value: string, maxLength: number): string {
  const visibleGraphemes: string[] = [];
  let codePointLength = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(value)) {
    const graphemeCodePointLength = Array.from(segment).length;
    if (codePointLength + graphemeCodePointLength > maxLength) break;
    visibleGraphemes.push(segment);
    codePointLength += graphemeCodePointLength;
  }
  return visibleGraphemes.join("");
}

function truncateGraphemesByUtf16Length(value: string, maxLength: number): string {
  const visibleGraphemes: string[] = [];
  let utf16Length = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(value)) {
    if (utf16Length + segment.length > maxLength) break;
    visibleGraphemes.push(segment);
    utf16Length += segment.length;
  }
  return visibleGraphemes.join("");
}

function sanitizeQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_SAFE_QUANTITY);
}

function formatWeight(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  const safeValue = Math.min(value, MAX_SAFE_QUANTITY);
  const factor = 10 ** MAX_WEIGHT_DECIMALS;
  const rounded = Math.round((safeValue + Number.EPSILON) * factor) / factor;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return `${String(normalized).replace(".", ",")} kg`;
}

function resolveValidDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const dateKeyMatch = DATE_KEY_PATTERN.exec(value);
  if (dateKeyMatch) {
    return isValidCalendarDate(dateKeyMatch[1], dateKeyMatch[2], dateKeyMatch[3]) ? value : null;
  }

  const dateTimeMatch = ISO_DATETIME_PATTERN.exec(value);
  if (!dateTimeMatch) return null;
  if (!isValidCalendarDate(dateTimeMatch[1], dateTimeMatch[2], dateTimeMatch[3])) return null;
  if (!isValidTime(dateTimeMatch[4], dateTimeMatch[5], dateTimeMatch[6])) return null;
  if (dateTimeMatch[7] !== undefined && !isValidOffset(dateTimeMatch[7], dateTimeMatch[8])) return null;
  return `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`;
}

function isValidCalendarDate(yearText: string, monthText: string, dayText: string): boolean {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidTime(hourText: string, minuteText: string, secondText: string): boolean {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function isValidOffset(hourText: string, minuteText: string): boolean {
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
