"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import {
  listOwnCalendarNotifications,
  markOwnCalendarNotificationRead,
  type CalendarNotificationPortalScope,
} from "../data/supabase-calendar-notifications-repository";

type PersistedCalendarNotificationsSnapshot = {
  ownerContextKey: string | null;
  notifications: AppNotification[];
  seenRecords: SeenNotificationRecord[];
};

const EMPTY_VISIBLE_SNAPSHOT = {
  notifications: [] as readonly AppNotification[],
  seenRecords: [] as readonly SeenNotificationRecord[],
};

export function selectOwnedCalendarNotificationsSnapshot(
  snapshot: PersistedCalendarNotificationsSnapshot,
  contextKey: string | null,
) {
  if (!contextKey || snapshot.ownerContextKey !== contextKey) return EMPTY_VISIBLE_SNAPSHOT;
  return { notifications: snapshot.notifications, seenRecords: snapshot.seenRecords };
}

export function shouldReloadAfterCalendarMarkReadFailure(
  requestedGeneration: number,
  currentGeneration: number,
) {
  return requestedGeneration === currentGeneration;
}

export function usePersistedCalendarNotifications(
  identityKey: string | null,
  portalScope: CalendarNotificationPortalScope,
) {
  const contextKey = identityKey ? `${identityKey}:${portalScope}` : null;
  const generation = useRef(0);
  const [state, setState] = useState<PersistedCalendarNotificationsSnapshot>({
    ownerContextKey: null,
    notifications: [],
    seenRecords: [],
  });

  const reload = useCallback(async () => {
    const requestedIdentityKey = identityKey;
    const requestedContextKey = contextKey;
    const current = ++generation.current;
    if (!requestedIdentityKey) {
      setState({ ownerContextKey: null, notifications: [], seenRecords: [] });
      return;
    }
    try {
      const next = await listOwnCalendarNotifications(
        requestedIdentityKey,
        portalScope,
        () => generation.current === current,
      );
      if (generation.current === current) {
        setState({ ownerContextKey: requestedContextKey, ...next });
      }
    } catch {
      if (generation.current === current) {
        setState({ ownerContextKey: requestedContextKey, notifications: [], seenRecords: [] });
      }
    }
  }, [contextKey, identityKey, portalScope]);

  useLayoutEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);

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
    setState((currentState) => currentState.ownerContextKey === contextKey
      ? {
          ...currentState,
          seenRecords: [
            ...currentState.seenRecords.filter((record) => record.id !== notificationId),
            { id: notificationId, seenAt: now },
          ],
        }
      : currentState);
    void markOwnCalendarNotificationRead(
      identityKey,
      portalScope,
      notificationId,
      () => generation.current === current,
    ).catch(() => {
      if (shouldReloadAfterCalendarMarkReadFailure(current, generation.current)) void reload();
    });
  }, [contextKey, identityKey, portalScope, reload]);

  const visibleState = selectOwnedCalendarNotificationsSnapshot(state, contextKey);
  return { ...visibleState, markRead, reload };
}
