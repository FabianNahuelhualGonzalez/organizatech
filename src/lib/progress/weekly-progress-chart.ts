const fallbackTrainingDays = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"];
const fallbackValues = [-0.8, -0.5, 0.2, 1.2, 0.5, 0.8, -0.2];
const chartTopY = 18;
const chartBottomY = 112;

export interface WeeklyProgressChartPoint {
  x: number;
  y: number;
  value: number;
  label: string;
  comparable: boolean;
}

export interface WeeklyDualProgressChartPoint {
  x: number;
  y: number | null;
  value: number | null;
  label: string;
  comparable: boolean;
  volume?: number | null;
}

export interface WeeklyProgressChart {
  labels: string[];
  values: number[];
  points: WeeklyProgressChartPoint[];
  currentPoints: WeeklyDualProgressChartPoint[];
  previousPoints: WeeklyDualProgressChartPoint[];
  activeIndex: number;
  axisLabels: string[];
}

export function buildWeeklyProgressChart(input: {
  weekDays: readonly string[];
  value: number;
  currentDay?: string;
} | {
  series: ReadonlyArray<{ label: string; value: number; comparable?: boolean }>;
} | {
  currentSeries: ReadonlyArray<{ label: string; value: number | null; comparable?: boolean; volume?: number | null }>;
  previousSeries: ReadonlyArray<{ label: string; value: number | null; comparable?: boolean; volume?: number | null }>;
}) {
  if ("currentSeries" in input) return buildWeeklyProgressChartFromDualSeries(input.currentSeries, input.previousSeries);
  if ("series" in input) return buildWeeklyProgressChartFromSeries(input.series);

  const days = normalizeWeekDays(input.weekDays);
  const labels = days.map(getTrainingDayShortLabel);
  const clampedValue = clampWeeklyValue(input.value);
  const activeIndex = getActiveTrainingDayIndex(days, input.currentDay);
  const values = days.map((_, index) => index === activeIndex ? clampedValue : fallbackValues[index % fallbackValues.length]);
  const points = values.map((value, index) => {
    const x = getPointX(index, values.length);
    const y = getPointY(value, 4);
    return { x, y, value, label: labels[index], comparable: true };
  });

  return {
    labels,
    values,
    points,
    currentPoints: points,
    previousPoints: [],
    activeIndex,
    axisLabels: buildAxisLabels(4),
  } satisfies WeeklyProgressChart;
}

function buildWeeklyProgressChartFromSeries(series: ReadonlyArray<{ label: string; value: number; comparable?: boolean }>) {
  const fallbackSeries = series.length > 0 ? series : [{ label: "L", value: 0, comparable: false }];
  const labels = fallbackSeries.map((point) => point.label);
  const values = fallbackSeries.map((point) => point.value);
  const axisLimit = getAxisLimit(values);
  const points = fallbackSeries.map((point, index) => {
    const x = getPointX(index, fallbackSeries.length);
    const y = getPointY(point.value, axisLimit);
    return {
      x,
      y,
      value: point.value,
      label: point.label,
      comparable: point.comparable ?? true,
    };
  });

  return {
    labels,
    values,
    points,
    currentPoints: points,
    previousPoints: [],
    activeIndex: points.length - 1,
    axisLabels: buildAxisLabels(axisLimit),
  } satisfies WeeklyProgressChart;
}

function buildWeeklyProgressChartFromDualSeries(
  currentSeries: ReadonlyArray<{ label: string; value: number | null; comparable?: boolean; volume?: number | null }>,
  previousSeries: ReadonlyArray<{ label: string; value: number | null; comparable?: boolean; volume?: number | null }>,
) {
  const labels = previousSeries.length > 0 ? previousSeries.map((point) => point.label) : currentSeries.map((point) => point.label);
  const allValues = [...currentSeries, ...previousSeries].map((point) => point.value).filter((value): value is number => Number.isFinite(value));
  const axisLimit = getAxisLimit(allValues);
  const count = Math.max(labels.length, currentSeries.length, previousSeries.length, 1);
  const currentPoints = currentSeries.map((point, index) => toDualPoint(point, index, count, axisLimit));
  const previousPoints = previousSeries.map((point, index) => toDualPoint(point, index, count, axisLimit));
  const activeIndex = Math.max(0, currentPoints.findLastIndex((point) => point.value !== null));

  return {
    labels,
    values: allValues,
    points: currentPoints.filter((point): point is WeeklyProgressChartPoint => point.value !== null && point.y !== null).map((point) => ({
      x: point.x,
      y: point.y,
      value: point.value,
      label: point.label,
      comparable: point.comparable,
    })),
    currentPoints,
    previousPoints,
    activeIndex,
    axisLabels: buildAxisLabels(axisLimit),
  } satisfies WeeklyProgressChart;
}

function toDualPoint(
  point: { label: string; value: number | null; comparable?: boolean; volume?: number | null },
  index: number,
  count: number,
  axisLimit: number,
): WeeklyDualProgressChartPoint {
  return {
    x: getPointX(index, count),
    y: point.value === null ? null : getPointY(point.value, axisLimit),
    value: point.value,
    label: point.label,
    comparable: point.comparable ?? point.value !== null,
    volume: point.volume ?? null,
  };
}

function getAxisLimit(values: number[]) {
  const maxAbs = Math.max(4, ...values.map((value) => Math.abs(value)));
  return Math.ceil(maxAbs / 10) * 10;
}

function buildAxisLabels(limit: number) {
  const middle = limit / 2;
  return [`+${formatAxisNumber(limit)}%`, `+${formatAxisNumber(middle)}%`, "0%", `-${formatAxisNumber(middle)}%`, `-${formatAxisNumber(limit)}%`];
}

function formatAxisNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1))).replace(".", ",");
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
  const start = 12;
  const end = 468;
  return start + ((end - start) / (count - 1)) * index;
}

function getPointY(value: number, axisLimit: number) {
  const ratio = (value + axisLimit) / (axisLimit * 2);
  return chartBottomY - ratio * (chartBottomY - chartTopY);
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
