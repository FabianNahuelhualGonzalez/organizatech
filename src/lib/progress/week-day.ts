export const weeklyProgressLabels = ["L", "M", "X", "J", "V", "S", "D"] as const;

const weekdayIndexBySpanishName = new Map([
  ["lunes", 0],
  ["martes", 1],
  ["miercoles", 2],
  ["jueves", 3],
  ["viernes", 4],
  ["sabado", 5],
  ["domingo", 6],
]);

export function getWeeklyProgressDayIndex(dateKey: string, timeZone = "America/Santiago") {
  const date = parseDateKeyAsNoon(dateKey);
  if (Number.isNaN(date.getTime())) return 0;

  const weekday = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    timeZone,
  }).format(date);
  return weekdayIndexBySpanishName.get(normalizeWeekday(weekday)) ?? 0;
}

export function getWeeklyProgressDayLabel(dateKey: string, timeZone = "America/Santiago") {
  return weeklyProgressLabels[getWeeklyProgressDayIndex(dateKey, timeZone)];
}

function parseDateKeyAsNoon(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 12, 0, 0, 0);
}

function normalizeWeekday(value: string) {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
