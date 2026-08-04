import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createRepositoryTrainingDataSource } from "@/lib/training/training-data-source";

const calls: string[] = [];
const activeCycle = {
  id: "cycle-a",
  name: "Ciclo A",
  cycleNumber: 1,
  cycleType: "meso",
  goal: "Hipertrofia",
  startedAt: "2026-08-03T00:00:00.000Z",
  endedAt: null,
  plannedStartDate: "2026-08-03",
  plannedEndDate: "2026-08-31",
  status: "active" as const,
  planSnapshot: { source: "cycle-scoped" },
  summarySnapshot: null,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
};
const plan = { routines: [] };
const source = createRepositoryTrainingDataSource({
  async loadAppData(mode, expectedUserId) {
    calls.push(`app:${mode}:${expectedUserId ?? "none"}`);
    return { exercises: [], entries: [], sessions: [], source: "supabase" };
  },
  async getActiveCycle() {
    calls.push("active");
    return activeCycle;
  },
  async getCycleHistory() {
    calls.push("history");
    return [];
  },
  async getCyclePlan(cycleId) {
    calls.push(`plan:${cycleId}`);
    return plan;
  },
  async getCycleSessions(cycleId, receivedPlan) {
    calls.push(`sessions:${cycleId}`);
    assert.equal(receivedPlan, plan);
    return { sessions: [], entries: [] };
  },
});

async function awaitAppData() {
  const appData = await source.loadAppData("supabase", "user-a");
  const cycles = await source.loadCycles();
  const cyclePlan = await source.loadCyclePlan("cycle-a");
  const sessions = await source.loadCycleSessions("cycle-a", cyclePlan);
  assert.equal(appData.source, "supabase");
  assert.equal(cycles.active?.id, "cycle-a");
  assert.deepEqual(sessions, { sessions: [], entries: [] });
  assert.deepEqual(calls, [
    "app:supabase:user-a",
    "active",
    "history",
    "plan:cycle-a",
    "sessions:cycle-a",
  ]);

  const repositorySource = readFileSync("src/lib/data/repository.ts", "utf8");
  assert.match(
    repositorySource,
    /if \(isMissingTrainingSessionSourceColumnError\(error\)\) \{\s*return deriveLegacyTrainingSessions\(await fetchEntries\(userId\)\);/,
    "el adapter conserva el fallback remoto training_sessions -> exercise_entries",
  );
  console.log("training data source tests passed");
}

void awaitAppData().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
