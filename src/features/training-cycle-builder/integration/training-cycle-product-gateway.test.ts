import assert from "node:assert/strict";
import test from "node:test";

import {
  trainingCycleBuilderInstanceKey,
  type TrainingCycleSaveDraftInput,
} from "../components/training-cycle-builder-contracts";
import type {
  TrainingCycleAcceptedOperation,
  TrainingCycleCatalogItem,
  TrainingCycleDraftSnapshot,
  TrainingCyclePreparedDraftOperation,
  TrainingCycleRpcSnapshot,
} from "../data/training-cycle-rpc-types";
import { TrainingCycleCommittedMutationError, TrainingCycleTransportError } from "../data/training-cycle-rpc-types";
import { createTrainingCycleBuilderTestViewModel } from "../hooks/training-cycle-builder-fixtures.check";
import {
  createTrainingCycleBuilderState,
  trainingCycleBuilderReducer,
  type TrainingCycleBuilderAction,
} from "../hooks/training-cycle-builder-state";
import { TrainingCycleNewCycleOperationOwner, publicOperationError } from "../hooks/use-training-cycle-builder-controller";
import {
  closeActiveTrainingCycleProductData,
  type TrainingCycleProductData,
} from "../hooks/use-training-cycle-product-controller";
import { createTrainingCycleProductGateway } from "./training-cycle-product-gateway";
import { createTrainingCycleProductLifecycleController } from "./training-cycle-product-lifecycle";

const CATALOG_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_CYCLE_ID = "20000000-0000-4000-8000-000000000001";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const NEW_DRAFT_ID = "30000000-0000-4000-8000-000000000002";
const CYCLE_ID = "40000000-0000-4000-8000-000000000001";
const ACTIVE_CYCLE_ID = "40000000-0000-4000-8000-000000000002";
const CATALOG = [{
  source: { kind: "catalog" as const, id: CATALOG_ID },
  name: "Press",
  muscleGroup: "pectoral" as const,
  videoUrl: null,
}];

function accepted(operationKind: TrainingCycleAcceptedOperation["operationKind"], aggregateId: string, version: number | null): TrainingCycleAcceptedOperation {
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

function replacementDraft(
  draftId = NEW_DRAFT_ID,
  sourceCycleId = ACTIVE_CYCLE_ID,
): TrainingCycleDraftSnapshot {
  return {
    draftId,
    origin: "duplicate",
    sourceCycleId,
    state: "draft",
    version: 1,
    goal: "volume",
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    plan: {
      days: [{
        day: "monday",
        name: "Empuje",
        order: 0,
        exercises: [{
          catalogExerciseId: CATALOG_ID,
          order: 0,
          technique: "linear",
          videoUrl: null,
          sets: [{ order: 0, targetReps: 10, targetKg: 80, toFailure: false, drops: [] }],
        }],
      }],
    },
    activatedCycleId: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function preparedReplacement(
  draft = replacementDraft(),
  exerciseSources: readonly TrainingCycleCatalogItem[] = CATALOG,
): TrainingCyclePreparedDraftOperation {
  return {
    responseKind: "prepared_draft",
    requestId: crypto.randomUUID(),
    operationKind: "draft_duplicate",
    aggregateId: draft.draftId,
    resultVersion: draft.version,
    draft,
    exerciseSources,
  };
}

function fakeRpc(input: {
  readonly createdDraftId?: string;
  readonly activeGuard?: { readonly cycleId: string; readonly hasCanonicalPlan: boolean } | null;
} = {}) {
  const calls: string[] = [];
  return {
    calls,
    createCustomExercise: async () => ({ kind: "custom" as const, id: crypto.randomUUID() }),
    createDraft: async () => { calls.push("create"); return accepted("draft_create", input.createdDraftId ?? DRAFT_ID, 1); },
    saveDraft: async (input: { draftId: string; expectedVersion: number }) => { calls.push(`save:${input.expectedVersion}`); return accepted("draft_save", input.draftId, input.expectedVersion + 1); },
    discardDraft: async (_id: string, version: number) => { calls.push(`discard:${version}`); return accepted("draft_discard", DRAFT_ID, version + 1); },
    duplicateCycle: async (_input: { readonly sourceCycleId: string }) => { calls.push("duplicate"); return accepted("draft_duplicate", DRAFT_ID, 1); },
    getActiveCycleGuard: async () => input.activeGuard ?? null,
    completeActiveCycleManually: async ({ expectedActiveCycleId }: { expectedActiveCycleId: string }) => {
      calls.push(`close:${expectedActiveCycleId}`);
      return accepted("cycle_close", expectedActiveCycleId, null);
    },
    replaceActiveCycleToDraft: async ({ expectedActiveCycleId }: { expectedActiveCycleId: string }) => {
      calls.push(`replace:${expectedActiveCycleId}`);
      return preparedReplacement();
    },
    getDraft: async () => {
      calls.push("get-draft");
      throw new Error("replacement must not depend on a post-commit draft read");
    },
    activateDraft: async (_id: string, version: number) => { calls.push(`activate:${version}`); return accepted("cycle_activate", CYCLE_ID, 1); },
    editActiveCycle: async (input: { expectedVersion: number }) => accepted("cycle_edit", CYCLE_ID, input.expectedVersion + 1),
    extendActiveCycle: async (input: { expectedVersion: number }) => accepted("cycle_extend", CYCLE_ID, input.expectedVersion + 1),
    getCycle: async () => snapshot(2),
  };
}

test("false de sincronización post-commit no se presenta como éxito ni se repite la mutación", async () => {
  for (const operation of ["activate", "edit", "extend", "replace"] as const) {
    const rpc = fakeRpc();
    let mutations = 0;
    rpc.activateDraft = async () => { mutations++; return accepted("cycle_activate", CYCLE_ID, 2); };
    rpc.editActiveCycle = async () => { mutations++; return accepted("cycle_edit", CYCLE_ID, 2); };
    rpc.extendActiveCycle = async () => { mutations++; return accepted("cycle_extend", CYCLE_ID, 2); };
    rpc.replaceActiveCycleToDraft = async () => { mutations++; return preparedReplacement(); };
    const gateway = createTrainingCycleProductGateway({
      rpc, catalog: CATALOG, remoteDraft: replacementDraft(DRAFT_ID),
      sourceCycleId: SOURCE_CYCLE_ID, activeCycle: snapshot(1),
      onCycleChanged: async () => false,
      onCycleReplaced: async () => false,
    });
    const invoke = () => {
      if (operation === "activate") return gateway.activateCycle();
      if (operation === "edit") return gateway.saveActiveCycle({
        cycleId: CYCLE_ID, expectedRevision: "1", goal: "volume", days: saveInput().days,
      });
      if (operation === "extend") return gateway.extendCycle({
        cycleId: CYCLE_ID, expectedRevision: "1", currentEndDate: "2026-10-13", newEndDate: "2026-10-20",
      });
      return gateway.completeActiveCycle({
        expectedActiveCycleId: ACTIVE_CYCLE_ID, startDate: "2026-09-01", endDate: "2026-10-13",
      });
    };
    await assert.rejects(invoke, TrainingCycleCommittedMutationError);
    await assert.rejects(invoke, TrainingCycleCommittedMutationError);
    await assert.rejects(() => gateway.saveDraft(saveInput()), TrainingCycleCommittedMutationError);
    assert.equal(mutations, 1, operation);
  }
  for (const operation of ["activate", "active_edit", "extend"] as const) {
    assert.match(publicOperationError(operation, new TrainingCycleCommittedMutationError()), /se guardó.*Recarga/);
    assert.doesNotMatch(publicOperationError(operation, new TrainingCycleCommittedMutationError()), /no cambió|No pudimos activar/);
  }
});

test("autosave de Objetivo guarda días vacíos; el adapter recreado continúa la versión", async () => {
  const rpc = fakeRpc();
  const initial = { rpc, catalog: CATALOG, remoteDraft: null, sourceCycleId: null, activeCycle: null };
  const gateway = createTrainingCycleProductGateway(initial);
  const input = { ...saveInput("manual"), days: [{ day: "tuesday" as const, name: "", exercises: [] }] };
  assert.equal((await gateway.saveDraft(input)).status, "saved");
  const recreated = createTrainingCycleProductGateway({ ...initial, remoteDraftReference: { draftId: DRAFT_ID, version: 1 } });
  assert.equal((await recreated.saveDraft({ ...input, endDate: "2026-10-21" })).status, "saved");
  assert.deepEqual(rpc.calls, ["create", "save:1"]);
});

test("recrear adapter durante postcommit no libera cola ni bloqueo de sincronización", async () => {
  const rpc = fakeRpc();
  let finishSync!: (result: boolean) => void;
  let entered!: () => void;
  const enteredSync = new Promise<void>((resolve) => { entered = resolve; });
  const options = {
    rpc, catalog: CATALOG, remoteDraft: replacementDraft(DRAFT_ID), sourceCycleId: SOURCE_CYCLE_ID,
    activeCycle: null,
    onCycleChanged: () => { entered(); return new Promise<boolean>((resolve) => { finishSync = resolve; }); },
  };
  const first = createTrainingCycleProductGateway(options);
  const activation = assert.rejects(first.activateCycle(), TrainingCycleCommittedMutationError);
  await enteredSync;
  const recreated = createTrainingCycleProductGateway(options);
  const next = assert.rejects(recreated.discardDraft(), TrainingCycleCommittedMutationError);
  await new Promise(setImmediate);
  assert.deepEqual(rpc.calls, ["activate:1"]);
  finishSync(false);
  await Promise.all([activation, next]);
  assert.deepEqual(rpc.calls, ["activate:1"]);
  await assert.rejects(recreated.saveDraft(saveInput()), TrainingCycleCommittedMutationError);
});

test("duplica una vez, guarda la edición sobre versión 1 y activa la última versión", async () => {
  const rpc = fakeRpc();
  const gateway = createTrainingCycleProductGateway({ rpc, catalog: CATALOG, remoteDraft: null, sourceCycleId: SOURCE_CYCLE_ID, activeCycle: null });
  await gateway.saveDraft(saveInput());
  const activated = await gateway.activateCycle();
  assert.deepEqual(rpc.calls, ["duplicate", "save:1", "activate:2"]);
  assert.equal(activated.cycleId, CYCLE_ID);
});

test("el guard autoritativo conserva el id del activo legacy sin exponer más campos", async () => {
  const rpc = fakeRpc({
    activeGuard: { cycleId: ACTIVE_CYCLE_ID, hasCanonicalPlan: false },
  });
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: null,
  });

  assert.deepEqual(await gateway.getActiveCycleGuard(), { cycleId: ACTIVE_CYCLE_ID });
});

test("reemplazar el activo prepara el borrador nuevo antes de editarlo", async () => {
  const rpc = fakeRpc();
  const replaced: Array<{ cycleId: string; draftId: string }> = [];
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: snapshot(4),
    onCycleReplaced: (cycleId, draft) => { replaced.push({ cycleId, draftId: draft.draftId }); },
  });

  const preparedDraft = await gateway.completeActiveCycle({
    expectedActiveCycleId: ACTIVE_CYCLE_ID,
    startDate: "2026-09-01",
    endDate: "2026-10-13",
  });
  await gateway.saveDraft(saveInput("duplicate"));

  assert.deepEqual(replaced, [{ cycleId: ACTIVE_CYCLE_ID, draftId: NEW_DRAFT_ID }]);
  assert.equal(preparedDraft.draftId, NEW_DRAFT_ID);
  assert.equal(preparedDraft.routines.monday.exercises[0]?.name, "Press");
  assert.deepEqual(rpc.calls, [
    `replace:${ACTIVE_CYCLE_ID}`,
    "save:1",
  ]);
});

test("una respuesta de cierre para otro aggregate falla cerrado", async () => {
  const rpc = fakeRpc();
  const closed: string[] = [];
  rpc.replaceActiveCycleToDraft = async () => preparedReplacement(
    replacementDraft(DRAFT_ID, SOURCE_CYCLE_ID),
  );
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: snapshot(4),
    onCycleReplaced: (cycleId) => { closed.push(cycleId); },
  });

  await assert.rejects(
    gateway.completeActiveCycle({
      expectedActiveCycleId: ACTIVE_CYCLE_ID,
      startDate: "2026-09-01",
      endDate: "2026-10-13",
    }),
    (error) => error instanceof TrainingCycleCommittedMutationError,
  );
  assert.deepEqual(closed, []);
});

test("una respuesta de reemplazo inválida no adopta referencias ni dirige el siguiente save al draft atacante", async () => {
  const rpc = fakeRpc();
  const oldDraft = replacementDraft(DRAFT_ID, SOURCE_CYCLE_ID);
  rpc.replaceActiveCycleToDraft = async () => preparedReplacement(
    replacementDraft(NEW_DRAFT_ID, SOURCE_CYCLE_ID),
  );
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: oldDraft,
    sourceCycleId: SOURCE_CYCLE_ID,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
  });

  await assert.rejects(gateway.completeActiveCycle({
    expectedActiveCycleId: ACTIVE_CYCLE_ID,
    startDate: "2026-09-01",
    endDate: "2026-10-13",
  }), (error) => error instanceof TrainingCycleCommittedMutationError);
  await assert.rejects(() => gateway.saveDraft(saveInput("duplicate")), TrainingCycleCommittedMutationError);
  assert.deepEqual(rpc.calls, []);
});

test("un callback onCycleReplaced fallido se clasifica committed y conserva referencias del draft", async () => {
  const rpc = fakeRpc();
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
    onCycleReplaced: async () => { throw new Error("secondary-sync-failed"); },
  });

  await assert.rejects(gateway.completeActiveCycle({
    expectedActiveCycleId: ACTIVE_CYCLE_ID,
    startDate: "2026-09-01",
    endDate: "2026-10-13",
  }), (error) => error instanceof TrainingCycleCommittedMutationError);
  await assert.rejects(() => gateway.saveDraft(saveInput("duplicate")), TrainingCycleCommittedMutationError);
  assert.deepEqual(rpc.calls, [`replace:${ACTIVE_CYCLE_ID}`]);
});

test("un callback onDraftPersisted fallido también conserva el draft committed", async () => {
  const rpc = fakeRpc();
  let persistCallbacks = 0;
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
    onDraftPersisted: () => {
      persistCallbacks += 1;
      if (persistCallbacks === 1) throw new Error("draft-reference-refresh-failed");
    },
  });

  await assert.rejects(gateway.completeActiveCycle({
    expectedActiveCycleId: ACTIVE_CYCLE_ID,
    startDate: "2026-09-01",
    endDate: "2026-10-13",
  }), (error) => error instanceof TrainingCycleCommittedMutationError);
  await assert.rejects(() => gateway.saveDraft(saveInput("duplicate")), TrainingCycleCommittedMutationError);
  assert.deepEqual(rpc.calls, [`replace:${ACTIVE_CYCLE_ID}`]);
});

test("legacy sin catálogo adopta el descriptor custom creado en la respuesta atómica", async () => {
  const customId = "60000000-0000-4000-8000-000000000001";
  const legacyDraft = {
    ...replacementDraft(),
    plan: {
      days: [{
        ...replacementDraft().plan.days[0],
        exercises: [{
          ...replacementDraft().plan.days[0].exercises[0],
          catalogExerciseId: undefined,
          customExerciseId: customId,
        }],
      }],
    },
  };
  const rpc = fakeRpc();
  rpc.replaceActiveCycleToDraft = async () => preparedReplacement(legacyDraft, [{
    source: { kind: "custom", id: customId },
    name: "Remo artesanal con barra",
    muscleGroup: "dorsal",
    videoUrl: null,
  }]);
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: [],
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: null,
  });

  const draft = await gateway.completeActiveCycle({
    expectedActiveCycleId: ACTIVE_CYCLE_ID,
    startDate: "2026-09-01",
    endDate: "2026-10-13",
  });

  assert.equal(draft.draftId, NEW_DRAFT_ID);
  assert.equal(draft.routines.monday.exercises[0]?.name, "Remo artesanal con barra");
  assert.deepEqual(draft.routines.monday.exercises[0]?.source, { kind: "custom", id: customId });
});

test("descriptor ausente después del commit informa sincronización pendiente sin afirmar activo intacto", async () => {
  const rpc = fakeRpc({ activeGuard: { cycleId: ACTIVE_CYCLE_ID, hasCanonicalPlan: false } });
  rpc.replaceActiveCycleToDraft = async () => preparedReplacement(replacementDraft(), []);
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: [],
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: null,
  });
  let state = trainingCycleBuilderReducer(createTrainingCycleBuilderState({
    ...createTrainingCycleBuilderTestViewModel(),
    initialScreen: "active",
    activeCycleId: ACTIVE_CYCLE_ID,
    activeCycleRevision: "4",
  }), { type: "show_active" });
  const dispatch = (action: TrainingCycleBuilderAction) => {
    state = trainingCycleBuilderReducer(state, action);
  };
  const owner = new TrainingCycleNewCycleOperationOwner();

  await owner.request(gateway, dispatch, state, "duplicate", "duplicate");
  await owner.confirm(gateway, dispatch, state);

  assert.equal(state.activeCycleId, null);
  assert.match(state.activeCycleCloseErrorMessage ?? "", /terminó.*sincronizar/i);
  assert.doesNotMatch(state.activeCycleCloseErrorMessage ?? "", /sigue activo/i);
  assert.equal(state.draft.draftId, createTrainingCycleBuilderTestViewModel().draft.draftId);
});

test("notify post-commit fallido deja activo nulo y sincronización pendiente", async () => {
  const rpc = fakeRpc({ activeGuard: { cycleId: ACTIVE_CYCLE_ID, hasCanonicalPlan: true } });
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
    onCycleReplaced: async () => { throw new Error("notification-refresh-failed"); },
  });
  let state = trainingCycleBuilderReducer(createTrainingCycleBuilderState({
    ...createTrainingCycleBuilderTestViewModel(),
    initialScreen: "active",
    activeCycleId: ACTIVE_CYCLE_ID,
    activeCycleRevision: "4",
  }), { type: "show_active" });
  const dispatch = (action: TrainingCycleBuilderAction) => {
    state = trainingCycleBuilderReducer(state, action);
  };
  const owner = new TrainingCycleNewCycleOperationOwner();

  await owner.request(gateway, dispatch, state, "duplicate", "duplicate");
  await owner.confirm(gateway, dispatch, state);

  assert.equal(state.activeCycleId, null);
  assert.match(state.activeCycleCloseErrorMessage ?? "", /terminó.*sincronizar/i);
  assert.doesNotMatch(state.activeCycleCloseErrorMessage ?? "", /sigue activo/i);
});

test("rechazo pre-commit mantiene el ciclo activo y usa el mensaje de cierre no realizado", async () => {
  const rpc = fakeRpc({ activeGuard: { cycleId: ACTIVE_CYCLE_ID, hasCanonicalPlan: true } });
  rpc.replaceActiveCycleToDraft = async () => {
    throw new TrainingCycleTransportError("forbidden", "rejected-before-commit");
  };
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: null,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
  });
  let state = trainingCycleBuilderReducer(createTrainingCycleBuilderState({
    ...createTrainingCycleBuilderTestViewModel(),
    initialScreen: "active",
    activeCycleId: ACTIVE_CYCLE_ID,
    activeCycleRevision: "4",
  }), { type: "show_active" });
  const dispatch = (action: TrainingCycleBuilderAction) => {
    state = trainingCycleBuilderReducer(state, action);
  };
  const owner = new TrainingCycleNewCycleOperationOwner();

  await owner.request(gateway, dispatch, state, "duplicate", "duplicate");
  await owner.confirm(gateway, dispatch, state);

  assert.equal(state.activeCycleId, ACTIVE_CYCLE_ID);
  assert.match(state.activeCycleCloseErrorMessage ?? "", /sigue activo/i);
  assert.doesNotMatch(state.activeCycleCloseErrorMessage ?? "", /terminó.*sincronizar/i);
});

test("flujo completo: No conserva el activo y produce cero writes", async () => {
  const rpc = fakeRpc({
    activeGuard: { cycleId: ACTIVE_CYCLE_ID, hasCanonicalPlan: true },
  });
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: SOURCE_CYCLE_ID,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
  });
  let state = trainingCycleBuilderReducer(
    createTrainingCycleBuilderState({
      ...createTrainingCycleBuilderTestViewModel(),
      initialScreen: "active",
      activeCycleId: ACTIVE_CYCLE_ID,
      activeCycleRevision: "4",
    }),
    { type: "show_active" },
  );
  const dispatch = (action: TrainingCycleBuilderAction) => {
    state = trainingCycleBuilderReducer(state, action);
  };
  const owner = new TrainingCycleNewCycleOperationOwner();

  await owner.request(gateway, dispatch, state, "duplicate", "duplicate");
  assert.deepEqual(state.pendingNewCycleIntent, { origin: "duplicate", screen: "duplicate" });
  dispatch({ type: "cancel_active_cycle_close" });

  assert.equal(state.screen, "active");
  assert.equal(state.workflow, "active");
  assert.equal(state.activeCycleId, ACTIVE_CYCLE_ID);
  assert.equal(state.activeCycleRevision, "4");
  assert.equal(state.pendingNewCycleIntent, null);
  assert.deepEqual(rpc.calls, []);
});

test("flujo completo: Sí cierra una vez, conserva montaje e intención y duplica el recién cerrado", async () => {
  const rpc = fakeRpc({
    activeGuard: { cycleId: ACTIVE_CYCLE_ID, hasCanonicalPlan: true },
  });
  let productData: TrainingCycleProductData = {
    catalog: CATALOG,
    draft: null,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
    sourceCycle: null,
    lastCycle: { ...snapshot(1), cycleId: SOURCE_CYCLE_ID },
    draftReference: null,
  };
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: null,
    sourceCycleId: SOURCE_CYCLE_ID,
    activeCycle: productData.activeCycle,
    onCycleReplaced: (_cycleId, draft) => {
      productData = closeActiveTrainingCycleProductData(productData, draft);
    },
  });
  let state = trainingCycleBuilderReducer(
    createTrainingCycleBuilderState({
      ...createTrainingCycleBuilderTestViewModel(),
      initialScreen: "active",
      activeCycleId: ACTIVE_CYCLE_ID,
      activeCycleRevision: "4",
    }),
    { type: "show_active" },
  );
  const dispatch = (action: TrainingCycleBuilderAction) => {
    state = trainingCycleBuilderReducer(state, action);
  };
  const owner = new TrainingCycleNewCycleOperationOwner();
  const mountedKey = trainingCycleBuilderInstanceKey();

  await owner.request(gateway, dispatch, state, "duplicate", "duplicate");
  const firstClose = owner.confirm(gateway, dispatch, state);
  const replayedClose = owner.confirm(gateway, dispatch, state);
  await Promise.all([firstClose, replayedClose]);

  assert.equal(trainingCycleBuilderInstanceKey(), mountedKey);
  assert.equal(state.workflow, "draft");
  assert.equal(state.origin, "duplicate");
  assert.equal(state.screen, "duplicate");
  assert.equal(state.draft.draftId, NEW_DRAFT_ID);
  assert.equal(state.sourceDraft.draftId, NEW_DRAFT_ID);
  assert.equal(productData.activeCycle, null);
  assert.equal(productData.lastCycle?.cycleId, ACTIVE_CYCLE_ID);
  assert.equal(productData.draft?.draftId, NEW_DRAFT_ID);
  assert.equal(productData.draft?.sourceCycleId, ACTIVE_CYCLE_ID);

  await gateway.saveDraft(saveInput("duplicate"));
  assert.deepEqual(rpc.calls, [
    `replace:${ACTIVE_CYCLE_ID}`,
    "save:1",
  ]);
});

test("activo más borrador remoto reemplaza el borrador incompatible sin sobrescribirlo", async () => {
  const rpc = fakeRpc({ activeGuard: { cycleId: ACTIVE_CYCLE_ID, hasCanonicalPlan: true } });
  const oldDraft = replacementDraft(DRAFT_ID, SOURCE_CYCLE_ID);
  let persisted: { draftId: string; version: number } | null = null;
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
    remoteDraft: oldDraft,
    sourceCycleId: SOURCE_CYCLE_ID,
    activeCycle: { ...snapshot(4), cycleId: ACTIVE_CYCLE_ID },
    onDraftPersisted: (draftId, version) => { persisted = { draftId, version }; },
  });

  await gateway.completeActiveCycle({
    expectedActiveCycleId: ACTIVE_CYCLE_ID,
    startDate: "2026-09-01",
    endDate: "2026-10-13",
  });
  await gateway.saveDraft(saveInput("duplicate"));

  assert.deepEqual(persisted, { draftId: NEW_DRAFT_ID, version: 2 });
  assert.deepEqual(rpc.calls, [`replace:${ACTIVE_CYCLE_ID}`, "save:1"]);
  assert.equal(rpc.calls.includes("save:4"), false);
});

test("flujo completo: editar el ciclo activo no consulta guard ni cierra", () => {
  let state = trainingCycleBuilderReducer(
    createTrainingCycleBuilderState({
      ...createTrainingCycleBuilderTestViewModel(),
      initialScreen: "active",
      activeCycleId: ACTIVE_CYCLE_ID,
      activeCycleRevision: "4",
    }),
    { type: "show_active" },
  );
  state = trainingCycleBuilderReducer(state, { type: "begin_active_edit" });

  assert.equal(state.workflow, "active_edit");
  assert.equal(state.screen, "setup");
  assert.equal(state.activeCycleId, ACTIVE_CYCLE_ID);
  assert.equal(state.pendingNewCycleIntent, null);
  assert.equal(state.activeCycleCloseId, null);
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
    catalog: CATALOG,
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
  const gateway = createTrainingCycleProductGateway({ rpc, catalog: CATALOG, remoteDraft: null, sourceCycleId: null, activeCycle: null });
  await gateway.saveDraft(saveInput("manual"));
  assert.deepEqual(rpc.calls, ["create"]);
});

test("traduce conflicto OCC de edición activa a resultado visible", async () => {
  const rpc = fakeRpc();
  rpc.editActiveCycle = async () => { throw new TrainingCycleTransportError("conflict", "conflict"); };
  const gateway = createTrainingCycleProductGateway({ rpc, catalog: CATALOG, remoteDraft: null, sourceCycleId: null, activeCycle: snapshot(4) });
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
    catalog: CATALOG,
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
  const gateway = createTrainingCycleProductGateway({ rpc: fakeRpc(), catalog: CATALOG, remoteDraft: null, sourceCycleId: null, activeCycle: null });
  await assert.rejects(gateway.saveDraft(saveInput("resume")), /borrador guardado/i);
});

test("discard seguido de manual crea un draft remoto nuevo en el primer autosave", async () => {
  const rpc = fakeRpc({ createdDraftId: NEW_DRAFT_ID });
  const references: Array<{ readonly draftId: string; readonly version: number } | null> = [];
  const gateway = createTrainingCycleProductGateway({
    rpc,
    catalog: CATALOG,
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
