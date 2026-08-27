"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import {
  CALENDAR_WEEKDAY_LABELS,
  CALENDAR_WEEKDAYS,
  getCalendarGridTabIndex,
  getCalendarKeyboardTarget,
  isDateInMonth,
  type CalendarGridNavigationKey,
} from "../model/calendar-date";
import type {
  CalendarDateKey,
  CalendarReminder,
  MonthGrid,
} from "../model/types";
import styles from "../calendar-reminders.module.css";

const GRID_KEYS = new Set<CalendarGridNavigationKey>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

function buildDayAriaLabel(input: {
  readonly day: number;
  readonly monthName: string;
  readonly isToday: boolean;
  readonly reminders: readonly CalendarReminder[];
}): string {
  const reminderSummary = input.reminders.length === 0
    ? "sin recordatorios"
    : `${input.reminders.length} recordatorio${input.reminders.length === 1 ? "" : "s"}: ${input.reminders.map((reminder) => reminder.title).join(", ")}`;
  return `${input.day} de ${input.monthName}${input.isToday ? ", hoy" : ""}, ${reminderSummary}. Añadir recordatorio`;
}

export function CalendarGrid({
  grid,
  reminders,
  selectedDate,
  today,
  monthLabelId,
  onSelectDate,
}: {
  readonly grid: MonthGrid;
  readonly reminders: readonly CalendarReminder[];
  readonly selectedDate: CalendarDateKey | null;
  readonly today: CalendarDateKey | null;
  readonly monthLabelId: string;
  readonly onSelectDate: (date: CalendarDateKey) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const selectedDay = selectedDate && isDateInMonth(selectedDate, grid.year, grid.month)
    ? Number(selectedDate.slice(-2))
    : null;
  const todayDay = today && isDateInMonth(today, grid.year, grid.month)
    ? Number(today.slice(-2))
    : null;
  const [focusedDay, setFocusedDay] = useState(selectedDay ?? todayDay ?? 1);
  const remindersByDate = new Map<CalendarDateKey, CalendarReminder[]>();
  for (const reminder of reminders) {
    const current = remindersByDate.get(reminder.startsOn) ?? [];
    current.push(reminder);
    remindersByDate.set(reminder.startsOn, current);
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: number) {
    if (!GRID_KEYS.has(event.key as CalendarGridNavigationKey)) return;
    event.preventDefault();
    const target = getCalendarKeyboardTarget(
      day,
      event.key as CalendarGridNavigationKey,
      grid.daysInMonth,
      grid.firstColumn,
    );
    setFocusedDay(target);
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${target}"]`)?.focus();
  }

  return (
    <div className={styles.calendarGrid} role="grid" aria-labelledby={monthLabelId} ref={gridRef}>
      <div className={styles.weekdayHeader} role="row">
        {CALENDAR_WEEKDAYS.map((weekday) => {
          const label = CALENDAR_WEEKDAY_LABELS[weekday];
          return (
            <span role="columnheader" key={weekday}>
              <abbr title={label.full}>{label.initial}</abbr>
            </span>
          );
        })}
      </div>
      {grid.weeks.map((week, weekIndex) => (
        <div className={styles.calendarWeek} role="row" key={weekIndex}>
          {week.cells.map((cell, cellIndex) => {
            if (!cell.date || !cell.day) {
              return (
                <span
                  className={styles.calendarPad}
                  role="gridcell"
                  aria-hidden="true"
                  key={`pad-${cellIndex}`}
                />
              );
            }
            const dayReminders = remindersByDate.get(cell.date) ?? [];
            const isToday = cell.date === today;
            const isSelected = cell.date === selectedDate;
            return (
              <span className={styles.calendarCell} role="gridcell" key={cell.date}>
                <button
                  className={styles.dayButton}
                  type="button"
                  data-day={cell.day}
                  data-today={isToday}
                  tabIndex={getCalendarGridTabIndex(cell.day, focusedDay)}
                  aria-pressed={isSelected}
                  aria-label={buildDayAriaLabel({
                    day: cell.day,
                    monthName: grid.monthName,
                    isToday,
                    reminders: dayReminders,
                  })}
                  onClick={() => onSelectDate(cell.date as CalendarDateKey)}
                  onFocus={() => setFocusedDay(cell.day as number)}
                  onKeyDown={(event) => handleDayKeyDown(event, cell.day as number)}
                >
                  <span className={styles.dayNumber}>{cell.day}</span>
                  <span className={styles.dayDots} aria-hidden="true">
                    {dayReminders.slice(0, 3).map((reminder, index) => (
                      <span
                        className={styles.dayDot}
                        data-kind={reminder.kind}
                        key={`${reminder.id}-${index}`}
                      />
                    ))}
                  </span>
                </button>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
