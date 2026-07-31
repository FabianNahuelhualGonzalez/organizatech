import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Contrato ESTÁTICO de integración visual. No renderiza React, no simula
 * interacción y no prueba persistencia.
 *
 * Desde P3-19B cubre también RoutineBuilderDayCard, RoutineBuilderNameCard y
 * RoutineExerciseBuilderCard (integrados dentro de InitialTrainingScreen, reemplazando los
 * bloques inline `routine-day-builder-card` / `routine-name-card` / `exercise-builder-card`).
 * Absorbe la cobertura del extinto contrato de preparación
 * (`routine-builder-visual-gap-preparation-contract.test.ts`, eliminado en esta rama).
 * También cubre el wiring actual del reducer, mapping, recovery y save. Sigue sin renderizar React
 * ni probar interacciones o persistencia runtime; esa evidencia vive en los tests conductuales de
 * cada módulo.
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
const savePreparationSource = readSource(
  "src/features/routine-builder/model/routine-builder-save.ts",
);

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
// P3-48A (COMPROBACIONES SOURCE-BASED, no pruebas de render): la estructura de backdrop/card/ARIA
// dejo de estar inline y la aportan ModalShell/ConfirmDialog.
assert.match(successSource, /cardClassName="card confirm-modal success-modal"/);
assert.match(successSource, /ariaLabel="Registro exitoso"/);
assert.match(successSource, /Tu rutina quedó guardada correctamente\./);
assert.match(updateSource, /ariaLabel="Confirmar modificacion de rutina"/);
assert.match(updateSource, /confirmLabel="Sí, actualizar rutina"/);

// ConfirmRoutineUpdateModal delega en ConfirmDialog conservando variantes, textos y callbacks, y
// sin inventar estado busy (nunca lo tuvo).
assert.match(updateSource, /import \{ ConfirmDialog \} from "@\/ui\/modals\/confirm-dialog";/);
assert.doesNotMatch(updateSource, /<button\b|<Button\b/, "las acciones las aporta ConfirmDialog");
assert.doesNotMatch(updateSource, /modal-backdrop|confirm-modal|modal-actions|role="dialog"/, "estructura delegada");
assert.match(updateSource, /cancelLabel="Cancelar"[\s\S]*?cancelVariant="secondary"/);
assert.match(updateSource, /confirmVariant="success"/);
assert.doesNotMatch(updateSource, /isBusy|confirmBusyLabel/, "no debe inventarse un estado busy");

// RoutineSuccessModal usa ModalShell pero NO ConfirmDialog: una sola accion y jerarquia h3.
assert.match(successSource, /import \{ MODAL_INITIAL_FOCUS_ATTRIBUTE, ModalShell \} from "@\/ui\/modals\/modal-shell";/);
assert.doesNotMatch(stripComments(successSource), /ConfirmDialog/, "el modal de exito no debe usar ConfirmDialog");
assert.match(successSource, /import \{ Button \} from "@\/ui\/buttons\/button";/);
assert.doesNotMatch(successSource, /<button\b/, "su boton nativo migro al Button compartido");
assert.match(successSource, /<Button variant="success" type="button" onClick=\{onConfirm\}/);
assert.match(successSource, /<h3>Registro exitoso<\/h3>/, "conserva la jerarquia h3");
assert.match(successSource, /<Save size=\{22\} \/>/, "conserva el icono");
assert.match(successSource, /className="success-icon"/);
// Escape ejecuta el mismo cierre que OK y el foco inicial va al boton OK.
assert.match(successSource, /onClose=\{onConfirm\}/);
assert.match(successSource, /MODAL_INITIAL_FOCUS_ATTRIBUTE\]: ""/);

// P3-48A remediación (COMPROBACIONES ESTATICAS / SOURCE-BASED — NO ejecutan foco, teclado ni DOM;
// el comportamiento runtime no se ejecuta en esta suite y requiere QA manual):
// el shell que consume RoutineSuccessModal aisla Escape y respeta el modal superior, de modo que
// cerrar este modal no cierre tambien un overlay subyacente (p. ej. el keydown en burbuja de
// `src/app/mobile-menu.tsx`).
const modalShellSharedSource = readSource("src/ui/modals/modal-shell.tsx");
const modalShellSharedCode = modalShellSharedSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");
// Ownership: solo el modal superior del stack procesa Tab/Escape.
assert.match(modalShellSharedCode, /const activeModalOwners: ModalShellOwner\[\] = \[\];/);
assert.match(modalShellSharedCode, /if \(!isTopModalOwner\(owner\)\) return;/);
// Alta/baja por identidad, tolerante a Strict Mode y a cleanups fuera de orden.
assert.match(modalShellSharedCode, /if \(!activeModalOwners\.includes\(owner\)\) activeModalOwners\.push\(owner\);/);
assert.match(modalShellSharedCode, /if \(ownerIndex !== -1\) activeModalOwners\.splice\(ownerIndex, 1\);/);
// Listener en capture, con alta y baja simetricas y sin acumulacion.
assert.match(modalShellSharedCode, /document\.addEventListener\("keydown", handleKeyDown, true\);/);
assert.match(modalShellSharedCode, /document\.removeEventListener\("keydown", handleKeyDown, true\);/);
assert.equal((modalShellSharedCode.match(/addEventListener\(/g) ?? []).length, 1);
assert.equal((modalShellSharedCode.match(/removeEventListener\(/g) ?? []).length, 1);
// Escape aislado siempre; el cierre solo ocurre si canClose vigente lo permite.
assert.match(modalShellSharedCode, /event\.stopImmediatePropagation\(\);/);
assert.match(modalShellSharedCode, /if \(!canCloseRef\.current\) return;/);
// Restauracion solo si el elemento previo sigue conectado.
assert.match(modalShellSharedCode, /previous\.isConnected\) previous\.focus\(\);/);
// Sin cierre por backdrop.
assert.doesNotMatch(modalShellSharedCode, /onClick/, "el backdrop no debe cerrar al pulsarlo");

// 2. Los bloques inline previos fueron eliminados del root — no puede pasar con componentes vacíos.
assert.doesNotMatch(appSource, /className="setup-card routine-day-builder-card"/, "el bloque inline de dias debe haberse eliminado del root");
assert.doesNotMatch(appSource, /className="setup-card routine-name-card"/, "el bloque inline de nombre debe haberse eliminado del root");
assert.doesNotMatch(appSource, /className="setup-card exercise-builder-card"/, "el bloque inline de ejercicios debe haberse eliminado del root");
assert.doesNotMatch(appSource, /\bTrash2\b/, "Trash2 ya no se usa directamente en el root, vive en RoutineExerciseBuilderCard");

// 3. Orden obligatorio dentro de InitialTrainingScreen: setup-screen intacto, sin wrapper nuevo,
//    TrainingPlanSetupCard -> DayCard -> NameCard -> ExerciseCard, como hermanas directas.
const screenSource = (() => {
  const start = appSource.indexOf("function InitialTrainingScreen(");
  // Limite estructural estable: la siguiente declaracion de funcion de nivel superior. Antes se
  // usaba "\nfunction GuidedTrainingScreen(", que dejo de existir en el root al extraerse el
  // componente (P3-30). Este limite no depende de que funcion concreta siga a
  // InitialTrainingScreen, por lo que recorta exactamente el mismo cuerpo sin relajar la prueba.
  const end = appSource.indexOf("\nfunction ", start);
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

// 5. Contrato de guardado: ningun SyntheticEvent cruza como confirmacion. El componente
//    invoca una callback sin argumentos y el root expresa ambas intenciones mediante literales.
assert.match(screenSource, /onSave=\{saveRoutine\}/);
assert.match(cards.exerciseCard, /onClick=\{\(\) => onSave\(\)\} disabled=\{isBusy\}/);
assert.doesNotMatch(cards.exerciseCard, /onClick=\{onSave\}/);
assert.doesNotMatch(cards.exerciseCard, /SyntheticEvent fluye|REFERENCIA DESNUDA/);
assert.match(appSource, /saveRoutine=\{\(\) => void saveInitialRoutine\("unconfirmed"\)\}/);
assert.doesNotMatch(appSource, /saveRoutine=\{saveInitialRoutine\}/);
assert.match(
  appSource,
  /onConfirm=\{\(\) => void saveInitialRoutine\("confirmed_routine_update"\)\}/,
);
assert.match(
  appSource,
  /async function saveInitialRoutine\(confirmation: RoutineBuilderSaveConfirmation\)/,
);
assert.doesNotMatch(appSource, /saveInitialRoutine\(confirmedRoutineUpdate\s*=\s*false\)/);
assert.doesNotMatch(appSource, /saveInitialRoutine\(true\)/);

// 6. DOM/clases/copy de los 3 componentes nuevos, con la estructura exacta del bloque original.
assert.match(cards.dayCard, /className="setup-card routine-day-builder-card"/);
assert.match(cards.dayCard, /Configura tus rutinas por día/);
assert.match(cards.dayCard, /Rutina \{currentStep\} de \{plannedDays\.length\} · \{activeDay\}/);
assert.match(cards.dayCard, /className=\{`routine-build-day \$\{item === activeDay \? "current" : ""\} \$\{configuredDays\.includes\(item\) \? "done" : ""\}`\}/);
assert.match(cards.dayCard, /"Listo" : item === activeDay \? "Actual" : "Pendiente"/);

assert.match(cards.nameCard, /className="setup-card routine-name-card"/);
assert.match(cards.nameCard, /placeholder="Ej: Empuje, Jalón, Piernas"/);
assert.doesNotMatch(stripComments(cards.nameCard), /autoFocus|maxLength|<label/, "paridad: el original no los tenia");
// P3-47B (COMPROBACIONES SOURCE-BASED, no cobertura de render): el input del nombre de rutina pasa
// a la primitive compartida TextInput, conservando clase, placeholder, value y onChange.
assert.match(cards.nameCard, /import \{ TextInput \} from "@\/ui\/forms\/text-input";/);
assert.doesNotMatch(stripComments(cards.nameCard), /<input\b/, "no debe quedar <input> nativo en la card");
assert.match(cards.nameCard, /<TextInput\s+className="setup-name-input"/);
assert.match(cards.nameCard, /value=\{routineName\}/);
assert.match(cards.nameCard, /onChange=\{\(event\) => onRoutineNameChange\(event\.target\.value\)\}/);

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

// 10. El reducer es la única fuente de verdad del editor; los aliases son sólo lectura y no
//     quedan setters/useState legacy ni un segundo reducer paralelo.
assert.match(appSource, /import \{ useCallback, useEffect, useMemo, useReducer, useRef, useState \} from "react";/);
assert.match(appSource, /from "@\/features\/routine-builder\/model\/routine-builder-state";/);
assert.match(appSource, /\bcreateRoutineBuilderState\(\{/);
assert.match(appSource, /\broutineBuilderReducer\b/);
assert.match(appSource, /\bcreateRoutineBuilderRow\(createId\(\)\)/);
assert.equal(
  (appSource.match(/useReducer\(\s*routineBuilderReducer,/g) ?? []).length,
  1,
  "una única fuente routineBuilderReducer en el root",
);
assert.match(appSource, /const setupDay = routineBuilderState\.activeDay;/);
assert.match(appSource, /const setupByDay = routineBuilderState\.setupByDay;/);
assert.doesNotMatch(appSource, /const \[setupDay,/);
assert.doesNotMatch(appSource, /const \[setupByDay,/);
assert.doesNotMatch(appSource, /\bsetSetupDay\b|\bsetSetupByDay\b/);

// 11. Mapping P3-23B: una sola implementación, identidad visual explícita, políticas reales y
//     bloqueo antes de cualquier estado parcial o navegación dependiente.
assert.match(appSource, /from "@\/features\/routine-builder\/model\/routine-builder-exercise-mapping";/);
assert.doesNotMatch(appSource, /^function createSetupByDayFromExercises\b/m);
const mappingAdapterStart = appSource.indexOf("function prepareRoutineBuilderStateFromExercises(");
const mappingAdapterEnd = appSource.indexOf("\n  function navigateTo(", mappingAdapterStart);
assert.ok(mappingAdapterStart >= 0 && mappingAdapterEnd > mappingAdapterStart);
const mappingAdapterSource = appSource.slice(mappingAdapterStart, mappingAdapterEnd);
assert.match(mappingAdapterSource, /visualRowId: exercise\.id/);
assert.match(mappingAdapterSource, /unknownDayPolicy: "fallback_to_monday"/);
assert.match(mappingAdapterSource, /existingRowsPolicy: "append"/);
assert.match(mappingAdapterSource, /initialSetupByDay: createSetupByDay\(\)/);
assert.match(mappingAdapterSource, /if \(mapping\.kind === "blocked"\)/);
assert.match(mappingAdapterSource, /No se pudo preparar la rutina para editar\. Intenta nuevamente\./);
assert.ok(
  mappingAdapterSource.indexOf('if (mapping.kind === "blocked")') <
    mappingAdapterSource.indexOf("dispatchRoutineBuilder({"),
  "blocked se resuelve antes de despachar estado",
);
assert.match(appSource, /!prepareRoutineBuilderStateFromExercises\(exercises, activeRoutineDay\)[\s\S]*?return;/);

// 12. Recovery está conectado a la API única de storage. Full y partial mantienen mensajes
//     distintos y discardedRowCount se consume; las normalizaciones retiradas no vuelven al root.
assert.match(appSource, /from "@\/features\/routine-builder\/model\/routine-builder-draft-recovery";/);
assert.match(appSource, /resolveSetupRecovery\(input\) \{/);
assert.match(appSource, /const result = resolveRoutineBuilderDraftRecovery\(input\);/);
assert.match(appSource, /type: "replace_state",\s+state: \{ activeDay: draft\.setupDay, setupByDay: draft\.setupByDay \}/);
assert.match(appSource, /Recuperamos tu avance pendiente\./);
assert.match(appSource, /Se descartó 1 fila inválida\./);
assert.match(appSource, /Se descartaron \$\{draft\.recovery\.discardedRowCount\} filas inválidas\./);
assert.match(appSource, /draft\.recovery\.discardedRowCount/);
assert.doesNotMatch(appSource, /^function normalizeSetupByDay\b/m);
assert.doesNotMatch(appSource, /^function hasSetupDraftContent\b/m);

// 13. updateSetupRow y los efectos de saveInitialRoutine permanecen en el root. El parsing HTML
//     precede a acciones discriminadas y la preparación pura continúa delegada a P3-25.
assert.match(appSource, /function updateSetupRow\(/);
assert.match(appSource, /type: "update_row_field"/);
assert.match(appSource, /readWeightInput\(value, currentRow\.weight\)/);
assert.match(appSource, /readSetupNumber\(value\)/);
assert.doesNotMatch(appSource, /\{ \.\.\.row, \[field\]:/);
assert.match(appSource, /(?:async\s+)?function saveInitialRoutine\(/);
assert.match(
  appSource,
  /from "@\/features\/routine-builder\/model\/routine-builder-save";/,
);
assert.match(appSource, /resolveRoutineBuilderSavePreparation\(\{/);
assert.match(appSource, /persistenceMode: isTrainingCyclesRepositoryActive \? "cycle_scoped" : "legacy"/);
assert.match(appSource, /allowEmptyRows: isCycleScopedRoutineEdit/);
assert.match(
  appSource,
  /requiresRoutineUpdateConfirmation:\s*isChangingRoutineDays && !isTrainingCyclesRepositoryActive/,
);
assert.match(savePreparationSource, /confirmation !== "confirmed_routine_update"/);

// 14. Las ramas productivas de persistencia siguen en el root; el modulo puro no las importa.
assert.match(appSource, /if \(isTrainingCyclesRepositoryActive\)/);
assert.match(appSource, /addCycleScopedTrainingDaysAndExercises\(\{/);
assert.match(appSource, /for \(const dayToPersist of daysToPersist\)/);
assert.match(appSource, /await deleteExercise\(exerciseId, dataMode\)/);
assert.match(appSource, /await saveExercise\(\{/);
assert.doesNotMatch(
  stripComments(savePreparationSource),
  /saveExercise|deleteExercise|addCycleScopedTrainingDaysAndExercises|repository|supabase|storage/,
);

// 15. Controlador de navegación intacto: 2 escritores de pantalla, 1 de historial.
assert.equal((appSource.match(/setScreen\(/g) ?? []).length, 2, "controlador de navegacion intacto: 2 escritores autorizados");
assert.equal((appSource.match(/setScreenHistory\(/g) ?? []).length, 1, "controlador de navegacion intacto: 1 escritor de historial");

// 16. La preparación fue absorbida y los cinco tests de modelo, más este contrato, están
//     registrados exactamente una vez. La consolidacion P3-15 a P3-26 suma 122 comandos.
assert.doesNotMatch(packageSource, /routine-builder-visual-gap-preparation-contract\.test\.ts/, "el contrato de preparacion ya no debe existir");

const registration = "tsx src/features/routine-builder/routine-builder-visual-integration-contract.test.ts";
assert.equal(packageSource.split(registration).length - 1, 1);
const testCommands = (JSON.parse(packageSource) as { scripts: { test: string } }).scripts.test.split(" && ");
assert.equal(testCommands.length, 122);
for (const command of [
  "tsx src/features/routine-builder/model/routine-builder-state.test.ts",
  "tsx src/features/routine-builder/model/routine-builder-draft-normalization.test.ts",
  "tsx src/features/routine-builder/model/routine-builder-draft-recovery.test.ts",
  "tsx src/features/routine-builder/model/routine-builder-exercise-mapping.test.ts",
  "tsx src/features/routine-builder/model/routine-builder-save.test.ts",
]) {
  assert.equal(testCommands.filter((item) => item === command).length, 1, `${command} registrado una vez`);
}

// -------------------------------------------------------------------------------------------
// P3-49A — SectionHeading compartido (consumidores de Routine Builder).
//
// COMPROBACIONES ESTATICAS / SOURCE-BASED: leen el codigo fuente. NO renderizan React ni montan
// los componentes; no sustituyen QA manual del render real.
// -------------------------------------------------------------------------------------------

// (3)(4)(5) Los tres consumidores de Routine Builder: import canonico, clase y contenido exactos.
for (const [label, cardSource] of [
  ["dayCard", cards.dayCard],
  ["nameCard", cards.nameCard],
  ["exerciseCard", cards.exerciseCard],
] as const) {
  assert.match(cardSource, /import \{ SectionHeading \} from "@\/ui\/layout\/section-heading";/, label);
  assert.match(cardSource, /<SectionHeading\s+className="setup-section-heading"/, label);
  // (8) Sin bloque inline residual.
  assert.doesNotMatch(cardSource, /<div className="setup-section-heading">/, `${label}: el bloque inline debe haberse eliminado`);
}
assert.match(
  cards.dayCard,
  /eyebrow="Configura tus rutinas por día"\s+title=\{<>Rutina \{currentStep\} de \{plannedDays\.length\} · \{activeDay\}<\/>\}/,
);
assert.match(cards.nameCard, /eyebrow=\{<>Rutina del día \{day\}<\/>\}\s+title="Nombre de la rutina"/);
assert.match(cards.exerciseCard, /eyebrow=\{<>Rutina del día \{day\}<\/>\}\s+title="Ejercicios a programar"/);

// (2)(10) EXACTAMENTE cuatro consumidores en todo `src`. Este contrato SI recorre el arbol a
// proposito: P3-49A cierra el alcance, por lo que un quinto consumidor debe hacerlo fallar.
const sectionHeadingConsumers: string[] = [];
(function collectSectionHeadingConsumers(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      collectSectionHeadingConsumers(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".tsx")) continue;
    if (entryPath === "src/ui/layout/section-heading.tsx") continue;
    if (readFileSync(entryPath, "utf8").includes("@/ui/layout/section-heading")) {
      sectionHeadingConsumers.push(entryPath);
    }
  }
})("src");
assert.deepEqual(
  sectionHeadingConsumers.sort(),
  [
    "src/features/routine-builder/components/RoutineBuilderDayCard.tsx",
    "src/features/routine-builder/components/RoutineBuilderNameCard.tsx",
    "src/features/routine-builder/components/RoutineExerciseBuilderCard.tsx",
    "src/features/training-plan/components/TrainingPlanSetupCard.tsx",
  ],
  "P3-49A migra exactamente los cuatro consumidores autorizados, ni uno mas",
);

console.log("routine-builder visual static integration contract tests passed");
