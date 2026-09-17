import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

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

interface ProductTsxFile {
  path: string;
  source: string;
}

function readProductTsxFiles(root: string): ProductTsxFile[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return readProductTsxFiles(path);
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) return [];
    return [{ path, source: readSource(path) }];
  });
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

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
    current = current.expression;
  }
  return current;
}

function propertyNameText(member: ts.ObjectLiteralElementLike): string | null {
  if (!member.name) return null;
  return ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
    ? member.name.text
    : null;
}

function findReturnedObjectMember(input: {
  path: string;
  source: string;
  functionName: string;
  memberName: string;
}): ts.ObjectLiteralElementLike {
  const sourceFile = ts.createSourceFile(
    input.path,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    input.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const candidates = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === input.functionName
  ));
  assert.equal(candidates.length, 1, `${input.functionName}: se esperaba una función top-level inequívoca`);
  const body = candidates[0].body;
  assert.ok(body, `${input.functionName}: la función debe tener cuerpo ejecutable`);
  const returns = body.statements.filter((statement): statement is ts.ReturnStatement => (
    ts.isReturnStatement(statement)
  ));
  assert.equal(returns.length, 1, `${input.functionName}: se esperaba un único return directo del boundary`);
  const returnedExpression = returns[0].expression && unwrapExpression(returns[0].expression);
  assert.ok(
    returnedExpression && ts.isObjectLiteralExpression(returnedExpression),
    `${input.functionName}: el return directo debe ser un objeto boundary`,
  );
  const members = returnedExpression.properties.filter((member) => (
    propertyNameText(member) === input.memberName
  ));
  assert.equal(members.length, 1, `${input.functionName}.${input.memberName}: miembro ausente o ambiguo`);
  return members[0];
}

function assertProfileForegroundWiring(source: string) {
  const member = findReturnedObjectMember({
    path: "src/features/profile/hooks/useProfileController.ts",
    source,
    functionName: "useProfileController",
    memberName: "refreshProfileAvatar",
  });
  assert.ok(
    ts.isPropertyAssignment(member),
    `useProfileController.refreshProfileAvatar: se esperaba PropertyAssignment, no ${ts.SyntaxKind[member.kind]}`,
  );
  const initializer = unwrapExpression(member.initializer);
  if (ts.isArrowFunction(initializer)) {
    assert.fail("useProfileController.refreshProfileAvatar: un ArrowFunction no puede reemplazar el command conectado");
  }
  assert.ok(
    ts.isPropertyAccessExpression(initializer),
    "useProfileController.refreshProfileAvatar: el initializer ejecutable debe referenciar controller.foreground",
  );
  assert.ok(
    ts.isIdentifier(initializer.expression) &&
      initializer.expression.text === "controller" &&
      initializer.name.text === "foreground",
    "useProfileController.refreshProfileAvatar: wiring distinto de controller.foreground",
  );
}

const appSource = readSource("src/components/organizatech-app.tsx");
const packageSource = readSource(process.env.UI_NAV_01_PACKAGE_PATH ?? "package.json");
const profileHookSource = readSource("src/features/profile/hooks/useProfileController.ts");
const profileControllerSource = readSource("src/features/profile/model/profile-controller.ts");
const authScreenSource = readSource("src/features/auth/components/auth-screen.tsx");
const appBackButtonSource = readSource("src/ui/navigation/app-back-button.tsx");
const appBackButtonStyles = readSource("src/ui/navigation/app-back-button.module.css");
const productTsxFiles = readProductTsxFiles("src");
const productTsxSource = productTsxFiles.map((file) => file.source).join("\n");

const packageTestRunner = (JSON.parse(packageSource) as {
  scripts?: Record<string, string>;
}).scripts?.test ?? "";
assert.equal(
  packageTestRunner.split(
    "src/features/user-portal-shell/user-portal-shell-integration.contract.test.ts",
  ).length - 1,
  1,
  "[UI-NAV-01.runner-external] el contrato de integración debe estar registrado exactamente una vez",
);

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
assert.match(components.screenHeader, /import \{ AppBackButton \} from "@\/ui\/navigation\/app-back-button";/);
assert.match(components.screenHeader, /<AppBackButton onBack=\{onBack\} \/>/);

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
assertNoForbiddenImports(appBackButtonSource, "appBackButton");

// 6. El refresh de avatar permanece en el API público de Profile. El root sólo conecta el callback
//    estrecho de App Shell y los componentes visuales no conocen el controller.
assert.match(
  appSource,
  /import \{ useProfileController \} from "@\/features\/profile\/hooks\/useProfileController";/,
);
assert.match(appSource, /const profileBoundary = useProfileController\(\{/);
assert.match(appSource, /refreshProfileAvatar,\s*\n/);
assert.doesNotMatch(
  appSource,
  /function refreshProfileAvatar\s*\(/,
  "el root no debe reinstalar el owner legacy de refreshProfileAvatar",
);
assertProfileForegroundWiring(profileHookSource);
const foregroundSource = sourceSection(
  profileControllerSource,
  "    foreground() {",
  "    async saveProfile",
);
assertInOrder(foregroundSource, [
  "return controller.refreshAvatar({",
  "force: true,",
  "allowProfileLookup: true,",
  "publishProfileLookup: false,",
]);
const imageErrorSource = sourceSection(
  profileHookSource,
  "  const handleAvatarImageError = useCallback(() => {",
  "  return {",
);
assertInOrder(imageErrorSource, [
  "if (now - lastImageErrorRefreshAtRef.current < PROFILE_AVATAR_ERROR_REFRESH_THROTTLE_MS) return;",
  "lastImageErrorRefreshAtRef.current = now;",
  "void controller.foreground();",
]);
assert.match(appSource, /onAvatarImageError=\{handleProfileAvatarImageError\}/);
assert.match(appSource, /function toggleMenu\(\) \{/);
assert.match(appSource, /void refreshProfileAvatar\(\);/);
Object.entries(components).forEach(([label, source]) => {
  assert.doesNotMatch(source, /refreshProfileAvatar/, `${label} no debe conocer refreshProfileAvatar (logica de produccion del root)`);
});

// 7. Notifications sigue siendo responsabilidad externa a ambos layouts: el root construye una
//    única instancia de NotificationPanel y transporta ese slot al shell seleccionado. El estado,
//    las props y los callbacks siguen siendo del root, y ningún componente legacy lo redibuja.
assert.match(appSource, /const notificationOverlay = \(\s*<NotificationPanel/);
assert.match(appSource, /notificationOverlay=\{notificationOverlay\}/);
assert.match(appSource, /isOpen=\{isNotificationPanelOpen\}/);
Object.entries(components).forEach(([label, source]) => {
  assert.doesNotMatch(source, /notification-panel"|<NotificationPanel/, `${label} no debe dibujar el panel de notificaciones (sigue siendo slot del root)`);
});

// 9a. toggleMenu delega exclusión/toggle al controller y conserva el refresh sólo al abrir.
const toggleMenuSource = sourceSection(appSource, "function toggleMenu() {", "  return (");
assertInOrder(toggleMenuSource, [
  "appShell.toggleMenu(() => {",
  "void refreshProfileAvatar();",
]);

// 9b. Badge: el contador solo se dibuja cuando hay texto (guard condicional, no siempre visible).
assert.match(components.topbar, /\{notificationBadgeText \? \(/);
assert.match(components.topbar, /className="notification-badge" aria-label={notificationBadgeAriaLabel \?\? undefined}/);

// 9c. Overlay de notificaciones: el cierre sigue siendo un callback del root pasado al panel
//     (el backdrop en si vive en NotificationPanel y se verifica en su propio contrato).
assert.match(appSource, /onClose=\{appShell\.closeNotifications\}/);

// 9d. Drawer: onNavigate y onLogout llegan directo del root, sin envoltorios que oculten el navigateTo/handleLogout reales.
assert.match(appSource, /onNavigate={navigateTo}/);
assert.match(appSource, /onLogout={handleLogout}/);
assert.match(appSource, /onClose={appShell\.closeMenu}/);
assert.match(components.drawer, /onClick={\(\) => onNavigate\(item\.id\)}/);

// 9e. Back button: AppScreenHeader solo se pasa cuando canGoBackFromScreen(screen) es true — el
//     componente en si no tiene guard interno, asi que el gating debe vivir en el root.
assert.match(appSource, /const screenHeader = canGoBackFromScreen\(screen\)[\s\S]*?\? <AppScreenHeader onBack=\{goBack\} \/>[\s\S]*?: null;/);
assert.match(appSource, /screenHeader=\{screenHeader\}/);
assert.doesNotMatch(components.screenHeader, /screen !== "dashboard"|canGoBackFromScreen/, "AppScreenHeader no debe reimplementar el gating, lo recibe del root");

// ---------------------------------------------------------------------------------------------
// TRAIN-UI-01 — contrato focal ESTATICO/source-based del Back canonico. No simula click ni
// teclado; comprueba que el elemento nativo conserva una unica conexion onClick al controller.
// ---------------------------------------------------------------------------------------------
assert.match(appBackButtonSource, /export interface AppBackButtonProps \{\s*onBack: \(\) => void;\s*\}/);
assert.match(appBackButtonSource, /<button[\s\S]*type="button"[\s\S]*aria-label="Volver"[\s\S]*onClick=\{onBack\}/);
assert.equal((appBackButtonSource.match(/onClick=\{onBack\}/g) ?? []).length, 1);
assert.doesNotMatch(appBackButtonSource, /onKeyDown|onKeyUp|onKeyPress/, "el button nativo posee la activacion de teclado");
assert.match(appBackButtonSource, /<svg[\s\S]*width="24"[\s\S]*height="24"[\s\S]*viewBox="0 0 24 24"/);
for (const svgAttribute of [
  /fill="none"/,
  /stroke="currentColor"/,
  /strokeWidth=\{2\}/,
  /strokeLinecap="round"/,
  /strokeLinejoin="round"/,
  /aria-hidden="true"/,
]) {
  assert.match(appBackButtonSource, svgAttribute);
}
assert.equal((appBackButtonSource.match(/<path\b/g) ?? []).length, 4, "el icono oficial conserva cuatro paths");
for (const pathContract of [
  /<path stroke="none" d="M0 0h24v24H0z" fill="none" \/>/,
  /<path d="M5 12h6m3 0h1\.5m3 0h\.5" \/>/,
  /<path d="M5 12l4 4" \/>/,
  /<path d="M5 12l4 -4" \/>/,
]) {
  assert.match(appBackButtonSource, pathContract);
}
assert.match(appBackButtonStyles, /min-width: 44px;/);
assert.match(appBackButtonStyles, /min-height: 44px;/);
assert.match(appBackButtonStyles, /\.button:focus-visible/);
assert.doesNotMatch(appBackButtonSource, /dangerouslySetInnerHTML|history\.back|ChevronLeft/);
assert.doesNotMatch(components.screenHeader, /ChevronLeft|history\.back|<svg/);
assert.doesNotMatch(packageSource, /@tabler\/icons-react/);
assert.doesNotMatch(productTsxSource, /history\.back\s*\(/, "ninguna pantalla productiva suplanta el controller con history.back()");
assert.equal(
  (productTsxSource.match(/d="M5 12h6m3 0h1\.5m3 0h\.5"/g) ?? []).length,
  1,
  "el trazado canonico no debe duplicarse en features",
);
assert.equal(
  (productTsxSource.match(/aria-label="Volver"/g) ?? []).length,
  1,
  "el nombre Back visible pertenece al componente canonico",
);

interface CanonicalBackAuditSources {
  appBackButton: string;
  appBackButtonStyles: string;
  screenHeader: string;
  authScreen: string;
  otherProductComponents: string;
}

const forbiddenBackIconNames = new Set([
  "ChevronLeft",
  "ArrowLeft",
  "MoveLeft",
  "CornerUpLeft",
]);
const forbiddenBackCallbackNames = new Set([
  "onBack",
  "goBack",
  "handleBack",
  "navigateBack",
]);
const alternateBackText = /\b(?:Volver|Atrás|Atras|Regresar)\b/i;

function parseTsx(path: string, source: string) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function jsxTagName(node: ts.JsxOpeningLikeElement, sourceFile: ts.SourceFile) {
  return node.tagName.getText(sourceFile);
}

function findJsxAttribute(node: ts.JsxOpeningLikeElement, name: string) {
  return node.attributes.properties.find((property): property is ts.JsxAttribute => (
    ts.isJsxAttribute(property) && property.name.getText() === name
  ));
}

function readStaticJsxAttribute(attribute: ts.JsxAttribute | undefined): string | null {
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  const expression = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
  return expression && ts.isStringLiteralLike(expression) ? expression.text : null;
}

function containsIdentifier(node: ts.Node, names: ReadonlySet<string>) {
  let found = false;
  function visit(current: ts.Node) {
    if (ts.isIdentifier(current) && names.has(current.text)) found = true;
    if (!found) ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function assertNoDivergentBackVisuals(path: string, source: string) {
  const sourceFile = parseTsx(path, source);

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const specifier of node.importClause.namedBindings.elements) {
        const importedName = specifier.propertyName?.text ?? specifier.name.text;
        assert.ok(
          !forbiddenBackIconNames.has(importedName) && !forbiddenBackIconNames.has(specifier.name.text),
          `${path}: import visual Back prohibido (${specifier.getText(sourceFile)})`,
        );
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = jsxTagName(node, sourceFile);
      assert.ok(!forbiddenBackIconNames.has(tagName), `${path}: elemento visual Back prohibido <${tagName}>`);

      const ariaLabel = readStaticJsxAttribute(findJsxAttribute(node, "aria-label"));
      assert.ok(!ariaLabel || !alternateBackText.test(ariaLabel), `${path}: aria-label Back fuera del owner canónico`);

      if (tagName === "button") {
        const onClick = findJsxAttribute(node, "onClick");
        const callbackExpression = onClick?.initializer && ts.isJsxExpression(onClick.initializer)
          ? onClick.initializer.expression
          : undefined;
        assert.ok(
          !callbackExpression || !containsIdentifier(callbackExpression, forbiddenBackCallbackNames),
          `${path}: callback Back conectado a un button alternativo`,
        );
      }
    }

    if (ts.isJsxText(node) && node.text.trim()) {
      assert.doesNotMatch(node.text, alternateBackText, `${path}: texto JSX Back alternativo`);
    }
    if (
      ts.isStringLiteralLike(node) &&
      ts.isJsxExpression(node.parent) &&
      alternateBackText.test(node.text)
    ) {
      assert.fail(`${path}: texto JSX Back alternativo`);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression.getText(sourceFile);
      const method = node.expression.name.text;
      assert.ok(
        method !== "back" || !/(?:^|\.)(?:history|router)$/.test(owner),
        `${path}: navegación Back implícita mediante ${owner}.back()`,
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function findNamedFunction(sourceFile: ts.SourceFile, name: string) {
  const matches: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(matches.length, 1, `${name}: se esperaba una función inequívoca`);
  return matches[0];
}

function assertAuthBackAndKeyboard(source: string) {
  const sourceFile = parseTsx("src/features/auth/components/auth-screen.tsx", source);
  const appBackImports = sourceFile.statements.filter((statement): statement is ts.ImportDeclaration => (
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === "@/ui/navigation/app-back-button"
  ));
  assert.equal(appBackImports.length, 1, "AUTH importa AppBackButton desde el owner canónico");
  assert.match(appBackImports[0].getText(sourceFile), /import \{ AppBackButton \}/);

  const recovery = findNamedFunction(sourceFile, "PasswordRecoveryScreen");
  const recoveryBackButtons: ts.JsxSelfClosingElement[] = [];
  function visitRecovery(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && jsxTagName(node, sourceFile) === "AppBackButton") {
      recoveryBackButtons.push(node);
    }
    ts.forEachChild(node, visitRecovery);
  }
  visitRecovery(recovery);
  assert.equal(recoveryBackButtons.length, 1, "recuperación consume exactamente un AppBackButton");
  assert.equal(recoveryBackButtons[0].attributes.properties.length, 1, "AUTH conecta sólo el callback contextual");
  const onBack = findJsxAttribute(recoveryBackButtons[0], "onBack");
  assert.ok(onBack?.initializer && ts.isJsxExpression(onBack.initializer));
  assert.ok(onBack.initializer.expression && ts.isIdentifier(onBack.initializer.expression));
  assert.equal(onBack.initializer.expression.text, "onBack", "recuperación conserva el callback onBack");

  const allAuthBackButtons: ts.JsxSelfClosingElement[] = [];
  function visitAuth(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && jsxTagName(node, sourceFile) === "AppBackButton") {
      allAuthBackButtons.push(node);
    }
    ts.forEachChild(node, visitAuth);
  }
  visitAuth(sourceFile);
  assert.equal(allAuthBackButtons.length, 1, "AUTH no duplica la acción Back canónica");
  assert.doesNotMatch(source, />\s*Volver a iniciar sesión\s*</i);

  const handleTabKeyDown = findNamedFunction(sourceFile, "handleTabKeyDown");
  const handleSource = handleTabKeyDown.getText(sourceFile);
  const arrowKeys: string[] = [];
  function visitHandle(node: ts.Node) {
    if (ts.isStringLiteral(node) && (node.text === "ArrowLeft" || node.text === "ArrowRight")) {
      arrowKeys.push(node.text);
    }
    ts.forEachChild(node, visitHandle);
  }
  visitHandle(handleTabKeyDown);
  assert.deepEqual(arrowKeys, ["ArrowLeft", "ArrowRight"], "el selector conserva ambas teclas direccionales");
  assert.match(handleSource, /if \(event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"\) return;/);
  assert.equal((handleSource.match(/event\.preventDefault\(\);/g) ?? []).length, 1);
  assert.match(handleSource, /selectAccountType\(nextAccountType\);/);
  assert.match(handleSource, /\(nextAccountType === "usuario" \? userTabRef : coachTabRef\)\.current\?\.focus\(\);/);

  const selectAccountType = findNamedFunction(sourceFile, "selectAccountType").getText(sourceFile);
  assert.match(selectAccountType, /onAccountTypeChange\(nextAccountType\);/);
}

function readExactCssRuleBody(source: string, selector: string) {
  const marker = `${selector} {`;
  const selectorIndex = source.indexOf(marker);
  assert.ok(selectorIndex >= 0, `falta la regla CSS exacta ${selector}`);
  const openingBraceIndex = source.indexOf("{", selectorIndex + selector.length);
  let depth = 0;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBraceIndex + 1, index);
  }

  assert.fail(`regla CSS sin cierre para ${selector}`);
}

function assertCanonicalBackAuditContracts(sources: CanonicalBackAuditSources) {
  // AppScreenHeader delega toda la UI a una única instancia canónica: no puede añadir texto,
  // botón, SVG ni icono alternativo alrededor de ella.
  assert.equal((sources.screenHeader.match(/<AppBackButton\b/g) ?? []).length, 1);
  assert.match(
    sources.screenHeader,
    /return \(\s*<div className="section-back-row">\s*<AppBackButton onBack=\{onBack\} \/>\s*<\/div>\s*\);/,
  );
  assertAuthBackAndKeyboard(sources.authScreen);
  assertNoDivergentBackVisuals("src/features/app-shell/components/app-screen-header.tsx", sources.screenHeader);
  assertNoDivergentBackVisuals("src/features/auth/components/auth-screen.tsx", sources.authScreen);
  assertNoDivergentBackVisuals("resto de superficies productivas", sources.otherProductComponents);

  assert.match(sources.appBackButton, /aria-label="Volver"/);
  assert.equal((sources.appBackButton.match(/onClick=\{onBack\}/g) ?? []).length, 1);
  assert.equal((sources.appBackButton.match(/<path\b/g) ?? []).length, 4);
  assert.doesNotMatch(sources.appBackButton, /history\.back|dangerouslySetInnerHTML|ChevronLeft/);
  assert.equal(
    ([sources.appBackButton, sources.screenHeader, sources.authScreen, sources.otherProductComponents]
      .join("\n")
      .match(/d="M5 12h6m3 0h1\.5m3 0h\.5"/g) ?? []).length,
    1,
    "el SVG canónico tiene una única implementación productiva",
  );

  const buttonRule = readExactCssRuleBody(sources.appBackButtonStyles, ".button");
  for (const targetDeclaration of [
    /width: 44px;/,
    /min-width: 44px;/,
    /height: 44px;/,
    /min-height: 44px;/,
  ]) {
    assert.match(buttonRule, targetDeclaration);
  }
  assert.doesNotMatch(
    sources.appBackButtonStyles,
    /transform\s*:[^;]*(?:scale|matrix)|\bscale\s*:|\bzoom\s*:/i,
    "ningún estado puede reducir visualmente el target táctil 44x44",
  );
  assert.doesNotMatch(sources.appBackButtonStyles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
}

function replaceBackAuditOnce(source: string, search: string, replacement: string) {
  assert.equal(source.split(search).length - 1, 1, `marcador de probe ambiguo: ${search}`);
  return source.replace(search, replacement);
}

const canonicalBackAuditSources: CanonicalBackAuditSources = {
  appBackButton: appBackButtonSource,
  appBackButtonStyles,
  screenHeader: components.screenHeader,
  authScreen: authScreenSource,
  otherProductComponents: productTsxFiles
    .filter((file) => ![
      "src/features/app-shell/components/app-screen-header.tsx",
      "src/features/auth/components/auth-screen.tsx",
      "src/ui/navigation/app-back-button.tsx",
    ].includes(file.path))
    .map((file) => file.source)
    .join("\n"),
};
assert.doesNotThrow(
  () => assertCanonicalBackAuditContracts(canonicalBackAuditSources),
  "los literales ArrowLeft/ArrowRight de teclado no son iconos Back",
);

const canonicalBackMutationProbes: Array<{
  name: string;
  target: keyof CanonicalBackAuditSources;
  mutate(source: string): string;
}> = [
  {
    name: "agregar botón textual Back divergente",
    target: "otherProductComponents",
    mutate: (source) => `${source}\nfunction DivergentBack({ onBack }: { onBack: () => void }) { return <button onClick={onBack}>Regresar</button>; }\n`,
  },
  {
    name: "agregar icono visual ArrowLeft",
    target: "otherProductComponents",
    mutate: (source) => `${source}\nfunction DivergentBackIcon() { return <ArrowLeft />; }\n`,
  },
  {
    name: "eliminar AppBackButton de recuperación AUTH",
    target: "authScreen",
    mutate: (source) => replaceBackAuditOnce(
      source,
      "        <AppBackButton onBack={onBack} />",
      "        <span />",
    ),
  },
  {
    name: "eliminar navegación ArrowLeft/ArrowRight del selector AUTH",
    target: "authScreen",
    mutate: (source) => replaceBackAuditOnce(
      source,
      '    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;',
      '    if (event.key !== "Enter") return;',
    ),
  },
  {
    name: "reducir target táctil mediante transform",
    target: "appBackButtonStyles",
    mutate: (source) => replaceBackAuditOnce(
      source,
      "  place-items: center;",
      "  place-items: center;\n  transform: scale(0.5);",
    ),
  },
];

for (const probe of canonicalBackMutationProbes) {
  const original = canonicalBackAuditSources[probe.target];
  const mutated = probe.mutate(original);
  assert.notEqual(mutated, original, `probe sin mutación efectiva: ${probe.name}`);
  assert.throws(
    () => assertCanonicalBackAuditContracts({
      ...canonicalBackAuditSources,
      [probe.target]: mutated,
    }),
    `el contrato debe matar la mutación: ${probe.name}`,
  );
}

console.log(
  `TRAIN-UI-01 canonical Back mutation probes passed (${canonicalBackMutationProbes.length}): ${canonicalBackMutationProbes.map((probe) => probe.name).join(" | ")}`,
);

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
