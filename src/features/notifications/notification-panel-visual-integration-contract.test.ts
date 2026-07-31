import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración de NotificationPanel (P3-07C). Sucesor del contrato de
 * preparación (eliminado en esta rama): aquel verificaba que el componente espejara el JSX
 * inline del root SIN estar cableado; este verifica lo contrario — el root delega en
 * NotificationPanel dentro del slot notificationOverlay, el JSX inline fue eliminado, y el
 * componente conserva DOM/ARIA/copy, pureza y reutilización de NotificationGroup.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");
const panelSource = readSource("src/features/notifications/components/NotificationPanel.tsx");
const packageSource = readSource("package.json");

// 1. El root importa NotificationPanel y lo usa dentro del slot notificationOverlay.
assert.match(appSource, /import \{ NotificationPanel \} from "@\/features\/notifications\/components\/NotificationPanel";/);
assert.match(appSource, /notificationOverlay=\{\s*<NotificationPanel/);

// 2. Props exactas: total completo (no métricas derivadas), arrays correctos, registros vistos,
//    mensaje vacío canónico, apertura y cierre productivos.
assert.match(appSource, /isOpen=\{isNotificationPanelOpen\}/);
assert.match(appSource, /subtitle=\{notificationPanelSubtitle\}/);
assert.match(appSource, /totalNotificationsCount=\{appNotifications\.length\}/);
assert.doesNotMatch(appSource, /totalNotificationsCount=\{(?:unseenNotificationCount|newNotifications\.length|historyNotifications\.length)/, "el estado vacio depende del total completo, no de una metrica derivada");
assert.match(appSource, /newNotifications=\{newNotifications\}/);
assert.match(appSource, /historyNotifications=\{historyNotifications\}/);
assert.match(appSource, /seenNotificationRecordsById=\{seenNotificationRecordsById\}/);
assert.match(appSource, /emptyMessage=\{NOTIFICATION_EMPTY_MESSAGE\}/);
assert.match(appSource, /onClose=\{\(\) => setIsNotificationPanelOpen\(false\)\}/);
assert.match(appSource, /onOpenNotification=\{openNotificationTarget\}/);

// 3. El JSX inline antiguo fue eliminado del root.
assert.doesNotMatch(appSource, /className="notification-backdrop"/, "el backdrop ahora vive en NotificationPanel");
assert.doesNotMatch(appSource, /className="notification-panel"/, "el panel ahora vive en NotificationPanel");
assert.doesNotMatch(appSource, /className="notification-empty"/, "el estado vacio ahora vive en NotificationPanel");
assert.doesNotMatch(appSource, /<NotificationGroup/, "los grupos se renderizan via NotificationPanel");
assert.doesNotMatch(appSource, /import \{ NotificationGroup \}/, "el root ya no importa NotificationGroup directamente");

// 4. DOM/clases/roles/ARIA del componente, con la estructura exacta del JSX original.
assert.match(panelSource, /if \(!isOpen\) return null;/);
assert.match(panelSource, /className="notification-backdrop"\s*\n\s*aria-label="Cerrar notificaciones"\s*\n\s*onClick=\{onClose\}/);
assert.match(panelSource, /className="notification-panel"/);
assert.match(panelSource, /role="dialog"/);
assert.match(panelSource, /aria-label="Notificaciones"/);
assert.match(panelSource, /className="notification-panel-header"/);
assert.match(panelSource, /<strong id=\{NOTIFICATION_PANEL_TITLE_ID\}>Notificaciones<\/strong>/);
assert.match(panelSource, /totalNotificationsCount > 0 \? \(/);
assert.match(panelSource, /className="notification-list"/);
// P3-48B (COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente; NO renderizan React ni
// verifican el anuncio real de un lector de pantalla): el estado vacio pasa a la primitive
// compartida, conservando clase, texto y condicion.
assert.match(panelSource, /import \{ EmptyState \} from "@\/ui\/feedback\/empty-state";/);
assert.match(panelSource, /<EmptyState className="notification-empty" message=\{emptyMessage\} \/>/);
assert.equal((panelSource.match(/<EmptyState\b/g) ?? []).length, 1, "un unico estado vacio");
assert.doesNotMatch(panelSource, /<p className="notification-empty"/, "no debe quedar el markup local migrado");
// La condicion de vacio no cambia.
assert.match(panelSource, /totalNotificationsCount > 0 \? \([\s\S]*?\) : \(\s*<EmptyState/);
// `drawer-empty` NO se migra: es un backdrop/boton, no un estado vacio.
assert.doesNotMatch(panelSource, /drawer-empty/);

// Semantica accesible de la primitive real (source-based).
const emptyStateSource = readSource("src/ui/feedback/empty-state.tsx");
assert.equal((emptyStateSource.match(/^export function EmptyState\b/gm) ?? []).length, 1, "una sola definicion de EmptyState");
assert.match(emptyStateSource, /role="status"/, "el estado vacio se anuncia tras la carga");
const emptyStateCode = emptyStateSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const forbidden of [/useState|useEffect/, /dangerouslySetInnerHTML/, /onClick/, /lucide-react/]) {
  assert.doesNotMatch(emptyStateCode, forbidden, `EmptyState no debe incorporar ${forbidden}`);
}

assert.doesNotMatch(panelSource, /data-section=/, "el JSX original no tenia data-section y el componente tampoco debe tenerlo");

// 5. Grupos: reutilización de NotificationGroup (exactamente 2 usos), Nuevas antes de Historial.
assert.match(panelSource, /import \{ NotificationGroup \} from "\.\/NotificationGroup";/);
assert.equal((panelSource.match(/<NotificationGroup/g) ?? []).length, 2, "exactamente dos grupos: Nuevas e Historial");
assert.ok(
  panelSource.indexOf('title="Nuevas"') >= 0 &&
  panelSource.indexOf('title="Historial"') > panelSource.indexOf('title="Nuevas"'),
  "Nuevas debe renderizarse antes de Historial",
);
assert.doesNotMatch(panelSource, /^\s*function NotificationGroup\b|^\s*function renderNotificationIcon\b/m, "no se duplican grupos ni iconos");

// 6. Pureza del componente: solo callbacks, sin estado propio, sin efectos, sin dependencias
//    prohibidas (absorbe la lista del contrato de preparación eliminado).
for (const forbidden of [
  /\buseState\b/, /\buseEffect\b/, /\buseMemo\b/, /\buseRef\b/,
  /\bwindow\.\w/, /\bdocument\.\w/, /\bsetTimeout\b/, /\bquerySelector\b/, /\bscrollIntoView\b/,
  /\bsetScreen\b/, /\bsetScreenHistory\b/,
  /\bmarkNotificationsSeen\b/, /\btoggleNotifications\b/, /\bopenNotificationTarget\b/, /\bscrollToNotificationSection\b/,
  /from ["']@\/components\/organizatech-app["']/,
  /from ["']@\/lib\/(?:data|storage|supabase|navigation)\//,
  /-repository["']/,
]) {
  assert.doesNotMatch(panelSource, forbidden, `NotificationPanel no debe contener ${forbidden}`);
}

// 7. Orden funcional externo preservado: el intent de apertura sigue integro en el root y el
//    panel solo dispara callbacks (la apertura no navega en paralelo).
const openTargetSource = (() => {
  const start = appSource.indexOf("  function openNotificationTarget");
  const end = appSource.indexOf("  function scrollToNotificationSection", start);
  assert.ok(start >= 0 && end > start, "openNotificationTarget/scrollToNotificationSection deben seguir adyacentes");
  return appSource.slice(start, end);
})();
["resolveNotificationOpenIntent(notification)", "markNotificationsSeen([intent.notificationId])", "setIsNotificationPanelOpen(false)", "navigateTo(intent.target)", "scrollToNotificationSection(intent.section ?? undefined)"]
  .reduce((previous, marker) => {
    const current = openTargetSource.indexOf(marker);
    assert.ok(current > previous, `orden funcional roto en: ${marker}`);
    return current;
  }, -1);

// 8. Controlador de navegación intacto (P3-07B no se degrada).
assert.equal((appSource.match(/setScreen\(/g) ?? []).length, 2, "exactamente 2 escritores de pantalla autorizados");
assert.equal((appSource.match(/setScreenHistory\(/g) ?? []).length, 1, "exactamente 1 escritor de historial autorizado");

// 9. Registro exacto en la suite.
assert.equal(
  packageSource.split("tsx src/features/notifications/notification-panel-visual-integration-contract.test.ts").length - 1,
  1,
  "el contrato debe estar registrado exactamente una vez",
);

// -------------------------------------------------------------------------------------------
// P3-50B1 — NotificationPanel conectado al motor compartido de foco.
//
// COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente. NO ejecutan foco, teclado ni
// DOM, y NO sustituyen la QA manual en navegador (ver informe).
// -------------------------------------------------------------------------------------------
assert.match(panelSource, /import \{ useOverlayFocusManagement \} from "@\/ui\/overlays\/use-overlay-focus-management";/);
// Las aserciones estructurales se evaluan sobre el CODIGO sin comentarios: la documentacion del
// componente menciona `tabIndex={-1}` y `notification-item`, y podria satisfacerlas por accidente.
const panelCode = panelSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
// (2) El hook se invoca ANTES del return condicional por isOpen.
const panelHookIndex = panelSource.indexOf("useOverlayFocusManagement<HTMLDivElement>(");
const panelEarlyReturnIndex = panelSource.indexOf("if (!isOpen) return null;");
assert.ok(panelHookIndex >= 0 && panelEarlyReturnIndex > panelHookIndex, "el hook debe llamarse antes del early return");
// (3)(4) Ref conectado, isActive={isOpen}, id estable, aria-modal y tabIndex fallback.
assert.match(panelSource, /isActive: isOpen,\s*\n\s*onClose,\s*\n\s*canClose: true,/);
assert.match(panelCode, /ref=\{panelRef\}/);
assert.match(panelSource, /export const NOTIFICATION_PANEL_ID = "notification-panel";/);
assert.match(panelCode, /id=\{NOTIFICATION_PANEL_ID\}/);
assert.match(panelCode, /aria-modal="true"/);
assert.match(panelCode, /tabIndex=\{-1\}/);
// (10) Titulo visible asociado por aria-labelledby, sin perder el nombre accesible.
assert.match(panelSource, /export const NOTIFICATION_PANEL_TITLE_ID = "notification-panel-title";/);
assert.match(panelCode, /aria-labelledby=\{NOTIFICATION_PANEL_TITLE_ID\}/);
// (5)(6) Foco inicial por fallback natural: NO se marca un objetivo explicito en el panel.
assert.doesNotMatch(panelCode, /OVERLAY_INITIAL_FOCUS_ATTRIBUTE/, "el foco inicial debe resolverse por fallback natural");
// (11) Sin listeners, stacks ni selectores locales.
for (const forbiddenLocal of [
  /addEventListener|removeEventListener/,
  /useEffect/,
  /querySelectorAll/,
  /activeOverlayOwners|activeModalOwners/,
  /dangerouslySetInnerHTML/,
]) {
  assert.doesNotMatch(panelCode, forbiddenLocal, `el panel no debe implementar ${forbiddenLocal}`);
}
// (8) aria-controls coincidente en el trigger de la topbar.
const topbarSource = readSource("src/features/app-shell/components/app-topbar.tsx");
assert.match(topbarSource, /aria-controls=\{NOTIFICATION_PANEL_ID\}/);
assert.match(topbarSource, /import \{ NOTIFICATION_PANEL_ID \} from "@\/features\/notifications\/components\/NotificationPanel";/);
assert.match(topbarSource, /aria-expanded=\{isNotificationPanelOpen\}/, "el trigger conserva aria-expanded");

console.log("notification-panel visual integration contract tests passed");
