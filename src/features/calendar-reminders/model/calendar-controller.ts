import type {
  CalendarDateKey,
  CalendarReminder,
  CalendarReminderCreationResult,
  CreateCalendarReminderDto,
} from "./types";

export type CalendarToast = {
  readonly tone: "success";
  readonly message: string;
};

export interface CalendarRemindersState {
  readonly externalReminders: readonly CalendarReminder[];
  readonly localReminders: readonly CalendarReminder[];
  readonly selectedDate: CalendarDateKey | null;
  readonly sheetOpen: boolean;
  readonly saving: boolean;
  readonly activeSaveToken: string | null;
  readonly saveError: string | null;
  readonly toast: CalendarToast | null;
}

export type CalendarRemindersAction =
  | { readonly type: "external_reminders_received"; readonly reminders: readonly CalendarReminder[] }
  | { readonly type: "day_selected"; readonly date: CalendarDateKey }
  | { readonly type: "sheet_closed" }
  | {
      readonly type: "save_started";
      readonly token: string;
      readonly optimisticReminder: CalendarReminder;
    }
  | {
      readonly type: "save_succeeded";
      readonly token: string;
      readonly result: CalendarReminderCreationResult;
    }
  | { readonly type: "save_failed"; readonly token: string; readonly message: string }
  | { readonly type: "toast_dismissed" };

function cloneReminder(reminder: CalendarReminder): CalendarReminder {
  return {
    id: reminder.id,
    startsOn: reminder.startsOn,
    title: reminder.title,
    kind: reminder.kind,
    time: reminder.time,
    repeat: reminder.repeat,
  };
}

export function createCalendarRemindersState(
  reminders: readonly CalendarReminder[],
): CalendarRemindersState {
  return {
    externalReminders: reminders.map(cloneReminder),
    localReminders: [],
    selectedDate: null,
    sheetOpen: false,
    saving: false,
    activeSaveToken: null,
    saveError: null,
    toast: null,
  };
}

export function calendarRemindersReducer(
  state: CalendarRemindersState,
  action: CalendarRemindersAction,
): CalendarRemindersState {
  if (action.type === "external_reminders_received") {
    const externalReminders = action.reminders.map(cloneReminder);
    const externalIds = new Set(externalReminders.map((reminder) => reminder.id));
    return {
      ...state,
      externalReminders,
      localReminders: state.localReminders.filter((reminder) => !externalIds.has(reminder.id)),
    };
  }
  if (action.type === "day_selected") {
    return {
      ...state,
      selectedDate: action.date,
      sheetOpen: true,
      saveError: null,
      toast: null,
    };
  }
  if (action.type === "sheet_closed") {
    if (state.saving) return state;
    return { ...state, sheetOpen: false, saveError: null };
  }
  if (action.type === "save_started") {
    if (state.saving) return state;
    return {
      ...state,
      saving: true,
      activeSaveToken: action.token,
      saveError: null,
      toast: null,
      localReminders: [...state.localReminders, cloneReminder(action.optimisticReminder)],
    };
  }
  if (action.type === "save_succeeded") {
    if (!state.saving || state.activeSaveToken !== action.token) return state;
    const externalHasResult = state.externalReminders.some(
      (reminder) => reminder.id === action.result.id,
    );
    return {
      ...state,
      saving: false,
      activeSaveToken: null,
      sheetOpen: false,
      saveError: null,
      localReminders: externalHasResult
        ? state.localReminders.filter((reminder) => reminder.id !== action.token)
        : state.localReminders.map((reminder) =>
            reminder.id === action.token ? { ...reminder, id: action.result.id } : reminder,
          ),
      toast: { tone: "success", message: "Recordatorio guardado" },
    };
  }
  if (action.type === "save_failed") {
    if (!state.saving || state.activeSaveToken !== action.token) return state;
    return {
      ...state,
      saving: false,
      activeSaveToken: null,
      saveError: action.message,
      localReminders: state.localReminders.filter((reminder) => reminder.id !== action.token),
      // El diseño del error de guardado sigue pendiente. Se revierte el estado
      // optimista y se expone el error al integrador, sin inventar UI visible.
      toast: null,
    };
  }
  return { ...state, toast: null };
}

export function selectVisibleCalendarReminders(
  state: CalendarRemindersState,
): readonly CalendarReminder[] {
  const byId = new Map<string, CalendarReminder>();
  for (const reminder of state.externalReminders) byId.set(reminder.id, reminder);
  for (const reminder of state.localReminders) byId.set(reminder.id, reminder);
  return [...byId.values()].sort((left, right) =>
    left.startsOn.localeCompare(right.startsOn) ||
    left.time.localeCompare(right.time) ||
    left.title.localeCompare(right.title, "es-CL"),
  );
}

export function createOptimisticCalendarReminder(
  token: string,
  dto: CreateCalendarReminderDto,
): CalendarReminder {
  return {
    id: token,
    startsOn: dto.startsOn,
    title: dto.title,
    kind: dto.kind,
    time: dto.time,
    repeat: dto.recurrence.frequency,
  };
}
