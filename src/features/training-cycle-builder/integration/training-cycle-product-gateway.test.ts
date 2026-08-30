import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingCycleSaveDraftInput } from "../components/training-cycle-builder-contracts";
import type {
  TrainingCycleAcceptedOperation,
  TrainingCycleRpcSnapshot,
} from "../data/training-cycle-rpc-types";
import { TrainingCycleTransportError } from "../data/training-cycle-rpc-types";
import { createTrainingCycleProductGateway } from "./training-cycle-product-gateway";
import { createTrainingCycleProductLifecycleController } from "./training-cycle-product-lifecycle";

const CATALOG_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_CYCLE_ID = "20000000-0000-4000-8000-000000000001";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const NEW_DRAFT_ID = "30000000-0000-4000-8000-000000000002";
const CYCLE_ID = "40000000-0000-4000-8000-000000000001";

function accepted(operationKind: TrainingCycleAcceptedOperation["operationKind"], aggregateId: string, version: number): TrainingCycleAcceptedOperation {
  return { responseKind: "accepted_operation", requestId: crypto.randomUUID(), operationKind, aggregateId, resultVersion: version };
}

function snapshot(version: number): TrainingCycleRpcSnapshot {
  return {
    cycleId: CYCLE_ID, portalScope: "usuario", cycleNumber: 2, goal: "volume",
    startDate: "2026-09-01", endDate: "2026-10-13", status: "active", daysUntilEnd: 45,
    version, snapshotId: crypto.randomUUID(), extensionCount: 0, sourceDraftId: DRAFT_ID,
    sourceCycleId: SOURCE_CYCLE_ID, closedAt: null, closedReason: null,
    createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
    plan: { days: [] },
  };
}

function saveInput(origin: TrainingCycleSaveDraftInput["origin"] = "duplicate"): TrainingCycleSaveDraftInput {
  return {
    draftId: "local:draft", origin, goal: "volume", startDate: "2026-09-01", endDate: "2026-10-13",
    days: [{
      day: "monday", name: "Empuje", exercises: [{
        source: { kind: "catalog", id: CATALOG_ID }, name: "Press", muscleGroup: "Pectoral", order: 1,
        technique: "linear", videoUrl: null,
        sets: [{ order: 1, targetReps: 10, targetKg: 80, toFailure: false, drops: [] }],
      }],
    }],
  };
}

function fakeRpc(input: { readonly createdDraftId?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    createCustomExercise: async () => ({ kind: "custom" as const, id: crypto.randomUUID() }),
    createDraft: async () => { calls.push("create"); return accepted("draft_create", input.createdDraftId ?? DRAFT_ID, 1); },
    saveDraft: async (input: { expectedVersion: number }) => { calls.push(`save:${input.expectedVersion}`); return accepted("draft_save", DRAFT_ID, input.expectedVersion + 1); },
    discardDraft: async (_id: string, version: number) => { calls.push(`discard:${version}`); return accepted("draft_discard", DRAFT_ID, version + 1); },
    duplicateCycle: async () => { calls.push("duplicate"); return accepted("draft_duplicate", DRAFT_ID, 1); },
    activateDraft: async (_id: string, version: number) => { calls.push(`activate:${version}`); return accepted("cycle_activate", CYCLE_ID, 1); },
    editActiveCycle: async (input: { expectedVersion: number }) => accepted("cycle_edit", CYCLE_ID, input.expectedVersion + 1),
    extendActiveCycle: async (input: { expectedVersion: number }) => accepted("cycle_extend", CYCLE_ID, input.expectedVersion + 1),
    getCycle: async () => snapshot(2),
  };
}

test("duplica una vez, guarda la edición sobre versión 1 y activa la última versión", async () => {
  const rpc = fakeRpc();
  const gateway = createTrainingCycleProductGateway({ rpc, catalog: [], remoteDraft: null, sourceCycleId: SOURCE_CYCLE_ID, activeCycle: null });
  await gateway.saveDraft(saveInput());
  const activated = await gateway.activateCycle();
  assert.deepEqual(rpc.calls, ["duplicate", "save:1", "activate:2"]);
  assert.equal(activated.cycleId, CYCLE_ID);
});

test("activación refresca legacy y comenzar vuelve a refrescar antes de navegar", async () => {
  const rpc = fakeRpc();
  const lifecycleCalls: string[] = [];
  const lifecycle = createTrainingCycleProductLifecycleController({
    ownerContextKey: "usuario:test-owner",
    getCurrentContextKey: () => "usuario:test-owner",
    async onCycleChanged(cycleId) {
      lifecycleCalls.push(`refresh:${cycleId}`);
      return true;
    },
    onStartTraining(cycleId) {
      lifecycleCalls.push(`training:${cycleId}`);
    },
  });
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: [],
    remoteDraft: null,
    remoteDraftReference: { draftId: DRAFT_ID, version: 3 },
    sourceCycleId: null,
    activeCycle: null,
    onCycleChanged: async (cycle) => {
      await lifecycle.onCycleChanged(cycle.cycleId);
    },
  });

  const activated = await gateway.activateCycle();
  assert.equal(await lifecycle.onStartTraining(activated.cycleId), true);

  assert.deepEqual(rpc.calls, ["activate:3"]);
  assert.deepEqual(lifecycleCalls, [
    `refresh:${CYCLE_ID}`,
    `refresh:${CYCLE_ID}`,
    `training:${CYCLE_ID}`,
  ]);
});

test("un borrador manual se crea con el plan cerrado sin una escritura duplicada", async () => {
  const rpc = fakeRpc();
  const gateway = createTrainingCycleProductGateway({ rpc, catalog: [], remoteDraft: null, sourceCycleId: null, activeCycle: null });
  await gateway.saveDraft(saveInput("manual"));
  assert.deepEqual(rpc.calls, ["create"]);
});

test("traduce conflicto OCC de edición activa a resultado visible", async () => {
  const rpc = fakeRpc();
  rpc.editActiveCycle = async () => { throw new TrainingCycleTransportError("conflict", "conflict"); };
  const gateway = createTrainingCycleProductGateway({ rpc, catalog: [], remoteDraft: null, sourceCycleId: null, activeCycle: snapshot(4) });
  const result = await gateway.saveActiveCycle({ cycleId: CYCLE_ID, expectedRevision: "4", goal: "volume", days: saveInput().days });
  assert.deepEqual(result, { status: "conflict" });
});

test("la edición activa espera la sincronización del consumidor legacy", async () => {
  const rpc = fakeRpc();
  const refreshed: string[] = [];
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: [],
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: snapshot(4),
    onCycleChanged: async (cycle) => {
      refreshed.push(cycle.cycleId);
      await refreshGate;
    },
  });

  let settled = false;
  const saving = gateway.saveActiveCycle({
    cycleId: CYCLE_ID,
    expectedRevision: "4",
    goal: "volume",
    days: saveInput().days,
  });
  void saving.then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  releaseRefresh();
  const result = await saving;

  assert.equal(result.status, "saved");
  assert.deepEqual(refreshed, [CYCLE_ID]);
});

test("rechaza origen resume si no existe borrador remoto", async () => {
  const gateway = createTrainingCycleProductGateway({ rpc: fakeRpc(), catalog: [], remoteDraft: null, sourceCycleId: null, activeCycle: null });
  await assert.rejects(gateway.saveDraft(saveInput("resume")), /borrador guardado/i);
});

test("discard seguido de manual crea un draft remoto nuevo en el primer autosave", async () => {
  const rpc = fakeRpc({ createdDraftId: NEW_DRAFT_ID });
  const references: Array<{ readonly draftId: string; readonly version: number } | null> = [];
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: [],
    remoteDraft: null,
    remoteDraftReference: { draftId: DRAFT_ID, version: 3 },
    sourceCycleId: null,
    activeCycle: null,
    onDraftDiscarded: () => references.push(null),
    onDraftPersisted: (draftId, version) => references.push({ draftId, version }),
  });

  await gateway.discardDraft();
  await gateway.saveDraft({ ...saveInput("manual"), draftId: "local:fresh-after-discard" });

  assert.deepEqual(rpc.calls, ["discard:3", "create"]);
  assert.deepEqual(references, [null, { draftId: NEW_DRAFT_ID, version: 1 }]);
});
