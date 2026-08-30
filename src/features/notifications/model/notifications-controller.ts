import { buildAppNotifications, dedupeNotifications, sortNotificationsByPriority, type BuildAppNotificationsInput } from "@/lib/notifications/notification-model";
import {
  buildNotificationBadgeAriaLabel,
  buildNotificationBadgeText,
  buildNotificationPanelSubtitleText,
  selectNotificationView,
} from "@/lib/notifications/notification-selector";
import {
  markNotificationsSeen,
  resolveNotificationOpenIntent,
} from "@/lib/notifications/notification-state";
import type {
  AppNotification,
  NotificationOpenIntent,
  SeenNotificationRecord,
} from "@/lib/notifications/notification-types";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";

export interface NotificationsIdentityPort {
  captureRequestToken(): SessionDataRequestToken;
  isRequestTokenCurrent(token: SessionDataRequestToken): boolean;
}

export interface NotificationsStoragePort {
  load(scope: BrowserStorageScope): SeenNotificationRecord[];
  save(records: SeenNotificationRecord[], scope: BrowserStorageScope): void;
}

interface CapturedNotificationOwner {
  readonly token: SessionDataRequestToken;
  readonly scope: BrowserStorageScope;
  readonly identityVersion: number;
}

export interface NotificationsDerivedSnapshot {
  readonly appNotifications: AppNotification[];
  readonly newNotifications: AppNotification[];
  readonly historyNotifications: AppNotification[];
  readonly unseenNotificationCount: number;
  readonly seenNotificationRecordsById: Map<string, SeenNotificationRecord>;
  readonly notificationPanelSubtitle: string;
  readonly notificationBadgeText: string | null;
  readonly notificationBadgeAriaLabel: string | null;
}

export interface CapturedNotificationCommands {
  markSeen(ids: readonly string[]): boolean;
  open(notification: AppNotification, publishIntent: (intent: NotificationOpenIntent) => void): boolean;
}

export interface NotificationsController {
  getSeenRecords(): readonly SeenNotificationRecord[];
  subscribe(listener: (records: readonly SeenNotificationRecord[]) => void): () => void;
  replaceIdentityScope(scope: BrowserStorageScope | null): void;
  derive(input: BuildAppNotificationsInput, now?: Date, additional?: readonly AppNotification[], persistedSeen?: readonly SeenNotificationRecord[], includeCatalog?: boolean): NotificationsDerivedSnapshot;
  captureCommands(): CapturedNotificationCommands;
  invalidateIdentity(): void;
  dispose(): void;
}

export function createNotificationsController(input: {
  identity: NotificationsIdentityPort;
  storage: NotificationsStoragePort;
}): NotificationsController {
  const listeners = new Set<(records: readonly SeenNotificationRecord[]) => void>();
  let seenRecords: readonly SeenNotificationRecord[] = [];
  let activeScope: BrowserStorageScope | null = null;
  let identityVersion = 0;
  let disposed = false;
  const openReplayGuards = new Map<string, symbol>();

  function publish(records: readonly SeenNotificationRecord[]) {
    if (disposed) return;
    seenRecords = records;
    for (const listener of listeners) listener(seenRecords);
  }

  function isCapturedOwnerCurrent(owner: CapturedNotificationOwner) {
    return !disposed &&
      activeScope === owner.scope &&
      identityVersion === owner.identityVersion &&
      owner.token.scope === owner.scope &&
      input.identity.isRequestTokenCurrent(owner.token);
  }

  function createOpenReplayKey(
    owner: CapturedNotificationOwner,
    intent: NotificationOpenIntent,
  ) {
    return JSON.stringify([
      owner.identityVersion,
      owner.token.generation,
      owner.token.userId,
      owner.scope,
      intent.notificationId,
      intent.target,
      intent.dashboardDayOverride,
      intent.comparisonDayOverride,
      intent.section,
    ]);
  }

  function acquireOpenReplayGuard(
    owner: CapturedNotificationOwner,
    intent: NotificationOpenIntent,
  ) {
    const key = createOpenReplayKey(owner, intent);
    if (openReplayGuards.has(key)) return null;
    const guard = Symbol(key);
    openReplayGuards.set(key, guard);
    queueMicrotask(() => {
      if (openReplayGuards.get(key) === guard) openReplayGuards.delete(key);
    });
    return { key, guard };
  }

  function releaseOpenReplayGuard(lock: { key: string; guard: symbol }) {
    if (openReplayGuards.get(lock.key) === lock.guard) openReplayGuards.delete(lock.key);
  }

  function sameRecords(
    left: readonly SeenNotificationRecord[],
    right: readonly SeenNotificationRecord[],
  ) {
    return left.length === right.length && left.every((record, index) => (
      record.id === right[index]?.id && record.seenAt === right[index]?.seenAt
    ));
  }

  const controller: NotificationsController = {
    getSeenRecords() {
      return seenRecords;
    },

    subscribe(listener) {
      disposed = false;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    replaceIdentityScope(scope) {
      if (scope === activeScope) return;
      identityVersion += 1;
      openReplayGuards.clear();
      activeScope = scope;
      publish(scope ? input.storage.load(scope) : []);
    },

    derive(catalogInput, now, additional = [], persistedSeen = [], includeCatalog = true) {
      const appNotifications = sortNotificationsByPriority(dedupeNotifications([
        ...(includeCatalog ? buildAppNotifications(catalogInput, now) : []), ...additional,
      ]));
      const mergedSeen = [...seenRecords, ...persistedSeen].reduce<SeenNotificationRecord[]>((records, record) => {
        const index = records.findIndex((candidate) => candidate.id === record.id);
        if (index < 0) records.push(record);
        else if (records[index]!.seenAt < record.seenAt) records[index] = record;
        return records;
      }, []);
      const view = selectNotificationView(appNotifications, mergedSeen);
      return {
        appNotifications,
        newNotifications: view.newNotifications,
        historyNotifications: view.historyNotifications,
        unseenNotificationCount: view.unseenCount,
        seenNotificationRecordsById: view.seenRecordsById,
        notificationPanelSubtitle: buildNotificationPanelSubtitleText(
          view.unseenCount,
          appNotifications.length,
        ),
        notificationBadgeText: buildNotificationBadgeText(view.unseenCount),
        notificationBadgeAriaLabel: buildNotificationBadgeAriaLabel(view.unseenCount),
      };
    },

    captureCommands() {
      const token = input.identity.captureRequestToken();
      const scope = activeScope;
      const owner = scope ? { token, scope, identityVersion } : null;

      function markSeen(ids: readonly string[]) {
        if (!owner || ids.length === 0 || !isCapturedOwnerCurrent(owner)) return false;
        const nextRecords = markNotificationsSeen(seenRecords, ids);
        if (!isCapturedOwnerCurrent(owner)) return false;
        if (!sameRecords(seenRecords, nextRecords)) {
          const persistable = nextRecords.map((record) => ({ id: record.id, seenAt: record.seenAt }));
          input.storage.save(persistable, owner.scope);
          if (!isCapturedOwnerCurrent(owner)) return false;
          publish(persistable);
        }
        return true;
      }

      return {
        markSeen,
        open(notification, publishIntent) {
          if (!owner || !isCapturedOwnerCurrent(owner)) return false;
          const intent = resolveNotificationOpenIntent(notification);
          const replayGuard = acquireOpenReplayGuard(owner, intent);
          if (!replayGuard) return false;
          const isPersistedCalendarNotification = notification.kind === "calendar"
            && notification.id.startsWith("calendar:");
          const isPersistedTrainingCycleNotification = notification.kind === "training-cycle"
            && notification.id.startsWith("training-cycle:");
          if (!isPersistedCalendarNotification) {
            if (!isPersistedTrainingCycleNotification) {
              if (!markSeen([notification.id])) {
                releaseOpenReplayGuard(replayGuard);
                return false;
              }
            }
          }
          if (!isCapturedOwnerCurrent(owner)) {
            releaseOpenReplayGuard(replayGuard);
            return false;
          }
          publishIntent(intent);
          return true;
        },
      };
    },

    invalidateIdentity() {
      identityVersion += 1;
      openReplayGuards.clear();
      activeScope = null;
      publish([]);
    },

    dispose() {
      if (disposed) return;
      controller.invalidateIdentity();
      disposed = true;
      listeners.clear();
    },
  };

  return controller;
}
