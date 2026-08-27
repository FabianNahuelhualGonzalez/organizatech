import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const featureSource = read("./components/calendar-reminders-feature.tsx");
const sheetSource = read("./components/reminder-sheet.tsx");
const formSource = read("./components/reminder-form.tsx");
const controlsSource = read("./components/form-controls.tsx");
const gridSource = read("./components/calendar-grid.tsx");
const agendaSource = read("./components/monthly-agenda.tsx");
const controllerHookSource = read("./hooks/use-calendar-reminders-controller.ts");
const operationOwnerSource = read("./model/create-reminder-operation-owner.ts");
const modelSource = read("./model/reminder-form.ts");
const typesSource = read("./model/types.ts");
const cssSource = read("./calendar-reminders.module.css");
const implementationSource = [
  featureSource,
  sheetSource,
  formSource,
  controlsSource,
  modelSource,
  typesSource,
].join("\n");

test("la feature permanece desconectada y consume el back button canónico", () => {
  assert.match(
    featureSource,
    /import \{ AppBackButton \} from "@\/ui\/navigation\/app-back-button";/,
  );
  assert.match(featureSource, /<AppBackButton onBack=\{onBack\} \/>/);
  assert.doesNotMatch(implementationSource, /@supabase|supabase-js|fetch\s*\(/i);
  assert.doesNotMatch(
    implementationSource,
    /\bsupabase(?:Client)?\s*\.\s*(?:from|rpc)\s*\(/i,
  );
  assert.doesNotMatch(featureSource, /<header\b|Abrir menú|Notificaciones/);
  assert.doesNotMatch(featureSource, /<main\b/);
});

test("el contrato de escritura no expone campos de ownership", () => {
  assert.doesNotMatch(
    `${typesSource}\n${modelSource}`,
    /\b(user_id|owner_id|profile_id|userId|ownerId|profileId)\b/,
  );
  assert.match(modelSource, /const dto: CreateCalendarReminderDto = \{/);
  assert.match(modelSource, /title: state\.values\.title\.trim\(\)/);
  assert.match(modelSource, /recurrence: buildRecurrence\(state\)/);
});

test("sheet desconectado atrapa y restaura foco mientras el contenido base queda inert", () => {
  assert.match(sheetSource, /FOCUSABLE_SELECTOR/);
  assert.match(sheetSource, /event\.key === "Escape"/);
  assert.match(sheetSource, /event\.key !== "Tab"/);
  assert.match(sheetSource, /previousFocus\?\.isConnected/);
  assert.match(sheetSource, /inertTarget\.inert = true/);
  assert.match(sheetSource, /inertTarget\.inert = false/);
  assert.match(sheetSource, /role="dialog"/);
  assert.match(sheetSource, /aria-modal="true"/);
  assert.match(featureSource, /inertTargetRef=\{scrollRef\}/);
  assert.match(formSource, /aria-live="polite"/);
  assert.match(controlsSource, /role="switch"/);
  assert.match(controlsSource, /El envío requiere habilitación y configuración posterior/);
  assert.doesNotMatch(`${controlsSource}\n${modelSource}`, /Recibir notificaciones por correo|Además del aviso en la app|También por correo/);
});

test("IDs ARIA nacen de useId y cada relación usa el id de su instancia", () => {
  assert.match(featureSource, /createCalendarRemindersAriaIds\(useId\(\)\)/);
  assert.match(featureSource, /aria-labelledby=\{ariaIds\.featureTitle\}/);
  assert.match(featureSource, /id=\{ariaIds\.featureTitle\}/);
  assert.match(featureSource, /titleId=\{ariaIds\.agendaTitle\}/);
  assert.match(agendaSource, /aria-labelledby=\{titleId\}/);
  assert.match(agendaSource, /id=\{titleId\}/);
  assert.match(sheetSource, /createCalendarRemindersAriaIds\(useId\(\)\)\.sheetTitle/);
  assert.match(sheetSource, /aria-labelledby=\{titleId\}/);
  assert.match(sheetSource, /id=\{titleId\}/);
  assert.doesNotMatch(`${featureSource}\n${agendaSource}\n${sheetSource}`, /id="calendar-reminder/);
});

test("el hook conecta un owner single-flight ejecutable", () => {
  assert.match(controllerHookSource, /createReminderOperationOwner/);
  assert.match(controllerHookSource, /saveOwnerRef\.current\.run/);
  assert.match(operationOwnerSource, /if \(inFlight\) return inFlight/);
});

test("CSS conserva tokens, stacking, targets y breakpoints contractuales", () => {
  assert.match(cssSource, /--ot-canvas: #07101a;/i);
  assert.match(cssSource, /--ot-blue: #3c7aff;/i);
  assert.match(cssSource, /max-width: 430px;/);
  assert.match(cssSource, /\.dayButton \{[\s\S]*?width: 100%;[\s\S]*?min-height: var\(--ot-cell-height\);/);
  assert.match(cssSource, /\.overlay \{[\s\S]*?z-index: 10;/);
  assert.match(cssSource, /\.sheet \{[\s\S]*?z-index: 11;/);
  assert.match(cssSource, /\.toast \{[\s\S]*?z-index: 12;/);
  assert.match(cssSource, /@media \(max-width: 359px\)/);
  assert.match(cssSource, /@media \(min-width: 431px\)/);
  assert.match(cssSource, /@media \(min-width: 768px\)/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(cssSource, /font-weight:\s*800/);
  assert.match(cssSource, /\.textInput,[\s\S]*?font-size: 16px;/);
  assert.match(cssSource, /env\(safe-area-inset-top/);
  assert.match(cssSource, /env\(safe-area-inset-bottom/);
});

test("componentes preservan semántica de grilla, nombres de días y máximo tres puntos", () => {
  assert.match(gridSource, /role="grid"/);
  assert.match(gridSource, /role="row"/);
  assert.match(gridSource, /role="columnheader"/);
  assert.match(gridSource, /role="gridcell"/);
  assert.match(gridSource, /aria-pressed=\{isSelected\}/);
  assert.match(gridSource, /<abbr title=\{label\.full\}>/);
  assert.match(gridSource, /dayReminders\.slice\(0, 3\)/);
  assert.match(gridSource, /ArrowLeft/);
  assert.match(gridSource, /ArrowDown/);
  assert.match(gridSource, /tabIndex=\{getCalendarGridTabIndex\(cell\.day, focusedDay\)\}/);
  assert.match(gridSource, /onFocus=\{\(\) => setFocusedDay/);
  assert.match(gridSource, /grid\.firstColumn/);
});
