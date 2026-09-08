import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import * as icons from "lucide-react";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as cycleContracts from "./components/training-cycle-builder-contracts";
import * as cycleState from "./hooks/training-cycle-builder-state";
import * as videoUrl from "./hooks/training-cycle-video-url";
import { createTrainingCycleBuilderTestViewModel } from "./hooks/training-cycle-builder-fixtures.check";

const FEATURE_ROOT = "src/features/training-cycle-builder";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function filesUnder(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

const files = filesUnder(FEATURE_ROOT);
const tsSources = files.filter((path) => /\.(?:ts|tsx)$/.test(path)).map(read);
const productionFiles = files
  .filter((path) => /\.(?:ts|tsx)$/.test(path) && !/\.(?:test|check)\.tsx?$/.test(path));
const productionSources = productionFiles.map(read);
const combined = productionSources.join("\n");
const rootSource = read("src/components/organizatech-app.tsx");
const featureSource = read(`${FEATURE_ROOT}/components/training-cycle-builder.tsx`);
const productiveBoundarySource = read(`${FEATURE_ROOT}/components/training-cycle-builder-productive-boundary.tsx`);
const productControllerSource = read(`${FEATURE_ROOT}/hooks/use-training-cycle-product-controller.ts`);
const rpcGatewaySource = read(`${FEATURE_ROOT}/data/supabase-training-cycle-rpc-gateway.ts`);
const contractsSource = read(`${FEATURE_ROOT}/components/training-cycle-builder-contracts.ts`);
const controllerSource = read(`${FEATURE_ROOT}/hooks/use-training-cycle-builder-controller.ts`);
const lifecycleScreensSource = read(`${FEATURE_ROOT}/components/cycle-review-lifecycle-screens.tsx`);
const autosaveSource = read(`${FEATURE_ROOT}/hooks/training-cycle-draft-autosave.ts`);
const stateSource = read(`${FEATURE_ROOT}/hooks/training-cycle-builder-state.ts`);
const videoUrlSource = read("src/lib/training/youtube-video-url.ts");
const cssSource = read(`${FEATURE_ROOT}/components/training-cycle-builder.module.css`);
const modalShellSource = read("src/ui/modals/modal-shell.tsx");
const catalogScreenSource = read(`${FEATURE_ROOT}/components/cycle-catalog-screen.tsx`);
const catalogNoticeSource = read(`${FEATURE_ROOT}/components/cycle-catalog-addition-notice.tsx`);
const routineScreensSource = read(`${FEATURE_ROOT}/components/cycle-routine-screens.tsx`);

// Ejecuta el TSX real de esta pantalla en Node. Sólo los primitives y CSS se
// sustituyen; no es un navegador ni una prueba de layout, foco o estilos.
function loadExerciseScreen() {
  const Button = ({ children, selected, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) =>
    createElement("button", { ...props, ...(selected === undefined ? {} : { "aria-pressed": selected }) }, children);
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": jsxRuntime,
    "lucide-react": icons,
    "@/features/training-cycle-builder/components/training-cycle-builder-contracts": cycleContracts,
    "@/features/training-cycle-builder/hooks/training-cycle-builder-state": cycleState,
    "@/features/training-cycle-builder/hooks/training-cycle-video-url": videoUrl,
    "@/features/training-cycle-builder/components/training-cycle-builder.module.css": {},
    "@/features/training-cycle-builder/components/training-cycle-builder-ui": {
      PrimaryAction: Button, SecondaryAction: Button, ChoiceChip: Button,
    },
    "./cycle-catalog-screen": {},
  };
  const exports: { CycleExerciseScreen?: typeof import("./components/cycle-routine-screens").CycleExerciseScreen } = {};
  const { outputText } = transpileModule(routineScreensSource, {
    compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
  });
  runInNewContext(outputText, {
    exports,
    require: (id: string) => {
      assert.ok(Object.hasOwn(dependencies, id), `dependencia inesperada en el contrato de pantalla: ${id}`);
      return dependencies[id];
    },
  });
  assert.ok(exports.CycleExerciseScreen);
  return exports.CycleExerciseScreen;
}

function elementsIn(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elementsIn);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...elementsIn(node.props.children)];
}

test("Series lineales sólo monta el bloque común; por-series monta técnicas, filas y descensos", () => {
  const Screen = loadExerciseScreen();
  let state = cycleState.trainingCycleBuilderReducer(
    cycleState.createTrainingCycleBuilderState(createTrainingCycleBuilderTestViewModel()),
    { type: "open_exercise", exerciseId: "press-flat" },
  );
  const actions: cycleState.TrainingCycleBuilderAction[] = [];
  const dispatch = (action: cycleState.TrainingCycleBuilderAction) => {
    actions.push(action);
    state = cycleState.trainingCycleBuilderReducer(state, action);
  };
  const render = () => Screen({ state, dispatch });
  const html = () => renderToStaticMarkup(render());
  const click = (label: string) => {
    const button = elementsIn(render()).find((node) => node.props.children === label && typeof node.props.onClick === "function");
    assert.ok(button, `falta botón ${label}`);
    (button.props.onClick as () => void)();
  };
  assert.match(html(), /MISMO VALOR EN TODAS LAS SERIES/);
  assert.match(html(), /Aplicar a las 4 series/);
  assert.doesNotMatch(html(), /TÉCNICA DE ENTRENAMIENTO|Repeticiones serie|Kilogramos serie|al fallo muscular|Acciones de la serie|Agregar descenso|Duplicar serie|Eliminar serie/);
  const initialRevision = state.revision;
  click("Modificar por series");
  assert.equal(state.exerciseMode, "per_set");
  assert.equal(state.revision, initialRevision);
  assert.doesNotMatch(html(), /MISMO VALOR EN TODAS LAS SERIES|Aplicar a las/);
  assert.match(html(), /TÉCNICA DE ENTRENAMIENTO/);
  for (const technique of cycleContracts.TRAINING_CYCLE_TECHNIQUES) {
    const label = cycleContracts.TRAINING_CYCLE_TECHNIQUE_LABELS[technique];
    click(label);
    assert.equal(state.draft.routines.monday.exercises[0].technique, technique);
    assert.match(html(), /Repeticiones serie 1/);
    assert.match(html(), /Kilogramos serie 1/);
    assert.match(html(), /Serie 1 al fallo muscular/);
  }
  click(cycleContracts.TRAINING_CYCLE_TECHNIQUE_LABELS.drop_set);
  const current = state.draft.routines.monday.exercises[0];
  const index = current.sets.length;
  const expand = elementsIn(render()).find((node) => node.props["aria-label"] === `Acciones de la serie ${index}`);
  assert.ok(expand);
  (expand.props.onClick as () => void)();
  assert.match(html(), /DESCENSOS DE CARGA/);
  assert.match(html(), /Kg descenso 1/);
  assert.match(html(), /Agregar descenso/);
  assert.match(html(), /Duplicar serie/);
  assert.match(html(), /Eliminar serie/);
  const beforeConversion = state.revision;
  click("Series lineales");
  assert.equal(state.revision, beforeConversion + 1);
  assert.doesNotMatch(html(), /TÉCNICA DE ENTRENAMIENTO|Repeticiones serie|Kilogramos serie|al fallo muscular|Acciones de la serie|DESCENSOS|Duplicar serie|Eliminar serie/);
  assert.ok(state.draft.routines.monday.exercises[0].sets.every((set) => !set.toFailure && !set.drops.length));
  assert.equal(actions.at(-1)?.type, "set_exercise_mode");
});

test("el handler de Aplicar enlaza ambos buffers con todas las series sin controles individuales", () => {
  const Screen = loadExerciseScreen();
  let state = cycleState.trainingCycleBuilderReducer(
    cycleState.createTrainingCycleBuilderState(createTrainingCycleBuilderTestViewModel()),
    { type: "open_exercise", exerciseId: "press-flat" },
  );
  const dispatch = (action: cycleState.TrainingCycleBuilderAction) => { state = cycleState.trainingCycleBuilderReducer(state, action); };
  const render = () => Screen({ state, dispatch });
  const inputs = elementsIn(render()).filter((node) => node.type === "input" && node.props.type !== "url");
  assert.equal(inputs.length, 2, "sólo reps/kg globales, sin inputs individuales ocultos");
  (inputs[0].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "14" } });
  (inputs[1].props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "95" } });
  const apply = elementsIn(render()).find((node) => Array.isArray(node.props.children) && node.props.children[0] === "Aplicar a las ");
  assert.ok(apply);
  (apply.props.onClick as () => void)();
  assert.equal(state.draft.routines.monday.exercises[0].technique, "linear");
  assert.ok(state.draft.routines.monday.exercises[0].sets.every((set) => set.targetKg === "95" && set.targetReps === "14" && !set.toFailure && !set.drops.length));
  assert.match(renderToStaticMarkup(render()), /value="95"/);
});

// Detalle de series: nombres solicitados y cambios de forma/color acotados a técnicas.
assert.match(routineScreensSource, />Series lineales<\/button>/);
assert.match(routineScreensSource, />Modificar por series<\/button>/);
assert.doesNotMatch(routineScreensSource, />Rápido<|>Por serie</);
const techniqueChipRule = cssSource.match(/\.techniquePicker \.choiceChip\s*\{([^}]*)\}/)?.[1] ?? "";
const exerciseModeRule = cssSource.match(/\.segmentedControl button\s*\{([^}]*)\}/)?.[1] ?? "";
assert.equal(techniqueChipRule.match(/border-radius: ([^;]+)/)?.[1], exerciseModeRule.match(/border-radius: ([^;]+)/)?.[1]);
assert.match(techniqueChipRule, /min-height: 46px/);
const techniqueHelpRule = cssSource.match(/\.techniquePicker > p\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(techniqueHelpRule, /border: 1px solid var\(--cycle-blue\)/);
assert.match(techniqueHelpRule, /background: linear-gradient/);
assert.match(techniqueHelpRule, /color: var\(--cycle-text\)/);
assert.match(stateSource, /editTrainingCycleSet\(exercise, action\)/);

// UX aprobada: información neutral en Rutina; el catálogo acusa la adición al
// borrador, nunca un guardado remoto. Su región persistente no roba foco.
const routineScreenSource = routineScreensSource.split("export { CycleCatalogScreen }")[0];
assert.doesNotMatch(routineScreenSource, /Revisa tu distribución|warnings\.slice/);
assert.match(routineScreenSource, /Tu distribución se actualizará a medida que agregues ejercicios/);
assert.match(routineScreenSource, /Ver distribución muscular/);
assert.match(catalogScreenSource, /CYCLE_CATALOG_TABS\.map/);
assert.match(catalogScreenSource, /CycleCatalogAdditionNotice addition=\{state\.catalogAddition\}/);
assert.match(catalogScreenSource, /getCycleCatalogEmptyState\(state\.catalogQuery, state\.catalogScope\)/);
assert.match(catalogScreenSource, /const name = resolveCycleCustomExerciseName\(state\.catalogQuery, state\.customName\)/);
assert.match(catalogScreenSource, /if \(name !== state\.customName\) dispatch\(\{ type: "set_custom_name", value: name \}\)/);
assert.doesNotMatch(catalogScreenSource, /set_custom_name", value: state\.catalogQuery\.trim\(\)/);
assert.match(catalogScreenSource, /set_catalog_query", value: ""[\s\S]*set_catalog_scope", scope: "all"/);
assert.match(catalogScreenSource, /Ver ejercicios/);
assert.match(catalogNoticeSource, /role="status" aria-live="polite" aria-atomic="true"/);
assert.match(catalogNoticeSource, /key=\{addition\.exerciseId\}/);
assert.match(catalogNoticeSource, /return \(\) => clearTimeout\(timeout\)/);
assert.match(catalogNoticeSource, /dismiss_catalog_addition", exerciseId: addition\.exerciseId/);
assert.doesNotMatch(catalogNoticeSource, /autoFocus|\.focus\(|scrollIntoView|role="(?:dialog|alert)"|Guardado|servidor/);
const noticeRegionRule = cssSource.match(/\.catalogNoticeRegion\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(noticeRegionRule, /position: fixed/);
assert.match(noticeRegionRule, /safe-area-inset-top/);
assert.match(noticeRegionRule, /pointer-events: none/);
assert.match(cssSource, /@keyframes cycle-notice-enter/);
assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.catalogAdditionNotice\s*\{\s*animation: none/);

// El composition root sólo selecciona y compone la boundary productiva; la lógica permanece en la feature.
assert.match(rootSource, /import \{ TrainingCycleBuilderProductiveBoundary \} from "@\/features\/training-cycle-builder\/components\/training-cycle-builder-productive-boundary";/);
assert.match(rootSource, /import \{ useTrainingCycleProductController \} from "@\/features\/training-cycle-builder\/hooks\/use-training-cycle-product-controller";/);
assert.match(rootSource, /const trainingCycleProduct = useTrainingCycleProductController\(/);
assert.match(rootSource, /<TrainingCycleBuilderProductiveBoundary/);
assert.match(productiveBoundarySource, /export function TrainingCycleBuilderProductiveBoundary\(/);
assert.match(productiveBoundarySource, /<TrainingCycleBuilder/);
assert.match(productiveBoundarySource, /key=\{trainingCycleBuilderInstanceKey\(props\.openAlertsRequest\)\}/);
assert.doesNotMatch(productiveBoundarySource, /key=\{`[^`]*(?:activeCycleId|draftId)/);
assert.match(productControllerSource, /createTrainingCycleProductGateway/);
assert.match(productControllerSource, /buildTrainingCycleProductViewModel/);
assert.match(featureSource, /export function TrainingCycleBuilder\(/);
assert.match(featureSource, /import \{ AppTopbar \} from "@\/features\/app-shell\/components\/app-topbar";/);
assert.match(featureSource, /import \{ AppBackButton \} from "@\/ui\/navigation\/app-back-button";/);
assert.match(featureSource, /import \{ ConfirmDialog \} from "@\/ui\/modals\/confirm-dialog";/);
assert.match(featureSource, /<AppTopbar/);
assert.match(featureSource, /<AppBackButton onBack=\{handleBack\} \/>/);
assert.match(featureSource, /if \(!hasTrainingCycleViewModel\(initialViewModel\) \|\| !hasTrainingCycleGateway\(gateway\)\)/);
assert.doesNotMatch(featureSource, /DEFAULT_VIEW_MODEL|deterministicTrainingCycleBuilderGateway|\?\?\s*(?:DEFAULT|deterministic)/);
assert.match(featureSource, /No pudimos cargar el constructor de ciclos/);
assert.doesNotMatch(combined, /training-cycle-builder-fixtures\.check/);

// Sin ownership editable, secretos ni dependencia inversa al root. Sólo el adapter `data/`
// puede conocer el cliente Supabase; UI, controller y dominio dependen de contratos tipados.
for (const [index, source] of productionSources.entries()) {
  const path = productionFiles[index];
  assert.doesNotMatch(source, /from ["']@\/components\/organizatech-app["']/);
  if (!path.includes("/data/")) {
    assert.doesNotMatch(source, /from ["']@\/lib\/supabase\//);
    assert.doesNotMatch(source, /\bcreateClient\(/);
  }
  assert.doesNotMatch(source, /\bwindow\.(?:localStorage|sessionStorage)|\bservice_role\b/i);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|history\.back\(|<svg\b/i);
}
assert.match(rpcGatewaySource, /accessToken: async \(\) => accessToken/);
assert.match(rpcGatewaySource, /persistSession: false/);
assert.match(rpcGatewaySource, /autoRefreshToken: false/);
assert.match(rpcGatewaySource, /verifyExpectedUser/);
assert.doesNotMatch(combined, /\b(?:user_id|owner_id|profile_id)\b/i);
assert.match(stateSource, /buildTrainingCycleSaveDraftInput/);
assert.match(stateSource, /draftId:[\s\S]*goal:[\s\S]*startDate:[\s\S]*endDate:[\s\S]*days:/);

// Contratos completos para gateway, view-model y lifecycle sin objetos crudos de formulario.
for (const contract of [
  "TrainingCycleBuilderInitialViewModel",
  "TrainingCycleBuilderGateway",
  "TrainingCycleSaveDraftInput",
  "TrainingCycleActivateInput",
  "TrainingCycleExtendInput",
  "TrainingCycleGenerateSuggestedDraftInput",
  "TrainingCycleSaveActiveInput",
  "TrainingCycleBuilderProps",
]) {
  assert.match(contractsSource, new RegExp(`export interface ${contract}\\b`));
}
const propsContract = contractsSource.match(/export interface TrainingCycleBuilderProps[\s\S]*?\n\}/)?.[0] ?? "";
assert.doesNotMatch(propsContract, /initialViewModel\?|gateway\?/);
assert.match(controllerSource, /activationLockRef/);
assert.match(controllerSource, /if \(activationLockRef\.current \|\| state\.committedSyncPending \|\| state\.workflow !== "draft"\) return;/);
assert.match(controllerSource, /AUTOSAVE_DELAY_MS/);
assert.match(controllerSource, /TrainingCycleDraftAutosaveOwner/);
assert.match(controllerSource, /autosaveOwner\.claim\(snapshot\.draftId\)/);
assert.match(controllerSource, /requestTrainingCycleDraftSave\(\{ draft, origin: originRef\.current, owner: autosaveOwner, dispatch, claim \}\)/);
assert.match(controllerSource, /prepareTrainingCycleDraftSave\(snapshot, originRef\.current\)/);
assert.match(lifecycleScreensSource, /saveBlocksActivation = !isActiveEdit && state\.saveState !== "saved"/);
assert.doesNotMatch(controllerSource, /saveRequestRef/);
assert.match(autosaveSource, /private active:/);
assert.match(autosaveSource, /private pending:/);
assert.match(autosaveSource, /this\.pending\?\.resolve\(\{ status: "superseded" \}\);/);
assert.match(autosaveSource, /if \(this\.active\?\.token !== token\) return;/);
assert.match(autosaveSource, /resume\(scopeKey: string\)/);
assert.match(autosaveSource, /pause\(\)/);
assert.match(controllerSource, /generateSuggestedDraft/);
assert.match(controllerSource, /saveActiveCycle/);
assert.match(controllerSource, /export class TrainingCycleNewCycleOperationOwner/);
assert.match(controllerSource, /private intentRunning = false/);
assert.match(controllerSource, /private closeRunning = false/);
assert.match(controllerSource, /newCycleOwnerRef = useRef<TrainingCycleNewCycleOperationOwner/);
assert.match(controllerSource, /newCycleOwner\.request\(/);
assert.match(controllerSource, /newCycleOwner\.confirm\(/);
assert.match(controllerSource, /getActiveCycleGuard/);
assert.match(controllerSource, /completeActiveCycle/);
assert.match(featureSource, /controller\.requestNewCycle\("duplicate", "duplicate"\)/);
assert.match(featureSource, /¿Quieres finalizar tu ciclo actual\?/);
assert.match(featureSource, /No, mantenerlo/);
assert.match(featureSource, /Sí, finalizar y continuar/);
assert.match(lifecycleScreensSource, /Editar objetivo, días y rutinas/);
assert.match(lifecycleScreensSource, /Crear un nuevo ciclo de entrenamiento/);
assert.doesNotMatch(lifecycleScreensSource, /begin_active_edit[\s\S]{0,200}active_cycle_close/);
assert.match(controllerSource, /state\.workflow !== "draft"/);
assert.match(stateSource, /expectedRevision/);
assert.match(stateSource, /durationDays/);
assert.doesNotMatch(
  contractsSource.match(/export interface TrainingCycleSaveActiveInput[\s\S]*?\n\}/)?.[0] ?? "",
  /startDate|endDate/,
);
for (const state of ["loading", "saving", "saved", "offline", "error"]) {
  assert.match(contractsSource, new RegExp(`"${state}"`));
}

// Flujo aprobado completo; no incluye portada ni índice del prototipo.
for (const copy of [
  "Duplicar mi último ciclo",
  "Comparar con mi rendimiento real",
  "¿Qué buscas en este ciclo?",
  "Agregar ejercicio",
  "Ejercicio personalizado",
  "TÉCNICA DE ENTRENAMIENTO",
  "Modificar",
  "Distribución muscular",
  "Revisa antes de activar",
  "Tu ciclo está activo",
  "Avisos de vencimiento",
  "Extender el ciclo",
  "Un entrenamiento en curso nunca se interrumpe",
  "Listo para el siguiente",
  "Editar objetivo, días y rutinas",
  "Se guardarán con revisión optimista",
]) {
  assert.ok(combined.includes(copy), `falta copy/estado obligatorio: ${copy}`);
}
assert.doesNotMatch(combined, /PROTOTIPO NAVEGABLE|Recorre el flujo|índice superior/i);
assert.doesNotMatch(combined, /LOGO|data-productive-component/);
assert.doesNotMatch(combined, /const SUGGESTED_ROUTINES/);

// El video opcional se normaliza y falla cerrado para cualquier origen ajeno a YouTube.
assert.match(videoUrlSource, /url\.protocol !== "https:"/);
for (const host of ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]) {
  assert.ok(videoUrlSource.includes(`"${host}"`));
}
assert.match(videoUrlSource, /url\.username\.length > 0/);
assert.match(videoUrlSource, /YOUTUBE_VIDEO_ID/);
assert.match(stateSource, /normalizeOptionalYouTubeVideoUrl\(exercise\.videoUrl\)/);
assert.match(productControllerSource, /compatibility\.status === "legacy_fallback"/);
assert.match(productControllerSource, /new TrainingCycleTransportError\(\s*"not_supported"/);

assert.match(contractsSource, /export const TRAINING_CYCLE_TECHNIQUES = \[[\s\S]*"linear"[\s\S]*"ascending"[\s\S]*"descending"[\s\S]*"drop_set"[\s\S]*"failure"/);
assert.equal((contractsSource.match(/^\s+"(?:Pectoral|Hombros|Tríceps|Dorsal|Bíceps|Trapecio|Cuádriceps|Femoral|Glúteos|Pantorrillas|Pierna completa|Abdomen)",$/gm) ?? []).length, 12);

// Reutilización de overlays y accesibilidad mobile-first.
assert.match(combined, /ModalShell/);
assert.match(modalShellSource, /role="dialog"/);
assert.match(modalShellSource, /aria-modal="true"/);
assert.match(combined, /aria-live="polite"/);
assert.match(combined, /aria-busy=/);
assert.doesNotMatch(cssSource, /--cycle-bg|#07101a/i);
assert.match(cssSource, /background: var\(--background\);/);
assert.match(cssSource, /font-family: "Roboto Mono"/);
assert.match(cssSource, /min-width: 44px;/);
assert.match(cssSource, /min-height: 44px;/);
assert.match(cssSource, /:focus-visible/);

const baseDateFieldsRule = cssSource.match(/\.dateFields\s*\{([^}]*)\}/)?.[1] ?? "";
const sharedDateLabelRule = cssSource.match(
  /\.dateFields label,\s*[\s\S]*?\.routineNameField\s*\{([^}]*)\}/,
)?.[1] ?? "";
const dateLabelRule = cssSource.match(/\.dateFields label\s*\{([^}]*)\}/)?.[1] ?? "";
const sharedDateInputRule = cssSource.match(
  /\.dateFields input,\s*[\s\S]*?\.videoCard input\s*\{([^}]*)\}/,
)?.[1] ?? "";
const dateInputRule = cssSource.match(/\.dateFields input\[type="date"\]\s*\{([^}]*)\}/)?.[1] ?? "";
const webkitDateValueRule = cssSource.match(
  /\.dateFields input\[type="date"\]::-webkit-date-and-time-value\s*\{([^}]*)\}/,
)?.[1] ?? "";

assert.match(baseDateFieldsRule, /\bgrid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
assert.match(sharedDateLabelRule, /\bmin-width: 0;/);
assert.match(dateLabelRule, /\bwidth: 100%;/);
assert.match(dateLabelRule, /\bmax-width: 100%;/);
assert.match(dateLabelRule, /\bmin-inline-size: 0;/);
assert.match(dateLabelRule, /\bmax-inline-size: 100%;/);
assert.match(sharedDateInputRule, /\bwidth: 100%;/);
assert.match(sharedDateInputRule, /\bmin-width: 0;/);
assert.match(sharedDateInputRule, /\bheight: 48px;/);
assert.match(sharedDateInputRule, /\bfont-size: 16px;/);
assert.match(dateInputRule, /\binline-size: 100%;/);
assert.match(dateInputRule, /\bmax-inline-size: 100%;/);
assert.match(dateInputRule, /\bmin-inline-size: 0;/);
assert.match(dateInputRule, /\bmax-width: 100%;/);
assert.match(dateInputRule, /\bmin-width: 0;/);
assert.match(dateInputRule, /-webkit-appearance: none;/);
assert.match(webkitDateValueRule, /\bmin-width: 0;/);
assert.match(dateInputRule, /\bdisplay: flex;/);
assert.match(dateInputRule, /\balign-items: center;/);
assert.match(webkitDateValueRule, /\bheight: 100%;/);
assert.match(webkitDateValueRule, /\bdisplay: flex;/);
assert.match(webkitDateValueRule, /\balign-items: center;/);
assert.match(webkitDateValueRule, /\bjustify-content: center;/);
assert.match(webkitDateValueRule, /\bfont-size:\s*clamp\(14px,\s*3\.65vw,\s*16px\);/);
assert.match(webkitDateValueRule, /\bline-height: 1\.5;/);
assert.match(webkitDateValueRule, /\btext-align: center;/);
assert.match(
  cssSource,
  /@media \(max-width: 389px\)[\s\S]*?\.dateFields\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
);
assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);

// Sólo archivos focales nuevos dentro del owner autorizado.
assert.ok(files.every((path) => path.startsWith(`${FEATURE_ROOT}/`)));
assert.ok(tsSources.length >= 7);
