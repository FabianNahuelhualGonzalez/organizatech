import assert from "node:assert/strict";
import test from "node:test";

import { renameTrainingDay, updateSetTargets } from "./operations";
import {
  appendTrainingCycleSnapshot,
  createTrainingCycleSnapshot,
  createVersionedTrainingCycle,
  duplicateTrainingCycleSnapshot,
  getTrainingCycleSnapshot,
  transitionDraftStatus,
} from "./snapshots";
import { createFixtureDraft } from "./test-fixtures";

function firstSnapshot() {
  return createTrainingCycleSnapshot({
    snapshotId: "snapshot-1",
    cycleId: "cycle-1",
    version: 1,
    capturedAt: "2026-09-01T12:00:00Z",
    reason: "activation",
    previousSnapshotId: null,
    content: createFixtureDraft(),
  });
}

test("snapshot clona y congela profundamente contenido histórico", () => {
  const draft = createFixtureDraft();
  const snapshot = createTrainingCycleSnapshot({
    snapshotId: "snapshot-1",
    cycleId: "cycle-1",
    version: 1,
    capturedAt: "2026-09-01T12:00:00Z",
    reason: "activation",
    previousSnapshotId: null,
    content: draft,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.content), true);
  assert.equal(Object.isFrozen(snapshot.content.selectedDays), true);
  assert.equal(Object.isFrozen(snapshot.content.routines.monday), true);
  assert.equal(Object.isFrozen(snapshot.content.routines.monday?.exercises), true);
  assert.notEqual(snapshot.content.routines.monday, draft.routines.monday);

  const mutableDraftDay = draft.routines.monday as { name: string };
  mutableDraftDay.name = "Mutado afuera";
  assert.equal(snapshot.content.routines.monday?.name, "Empuje");
  assert.throws(() => {
    const frozenDay = snapshot.content.routines.monday as { name: string };
    frozenDay.name = "No permitido";
  });
});

test("snapshot exige metadata versionada y timestamp con zona", () => {
  const content = createFixtureDraft();
  assert.throws(() => createTrainingCycleSnapshot({
    snapshotId: "",
    cycleId: "cycle",
    version: 1,
    capturedAt: "2026-09-01T12:00:00Z",
    reason: "activation",
    previousSnapshotId: null,
    content,
  }));
  assert.throws(() => createTrainingCycleSnapshot({
    snapshotId: "s",
    cycleId: "cycle",
    version: 1,
    capturedAt: "2026-02-30T12:00:00Z",
    reason: "activation",
    previousSnapshotId: null,
    content,
  }));
  assert.throws(() => createTrainingCycleSnapshot({
    snapshotId: "s",
    cycleId: "cycle",
    version: 1,
    capturedAt: "2026-09-01T24:00:00Z",
    reason: "activation",
    previousSnapshotId: null,
    content,
  }));
  assert.throws(() => createTrainingCycleSnapshot({
    snapshotId: "s",
    cycleId: "cycle",
    version: 1,
    capturedAt: "2026-09-01T12:00:00",
    reason: "activation",
    previousSnapshotId: null,
    content,
  }));
  assert.throws(() => createTrainingCycleSnapshot({
    snapshotId: "s",
    cycleId: "cycle",
    version: 2,
    capturedAt: "2026-09-01T12:00:00Z",
    reason: "edit",
    previousSnapshotId: null,
    content,
  }));
});

test("historial es append-only con control optimista de versión y parent", () => {
  const first = firstSnapshot();
  const cycle = createVersionedTrainingCycle(first);
  const editedContent = { ...first.content, goal: "strength" as const };
  const second = createTrainingCycleSnapshot({
    snapshotId: "snapshot-2",
    cycleId: "cycle-1",
    version: 2,
    capturedAt: "2026-09-10T12:00:00Z",
    reason: "edit",
    previousSnapshotId: "snapshot-1",
    content: editedContent,
  });
  const appended = appendTrainingCycleSnapshot(cycle, second);
  assert.equal(appended.ok, true);
  if (!appended.ok) return;
  assert.equal(appended.cycle.snapshots.length, 2);
  assert.equal(appended.cycle.currentSnapshotId, "snapshot-2");
  assert.equal(cycle.snapshots.length, 1, "el agregado no modifica el agregado anterior");
  assert.equal(getTrainingCycleSnapshot(appended.cycle, "snapshot-1"), first);
  assert.equal(getTrainingCycleSnapshot(appended.cycle, "missing"), null);

  const duplicate = appendTrainingCycleSnapshot(appended.cycle, second);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.reason, "duplicate_snapshot_id");
});

test("append rechaza ciclo, versión y parent divergentes sin alterar historial", () => {
  const first = firstSnapshot();
  const cycle = createVersionedTrainingCycle(first);
  const wrongCycle = createTrainingCycleSnapshot({
    snapshotId: "other-2",
    cycleId: "other-cycle",
    version: 2,
    capturedAt: "2026-09-02T12:00:00Z",
    reason: "edit",
    previousSnapshotId: "snapshot-1",
    content: first.content,
  });
  assert.deepEqual(appendTrainingCycleSnapshot(cycle, wrongCycle), {
    ok: false,
    reason: "cycle_mismatch",
    cycle,
  });

  const wrongVersion = createTrainingCycleSnapshot({
    snapshotId: "snapshot-3",
    cycleId: "cycle-1",
    version: 3,
    capturedAt: "2026-09-03T12:00:00Z",
    reason: "edit",
    previousSnapshotId: "snapshot-1",
    content: first.content,
  });
  const versionResult = appendTrainingCycleSnapshot(cycle, wrongVersion);
  assert.equal(versionResult.ok, false);
  if (!versionResult.ok) assert.equal(versionResult.reason, "version_conflict");

  const wrongParent = createTrainingCycleSnapshot({
    snapshotId: "snapshot-2",
    cycleId: "cycle-1",
    version: 2,
    capturedAt: "2026-09-02T12:00:00Z",
    reason: "edit",
    previousSnapshotId: "not-current",
    content: first.content,
  });
  const parentResult = appendTrainingCycleSnapshot(cycle, wrongParent);
  assert.equal(parentResult.ok, false);
  if (!parentResult.ok) assert.equal(parentResult.reason, "previous_snapshot_mismatch");
  assert.equal(cycle.snapshots.length, 1);
});

test("duplicación crea borrador editable con IDs nuevos y linaje hacia snapshot", () => {
  const snapshot = firstSnapshot();
  const duplicate = duplicateTrainingCycleSnapshot(snapshot, {
    draftId: "draft-copy",
    startDate: "2026-10-20",
    endDate: "2026-12-01",
    idNamespace: "copy",
  });
  assert.equal(duplicate.origin, "duplicated");
  assert.equal(duplicate.sourceSnapshotId, "snapshot-1");
  assert.equal(duplicate.status, "draft");
  assert.equal(duplicate.startDate, "2026-10-20");
  const exercise = duplicate.routines.monday?.exercises[0];
  assert.equal(exercise?.id, "copy:day:monday:exercise:1");
  assert.equal(exercise?.sourceExerciseId, "exercise-1");
  assert.equal(exercise?.sets[0]?.sourceSetId, "set-1");
  assert.notEqual(exercise, snapshot.content.routines.monday?.exercises[0]);

  const renamed = renameTrainingDay(duplicate, "monday", "Empuje editado");
  assert.equal(renamed.changed, true);
  const edited = updateSetTargets(
    renamed.draft,
    "monday",
    exercise?.id ?? "",
    exercise?.sets[0]?.id ?? "",
    { targetReps: 8, targetKg: 90 },
  );
  assert.equal(edited.changed, true);
  assert.equal(edited.draft.routines.monday?.name, "Empuje editado");
  assert.equal(edited.draft.routines.monday?.exercises[0]?.sets[0]?.targetKg, 90);
  assert.equal(snapshot.content.routines.monday?.name, "Empuje");
  assert.equal(snapshot.content.routines.monday?.exercises[0]?.sets[0]?.targetKg, 80);
});

test("transición de borrador es unilateral e impide reactivar descartado", () => {
  const draft = createFixtureDraft();
  const activated = transitionDraftStatus(draft, "activated");
  assert.equal(activated.status, "activated");
  assert.equal(activated.revision, draft.revision + 1);
  assert.equal(transitionDraftStatus(activated, "discarded"), activated);

  const discarded = transitionDraftStatus(draft, "discarded");
  assert.equal(discarded.status, "discarded");
  assert.equal(transitionDraftStatus(discarded, "activated"), discarded);
});
