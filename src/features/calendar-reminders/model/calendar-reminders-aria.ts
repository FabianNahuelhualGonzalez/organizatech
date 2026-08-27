export interface CalendarRemindersAriaIds {
  readonly featureTitle: string;
  readonly monthLabel: string;
  readonly agendaTitle: string;
  readonly sheetTitle: string;
}

export function createCalendarRemindersAriaIds(instanceId: string): CalendarRemindersAriaIds {
  const prefix = `calendar-reminders-${instanceId.replaceAll(":", "")}`;
  return {
    featureTitle: `${prefix}-title`,
    monthLabel: `${prefix}-month`,
    agendaTitle: `${prefix}-agenda-title`,
    sheetTitle: `${prefix}-sheet-title`,
  };
}
