"use client";

import { useId, useMemo, useRef } from "react";

import { AppBackButton } from "@/ui/navigation/app-back-button";

import { useCalendarRemindersController } from "../hooks/use-calendar-reminders-controller";
import { buildMonthGrid, isDateInMonth } from "../model/calendar-date";
import { createCalendarRemindersAriaIds } from "../model/calendar-reminders-aria";
import type { CalendarRemindersFeatureProps } from "../model/types";
import styles from "../calendar-reminders.module.css";
import { CalendarGrid } from "./calendar-grid";
import { MonthlyAgenda } from "./monthly-agenda";
import { ReminderSheet } from "./reminder-sheet";

export function CalendarRemindersFeature({
  year,
  month,
  reminders,
  today = null,
  onBack,
  showBackButton = true,
  onCreateReminder,
}: CalendarRemindersFeatureProps) {
  const ariaIds = createCalendarRemindersAriaIds(useId());
  const scrollRef = useRef<HTMLDivElement>(null);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const controller = useCalendarRemindersController({ reminders, onCreateReminder });
  const monthReminders = useMemo(
    () => controller.visibleReminders.filter((reminder) => isDateInMonth(reminder.startsOn, year, month)),
    [controller.visibleReminders, month, year],
  );

  return (
    <section className={styles.feature} aria-labelledby={ariaIds.featureTitle}>
      <div className={styles.scrollRegion} ref={scrollRef}>
        <div className={styles.page}>
          {showBackButton ? <div className={styles.backRow}><AppBackButton onBack={onBack} /></div> : null}
          <h1 id={ariaIds.featureTitle}>Calendario</h1>
          <p className={styles.lede}>
            Ocúpalo para lo que más necesites: agenda citas y recordatorios. Velamos siempre por la buena organización.
          </p>

          <div className={styles.monthHeader}>
            <h2 id={ariaIds.monthLabel}>{grid.monthName}</h2>
            <p>Toca un día para agendar</p>
          </div>

          <CalendarGrid
            key={`${year}-${month}`}
            grid={grid}
            reminders={monthReminders}
            selectedDate={controller.state.selectedDate}
            today={today && isDateInMonth(today, year, month) ? today : null}
            monthLabelId={ariaIds.monthLabel}
            onSelectDate={controller.selectDay}
          />
          <MonthlyAgenda
            titleId={ariaIds.agendaTitle}
            monthName={grid.monthName}
            reminders={monthReminders}
          />
          <div className={styles.tail} aria-hidden="true" />
        </div>
      </div>

      {controller.state.sheetOpen && controller.state.selectedDate ? (
        <ReminderSheet
          selectedDate={controller.state.selectedDate}
          saving={controller.state.saving}
          saveError={controller.state.saveError}
          inertTargetRef={scrollRef}
          onClose={controller.closeSheet}
          onSubmit={controller.createReminder}
        />
      ) : null}

      {controller.state.toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span>{controller.state.toast.message}</span>
        </div>
      ) : null}
    </section>
  );
}
