import {
  CALENDAR_WEEKDAYS,
  CALENDAR_WEEKDAY_LABELS,
  compareCalendarDates,
  formatCalendarDatePhrase,
  getMonthlyWeekPosition,
  getWeekdayForDate,
  parseCalendarDateKey,
} from "./calendar-date";
import type {
  CalendarDateKey,
  CalendarReminderEnd,
  CalendarReminderEndMode,
  CalendarReminderKind,
  CalendarReminderLeadTime,
  CalendarReminderMonthlyMode,
  CalendarReminderRepeat,
  CalendarReminderRecurrence,
  CalendarWeekday,
  CreateCalendarReminderDto,
} from "./types";

export interface ReminderFormValues {
  readonly title: string;
  readonly description: string;
  readonly kind: CalendarReminderKind;
  readonly time: string;
  readonly repeat: CalendarReminderRepeat;
  readonly weekdays: readonly CalendarWeekday[];
  readonly monthlyMode: CalendarReminderMonthlyMode;
  readonly endMode: CalendarReminderEndMode;
  readonly endDate: string;
  readonly occurrences: number;
  readonly leadTime: CalendarReminderLeadTime;
  readonly emailNotification: boolean;
}

export interface ReminderFormErrors {
  readonly title?: string;
  readonly weekdays?: string;
  readonly time?: string;
  readonly endDate?: string;
}

export interface ReminderFormState {
  readonly selectedDate: CalendarDateKey;
  readonly values: ReminderFormValues;
  readonly errors: ReminderFormErrors;
  readonly submitAttempted: boolean;
}

type FieldChangedAction = {
  [Field in keyof ReminderFormValues]: {
    readonly type: "field_changed";
    readonly field: Field;
    readonly value: ReminderFormValues[Field];
  };
}[keyof ReminderFormValues];

export type ReminderFormAction =
  | FieldChangedAction
  | { readonly type: "weekday_toggled"; readonly weekday: CalendarWeekday }
  | { readonly type: "occurrences_changed"; readonly value: number }
  | { readonly type: "submit_attempted" }
  | { readonly type: "reset"; readonly selectedDate: CalendarDateKey };

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function createInitialReminderFormState(selectedDate: CalendarDateKey): ReminderFormState {
  if (!parseCalendarDateKey(selectedDate)) {
    throw new RangeError("La fecha seleccionada debe usar el formato YYYY-MM-DD");
  }
  return {
    selectedDate,
    values: {
      title: "",
      description: "",
      kind: "revision",
      time: "09:00",
      repeat: "once",
      weekdays: [getWeekdayForDate(selectedDate)],
      monthlyMode: "day_of_month",
      endMode: "never",
      endDate: "",
      occurrences: 4,
      leadTime: "at_time",
      emailNotification: false,
    },
    errors: {},
    submitAttempted: false,
  };
}

function sortWeekdays(weekdays: readonly CalendarWeekday[]): readonly CalendarWeekday[] {
  return [...new Set(weekdays)].sort(
    (left, right) => CALENDAR_WEEKDAYS.indexOf(left) - CALENDAR_WEEKDAYS.indexOf(right),
  );
}

export function validateReminderForm(state: ReminderFormState): ReminderFormErrors {
  const errors: {
    title?: string;
    weekdays?: string;
    time?: string;
    endDate?: string;
  } = {};
  if (state.values.title.trim().length === 0) {
    errors.title = "Escribe un título para el recordatorio";
  }
  if (!TIME_PATTERN.test(state.values.time)) {
    errors.time = "Elige una hora válida";
  }
  if (state.values.repeat === "weekly" && state.values.weekdays.length === 0) {
    errors.weekdays = "Elige al menos un día";
  }
  if (state.values.repeat !== "once" && state.values.endMode === "on_date") {
    if (!parseCalendarDateKey(state.values.endDate)) {
      errors.endDate = "Elige una fecha de término";
    } else if (compareCalendarDates(state.values.endDate, state.selectedDate) < 0) {
      errors.endDate = "La fecha de término no puede ser anterior al recordatorio";
    }
  }
  return errors;
}

export function reminderFormReducer(
  state: ReminderFormState,
  action: ReminderFormAction,
): ReminderFormState {
  if (action.type === "reset") return createInitialReminderFormState(action.selectedDate);
  if (action.type === "submit_attempted") {
    return { ...state, submitAttempted: true, errors: validateReminderForm(state) };
  }
  if (action.type === "weekday_toggled") {
    const exists = state.values.weekdays.includes(action.weekday);
    const weekdays = sortWeekdays(
      exists
        ? state.values.weekdays.filter((weekday) => weekday !== action.weekday)
        : [...state.values.weekdays, action.weekday],
    );
    const errors = weekdays.length > 0 && state.errors.weekdays
      ? { ...state.errors, weekdays: undefined }
      : state.errors;
    return { ...state, values: { ...state.values, weekdays }, errors };
  }
  if (action.type === "occurrences_changed") {
    const occurrences = Math.max(2, Math.min(52, Math.round(action.value)));
    if (occurrences === state.values.occurrences) return state;
    return { ...state, values: { ...state.values, occurrences } };
  }

  if (Object.is(state.values[action.field], action.value)) return state;
  const values = { ...state.values, [action.field]: action.value } as ReminderFormValues;
  let errors = state.errors;
  if (action.field === "title" && String(action.value).trim().length > 0 && errors.title) {
    errors = { ...errors, title: undefined };
  }
  if (action.field === "time" && TIME_PATTERN.test(String(action.value)) && errors.time) {
    errors = { ...errors, time: undefined };
  }
  if (action.field === "endDate" && parseCalendarDateKey(String(action.value)) && errors.endDate) {
    errors = { ...errors, endDate: undefined };
  }
  return { ...state, values, errors };
}

export interface ReminderFormView {
  readonly showWeeklyPanel: boolean;
  readonly showMonthlyPanel: boolean;
  readonly showEndSection: boolean;
  readonly showEndDate: boolean;
  readonly showOccurrences: boolean;
  readonly canSubmit: boolean;
  readonly summary: string;
  readonly monthlyLabels: {
    readonly byDay: string;
    readonly byWeekdayPosition: string;
  };
}

const POSITION_LABELS = {
  1: "primer",
  2: "segundo",
  3: "tercer",
  4: "cuarto",
  last: "último",
} as const;

const LEAD_SUMMARY: Record<CalendarReminderLeadTime, string | null> = {
  at_time: null,
  "10_minutes": "Aviso 10 min antes",
  "1_hour": "Aviso 1 hora antes",
  "1_day": "Aviso 1 día antes",
};

export function buildReminderSummary(state: ReminderFormState): string {
  const { values, selectedDate } = state;
  const weekday = getWeekdayForDate(selectedDate);
  let summary: string;

  if (values.repeat === "once") {
    summary = `Una sola vez, el ${formatCalendarDatePhrase(selectedDate)} a las ${values.time} hrs`;
  } else if (values.repeat === "daily") {
    summary = `Todos los días a las ${values.time} hrs`;
  } else if (values.repeat === "weekly") {
    const labels = sortWeekdays(values.weekdays).map(
      (selectedWeekday) => CALENDAR_WEEKDAY_LABELS[selectedWeekday].short,
    );
    summary = labels.length > 0
      ? `Cada ${labels.join(", ")} a las ${values.time} hrs`
      : "Elige al menos un día";
  } else if (values.monthlyMode === "day_of_month") {
    const parsed = parseCalendarDateKey(selectedDate);
    summary = `El día ${parsed?.day ?? ""} de cada mes a las ${values.time} hrs`;
  } else {
    const position = getMonthlyWeekPosition(selectedDate);
    summary = `El ${POSITION_LABELS[position]} ${CALENDAR_WEEKDAY_LABELS[weekday].full} de cada mes a las ${values.time} hrs`;
  }

  if (values.repeat !== "once" && values.endMode === "on_date") {
    summary += parseCalendarDateKey(values.endDate)
      ? `, hasta el ${formatCalendarDatePhrase(values.endDate, true)}`
      : ", elige la fecha de término";
  }
  if (values.repeat !== "once" && values.endMode === "after_occurrences") {
    summary += `, ${values.occurrences} veces`;
  }
  const leadSummary = LEAD_SUMMARY[values.leadTime];
  if (leadSummary) summary += ` · ${leadSummary}`;
  if (values.emailNotification) summary += " · Preferencia de correo pendiente";
  return summary;
}

export function deriveReminderFormView(state: ReminderFormState): ReminderFormView {
  const parsed = parseCalendarDateKey(state.selectedDate);
  const weekday = getWeekdayForDate(state.selectedDate);
  const position = getMonthlyWeekPosition(state.selectedDate);
  return {
    showWeeklyPanel: state.values.repeat === "weekly",
    showMonthlyPanel: state.values.repeat === "monthly",
    showEndSection: state.values.repeat !== "once",
    showEndDate: state.values.repeat !== "once" && state.values.endMode === "on_date",
    showOccurrences:
      state.values.repeat !== "once" && state.values.endMode === "after_occurrences",
    // Condición contractual del diseño: la validación detallada sigue ocurriendo al enviar.
    canSubmit:
      state.values.title.trim().length > 0 &&
      (state.values.repeat !== "weekly" || state.values.weekdays.length > 0),
    summary: buildReminderSummary(state),
    monthlyLabels: {
      byDay: `El día ${parsed?.day ?? ""} de cada mes`,
      byWeekdayPosition: `Cada ${CALENDAR_WEEKDAY_LABELS[weekday].full} como este (${POSITION_LABELS[position]})`,
    },
  };
}

function buildEnd(values: ReminderFormValues): CalendarReminderEnd {
  if (values.endMode === "on_date") return { mode: "on_date", date: values.endDate };
  if (values.endMode === "after_occurrences") {
    return { mode: "after_occurrences", occurrences: values.occurrences };
  }
  return { mode: "never" };
}

function buildRecurrence(state: ReminderFormState): CalendarReminderRecurrence {
  const { values, selectedDate } = state;
  if (values.repeat === "once") return { frequency: "once" };
  const end = buildEnd(values);
  if (values.repeat === "daily") return { frequency: "daily", end };
  if (values.repeat === "weekly") {
    return { frequency: "weekly", weekdays: sortWeekdays(values.weekdays), end };
  }
  const parsed = parseCalendarDateKey(selectedDate);
  if (!parsed) throw new RangeError("La fecha seleccionada no es válida");
  return {
    frequency: "monthly",
    mode: values.monthlyMode === "day_of_month"
      ? { type: "day_of_month", day: parsed.day }
      : {
          type: "weekday_position",
          weekday: getWeekdayForDate(selectedDate),
          position: getMonthlyWeekPosition(selectedDate),
        },
    end,
  };
}

export type BuildCreateReminderResult =
  | { readonly ok: true; readonly dto: CreateCalendarReminderDto }
  | { readonly ok: false; readonly errors: ReminderFormErrors };

export function buildCreateCalendarReminderDto(
  state: ReminderFormState,
): BuildCreateReminderResult {
  const errors = validateReminderForm(state);
  if (Object.values(errors).some(Boolean)) return { ok: false, errors };

  // Allowlist explícita: cada clave autorizada se copia individualmente.
  const dto: CreateCalendarReminderDto = {
    title: state.values.title.trim(),
    description: state.values.description.trim(),
    kind: state.values.kind,
    startsOn: state.selectedDate,
    time: state.values.time,
    leadTime: state.values.leadTime,
    emailNotification: state.values.emailNotification,
    recurrence: buildRecurrence(state),
  };
  return { ok: true, dto };
}
