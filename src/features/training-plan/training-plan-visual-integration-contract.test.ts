import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

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
const routineBuilderControllerSource = readSource(
  "src/features/routine-builder/hooks/useRoutineBuilderController.ts",
);
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
assert.match(files.cycleManagement, /<Card wide className="cycle-management-card">/);
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
assert.match(
  routineBuilderControllerSource,
  /const result = applyTrainingPlanEdit\(\s*\{ plan: currentPlan, activeDay: currentBuilderState\.activeDay \},\s*edit,\s*\);/,
  "el controller feature-local aplica el edit canónico contra su estado vigente",
);
assert.doesNotMatch(
  appSource,
  /\bapplyTrainingPlanEdit\(/,
  "el composition root no debe reimplementar reglas de edición del plan",
);
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

// P3-48A + P3-50B0 (COMPROBACIONES ESTATICAS / SOURCE-BASED sobre la fuente PRODUCTIVA).
// IMPORTANTE: verifican que el CODIGO DECLARA cada garantia; NO ejecutan foco, teclado ni DOM. El
// comportamiento en runtime (foco real, orden de listeners, aislamiento efectivo del evento) NO se
// ejecuta en esta suite y requiere QA manual en navegador — ver informe.
//
// P3-50B0: el motor de ownership/foco/teclado se extrajo a `useOverlayFocusManagement`. Las
// garantias se verifican ahora sobre esa fuente unica; `ModalShell` solo debe delegar.
const modalShellSource = readSource("src/ui/modals/modal-shell.tsx");
const confirmDialogSource = readSource("src/ui/modals/confirm-dialog.tsx");
const overlayFocusSource = readSource("src/ui/overlays/use-overlay-focus-management.ts");
const modalShellCode = modalShellSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const overlayFocusCode = overlayFocusSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
assert.equal((modalShellSource.match(/^export function ModalShell\b/gm) ?? []).length, 1, "una sola definicion de ModalShell");
assert.equal((confirmDialogSource.match(/^export function ConfirmDialog\b/gm) ?? []).length, 1, "una sola definicion de ConfirmDialog");
assert.equal(
  (overlayFocusSource.match(/^export function useOverlayFocusManagement\b/gm) ?? []).length,
  1,
  "una sola definicion del motor compartido",
);

// API publica y markup de ModalShell intactos.
assert.match(modalShellSource, /role="dialog" aria-modal="true" aria-label=\{ariaLabel\}/);
assert.match(modalShellSource, /className=\{cardClassName\} tabIndex=\{-1\}/);
assert.match(modalShellSource, /ariaLabel: string;/);
assert.match(modalShellSource, /onClose: \(\) => void;/);
assert.match(modalShellSource, /canClose\?: boolean;/);
assert.match(modalShellSource, /cardClassName: string;/);
assert.match(modalShellSource, /children: ReactNode;/);
// Marcador anterior compatible: mismo valor de atributo, re-exportado desde el motor.
assert.match(modalShellSource, /export const MODAL_INITIAL_FOCUS_ATTRIBUTE = OVERLAY_INITIAL_FOCUS_ATTRIBUTE;/);
assert.match(overlayFocusSource, /export const OVERLAY_INITIAL_FOCUS_ATTRIBUTE = "data-modal-initial-focus";/);
// ModalShell DELEGA: usa el hook y no conserva implementacion duplicada.
assert.match(modalShellSource, /import \{\s*OVERLAY_INITIAL_FOCUS_ATTRIBUTE,\s*useOverlayFocusManagement,\s*\} from "@\/ui\/overlays\/use-overlay-focus-management";/);
assert.match(modalShellCode, /useOverlayFocusManagement<HTMLDivElement>\(\{ isActive: true, onClose, canClose \}\)/);
for (const duplicated of [
  /activeModalOwners|activeOverlayOwners/,
  /addEventListener|removeEventListener/,
  /FOCUSABLE_SELECTOR|querySelectorAll/,
  /\buseEffect\b/,
  /document\.activeElement/,
  /isConnected/,
]) {
  assert.doesNotMatch(modalShellCode, duplicated, `ModalShell no debe conservar copia local de ${duplicated}`);
}

// (1) UN SOLO stack productivo, en el motor compartido; solo el owner superior procesa Tab/Escape.
assert.match(overlayFocusCode, /const activeOverlayOwners: OverlayFocusOwner\[\] = \[\];/);
assert.match(overlayFocusCode, /function isTopOverlayOwner\(owner: OverlayFocusOwner\): boolean/);
assert.match(overlayFocusCode, /if \(!isTopOverlayOwner\(owner\)\) return;/);
// (2) Alta idempotente por identidad y baja por identidad exacta (Strict Mode y orden imperfecto).
assert.match(overlayFocusCode, /const ownerRef = useRef<OverlayFocusOwner>\(\{\}\);/);
assert.match(overlayFocusCode, /if \(!activeOverlayOwners\.includes\(owner\)\) activeOverlayOwners\.push\(owner\);/);
assert.match(overlayFocusCode, /const ownerIndex = activeOverlayOwners\.indexOf\(owner\);/);
assert.match(overlayFocusCode, /if \(ownerIndex !== -1\) activeOverlayOwners\.splice\(ownerIndex, 1\);/);
assert.doesNotMatch(overlayFocusCode, /Math\.random|Date\.now|globalThis\.|crypto\./, "sin ids globales predecibles ni contador");
// (3) Listener en fase CAPTURE, alta y baja simetricas.
assert.match(overlayFocusCode, /document\.addEventListener\("keydown", handleKeyDown, true\);/);
assert.match(overlayFocusCode, /document\.removeEventListener\("keydown", handleKeyDown, true\);/);
// (11) Sin listeners acumulados: exactamente un alta y una baja en todo el modulo.
assert.equal((overlayFocusCode.match(/addEventListener\(/g) ?? []).length, 1, "un unico addEventListener");
assert.equal((overlayFocusCode.match(/removeEventListener\(/g) ?? []).length, 1, "un unico removeEventListener");
// (4)(5) Escape aislado SIEMPRE (pueda cerrar o no) y solo despues se decide el cierre.
assert.match(overlayFocusCode, /event\.preventDefault\(\);\s*\n\s*event\.stopImmediatePropagation\(\);\s*\n\s*if \(!canCloseRef\.current\) return;\s*\n\s*onCloseRef\.current\(\);/);
// (6) Callback y canClose vigentes mediante refs: el listener no se re-registra al cambiarlos.
assert.match(overlayFocusCode, /const onCloseRef = useRef\(onClose\);/);
assert.match(overlayFocusCode, /const canCloseRef = useRef\(canClose\);/);
assert.match(overlayFocusCode, /onCloseRef\.current = onClose;/);
assert.match(overlayFocusCode, /canCloseRef\.current = canClose;/);
assert.doesNotMatch(overlayFocusCode, /\}, \[canClose, onClose\]\);/, "el listener no debe depender de onClose/canClose");
// (7) Recuperacion inmediata del foco en la transicion hacia busy, sin robarlo si sigue siendo valido.
assert.match(overlayFocusCode, /const previousCanCloseRef = useRef\(canClose\);/);
assert.match(overlayFocusCode, /if \(canClose \|\| wasClosable === false\) return;/);
assert.match(overlayFocusCode, /if \(focusIsStillUsable\) return;/);
assert.match(overlayFocusCode, /containerNode\.focus\(\);\s*\n\s*\}, \[canClose, isActive\]\);/);
// (8) Selector: tipos exigidos + exclusion de hidden/aria-hidden, incluyendo ancestros.
for (const focusableSelector of [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
]) {
  assert.ok(overlayFocusSource.includes(focusableSelector), `el focus trap debe cubrir ${focusableSelector}`);
}
assert.match(overlayFocusCode, /:not\(\[hidden\]\):not\(\[aria-hidden="true"\]\)/, "excluye hidden y aria-hidden");
assert.match(overlayFocusCode, /element\.closest\('\[hidden\], \[aria-hidden="true"\]'\)/, "considera ancestros ocultos");
assert.match(overlayFocusCode, /checkVisibility/, "usa checkVisibility cuando existe");
assert.doesNotMatch(overlayFocusCode, /offsetParent/, "no debe usar offsetParent: romperia position: fixed");
// (9) Restauracion solo si el elemento sigue conectado, sin fallback artificial sobre body.
assert.match(overlayFocusCode, /previous instanceof HTMLElement && previous\.isConnected\) previous\.focus\(\);/);
assert.doesNotMatch(overlayFocusCode, /document\.body\.focus/, "sin fallback artificial sobre body");
// Foco inicial: marcado explicito -> primer control habilitado -> contenedor.
assert.match(overlayFocusCode, /getFocusableElements\(containerNode\)\[0\]\s*\n?\s*\?\? containerNode/);
// Focus trap en ambos sentidos.
assert.match(overlayFocusCode, /if \(event\.key !== "Tab"\) return;/);
assert.match(overlayFocusCode, /if \(event\.shiftKey\)/);
// (10) Sin cierre por backdrop, sin scroll lock, sin navegacion ni efectos globales prohibidos.
assert.doesNotMatch(modalShellCode, /onClick/, "el backdrop no debe cerrar al pulsarlo");
assert.doesNotMatch(overlayFocusCode, /onClick/);
for (const forbidden of [/document\.body/, /dangerouslySetInnerHTML/, /overflow/, /@\/lib\/navigation\//, /@\/lib\/(?:storage|supabase|data)\//, /-repository/]) {
  assert.doesNotMatch(overlayFocusCode, forbidden, `el motor no debe incorporar ${forbidden}`);
  assert.doesNotMatch(modalShellCode, forbidden, `ModalShell no debe incorporar ${forbidden}`);
}
// Lista exacta de consumidores productivos del unico motor compartido.
const overlayEngineConsumers: string[] = [];
(function collectOverlayEngineConsumers(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      collectOverlayEngineConsumers(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    if (entryPath === "src/ui/overlays/use-overlay-focus-management.ts") continue;
    if (entryPath.endsWith(".test.ts")) continue;
    if (readFileSync(entryPath, "utf8").includes("@/ui/overlays/use-overlay-focus-management")) {
      overlayEngineConsumers.push(entryPath);
    }
  }
})("src");
// P3-50B1 conecto Drawer y NotificationPanel; P3-50B2 conecta ProfileAvatarEditor; AUTH-COACH-01
// conecta el drawer Coach y UI-NAV-01 conecta el drawer Usuario nuevo. La garantía sigue siendo una
// lista EXACTA (no un "al menos"): un séptimo consumidor inesperado debe hacer fallar este contrato.
// Se ordena para que el resultado no dependa
// del recorrido del directorio.
assert.deepEqual(
  overlayEngineConsumers.sort(),
  [
    "src/components/profile/ProfileAvatarEditor.tsx",
    "src/features/app-shell/components/app-navigation-drawer.tsx",
    "src/features/coach-portal/components/coach-portal.tsx",
    "src/features/notifications/components/NotificationPanel.tsx",
    "src/features/user-portal-shell/components/user-portal-shell.tsx",
    "src/ui/modals/modal-shell.tsx",
  ],
  "los consumidores son exactamente ProfileAvatarEditor, ModalShell, los tres Drawer y NotificationPanel",
);

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

// -------------------------------------------------------------------------------------------
// P3-49B — Card compartida, slice aislado de Training Plan.
//
// CONTRATO ESTATICO / SOURCE-BASED: protege la API y la integracion declaradas en la fuente. NO
// monta React ni sustituye el QA visual del DOM renderizado en navegador.
// -------------------------------------------------------------------------------------------
function stripCardScanComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const cardSource = readSource("src/ui/layout/card.tsx");
const cardCode = stripCardScanComments(cardSource);
const cardConsumerCode = {
  cycleManagement: stripCardScanComments(files.cycleManagement),
  planBlocker: stripCardScanComments(files.planBlocker),
};

// Una sola definicion productiva, import type unico y API exacta.
assert.equal((cardCode.match(/^export function Card\b/gm) ?? []).length, 1, "una sola definicion de Card");
assert.match(cardCode, /^import type \{ ReactNode \} from "react";/m);
assert.equal((cardCode.match(/^import /gm) ?? []).length, 1, "Card solo importa ReactNode como type");
assert.match(
  cardCode,
  /export interface CardProps \{\s*wide\?: boolean;\s*className\?: string;\s*children: ReactNode;\s*\}/,
  "API exacta de CardProps",
);

// Raiz div fija y composicion determinista: card -> wide -> clase de feature.
assert.match(
  cardCode,
  /const composedClassName = `card\$\{wide \? " wide" : ""\}\$\{className \? ` \$\{className\}` : ""\}`;/,
);
assert.match(cardCode, /return <div className=\{composedClassName\}>\{children\}<\/div>;/, "raiz div fija");

// Sin API universal, eventos, polimorfismo, hooks ni dependencias de negocio/plataforma.
for (const forbidden of [
  /HTMLAttributes/,
  /\{\.\.\./,
  /\bas\??:/,
  /\bvariant\b/,
  /\brole\b/,
  /\bonClick\b/,
  /\btabIndex\b/,
  /\bref\b/,
  /forwardRef/,
  /\buse(?:State|Effect|Ref|Memo|Callback|Reducer|Context)\b/,
  /\bwindow\b|\bdocument\b|\blocalStorage\b|\bsessionStorage\b/,
  /dangerouslySetInnerHTML/,
  /@\/features\//,
  /@\/lib\//,
  /repository|Supabase|supabase|storage/,
]) {
  assert.doesNotMatch(cardCode, forbidden, `Card no debe incorporar ${forbidden}`);
}

// Consumidores productivos exactos: dos archivos y tres instancias, todas wide.
const cardConsumers: string[] = [];
const cardInstances: string[] = [];
(function collectCardConsumers(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      collectCardConsumers(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) continue;
    if (entryPath.endsWith(".test.ts") || entryPath === "src/ui/layout/card.tsx") continue;
    const source = stripCardScanComments(readSource(entryPath));
    if (source.includes("@/ui/layout/card")) cardConsumers.push(entryPath);
    if (/<Card\b/.test(source)) cardInstances.push(...Array.from(source.matchAll(/<Card\b/g), () => entryPath));
  }
})("src");
assert.deepEqual(
  cardConsumers.sort(),
  [
    "src/features/training-plan/components/CycleManagementScreen.tsx",
    "src/features/training-plan/components/CycleScopedPlanBlocker.tsx",
  ],
  "Card tiene exactamente los dos consumidores autorizados",
);
assert.equal(cardInstances.length, 3, "Card tiene exactamente tres instancias productivas");
assert.equal((cardConsumerCode.cycleManagement.match(/<Card wide\b/g) ?? []).length, 2);
assert.equal((cardConsumerCode.planBlocker.match(/<Card wide\b/g) ?? []).length, 1);
assert.equal(
  (cardConsumerCode.cycleManagement.match(/className="cycle-management-card"/g) ?? []).length
    + (cardConsumerCode.planBlocker.match(/className="cycle-management-card"/g) ?? []).length,
  2,
  "cycle-management-card se usa dos veces",
);
assert.equal((cardConsumerCode.cycleManagement.match(/className="new-cycle-card"/g) ?? []).length, 1);

// Los wrappers inline desaparecen y el contenido interno permanece literal, en el mismo orden.
for (const source of [cardConsumerCode.cycleManagement, cardConsumerCode.planBlocker]) {
  assert.doesNotMatch(source, /<div className="card wide (?:cycle-management-card|new-cycle-card)">/);
  assert.match(source, /import \{ Card \} from "@\/ui\/layout\/card";/);
}
assert.ok(files.cycleManagement.includes(`      <Card wide className="cycle-management-card">
        <p className="eyebrow">Ciclo activo</p>
        <h2>{activeCycleName ?? \`Ciclo \${cycleNumber}\`} - {cycleTitle}</h2>
        <p className="eyebrow">{getCycleDurationLabel(trainingPlan)} - {activeDays.length} dias - {targetSummary.exerciseCount} ejercicios</p>
        <div className="cycle-summary-line">
          <div><span>Volumen registrado</span><strong>{formatKg(summary.volumeTotal)}</strong></div>
          <div><span>Reps registradas</span><strong>{summary.totalReps}</strong></div>
          <div><span>Semanas</span><strong>{weeksRegistered}</strong></div>
        </div>
        <div className="cycle-management-actions">
          <button className="button secondary" type="button" onClick={editCurrentCycle}>
            <Pencil size={16} />
            Modificar ciclo actual
          </button>
          <button className="button danger-solid" type="button" onClick={requestDeleteCycle}>
            <Trash2 size={16} />
            Eliminar ciclo
          </button>
        </div>
      </Card>`), "contenido de ciclo activo preservado");
assert.ok(files.cycleManagement.includes(`      <Card wide className="new-cycle-card">
        <p className="eyebrow">Crear nuevo ciclo de entrenamiento</p>
        <h3>Finalizaremos tu ciclo actual y guardaremos su resumen en Historial ciclo de entrenamiento para que puedas revisarlo cuando quieras.</h3>
        <button className="start-button compact" type="button" onClick={requestNewCycle}>
          Crear nuevo ciclo de entrenamiento
        </button>
      </Card>`), "contenido de nuevo ciclo preservado");
assert.ok(files.planBlocker.includes(`      <Card wide className="cycle-management-card">
        <p className="eyebrow">Plan cycle-scoped</p>
        <h2>Plan operativo no disponible</h2>
        <p>{message}</p>
      </Card>`), "contenido y mensaje del blocker preservados");

// Root, Active Workout y Dashboard permanecen fuera de alcance.
assert.doesNotMatch(stripCardScanComments(appSource), /@\/ui\/layout\/card/, "el root no adopta Card");
for (const [label, directory] of [
  ["Active Workout", "src/features/active-workout"],
  ["Dashboard", "src/features/dashboard"],
] as const) {
  const imports: string[] = [];
  (function collectForbiddenImports(currentDirectory: string) {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = `${currentDirectory}/${entry.name}`;
      if (entry.isDirectory()) collectForbiddenImports(entryPath);
      else if ((entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) && !entryPath.endsWith(".test.ts")) {
        if (stripCardScanComments(readSource(entryPath)).includes("@/ui/layout/card")) imports.push(entryPath);
      }
    }
  })(directory);
  assert.deepEqual(imports, [], `${label} no adopta Card`);
}

const registration = "tsx src/features/training-plan/training-plan-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("training-plan visual static integration contract tests passed");
