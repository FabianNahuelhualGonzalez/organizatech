const MAX_DECIMAL_PLACES = 6;

export function roundDecimal(value: number, decimalPlaces = 3): number {
  if (!Number.isFinite(value)) return 0;
  const places = Math.min(MAX_DECIMAL_PLACES, Math.max(0, Math.trunc(decimalPlaces)));
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function roundToIncrement(
  value: number,
  increment: number,
  mode: "nearest" | "down" | "up" = "nearest",
): number {
  if (!Number.isFinite(value) || !Number.isFinite(increment) || increment <= 0) return 0;
  const scaled = value / increment;
  const rounded = mode === "down" ? Math.floor(scaled) : mode === "up" ? Math.ceil(scaled) : Math.round(scaled);
  return roundDecimal(rounded * increment, 3);
}

export function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Convierte kg a miligramos de kg (precisión 0,001 kg) antes de multiplicar por repeticiones.
 * Evita acumular errores binarios en métricas de volumen.
 */
export function volumeUnitProduct(kg: number, reps: number): number {
  if (!Number.isFinite(kg) || !Number.isSafeInteger(reps) || kg < 0 || reps < 0) return 0;
  const milliKg = Math.round(roundDecimal(kg, 3) * 1_000);
  const product = milliKg * reps;
  return Number.isSafeInteger(product) ? product : 0;
}

export function volumeUnitsToKg(units: number): number {
  return Number.isSafeInteger(units) && units >= 0 ? roundDecimal(units / 1_000, 3) : 0;
}
