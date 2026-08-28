"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  calendarRemindersReducer,
  createCalendarRemindersState,
  createOptimisticCalendarReminder,
  selectVisibleCalendarReminders,
} from "../model/calendar-controller";
import { createReminderOperationOwner } from "../model/create-reminder-operation-owner";
import type {
  CalendarDateKey,
  CalendarReminder,
  CreateCalendarReminderAdapter,
  CreateCalendarReminderDto,
} from "../model/types";

const LOCAL_SAVE_ERROR = "No se pudo guardar. Intenta de nuevo";

export function useCalendarRemindersController(input: {
  readonly reminders: readonly CalendarReminder[];
  readonly onCreateReminder: CreateCalendarReminderAdapter;
}) {
  const { reminders, onCreateReminder } = input;
  const [state, dispatch] = useReducer(
    calendarRemindersReducer,
    reminders,
    createCalendarRemindersState,
  );
  const saveSequenceRef = useRef(0);
  const saveOwnerRef = useRef(createReminderOperationOwner());
  const mountedRef = useRef(true);

  useEffect(() => {
    dispatch({ type: "external_reminders_received", reminders });
  }, [reminders]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const timeout = window.setTimeout(() => dispatch({ type: "toast_dismissed" }), 2600);
    return () => window.clearTimeout(timeout);
  }, [state.toast]);

  const selectDay = useCallback((date: CalendarDateKey) => {
    dispatch({ type: "day_selected", date });
  }, []);

  const closeSheet = useCallback(() => {
    dispatch({ type: "sheet_closed" });
  }, []);

  const createReminder = useCallback(async (dto: CreateCalendarReminderDto): Promise<boolean> => {
    return saveOwnerRef.current.run(async () => {
      saveSequenceRef.current += 1;
      const token = `calendar-reminder-pending-${saveSequenceRef.current}`;
      dispatch({
        type: "save_started",
        token,
        optimisticReminder: createOptimisticCalendarReminder(token, dto),
      });

      try {
        const result = await onCreateReminder(dto);
        if (!result || typeof result.id !== "string" || result.id.trim().length === 0) {
          throw new Error("calendar-reminder-result-without-id");
        }
        if (mountedRef.current) {
          dispatch({ type: "save_succeeded", token, result: { id: result.id.trim() } });
        }
        return true;
      } catch {
        if (mountedRef.current) {
          dispatch({ type: "save_failed", token, message: LOCAL_SAVE_ERROR });
        }
        return false;
      }
    });
  }, [onCreateReminder]);

  return {
    state,
    visibleReminders: selectVisibleCalendarReminders(state),
    selectDay,
    closeSheet,
    createReminder,
    dismissToast: () => dispatch({ type: "toast_dismissed" }),
  };
}
