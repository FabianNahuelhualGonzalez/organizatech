import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type { ExerciseEntry } from "@/lib/progress/types";
import type { CycleScopedExercise } from "./cycle-scoped-training-repository";
import {
  addFuturePlanRetiredMarker,
  analyzeCycleScopedDayEdit,
  createCycleScopedDayNotes,
  createCycleScopedRetiredExerciseNotes,
  futurePlanRetiredMarker,
  getCycleScopedExerciseDisplayNotes,
  getCycleScopedDayCoverage,
  getCycleScopedDayCodesToAdd,
  getCycleScopedDayRoutineName,
  hasFuturePlanRetiredMarker,
  isCycleScopedExerciseRetired,
  removeTechnicalMarkersForDisplay,
} from "./cycle-scoped-plan-edit";

const cycleScopedRepositorySource = readFileSync(
  "src/lib/training/cycle-scoped-training-repository.ts",
  "utf8",
);

function parseRepositorySource(source: string) {
  const sourceFile = ts.createSourceFile(
    "cycle-scoped-training-repository.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  ) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
  assert.equal(sourceFile.parseDiagnostics.length, 0, "el mutante conserva sintaxis TypeScript válida");
  return sourceFile;
}

function getCallChain(call: ts.CallExpression) {
  const operations: Array<{ method: string; arguments: readonly ts.Expression[] }> = [];
  let current: ts.Expression = call;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    operations.unshift({
      method: current.expression.name.text,
      arguments: current.arguments,
    });
    current = current.expression.expression;
  }
  return operations;
}

function isStringArgument(expression: ts.Expression | undefined, value: string) {
  return Boolean(expression && ts.isStringLiteral(expression) && expression.text === value);
}

function isNullArgument(expression: ts.Expression | undefined) {
  return expression?.kind === ts.SyntaxKind.NullKeyword;
}

function assertEditPlanLinkedEntriesDeletedAtContract(source: string) {
  const sourceFile = parseRepositorySource(source);
  const loader = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "addCycleScopedTrainingDaysAndExercises"
  ));
  assert.ok(loader?.body, "existe el loader ejecutable exacto de edición del plan");

  const matchingChains: Array<ReturnType<typeof getCallChain>> = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const chain = getCallChain(node);
      const from = chain.find((operation) => operation.method === "from");
      if (from && isStringArgument(from.arguments[0], "exercise_entries")) {
        matchingChains.push(chain);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(loader.body);

  const completeChains = matchingChains.filter((chain) => (
    chain.at(-1)?.method === "is" &&
    isStringArgument(chain.at(-1)?.arguments[0], "training_sessions.deleted_at") &&
    isNullArgument(chain.at(-1)?.arguments[1])
  ));
  assert.equal(
    completeChains.length,
    1,
    "la query exacta de linked entries contiene un único deleted_at IS NULL namespaced",
  );
  const chain = completeChains[0];
  assert.deepEqual(
    chain.map((operation) => operation.method),
    ["from", "select", "eq", "in", "eq", "is"],
    "el filtro pertenece a la cadena productiva correcta y permanece como operación terminal",
  );
  const select = chain.find((operation) => operation.method === "select");
  assert.ok(
    select &&
      ts.isStringLiteral(select.arguments[0]) &&
      select.arguments[0].text ===
        "training_cycle_exercise_id,training_sessions!inner(id,user_id,deleted_at)",
    "linked entries usa el join inner exacto con training_sessions",
  );
  assert.ok(chain.some((operation) => (
    operation.method === "eq" &&
    isStringArgument(operation.arguments[0], "user_id") &&
    operation.arguments[1]?.getText(sourceFile) === "userId"
  )));
  assert.ok(chain.some((operation) => (
    operation.method === "eq" &&
    isStringArgument(operation.arguments[0], "training_sessions.user_id") &&
    operation.arguments[1]?.getText(sourceFile) === "userId"
  )));
  assert.ok(chain.some((operation) => (
    operation.method === "in" &&
    isStringArgument(operation.arguments[0], "training_cycle_exercise_id") &&
    operation.arguments[1]?.getText(sourceFile) === "affectedExerciseIds"
  )));
}

function replaceContractLine(source: string, replacement: string) {
  const target = '      .is("training_sessions.deleted_at", null)';
  const loaderStart = source.indexOf("export async function addCycleScopedTrainingDaysAndExercises");
  const loaderEnd = source.indexOf("export async function getCycleScopedTrainingPlan", loaderStart);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, "se delimita el loader exacto para mutación");
  const loader = source.slice(loaderStart, loaderEnd);
  assert.equal(loader.split(target).length - 1, 1, "la mutación apunta al loader exacto una vez");
  return `${source.slice(0, loaderStart)}${loader.replace(target, replacement)}${source.slice(loaderEnd)}`;
}

const existingExercises = [
  createExercise("registered", "Gemelos hack"),
] satisfies CycleScopedExercise[];
const existingEntries = [
  createEntry("entry-1", "registered"),
] satisfies ExerciseEntry[];
const sessionsBefore = [{ id: "session-1", status: "completed" }];
const entriesBefore = structuredClone(existingEntries);

const edit = analyzeCycleScopedDayEdit(
  existingExercises,
  [
    { sourceExerciseId: "registered", name: "Gemelos hack", sets: 3, reps: 10, weight: 20 },
    { name: "Prensa", sets: 4, reps: 12, weight: 40 },
    { name: "Soleo", sets: 3, reps: 15, weight: 15 },
    { name: "Pantorrilla sentado", sets: 3, reps: 12, weight: 25 },
    { name: " prensa ", sets: 4, reps: 12, weight: 40 },
  ],
  new Set(["registered"]),
);

assert.deepEqual(
  edit.additions,
  [
    { name: "Prensa", targetSets: 4, targetReps: 12, baseWeight: 40, sortOrder: -1, notes: undefined },
    { name: "Soleo", targetSets: 3, targetReps: 15, baseWeight: 15, sortOrder: -1, notes: undefined },
    { name: "Pantorrilla sentado", targetSets: 3, targetReps: 12, baseWeight: 25, sortOrder: -1, notes: undefined },
  ],
  "agrega solo los ejercicios nuevos al dia cycle-scoped",
);
assert.deepEqual(edit.duplicateNames, ["prensa"], "no duplica ejercicios por nombre normalizado y dia");
assert.deepEqual(edit.removedExerciseIds, [], "mantiene el ejercicio ya registrado");
assert.deepEqual(edit.updates, [], "no modifica el ejercicio existente sin cambios");
assert.deepEqual(edit.replacements, [], "no versiona el ejercicio existente sin cambios");

const coverage = getCycleScopedDayCoverage(
  [
    ...existingExercises,
    createExercise("pending-1", "Prensa"),
    createExercise("pending-2", "Soleo"),
    createExercise("pending-3", "Pantorrilla sentado"),
  ],
  existingEntries,
);
assert.equal(coverage.status, "partial", "un ejercicio nuevo pendiente quita el estado Completado");
assert.equal(coverage.registeredCount, 1, "el ejercicio previo sigue Registrado");
assert.equal(coverage.plannedCount, 4, "los ejercicios nuevos aumentan el total planificado");
assert.deepEqual(sessionsBefore, [{ id: "session-1", status: "completed" }], "no modifica sesiones existentes");
assert.deepEqual(existingEntries, entriesBefore, "no modifica entries existentes");

const removal = analyzeCycleScopedDayEdit(existingExercises, [], new Set(["registered"]));
assert.deepEqual(
  removal.registeredRetirements,
  ["registered"],
  "retira de la planificacion futura un ejercicio con entry asociada",
);

const pendingEdit = analyzeCycleScopedDayEdit(
  [createExercise("pending", "Press plano")],
  [{ sourceExerciseId: "pending", name: "Press plano libre", sets: 4, reps: 10, weight: 45.5 }],
  new Set(),
);
assert.deepEqual(
  pendingEdit.updates,
  [{
    exerciseId: "pending",
    name: "Press plano libre",
    targetSets: 4,
    targetReps: 10,
    baseWeight: 45.5,
    sortOrder: 0,
    notes: null,
  }],
  "edita directamente un ejercicio pendiente",
);

const registeredEdit = analyzeCycleScopedDayEdit(
  existingExercises,
  [{ sourceExerciseId: "registered", name: "Gemelos hack", sets: 3, reps: 13, weight: 120 }],
  new Set(["registered"]),
);
assert.deepEqual(
  registeredEdit.replacements,
  [{
    previousExerciseId: "registered",
    name: "Gemelos hack",
    targetSets: 3,
    targetReps: 13,
    baseWeight: 120,
    sortOrder: 0,
    notes: null,
  }],
  "versiona la planificacion futura de un ejercicio registrado",
);

const pendingRemoval = analyzeCycleScopedDayEdit([createExercise("pending", "Press plano")], [], new Set());
assert.deepEqual(pendingRemoval.pendingDeletes, ["pending"], "soft-delete para pendiente sin entries");

const retiredNotes = createCycleScopedRetiredExerciseNotes("nota previa", "2026-06-15T00:00:00.000Z");
assert.equal(isCycleScopedExerciseRetired(retiredNotes), true, "marca retiro futuro sin deleted_at para registrados");
assert.equal(
  createCycleScopedRetiredExerciseNotes(null, "2026-06-15T00:00:00.000Z"),
  futurePlanRetiredMarker,
  "agrega el marcador tecnico cuando notes es null",
);
assert.equal(
  retiredNotes,
  `nota previa\n${futurePlanRetiredMarker}`,
  "preserva la nota funcional y agrega el marcador en una linea separada",
);
assert.equal(
  addFuturePlanRetiredMarker(retiredNotes),
  retiredNotes,
  "no duplica el marcador tecnico",
);
assert.equal(
  hasFuturePlanRetiredMarker(`texto con palabra retirado pero sin marcador`),
  false,
  "no interpreta palabras genericas como retiro tecnico",
);
assert.equal(
  hasFuturePlanRetiredMarker(`[organizatech:future-plan-retired-extra]`),
  false,
  "detecta solo el marcador namespaced exacto",
);
assert.equal(
  getCycleScopedExerciseDisplayNotes(retiredNotes),
  "nota previa",
  "oculta el marcador en la UI y conserva visible la nota funcional",
);
assert.equal(
  removeTechnicalMarkersForDisplay(futurePlanRetiredMarker),
  null,
  "no muestra metadata tecnica cuando no hay nota funcional",
);

assert.equal(
  getCycleScopedDayCoverage(existingExercises, existingEntries).status,
  "completed",
  "el dia queda Completado cuando todos los planificados tienen entry",
);
assert.equal(
  getCycleScopedDayCoverage(existingExercises, []).status,
  "pending",
  "el dia queda Pendiente cuando ningun ejercicio tiene entry",
);

assertEditPlanLinkedEntriesDeletedAtContract(cycleScopedRepositorySource);

const deletedAtMutations = [
  {
    name: "eliminar filtro del loader exacto",
    mutate: (source: string) => replaceContractLine(source, ""),
  },
  {
    name: "conservar filtro sólo en otro loader",
    mutate: (source: string) => `${replaceContractLine(source, "")}\nasync function decoyDeletedAtLoader() { return supabase.from("exercise_entries").is("training_sessions.deleted_at", null); }\n`,
  },
  {
    name: "dejar filtro sólo en comentario",
    mutate: (source: string) => replaceContractLine(
      source,
      '      // .is("training_sessions.deleted_at", null)',
    ),
  },
  {
    name: "dejar filtro sólo en string",
    mutate: (source: string) => replaceContractLine(
      source,
      '      && ".is(\\\"training_sessions.deleted_at\\\", null)"',
    ),
  },
  {
    name: "cambiar a deleted_at IS NOT NULL",
    mutate: (source: string) => replaceContractLine(
      source,
      '      .not("training_sessions.deleted_at", "is", null)',
    ),
  },
  {
    name: "usar filtro sin namespace",
    mutate: (source: string) => replaceContractLine(source, '      .is("deleted_at", null)'),
  },
  {
    name: "usar filtro sobre tabla incorrecta",
    mutate: (source: string) => replaceContractLine(
      source,
      '      .is("exercise_entries.deleted_at", null)',
    ),
  },
];

for (const mutation of deletedAtMutations) {
  const mutated = mutation.mutate(cycleScopedRepositorySource);
  assert.notEqual(mutated, cycleScopedRepositorySource, `mutación efectiva: ${mutation.name}`);
  assert.throws(
    () => assertEditPlanLinkedEntriesDeletedAtContract(mutated),
    `el contrato AST debe matar: ${mutation.name}`,
  );
}

assert.deepEqual(
  getCycleScopedDayCodesToAdd(
    ["monday"],
    ["friday", "monday", "wednesday", "tuesday", "thursday"],
  ),
  ["tuesday", "wednesday", "thursday", "friday"],
  "detecta solo dias faltantes y los devuelve en orden semanal",
);
assert.deepEqual(
  getCycleScopedDayCodesToAdd(
    ["monday", "tuesday"],
    ["tuesday", "monday", "tuesday"],
  ),
  [],
  "no duplica dias existentes ni repetidos en la seleccion",
);

const newDayNotes = createCycleScopedDayNotes("Espalda biceps");
assert.equal(
  getCycleScopedDayRoutineName(newDayNotes, "Rutina existente"),
  "Espalda biceps",
  "conserva el nombre visible de la rutina para un dia nuevo",
);
assert.equal(
  getCycleScopedDayRoutineName("nota legacy", "Rutina existente"),
  "Rutina existente",
  "mantiene compatibilidad con notas existentes",
);

console.log("Pruebas de edicion de plan cycle-scoped OK");

function createExercise(id: string, name: string): CycleScopedExercise {
  return {
    id,
    cycleId: "cycle-2",
    dayId: "day-1",
    name,
    targetSets: 3,
    targetReps: 10,
    baseWeight: 20,
    sideWeight: null,
    sortOrder: 0,
    notes: null,
    sourceLegacyExerciseId: null,
    exerciseLineageId: null,
  };
}

function createEntry(id: string, trainingCycleExerciseId: string): ExerciseEntry {
  return {
    id,
    sessionId: "session-1",
    cycleId: "cycle-2",
    cycleDayId: "day-1",
    trainingCycleExerciseId,
    exerciseId: trainingCycleExerciseId,
    exerciseName: "Gemelos hack",
    routine: "Lunes",
    week: 1,
    date: "2026-06-12",
    targetSets: 3,
    targetReps: 10,
    weight: 20,
    previousWeight: 20,
    reps: [10, 10, 10],
  };
}
