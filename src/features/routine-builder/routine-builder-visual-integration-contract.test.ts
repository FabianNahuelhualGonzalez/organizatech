import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula
 * interacción y no prueba persistencia.
 *
 * Desde P3-19B cubre también RoutineBuilderDayCard, RoutineBuilderNameCard y
 * RoutineExerciseBuilderCard (integrados dentro de InitialTrainingScreen, reemplazando los
 * bloques inline `routine-day-builder-card` / `routine-name-card` / `exercise-builder-card`).
 * Absorbe la cobertura del extinto contrato de preparación
 * (`routine-builder-visual-gap-preparation-contract.test.ts`, eliminado en esta rama).
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
const successSource = readSource("src/features/routine-builder/components/RoutineSuccessModal.tsx");
const updateSource = readSource("src/features/routine-builder/components/ConfirmRoutineUpdateModal.tsx");
const setupCardSource = readSource("src/features/training-plan/components/TrainingPlanSetupCard.tsx");

const cards = {
  dayCard: readSource("src/features/routine-builder/components/RoutineBuilderDayCard.tsx"),
  nameCard: readSource("src/features/routine-builder/components/RoutineBuilderNameCard.tsx"),
  exerciseCard: readSource("src/features/routine-builder/components/RoutineExerciseBuilderCard.tsx"),
};

// 1. El root importa y usa los 5 componentes de routine-builder exactamente una vez cada uno;
//    ninguno se redeclara localmente.
for (const [componentName, modulePath] of [
  ["RoutineSuccessModal", "@/features/routine-builder/components/RoutineSuccessModal"],
  ["ConfirmRoutineUpdateModal", "@/features/routine-builder/components/ConfirmRoutineUpdateModal"],
  ["RoutineBuilderDayCard", "@/features/routine-builder/components/RoutineBuilderDayCard"],
  ["RoutineBuilderNameCard", "@/features/routine-builder/components/RoutineBuilderNameCard"],
  ["RoutineExerciseBuilderCard", "@/features/routine-builder/components/RoutineExerciseBuilderCard"],
] as const) {
  assert.match(appSource, new RegExp(`import \\{ ${componentName} \\} from "${modulePath}";`));
  assert.equal((appSource.match(new RegExp(`<${componentName}\\b`, "g")) ?? []).length, 1, `${componentName} se usa exactamente una vez`);
  assert.doesNotMatch(appSource, new RegExp(`^\\s*function ${componentName}\\b`, "m"));
}

for (const source of [successSource, updateSource, cards.dayCard, cards.nameCard, cards.exerciseCard]) {
  assert.doesNotMatch(source, /from ["']@\/components\/organizatech-app["']/);
  assert.doesNotMatch(source, /from ["']@\/lib\/(?:storage|supabase)\//);
}
assert.match(successSource, /className="card confirm-modal success-modal"/);
assert.match(successSource, /role="dialog" aria-modal="true" aria-label="Registro exitoso"/);
assert.match(successSource, /Tu rutina quedó guardada correctamente\./);
assert.match(updateSource, /role="dialog" aria-modal="true" aria-label="Confirmar modificacion de rutina"/);
assert.match(updateSource, /Sí, actualizar rutina/);
assert.doesNotMatch(`${successSource}\n${updateSource}`, /ConfirmDialog/);

// 2. Los bloques inline previos fueron eliminados del root — no puede pasar con componentes vacíos.
assert.doesNotMatch(appSource, /className="setup-card routine-day-builder-card"/, "el bloque inline de dias debe haberse eliminado del root");
assert.doesNotMatch(appSource, /className="setup-card routine-name-card"/, "el bloque inline de nombre debe haberse eliminado del root");
assert.doesNotMatch(appSource, /className="setup-card exercise-builder-card"/, "el bloque inline de ejercicios debe haberse eliminado del root");
assert.doesNotMatch(appSource, /\bTrash2\b/, "Trash2 ya no se usa directamente en el root, vive en RoutineExerciseBuilderCard");

// 3. Orden obligatorio dentro de InitialTrainingScreen: setup-screen intacto, sin wrapper nuevo,
//    TrainingPlanSetupCard -> DayCard -> NameCard -> ExerciseCard, como hermanas directas.
const screenSource = (() => {
  const start = appSource.indexOf("function InitialTrainingScreen(");
  const end = appSource.indexOf("\nfunction GuidedTrainingScreen(", start);
  assert.ok(start >= 0 && end > start, "InitialTrainingScreen debe seguir existiendo como funcion propia");
  return appSource.slice(start, end);
})();
assert.match(screenSource, /<section className="setup-screen">/);
[
  "<TrainingPlanSetupCard",
  "<RoutineBuilderDayCard",
  "<RoutineBuilderNameCard",
  "<RoutineExerciseBuilderCard",
].reduce((previous, marker) => {
  const index = screenSource.indexOf(marker);
  assert.ok(index > previous, `orden de componentes roto en: ${marker}`);
  return index;
}, -1);

// 4. Props y callbacks correctos, con los nombres productivos reales del contenedor.
assert.match(screenSource, /<RoutineBuilderDayCard\s+plannedDays=\{plannedDays\}\s+activeDay=\{day\}\s+configuredDays=\{configuredDays\}\s+onSelectDay=\{setDay\}\s*\/>/);
assert.match(screenSource, /<RoutineBuilderNameCard\s+day=\{day\}\s+routineName=\{routineName\}\s+onRoutineNameChange=\{setRoutineName\}\s*\/>/);
assert.match(screenSource, /<RoutineExerciseBuilderCard\s+day=\{day\}\s+rows=\{rows\}\s+isBusy=\{isBusy\}\s+isLastPendingDay=\{isLastPendingDay\}\s+message=\{visibleMessage\}\s+onRowChange=\{updateRow\}\s+onAddRow=\{addRow\}\s+onRemoveRow=\{removeRow\}\s+onSave=\{saveRoutine\}\s*\/>/);

// 5. Trampa de onSave/SyntheticEvent: la referencia debe seguir DESNUDA en ambos extremos —
//    el contenedor la pasa sin envolver y el componente la conecta sin envolver. Preservar
//    deliberadamente que el SyntheticEvent fluya como primer argumento (revisión funcional
//    reservada para P3-25; no se corrige aquí).
assert.doesNotMatch(screenSource, /onSave=\{\(\) => saveRoutine\(\)\}/, "no envolver saveRoutine al pasarlo al componente");
assert.doesNotMatch(screenSource, /onSave=\{\(\) => void saveRoutine\(\)\}/);
assert.doesNotMatch(screenSource, /onSave=\{\(event\) => saveRoutine\(\)\}/);
assert.match(cards.exerciseCard, /onClick=\{onSave\} disabled=\{isBusy\}/, "el componente conecta onSave por referencia desnuda");
assert.doesNotMatch(cards.exerciseCard, /onClick=\{\(\) => onSave\(\)\}/, "envolver onSave cambiaria el comportamiento observable del contenedor");

// 6. DOM/clases/copy de los 3 componentes nuevos, con la estructura exacta del bloque original.
assert.match(cards.dayCard, /className="setup-card routine-day-builder-card"/);
assert.match(cards.dayCard, /Configura tus rutinas por día/);
assert.match(cards.dayCard, /Rutina \{currentStep\} de \{plannedDays\.length\} · \{activeDay\}/);
assert.match(cards.dayCard, /className=\{`routine-build-day \$\{item === activeDay \? "current" : ""\} \$\{configuredDays\.includes\(item\) \? "done" : ""\}`\}/);
assert.match(cards.dayCard, /"Listo" : item === activeDay \? "Actual" : "Pendiente"/);

assert.match(cards.nameCard, /className="setup-card routine-name-card"/);
assert.match(cards.nameCard, /placeholder="Ej: Empuje, Jalón, Piernas"/);
assert.doesNotMatch(stripComments(cards.nameCard), /autoFocus|maxLength|<label/, "paridad: el original no los tenia");

assert.match(cards.exerciseCard, /className="setup-card exercise-builder-card"/);
assert.match(cards.exerciseCard, /aria-label="Eliminar ejercicio"/);
assert.match(cards.exerciseCard, /<Trash2 size=\{13\} \/>/);
assert.match(cards.exerciseCard, /"Guardando\.\.\." : isLastPendingDay \? "Finalizar registro de rutina" : "Guardar y continuar"/);
assert.match(cards.exerciseCard, /\{message \? <p className="setup-message">\{message\}<\/p> : null\}/);

// 7. Inputs con string crudo: sin parseo numerico dentro de los componentes (permanece en el
//    root, P3-20+).
assert.doesNotMatch(stripComments(cards.exerciseCard), /Number\(|parseFloat\(|parseInt\(/, "el parseo numerico permanece en el contenedor");
assert.match(cards.exerciseCard, /onRowChange\(row\.id, "sets", event\.target\.value\)/);
assert.match(cards.exerciseCard, /onRowChange\(row\.id, "reps", event\.target\.value\)/);
assert.match(cards.exerciseCard, /onRowChange\(row\.id, "weight", event\.target\.value\)/);

// 8. Pureza: sin hooks, sin browser APIs, sin dominio, sin imports prohibidos.
for (const [label, source] of Object.entries(cards)) {
  const code = stripComments(source);
  for (const forbidden of [
    /\buseState\b/, /\buseEffect\b/, /\buseMemo\b/, /\buseRef\b/, /\buseCallback\b/,
    /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bsetTimeout\b/,
    /\bsetScreen\b/, /\bsetScreenHistory\b/,
    /from ["']react["']/,
    /from ["']@\/lib\/(?:data|storage|supabase|navigation)\//,
    /training-plan-rules/,
    /training-plan-normalization/,
    /-repository["']/,
  ]) {
    assert.doesNotMatch(code, forbidden, `${label} no debe contener ${forbidden}`);
  }
}

// 9. TrainingPlanSetupCard, modales y Active Workout intactos (no movidos, no tocados).
assert.match(setupCardSource, /className="setup-card training-cycles-card"/);
assert.match(appSource, /<TrainingPlanSetupCard/);
assert.match(appSource, /<RoutineSuccessModal/);
assert.match(appSource, /<ConfirmRoutineUpdateModal/);
assert.match(appSource, /<TrainingStartScreen/);
assert.match(appSource, /<GuidedTrainingScreen/);
assert.match(appSource, /<TrainingReadinessScreen/);

// 10. updateSetupRow y saveInitialRoutine permanecen en el root durante esta fase (P3-20+).
assert.match(appSource, /function updateSetupRow\(/);
assert.match(appSource, /(?:async\s+)?function saveInitialRoutine\(/);

// 11. Controlador de navegación intacto: 2 escritores de pantalla, 1 de historial.
assert.equal((appSource.match(/setScreen\(/g) ?? []).length, 2, "controlador de navegacion intacto: 2 escritores autorizados");
assert.equal((appSource.match(/setScreenHistory\(/g) ?? []).length, 1, "controlador de navegacion intacto: 1 escritor de historial");

// 12. La preparación fue absorbida: el contrato de gap ya no existe como archivo separado.
assert.doesNotMatch(packageSource, /routine-builder-visual-gap-preparation-contract\.test\.ts/, "el contrato de preparacion ya no debe existir");

const registration = "tsx src/features/routine-builder/routine-builder-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);

console.log("routine-builder visual static integration contract tests passed");
