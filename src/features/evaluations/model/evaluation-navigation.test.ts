import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canAccessStudentEvaluations,
  createEvaluationOpenRequest,
  resolveStudentEvaluationNotificationTarget,
  resolveStudentEvaluationScreenTarget,
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
    isCoachPortal: false,
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
      isCoachPortal: false,
    }), false, scenario);
  }

  assert.equal(canAccessStudentEvaluations({
    expectedUserId: "student-1",
    activeCoachLinkState: "loading",
    activeCoachLinkIdentityKey: null,
    isCoachPortal: false,
  }), false, "la carga canónica falla cerrada");

  assert.equal(canAccessStudentEvaluations({
    expectedUserId: "student-1",
    activeCoachLinkState: "none",
    activeCoachLinkIdentityKey: "student-1",
    isCoachPortal: false,
  }), false, "un error de lectura se resuelve cerrado");
});

test("logout y cambio de identidad invalidan un vínculo resuelto para la sesión anterior", () => {
  assert.equal(canAccessStudentEvaluations({
    expectedUserId: "student-2",
    activeCoachLinkState: "linked",
    activeCoachLinkIdentityKey: "student-1",
    isCoachPortal: false,
  }), false);
  assert.equal(canAccessStudentEvaluations({
    expectedUserId: null,
    activeCoachLinkState: "linked",
    activeCoachLinkIdentityKey: "student-1",
    isCoachPortal: false,
  }), false);
});

test("Coach nunca obtiene la superficie Alumno aunque comparta identidad con un vínculo activo", () => {
  assert.equal(canAccessStudentEvaluations({
    expectedUserId: "student-1",
    activeCoachLinkState: "linked",
    activeCoachLinkIdentityKey: "student-1",
    isCoachPortal: true,
  }), false);
});

test("ruta directa y restauración de Evaluaciones caen en Dashboard sin vínculo", () => {
  for (const source of ["ruta directa", "restauración"] as const) {
    assert.equal(resolveStudentEvaluationScreenTarget("evaluaciones", false), "dashboard", source);
  }
  assert.equal(resolveStudentEvaluationScreenTarget("evaluaciones", true), "evaluaciones");
  assert.equal(resolveStudentEvaluationScreenTarget("perfil", false), "perfil");
});

test("una notificación sin acceso usa Dashboard como fallback seguro", () => {
  assert.equal(resolveStudentEvaluationNotificationTarget(true), "evaluaciones");
  assert.equal(resolveStudentEvaluationNotificationTarget(false), "dashboard");
});

test("el gate productivo usa el vínculo canónico y limpia la restauración al perder acceso", () => {
  const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
  const controller = readFileSync("src/features/coach-linking/hooks/use-coach-linking-controller.ts", "utf8");
  const repository = readFileSync("src/features/coach-linking/data/coach-linking-repository.ts", "utf8");

  assert.match(repository, /readActive\(expectedUserId[\s\S]*?read_own_active_coach_link/);
  assert.match(root, /activeCoachLinkState: coachLinking\.snapshot\.activeState/);
  assert.match(root, /isCoachPortal: Boolean\(coachPortalSession\)/);
  assert.match(root, /resolveMenuScreens\([\s\S]*?hasStudentEvaluationsAccess/);
  assert.match(root, /screen === "evaluaciones" && supabaseUser\?\.id && hasStudentEvaluationsAccess/);
  assert.match(root, /if \(screen !== "evaluaciones"[\s\S]*?setStudentEvaluationOpenRequest\(null\)[\s\S]*?clearNavigationRestoration\([\s\S]*?"usuario"\)[\s\S]*?createAuthNavigationReset\("dashboard"/);
  assert.match(root, /resolveStudentEvaluationScreenTarget\(nextScreen, hasStudentEvaluationsAccess\)/);
  assert.match(controller, /visibilitychange/);
  assert.match(controller, /refreshActive[\s\S]*?repository\.readActive\(identityKey, flight\.signal\)/);
});
