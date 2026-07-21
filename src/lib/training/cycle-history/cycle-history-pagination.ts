export const DEFAULT_CYCLE_HISTORY_WEEKS_PER_BLOCK = 2;

/**
 * Divide una lista de números de semana en bloques ordenados cronológicamente.
 *
 * Los números de semana repetidos se normalizan a una única aparición antes de
 * paginar: esta capa representa bloques visuales de semanas (para pantalla/PDF), no
 * sesiones individuales. El breakdown (`buildCycleHistoryBreakdown`) ya agrega todo
 * el contenido de una misma semana en un único `CycleHistoryWeekRegistration` antes
 * de llegar aquí, así que deduplicar en este punto no descarta ningún registro: solo
 * evita repetir el mismo bloque semanal dos veces en la paginación.
 */
export function paginateCycleHistoryWeeks(
  weeks: number[],
  weeksPerBlock: number = DEFAULT_CYCLE_HISTORY_WEEKS_PER_BLOCK,
): number[][] {
  const blockSize = Number.isInteger(weeksPerBlock) && weeksPerBlock > 0 ? weeksPerBlock : DEFAULT_CYCLE_HISTORY_WEEKS_PER_BLOCK;
  const uniqueSortedWeeks = Array.from(new Set(weeks)).sort((a, b) => a - b);

  const blocks: number[][] = [];
  for (let index = 0; index < uniqueSortedWeeks.length; index += blockSize) {
    blocks.push(uniqueSortedWeeks.slice(index, index + blockSize));
  }

  return blocks;
}
