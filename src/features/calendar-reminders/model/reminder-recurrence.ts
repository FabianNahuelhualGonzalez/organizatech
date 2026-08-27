import {
  compareCalendarDates,
  createCalendarDateKey,
  getDaysInMonth,
  getMonthlyWeekPosition,
  getWeekdayForDate,
  parseCalendarDateKey,
} from "./calendar-date";
import type {
  CalendarDateKey,
  CalendarReminder,
  CalendarReminderEnd,
  CalendarReminderKind,
  CalendarReminderLeadTime,
  CalendarReminderRecurrence,
} from "./types";

export const CALENDAR_TIME_ZONE = "America/Santiago";

export interface StoredCalendarReminder {
  readonly id: string;
  readonly startsOn: CalendarDateKey;
  readonly title: string;
  readonly description: string;
  readonly kind: CalendarReminderKind;
  readonly time: string;
  readonly leadTime: CalendarReminderLeadTime;
  readonly emailNotification: boolean;
  readonly recurrence: CalendarReminderRecurrence;
}

function nextCivilDate(value: CalendarDateKey): CalendarDateKey {
  const parsed = parseCalendarDateKey(value);
  if (!parsed) throw new RangeError("La fecha debe usar el formato YYYY-MM-DD");
  if (parsed.day < getDaysInMonth(parsed.year, parsed.month)) {
    return createCalendarDateKey(parsed.year, parsed.month, parsed.day + 1);
  }
  if (parsed.month < 12) return createCalendarDateKey(parsed.year, parsed.month + 1, 1);
  return createCalendarDateKey(parsed.year + 1, 1, 1);
}

function isOccurrence(
  candidate: CalendarDateKey,
  startsOn: CalendarDateKey,
  recurrence: CalendarReminderRecurrence,
): boolean {
  if (recurrence.frequency === "once") return candidate === startsOn;
  if (recurrence.frequency === "daily") return true;
  if (recurrence.frequency === "weekly") {
    return recurrence.weekdays.includes(getWeekdayForDate(candidate));
  }

  const parsed = parseCalendarDateKey(candidate);
  if (!parsed) return false;
  if (recurrence.mode.type === "day_of_month") {
    return parsed.day === recurrence.mode.day;
  }
  return getWeekdayForDate(candidate) === recurrence.mode.weekday
    && getMonthlyWeekPosition(candidate) === recurrence.mode.position;
}

function isPastEnd(
  candidate: CalendarDateKey,
  end: CalendarReminderEnd,
  occurrenceNumber: number,
): boolean {
  if (end.mode === "on_date") return compareCalendarDates(candidate, end.date) > 0;
  if (end.mode === "after_occurrences") return occurrenceNumber > end.occurrences;
  return false;
}

export function expandCalendarReminder(
  reminder: StoredCalendarReminder,
  range: { readonly from: CalendarDateKey; readonly to: CalendarDateKey },
): readonly CalendarReminder[] {
  if (!parseCalendarDateKey(range.from) || !parseCalendarDateKey(range.to)) {
    throw new RangeError("El rango debe usar fechas civiles YYYY-MM-DD");
  }
  if (compareCalendarDates(range.from, range.to) > 0) return [];

  const result: CalendarReminder[] = [];
  const end = reminder.recurrence.frequency === "once" ? null : reminder.recurrence.end;
  let candidate = reminder.startsOn;
  let occurrenceNumber = 0;
  let examinedDays = 0;

  while (compareCalendarDates(candidate, range.to) <= 0) {
    examinedDays += 1;
    if (examinedDays > 200_000) throw new RangeError("El rango de recurrencia es demasiado amplio");

    if (isOccurrence(candidate, reminder.startsOn, reminder.recurrence)) {
      occurrenceNumber += 1;
      if (end && isPastEnd(candidate, end, occurrenceNumber)) break;
      if (compareCalendarDates(candidate, range.from) >= 0) {
        result.push({
          id: `${reminder.id}:${candidate}`,
          startsOn: candidate,
          title: reminder.title,
          kind: reminder.kind,
          time: reminder.time,
          repeat: reminder.recurrence.frequency,
        });
      }
      if (reminder.recurrence.frequency === "once") break;
      if (end?.mode === "after_occurrences" && occurrenceNumber >= end.occurrences) break;
    }
    candidate = nextCivilDate(candidate);
  }
  return result;
}

export function getSantiagoCalendarDate(now = new Date()): CalendarDateKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
