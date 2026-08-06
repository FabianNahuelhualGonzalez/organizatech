"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createNotificationsController,
  type NotificationsIdentityPort,
} from "@/features/notifications/model/notifications-controller";
import type { BuildAppNotificationsInput } from "@/lib/notifications/notification-model";
import type { AppNotification, NotificationOpenIntent } from "@/lib/notifications/notification-types";
import {
  loadSeenNotificationRecordsFromBrowser,
  saveSeenNotificationRecordsFromBrowser,
  type BrowserStorageScope,
} from "@/lib/storage/browser-storage";

export function useNotificationsController(input: {
  identity: NotificationsIdentityPort;
  scope: BrowserStorageScope | null;
  catalogInput: BuildAppNotificationsInput;
  onOpenIntent(intent: NotificationOpenIntent): void;
}) {
  const controller = useMemo(() => createNotificationsController({
    identity: input.identity,
    storage: {
      load: loadSeenNotificationRecordsFromBrowser,
      save: saveSeenNotificationRecordsFromBrowser,
    },
  }), [input.identity]);
  const [subscription, setSubscription] = useState(() => ({
    controller,
    records: controller.getSeenRecords(),
  }));
  const records = subscription.controller === controller
    ? subscription.records
    : controller.getSeenRecords();
  const onOpenIntentRef = useRef(input.onOpenIntent);
  onOpenIntentRef.current = input.onOpenIntent;

  useEffect(() => {
    setSubscription({ controller, records: controller.getSeenRecords() });
    const unsubscribe = controller.subscribe((nextRecords) => {
      setSubscription({ controller, records: nextRecords });
    });
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.replaceIdentityScope(input.scope);
  }, [controller, input.scope]);

  const commands = controller.captureCommands();
  const derived = controller.derive(input.catalogInput);

  return {
    controller,
    seenNotificationRecords: records,
    ...derived,
    markNotificationsSeen: commands.markSeen,
    openNotificationTarget(notification: AppNotification) {
      return commands.open(notification, (intent) => onOpenIntentRef.current(intent));
    },
  };
}

export type NotificationsBoundary = ReturnType<typeof useNotificationsController>;
