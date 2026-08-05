"use client";

import { useCallback, useMemo, useState } from "react";

import {
  buildProgressControllerView,
  createInitialProgressControllerState,
  progressControllerReducer,
  type ProgressControllerAction,
  type ProgressControllerSource,
  type ProgressControllerState,
} from "@/features/progress/model/progress-controller-state";

export interface ProgressSelectionSnapshot {
  readonly key: string;
  readonly state: ProgressControllerState;
}

export interface ProgressControllerIdentity {
  readonly userId: string | null;
  readonly scope: string | null;
  readonly cycleId: string | null;
}

export interface ProgressController {
  readonly view: ReturnType<typeof buildProgressControllerView>;
  selectDay(day: string): void;
  selectExercise(exerciseId: string): void;
  selectWeek(week: number): void;
  resetSelection(): void;
}

export function createProgressSelectionKey(identity: ProgressControllerIdentity): string {
  return [
    identity.userId ?? "anonymous",
    identity.scope ?? "no-scope",
    identity.cycleId ?? "legacy",
  ].join(":");
}

export function resolveProgressSelectionState(
  snapshot: Readonly<ProgressSelectionSnapshot>,
  key: string,
): ProgressControllerState {
  return snapshot.key === key
    ? snapshot.state
    : createInitialProgressControllerState();
}

export function reduceProgressSelectionSnapshot(
  snapshot: Readonly<ProgressSelectionSnapshot>,
  key: string,
  action: ProgressControllerAction,
): ProgressSelectionSnapshot {
  return {
    key,
    state: progressControllerReducer(resolveProgressSelectionState(snapshot, key), action),
  };
}

/**
 * Controller por instancia para la intención UI de Progress. La key efectiva se
 * evalúa durante render, por lo que una selección de A nunca se publica bajo B
 * ni durante un cambio de ciclo. Las métricas y modelos continúan derivados del
 * source canónico recibido en cada render.
 */
export function useProgressController(
  identity: ProgressControllerIdentity,
  source: Readonly<ProgressControllerSource>,
): ProgressController {
  const key = createProgressSelectionKey(identity);
  const [snapshot, setSnapshot] = useState<ProgressSelectionSnapshot>(() => ({
    key,
    state: createInitialProgressControllerState(),
  }));
  const selection = resolveProgressSelectionState(snapshot, key);

  const dispatch = useCallback((action: ProgressControllerAction) => {
    setSnapshot((current) => reduceProgressSelectionSnapshot(current, key, action));
  }, [key]);

  const view = useMemo(
    () => buildProgressControllerView(selection, source),
    [selection, source],
  );

  return {
    view,
    selectDay: useCallback((day: string) => dispatch({ type: "day_selected", day }), [dispatch]),
    selectExercise: useCallback(
      (exerciseId: string) => dispatch({ type: "exercise_selected", exerciseId }),
      [dispatch],
    ),
    selectWeek: useCallback((week: number) => dispatch({ type: "week_selected", week }), [dispatch]),
    resetSelection: useCallback(() => dispatch({ type: "selection_reset" }), [dispatch]),
  };
}
