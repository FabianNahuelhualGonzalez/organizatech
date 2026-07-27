import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de preparación visual (P3-19A). No renderiza React, no simula
 * interacciones y no valida persistencia ni comportamiento runtime. Verifica que los tres
 * componentes preparados espejen el JSX inline de InitialTrainingScreen SIN estar todavía
 * cableados en el root, sin absorber dominio (P3-20..P3-26) y sin tocar áreas protegidas.
 * No registrado en package.json (regla de la casa para preparaciones); se ejecuta manualmente
 * y se elimina/absorbe en la integración (P3-26).
 */
function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

// Quita comentarios antes de las verificaciones de pureza: los docstrings citan legítimamente
// identificadores del contenedor en prosa para explicar qué NO hacen.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const appSource = readSource("src/components/organizatech-app.tsx");
const packageSource = readSource("package.json");
const setupCardSource = readSource("src/features/training-plan/components/TrainingPlanSetupCard.tsx");

const components = {
  dayCard: readSource("src/features/routine-builder/components/RoutineBuilderDayCard.tsx"),
  nameCard: readSource("src/features/routine-builder/components/RoutineBuilderNameCard.tsx"),
  exerciseCard: readSource("src/features/routine-builder/components/RoutineExerciseBuilderCard.tsx"),
};

// 1. Archivos reales con exports, props tipadas y callbacks de firma string/void.
assert.match(components.dayCard, /export interface RoutineBuilderDayCardProps/);
assert.match(components.dayCard, /export function RoutineBuilderDayCard\(/);
assert.match(components.dayCard, /plannedDays: readonly string\[\];/);
assert.match(components.dayCard, /onSelectDay: \(day: string\) => void;/);

assert.match(components.nameCard, /export interface RoutineBuilderNameCardProps/);
assert.match(components.nameCard, /export function RoutineBuilderNameCard\(/);
assert.match(components.nameCard, /onRoutineNameChange: \(value: string\) => void;/);

assert.match(components.exerciseCard, /export interface RoutineExerciseBuilderCardProps/);
assert.match(components.exerciseCard, /export function RoutineExerciseBuilderCard\(/);
assert.match(components.exerciseCard, /export type SetupExerciseRowField = keyof Omit<SetupExerciseRow, "id" \| "sourceExerciseId" \| "exerciseLineageId">;/);
assert.match(components.exerciseCard, /rows: readonly SetupExerciseRow\[\];/);
assert.match(components.exerciseCard, /onRowChange: \(id: string, field: SetupExerciseRowField, value: string\) => void;/);
assert.match(components.exerciseCard, /onAddRow: \(\) => void;/);
assert.match(components.exerciseCard, /onRemoveRow: \(id: string\) => void;/);
assert.match(components.exerciseCard, /onSave: \(\) => void;/);
assert.match(components.exerciseCard, /import type \{ SetupExerciseRow \} from "@\/lib\/training\/training-routine-draft";/, "el tipo canonico se importa del modulo puro, sin redeclararlo");
assert.doesNotMatch(components.exerciseCard, /interface SetupExerciseRow\b/, "no se redeclara el tipo canonico");

// 2. DOM/clases/copy, byte a byte con el bloque inline (no puede pasar con componentes vacíos).
// 2a. Card de días: progreso + píldoras con estados Listo/Actual/Pendiente.
assert.match(components.dayCard, /className="setup-card routine-day-builder-card"/);
[
  "Configura tus rutinas por día",
  "días completados",
  "Listo",
  "Actual",
  "Pendiente",
].reduce((previous, copy) => {
  const index = components.dayCard.indexOf(copy);
  assert.ok(index > previous, `copy ausente o fuera de orden en dayCard: ${copy}`);
  return index;
}, -1);
assert.match(components.dayCard, /Rutina \{currentStep\} de \{plannedDays\.length\} · \{activeDay\}/, "el separador es el punto medio U+00B7, como el original");
assert.match(components.dayCard, /className=\{`routine-build-day \$\{item === activeDay \? "current" : ""\} \$\{configuredDays\.includes\(item\) \? "done" : ""\}`\}/);
assert.match(components.dayCard, /style=\{\{ width: `\$\{Math\.round\(\(completedDaysCount \/ plannedDays\.length\) \* 100\)\}%` \}\}/, "el ancho de la barra se calcula inline, igual que el original");
assert.match(components.dayCard, /const completedDaysCount = plannedDays\.filter\(\(item\) => configuredDays\.includes\(item\)\)\.length;/, "aritmetica de presentacion interna, espejo de las derivaciones del root");
assert.match(components.dayCard, /const currentStep = Math\.max\(1, plannedDays\.indexOf\(activeDay\) \+ 1\);/);

// 2b. Card de nombre: heading + input controlado sin type/maxLength/autoFocus.
assert.match(components.nameCard, /className="setup-card routine-name-card"/);
assert.match(components.nameCard, /Rutina del día \{day\}/);
assert.match(components.nameCard, /<h3>Nombre de la rutina<\/h3>/);
assert.match(components.nameCard, /placeholder="Ej: Empuje, Jalón, Piernas"/);
assert.match(components.nameCard, /className="setup-name-input"/);
assert.doesNotMatch(stripComments(components.nameCard), /autoFocus|maxLength/, "el original no los tiene");

// 2c. Card de ejercicios: cabecera de tabla, filas con paridad de atributos, acciones y mensaje.
assert.match(components.exerciseCard, /className="setup-card exercise-builder-card"/);
const exerciseCardCode = stripComments(components.exerciseCard);
[
  "Ejercicios a programar",
  "Nombre ejercicio",
  "Series",
  "Repeticiones",
  "Kg",
  "Agregar más",
].reduce((previous, copy) => {
  const index = exerciseCardCode.indexOf(copy);
  assert.ok(index > previous, `copy ausente o fuera de orden en exerciseCard: ${copy}`);
  return index;
}, -1);
assert.match(components.exerciseCard, /<div className="setup-row" key=\{row\.id\}>/, "las filas van keyed por id estable, no por indice");
assert.match(components.exerciseCard, /placeholder=\{`Ejercicio \$\{index \+ 1\}`\} value=\{row\.name\}/, "el nombre va sin coalescer, igual que el original");
assert.match(components.exerciseCard, /type="number" min=\{1\} placeholder="Series" value=\{row\.sets \|\| ""\}/);
assert.match(components.exerciseCard, /type="number" min=\{1\} placeholder="Reps" value=\{row\.reps \|\| ""\}/);
assert.match(components.exerciseCard, /inputMode="decimal" placeholder="Kg" value=\{row\.weight \|\| ""\}/, "el peso no usa type number: se tipea decimal como string, igual que el original");
assert.match(components.exerciseCard, /aria-label="Eliminar ejercicio"/);
assert.match(components.exerciseCard, /<Trash2 size=\{13\} \/>/);
assert.equal((components.exerciseCard.match(/type="button"/g) ?? []).length, 3, "eliminar, agregar y guardar llevan type=button");
assert.match(components.exerciseCard, /onClick=\{onSave\} disabled=\{isBusy\}/, "guardar usa la referencia desnuda del callback (el SyntheticEvent debe fluir igual que hoy)");
assert.doesNotMatch(components.exerciseCard, /onClick=\{\(\) => onSave\(\)\}/, "envolver onSave cambiaria el comportamiento observable del contenedor");
assert.match(components.exerciseCard, /\{isBusy \? "Guardando\.\.\." : isLastPendingDay \? "Finalizar registro de rutina" : "Guardar y continuar"\}/);
assert.match(components.exerciseCard, /\{message \? <p className="setup-message">\{message\}<\/p> : null\}/);
// Los onChange emiten el valor crudo: sin parseo numérico en la capa visual.
assert.doesNotMatch(stripComments(components.exerciseCard), /Number\(|parseFloat\(|parseInt\(/, "el parseo numerico permanece en el contenedor (P3-20+)");

// 3. Pureza: sin hooks, sin browser APIs, sin dominio, sin imports prohibidos, sin pares fuera
//    de alcance. Se evalúa sobre el código sin comentarios.
for (const [label, source] of Object.entries(components)) {
  const code = stripComments(source);
  for (const forbidden of [
    /\buseState\b/, /\buseEffect\b/, /\buseMemo\b/, /\buseRef\b/, /\buseCallback\b/,
    /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bsetTimeout\b/,
    /\bsetScreen\b/, /\bsetScreenHistory\b/,
    /from ["']react["']/,
    /from ["']@\/components\/organizatech-app["']/,
    /from ["']@\/lib\/(?:data|storage|supabase|navigation)\//,
    /training-plan-rules/,
    /-repository["']/,
    /\b(?:RoutineSuccessModal|ConfirmRoutineUpdateModal|TrainingPlanSetupCard|CycleManagementScreen|CycleScopedPlanBlocker)\b/,
  ]) {
    assert.doesNotMatch(code, forbidden, `${label} no debe contener ${forbidden}`);
  }
}

// 4. La preparación conserva el bloque productivo en el root: todavía SIN integrar.
assert.doesNotMatch(appSource, /from ["']@\/features\/routine-builder\/components\/RoutineBuilderDayCard["']/);
assert.doesNotMatch(appSource, /from ["']@\/features\/routine-builder\/components\/RoutineBuilderNameCard["']/);
assert.doesNotMatch(appSource, /from ["']@\/features\/routine-builder\/components\/RoutineExerciseBuilderCard["']/);
assert.match(appSource, /function InitialTrainingScreen\(/);
assert.match(appSource, /className="setup-card routine-day-builder-card"/);
assert.match(appSource, /className="setup-card routine-name-card"/);
assert.match(appSource, /className="setup-card exercise-builder-card"/);

// 5. Áreas protegidas intactas: TrainingPlanSetupCard, Active Workout y controlador de navegación.
assert.match(setupCardSource, /className="setup-card training-cycles-card"/);
assert.match(setupCardSource, /onCycleTypeChange\(event\.target\.value\)/);
assert.match(appSource, /<TrainingPlanSetupCard/);
assert.match(appSource, /<TrainingStartScreen/);
assert.match(appSource, /<GuidedTrainingScreen/);
assert.equal((appSource.match(/setScreen\(/g) ?? []).length, 2, "controlador de navegacion intacto: 2 escritores autorizados");
assert.equal((appSource.match(/setScreenHistory\(/g) ?? []).length, 1, "controlador de navegacion intacto: 1 escritor de historial");

// 6. La duplicación temporal está documentada y este contrato NO está registrado (regla de la
//    casa para preparaciones: se ejecuta manualmente y se elimina en la integración).
for (const [label, source] of Object.entries(components)) {
  assert.match(source, /No integrado todavía/, `${label} debe documentar que aun no esta integrado`);
}
const directRegistration = "tsx src/features/routine-builder/routine-builder-visual-gap-preparation-contract.test.ts";
assert.equal(packageSource.split(directRegistration).length - 1, 0, "el contrato de preparacion no se registra en package.json");

console.log("routine-builder visual gap static preparation contract tests passed");
