import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
const autosaveSource = read(`${FEATURE_ROOT}/hooks/training-cycle-draft-autosave.ts`);
const stateSource = read(`${FEATURE_ROOT}/hooks/training-cycle-builder-state.ts`);
const videoUrlSource = read(`${FEATURE_ROOT}/hooks/training-cycle-video-url.ts`);
const cssSource = read(`${FEATURE_ROOT}/components/training-cycle-builder.module.css`);
const modalShellSource = read("src/ui/modals/modal-shell.tsx");

// El composition root sólo selecciona y compone la boundary productiva; la lógica permanece en la feature.
assert.match(rootSource, /import \{ TrainingCycleBuilderProductiveBoundary \} from "@\/features\/training-cycle-builder\/components\/training-cycle-builder-productive-boundary";/);
assert.match(rootSource, /import \{ useTrainingCycleProductController \} from "@\/features\/training-cycle-builder\/hooks\/use-training-cycle-product-controller";/);
assert.match(rootSource, /const trainingCycleProduct = useTrainingCycleProductController\(/);
assert.match(rootSource, /<TrainingCycleBuilderProductiveBoundary/);
assert.match(productiveBoundarySource, /export function TrainingCycleBuilderProductiveBoundary\(/);
assert.match(productiveBoundarySource, /<TrainingCycleBuilder/);
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
assert.match(controllerSource, /if \(activationLockRef\.current \|\| state\.workflow !== "draft"\) return;/);
assert.match(controllerSource, /AUTOSAVE_DELAY_MS/);
assert.match(controllerSource, /TrainingCycleDraftAutosaveOwner/);
assert.match(controllerSource, /autosaveOwner\.claim\(snapshot\.draftId\)/);
assert.match(controllerSource, /autosaveOwner\.request\(buildTrainingCycleSaveDraftInput\(draft, originRef\.current\), claim\)/);
assert.doesNotMatch(controllerSource, /saveRequestRef/);
assert.match(autosaveSource, /private active:/);
assert.match(autosaveSource, /private pending:/);
assert.match(autosaveSource, /this\.pending\?\.resolve\(\{ status: "superseded" \}\);/);
assert.match(autosaveSource, /if \(this\.active\?\.token !== token\) return;/);
assert.match(autosaveSource, /resume\(scopeKey: string\)/);
assert.match(autosaveSource, /pause\(\)/);
assert.match(controllerSource, /generateSuggestedDraft/);
assert.match(controllerSource, /saveActiveCycle/);
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
assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);

// Sólo archivos focales nuevos dentro del owner autorizado.
assert.ok(files.every((path) => path.startsWith(`${FEATURE_ROOT}/`)));
assert.ok(tsSources.length >= 7);
