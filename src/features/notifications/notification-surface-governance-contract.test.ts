import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const governance = readFileSync("docs/visual-governance.md", "utf8");
const root = readFileSync("src/components/organizatech-app.tsx", "utf8");
const dashboard = readFileSync("src/features/dashboard/components/dashboard-screen.tsx", "utf8");
const profile = readFileSync("src/components/profile/ProfileScreen.tsx", "utf8");
const userNavigation = readFileSync("src/features/user-portal-shell/model/user-portal-navigation.ts", "utf8");
const navigationIntent = readFileSync("src/lib/navigation/app-navigation-intent.ts", "utf8");
const notificationRepository = readFileSync("src/features/evaluations/data/evaluation-notifications-repository.ts", "utf8");
const evaluationNavigation = readFileSync("src/features/evaluations/model/evaluation-navigation.ts", "utf8");
const studentEvaluations = readFileSync("src/features/evaluations/components/student-evaluations.tsx", "utf8");
const coachEvaluations = readFileSync("src/features/evaluations/components/coach-evaluations.tsx", "utf8");
const coachLinkingController = readFileSync("src/features/coach-linking/hooks/use-coach-linking-controller.ts", "utf8");

const APPROVED_NOTIFICATION_RULE = "Todas las notificaciones actuales y futuras se entregan exclusivamente mediante la campanita y su centro de notificaciones. Ningún Dashboard, Perfil o feature puede mostrar una tarjeta permanente que represente o duplique una notificación. Los accesos del menú son navegación, no notificaciones.";

test("la gobernanza visual conserva literalmente la regla global aprobada", () => {
  assert.equal(governance.split(APPROVED_NOTIFICATION_RULE).length - 1, 1);
});

test("Evaluaciones no se monta como tarjeta permanente en Dashboard ni Perfil", () => {
  assert.doesNotMatch(dashboard, /Evaluaciones|StudentEvaluations/);
  assert.doesNotMatch(profile, /Evaluaciones|StudentEvaluations/);
  assert.doesNotMatch(`${root}\n${dashboard}\n${profile}`, /StudentEvaluationsEntry|evaluationsEntry|data-evaluations-entry/);
  assert.match(root, /screen === "evaluaciones"[\s\S]*?<StudentEvaluations\b/);
});

test("Evaluaciones del menú es navegación autorizada por vínculo activo y no una notificación", () => {
  assert.match(userNavigation, /\{ id: "evaluations", label: "Evaluaciones", kind: "destination", availability: "enabled" \}/);
  assert.match(userNavigation, /evaluations: "evaluaciones"/);
  assert.match(userNavigation, /evaluaciones: "evaluations"/);
  assert.match(root, /const primaryScreens: Screen\[\] = \[[^\]]*"evaluaciones"\]/);
  assert.match(root, /activeCoachLinkState: coachLinking\.snapshot\.activeState/);
  assert.match(root, /activeCoachLinkIdentityKey: coachLinking\.snapshot\.activeStateIdentityKey/);
  assert.match(navigationIntent, /hasActiveCoachLink[\s\S]*?item !== "evaluaciones"/);
  assert.match(coachLinkingController, /activeStateIdentityKey: null/);
  assert.match(root, /screen === "evaluaciones" && supabaseUser\?\.id && hasStudentEvaluationsAccess/);
  assert.doesNotMatch(userNavigation, /AppNotification|NotificationOpenIntent|features\/notifications|lib\/notifications/);
});

test("la campanita abre la evaluación exacta mediante navegación tipada para ambos roles", () => {
  assert.match(notificationRepository, /target: "evaluaciones"/);
  assert.match(notificationRepository, /referenceId: row\.assignment_id \?\? undefined/);
  assert.match(root, /\.\.\.persistedEvaluationNotifications\.notifications/);
  assert.match(root, /intent\.notificationId\.startsWith\("evaluation:"\)[\s\S]*?persistedEvaluationNotifications\.markRead\(intent\.notificationId\)/);
  assert.match(root, /createEvaluationOpenRequest\([\s\S]*?intent\.referenceId/);
  assert.match(root, /resolveStudentEvaluationNotificationTarget\(hasStudentEvaluationsAccess\)/);
  assert.match(root, /setStudentEvaluationOpenRequest\(null\)[\s\S]*?navigateTo\(target\)/);
  assert.match(evaluationNavigation, /return hasAccess \? "evaluaciones" : "dashboard"/);
  assert.match(root, /function clearUserSessionState[\s\S]*?setCoachEvaluationOpenRequest\(null\)[\s\S]*?setStudentEvaluationOpenRequest\(null\)/);
  assert.match(evaluationNavigation, /export interface EvaluationOpenRequest/);
  assert.match(studentEvaluations, /notificationOpenRequest\.assignmentId[\s\S]*?openAssignment\(notificationOpenRequest\.assignmentId\)/);
  assert.match(coachEvaluations, /assignments\.find\(\(assignment\) => assignment\.id === notificationOpenRequest\.assignmentId\)/);
});
