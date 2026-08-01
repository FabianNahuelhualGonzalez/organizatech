import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración (P3-07A). No renderiza React, no ejecuta el componente.
 * Sucesor de `app-shell-visual-preparation-contract.test.ts` (P3-05, eliminado en esta rama): aquel
 * contrato verificaba que los componentes preparados espejaran el JSX original SIN estar todavía
 * cableados en el root. Este verifica lo contrario: que el root YA delega en ellos y que el JSX
 * inline equivalente fue eliminado, sin perder DOM/clases/ARIA/estructura.
 *
 * Verifica:
 * 1. El root importa y usa los 4 componentes de App Shell que se renderizan directamente
 *    (AppMenuButton se consume indirectamente vía AppTopbar).
 * 2. El JSX inline previo (hamburguesa, drawer, topbar, fila "Volver") ya no existe en el root.
 * 3. DOM/clases/ARIA críticos siguen presentes — ahora en los archivos de componente, no en el root.
 * 4. El hamburger conserva exactamente 3 spans; el drawer conserva exactamente 2 spans de cierre.
 * 5. Los componentes de App Shell no importan lógica prohibida (organizatech-app, Supabase,
 *    repositories, storage productivo).
 * 6. El refresh de avatar permanece en un callback del root (toggleMenu), no en los componentes.
 * 7. Notifications sigue siendo responsabilidad externa a AppShellLayout: desde P3-07C el root
 *    llena el slot con NotificationPanel (estado y callbacks siguen en el root).
 * 8. `globals.css` no se referencia como modificado por este contrato (la verificación de bytes
 *    reales queda en el gate de `git diff` del reporte final, no aquí).
 * 9. Regresión de comportamiento (sin harness de render, siguiendo el patrón estático ya usado en
 *    `notification-integration-contract.test.ts`): orden exacto de toggleMenu, badge condicional,
 *    overlay de notificaciones, wiring de onNavigate/onClose del drawer y gating del back button.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontro el inicio del contrato: ${startMarker}`);
  assert.ok(end > start, `No se encontro el final del contrato: ${endMarker}`);
  return source.slice(start, end);
}

function assertInOrder(source: string, markers: string[]) {
  let previous = -1;
  markers.forEach((marker) => {
    const current = source.indexOf(marker);
    assert.ok(current >= 0, `Falta el paso requerido: ${marker}`);
    assert.ok(current > previous, `El paso esta fuera de orden: ${marker}`);
    previous = current;
  });
}

const appSource = readSource("src/components/organizatech-app.tsx");

const components = {
  shellLayout: readSource("src/features/app-shell/components/app-shell-layout.tsx"),
  topbar: readSource("src/features/app-shell/components/app-topbar.tsx"),
  menuButton: readSource("src/features/app-shell/components/app-menu-button.tsx"),
  drawer: readSource("src/features/app-shell/components/app-navigation-drawer.tsx"),
  screenHeader: readSource("src/features/app-shell/components/app-screen-header.tsx"),
};

// 1. El root importa y usa los componentes de App Shell renderizados directamente.
assert.match(appSource, /import \{ AppShellLayout \} from "@\/features\/app-shell\/components\/app-shell-layout";/);
assert.match(appSource, /import \{ AppTopbar \} from "@\/features\/app-shell\/components\/app-topbar";/);
assert.match(appSource, /import \{ AppNavigationDrawer \} from "@\/features\/app-shell\/components\/app-navigation-drawer";/);
assert.match(appSource, /import \{ AppScreenHeader \} from "@\/features\/app-shell\/components\/app-screen-header";/);
assert.match(appSource, /<AppShellLayout/);
assert.match(appSource, /topbar=\{/);
assert.match(appSource, /notificationOverlay=\{/);
assert.match(appSource, /navigationOverlay=\{/);
assert.match(appSource, /screenHeader=\{/);
assert.match(appSource, /<AppTopbar/);
assert.match(appSource, /<AppNavigationDrawer/);
assert.match(appSource, /<AppScreenHeader onBack=\{goBack\} \/>/);

// 2. El JSX inline previo (hamburguesa, drawer, topbar, fila "Volver") ya no existe en el root.
// Nota: `<main className="app-shell">` sigue apareciendo en el root para las pantallas de
// auth/carga (early returns antes del shell autenticado) — eso queda fuera de alcance de P3-07A.
assert.doesNotMatch(appSource, /<header className={`topbar/, "el topbar inline debe haberse eliminado del root");
assert.doesNotMatch(appSource, /hamburger-line/, "las 3 lineas del hamburger ahora viven en AppMenuButton");
assert.doesNotMatch(appSource, /drawer-x-line/, "las 2 lineas de cierre del drawer ahora viven en AppNavigationDrawer");
assert.doesNotMatch(appSource, /menu-backdrop/, "el backdrop del drawer ahora vive en AppNavigationDrawer");
assert.doesNotMatch(appSource, /menu-drawer-shell/, "el shell del drawer ahora vive en AppNavigationDrawer");
assert.doesNotMatch(appSource, /section-back-row/, "la fila Volver ahora vive en AppScreenHeader");
assert.doesNotMatch(appSource, /import \{[^}]*\bBell\b[^}]*\} from "lucide-react"/, "Bell ya no se usa directamente en el root");
assert.doesNotMatch(appSource, /import \{[^}]*\bChevronLeft\b[^}]*\} from "lucide-react"/, "ChevronLeft ya no se usa directamente en el root");
assert.doesNotMatch(appSource, /import \{[^}]*\bLogOut\b[^}]*\} from "lucide-react"/, "LogOut ya no se usa directamente en el root");

// 3-4. DOM/clases/ARIA criticos, ahora en los componentes, con la estructura exacta preservada.
assert.match(components.shellLayout, /<main className="app-shell">/);
assert.match(components.topbar, /className={`topbar \$\{isHidden \? "hidden" : ""\}`}/);
assert.match(components.topbar, /aria-label="Ver notificaciones"/);
assert.match(components.topbar, /aria-expanded={isNotificationPanelOpen}/);
assert.match(components.topbar, /notification-badge/);
assert.match(components.menuButton, /aria-label="Abrir menú"/);
assert.match(components.menuButton, /aria-expanded={isOpen}/);
assert.equal((components.menuButton.match(/hamburger-line/g) ?? []).length, 3, "el hamburger debe conservar exactamente 3 spans");
assert.match(components.drawer, /role="dialog"/);
assert.match(components.drawer, /aria-label="Menú de navegación"/);
assert.equal((components.drawer.match(/drawer-x-line/g) ?? []).length, 2, "el boton de cierre debe conservar exactamente 2 spans");
assert.match(components.drawer, /role="menuitem" onClick={onLogout} disabled={isLogoutDisabled}/);

// -------------------------------------------------------------------------------------------
// P3-50B1 — Drawer conectado al motor compartido de foco.
//
// COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente. NO ejecutan foco, teclado ni
// DOM, y NO sustituyen la QA manual en navegador (ver informe).
// -------------------------------------------------------------------------------------------
const overlayEngineImport = /import \{[\s\S]*?useOverlayFocusManagement,?[\s\S]*?\} from "@\/ui\/overlays\/use-overlay-focus-management";|import \{ useOverlayFocusManagement \} from "@\/ui\/overlays\/use-overlay-focus-management";/;
assert.match(components.drawer, overlayEngineImport, "el Drawer debe usar el motor compartido");
// Aserciones estructurales sobre el CODIGO sin comentarios, para que la documentacion del
// componente no pueda satisfacerlas por accidente.
const drawerCode = components.drawer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
// (2) El hook se invoca ANTES del return condicional por isOpen.
const drawerHookIndex = components.drawer.indexOf("useOverlayFocusManagement<HTMLDivElement>(");
const drawerEarlyReturnIndex = components.drawer.indexOf("if (!isOpen) return null;");
assert.ok(drawerHookIndex >= 0 && drawerEarlyReturnIndex > drawerHookIndex, "el hook debe llamarse antes del early return");
// (3)(4) Ref conectado, isActive={isOpen}, id estable, aria-modal y tabIndex fallback.
assert.match(components.drawer, /isActive: isOpen,\s*\n\s*onClose,\s*\n\s*canClose: true,/);
assert.match(drawerCode, /ref=\{drawerRef\}/);
assert.match(components.drawer, /export const APP_NAVIGATION_DRAWER_ID = "app-navigation-drawer";/);
assert.match(drawerCode, /id=\{APP_NAVIGATION_DRAWER_ID\}/);
assert.match(drawerCode, /aria-modal="true"/);
assert.match(drawerCode, /tabIndex=\{-1\}/);
// (9) El boton Cerrar recibe el marcador de foco inicial exportado por el motor.
assert.match(components.drawer, /className="drawer-close"[\s\S]*?\{\.\.\.\{ \[OVERLAY_INITIAL_FOCUS_ATTRIBUTE\]: "" \}\}/);
// (8) aria-controls coincidente en el trigger.
assert.match(components.menuButton, /aria-controls=\{APP_NAVIGATION_DRAWER_ID\}/);
assert.match(components.menuButton, /import \{ APP_NAVIGATION_DRAWER_ID \} from "\.\/app-navigation-drawer";/);
// (11) Sin listeners, stacks ni selectores locales: todo proviene del motor.
for (const forbiddenLocal of [
  /addEventListener|removeEventListener/,
  /useEffect/,
  /querySelectorAll/,
  /activeOverlayOwners|activeModalOwners/,
  /dangerouslySetInnerHTML/,
]) {
  assert.doesNotMatch(drawerCode, forbiddenLocal, `el Drawer no debe implementar ${forbiddenLocal}`);
}
// (12) Backdrops y callbacks intactos.
assert.match(components.drawer, /<button className="menu-backdrop" type="button" aria-label="Cerrar menú" onClick=\{onClose\} \/>/);
assert.match(components.drawer, /<button className="drawer-empty" type="button" aria-label="Cerrar menú" onClick=\{onClose\} \/>/);
// Roles de navegacion intactos.
assert.match(components.drawer, /role="menu" aria-label="Menú principal"/);
assert.equal((components.drawer.match(/role="menuitem"/g) ?? []).length, 2, "menuitem en items y logout");
assert.match(components.screenHeader, /section-back-button/);
assert.match(components.screenHeader, />\s*Volver\s*</);

// 5. Los componentes de App Shell no importan logica prohibida.
function assertNoForbiddenImports(source: string, label: string) {
  const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  importPaths.forEach((path) => {
    assert.doesNotMatch(path, /organizatech-app/, `${label}: import prohibido de organizatech-app.tsx (${path})`);
    assert.doesNotMatch(path, /^@\/lib\/storage/, `${label}: import prohibido de storage productivo (${path})`);
    assert.doesNotMatch(path, /supabase/i, `${label}: import prohibido de Supabase (${path})`);
    assert.doesNotMatch(path, /-repository$/, `${label}: import prohibido de repositories (${path})`);
  });
}
Object.entries(components).forEach(([label, source]) => assertNoForbiddenImports(source, label));

// 6. El refresh de avatar permanece en un callback del root, no en los componentes visuales.
assert.match(appSource, /function toggleMenu\(\) \{/);
assert.match(appSource, /void refreshProfileAvatar\(\{ force: true, allowProfileLookup: true \}\);/);
Object.entries(components).forEach(([label, source]) => {
  assert.doesNotMatch(source, /refreshProfileAvatar/, `${label} no debe conocer refreshProfileAvatar (logica de produccion del root)`);
});

// 7. Notifications sigue siendo responsabilidad externa a AppShellLayout: el root llena el slot
//    con NotificationPanel (P3-07C) — el estado, las props y los callbacks siguen siendo del
//    root, y ninguno de los 5 componentes de App Shell dibuja el panel.
assert.match(appSource, /notificationOverlay=\{\s*<NotificationPanel/);
assert.match(appSource, /isOpen=\{isNotificationPanelOpen\}/);
Object.entries(components).forEach(([label, source]) => {
  assert.doesNotMatch(source, /notification-panel"|<NotificationPanel/, `${label} no debe dibujar el panel de notificaciones (sigue siendo slot del root)`);
});

// 9a. toggleMenu: cierra notificaciones, luego alterna isMenuOpen, y el refresh de avatar solo
//     ocurre en la rama de apertura (next === true) — orden exacto preservado del onClick original.
const toggleMenuSource = sourceSection(appSource, "function toggleMenu() {", "  return (");
assertInOrder(toggleMenuSource, [
  "setIsNotificationPanelOpen(false)",
  "setIsMenuOpen((value) => {",
  "const next = !value;",
  "if (next) {",
  "void refreshProfileAvatar({ force: true, allowProfileLookup: true });",
  "return next;",
]);

// 9b. Badge: el contador solo se dibuja cuando hay texto (guard condicional, no siempre visible).
assert.match(components.topbar, /\{notificationBadgeText \? \(/);
assert.match(components.topbar, /className="notification-badge" aria-label={notificationBadgeAriaLabel \?\? undefined}/);

// 9c. Overlay de notificaciones: el cierre sigue siendo un callback del root pasado al panel
//     (el backdrop en si vive en NotificationPanel y se verifica en su propio contrato).
assert.match(appSource, /onClose=\{\(\) => setIsNotificationPanelOpen\(false\)\}/);

// 9d. Drawer: onNavigate y onLogout llegan directo del root, sin envoltorios que oculten el navigateTo/handleLogout reales.
assert.match(appSource, /onNavigate={navigateTo}/);
assert.match(appSource, /onLogout={handleLogout}/);
assert.match(appSource, /onClose={\(\) => setIsMenuOpen\(false\)}/);
assert.match(components.drawer, /onClick={\(\) => onNavigate\(item\.id\)}/);

// 9e. Back button: AppScreenHeader solo se pasa cuando canGoBackFromScreen(screen) es true — el
//     componente en si no tiene guard interno, asi que el gating debe vivir en el root.
assert.match(appSource, /screenHeader={canGoBackFromScreen\(screen\) \? <AppScreenHeader onBack={goBack} \/> : null}/);
assert.doesNotMatch(components.screenHeader, /screen !== "dashboard"|canGoBackFromScreen/, "AppScreenHeader no debe reimplementar el gating, lo recibe del root");

// ---------------------------------------------------------------------------------------------
// P3-47B — IconButton compartido.
//
// (a) COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente, no renderizan React.
// ---------------------------------------------------------------------------------------------
const iconButtonSource = readSource("src/ui/buttons/icon-button.tsx");
assert.equal(
  (iconButtonSource.match(/^export function IconButton\b/gm) ?? []).length,
  1,
  "existe una sola definicion productiva de IconButton",
);
// `aria-label` obligatorio POR TIPO (no por convencion): se omite del tipo nativo y se redeclara
// como requerido.
assert.match(iconButtonSource, /Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">/);
assert.match(iconButtonSource, /"aria-label": string;/);
assert.doesNotMatch(iconButtonSource, /"aria-label"\?:/, "aria-label no puede ser opcional");
// Se evalua el CODIGO real, sin comentarios: la documentacion del modulo menciona estos nombres
// precisamente para declarar que quedan fuera de alcance.
const iconButtonCode = iconButtonSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
for (const forbidden of [/dangerouslySetInnerHTML/, /\bisBusy\b/, /\buseState\b|\buseEffect\b/]) {
  assert.doesNotMatch(iconButtonCode, forbidden, `IconButton no debe incorporar ${forbidden}`);
}

// Ambos consumidores autorizados importan la primitive real y ya no declaran <button> propios.
for (const [label, source] of [["menuButton", components.menuButton], ["topbar", components.topbar]] as const) {
  assert.match(source, /import \{ IconButton \} from "@\/ui\/buttons\/icon-button";/, label);
  assert.doesNotMatch(source, /<button\b/, `${label}: no deben quedar <button> locales`);
}
assert.match(components.menuButton, /<IconButton\s+className=\{`menu-trigger \$\{isOpen \? "active" : ""\}`\}/);
assert.match(components.menuButton, /onClick=\{onToggle\}/);
assert.match(components.topbar, /<IconButton\s+className="notification-trigger"/);
assert.match(components.topbar, /onClick=\{onToggleNotifications\}/);
// La clase base ya no se repite en el consumidor: la aporta la primitive.
assert.doesNotMatch(
  `${components.menuButton}\n${components.topbar}`,
  /className="icon-button|icon-button menu-trigger|icon-button notification-trigger/,
  "la clase base la compone la primitive, no el consumidor",
);

// NOTA SOBRE COBERTURA RUNTIME (P3-47B): NO se agrega aqui. `tsconfig.json` declara
// `"jsx": "preserve"` porque Next aplica su runtime automatico en build; el CLI `tsx` que ejecuta
// esta suite cae entonces al runtime clasico y exige `React` en scope dentro de la primitive.
// Habilitarlo requeriria modificar `tsconfig.json`, el comando de `package.json` o importar React
// en el modulo productivo — los tres fuera del alcance autorizado de esta tarea. Por eso TODAS las
// comprobaciones de este bloque son ESTATICAS/SOURCE-BASED y no deben presentarse como cobertura
// de render.

console.log("app-shell-visual-integration contract tests passed");
