import assert from "node:assert/strict";
import test from "node:test";

import { selectTrainingPlanSources } from "./training-plan-sources";
import type { TrainingDataView } from "@/features/training-data/model/training-data-selectors";
import type { TrainingPlan } from "@/lib/training/training-plan-model";
import type { TrainingCycle } from "@/lib/training/training-cycles-repository";

function plan(label: string): TrainingPlan {
  return { label } as unknown as TrainingPlan;
}

function view(
  mode: TrainingDataView["mode"],
  selectedPlan: TrainingPlan,
  activeCycle: TrainingCycle | null,
): TrainingDataView {
  const base = {
    plan: selectedPlan,
    exercises: [],
    entries: [],
    sessions: [],
    activeCycle,
    persistedCycleHistory: [],
    cyclePlan: null,
    isCycleScoped: mode === "cycle-scoped",
  };
  return mode === "blocked"
    ? { ...base, mode, reason: "cycle-loading", blockerMessage: "loading" }
    : { ...base, mode, blockerMessage: "" };
}

test("legacy conserva el draft como display sin inventar snapshot persistido", () => {
  const draft = plan("draft");
  const sources = selectTrainingPlanSources(draft, view("legacy", draft, null));
  assert.equal(sources.draftPlan, draft);
  assert.equal(sources.persistedPlan, null);
  assert.equal(sources.displayTrainingPlan, draft);
});

test("cycle-scoped y blockers priorizan el snapshot persistido sobre el draft", () => {
  const draft = plan("draft");
  const persisted = plan("persisted");
  const activeCycle = { id: "cycle-1" } as TrainingCycle;

  for (const mode of ["cycle-scoped", "blocked"] as const) {
    const sources = selectTrainingPlanSources(draft, view(mode, persisted, activeCycle));
    assert.equal(sources.draftPlan, draft);
    assert.equal(sources.persistedPlan, persisted);
    assert.equal(sources.displayTrainingPlan, persisted);
  }
});
