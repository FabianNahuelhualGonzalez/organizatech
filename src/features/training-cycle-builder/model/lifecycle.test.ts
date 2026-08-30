import assert from "node:assert/strict";
import test from "node:test";

import {
  beginCycleActivation,
  completeCycleActivation,
  createActivationGate,
  deriveCycleLifecycle,
  evaluateCycleActivation,
  extensionShortcutDate,
  failCycleActivation,
  validateActiveCycleEdit,
  validateCycleExtension,
} from "./lifecycle";
import { createFixtureDraft } from "./test-fixtures";

test("ciclo activo emite avisos exactamente a 3, 2, 1 y 0 días", () => {
  const dates = [
    ["2026-10-10", 3],
    ["2026-10-11", 2],
    ["2026-10-12", 1],
    ["2026-10-13", 0],
  ] as const;
  for (const [today, notice] of dates) {
    const state = deriveCycleLifecycle({
      startDate: "2026-09-01",
      endDate: "2026-10-13",
      today,
      workoutInProgress: false,
    });
    assert.equal(state.valid, true);
    if (!state.valid) continue;
    assert.equal(state.status, "expiring");
    assert.equal(state.phase, "expiring");
    assert.equal(state.expiryNoticeDay, notice);
    assert.equal(state.endDateIsUsableToday, true);
    assert.equal(state.closureRequired, false);
  }
});

test("día de término sigue usable y el cierre vence al día siguiente", () => {
  const lastDay = deriveCycleLifecycle({
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    today: "2026-10-13",
    workoutInProgress: false,
  });
  assert.equal(lastDay.valid && lastDay.endDateIsUsableToday, true);
  assert.equal(lastDay.valid && lastDay.closureRequired, false);

  const nextDay = deriveCycleLifecycle({
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    today: "2026-10-14",
    workoutInProgress: false,
  });
  assert.deepEqual(nextDay, {
    valid: true,
    status: "closed",
    phase: "closure_due",
    daysUntilEnd: -1,
    expiryNoticeDay: null,
    endDateIsUsableToday: false,
    closureRequired: true,
    closureDeferredByWorkout: false,
  });
});

test("entrenamiento en curso posterga cierre y un closedAt válido materializa cerrado", () => {
  const deferred = deriveCycleLifecycle({
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    today: "2026-10-14",
    workoutInProgress: true,
  });
  assert.equal(deferred.valid && deferred.phase, "closure_deferred");
  assert.equal(deferred.valid && deferred.closureDeferredByWorkout, true);
  assert.equal(deferred.valid && deferred.closureRequired, false);

  const closed = deriveCycleLifecycle({
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    today: "2026-10-14",
    workoutInProgress: false,
    closedAtDate: "2026-10-14",
  });
  assert.equal(closed.valid && closed.phase, "closed");
  assert.equal(closed.valid && closed.status, "closed");
});

test("estado upcoming y activo no inventan avisos fuera de ventana", () => {
  const upcoming = deriveCycleLifecycle({
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    today: "2026-08-20",
    workoutInProgress: false,
  });
  assert.equal(upcoming.valid && upcoming.phase, "upcoming");
  assert.equal(upcoming.valid && upcoming.expiryNoticeDay, null);
  assert.equal(upcoming.valid && upcoming.endDateIsUsableToday, false);

  const active = deriveCycleLifecycle({
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    today: "2026-09-10",
    workoutInProgress: false,
  });
  assert.equal(active.valid && active.phase, "active");
  assert.equal(active.valid && active.status, "active");
});

test("lifecycle rechaza rangos y cierre materializado antes de corresponder", () => {
  assert.deepEqual(deriveCycleLifecycle({
    startDate: "x",
    endDate: "2026-10-13",
    today: "2026-10-01",
    workoutInProgress: false,
  }), { valid: false, reason: "invalid_date" });
  assert.deepEqual(deriveCycleLifecycle({
    startDate: "2026-10-13",
    endDate: "2026-10-13",
    today: "2026-10-13",
    workoutInProgress: false,
  }), { valid: false, reason: "invalid_range" });
  assert.deepEqual(deriveCycleLifecycle({
    startDate: "2026-09-01",
    endDate: "2026-10-13",
    today: "2026-10-13",
    workoutInProgress: false,
    closedAtDate: "2026-10-13",
  }), { valid: false, reason: "invalid_closed_at" });
});

test("extensión sólo mueve término hacia adelante respecto de hoy y término actual", () => {
  const valid = validateCycleExtension({
    startDate: "2026-09-01",
    currentEndDate: "2026-10-13",
    proposedEndDate: "2026-10-27",
    today: "2026-10-11",
  });
  assert.deepEqual(valid, { valid: true, addedDays: 14, newElapsedDays: 56 });
  assert.equal(extensionShortcutDate("2026-10-13", 1), "2026-10-20");
  assert.equal(extensionShortcutDate("2026-10-13", 2), "2026-10-27");
  assert.equal(extensionShortcutDate("2026-10-13", 4), "2026-11-10");

  assert.deepEqual(validateCycleExtension({
    startDate: "2026-09-01",
    currentEndDate: "2026-10-13",
    proposedEndDate: "2026-10-11",
    today: "2026-10-11",
  }), { valid: false, reason: "not_after_today" });
  assert.deepEqual(validateCycleExtension({
    startDate: "2026-09-01",
    currentEndDate: "2026-10-13",
    proposedEndDate: "2026-10-13",
    today: "2026-10-11",
  }), { valid: false, reason: "not_after_current_end" });
});

test("política hace explícito tope de extensión y límite total de seguridad", () => {
  assert.deepEqual(validateCycleExtension({
    startDate: "2026-09-01",
    currentEndDate: "2026-10-13",
    proposedEndDate: "2026-10-20",
    today: "2026-10-11",
    policy: { maxAddedDays: 0, maxTotalSpanDays: 730 },
  }), { valid: false, reason: "invalid_policy" });
  assert.deepEqual(validateCycleExtension({
    startDate: "2026-09-01",
    currentEndDate: "2026-10-13",
    proposedEndDate: "2026-10-28",
    today: "2026-10-11",
    policy: { maxAddedDays: 14, maxTotalSpanDays: 730 },
  }), { valid: false, reason: "added_days_exceed_policy" });
  assert.deepEqual(validateCycleExtension({
    startDate: "2026-01-01",
    currentEndDate: "2026-06-01",
    proposedEndDate: "2027-01-02",
    today: "2026-05-01",
    policy: { maxAddedDays: null, maxTotalSpanDays: 365 },
  }), { valid: false, reason: "total_span_exceeds_limit" });
});

test("edición activa bloquea inicio, impide acortar término y permite resto del plan", () => {
  const current = createFixtureDraft();
  assert.deepEqual(validateActiveCycleEdit({
    current,
    proposed: { ...current, startDate: "2026-09-02" },
    today: "2026-09-10",
  }), { allowed: false, reason: "start_date_locked" });
  assert.deepEqual(validateActiveCycleEdit({
    current,
    proposed: { ...current, endDate: "2026-10-12" },
    today: "2026-09-10",
  }), { allowed: false, reason: "end_date_cannot_move_back" });
  assert.deepEqual(validateActiveCycleEdit({
    current,
    proposed: { ...current, goal: "strength" },
    today: "2026-09-10",
  }), { allowed: true, extension: null });
  const extension = validateActiveCycleEdit({
    current,
    proposed: { ...current, endDate: "2026-10-20" },
    today: "2026-09-10",
  });
  assert.equal(extension.allowed, true);
});

test("solapamiento es una política obligatoria y conservadora cuando se elige reject", () => {
  const draft = createFixtureDraft();
  assert.deepEqual(evaluateCycleActivation({
    draft,
    existingCycleStatuses: ["closed", "active"],
    overlapPolicy: "reject",
  }), { allowed: false, reason: "active_cycle_exists" });
  assert.deepEqual(evaluateCycleActivation({
    draft,
    existingCycleStatuses: ["active"],
    overlapPolicy: "allow",
  }), { allowed: true, reason: null });
  assert.deepEqual(evaluateCycleActivation({
    draft: { ...draft, selectedDays: [] },
    existingCycleStatuses: [],
    overlapPolicy: "reject",
  }), { allowed: false, reason: "draft_invalid" });
});

test("gate de activación bloquea doble envío y reconoce ciclo ya creado", () => {
  const idle = createActivationGate();
  const begun = beginCycleActivation(idle, "request-1");
  assert.equal(begun.accepted, true);
  if (!begun.accepted) return;
  assert.deepEqual(beginCycleActivation(begun.state, "request-1"), {
    accepted: false,
    state: begun.state,
    reason: "already_in_progress",
    existingCycleId: null,
  });
  assert.equal(beginCycleActivation(begun.state, "request-2").accepted, false);
  assert.equal(failCycleActivation(begun.state, "otra"), begun.state);

  const activated = completeCycleActivation(begun.state, "request-1", "cycle-1");
  assert.deepEqual(activated, { phase: "activated", requestKey: "request-1", cycleId: "cycle-1" });
  assert.deepEqual(beginCycleActivation(activated, "request-1"), {
    accepted: false,
    state: activated,
    reason: "already_activated",
    existingCycleId: "cycle-1",
  });

  const failed = failCycleActivation(begun.state, "request-1");
  assert.deepEqual(failed, { phase: "idle" });
});
