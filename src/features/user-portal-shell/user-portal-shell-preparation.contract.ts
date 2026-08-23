import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import test from "node:test";
import ts from "typescript";

const FEATURE_ROOT = resolve("src/features/user-portal-shell");
const ROOT_COMPONENT_PATH = "src/components/organizatech-app.tsx";
const MODEL_PATH = "src/features/user-portal-shell/model/user-portal-navigation.ts";
const CANDIDATE_PATH =
  "src/features/user-portal-shell/components/user-portal-shell-candidate.tsx";
const TOPBAR_PATH = "src/features/user-portal-shell/components/user-portal-topbar.tsx";
const DRAWER_PATH = "src/features/user-portal-shell/components/user-portal-drawer.tsx";
const CSS_PATH = "src/features/user-portal-shell/components/user-portal-shell.module.css";

const PRODUCTION_PATHS = [
  MODEL_PATH,
  CANDIDATE_PATH,
  TOPBAR_PATH,
  DRAWER_PATH,
  CSS_PATH,
] as const;

const PREMATURE_CONNECTION_FAILURE =
  "[UI-NAV-01.user-portal-shell.premature-product-connection]";

interface SourceEntry {
  readonly path: string;
  readonly source: string;
}

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function openingTag(source: string, marker: string, tagName: string): string {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker}: marcador disponible`);
  const startIndex = source.lastIndexOf(`<${tagName}`, markerIndex);
  const endIndex = source.indexOf(">", markerIndex);
  assert.notEqual(startIndex, -1, `${marker}: inicio disponible`);
  assert.notEqual(endIndex, -1, `${marker}: cierre disponible`);
  return source.slice(startIndex, endIndex + 1);
}

function elementBlock(source: string, marker: string, tagName: string): string {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker}: marcador disponible`);
  const startIndex = source.lastIndexOf(`<${tagName}`, markerIndex);
  const endIndex = source.indexOf(`</${tagName}>`, markerIndex);
  assert.notEqual(startIndex, -1, `${marker}: inicio disponible`);
  assert.notEqual(endIndex, -1, `${marker}: cierre disponible`);
  return source.slice(startIndex, endIndex + tagName.length + 3);
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function normalizedRelativePath(path: string): string {
  return relative(process.cwd(), path).split(sep).join("/");
}

function moduleSpecifiers(entry: SourceEntry): string[] {
  const sourceFile = ts.createSourceFile(
    entry.path,
    entry.source,
    ts.ScriptTarget.Latest,
    true,
    entry.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function findPrematureConsumers(entries: readonly SourceEntry[]): string[] {
  return entries
    .filter((entry) => moduleSpecifiers(entry).some((specifier) => (
      specifier.includes("user-portal-shell")
    )))
    .map(({ path }) => path)
    .sort();
}

function assertDisconnected(entries: readonly SourceEntry[]) {
  assert.deepEqual(
    findPrematureConsumers(entries),
    [],
    PREMATURE_CONNECTION_FAILURE,
  );
}

test("la feature productiva se limita al modelo, candidato, topbar, drawer y CSS nuevos", () => {
  const files = readdirSync(FEATURE_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .map(normalizedRelativePath)
    .sort();

  assert.deepEqual(files, [
    "src/features/user-portal-shell/components/user-portal-drawer.tsx",
    "src/features/user-portal-shell/components/user-portal-shell-candidate.tsx",
    "src/features/user-portal-shell/components/user-portal-shell.module.css",
    "src/features/user-portal-shell/components/user-portal-topbar.tsx",
    "src/features/user-portal-shell/model/user-portal-navigation.contract.ts",
    "src/features/user-portal-shell/model/user-portal-navigation.ts",
    "src/features/user-portal-shell/user-portal-shell-preparation.contract.ts",
  ]);
});

test("hamburguesa, campana, dialog, cierre y logout tienen nombres y controles accesibles", () => {
  const topbar = readSource(TOPBAR_PATH);
  const drawer = readSource(DRAWER_PATH);
  const menuButton = elementBlock(topbar, "className={styles.iconButton}", "button");
  const notificationButton = elementBlock(
    topbar,
    "className={styles.notificationButton}",
    "button",
  );
  const dialog = openingTag(drawer, "className={styles.drawer}", "div");
  const closeButton = elementBlock(drawer, "className={styles.closeButton}", "button");

  assert.match(menuButton, /type="button"/);
  assert.match(menuButton, /aria-label=\{isDrawerOpen \? "Cerrar menú Usuario" : "Abrir menú Usuario"\}/);
  assert.match(menuButton, /aria-expanded=\{isDrawerOpen\}/);
  assert.match(menuButton, /aria-controls=\{USER_PORTAL_DRAWER_ID\}/);

  assert.match(notificationButton, /type="button"/);
  assert.match(notificationButton, /aria-label=\{notifications\.accessibleLabel\}/);
  assert.match(notificationButton, /aria-expanded=\{notifications\.isPanelOpen\}/);
  assert.match(notificationButton, /onClick=\{onToggleNotifications\}/);
  assert.match(notificationButton, /<Bell[\s\S]*aria-hidden="true"/);
  assert.match(notificationButton, /className=\{styles\.notificationBadge\} aria-hidden="true"/);

  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby="user-portal-drawer-title"/);
  assert.match(dialog, /tabIndex=\{-1\}/);
  assert.match(dialog, /onKeyDown=\{handleDrawerKeyDown\}/);
  assert.match(closeButton, /aria-label="Cerrar menú Usuario"/);
  assert.match(closeButton, /autoFocus/);
  assert.match(drawer, /<nav aria-label="Navegación Usuario">/);
  assert.match(drawer, /aria-label="Cerrar sesión"/);
});

test("todos los destinos son botones habilitados, hay un aria-current único y logout no navega", () => {
  const drawer = readSource(DRAWER_PATH);
  const logoutStart = drawer.indexOf('if (item.kind === "logout")');
  const logoutEnd = drawer.indexOf("if (!isUserPortalDestination(item))", logoutStart);
  assert.notEqual(logoutStart, -1);
  assert.ok(logoutEnd > logoutStart);
  const logoutBranch = drawer.slice(logoutStart, logoutEnd);

  assert.doesNotMatch(drawer, /\bdisabled(?:=|\s|>)/);
  assert.match(drawer, /aria-current=\{navigation\.activeItemId === item\.id \? "page" : undefined\}/);
  assert.match(drawer, /onClick=\{\(\) => onNavigate\(item\.id\)\}/);
  assert.match(logoutBranch, /void onLogout\(\)/);
  assert.doesNotMatch(logoutBranch, /onNavigate|router|history|href=/);
});

test("Escape y el seam de foco quedan documentados sin copiar el gestor compartido", () => {
  const drawer = readSource(DRAWER_PATH);
  const candidate = readSource(CANDIDATE_PATH);

  assert.match(drawer, /Escape cierra exclusivamente este drawer mediante `onClose`/);
  assert.match(drawer, /event\.key !== "Escape"/);
  assert.match(drawer, /event\.preventDefault\(\)/);
  assert.match(drawer, /event\.stopPropagation\(\)/);
  assert.match(drawer, /focusBoundaryRef\?: Ref<HTMLDivElement>/);
  assert.match(drawer, /ref=\{focusBoundaryRef\}/);
  assert.match(candidate, /focusBoundaryRef=\{focusBoundaryRef\}/);
  assert.doesNotMatch(
    `${drawer}\n${candidate}`,
    /useOverlayFocusManagement|OVERLAY_INITIAL_FOCUS_ATTRIBUTE|activeOverlayOwners/,
  );
});

test("la feature no ejecuta rutas, sesión, red, Supabase, storage, stores ni writes", () => {
  const productionSource = PRODUCTION_PATHS
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .map(readSource)
    .join("\n");

  assert.doesNotMatch(productionSource, /from\s+["']next\/(?:navigation|router|link)["']/i);
  assert.doesNotMatch(productionSource, /\brouter\.|\bhistory\.|\blocation\.|history\.back/i);
  assert.doesNotMatch(
    productionSource,
    /\bfetch\s*\(|\.(?:from|rpc|insert|update|upsert|delete)\s*\(|\bsupabase\b/i,
  );
  assert.doesNotMatch(productionSource, /\b(?:localStorage|sessionStorage)\b|\bzustand\b/i);
  assert.doesNotMatch(productionSource, /useSession|useAuth|auth\.uid|service_role|owner_id|user_id/i);
  assert.doesNotMatch(productionSource, /@\/features\/coach-portal|\.\.\/coach-portal/i);
});

test("el CSS cubre estructura mobile 320/360/393/430, tokens, safe areas y movimiento reducido", () => {
  const css = readSource(CSS_PATH).toLowerCase();

  assert.match(css, /background:\s*var\(--background, #07101a\)/);
  assert.match(css, /--user-portal-panel:\s*var\(--panel, #111827\)/);
  assert.match(css, /--user-portal-primary:\s*var\(--primary, #3c7aff\)/);
  assert.match(css, /font-family:\s*inherit/);
  assert.match(css, /grid-template-columns:\s*44px minmax\(0, 1fr\) 44px/);
  assert.match(css, /width:\s*min\(90vw, 390px\)/);
  assert.match(css, /max-width:\s*100%/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /env\(safe-area-inset-top, 0px\)/);
  assert.match(css, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width: 359px\)/);
  assert.match(css, /@media \(min-width: 393px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

  for (const viewportWidth of [320, 360, 393, 430]) {
    const drawerWidth = Math.min(viewportWidth * 0.9, 390);
    assert.ok(drawerWidth <= viewportWidth, `${viewportWidth}px: drawer sin overflow horizontal`);
    assert.ok(viewportWidth - drawerWidth >= 32, `${viewportWidth}px: backdrop conserva área de cierre`);
  }
});

test("ningún archivo externo consume la feature aislada", () => {
  const externalSources = collectTypeScriptFiles(resolve("src"))
    .filter((path) => !path.startsWith(`${FEATURE_ROOT}${sep}`))
    .map((path) => ({ path: normalizedRelativePath(path), source: readSource(path) }));

  assertDisconnected(externalSources);
});

test("el contrato rechaza en memoria una conexión prematura desde el composition root", () => {
  const rootSource = readSource(ROOT_COMPONENT_PATH);
  const mutatedRoot: SourceEntry = {
    path: ROOT_COMPONENT_PATH,
    source: [
      'import { UserPortalShellCandidate } from "@/features/user-portal-shell/components/user-portal-shell-candidate";',
      rootSource,
    ].join("\n"),
  };

  assert.throws(
    () => assertDisconnected([mutatedRoot]),
    (error: unknown) => (
      error instanceof assert.AssertionError
      && error.message.includes(PREMATURE_CONNECTION_FAILURE)
    ),
  );
});
