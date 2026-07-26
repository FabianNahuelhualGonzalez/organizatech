import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula
 * clicks ni prueba navegador, navegación o persistencia.
 */
const appSource = readFileSync("src/components/organizatech-app.tsx", "utf8");
const packageSource = readFileSync("package.json", "utf8");
const groupSource = readFileSync("src/features/notifications/components/NotificationGroup.tsx", "utf8");
const iconsSource = readFileSync("src/features/notifications/components/NotificationIcons.tsx", "utf8");
const featureSource = `${groupSource}\n${iconsSource}`;

assert.match(appSource, /import \{ NotificationGroup \} from "@\/features\/notifications\/components\/NotificationGroup";/);
assert.match(appSource, /<NotificationGroup\b/);

for (const componentName of [
  "NotificationGroup",
  "renderNotificationIcon",
  "NotificationBackhoeIcon",
  "NotificationHeartShareIcon",
  "NotificationCoachIcon",
  "NotificationTrendingIcon",
]) {
  assert.equal(
    (featureSource.match(new RegExp(`export function ${componentName}\\b`, "g")) ?? []).length,
    1,
    `${componentName} tiene una sola definición productiva`,
  );
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

for (const source of [groupSource, iconsSource]) {
  assert.doesNotMatch(source, /from ["']@\/components\/organizatech-app["']/);
  assert.doesNotMatch(source, /from ["']@\/lib\/(?:storage|supabase)\//);
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/);
}
assert.match(groupSource, /seenNotificationRecordsById: Map<string, SeenNotificationRecord>;/);
assert.match(groupSource, /onClick=\{\(\) => onOpen\(notification\)\}/);
assert.match(groupSource, /className={`notification-item notification-\$\{notification\.kind\} \$\{isSeen \? "seen" : "new"\}`}/);
assert.match(groupSource, /buildNotificationItemStateLabel\(/);
assert.doesNotMatch(groupSource, /data-section/);
for (const iconCase of ["backhoe", "heart-share", "coach", "trending", "user-plus", "calendar-days"]) {
  assert.match(iconsSource, new RegExp(`case "${iconCase}":`));
}

const registration = "tsx src/features/notifications/notification-group-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("notification group visual static integration contract tests passed");
