import assert from "node:assert/strict";
import test from "node:test";

import {
  createLegacyCycleHistoryController,
  projectLegacyCycleHistorySnapshot,
  serializeLegacyCycleHistorySnapshot,
} from "./legacy-cycle-history-controller";
import {
  advanceSessionDataEpoch,
  captureSessionDataRequestToken,
  createSessionDataEpoch,
  isSessionDataRequestTokenCurrent,
} from "@/lib/session/session-data-epoch";
import { createDefaultTrainingPlan } from "@/lib/training/training-plan-rules";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SCOPE_A = `supabase:${USER_A}` as const;
const SCOPE_B = `supabase:${USER_B}` as const;

function rawSnapshot(extras: Record<string, unknown> = {}) {
  return {
    id: "cycle-1",
    name: "Ciclo 1",
    createdAt: "2026-07-01",
    endedAt: "2026-08-01",
    plan: { ...createDefaultTrainingPlan(), injectedPlan: "drop" },
    exercises: [{
      id: "exercise-1",
      routine: "A",
      name: "Press",
      targetSets: 3,
      targetReps: 8,
      baseWeight: 20,
      injectedExercise: "drop",
    }],
    entries: [{
      id: "entry-1",
      exerciseId: "exercise-1",
      exerciseName: "Press",
      routine: "A",
      week: 1,
      date: "2026-07-01",
      targetSets: 3,
      targetReps: 8,
      weight: 20,
      previousWeight: 0,
      reps: [8, 8, 8],
      injectedEntry: "drop",
    }],
    injectedTopLevel: "drop",
    ...extras,
  };
}

test("JSON inválido/malformado falla cerrado o normaliza colecciones toleradas", () => {
  assert.equal(projectLegacyCycleHistorySnapshot(null), null);
  assert.equal(projectLegacyCycleHistorySnapshot({ id: "x" }), null);
  const projected = projectLegacyCycleHistorySnapshot(rawSnapshot({ exercises: "bad", entries: null }));
  assert.deepEqual(projected?.exercises, []);
  assert.deepEqual(projected?.entries, []);
});

test("adapter y serializer descartan propiedades adicionales con allowlist campo por campo", () => {
  const projected = projectLegacyCycleHistorySnapshot(rawSnapshot());
  assert.ok(projected);
  const serialized = serializeLegacyCycleHistorySnapshot(projected);
  assert.equal("injectedTopLevel" in serialized, false);
  assert.equal("injectedPlan" in serialized.plan, false);
  assert.equal("injectedExercise" in serialized.exercises[0], false);
  assert.equal("injectedEntry" in serialized.entries[0], false);
  assert.deepEqual(Object.keys(serialized).sort(), [
    "createdAt",
    "endedAt",
    "entries",
    "exercises",
    "id",
    "name",
    "plan",
  ]);
});

test("controller carga/persiste por scope, produce snapshot y no mezcla logout/reingreso", () => {
  let epoch = createSessionDataEpoch({ userId: USER_A, scope: SCOPE_A });
  const stored = new Map<string, unknown[]>([[SCOPE_A, [rawSnapshot()]], [SCOPE_B, []]]);
  const writes: string[] = [];
  const controller = createLegacyCycleHistoryController({
    identity: {
      captureRequestToken: () => captureSessionDataRequestToken(epoch),
      isRequestTokenCurrent: (token) => isSessionDataRequestTokenCurrent(epoch, token),
    },
    storage: {
      load: (scope) => stored.get(scope) ?? [],
      save: (history, scope) => {
        stored.set(scope, [...history]);
        writes.push(scope);
        return true;
      },
    },
    now: () => "2026-08-04T12:00:00.000Z",
    createId: () => "cycle-2",
  });
  controller.replaceIdentityScope(SCOPE_A);
  assert.equal(controller.getSnapshot().legacyCycleHistoryCount, 1);
  assert.equal(controller.getSnapshot().nextLegacyCycleNumber, 2);
  const appended = controller.appendCompletedCycle({
    plan: createDefaultTrainingPlan(),
    exercises: [],
    entries: [],
  });
  assert.equal(appended?.name, "Ciclo 2");
  assert.deepEqual(writes, [SCOPE_A]);

  epoch = advanceSessionDataEpoch(epoch, { userId: null, scope: null });
  controller.replaceIdentityScope(null);
  assert.deepEqual(controller.getSnapshot().cycleHistory, []);
  epoch = advanceSessionDataEpoch(epoch, { userId: USER_B, scope: SCOPE_B });
  controller.replaceIdentityScope(SCOPE_B);
  assert.deepEqual(controller.getSnapshot().cycleHistory, []);
});
