"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import { listOwnCalendarNotifications, markOwnCalendarNotificationRead } from "../data/supabase-calendar-notifications-repository";

type PersistedCalendarNotificationsSnapshot = {
  ownerIdentityKey: string | null;
  notifications: AppNotification[];
  seenRecords: SeenNotificationRecord[];
};

const EMPTY_VISIBLE_SNAPSHOT = {
  notifications: [] as readonly AppNotification[],
  seenRecords: [] as readonly SeenNotificationRecord[],
};

export function selectOwnedCalendarNotificationsSnapshot(
  snapshot: PersistedCalendarNotificationsSnapshot,
  identityKey: string | null,
) {
  if (!identityKey || snapshot.ownerIdentityKey !== identityKey) return EMPTY_VISIBLE_SNAPSHOT;
  return { notifications: snapshot.notifications, seenRecords: snapshot.seenRecords };
}

export function shouldReloadAfterCalendarMarkReadFailure(
  requestedGeneration: number,
  currentGeneration: number,
) {
  return requestedGeneration === currentGeneration;
}

export function usePersistedCalendarNotifications(identityKey: string | null) {
  const generation = useRef(0);
  const [state, setState] = useState<PersistedCalendarNotificationsSnapshot>({
    ownerIdentityKey: null,
    notifications: [],
    seenRecords: [],
  });

  const reload = useCallback(async () => {
    const requestedIdentityKey = identityKey;
    const current = ++generation.current;
    if (!requestedIdentityKey) {
      setState({ ownerIdentityKey: null, notifications: [], seenRecords: [] });
      return;
    }
    try {
      const next = await listOwnCalendarNotifications(requestedIdentityKey, () => generation.current === current);
      if (generation.current === current) {
        setState({ ownerIdentityKey: requestedIdentityKey, ...next });
      }
    } catch {
      if (generation.current === current) {
        setState({ ownerIdentityKey: requestedIdentityKey, notifications: [], seenRecords: [] });
      }
    }
  }, [identityKey]);

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
    setState((currentState) => currentState.ownerIdentityKey === identityKey
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
      notificationId,
      () => generation.current === current,
    ).catch(() => {
      if (shouldReloadAfterCalendarMarkReadFailure(current, generation.current)) void reload();
    });
  }, [identityKey, reload]);

  const visibleState = selectOwnedCalendarNotificationsSnapshot(state, identityKey);
  return { ...visibleState, markRead, reload };
}
