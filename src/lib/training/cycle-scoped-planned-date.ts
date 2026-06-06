import type { TrainingDayCode } from "@/lib/progress/types";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CycleScopedPlannedDateInput {
  cyclePlannedStartDate: string;
  cyclePlannedEndDate: string;
  weekIndex: number;
  dayCode: TrainingDayCode;
}

export function getCycleScopedPlannedDate(input: CycleScopedPlannedDateInput) {
  const cycleStartDay = parseDateKeyToEpochDay(input.cyclePlannedStartDate);
  const cycleEndDay = parseDateKeyToEpochDay(input.cyclePlannedEndDate);

  if (cycleEndDay < cycleStartDay) {
    throw new Error("La fecha de termino del ciclo no puede ser anterior a la fecha de inicio.");
  }
  if (!Number.isInteger(input.weekIndex) || input.weekIndex < 1) {
    throw new Error("La semana planificada del ciclo debe ser un entero mayor o igual a 1.");
  }

  const cycleWeekStartDay = cycleStartDay + ((input.weekIndex - 1) * 7);
  if (cycleWeekStartDay > cycleEndDay) {
    throw new Error("La semana planificada queda fuera del rango del ciclo.");
  }

  const plannedDay = cycleWeekStartDay + getForwardWeekdayOffset(
    cycleWeekStartDay,
    input.dayCode,
  );
  if (plannedDay > cycleEndDay) {
    throw new Error("El dia planificado queda fuera del rango del ciclo.");
  }

  return formatEpochDayAsDateKey(plannedDay);
}

function parseDateKeyToEpochDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Fecha de ciclo invalida: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Fecha de ciclo invalida: ${value}`);
  }

  return Math.floor(timestamp / MILLISECONDS_PER_DAY);
}

function getForwardWeekdayOffset(epochDay: number, dayCode: TrainingDayCode) {
  const currentWeekday = new Date(epochDay * MILLISECONDS_PER_DAY).getUTCDay();
  const targetWeekday = getUtcWeekday(dayCode);
  return (targetWeekday - currentWeekday + 7) % 7;
}

function getUtcWeekday(dayCode: TrainingDayCode) {
  const weekdays: Record<TrainingDayCode, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return weekdays[dayCode];
}

function formatEpochDayAsDateKey(epochDay: number) {
  return new Date(epochDay * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}
