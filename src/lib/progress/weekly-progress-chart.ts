const fallbackTrainingDays = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];
const fallbackValues = [-0.8, -0.5, 0.2, 1.2, 0.5, 0.8, -0.2];

export interface WeeklyProgressChartPoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

export interface WeeklyProgressChart {
  labels: string[];
  values: number[];
  points: WeeklyProgressChartPoint[];
  activeIndex: number;
}

export function buildWeeklyProgressChart(input: {
  weekDays: readonly string[];
  value: number;
  currentDay?: string;
}) {
  const days = normalizeWeekDays(input.weekDays);
  const labels = days.map(getTrainingDayShortLabel);
  const clampedValue = clampWeeklyValue(input.value);
  const activeIndex = getActiveTrainingDayIndex(days, input.currentDay);
  const values = days.map((_, index) => index === activeIndex ? clampedValue : fallbackValues[index % fallbackValues.length]);
  const points = values.map((value, index) => {
    const x = getPointX(index, values.length);
    const y = 84 - ((value + 4) / 8) * 66;
    return { x, y, value, label: labels[index] };
  });

  return {
    labels,
    values,
    points,
    activeIndex,
  } satisfies WeeklyProgressChart;
}

function normalizeWeekDays(weekDays: readonly string[]) {
  const uniqueDays = Array.from(new Set(weekDays.filter((day) => day.trim().length > 0)));
  return uniqueDays.length > 0 ? uniqueDays : fallbackTrainingDays;
}

function getActiveTrainingDayIndex(days: string[], currentDay: string | undefined) {
  const normalizedCurrent = normalizeTrainingDay(currentDay ?? "");
  const index = days.findIndex((day) => normalizeTrainingDay(day) === normalizedCurrent);
  return index >= 0 ? index : days.length - 1;
}

function getPointX(index: number, count: number) {
  if (count <= 1) return 240;
  const start = 18;
  const end = 456;
  return start + ((end - start) / (count - 1)) * index;
}

function getTrainingDayShortLabel(day: string) {
  const normalized = normalizeTrainingDay(day);
  const labels = new Map([
    ["lunes", "L"],
    ["monday", "L"],
    ["martes", "M"],
    ["tuesday", "M"],
    ["miercoles", "X"],
    ["wednesday", "X"],
    ["jueves", "J"],
    ["thursday", "J"],
    ["viernes", "V"],
    ["friday", "V"],
    ["sabado", "S"],
    ["saturday", "S"],
    ["domingo", "D"],
    ["sunday", "D"],
  ]);
  return labels.get(normalized) ?? day.trim().slice(0, 1).toUpperCase();
}

function clampWeeklyValue(value: number) {
  return Math.max(-4, Math.min(4, value));
}

function normalizeTrainingDay(day: string) {
  return day
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
