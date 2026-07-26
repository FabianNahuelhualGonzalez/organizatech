import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de preparación visual (P3-06). No renderiza React, no simula clicks, no
 * prueba el DOM real, no prueba persistencia. Solo inspecciona texto fuente. No mueve
 * NotificationPanel ni scrollToNotificationSection — quedan fuera de alcance.
 */

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");

const files = {
  group: readSource("src/features/notifications/components/NotificationGroup.tsx"),
  icons: readSource("src/features/notifications/components/NotificationIcons.tsx"),
};

// Solo inspecciona las rutas literales de los import (no la prosa de los comentarios, que
// legítimamente puede citar "organizatech-app.tsx:NNNN" como referencia de procedencia).
function assertNoForbiddenImports(source: string, label: string) {
  const importPaths = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  importPaths.forEach((path) => {
    assert.doesNotMatch(path, /organizatech-app/, `${label}: import prohibido de organizatech-app.tsx (${path})`);
    assert.doesNotMatch(path, /^@\/lib\/storage/, `${label}: import prohibido de storage (${path})`);
    assert.doesNotMatch(path, /supabase/i, `${label}: import prohibido de Supabase (${path})`);
    assert.doesNotMatch(path, /-repository$/, `${label}: import prohibido de repositories (${path})`);
  });
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/, `${label} no debe acceder a window ni document`);
}

// 1-2. Componentes exportados y props principales.
assert.match(files.group, /export interface NotificationGroupProps/);
assert.match(files.group, /export function NotificationGroup\(/);
assert.match(files.group, /notifications: AppNotification\[\];/);
assert.match(files.group, /seenNotificationRecordsById: Map<string, SeenNotificationRecord>;/);
assert.match(files.group, /onOpen: \(notification: AppNotification\) => void;/);

assert.match(files.icons, /export function renderNotificationIcon\(iconKey: NotificationIconKey\)/);
assert.match(files.icons, /export function NotificationBackhoeIcon\(/);
assert.match(files.icons, /export function NotificationHeartShareIcon\(/);
assert.match(files.icons, /export function NotificationCoachIcon\(/);
assert.match(files.icons, /export function NotificationTrendingIcon\(/);
assert.match(files.icons, /case "user-plus":/);
assert.match(files.icons, /case "calendar-days":/);

// 3-4. Ausencia de imports prohibidos.
Object.entries(files).forEach(([label, source]) => assertNoForbiddenImports(source, label));

// 5. Agrupación, badges (categoria/estado), timestamp, categoría, textos, estados nuevo/historial.
assert.match(files.group, /className="notification-group" aria-label={title}/);
assert.match(files.group, /className={`notification-item notification-\$\{notification\.kind\} \$\{isSeen \? "seen" : "new"\}`}/);
assert.match(files.group, /className="notification-category"/);
assert.match(files.group, /className="notification-state"/);
assert.match(files.group, /buildNotificationItemStateLabel\(/, "el timestamp/estado se sigue derivando via el selector puro de la lib");
assert.match(files.group, /title !== "Nuevas"/, "distincion nuevo\\/historial preservada");

// Handlers preservados.
assert.match(files.group, /onClick={\(\) => onOpen\(notification\)}/);

// 7. data-section: verificado explícitamente que NO aplica a este componente — el atributo
// data-section vive únicamente en el panel contenedor (NotificationPanel), que no se mueve en
// esta fase. Se documenta la ausencia como hecho verificado, no como omisión.
assert.doesNotMatch(files.group, /data-section/, "NotificationGroup no posee data-section en el original; su ausencia aqui es fiel al original");

// Copy/textos preservados literalmente.
assert.match(files.group, /aria-hidden="true">\{renderNotificationIcon\(iconKey\)\}/);

// 8. Definiciones originales todavía presentes en el root.
assert.match(appSource, /function NotificationGroup\(/, "el original debe seguir en el root");
assert.match(appSource, /function renderNotificationIcon\(iconKey: NotificationIconKey\)/, "el original debe seguir en el root");
assert.match(appSource, /function NotificationBackhoeIcon\(/, "el original debe seguir en el root");
assert.match(appSource, /function NotificationHeartShareIcon\(/, "el original debe seguir en el root");
assert.match(appSource, /function NotificationCoachIcon\(/, "el original debe seguir en el root");
assert.match(appSource, /function NotificationTrendingIcon\(/, "el original debe seguir en el root");

// 9-10. package.json y globals.css sin cambios.
const packageJson = readSource("package.json");
assert.doesNotMatch(
  packageJson,
  /notification-group-visual-contract\.test\.ts/,
  "este test no debe estar registrado en package.json todavia (se registra en P3-07)",
);
const globalsCss = readSource("src/app/globals.css");
assert.match(globalsCss, /\.notification-group\b/, "la clase de la que depende NotificationGroup debe seguir en globals.css");
assert.match(globalsCss, /\.notification-item\b/, "la clase de la que depende NotificationGroup debe seguir en globals.css");
assert.match(globalsCss, /\.notification-copy\b/, "la clase de la que depende NotificationGroup debe seguir en globals.css");

console.log("notification group visual contract tests passed");
