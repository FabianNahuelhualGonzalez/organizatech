"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  buildCreateCalendarReminderDto,
  createInitialReminderFormState,
  deriveReminderFormView,
  reminderFormReducer,
  type ReminderFormAction,
  type ReminderFormValues,
} from "../model/reminder-form";
import type { CalendarDateKey, CalendarWeekday } from "../model/types";

export function useReminderForm(selectedDate: CalendarDateKey) {
  const [state, dispatch] = useReducer(
    reminderFormReducer,
    selectedDate,
    createInitialReminderFormState,
  );

  useEffect(() => {
    dispatch({ type: "reset", selectedDate });
  }, [selectedDate]);

  const view = useMemo(() => deriveReminderFormView(state), [state]);

  const setField = useCallback(<Field extends keyof ReminderFormValues>(
    field: Field,
    value: ReminderFormValues[Field],
  ) => {
    dispatch({ type: "field_changed", field, value } as ReminderFormAction);
  }, []);

  const toggleWeekday = useCallback((weekday: CalendarWeekday) => {
    dispatch({ type: "weekday_toggled", weekday });
  }, []);

  const setOccurrences = useCallback((value: number) => {
    dispatch({ type: "occurrences_changed", value });
  }, []);

  const validateAndBuild = useCallback(() => {
    dispatch({ type: "submit_attempted" });
    return buildCreateCalendarReminderDto(state);
  }, [state]);

  return {
    state,
    values: state.values,
    errors: state.errors,
    view,
    setField,
    toggleWeekday,
    setOccurrences,
    validateAndBuild,
  };
}
