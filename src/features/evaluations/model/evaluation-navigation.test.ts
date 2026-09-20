import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessStudentEvaluations,
  createEvaluationOpenRequest,
  resolveStudentEvaluationNotificationTarget,
  type EvaluationOpenRequest,
} from "@/features/evaluations/model/evaluation-navigation";

test("conserva el assignment tipado y secuencia aperturas de la misma identidad", () => {
  const first = createEvaluationOpenRequest(null, "student-1", "assignment-1");
  const second = createEvaluationOpenRequest(first, "student-1", "assignment-2");

  assert.deepEqual(first, {
    ownerUserId: "student-1",
    assignmentId: "assignment-1",
    sequence: 1,
  });
  assert.deepEqual(second, {
    ownerUserId: "student-1",
    assignmentId: "assignment-2",
    sequence: 2,
  });
});

test("reinicia la secuencia al cambiar de identidad y admite el fallback sin assignment", () => {
  const current: EvaluationOpenRequest = {
    ownerUserId: "student-1",
    assignmentId: "assignment-1",
    sequence: 4,
  };

  assert.deepEqual(createEvaluationOpenRequest(current, "coach-1", null), {
    ownerUserId: "coach-1",
    assignmentId: null,
    sequence: 1,
  });
});

test("sólo el vínculo activo aceptado de la identidad actual habilita Evaluaciones", () => {
  assert.equal(canAccessStudentEvaluations({
    expectedUserId: "student-1",
    activeCoachLinkState: "linked",
    activeCoachLinkIdentityKey: "student-1",
  }), true, "vínculo activo aceptado");

  for (const scenario of [
    "invitación pendiente",
    "vínculo inexistente",
    "alumno desvinculado",
    "código vencido o vínculo rechazado",
  ]) {
    assert.equal(canAccessStudentEvaluations({
      expectedUserId: "student-1",
      activeCoachLinkState: "none",
      activeCoachLinkIdentityKey: "student-1",
    }), false, scenario);
  }

  assert.equal(canAccessStudentEvaluations({
    expectedUserId: "student-1",
    activeCoachLinkState: "loading",
    activeCoachLinkIdentityKey: null,
  }), false, "la carga canónica falla cerrada");
});

test("logout y cambio de identidad invalidan un vínculo resuelto para la sesión anterior", () => {
  assert.equal(canAccessStudentEvaluations({
    expectedUserId: "student-2",
    activeCoachLinkState: "linked",
    activeCoachLinkIdentityKey: "student-1",
  }), false);
  assert.equal(canAccessStudentEvaluations({
    expectedUserId: null,
    activeCoachLinkState: "linked",
    activeCoachLinkIdentityKey: "student-1",
  }), false);
});

test("una notificación sin acceso usa Dashboard como fallback seguro", () => {
  assert.equal(resolveStudentEvaluationNotificationTarget(true), "evaluaciones");
  assert.equal(resolveStudentEvaluationNotificationTarget(false), "dashboard");
});
