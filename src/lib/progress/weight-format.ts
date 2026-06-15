const decimalPrecision = 2;
const decimalFactor = 10 ** decimalPrecision;

export function parseDecimalWeightInput(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? roundDecimal(value) : null;

  const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
  if (!normalized) return null;
  if ((normalized.match(/\./g) ?? []).length > 1) return null;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? roundDecimal(parsed) : null;
}

export function roundDecimal(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * decimalFactor) / decimalFactor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatDecimalEs(value: number) {
  return roundDecimal(value).toLocaleString("es-CL", {
    maximumFractionDigits: decimalPrecision,
    minimumFractionDigits: 0,
  });
}

export function formatKg(value: number) {
  return `${formatDecimalEs(value)} kg`;
}

export function formatSignedDecimal(value: number) {
  const rounded = roundDecimal(value);
  return `${rounded > 0 ? "+" : ""}${formatDecimalEs(rounded)}`;
}

export function formatSignedKg(value: number) {
  return `${formatSignedDecimal(value)} kg`;
}
