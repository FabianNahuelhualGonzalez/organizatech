export type CalendarDateKey = string;

export type CalendarReminderKind = "revision" | "vencimiento" | "personal";
export type CalendarReminderRepeat = "once" | "daily" | "weekly" | "monthly";
export type CalendarWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type CalendarReminderLeadTime = "at_time" | "10_minutes" | "1_hour" | "1_day";
export type CalendarReminderMonthlyMode = "day_of_month" | "weekday_position";
export type CalendarReminderEndMode = "never" | "on_date" | "after_occurrences";
export type CalendarMonthlyWeekPosition = 1 | 2 | 3 | 4 | "last";

export interface CalendarReminder {
  readonly id: string;
  readonly startsOn: CalendarDateKey;
  readonly title: string;
  readonly kind: CalendarReminderKind;
  readonly time: string;
  readonly repeat: CalendarReminderRepeat;
}

export type CalendarReminderEnd =
  | { readonly mode: "never" }
  | { readonly mode: "on_date"; readonly date: CalendarDateKey }
  | { readonly mode: "after_occurrences"; readonly occurrences: number };

export type CalendarReminderRecurrence =
  | { readonly frequency: "once" }
  | { readonly frequency: "daily"; readonly end: CalendarReminderEnd }
  | {
      readonly frequency: "weekly";
      readonly weekdays: readonly CalendarWeekday[];
      readonly end: CalendarReminderEnd;
    }
  | {
      readonly frequency: "monthly";
      readonly mode:
        | { readonly type: "day_of_month"; readonly day: number }
        | {
            readonly type: "weekday_position";
            readonly weekday: CalendarWeekday;
            readonly position: CalendarMonthlyWeekPosition;
          };
      readonly end: CalendarReminderEnd;
    };

/**
 * Contrato de escritura deliberadamente pequeño. Se construye campo por campo en
 * `buildCreateCalendarReminderDto`; no admite objetos crudos de formularios.
 */
export interface CreateCalendarReminderDto {
  readonly title: string;
  readonly description: string;
  readonly kind: CalendarReminderKind;
  readonly startsOn: CalendarDateKey;
  readonly time: string;
  readonly leadTime: CalendarReminderLeadTime;
  readonly emailNotification: boolean;
  readonly recurrence: CalendarReminderRecurrence;
}

export interface CalendarReminderCreationResult {
  readonly id: string;
}

/**
 * Puerto de escritura inyectado por el futuro composition root. Esta feature no
 * conoce Supabase, rutas HTTP ni ownership; esos límites pertenecen al adapter.
 */
export type CreateCalendarReminderAdapter = (
  dto: CreateCalendarReminderDto,
) => Promise<CalendarReminderCreationResult>;

export interface MonthGridCell {
  readonly day: number | null;
  readonly date: CalendarDateKey | null;
}

export interface MonthGridWeek {
  readonly cells: readonly MonthGridCell[];
}

export interface MonthGrid {
  readonly year: number;
  readonly month: number;
  readonly monthName: string;
  readonly firstColumn: number;
  readonly daysInMonth: number;
  readonly weeks: readonly MonthGridWeek[];
}

export interface CalendarRemindersFeatureProps {
  readonly year: number;
  /** Mes civil en rango 1..12. */
  readonly month: number;
  readonly reminders: readonly CalendarReminder[];
  /** Fecha civil del consumidor; `null` evita depender del reloj durante hidratación. */
  readonly today?: CalendarDateKey | null;
  readonly onBack: () => void;
  readonly showBackButton?: boolean;
  readonly onCreateReminder: CreateCalendarReminderAdapter;
}
