import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula clicks
 * ni prueba persistencia o repositories.
 */
function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

const appSource = readSource("src/components/organizatech-app.tsx");
const packageSource = readSource("package.json");
const catalogSource = readSource("src/features/training-plan/model/training-cycle-presentation.ts");
const files = {
  cycleManagement: readSource("src/features/training-plan/components/CycleManagementScreen.tsx"),
  planBlocker: readSource("src/features/training-plan/components/CycleScopedPlanBlocker.tsx"),
  deleteModal: readSource("src/features/training-plan/components/ConfirmDeleteCycleModal.tsx"),
  newModal: readSource("src/features/training-plan/components/ConfirmNewCycleModal.tsx"),
  setupCard: readSource("src/features/training-plan/components/TrainingPlanSetupCard.tsx"),
};

const components = [
  ["CycleManagementScreen", "@/features/training-plan/components/CycleManagementScreen"],
  ["CycleScopedPlanBlocker", "@/features/training-plan/components/CycleScopedPlanBlocker"],
  ["ConfirmDeleteCycleModal", "@/features/training-plan/components/ConfirmDeleteCycleModal"],
  ["ConfirmNewCycleModal", "@/features/training-plan/components/ConfirmNewCycleModal"],
  ["TrainingPlanSetupCard", "@/features/training-plan/components/TrainingPlanSetupCard"],
] as const;
for (const [componentName, modulePath] of components) {
  assert.match(appSource, new RegExp(`import \\{ ${componentName} \\} from "${modulePath}";`));
  assert.match(appSource, new RegExp(`<${componentName}\\b`));
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

for (const source of Object.values(files)) {
  assert.doesNotMatch(source, /from ["']@\/components\/organizatech-app["']/);
  assert.doesNotMatch(source, /from ["']@\/lib\/(?:storage|supabase)\//);
  assert.doesNotMatch(source, /\bwindow\.\w|\bdocument\.\w/);
}

assert.match(files.cycleManagement, /from "@\/lib\/training\/training-plan-calculations"/);
assert.match(files.cycleManagement, /TRAINING_CYCLE_PRESENTATIONS/);
for (const duplicateName of [
  "getCycleObjectiveValue",
  "getCycleDurationValue",
  "getRoutineDays",
  "getActiveRoutineDays",
  "calculateTargetSummary",
]) {
  assert.doesNotMatch(files.cycleManagement, new RegExp(`^\\s*function ${duplicateName}\\b`, "m"));
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${duplicateName}\\b`, "m"));
}
assert.doesNotMatch(files.cycleManagement, /^\s*const (?:setupDays|trainingCycles)\b/m);
assert.match(catalogSource, /export const TRAINING_CYCLE_PRESENTATIONS = \[/);
assert.deepEqual(
  [...catalogSource.matchAll(/\bid: "(macro|meso|micro|session)"/g)].map((match) => match[1]),
  ["macro", "meso", "micro", "session"],
);
assert.match(files.cycleManagement, /className="card wide cycle-management-card"/);
assert.match(files.deleteModal, /ariaLabel="Eliminar ciclo actual"/);
assert.match(files.newModal, /ariaLabel="Confirmar nuevo ciclo"/);

// TrainingPlanSetupCard (P3-07C): la card de configuración de ciclo vive en el componente y el
// bloque inline fue eliminado del root. Absorbe la cobertura del contrato de preparación de gap.
assert.doesNotMatch(appSource, /className="setup-card training-cycles-card"/, "el bloque inline debe haberse eliminado del root");
assert.match(files.setupCard, /className="setup-card training-cycles-card"/);
assert.match(files.setupCard, /export interface TrainingPlanSetupCardProps/);
for (const [callback, parameter] of [
  ["onCycleTypeChange", "value"],
  ["onObjectiveChange", "value"],
  ["onDurationChange", "value"],
  ["onToggleTrainingDay", "day"],
] as const) {
  assert.match(files.setupCard, new RegExp(`${callback}: \\(${parameter}: string\\) => void`));
}
assert.match(files.setupCard, /onCycleTypeChange\(event\.target\.value\)/, "el selector emite el string crudo, sin cast");
assert.doesNotMatch(files.setupCard, /as\s+TrainingCycleId/, "el componente no debe castear al tipo de dominio");
// P3-18: el root conserva el boundary string del componente y lo entrega al controller,
// cuyo guard canónico decide si la edición de cycleType puede aplicarse.
assert.match(appSource, /function updateCycleType\(value: string\) \{\s*\n\s*updateTrainingPlan\(\{ type: "cycle_type", value \}\);/);
assert.match(appSource, /const result = applyTrainingPlanEdit\(\{ plan: current, activeDay: setupDay \}, edit\);/);
assert.match(appSource, /onCycleTypeChange=\{updateCycleType\}/);
assert.doesNotMatch(appSource, /event\.target\.value as TrainingCycleId/, "el cast inseguro quedo eliminado del flujo integrado");
// Catálogos canónicos compartidos, sin copias locales en el componente.
assert.match(files.setupCard, /import \{ TRAINING_CYCLE_PRESENTATIONS \} from "@\/features\/training-plan\/model\/training-cycle-presentation";/);
assert.match(files.setupCard, /import \{ TRAINING_DAY_LABELS \} from "@\/lib\/training\/training-day-order";/);
assert.doesNotMatch(files.setupCard, /^\s*const (?:TRAINING_CYCLE_PRESENTATIONS|TRAINING_DAY_LABELS)\b.*=\s*\[/m, "sin arrays equivalentes locales");
// Copy y estructura visual, en el orden original.
[
  "Planificación deportiva",
  "Selecciona tu ciclo de entrenamiento",
  "Ciclo de entrenamiento",
  "¿Cuál es el objetivo principal?",
  "Duración",
  "Selecciona días de entrenamiento",
].reduce((previous, copy) => {
  const copyIndex = files.setupCard.indexOf(copy);
  assert.ok(copyIndex > previous, `copy ausente o fuera de orden: ${copy}`);
  return copyIndex;
}, -1);
for (const className of ["cycle-flow-card", "cycle-select-field", "cycle-select", "cycle-description objective-description", "cycle-chip-grid days"]) {
  assert.ok(files.setupCard.includes(className), `clase visual ausente: ${className}`);
}
assert.match(files.setupCard, /plannedDays\.includes\(item\) \? "active" : ""/);
assert.match(files.setupCard, /activeDay === item \? "current" : ""/);
assert.match(files.setupCard, /configuredDays\.includes\(item\) \? "configured" : ""/);
// Pureza adicional del componente (la genérica ya corre en el loop de files).
assert.doesNotMatch(files.setupCard, /\b(?:useState|useEffect|setScreen|setScreenHistory)\b|from ["']@\/lib\/(?:data|navigation)\//, "TrainingPlanSetupCard es presentacional puro");

// P3-47A (CONTRATO ESTATICO — no sustituye cobertura runtime): los dos modales de confirmacion
// consumen la primitive compartida de boton y ya no declaran <button> propios, conservando
// variantes, textos, tipos, disabled y callbacks.
const buttonPrimitiveSource = readSource("src/ui/buttons/button.tsx");
assert.equal(
  (buttonPrimitiveSource.match(/^export function Button\b/gm) ?? []).length,
  1,
  "existe una sola definicion productiva de la primitive Button",
);
// P3-48A: las acciones ya no se declaran inline; las compone ConfirmDialog sobre Button. Se
// verifica que cada modal delegue en el dialogo compartido conservando variantes, textos, textos
// busy y politica de busy.
for (const [label, modalSource] of [["deleteModal", files.deleteModal], ["newModal", files.newModal]] as const) {
  assert.match(modalSource, /import \{ ConfirmDialog \} from "@\/ui\/modals\/confirm-dialog";/, label);
  assert.doesNotMatch(modalSource, /<button\b|<Button\b/, `${label}: las acciones las aporta ConfirmDialog`);
  // Ya no reimplementan backdrop, card ni fila de acciones.
  assert.doesNotMatch(modalSource, /modal-backdrop|confirm-modal|modal-actions|role="dialog"/, `${label}: estructura delegada en ModalShell/ConfirmDialog`);
  assert.match(modalSource, /isBusy=\{isBusy\}/, `${label}: la politica de busy se propaga`);
}
assert.match(files.deleteModal, /cancelLabel="Cancelar"[\s\S]*?cancelVariant="secondary"/);
assert.match(files.deleteModal, /confirmLabel="Sí, eliminar ciclo"[\s\S]*?confirmBusyLabel="Eliminando\.\.\."[\s\S]*?confirmVariant="danger"/);
assert.match(files.deleteModal, /<p>Este ciclo dejará de estar visible[\s\S]*?<\/p>/);
assert.match(files.deleteModal, /<p>Esta acción no se puede deshacer desde la aplicación\.<\/p>/);
assert.equal((files.deleteModal.match(/<p>/g) ?? []).length, 2, "conserva exactamente los dos parrafos");
assert.match(files.newModal, /cancelLabel="No"[\s\S]*?cancelVariant="danger"/);
assert.match(files.newModal, /confirmLabel="Si"[\s\S]*?confirmBusyLabel="Finalizando\.\.\."[\s\S]*?confirmVariant="success"/);

// P3-48A (COMPROBACIONES ESTATICAS / SOURCE-BASED sobre la fuente PRODUCTIVA de las primitives).
// IMPORTANTE: verifican que el CODIGO DECLARA cada garantia; NO ejecutan foco, teclado ni DOM. El
// comportamiento en runtime (foco real, orden de listeners, aislamiento efectivo del evento) no se
// ejecuta en esta suite y requiere QA manual — ver informe.
const modalShellSource = readSource("src/ui/modals/modal-shell.tsx");
const confirmDialogSource = readSource("src/ui/modals/confirm-dialog.tsx");
const modalShellCode = modalShellSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
assert.equal((modalShellSource.match(/^export function ModalShell\b/gm) ?? []).length, 1, "una sola definicion de ModalShell");
assert.equal((confirmDialogSource.match(/^export function ConfirmDialog\b/gm) ?? []).length, 1, "una sola definicion de ConfirmDialog");
assert.match(modalShellSource, /role="dialog" aria-modal="true" aria-label=\{ariaLabel\}/);

// (1) Stack/ownership de modal activo: solo el superior procesa Tab/Escape.
assert.match(modalShellCode, /const activeModalOwners: ModalShellOwner\[\] = \[\];/);
assert.match(modalShellCode, /function isTopModalOwner\(owner: ModalShellOwner\): boolean/);
assert.match(modalShellCode, /if \(!isTopModalOwner\(owner\)\) return;/);
// (2) Alta idempotente por identidad y baja por identidad exacta (Strict Mode y orden imperfecto).
assert.match(modalShellCode, /const ownerRef = useRef<ModalShellOwner>\(\{\}\);/);
assert.match(modalShellCode, /if \(!activeModalOwners\.includes\(owner\)\) activeModalOwners\.push\(owner\);/);
assert.match(modalShellCode, /const ownerIndex = activeModalOwners\.indexOf\(owner\);/);
assert.match(modalShellCode, /if \(ownerIndex !== -1\) activeModalOwners\.splice\(ownerIndex, 1\);/);
assert.doesNotMatch(modalShellCode, /Math\.random|Date\.now|globalThis\./, "sin ids globales predecibles ni dependencias externas");
// (3) Listener en fase CAPTURE, registrado y retirado con el mismo flag.
assert.match(modalShellCode, /document\.addEventListener\("keydown", handleKeyDown, true\);/);
assert.match(modalShellCode, /document\.removeEventListener\("keydown", handleKeyDown, true\);/);
// (11) Sin listeners acumulados: exactamente un alta y una baja de keydown en todo el modulo.
assert.equal((modalShellCode.match(/addEventListener\(/g) ?? []).length, 1, "un unico addEventListener");
assert.equal((modalShellCode.match(/removeEventListener\(/g) ?? []).length, 1, "un unico removeEventListener");
// (4)(5) Escape aislado SIEMPRE (pueda cerrar o no) y solo despues se decide el cierre.
assert.match(modalShellCode, /event\.preventDefault\(\);\s*\n\s*event\.stopImmediatePropagation\(\);\s*\n\s*if \(!canCloseRef\.current\) return;\s*\n\s*onCloseRef\.current\(\);/);
// (6) Callback y canClose vigentes mediante refs: el listener no se re-registra al cambiarlos.
assert.match(modalShellCode, /const onCloseRef = useRef\(onClose\);/);
assert.match(modalShellCode, /const canCloseRef = useRef\(canClose\);/);
assert.match(modalShellCode, /onCloseRef\.current = onClose;/);
assert.match(modalShellCode, /canCloseRef\.current = canClose;/);
assert.doesNotMatch(modalShellCode, /\}, \[canClose, onClose\]\);/, "el listener no debe depender de onClose/canClose");
// (7) Recuperacion inmediata del foco en la transicion hacia busy, sin robarlo si sigue siendo valido.
assert.match(modalShellCode, /const previousCanCloseRef = useRef\(canClose\);/);
assert.match(modalShellCode, /if \(canClose \|\| wasClosable === false\) return;/);
assert.match(modalShellCode, /if \(focusIsStillUsable\) return;/);
assert.match(modalShellCode, /dialogNode\.focus\(\);\s*\n\s*\}, \[canClose\]\);/);
// (8) Selector: tipos exigidos + exclusion de hidden/aria-hidden, incluyendo ancestros.
for (const focusableSelector of [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
]) {
  assert.ok(modalShellSource.includes(focusableSelector), `el focus trap debe cubrir ${focusableSelector}`);
}
assert.match(modalShellCode, /:not\(\[hidden\]\):not\(\[aria-hidden="true"\]\)/, "excluye hidden y aria-hidden");
assert.match(modalShellCode, /element\.closest\('\[hidden\], \[aria-hidden="true"\]'\)/, "considera ancestros ocultos");
assert.match(modalShellCode, /checkVisibility/, "usa checkVisibility cuando existe");
assert.doesNotMatch(modalShellCode, /offsetParent/, "no debe usar offsetParent: romperia position: fixed");
// (9) Restauracion solo si el elemento sigue conectado, sin fallback artificial sobre body.
assert.match(modalShellCode, /previous instanceof HTMLElement && previous\.isConnected\) previous\.focus\(\);/);
assert.doesNotMatch(modalShellCode, /document\.body\.focus/, "sin fallback artificial sobre body");
// Foco inicial: marcado explicito -> primer control habilitado -> contenedor.
assert.match(modalShellCode, /getFocusableElements\(dialogNode\)\[0\]\s*\n?\s*\?\? dialogNode/);
// Focus trap en ambos sentidos.
assert.match(modalShellCode, /if \(event\.key !== "Tab"\) return;/);
assert.match(modalShellCode, /if \(event\.shiftKey\)/);
// (10) Sin cierre por backdrop y sin efectos globales prohibidos.
assert.doesNotMatch(modalShellCode, /onClick/, "el backdrop no debe cerrar al pulsarlo");
assert.doesNotMatch(modalShellCode, /document\.body|dangerouslySetInnerHTML|overflow/);
// ConfirmDialog bloquea Escape durante busy y enfoca la accion segura.
assert.match(confirmDialogSource, /canClose=\{!isBusy\}/);
assert.match(confirmDialogSource, /disabled=\{isBusy\}/);
assert.match(confirmDialogSource, /MODAL_INITIAL_FOCUS_ATTRIBUTE\]: isBusy \? undefined : ""/);
// P3-47A no adopta la primitive en el root ni en Active Workout.
assert.doesNotMatch(appSource, /from ["']@\/ui\/buttons\/button["']/, "el root no adopta la primitive en P3-47A");

// -------------------------------------------------------------------------------------------
// P3-49A — SectionHeading compartido.
//
// COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente. NO renderizan React, no montan
// el componente y no sustituyen QA manual del render real.
// -------------------------------------------------------------------------------------------
const sectionHeadingSource = readSource("src/ui/layout/section-heading.tsx");
const sectionHeadingCode = sectionHeadingSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// (1) Una sola definicion productiva.
assert.equal(
  (sectionHeadingSource.match(/^export function SectionHeading\b/gm) ?? []).length,
  1,
  "una unica definicion productiva de SectionHeading",
);
// API exacta, sin extras de configuracion.
assert.match(sectionHeadingCode, /className: string;/);
assert.match(sectionHeadingCode, /eyebrow: ReactNode;/);
assert.match(sectionHeadingCode, /title: ReactNode;/);
for (const forbiddenProp of [/\bvariant\b/, /\bheadingLevel\b/, /\baction\b/, /\bicon\b/, /\bsubtitle\b/, /\bas\?:/]) {
  assert.doesNotMatch(sectionHeadingCode, forbiddenProp, `SectionHeading no debe aceptar ${forbiddenProp}`);
}
// (6)(7) Orden eyebrow -> h3 y jerarquia h3 preservada.
assert.match(
  sectionHeadingCode,
  /<div className=\{className\}>\s*<p className="eyebrow">\{eyebrow\}<\/p>\s*<h3>\{title\}<\/h3>\s*<\/div>/,
  "markup exacto: div > p.eyebrow > h3, en ese orden",
);
// (9) Primitive sin hooks, efectos, dominio ni APIs prohibidas; solo importa ReactNode como type.
assert.match(sectionHeadingSource, /^import type \{ ReactNode \} from "react";/m);
assert.equal((sectionHeadingSource.match(/^import /gm) ?? []).length, 1, "la primitive solo importa ReactNode como type");
for (const forbidden of [
  /\buseState\b/, /\buseEffect\b/, /\buseRef\b/, /\buseMemo\b/, /\buseCallback\b/, /\buseReducer\b/,
  /dangerouslySetInnerHTML/, /\{\.\.\./, /@\/features\//, /@\/lib\/(?:storage|supabase|data|navigation)\//,
  /-repository/, /process\.env/, /className="setup-/,
]) {
  assert.doesNotMatch(sectionHeadingCode, forbidden, `SectionHeading no debe incorporar ${forbidden}`);
}

// (3)(4)(5) Consumidor de Training Plan: import canonico, clase y contenido exactos.
assert.match(files.setupCard, /import \{ SectionHeading \} from "@\/ui\/layout\/section-heading";/);
assert.match(
  files.setupCard,
  /<SectionHeading\s+className="setup-section-heading"\s+eyebrow="Planificación deportiva"\s+title="Selecciona tu ciclo de entrenamiento"\s*\/>/,
);
// (8) Sin bloque inline residual en el consumidor migrado.
assert.doesNotMatch(files.setupCard, /<div className="setup-section-heading">/, "el bloque inline debe haberse eliminado");

// (11) Active Workout permanece FUERA de alcance: conserva su bloque inline y no adopta la primitive.
const readinessScreenSource = readSource("src/features/active-workout/components/TrainingReadinessScreen.tsx");
assert.match(readinessScreenSource, /<div className="setup-section-heading">/, "Active Workout no se migra en P3-49A");
assert.doesNotMatch(readinessScreenSource, /@\/ui\/layout\/section-heading/, "Active Workout no debe importar la primitive");
assert.doesNotMatch(readinessScreenSource, /<SectionHeading/, "Active Workout no debe usar la primitive");
// El root tampoco la adopta en esta fase.
assert.doesNotMatch(appSource, /@\/ui\/layout\/section-heading/, "el root no adopta la primitive en P3-49A");

const registration = "tsx src/features/training-plan/training-plan-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("training-plan visual static integration contract tests passed");
