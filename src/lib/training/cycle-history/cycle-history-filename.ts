export interface CycleHistoryPdfFilenameInput {
  cycleNumber: number;
  generatedAt: string;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function buildCycleHistoryPdfFilename(input: CycleHistoryPdfFilenameInput): string {
  const safeCycleNumber = sanitizeCycleNumber(input.cycleNumber);
  const safeDateKey = sanitizeDateKey(input.generatedAt);
  return `organizatech-ciclo-${safeCycleNumber}-${safeDateKey}.pdf`;
}

function sanitizeCycleNumber(value: number): string {
  const normalized = Number.isFinite(value) ? Math.trunc(Math.abs(value)) : 0;
  return String(normalized || 0);
}

function sanitizeDateKey(value: string): string {
  const match = DATE_KEY_PATTERN.exec(typeof value === "string" ? value.slice(0, 10) : "");
  if (!match) return "0000-00-00";
  return `${match[1]}-${match[2]}-${match[3]}`;
}
