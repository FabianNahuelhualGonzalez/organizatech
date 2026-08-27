"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import { listOwnCalendarNotifications, markOwnCalendarNotificationRead } from "../data/supabase-calendar-notifications-repository";

export function usePersistedCalendarNotifications(identityKey: string | null) {
  const generation = useRef(0);
  const [state, setState] = useState<{ notifications: AppNotification[]; seenRecords: SeenNotificationRecord[] }>({ notifications: [], seenRecords: [] });

  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (!identityKey) { setState({ notifications: [], seenRecords: [] }); return; }
    try {
      const next = await listOwnCalendarNotifications(identityKey, () => generation.current === current);
      if (generation.current === current) setState(next);
    } catch {
      if (generation.current === current) setState({ notifications: [], seenRecords: [] });
    }
  }, [identityKey]);

  useEffect(() => { void reload(); return () => { generation.current += 1; }; }, [reload]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") void reload();
    }
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [reload]);

  const markRead = useCallback((notificationId: string) => {
    if (!identityKey || !notificationId.startsWith("calendar:")) return;
    const current = generation.current;
    const now = Date.now();
    setState((current) => ({ ...current, seenRecords: [...current.seenRecords.filter((record) => record.id !== notificationId), { id: notificationId, seenAt: now }] }));
    void markOwnCalendarNotificationRead(
      identityKey,
      notificationId,
      () => generation.current === current,
    ).catch(() => void reload());
  }, [identityKey, reload]);

  return { ...state, markRead, reload };
}
