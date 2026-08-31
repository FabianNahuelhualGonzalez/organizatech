import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingCycleCatalogCursor } from "../data";
import { TrainingCycleTransportError } from "../data";
import {
  clearDiscardedTrainingCycleProductData,
  loadTrainingCycleProductData,
  selectOwnedTrainingCycleProductSnapshot,
} from "./use-training-cycle-product-controller";
import { createTrainingCycleProductLifecycleController } from "../integration/training-cycle-product-lifecycle";

function fakeRpc(input: { readonly pages?: number; readonly draftSource?: string | null } = {}) {
  const sourceId = input.draftSource ?? null;
  const pageCount = input.pages ?? 1;
  let page = 0;
  const cycleLoads: string[] = [];
  return {
    cycleLoads,
    refreshLifecycle: async () => ({ closedCycleId: null, refreshedAt: "2026-08-29T00:00:00Z" }),
    listCatalog: async () => {
      page += 1;
      return {
        items: [],
        nextCursor: page < pageCount ? {
          afterSourceKind: "catalog" as const,
          afterSortOrder: page,
          afterName: `page-${page}`,
          afterSourceId: `10000000-0000-4000-8000-${String(page).padStart(12, "0")}`,
        } satisfies TrainingCycleCatalogCursor : null,
      };
    },
    getDraft: async () => sourceId ? ({ sourceCycleId: sourceId }) : null,
    getActiveCycle: async () => null,
    listCycles: async () => ({ items: [{ cycleId: "20000000-0000-4000-8000-000000000099" }], nextCursor: null }),
    getCycle: async (cycleId: string) => { cycleLoads.push(cycleId); return { cycleId }; },
  };
}

test("carga catálogo keyset acotado y reutiliza una fuente que también es el último ciclo", async () => {
  const cycleId = "20000000-0000-4000-8000-000000000099";
  const rpc = fakeRpc({ pages: 3, draftSource: cycleId });
  const result = await loadTrainingCycleProductData(rpc as never);
  assert.equal(rpc.cycleLoads.length, 1);
  assert.equal((result.sourceCycle as { cycleId: string }).cycleId, cycleId);
});

test("falla cerrado si el catálogo requiere más de tres páginas", async () => {
  await assert.rejects(loadTrainingCycleProductData(fakeRpc({ pages: 4 }) as never), (error) => {
    assert.ok(error instanceof TrainingCycleTransportError);
    assert.equal(error.code, "invalid_response");
    return true;
  });
});

test("el descarte limpia canónicamente el draft remoto y su referencia", () => {
  const data = {
    catalog: [],
    draft: { draftId: "draft-old" },
    activeCycle: null,
    sourceCycle: { cycleId: "source-old" },
    lastCycle: null,
    draftReference: { draftId: "draft-old", version: 4 },
  } as never;
  const cleared = clearDiscardedTrainingCycleProductData(data);
  assert.equal(cleared.draft, null);
  assert.equal(cleared.draftReference, null);
  assert.equal(cleared.sourceCycle, null);
});

test("A→B oculta el snapshot ready de A antes de que se ejecute el effect de B", () => {
  const snapshotA = {
    ownerContextKey: "usuario:identity-a",
    status: "ready",
    rpc: { identity: "A" },
    data: { privateMarker: "A" },
  } as never;

  assert.equal(
    selectOwnedTrainingCycleProductSnapshot(snapshotA, "usuario:identity-a"),
    snapshotA,
  );
  assert.deepEqual(
    selectOwnedTrainingCycleProductSnapshot(snapshotA, "usuario:identity-b"),
    { ownerContextKey: "usuario:identity-b", status: "loading" },
  );
  assert.deepEqual(
    selectOwnedTrainingCycleProductSnapshot(snapshotA, null),
    { ownerContextKey: null, status: "disabled" },
  );
});

test("activación y comenzar entrenamiento respetan refresh legacy antes de navegar", async () => {
  const calls: string[] = [];
  let ownerCurrent = true;
  let currentContextKey = "usuario:identity-a";
  const lifecycle = createTrainingCycleProductLifecycleController({
    ownerContextKey: "usuario:identity-a",
    getCurrentContextKey: () => currentContextKey,
    async onCycleChanged(cycleId) {
      calls.push(`refresh:${cycleId}`);
      return ownerCurrent;
    },
    onStartTraining(cycleId) {
      calls.push(`training:${cycleId}`);
    },
  });

  assert.equal(await lifecycle.onCycleChanged("cycle-1"), true);
  assert.equal(await lifecycle.onStartTraining("cycle-1"), true);
  ownerCurrent = false;
  assert.equal(await lifecycle.onStartTraining("cycle-stale"), false);
  currentContextKey = "usuario:identity-b";
  assert.equal(await lifecycle.onStartTraining("cycle-other-owner"), false);
  assert.deepEqual(calls, [
    "refresh:cycle-1",
    "refresh:cycle-1",
    "training:cycle-1",
    "refresh:cycle-stale",
  ]);
});

test("refresh A pendiente no puede navegar después del render síncrono de B", async () => {
  const calls: string[] = [];
  let currentContextKey = "usuario:identity-a";
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const lifecycle = createTrainingCycleProductLifecycleController({
    ownerContextKey: "usuario:identity-a",
    getCurrentContextKey: () => currentContextKey,
    async onCycleChanged(cycleId) {
      calls.push(`refresh-a:${cycleId}`);
      await refreshGate;
      return true;
    },
    onStartTraining(cycleId) {
      calls.push(`training:${cycleId}`);
    },
  });

  const pendingStart = lifecycle.onStartTraining("cycle-a");
  await Promise.resolve();
  assert.deepEqual(calls, ["refresh-a:cycle-a"]);

  // Simula el render A→B: el ref cambia antes de que corran cleanup/effects.
  currentContextKey = "usuario:identity-b";
  releaseRefresh();

  assert.equal(await pendingStart, false);
  assert.deepEqual(calls, ["refresh-a:cycle-a"]);
});
