import type {
  CalendarDateKey,
  CalendarMonthlyWeekPosition,
  CalendarWeekday,
  MonthGrid,
  MonthGridCell,
  MonthGridWeek,
} from "./types";

export const CALENDAR_WEEKDAYS: readonly CalendarWeekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const CALENDAR_WEEKDAY_LABELS: Readonly<
  Record<CalendarWeekday, { short: string; full: string; initial: string }>
> = {
  mon: { short: "Lun", full: "lunes", initial: "L" },
  tue: { short: "Mar", full: "martes", initial: "M" },
  wed: { short: "Mié", full: "miércoles", initial: "M" },
  thu: { short: "Jue", full: "jueves", initial: "J" },
  fri: { short: "Vie", full: "viernes", initial: "V" },
  sat: { short: "Sáb", full: "sábado", initial: "S" },
  sun: { short: "Dom", full: "domingo", initial: "D" },
};

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toLocaleUpperCase("es-CL") + value.slice(1);
}

function assertCivilMonth(year: number, month: number): void {
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("El año debe estar entre 1 y 9999");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("El mes debe estar entre 1 y 12");
  }
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function getDaysInMonth(year: number, month: number): number {
  assertCivilMonth(year, month);
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function getMonthName(month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("El mes debe estar entre 1 y 12");
  }
  return MONTH_NAMES[month - 1];
}

export function createCalendarDateKey(year: number, month: number, day: number): CalendarDateKey {
  const daysInMonth = getDaysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
    throw new RangeError("El día no pertenece al mes indicado");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ParsedCalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function parseCalendarDateKey(value: string): ParsedCalendarDate | null {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  try {
    if (createCalendarDateKey(year, month, day) !== value) return null;
  } catch {
    return null;
  }
  return { year, month, day };
}

function createUtcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function getWeekdayForDate(value: CalendarDateKey): CalendarWeekday {
  const parsed = parseCalendarDateKey(value);
  if (!parsed) throw new RangeError("La fecha debe usar el formato YYYY-MM-DD");
  const sundayFirstIndex = createUtcDate(parsed.year, parsed.month, parsed.day).getUTCDay();
  const mondayFirstIndex = (sundayFirstIndex + 6) % 7;
  return CALENDAR_WEEKDAYS[mondayFirstIndex];
}

export function buildMonthGrid(year: number, month: number): MonthGrid {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDate = createCalendarDateKey(year, month, 1);
  const firstColumn = CALENDAR_WEEKDAYS.indexOf(getWeekdayForDate(firstDate));
  const cellCount = Math.ceil((firstColumn + daysInMonth) / 7) * 7;
  const cells: MonthGridCell[] = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstColumn + 1;
    return day < 1 || day > daysInMonth
      ? { day: null, date: null }
      : { day, date: createCalendarDateKey(year, month, day) };
  });
  const weeks: MonthGridWeek[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push({ cells: cells.slice(index, index + 7) });
  }
  return {
    year,
    month,
    monthName: getMonthName(month),
    firstColumn,
    daysInMonth,
    weeks,
  };
}

export function isDateInMonth(value: CalendarDateKey, year: number, month: number): boolean {
  const parsed = parseCalendarDateKey(value);
  return parsed?.year === year && parsed.month === month;
}

export function formatCalendarDateLong(value: CalendarDateKey, includeYear = false): string {
  const parsed = parseCalendarDateKey(value);
  if (!parsed) throw new RangeError("La fecha debe usar el formato YYYY-MM-DD");
  const weekday = CALENDAR_WEEKDAY_LABELS[getWeekdayForDate(value)].full;
  const yearSuffix = includeYear ? ` de ${parsed.year}` : "";
  return `${capitalize(weekday)} ${parsed.day} de ${getMonthName(parsed.month)}${yearSuffix}`;
}

export function formatCalendarDatePhrase(value: CalendarDateKey, includeYear = false): string {
  const parsed = parseCalendarDateKey(value);
  if (!parsed) throw new RangeError("La fecha debe usar el formato YYYY-MM-DD");
  return `${parsed.day} de ${getMonthName(parsed.month)}${includeYear ? ` de ${parsed.year}` : ""}`;
}

export function getMonthlyWeekPosition(value: CalendarDateKey): CalendarMonthlyWeekPosition {
  const parsed = parseCalendarDateKey(value);
  if (!parsed) throw new RangeError("La fecha debe usar el formato YYYY-MM-DD");
  if (parsed.day + 7 > getDaysInMonth(parsed.year, parsed.month)) return "last";
  const ordinal = Math.ceil(parsed.day / 7);
  return Math.min(4, ordinal) as 1 | 2 | 3 | 4;
}

export function compareCalendarDates(left: CalendarDateKey, right: CalendarDateKey): number {
  return left.localeCompare(right);
}

export type CalendarGridNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

export function getCalendarGridTabIndex(day: number, focusedDay: number): 0 | -1 {
  return day === focusedDay ? 0 : -1;
}

export function getCalendarKeyboardTarget(
  currentDay: number,
  key: CalendarGridNavigationKey,
  daysInMonth: number,
  firstColumn = 0,
): number {
  const deltaByKey: Record<Exclude<CalendarGridNavigationKey, "Home" | "End">, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };
  const column = (firstColumn + currentDay - 1) % 7;
  if (key === "Home") return Math.max(1, currentDay - column);
  if (key === "End") return Math.min(daysInMonth, currentDay + (6 - column));
  return Math.max(1, Math.min(daysInMonth, currentDay + deltaByKey[key]));
}
