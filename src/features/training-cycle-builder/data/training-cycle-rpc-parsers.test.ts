import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAcceptedOperation,
  parseCatalogPage,
  parseCycleSnapshot,
  parseDraftSnapshot,
  parseNotificationPage,
  parseRpcExecution,
  parseTrainingCycleRpcPlan,
} from "./training-cycle-rpc-parsers";
import { TrainingCycleTransportError } from "./training-cycle-rpc-types";

const ID = "10000000-0000-4000-8000-000000000001";
const ID2 = "20000000-0000-4000-8000-000000000001";
const ID3 = "30000000-0000-4000-8000-000000000001";
const ID4 = "40000000-0000-4000-8000-000000000001";
const ID5 = "50000000-0000-4000-8000-000000000001";

const plan = {
  days: [{
    day: "monday",
    name: "Empuje",
    order: 0,
    exercises: [{
      catalogExerciseId: ID,
      order: 0,
      technique: "linear",
      videoUrl: null,
      sets: [{ order: 0, targetReps: 10, targetKg: 100, toFailure: false, drops: [] }],
    }],
  }],
};

test("accepted_operation exige shape exacto, UUID y versión acotada", () => {
  assert.deepEqual(parseAcceptedOperation({
    responseKind: "accepted_operation",
    requestId: ID,
    operationKind: "draft_save",
    aggregateId: ID2,
    resultVersion: 2,
  }), {
    responseKind: "accepted_operation",
    requestId: ID,
    operationKind: "draft_save",
    aggregateId: ID2,
    resultVersion: 2,
  });
  assert.throws(() => parseAcceptedOperation({
    responseKind: "accepted_operation",
    requestId: ID,
    operationKind: "draft_save",
    aggregateId: ID2,
    resultVersion: 2,
    userId: ID3,
  }), TrainingCycleTransportError);
});

test("plan y ejecución rechazan campos extra, nulls, escala y órdenes inválidas", () => {
  assert.deepEqual(parseTrainingCycleRpcPlan(plan), plan);
  assert.throws(() => parseTrainingCycleRpcPlan({
    days: [{ ...plan.days[0], ownerId: ID }],
  }), TrainingCycleTransportError);
  assert.throws(() => parseTrainingCycleRpcPlan({
    days: [{ ...plan.days[0], exercises: [{ ...plan.days[0].exercises[0], sets: [{
      order: 0, targetReps: 10, targetKg: 10.123, toFailure: false, drops: [],
    }] }] }],
  }), TrainingCycleTransportError);

  const execution = parseRpcExecution({
    dayId: ID2,
    exercises: [{
      planExerciseId: ID3,
      order: 0,
      sets: [{
        planSetId: ID4,
        order: 0,
        completed: false,
        reps: null,
        kg: null,
        reachedFailure: false,
        drops: [{ planDropId: ID5, order: 0, completed: false, reps: null, kg: null }],
      }],
    }],
  });
  assert.equal(execution.exercises[0]!.sets[0]!.reps, null);
  assert.throws(() => parseRpcExecution({
    dayId: ID2,
    exercises: [{
      planExerciseId: ID3,
      order: 0,
      sets: [{
        planSetId: ID4,
        order: 0,
        completed: false,
        reps: 1,
        kg: null,
        reachedFailure: false,
        drops: [],
      }],
    }],
  }), TrainingCycleTransportError);
});

test("catálogo conserva sourceKind y valida cursor completo", () => {
  const page = parseCatalogPage({
    items: [{
      sourceKind: "catalog",
      sourceId: ID,
      name: "Press plano",
      muscleGroup: "pectoral",
      videoUrl: null,
    }],
    nextCursor: {
      afterSourceKind: "catalog",
      afterSortOrder: 1,
      afterName: "press plano",
      afterSourceId: ID,
    },
  });
  assert.deepEqual(page.items[0]!.source, { kind: "catalog", id: ID });
  assert.equal(page.nextCursor?.afterName, "press plano");
  assert.throws(() => parseCatalogPage({
    items: [],
    nextCursor: { afterSourceKind: "catalog", afterSourceId: ID },
  }), TrainingCycleTransportError);
});

test("draft y ciclo se parsean sin aceptar ownership ni drift de snapshots", () => {
  const draft = parseDraftSnapshot({
    draftId: ID,
    origin: "manual",
    sourceCycleId: null,
    state: "draft",
    version: 1,
    goal: "strength",
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    plan,
    activatedCycleId: null,
    createdAt: "2026-08-30T01:00:00Z",
    updatedAt: "2026-08-30T01:00:00Z",
  });
  assert.equal(draft.version, 1);

  const snapshotPlan = {
    days: [{
      snapshotId: ID2,
      day: "monday",
      name: "Empuje",
      order: 0,
      legacyCycleDayId: null,
      exercises: [{
        snapshotId: ID3,
        catalogExerciseId: ID,
        customExerciseId: null,
        exerciseLineageId: ID4,
        name: "Press plano",
        muscleGroup: "pectoral",
        order: 0,
        technique: "linear",
        videoUrl: null,
        legacyCycleExerciseId: null,
        sets: [{
          snapshotId: ID5,
          order: 0,
          targetReps: 10,
          targetKg: 100,
          toFailure: false,
          drops: [],
        }],
      }],
    }],
  };
  const cycle = parseCycleSnapshot({
    cycleId: ID,
    portalScope: "usuario",
    cycleNumber: 2,
    goal: "strength",
    startDate: "2026-09-01",
    endDate: "2026-10-01",
    status: "active",
    daysUntilEnd: 30,
    version: 1,
    snapshotId: ID2,
    extensionCount: 0,
    sourceDraftId: ID3,
    sourceCycleId: null,
    closedAt: null,
    closedReason: null,
    createdAt: "2026-08-30T01:00:00Z",
    updatedAt: "2026-08-30T01:00:00Z",
    plan: snapshotPlan,
  });
  assert.equal(cycle.plan.days[0]!.exercises[0]!.source.kind, "catalog");
});

test("notificaciones validan evento, texto, fechas y cursor keyset", () => {
  const result = parseNotificationPage({
    items: [{
      notificationId: ID,
      cycleId: ID2,
      eventKind: "expires_t3",
      scheduledOn: "2026-09-28",
      title: "Quedan 3 días",
      body: "Puedes extender tu ciclo.",
      materializedAt: "2026-09-28T12:00:00Z",
      readAt: null,
    }],
    nextCursor: { beforeMaterializedAt: "2026-09-28T12:00:00Z", beforeId: ID },
  });
  assert.equal(result.items[0]!.eventKind, "expires_t3");
  assert.throws(() => parseNotificationPage({
    items: [{
      notificationId: ID,
      cycleId: ID2,
      eventKind: "unknown",
      scheduledOn: "2026-09-28",
      title: "Aviso",
      body: "Texto",
      materializedAt: "2026-09-28T12:00:00Z",
      readAt: null,
    }],
    nextCursor: null,
  }), TrainingCycleTransportError);
});
