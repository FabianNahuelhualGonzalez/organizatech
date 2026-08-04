"use client";

import { useEffect, useMemo, useState } from "react";

import {
  createTrainingDataController,
  type TrainingDataController,
} from "@/features/training-data/model/training-data-controller";
import type { TrainingDataIdentityPort } from "@/features/training-data/model/training-data-request-owner";
import { createRepositoryTrainingDataSource } from "@/lib/training/training-data-source";

export interface UseTrainingDataControllerResult {
  controller: TrainingDataController;
  state: ReturnType<TrainingDataController["getState"]>;
}

/** Client-only React bridge. The controller itself remains framework-agnostic. */
export function useTrainingDataController(
  identity: TrainingDataIdentityPort,
): UseTrainingDataControllerResult {
  const controller = useMemo(() => createTrainingDataController({
    identity,
    source: createRepositoryTrainingDataSource(),
  }), [identity]);
  const [snapshot, setSnapshot] = useState(() => ({
    controller,
    state: controller.getState(),
  }));
  const state = snapshot.controller === controller
    ? snapshot.state
    : controller.getState();

  useEffect(() => {
    setSnapshot({ controller, state: controller.getState() });
    const unsubscribe = controller.subscribe((nextState) => {
      setSnapshot({ controller, state: nextState });
    });
    return () => {
      unsubscribe();
      controller.invalidateAll();
    };
  }, [controller]);

  return { controller, state };
}
