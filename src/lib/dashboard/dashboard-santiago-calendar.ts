import { parseDateKeyAsLocalNoon } from "@/lib/progress/week-day";
import type { TrainingDayCode } from "@/lib/progress/types";
import { removeAccents } from "@/lib/training/exercise-name-normalization";
import { getSantiagoDateKey } from "@/lib/training/santiago-training-date";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";

const dashboardCalendarDays: string[] = [...TRAINING_DAY_LABELS];

export function getCurrentSantiagoWeekDates(reference = new Date()) {
  const todayKey = getSantiagoDateKey(reference);
  const todayDate = parseDateKeyAsLocalNoon(todayKey);
  const todayName = getTrainingDayFromDate(todayKey);
  const todayIndex = Math.max(0, dashboardCalendarDays.indexOf(todayName));
  const mondayDate = new Date(todayDate);
  mondayDate.setDate(todayDate.getDate() - todayIndex);

  return Object.fromEntries(dashboardCalendarDays.map((day, index) => {
    const date = new Date(mondayDate);
    date.setDate(mondayDate.getDate() + index);
    return [day, getLocalDateKey(date)];
  }));
}

export function getTrainingDayFromDate(value: string) {
  const date = parseDateKeyAsLocalNoon(value);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    timeZone: "America/Santiago",
  }).format(date);
  return dashboardCalendarDays.find((day) => removeAccents(day.toLowerCase()) === removeAccents(weekday.toLowerCase())) ?? "";
}

export function getLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTrainingDayCode(day: string): TrainingDayCode {
  const mapping: Record<string, TrainingDayCode> = {
    Lunes: "monday",
    Martes: "tuesday",
    Miércoles: "wednesday",
    Jueves: "thursday",
    Viernes: "friday",
    Sábado: "saturday",
    Domingo: "sunday",
  };
  return mapping[day] ?? "monday";
}
