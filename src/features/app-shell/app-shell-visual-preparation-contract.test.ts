import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Static App Shell visual preparation contract only.
 *
 * This test does not render React, simulate navigation or execute browser
 * behavior. It verifies the prepared prop-driven markup and boundaries while
 * the production root remains deliberately unintegrated.
 */
const componentPaths = [
  "src/features/app-shell/components/app-shell-layout.tsx",
  "src/features/app-shell/components/app-menu-button.tsx",
  "src/features/app-shell/components/app-topbar.tsx",
  "src/features/app-shell/components/app-navigation-drawer.tsx",
  "src/features/app-shell/components/app-screen-header.tsx",
];
const sources = new Map(componentPaths.map((path) => [path, readFileSync(path, "utf8")]));
const featureSource = [...sources.values()].join("\n");
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");

for (const componentName of [
  "AppShellLayout",
  "AppMenuButton",
  "AppTopbar",
  "AppNavigationDrawer",
  "AppScreenHeader",
]) {
  assert.equal(
    (featureSource.match(new RegExp(`export function ${componentName}\\b`, "g")) ?? []).length,
    1,
    `${componentName} debe tener una sola definición preparada`,
  );
}

for (const forbiddenDependency of [
  "@/components/organizatech-app",
  "@/lib/data/repository",
  "@/lib/supabase/",
  "@/lib/storage/",
  "localStorage",
  "sessionStorage",
  "window.",
  "document.",
  "process.env",
  "useEffect",
  "useState",
]) {
  assert.doesNotMatch(
    featureSource,
    new RegExp(forbiddenDependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
}

const layoutSource = sources.get(componentPaths[0]) ?? "";
assert.match(
  layoutSource,
  /<main className="app-shell">\s*\{topbar\}\s*\{notificationOverlay\}\s*\{navigationOverlay\}\s*\{screenHeader\}\s*\{children\}\s*<\/main>/,
);
assert.doesNotMatch(layoutSource, /<div[^>]*>\s*\{children\}/);

const menuButtonSource = sources.get(componentPaths[1]) ?? "";
assert.match(menuButtonSource, /className=\{`icon-button menu-trigger \$\{isOpen \? "active" : ""\}`\}/);
assert.match(menuButtonSource, /aria-label="Abrir menú"/);
assert.match(menuButtonSource, /aria-expanded=\{isOpen\}/);
assert.equal(
  (menuButtonSource.match(/<span className="hamburger-line" \/>/g) ?? []).length,
  3,
  "El botón hamburger debe conservar exactamente tres spans",
);

const topbarSource = sources.get(componentPaths[2]) ?? "";
assert.match(topbarSource, /<header className=\{`topbar \$\{isHidden \? "hidden" : ""\}`\}>/);
assert.match(topbarSource, /<h1>Organizatech<\/h1>/);
assert.match(topbarSource, /className="topbar-training-meta"/);
assert.match(topbarSource, /className="notification-shell"/);
assert.match(topbarSource, /aria-label="Ver notificaciones"/);
assert.match(topbarSource, /<Bell size=\{18\} \/>/);
assert.match(topbarSource, /onMenuToggle: \(\) => void;/);
assert.match(topbarSource, /onToggleNotifications: \(\) => void;/);

const drawerSource = sources.get(componentPaths[3]) ?? "";
for (const criticalClass of [
  "menu-backdrop",
  "menu-drawer-shell",
  "menu-drawer-top",
  "drawer-close",
  "menu-drawer-body",
  "menu-panel",
  "menu-grid",
  "menu-link",
  "menu-account",
  "logout-button",
  "drawer-empty",
]) {
  assert.match(drawerSource, new RegExp(`\\b${criticalClass}\\b`));
}
assert.match(drawerSource, /role="dialog" aria-label="Menú de navegación"/);
assert.match(drawerSource, /role="menu" aria-label="Menú principal"/);
assert.equal(
  (drawerSource.match(/<span className="drawer-x-line" \/>/g) ?? []).length,
  2,
  "El cierre del drawer debe conservar sus dos spans",
);
assert.match(drawerSource, /\{profileHeader\}[\s\S]*className="menu-grid"/);
assert.match(drawerSource, /className=\{`menu-link \$\{item\.isActive \? "active" : ""\}`\}/);
assert.doesNotMatch(drawerSource, /screen\s*===/);
assert.match(drawerSource, /onClose: \(\) => void;/);
assert.match(drawerSource, /onNavigate: \(itemId: ItemId\) => void;/);
assert.match(drawerSource, /onLogout: \(\) => void;/);

const screenHeaderSource = sources.get(componentPaths[4]) ?? "";
assert.match(screenHeaderSource, /className="section-back-row"/);
assert.match(screenHeaderSource, /className="button secondary section-back-button" type="button"/);
assert.match(screenHeaderSource, /<ChevronLeft size=\{17\} \/>\s*Volver/);

assert.doesNotMatch(appSource, /@\/features\/app-shell\//);
assert.match(appSource, /<main className="app-shell">/);
assert.match(appSource, /<header className=\{`topbar \$\{isTopbarHidden \? "hidden" : ""\}`\}>/);
assert.match(appSource, /void refreshProfileAvatar\(\{ force: true, allowProfileLookup: true \}\);/);
assert.match(appSource, /<ProfileMenuHeader[\s\S]*?onAvatarImageError=\{handleProfileAvatarImageError\}/);
assert.match(appSource, /<button className="menu-backdrop" aria-label="Cerrar menú"/);
assert.doesNotMatch(packageSource, /app-shell-visual-preparation-contract\.test\.ts/);

console.log("app shell visual static preparation contract tests passed");
