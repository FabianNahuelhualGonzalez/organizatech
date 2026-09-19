"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  listOwnEvaluationNotifications,
  markOwnEvaluationNotificationRead,
  type EvaluationNotificationPortalScope,
} from "@/features/evaluations/data/evaluation-notifications-repository";
import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";

type Snapshot = {
  readonly key: string | null;
  readonly notifications: readonly AppNotification[];
  readonly seenRecords: readonly SeenNotificationRecord[];
};

const EMPTY: Snapshot = { key: null, notifications: [], seenRecords: [] };

export function useEvaluationNotifications(identityKey: string | null, portalScope: EvaluationNotificationPortalScope) {
  const key = identityKey ? `${identityKey}:${portalScope}` : null;
  const generation = useRef(0);
  const [state, setState] = useState<Snapshot>(EMPTY);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    if (!identityKey) return setState(EMPTY);
    try {
      const next = await listOwnEvaluationNotifications(identityKey, portalScope);
      if (generation.current === current) setState({ key, ...next });
    } catch {
      if (generation.current === current) setState({ key, notifications: [], seenRecords: [] });
    }
  }, [identityKey, key, portalScope]);
  useLayoutEffect(() => { void reload(); return () => { generation.current += 1; }; }, [reload]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [reload]);
  const markRead = useCallback((notificationId: string) => {
    if (!identityKey || !notificationId.startsWith("evaluation:")) return;
    const current = generation.current;
    setState((snapshot) => snapshot.key === key ? {
      ...snapshot,
      seenRecords: [...snapshot.seenRecords.filter((item) => item.id !== notificationId), { id: notificationId, seenAt: Date.now() }],
    } : snapshot);
    void markOwnEvaluationNotificationRead(identityKey, portalScope, notificationId).catch(() => {
      if (generation.current === current) void reload();
    });
  }, [identityKey, key, portalScope, reload]);
  return state.key === key ? { ...state, reload, markRead } : { ...EMPTY, reload, markRead };
}
