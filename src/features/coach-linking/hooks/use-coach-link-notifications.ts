"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import {
  listOwnCoachLinkNotifications,
  markOwnCoachLinkNotificationRead,
  type CoachLinkNotificationPortalScope,
} from "../data/coach-link-notifications-repository";

type Snapshot = {
  readonly contextKey: string | null;
  readonly notifications: readonly AppNotification[];
  readonly seenRecords: readonly SeenNotificationRecord[];
};

const EMPTY: Snapshot = { contextKey: null, notifications: [], seenRecords: [] };

export function useCoachLinkNotifications(
  identityKey: string | null,
  portalScope: CoachLinkNotificationPortalScope,
) {
  const contextKey = identityKey ? `${identityKey}:${portalScope}` : null;
  const generation = useRef(0);
  const [state, setState] = useState<Snapshot>(EMPTY);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (!identityKey) {
      setState(EMPTY);
      return;
    }
    try {
      const next = await listOwnCoachLinkNotifications(identityKey, portalScope);
      if (generation.current === current) setState({ contextKey, ...next });
    } catch {
      if (generation.current === current) setState({ contextKey, notifications: [], seenRecords: [] });
    }
  }, [contextKey, identityKey, portalScope]);

  useLayoutEffect(() => {
    void reload();
    return () => { generation.current += 1; };
  }, [reload]);

  useEffect(() => {
    function refresh() { if (document.visibilityState === "visible") void reload(); }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  const markRead = useCallback((notificationId: string) => {
    if (!identityKey || !notificationId.startsWith("coach-link:")) return;
    const current = generation.current;
    const seenAt = Date.now();
    setState((snapshot) => snapshot.contextKey === contextKey ? {
      ...snapshot,
      seenRecords: [
        ...snapshot.seenRecords.filter((record) => record.id !== notificationId),
        { id: notificationId, seenAt },
      ],
    } : snapshot);
    void markOwnCoachLinkNotificationRead(identityKey, portalScope, notificationId).catch(() => {
      if (generation.current === current) void reload();
    });
  }, [contextKey, identityKey, portalScope, reload]);

  return state.contextKey === contextKey
    ? { notifications: state.notifications, seenRecords: state.seenRecords, reload, markRead }
    : { notifications: EMPTY.notifications, seenRecords: EMPTY.seenRecords, reload, markRead };
}

