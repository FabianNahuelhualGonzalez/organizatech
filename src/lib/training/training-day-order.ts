export const TRAINING_DAY_LABELS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

const trainingDayOrder = new Map<string, number>([
  ["monday", 0],
  ["lunes", 0],
  ["tuesday", 1],
  ["martes", 1],
  ["wednesday", 2],
  ["miercoles", 2],
  ["thursday", 3],
  ["jueves", 3],
  ["friday", 4],
  ["viernes", 4],
  ["saturday", 5],
  ["sabado", 5],
  ["sunday", 6],
  ["domingo", 6],
]);

export function sortTrainingDaysByWeekOrder<T extends string>(days: readonly T[]): T[] {
  return Array.from(new Set(days))
    .map((day, originalIndex) => ({
      day,
      originalIndex,
      weekIndex: trainingDayOrder.get(normalizeTrainingDay(day)) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => (
      left.weekIndex - right.weekIndex ||
      left.originalIndex - right.originalIndex
    ))
    .map(({ day }) => day);
}

function normalizeTrainingDay(day: string) {
  return day
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
