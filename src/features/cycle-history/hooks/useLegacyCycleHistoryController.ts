"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createLegacyCycleHistoryController,
  type LegacyCycleHistoryIdentityPort,
} from "@/features/cycle-history/model/legacy-cycle-history-controller";
import { loadCycleHistory, saveCycleHistory } from "@/lib/storage/app-flow-storage";
import type { BrowserStorageScope } from "@/lib/storage/browser-storage";

export function useLegacyCycleHistoryController(input: {
  identity: LegacyCycleHistoryIdentityPort;
  scope: BrowserStorageScope | null;
}) {
  const controller = useMemo(() => createLegacyCycleHistoryController({
    identity: input.identity,
    storage: {
      load: loadCycleHistory,
      save(history, scope) {
        return saveCycleHistory(history, scope);
      },
    },
  }), [input.identity]);
  const [subscription, setSubscription] = useState(() => ({
    controller,
    snapshot: controller.getSnapshot(),
  }));
  const snapshot = subscription.controller === controller
    ? subscription.snapshot
    : controller.getSnapshot();

  useEffect(() => {
    setSubscription({ controller, snapshot: controller.getSnapshot() });
    const unsubscribe = controller.subscribe((nextSnapshot) => {
      setSubscription({ controller, snapshot: nextSnapshot });
    });
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.replaceIdentityScope(input.scope);
  }, [controller, input.scope]);

  return {
    controller,
    cycleHistory: snapshot.cycleHistory,
    legacyCycleHistoryCount: snapshot.legacyCycleHistoryCount,
    nextLegacyCycleNumber: snapshot.nextLegacyCycleNumber,
    appendCompletedCycle: controller.appendCompletedCycle,
    replaceIdentityScope: controller.replaceIdentityScope,
  };
}

export type LegacyCycleHistoryBoundary = ReturnType<typeof useLegacyCycleHistoryController>;
