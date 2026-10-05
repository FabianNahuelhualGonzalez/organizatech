import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT_PATH = "src/components/organizatech-app.tsx";
const PORTAL_PATH = "src/features/coach-portal/components/coach-portal.tsx";
const BOUNDARY_PATH = "src/features/coach-portal/components/coach-workspace-boundary.tsx";
const CONTROLLER_PATH = "src/features/coach-portal/hooks/use-coach-workspace-controller.ts";

test("el composition root sólo entrega identidad al boundary del portal Coach", () => {
  const root = readFileSync(ROOT_PATH, "utf8");
  assert.match(root, /import \{ CoachPortalBoundary \} from "@\/features\/coach-portal\/components\/coach-portal";/);
  assert.match(root, /coachDataIdentityGeneration=\{coachDataIdentityGeneration\}/);
  assert.doesNotMatch(root, /features\/coach-(?:clients|dashboard)/);
  assert.doesNotMatch(root, /createCoach(?:ActiveRelationships|PendingInvitations|Invitation|ClientDisconnection|Preferences)Runtime/);
});

test("el portal monta la composición productiva y la feature conserva sus runtimes", () => {
  const portal = readFileSync(PORTAL_PATH, "utf8");
  const boundary = readFileSync(BOUNDARY_PATH, "utf8");
  const controller = readFileSync(CONTROLLER_PATH, "utf8");

  assert.match(portal, /<CoachWorkspaceBoundary/);
  assert.match(boundary, /<CoachDashboardView/);
  assert.match(boundary, /<CoachClientsView/);
  for (const runtime of [
    "createCoachActiveRelationshipsRuntime",
    "createCoachPendingInvitationsRuntime",
    "createCoachInvitationCreationRuntime",
    "createCoachInvitationDeliveryRuntime",
    "createCoachInvitationActionsRuntime",
    "createCoachClientDisconnectionRuntime",
    "createCoachPreferencesRuntime",
  ]) assert.match(controller, new RegExp(runtime));
  assert.match(controller, /creationController\?\.reconcile\(\)/);
  assert.match(controller, /creationController\?\.retry\(\)/);
  assert.match(controller, /setCreationEpoch\(\(value\) => value \+ 1\)/);
  assert.match(controller, /deliveryRuntime\?\.recoverInvitation\(invitationId\)/);
  assert.match(controller, /detailDeliveryPendingRef\.current !== null/);
  assert.match(controller, /detailDeliveryPendingRef\.current = selectedInvitationId/);
  assert.match(controller, /\.loadNext\(\)/);
  assert.doesNotMatch(controller, /training_sessions|exercise_entries/);
});

test("la creación distingue entrega pendiente y dirige al flujo aprobado sin código en URL", () => {
  const controller = readFileSync(CONTROLLER_PATH, "utf8");
  assert.match(controller, /La entrega por correo está pendiente; el código sigue vigente/);
  assert.match(controller, /Perfil > Coaching e ingresa este código/);
  assert.match(controller, /navigator\.share/);
  assert.doesNotMatch(controller, /wa\.me|coachCode=|URLSearchParams/);
});
