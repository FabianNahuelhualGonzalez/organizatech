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
  async loadLegacySnapshot(mode, expectedUserId) {
    calls.push(`app:${mode}:${expectedUserId ?? "none"}`);
    return { exercises: [], entries: [], sessions: [], source: "supabase" };
  },
  async ensureProfile(mode, expectedUserId) {
    calls.push(`profile:${mode}:${expectedUserId ?? "none"}`);
  },
  async getActiveCycle(expectedUserId, isExpectedRequestCurrent) {
    calls.push(`active:${expectedUserId ?? "none"}:${isExpectedRequestCurrent?.() ?? false}`);
    return activeCycle;
  },
  async getCycleHistory() {
    calls.push("history");
    return [];
  },
  async getCyclePlan(cycleId, expectedUserId, _getClient, isExpectedRequestCurrent) {
    calls.push(`plan:${cycleId}:${expectedUserId ?? "none"}:${isExpectedRequestCurrent?.() ?? false}`);
    return plan;
  },
  async getCycleSessionRows(cycleId, expectedUserId, _getClient, isExpectedRequestCurrent) {
    calls.push(`session-rows:${cycleId}:${expectedUserId ?? "none"}:${isExpectedRequestCurrent?.() ?? false}`);
    return { raw: true } as never;
  },
  assembleCycleSessions(cycleId, receivedPlan, rawData) {
    calls.push(`assemble:${cycleId}`);
    assert.equal(receivedPlan, plan);
    assert.deepEqual(rawData, { raw: true });
    return { sessions: [], entries: [] };
  },
});

async function awaitAppData() {
  const appData = await source.loadLegacySnapshot("supabase", "user-a");
  await source.ensureProfile("supabase", "user-a");
  const active = await source.loadActiveCycle("user-a", () => true);
  const history = await source.loadCycleHistory();
  const cyclePlan = await source.loadCyclePlan("cycle-a", "user-a", () => true);
  const rawSessionData = await source.loadCycleSessionRows("cycle-a", "user-a", () => true);
  const sessions = source.assembleCycleSessions("cycle-a", cyclePlan, rawSessionData);
  assert.equal(appData.source, "supabase");
  assert.equal(active?.id, "cycle-a");
  assert.deepEqual(history, []);
  assert.deepEqual(sessions, { sessions: [], entries: [] });
  assert.deepEqual(calls, [
    "app:supabase:user-a",
    "profile:supabase:user-a",
    "active:user-a:true",
    "history",
    "plan:cycle-a:user-a:true",
    "session-rows:cycle-a:user-a:true",
    "assemble:cycle-a",
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
