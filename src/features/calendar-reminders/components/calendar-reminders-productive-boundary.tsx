"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  captureCalendarRemindersOperationClient,
  createOwnCalendarReminder,
  getCalendarRemindersClient,
  listOwnCalendarReminderOccurrences,
} from "../data/supabase-calendar-reminders-repository";
import { createCalendarDateKey, getDaysInMonth, parseCalendarDateKey } from "../model/calendar-date";
import { getSantiagoCalendarDate } from "../model/reminder-recurrence";
import type { CalendarPortalScope, CalendarReminder, CreateCalendarReminderDto } from "../model/types";
import { CalendarRemindersFeature } from "./calendar-reminders-feature";

export function CalendarRemindersProductiveBoundary({
  identityKey,
  portalScope,
  onBack,
  showBackButton = true,
}: {
  readonly identityKey: string;
  readonly portalScope: CalendarPortalScope;
  readonly onBack: () => void;
  readonly showBackButton?: boolean;
}) {
  const today = useMemo(() => getSantiagoCalendarDate(), []);
  const parsedToday = parseCalendarDateKey(today);
  if (!parsedToday) throw new Error("calendar-reminders-invalid-santiago-date");
  const { year, month } = parsedToday;
  const range = useMemo(() => ({
    from: createCalendarDateKey(year, month, 1),
    to: createCalendarDateKey(year, month, getDaysInMonth(year, month)),
  }), [month, year]);
  const client = useMemo(() => getCalendarRemindersClient(), []);
  const [reminders, setReminders] = useState<readonly CalendarReminder[]>([]);
  const generationRef = useRef(0);
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;

  const reload = useCallback(async () => {
    if (!client) return;
    const generation = ++generationRef.current;
    try {
      const next = await listOwnCalendarReminderOccurrences({
        client,
        expectedUserId: identityKey,
        portalScope,
        from: range.from,
        to: range.to,
      });
      if (generationRef.current === generation) setReminders(next);
    } catch {
      if (generationRef.current === generation) setReminders([]);
    }
  }, [client, identityKey, portalScope, range.from, range.to]);

  useEffect(() => {
    setReminders([]);
    void reload();
    return () => {
      generationRef.current += 1;
    };
  }, [reload]);

  const handleCreate = useCallback(async (dto: CreateCalendarReminderDto) => {
    if (!client) throw new Error("calendar-reminders-client-unavailable");
    const operationIdentity = identityKey;
    const operationGeneration = generationRef.current;
    const isCurrent = () => (
      identityRef.current === operationIdentity
      && generationRef.current === operationGeneration
    );
    const operation = await captureCalendarRemindersOperationClient({
      principal: client,
      expectedUserId: operationIdentity,
      isCurrent,
    });
    const result = await createOwnCalendarReminder({
      operation,
      expectedUserId: operationIdentity,
      portalScope,
      requestId: globalThis.crypto.randomUUID(),
      dto,
      isCurrent,
    });
    if (isCurrent()) void reload();
    return result;
  }, [client, identityKey, portalScope, reload]);

  return (
    <CalendarRemindersFeature
      key={`${identityKey}:${portalScope}`}
      year={year}
      month={month}
      reminders={reminders}
      today={today}
      onBack={onBack}
      showBackButton={showBackButton}
      onCreateReminder={handleCreate}
    />
  );
}
