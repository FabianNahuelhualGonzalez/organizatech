import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

const rootPath = "src/components/organizatech-app.tsx";
const packagePath = "package.json";
const registration = "src/features/active-workout/perf-03-root-wiring-contract.test.ts";
const controllerRegistration =
  "src/features/active-workout/model/active-workout-history-prefetch-controller.test.ts";
const controllerModule =
  "@/features/active-workout/model/active-workout-history-prefetch-controller";
const rootSource = readFileSync(rootPath, "utf8");
const contractPath = "src/features/active-workout/perf-03-root-wiring-contract.test.ts";
const validateOnly = process.argv.includes("--validate-only");

function parseRoot(source: string) {
  return ts.createSourceFile(
    rootPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!property.name) return null;
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
    ? property.name.text
    : null;
}

function findVariableInitializer(
  root: ts.Node,
  variableName: string,
): ts.Expression {
  const matches: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName &&
      node.initializer
    ) {
      matches.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.equal(matches.length, 1, `${variableName} debe tener una sola derivación`);
  return matches[0];
}

function getUseMemoResult(initializer: ts.Expression, variableName: string): ts.Expression {
  const call = unwrapExpression(initializer);
  assert.ok(ts.isCallExpression(call), `${variableName} debe usar useMemo`);
  assert.ok(ts.isIdentifier(call.expression) && call.expression.text === "useMemo");
  const callback = call.arguments[0];
  assert.ok(callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)));
  if (!ts.isBlock(callback.body)) return unwrapExpression(callback.body);
  const returns = callback.body.statements.filter(ts.isReturnStatement);
  assert.equal(returns.length, 1, `${variableName} debe tener un único return`);
  assert.ok(returns[0].expression);
  return unwrapExpression(returns[0].expression);
}

function getUseMemoDependencies(initializer: ts.Expression, variableName: string) {
  const call = unwrapExpression(initializer);
  assert.ok(ts.isCallExpression(call), `${variableName} debe usar useMemo`);
  const dependencies = call.arguments[1];
  assert.ok(ts.isArrayLiteralExpression(dependencies), `${variableName} requiere dependencias estables`);
  return dependencies.elements;
}

function findObjectMember(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike {
  const matches = object.properties.filter((property) => propertyName(property) === name);
  assert.equal(matches.length, 1, `${name} debe aparecer exactamente una vez`);
  return matches[0];
}

function findObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment {
  const member = findObjectMember(object, name);
  assert.ok(ts.isPropertyAssignment(member), `${name} debe ser una asignación explícita`);
  return member;
}

function assertPropertyAccess(
  expression: ts.Expression,
  objectName: string,
  memberName: string,
) {
  const value = unwrapExpression(expression);
  assert.ok(ts.isPropertyAccessExpression(value));
  assert.ok(ts.isIdentifier(value.expression) && value.expression.text === objectName);
  assert.equal(value.name.text, memberName);
}

function assertNoForbiddenNodes(root: ts.Node, label: string) {
  const forbidden: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["Map", "Set", "WeakMap", "WeakSet"].includes(node.expression.text)
    ) {
      forbidden.push(`new ${node.expression.text}`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["useState", "useRef"].includes(node.expression.text)
    ) {
      forbidden.push(node.expression.text);
    }
    if (
      (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
      /observation/i.test(node.text)
    ) {
      forbidden.push(node.text);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ["slice", "sort", "reverse", "toSorted"].includes(node.name.text)
    ) {
      forbidden.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.deepEqual(forbidden, [], `${label} no puede limitar, reordenar, cachear ni precargar observaciones`);
}

function analyzeRootWiring(source: string) {
  const sourceFile = parseRoot(source);
  const appRoots = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "OrganizatechApp"
  );
  assert.equal(appRoots.length, 1, "debe existir un único composition root OrganizatechApp");
  const appRoot = appRoots[0];
  const forbiddenControllerImports = sourceFile.statements.filter((statement) =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === controllerModule
  );
  assert.equal(forbiddenControllerImports.length, 0, "el root no importa el controller interno");

  const hookCalls: ts.CallExpression[] = [];
  const visitHookCalls = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useActiveWorkoutExerciseHistory"
    ) {
      hookCalls.push(node);
    }
    ts.forEachChild(node, visitHookCalls);
  };
  visitHookCalls(appRoot);
  assert.equal(hookCalls.length, 1, "el root debe invocar una sola vez el hook de historial");
  assert.equal(hookCalls[0].arguments.length, 1);
  const hookInput = unwrapExpression(hookCalls[0].arguments[0]);
  assert.ok(ts.isObjectLiteralExpression(hookInput));

  const historyScopeInput = findObjectProperty(hookInput, "historyScope");
  assert.ok(
    ts.isIdentifier(historyScopeInput.initializer) &&
    historyScopeInput.initializer.text === "activeWorkoutHistoryScope",
  );
  const lineageInput = findObjectMember(hookInput, "performancePrefetchLineageIds");
  assert.ok(
    ts.isShorthandPropertyAssignment(lineageInput) &&
    lineageInput.name.text === "performancePrefetchLineageIds",
    "el root entrega la lista completa sin recortarla",
  );

  const historyInitializer = findVariableInitializer(appRoot, "activeWorkoutHistoryScope");
  const historyObject = getUseMemoResult(historyInitializer, "activeWorkoutHistoryScope");
  assert.ok(ts.isObjectLiteralExpression(historyObject));
  assert.deepEqual(
    historyObject.properties.map(propertyName),
    ["source", "cycleId"],
    "historyScope no expone identidad, token ni sesión cruda",
  );

  const sourceProperty = findObjectProperty(historyObject, "source");
  const sourceValue = unwrapExpression(sourceProperty.initializer);
  assert.ok(ts.isConditionalExpression(sourceValue));
  assert.ok(
    ts.isIdentifier(sourceValue.condition) &&
    sourceValue.condition.text === "isCycleScopedActiveCycle",
    "source debe usar el modo cycle-scoped canónico",
  );
  const whenCycleScoped = unwrapExpression(sourceValue.whenTrue);
  const whenLegacy = unwrapExpression(sourceValue.whenFalse);
  assert.ok(ts.isStringLiteral(whenCycleScoped) && whenCycleScoped.text === "cycle-scoped");
  assert.ok(ts.isStringLiteral(whenLegacy) && whenLegacy.text === "legacy");

  const cycleIdProperty = findObjectProperty(historyObject, "cycleId");
  const cycleIdValue = unwrapExpression(cycleIdProperty.initializer);
  assert.ok(ts.isBinaryExpression(cycleIdValue));
  assert.equal(cycleIdValue.operatorToken.kind, ts.SyntaxKind.QuestionQuestionToken);
  assertPropertyAccess(cycleIdValue.left, "persistedActiveCycle", "id");
  assert.equal(unwrapExpression(cycleIdValue.right).kind, ts.SyntaxKind.NullKeyword);

  const historyDependencies = getUseMemoDependencies(
    historyInitializer,
    "activeWorkoutHistoryScope",
  );
  assert.equal(historyDependencies.length, 2);
  assert.ok(
    ts.isIdentifier(historyDependencies[0]) &&
    historyDependencies[0].text === "isCycleScopedActiveCycle",
  );
  assertPropertyAccess(historyDependencies[1], "persistedActiveCycle", "id");
  assertNoForbiddenNodes(historyInitializer, "historyScope");

  const dayExercisesInitializer = findVariableInitializer(appRoot, "dayExercises");
  const dayExercisesResult = getUseMemoResult(dayExercisesInitializer, "dayExercises");
  assert.ok(ts.isCallExpression(dayExercisesResult));
  assert.ok(ts.isPropertyAccessExpression(dayExercisesResult.expression));
  assert.equal(dayExercisesResult.expression.name.text, "filter");
  assert.ok(
    ts.isIdentifier(dayExercisesResult.expression.expression) &&
    dayExercisesResult.expression.expression.text === "displayExercises",
  );
  assert.equal(dayExercisesResult.arguments.length, 1);
  const dayFilterCallback = dayExercisesResult.arguments[0];
  assert.ok(dayFilterCallback && ts.isArrowFunction(dayFilterCallback));
  assert.equal(
    dayFilterCallback.parameters.length,
    1,
    "el filtro canónico no recibe index ni parámetros de cardinalidad",
  );
  const dayExerciseParameter = dayFilterCallback.parameters[0].name;
  assert.ok(ts.isIdentifier(dayExerciseParameter) && dayExerciseParameter.text === "exercise");
  assert.ok(!ts.isBlock(dayFilterCallback.body));
  const daySelection = unwrapExpression(dayFilterCallback.body);
  assert.ok(ts.isBinaryExpression(daySelection));
  assert.equal(
    daySelection.operatorToken.kind,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    "el callback sólo puede aplicar igualdad por día",
  );
  const selectedDay = unwrapExpression(daySelection.left);
  assert.ok(ts.isBinaryExpression(selectedDay));
  assert.equal(selectedDay.operatorToken.kind, ts.SyntaxKind.QuestionQuestionToken);
  assertPropertyAccess(selectedDay.left, "exercise", "day");
  assert.ok(ts.isIdentifier(selectedDay.right) && selectedDay.right.text === "visibleDay");
  assert.ok(ts.isIdentifier(daySelection.right) && daySelection.right.text === "visibleDay");
  const dayDependencies = getUseMemoDependencies(dayExercisesInitializer, "dayExercises");
  assert.equal(dayDependencies.length, 2);
  assert.ok(ts.isIdentifier(dayDependencies[0]) && dayDependencies[0].text === "displayExercises");
  assert.ok(ts.isIdentifier(dayDependencies[1]) && dayDependencies[1].text === "visibleDay");
  assertNoForbiddenNodes(dayExercisesInitializer, "dayExercises");

  const lineageInitializer = findVariableInitializer(
    appRoot,
    "performancePrefetchLineageIds",
  );
  const lineageResult = getUseMemoResult(
    lineageInitializer,
    "performancePrefetchLineageIds",
  );
  assert.ok(ts.isCallExpression(lineageResult));
  assert.ok(ts.isPropertyAccessExpression(lineageResult.expression));
  assert.equal(lineageResult.expression.name.text, "filter");
  const mapCall = unwrapExpression(lineageResult.expression.expression);
  assert.ok(ts.isCallExpression(mapCall));
  assert.ok(ts.isPropertyAccessExpression(mapCall.expression));
  assert.equal(mapCall.expression.name.text, "map");
  assert.ok(
    ts.isIdentifier(mapCall.expression.expression) &&
    mapCall.expression.expression.text === "dayExercises",
    "lineages deben preservar el orden del día canónico",
  );
  assert.equal(
    lineageResult.arguments.length,
    1,
    "el filter final debe recibir exactamente un callback",
  );
  const lineageFilterCallback = lineageResult.arguments[0];
  assert.ok(
    lineageFilterCallback && ts.isArrowFunction(lineageFilterCallback),
    "el callback del filter final debe ser ArrowFunction",
  );
  assert.equal(
    lineageFilterCallback.parameters.length,
    1,
    "el filter final debe recibir un único parámetro lineageId sin index",
  );
  const lineageFilterParameter = lineageFilterCallback.parameters[0];
  assert.ok(
    ts.isIdentifier(lineageFilterParameter.name) &&
    lineageFilterParameter.name.text === "lineageId",
    "el parámetro del filter final debe ser el Identifier lineageId",
  );
  const lineageTypePredicate = lineageFilterCallback.type;
  assert.ok(
    lineageTypePredicate && ts.isTypePredicateNode(lineageTypePredicate),
    "el filter final requiere el type predicate lineageId is string",
  );
  assert.equal(lineageTypePredicate.assertsModifier, undefined);
  assert.ok(
    ts.isIdentifier(lineageTypePredicate.parameterName) &&
    lineageTypePredicate.parameterName.text === "lineageId" &&
    lineageTypePredicate.type?.kind === ts.SyntaxKind.StringKeyword,
    "el type predicate debe ser exactamente lineageId is string",
  );
  assert.ok(
    !ts.isBlock(lineageFilterCallback.body),
    "el callback del filter final debe tener cuerpo ejecutable sin bloque",
  );
  assert.ok(
    ts.isBinaryExpression(lineageFilterCallback.body),
    "la expresión del filter final debe ser exactamente lineageId !== null",
  );
  assert.equal(
    lineageFilterCallback.body.operatorToken.kind,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    "el operador del filter final debe ser exactamente !==",
  );
  assert.ok(
    ts.isIdentifier(lineageFilterCallback.body.left) &&
    lineageFilterCallback.body.left.text === lineageFilterParameter.name.text,
    "el operando izquierdo del filter final debe ser el mismo parámetro lineageId",
  );
  assert.equal(
    lineageFilterCallback.body.right.kind,
    ts.SyntaxKind.NullKeyword,
    "el operando derecho del filter final debe ser null",
  );
  const mapCallback = mapCall.arguments[0];
  assert.ok(mapCallback && ts.isArrowFunction(mapCallback));
  assert.ok(!ts.isBlock(mapCallback.body));
  const mappedLineage = unwrapExpression(mapCallback.body);
  assert.ok(ts.isCallExpression(mappedLineage));
  assert.ok(
    ts.isIdentifier(mappedLineage.expression) &&
    mappedLineage.expression.text === "normalizeExerciseLineageId",
  );
  assert.equal(mappedLineage.arguments.length, 1);
  assert.ok(ts.isPropertyAccessExpression(mappedLineage.arguments[0]));
  assert.equal(mappedLineage.arguments[0].name.text, "exerciseLineageId");
  assertNoForbiddenNodes(lineageInitializer, "performancePrefetchLineageIds");

  const lineageDependencies = getUseMemoDependencies(
    lineageInitializer,
    "performancePrefetchLineageIds",
  );
  assert.equal(lineageDependencies.length, 1);
  assert.ok(ts.isIdentifier(lineageDependencies[0]) && lineageDependencies[0].text === "dayExercises");
}

function replaceOnce(source: string, search: string, replacement: string) {
  assert.equal(source.split(search).length - 1, 1, `mutation marker must be unique: ${search}`);
  return source.replace(search, replacement);
}

function assertMutationKilled(name: string, mutate: (source: string) => string) {
  const mutation = mutate(rootSource);
  assert.notEqual(mutation, rootSource, `${name}: la mutación debe ser efectiva`);
  assert.throws(() => analyzeRootWiring(mutation), `${name}: el contrato debe matar la mutación`);
}

interface ExecutableProbeResult {
  name: string;
  mutationExitCode: number;
  baselineExitCode: number;
  failureMarker: string;
  beforeSha256: string;
  afterSha256: string;
}

function runExecutableAstContract() {
  return spawnSync(resolve("node_modules/.bin/tsx"), [contractPath, "--validate-only"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe",
  });
}

function assertExecutableMutationKilled(
  name: string,
  search: string,
  replacement: string,
  expectedFailureMarker: string,
): ExecutableProbeResult {
  const originalBytes = readFileSync(rootPath);
  const originalSource = originalBytes.toString("utf8");
  const beforeSha256 = createHash("sha256").update(originalBytes).digest("hex");
  const mutation = replaceOnce(originalSource, search, replacement);
  assert.notEqual(mutation, originalSource, `${name}: la mutación debe aplicarse`);
  const parsedMutation = parseRoot(mutation) as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  };
  assert.equal(parsedMutation.parseDiagnostics.length, 0, `${name}: la sintaxis debe ser válida`);

  let mutationExitCode: number | null = null;
  try {
    writeFileSync(rootPath, mutation, "utf8");
    const mutationRun = runExecutableAstContract();
    mutationExitCode = mutationRun.status;
    assert.notEqual(mutationExitCode, null, `${name}: el contrato AST real debe terminar con exit code`);
    assert.notEqual(mutationExitCode, 0, `${name}: el contrato AST real debe fallar`);
    const mutationOutput = `${mutationRun.stdout}\n${mutationRun.stderr}`;
    assert.ok(
      mutationOutput.includes(expectedFailureMarker),
      `${name}: debe fallar por la causa AST esperada: ${expectedFailureMarker}`,
    );
  } finally {
    writeFileSync(rootPath, originalBytes);
  }

  const restoredBytes = readFileSync(rootPath);
  const afterSha256 = createHash("sha256").update(restoredBytes).digest("hex");
  assert.ok(restoredBytes.equals(originalBytes), `${name}: restauración byte a byte`);
  assert.equal(afterSha256, beforeSha256, `${name}: restauración SHA-256`);

  const baselineRun = runExecutableAstContract();
  assert.equal(baselineRun.status, 0, `${name}: baseline posterior debe pasar`);
  if (mutationExitCode === null) {
    throw new Error(`${name}: el proceso mutado terminó sin exit code`);
  }
  return {
    name,
    mutationExitCode,
    baselineExitCode: baselineRun.status,
    failureMarker: expectedFailureMarker,
    beforeSha256,
    afterSha256,
  };
}

if (validateOnly) {
  analyzeRootWiring(rootSource);
  console.log("PERF-03 root AST wiring validate-only passed");
} else {
  const beforeMutationHash = createHash("sha256").update(readFileSync(rootPath)).digest("hex");
  analyzeRootWiring(rootSource);

assertMutationKilled("omitir historyScope", (source) => replaceOnce(
  source,
  "    historyScope: activeWorkoutHistoryScope,\n",
  "",
));
assertMutationKilled("forzar legacy", (source) => replaceOnce(
  source,
  "    source: isCycleScopedActiveCycle ? \"cycle-scoped\" as const : \"legacy\" as const,",
  "    source: \"legacy\" as const,",
));
assertMutationKilled("forzar cycle-scoped", (source) => replaceOnce(
  source,
  "    source: isCycleScopedActiveCycle ? \"cycle-scoped\" as const : \"legacy\" as const,",
  "    source: \"cycle-scoped\" as const,",
));
assertMutationKilled("forzar cycleId null", (source) => replaceOnce(
  source,
  "    source: isCycleScopedActiveCycle ? \"cycle-scoped\" as const : \"legacy\" as const,\n    cycleId: persistedActiveCycle?.id ?? null,",
  "    source: isCycleScopedActiveCycle ? \"cycle-scoped\" as const : \"legacy\" as const,\n    cycleId: null,",
));
assertMutationKilled("entregar sólo el ejercicio activo", (source) => replaceOnce(
  source,
  "    performancePrefetchLineageIds,\n",
  "    performancePrefetchLineageIds: activeWorkoutExerciseLineageId ? [activeWorkoutExerciseLineageId] : [],\n",
));
assertMutationKilled("recortar a dos en el root", (source) => replaceOnce(
  source,
  "    performancePrefetchLineageIds,\n",
  "    performancePrefetchLineageIds: performancePrefetchLineageIds.slice(0, 2),\n",
));
assertMutationKilled("reordenar lineages", (source) => replaceOnce(
  source,
  "      .filter((lineageId): lineageId is string => lineageId !== null),",
  "      .filter((lineageId): lineageId is string => lineageId !== null).reverse(),",
));
assertMutationKilled("importar controller en el root", (source) =>
  `import { createActiveWorkoutHistoryPrefetchController } from "${controllerModule}";\n${source}`
);
assertMutationKilled("conectar observaciones al prefetch", (source) => replaceOnce(
  source,
  "normalizeExerciseLineageId(exercise.exerciseLineageId)",
  "normalizeExerciseLineageId(exercise.observation)",
));
assertMutationKilled("dejar símbolos sólo en comentarios", (source) => {
  const withoutHistoryScope = replaceOnce(
    source,
    "    historyScope: activeWorkoutHistoryScope,\n",
    "",
  );
  const withoutLineages = replaceOnce(
    withoutHistoryScope,
    "    performancePrefetchLineageIds,\n",
    "",
  );
  return `${withoutLineages}\n// historyScope performancePrefetchLineageIds\n`;
});

  const executableProbeResults = [
    assertExecutableMutationKilled(
      "upstream dayExercises index < 2",
      "    () => displayExercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay),",
      `    () => displayExercises.filter(
      (exercise, index) =>
        (exercise.day ?? visibleDay) === visibleDay && index < 2,
    ),`,
      "el filtro canónico no recibe index ni parámetros de cardinalidad",
    ),
    assertExecutableMutationKilled(
      "segundo filter index < 2",
      `    () => dayExercises
      .map((exercise) => normalizeExerciseLineageId(exercise.exerciseLineageId))`,
      `    () => dayExercises
      .filter((exercise, index) => index < 2)
      .map((exercise) => normalizeExerciseLineageId(exercise.exerciseLineageId))`,
      "lineages deben preservar el orden del día canónico",
    ),
    assertExecutableMutationKilled(
      "upstream dayExercises index <= 1",
      "    () => displayExercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay),",
      `    () => displayExercises.filter(
      (exercise, index) =>
        (exercise.day ?? visibleDay) === visibleDay && index <= 1,
    ),`,
      "el filtro canónico no recibe index ni parámetros de cardinalidad",
    ),
    assertExecutableMutationKilled(
      "símbolo index < 2 sólo en comentario",
      "    () => displayExercises.filter((exercise) => (exercise.day ?? visibleDay) === visibleDay),",
      `    () => displayExercises.filter(
      (exercise, position) =>
        (exercise.day ?? visibleDay) === visibleDay && position <= 1, // index < 2
    ),`,
      "el filtro canónico no recibe index ni parámetros de cardinalidad",
    ),
    assertExecutableMutationKilled(
      "filter final index < 2",
      "      .filter((lineageId): lineageId is string => lineageId !== null),",
      `      .filter(
        (lineageId, index): lineageId is string =>
          lineageId !== null && index < 2,
      ),`,
      "el filter final debe recibir un único parámetro lineageId sin index",
    ),
    assertExecutableMutationKilled(
      "filter final index <= 1",
      "      .filter((lineageId): lineageId is string => lineageId !== null),",
      `      .filter(
        (lineageId, index): lineageId is string =>
          lineageId !== null && index <= 1,
      ),`,
      "el filter final debe recibir un único parámetro lineageId sin index",
    ),
    assertExecutableMutationKilled(
      "filter final helper adicional",
      "      .filter((lineageId): lineageId is string => lineageId !== null),",
      `      .filter(
        (lineageId): lineageId is string =>
          lineageId !== null && shouldPrefetch(lineageId),
      ),`,
      "el operador del filter final debe ser exactamente !==",
    ),
    assertExecutableMutationKilled(
      "filter final callback con bloque y return limitado",
      "      .filter((lineageId): lineageId is string => lineageId !== null),",
      `      .filter((lineageId): lineageId is string => {
        return lineageId !== null && dayExercises.length <= 2;
      }),`,
      "el callback del filter final debe tener cuerpo ejecutable sin bloque",
    ),
    assertExecutableMutationKilled(
      "filter final símbolo correcto sólo en comentario",
      "      .filter((lineageId): lineageId is string => lineageId !== null),",
      `      .filter(
        (lineageId): lineageId is string =>
          dayExercises.length <= 2, // lineageId !== null
      ),`,
      "el operador del filter final debe ser exactamente !==",
    ),
  ];

  const afterMutationHash = createHash("sha256").update(readFileSync(rootPath)).digest("hex");
  assert.equal(afterMutationHash, beforeMutationHash, "las mutaciones dejan el root byte-idéntico");

  const packageManifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
    scripts: Record<string, string>;
  };
  const scriptReferences = Object.values(packageManifest.scripts).join("\n");
  assert.equal(scriptReferences.split(registration).length - 1, 1);
  assert.equal(scriptReferences.split(controllerRegistration).length - 1, 1);

  console.log(JSON.stringify({
    message: "PERF-03 root AST wiring contract and 19 mutation probes passed",
    executableProbeResults,
  }));
}
