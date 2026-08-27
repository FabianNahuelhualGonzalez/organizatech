import {
  CALENDAR_WEEKDAY_LABELS,
  getWeekdayForDate,
  parseCalendarDateKey,
} from "../model/calendar-date";
import type { CalendarReminder, CalendarReminderKind } from "../model/types";
import styles from "../calendar-reminders.module.css";

const KIND_LABELS: Readonly<Record<CalendarReminderKind, string>> = {
  revision: "Revisión",
  vencimiento: "Vencimiento",
  personal: "Personal",
};

export function MonthlyAgenda({
  titleId,
  monthName,
  reminders,
}: {
  readonly titleId: string;
  readonly monthName: string;
  readonly reminders: readonly CalendarReminder[];
}) {
  return (
    <section className={styles.agenda} aria-labelledby={titleId}>
      <div className={styles.agendaHeader}>
        <h2 id={titleId}>Recordatorios de {monthName}</h2>
        <p>{reminders.length} en total</p>
      </div>
      {reminders.length === 0 ? (
        <p className={styles.agendaEmpty}>Sin recordatorios este mes</p>
      ) : (
        <ul className={styles.agendaList}>
          {reminders.map((reminder) => {
            const parsed = parseCalendarDateKey(reminder.startsOn);
            const weekday = getWeekdayForDate(reminder.startsOn);
            return (
              <li className={styles.agendaItem} key={reminder.id}>
                <span className={styles.agendaBar} data-kind={reminder.kind} aria-hidden="true" />
                <span className={styles.agendaBody}>
                  <span className={styles.agendaLabel}>{reminder.title}</span>
                  <span className={styles.agendaMeta}>
                    {CALENDAR_WEEKDAY_LABELS[weekday].short} {parsed?.day} de {monthName} · {KIND_LABELS[reminder.kind]} · {reminder.time}
                  </span>
                </span>
                <span className={styles.agendaDay} data-kind={reminder.kind} aria-hidden="true">
                  {parsed?.day}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
