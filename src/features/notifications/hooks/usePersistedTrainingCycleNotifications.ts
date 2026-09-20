"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AppNotification, SeenNotificationRecord } from "@/lib/notifications/notification-types";
import {
  isTrainingCycleNotificationAppId,
  listOwnTrainingCycleNotifications,
  markOwnTrainingCycleNotificationsRead,
  type TrainingCycleNotificationsCursor,
} from "../data/supabase-training-cycle-notifications-repository";

type PersistedTrainingCycleNotificationsSnapshot = {
  readonly ownerContextKey: string | null;
  readonly notifications: readonly AppNotification[];
  readonly seenRecords: readonly SeenNotificationRecord[];
  readonly nextCursor: TrainingCycleNotificationsCursor | null;
};

const EMPTY_VISIBLE_SNAPSHOT = {
  notifications: [] as readonly AppNotification[],
  seenRecords: [] as readonly SeenNotificationRecord[],
  nextCursor: null,
};

export function selectOwnedTrainingCycleNotificationsSnapshot(
  snapshot: PersistedTrainingCycleNotificationsSnapshot,
  contextKey: string | null,
) {
  if (!contextKey || snapshot.ownerContextKey !== contextKey) return EMPTY_VISIBLE_SNAPSHOT;
  return {
    notifications: snapshot.notifications,
    seenRecords: snapshot.seenRecords,
    nextCursor: snapshot.nextCursor,
  };
}

export function shouldReloadAfterTrainingCycleMarkReadFailure(
  requestedGeneration: number,
  currentGeneration: number,
) {
  return requestedGeneration === currentGeneration;
}

export function getOrCreateTrainingCycleMarkReadRequestId(
  registry: Map<string, string>,
  contextKey: string,
  notificationId: string,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
) {
  const key = `${contextKey}:${notificationId}`;
  const existing = registry.get(key);
  if (existing) return existing;
  const requestId = createRequestId();
  registry.set(key, requestId);
  return requestId;
}

export function usePersistedTrainingCycleNotifications(identityKey: string | null) {
  const contextKey = identityKey ? `${identityKey}:usuario` : null;
  const generation = useRef(0);
  const markReadRequestIds = useRef(new Map<string, string>());
  const [state, setState] = useState<PersistedTrainingCycleNotificationsSnapshot>({
    ownerContextKey: null,
    notifications: [],
    seenRecords: [],
    nextCursor: null,
  });

  const reload = useCallback(async () => {
    const requestedIdentityKey = identityKey;
    const requestedContextKey = contextKey;
    const current = ++generation.current;
    if (!requestedIdentityKey) {
      setState({ ownerContextKey: null, notifications: [], seenRecords: [], nextCursor: null });
      return;
    }
    try {
      const next = await listOwnTrainingCycleNotifications(
        requestedIdentityKey,
        null,
        () => generation.current === current,
      );
      if (generation.current === current) {
        setState({ ownerContextKey: requestedContextKey, ...next });
      }
    } catch {
      if (generation.current === current) {
        setState({
          ownerContextKey: requestedContextKey,
          notifications: [],
          seenRecords: [],
          nextCursor: null,
        });
      }
    }
  }, [contextKey, identityKey]);

  useLayoutEffect(() => {
    const requestIds = markReadRequestIds.current;
    requestIds.clear();
    void reload();
    return () => {
      generation.current += 1;
      requestIds.clear();
    };
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
    if (!identityKey || !contextKey || !isTrainingCycleNotificationAppId(notificationId)) return;
    const current = generation.current;
    let requestId: string;
    try {
      requestId = getOrCreateTrainingCycleMarkReadRequestId(
        markReadRequestIds.current,
        contextKey,
        notificationId,
      );
    } catch {
      if (shouldReloadAfterTrainingCycleMarkReadFailure(current, generation.current)) void reload();
      return;
    }
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
    void markOwnTrainingCycleNotificationsRead(
      identityKey,
      [notificationId],
      requestId,
      () => generation.current === current,
    ).catch(() => {
      if (shouldReloadAfterTrainingCycleMarkReadFailure(current, generation.current)) void reload();
    });
  }, [contextKey, identityKey, reload]);

  const visibleState = selectOwnedTrainingCycleNotificationsSnapshot(state, contextKey);
  return { ...visibleState, markRead, reload };
}
