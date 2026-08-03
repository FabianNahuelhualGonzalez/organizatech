import type { WorkoutShareCardModel } from "@/lib/training/workout-share-model";

export const WORKOUT_SHARE_IMAGE_WIDTH = 1080;
export const WORKOUT_SHARE_IMAGE_HEIGHT = 1350;
export const WORKOUT_SHARE_IMAGE_MAX_DETAIL_ROWS = 10;

const PNG_MIME_TYPE = "image/png";
const PUBLIC_IMAGE_ERROR_MESSAGE = "No fue posible generar la imagen del entrenamiento.";
const FONT_FAMILY = '"Roboto Mono", "SFMono-Regular", Consolas, monospace';
const MAX_RENDER_INPUT_LENGTH = 4096;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/gu;
const BIDI_CHARACTER_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const EMAIL_PATTERN = /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/giu;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const JWT_PATTERN = /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/giu;
const BEARER_PATTERN = /\bbearer\s+[a-z0-9._~+/=-]+/giu;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(?:owner[_ -]?id|user[_ -]?id|profile[_ -]?id|session[_ -]?id|exercise[_ -]?id|exercise[_ -]?lineage[_ -]?id|cycle[_ -]?id|cycle[_ -]?day[_ -]?id|training[_ -]?cycle[_ -]?id|training[_ -]?cycle[_ -]?exercise[_ -]?id)\b\s*(?::|=|\s)\s*[^\s,;|]+/giu;
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|secret)\b\s*(?::|=|\s)\s*[^\s,;|]+/giu;
const ISOLATED_SURROGATE_PATTERN = /[\uD800-\uDFFF]/gu;
const UNSAFE_STANDALONE_GRAPHEME_PATTERN = /^(?:\p{Mark}|\u200d|\ufe0e|\ufe0f)+$/u;
const REDACTED_TEXT = "[redactado]";
const GRAPHEME_SEGMENTER = new Intl.Segmenter("es", { granularity: "grapheme" });

export interface WorkoutShareImageDetailRow {
  readonly labelLines: readonly string[];
  readonly valueLines: readonly string[];
}

export interface WorkoutShareImageLayout {
  readonly width: typeof WORKOUT_SHARE_IMAGE_WIDTH;
  readonly height: typeof WORKOUT_SHARE_IMAGE_HEIGHT;
  readonly brand: string;
  readonly titleLines: readonly string[];
  readonly periodLines: readonly string[];
  readonly detailRows: readonly WorkoutShareImageDetailRow[];
  readonly overflowLabel: string | null;
  readonly footerLines: readonly string[];
}

export interface WorkoutShareImageCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
}

export interface WorkoutShareImageCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): WorkoutShareImageCanvasContext | null;
  toBlob(callback: (blob: Blob | null) => void, type: typeof PNG_MIME_TYPE): void;
}

export interface WorkoutShareImageRendererPorts {
  readonly createCanvas: (
    width: typeof WORKOUT_SHARE_IMAGE_WIDTH,
    height: typeof WORKOUT_SHARE_IMAGE_HEIGHT,
  ) => WorkoutShareImageCanvas;
}

export function buildWorkoutShareImageLayout(
  model: Readonly<WorkoutShareCardModel>,
): WorkoutShareImageLayout {
  const visibleDetails = model.detailLines.slice(0, WORKOUT_SHARE_IMAGE_MAX_DETAIL_ROWS);
  const hiddenDetailCount = Math.max(0, model.detailLines.length - visibleDetails.length);

  return {
    width: WORKOUT_SHARE_IMAGE_WIDTH,
    height: WORKOUT_SHARE_IMAGE_HEIGHT,
    brand: "ORGANIZATECH",
    titleLines: wrapText(projectText(model.title, "Entrenamiento completado"), 27, 2),
    periodLines: wrapText(projectText(model.periodLabel, "Periodo no disponible"), 52, 2),
    detailRows: visibleDetails.map((line) => ({
      labelLines: wrapText(projectText(line.label, "Detalle"), 22, 2),
      valueLines: wrapText(projectText(line.value, "—"), 42, 2),
    })),
    overflowLabel: hiddenDetailCount > 0 ? `+${hiddenDetailCount} ejercicios más` : null,
    footerLines: model.footer
      ? wrapText(projectText(model.footer, ""), 56, 2)
      : [],
  };
}

export async function renderWorkoutShareImagePng(
  model: Readonly<WorkoutShareCardModel>,
  ports: Readonly<WorkoutShareImageRendererPorts>,
): Promise<Blob> {
  try {
    const layout = buildWorkoutShareImageLayout(model);
    const canvas = ports.createCanvas(WORKOUT_SHARE_IMAGE_WIDTH, WORKOUT_SHARE_IMAGE_HEIGHT);
    canvas.width = WORKOUT_SHARE_IMAGE_WIDTH;
    canvas.height = WORKOUT_SHARE_IMAGE_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) throw createPublicImageError();

    drawWorkoutShareImage(context, layout);
    const blob = await canvasToPngBlob(canvas);
    if (blob.type !== PNG_MIME_TYPE) throw createPublicImageError();
    return blob;
  } catch {
    throw createPublicImageError();
  }
}

function drawWorkoutShareImage(
  context: WorkoutShareImageCanvasContext,
  layout: Readonly<WorkoutShareImageLayout>,
): void {
  context.textBaseline = "top";
  context.textAlign = "left";
  context.fillStyle = "#111827";
  context.fillRect(0, 0, layout.width, layout.height);

  context.fillStyle = "#3C7AFF";
  context.font = `700 30px ${FONT_FAMILY}`;
  context.fillText(layout.brand, 72, 72, 936);

  context.fillStyle = "#F5F7FB";
  drawLines(context, layout.titleLines, 72, 140, 58, `700 48px ${FONT_FAMILY}`, 936);

  context.fillStyle = "#A9B4C7";
  drawLines(context, layout.periodLines, 72, 270, 34, `400 25px ${FONT_FAMILY}`, 936);

  context.fillStyle = "#243047";
  context.fillRect(72, 350, 936, 2);

  layout.detailRows.forEach((row, index) => {
    const rowTop = 382 + (index * 76);
    context.fillStyle = "#A9B4C7";
    drawLines(context, row.labelLines, 72, rowTop, 29, `500 22px ${FONT_FAMILY}`, 330);
    context.fillStyle = "#F5F7FB";
    drawLines(context, row.valueLines, 430, rowTop, 29, `500 22px ${FONT_FAMILY}`, 578);
  });

  if (layout.overflowLabel) {
    context.fillStyle = "#3C7AFF";
    context.font = `600 22px ${FONT_FAMILY}`;
    context.textAlign = "right";
    context.fillText(layout.overflowLabel, 1008, 1160, 936);
    context.textAlign = "left";
  }

  context.fillStyle = "#243047";
  context.fillRect(72, 1226, 936, 2);
  context.fillStyle = "#A9B4C7";
  drawLines(context, layout.footerLines, 72, 1260, 29, `400 21px ${FONT_FAMILY}`, 936);
}

function drawLines(
  context: WorkoutShareImageCanvasContext,
  lines: readonly string[],
  x: number,
  y: number,
  lineHeight: number,
  font: string,
  maxWidth: number,
): void {
  context.font = font;
  lines.forEach((line, index) => {
    context.fillText(line, x, y + (index * lineHeight), maxWidth);
  });
}

function wrapText(value: string, maxCharacters: number, maxLines: number): string[] {
  const words = value.split(" ").filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const chunks = chunkUnicode(word, maxCharacters);
    for (const chunk of chunks) {
      const candidate = currentLine ? `${currentLine} ${chunk}` : chunk;
      if (unicodeLength(candidate) <= maxCharacters) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = chunk;
      }
    }
  }

  if (currentLine) lines.push(currentLine);
  if (lines.length <= maxLines) return lines;

  const visibleLines = lines.slice(0, maxLines);
  const lastLine = visibleLines[maxLines - 1] ?? "";
  visibleLines[maxLines - 1] = `${sliceUnicode(lastLine, Math.max(1, maxCharacters - 1))}…`;
  return visibleLines;
}

function chunkUnicode(value: string, maxCharacters: number): string[] {
  const characters = splitGraphemes(value);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += maxCharacters) {
    chunks.push(characters.slice(index, index + maxCharacters).join(""));
  }
  return chunks.length > 0 ? chunks : [""];
}

function unicodeLength(value: string): number {
  return splitGraphemes(value).length;
}

function sliceUnicode(value: string, length: number): string {
  return splitGraphemes(value).slice(0, length).join("");
}

function splitGraphemes(value: string): string[] {
  return Array.from(GRAPHEME_SEGMENTER.segment(value), ({ segment }) => segment);
}

function projectText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const projected = normalizeAndTruncateGraphemes(value, MAX_RENDER_INPUT_LENGTH)
    .replace(CONTROL_CHARACTER_PATTERN, " ")
    .replace(BIDI_CHARACTER_PATTERN, "")
    .replace(EMAIL_PATTERN, REDACTED_TEXT)
    .replace(UUID_PATTERN, REDACTED_TEXT)
    .replace(JWT_PATTERN, REDACTED_TEXT)
    .replace(BEARER_PATTERN, REDACTED_TEXT)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, REDACTED_TEXT)
    .replace(SECRET_ASSIGNMENT_PATTERN, REDACTED_TEXT)
    .replace(/\s+/gu, " ")
    .trim();
  return projected || fallback;
}

function normalizeAndTruncateGraphemes(value: string, maxLength: number): string {
  const normalized = value
    .normalize("NFKC")
    .replace(ISOLATED_SURROGATE_PATTERN, "");
  const graphemes: string[] = [];
  let utf16Length = 0;
  for (const grapheme of splitGraphemes(normalized)) {
    if (utf16Length + grapheme.length > maxLength) break;
    graphemes.push(grapheme);
    utf16Length += grapheme.length;
  }
  while (graphemes.length > 0) {
    const lastGrapheme = graphemes[graphemes.length - 1] ?? "";
    if (!UNSAFE_STANDALONE_GRAPHEME_PATTERN.test(lastGrapheme)) break;
    graphemes.pop();
  }
  return graphemes.join("");
}

function canvasToPngBlob(canvas: WorkoutShareImageCanvas): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(createPublicImageError());
        return;
      }
      resolve(blob);
    }, PNG_MIME_TYPE);
  });
}

function createPublicImageError(): Error {
  return new Error(PUBLIC_IMAGE_ERROR_MESSAGE);
}
