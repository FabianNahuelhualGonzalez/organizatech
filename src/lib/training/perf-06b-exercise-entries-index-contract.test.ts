import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import ts from "typescript";

const migrationPath =
  "supabase/migrations/20260810230028_perf_06b_exercise_entries_user_session_created_id_index.sql";
const repositoryPath = "src/lib/training/exercise-last-performance-repository.ts";
const migrationSql = readFileSync(migrationPath, "utf8");
const repositorySource = readFileSync(repositoryPath, "utf8");

type QueryOperation = {
  method: string;
  arguments: readonly ts.Expression[];
};

function stripSqlComments(source: string) {
  return source
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripSqlStrings(source: string) {
  return source.replace(/'(?:''|[^'])*'/g, "''");
}

function parseRepository(source: string) {
  const sourceFile = ts.createSourceFile(
    repositoryPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  ) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
  assert.equal(sourceFile.parseDiagnostics.length, 0, "la fuente productiva conserva sintaxis TypeScript valida");
  return sourceFile;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function getCallChain(expression: ts.Expression): QueryOperation[] {
  const operations: QueryOperation[] = [];
  let current = unwrapExpression(expression);
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    operations.unshift({
      method: current.expression.name.text,
      arguments: current.arguments,
    });
    current = unwrapExpression(current.expression.expression);
  }
  return operations;
}

function isStringArgument(expression: ts.Expression | undefined, value: string) {
  return Boolean(expression && ts.isStringLiteral(expression) && expression.text === value);
}

function isAscendingTrue(expression: ts.Expression | undefined) {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return false;
  return expression.properties.length === 1 && expression.properties.some((property) => (
    ts.isPropertyAssignment(property) &&
    ts.isIdentifier(property.name) &&
    property.name.text === "ascending" &&
    property.initializer.kind === ts.SyntaxKind.TrueKeyword
  ));
}

function findFunction(sourceFile: ts.SourceFile, name: string) {
  const matches = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ));
  assert.equal(matches.length, 1, `existe una unica funcion productiva ${name}`);
  assert.ok(matches[0].body, `${name} tiene cuerpo ejecutable`);
  return matches[0];
}

function findDataQuery(
  sourceFile: ts.SourceFile,
  body: ts.Block,
  bindingName: string,
): QueryOperation[] {
  const matches: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
      const hasBinding = node.name.elements.some((element) => (
        ts.isIdentifier(element.name) && element.name.text === bindingName
      ));
      if (hasBinding) matches.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  assert.equal(matches.length, 1, `existe una unica query enlazada a ${bindingName}`);
  const chain = getCallChain(matches[0]);
  assert.ok(chain.length > 0, `${bindingName} proviene de una cadena Supabase ejecutable`);
  assert.ok(
    isStringArgument(chain[0].arguments[0], "exercise_entries"),
    `${bindingName} consulta exactamente public.exercise_entries mediante el cliente Supabase`,
  );
  return chain;
}

function assertOperation(
  sourceFile: ts.SourceFile,
  operation: QueryOperation,
  method: string,
  column: string,
  value: string,
) {
  assert.equal(operation.method, method);
  assert.ok(isStringArgument(operation.arguments[0], column), `${method} usa ${column}`);
  assert.equal(operation.arguments[1]?.getText(sourceFile), value, `${method} ${column} conserva ${value}`);
}

function assertPerf06bContract(sqlSource: string, productSource: string) {
  const executableSql = stripSqlComments(sqlSource).trim();
  const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 1, "la migracion contiene exactamente una sentencia ejecutable");
  const indexStatement = statements[0].match(
    /^create\s+index\s+([a-z0-9_]+)\s+on\s+public\.exercise_entries\s*\(([^)]+)\)$/i,
  );
  assert.ok(indexStatement, "crea el unico indice focal exactamente sobre public.exercise_entries");
  assert.equal(
    indexStatement[1],
    "exercise_entries_session_user_lineage_created_id_idx",
    "el nombre describe las cinco columnas del indice",
  );
  const indexColumns = indexStatement[2].split(",").map((column) => column.trim().toLowerCase());
  assert.deepEqual(
    indexColumns,
    ["session_id", "user_id", "exercise_lineage_id", "created_at", "id"],
    "el indice conserva el orden exacto de cinco columnas",
  );
  assert.equal(indexColumns[0], "session_id", "session_id es el prefijo izquierdo que cubre el FK");
  assert.deepEqual(
    indexColumns.slice(0, 3),
    ["session_id", "user_id", "exercise_lineage_id"],
    "las tres igualdades productivas preceden al orden",
  );
  assert.deepEqual(
    indexColumns.slice(3),
    ["created_at", "id"],
    "created_at e id conservan el orden y desempate productivos",
  );

  const sqlWithoutStrings = stripSqlStrings(executableSql);
  assert.equal(
    (sqlWithoutStrings.match(/\bcreate\s+(?:unique\s+)?index\b/gi) ?? []).length,
    1,
    "no agrega indices adicionales o redundantes",
  );
  assert.doesNotMatch(sqlWithoutStrings, /\bdrop\s+index\b/i, "no elimina indices existentes");
  assert.doesNotMatch(
    sqlWithoutStrings,
    /\b(insert|update|delete|truncate|merge|upsert)\b/i,
    "no modifica writes ni datos",
  );
  assert.doesNotMatch(
    sqlWithoutStrings,
    /\b(create|alter|drop)\s+policy\b|\b(enable|disable|force|no\s+force)\s+row\s+level\s+security\b|\b(grant|revoke)\b/i,
    "no modifica RLS, policies ni grants",
  );
  assert.doesNotMatch(sqlWithoutStrings, /\binclude\s*\(/i, "no agrega columnas INCLUDE sin evidencia");
  assert.doesNotMatch(sqlWithoutStrings, /\bconcurrently\b/i, "mantiene compatibilidad transaccional del runner");

  const sourceFile = parseRepository(productSource);
  const repository = findFunction(sourceFile, "getLatestExercisePerformanceByLineage");
  const candidateQuery = findDataQuery(sourceFile, repository.body!, "candidates");
  const sessionEntriesQuery = findDataQuery(sourceFile, repository.body!, "sessionEntries");

  assert.deepEqual(
    candidateQuery.map((operation) => operation.method),
    ["from", "select", "eq", "eq", "eq", "eq", "is"],
    "la busqueda lineage-wide conserva su cadena productiva exacta",
  );
  assert.ok(isStringArgument(
    candidateQuery[1].arguments[0],
    "id,user_id,session_id,exercise_lineage_id,weight,previous_weight,reps,rir,notes,created_at,training_sessions!inner(id,user_id,status,trained_date,trained_at,completed_at,deleted_at,created_at)",
  ), "la busqueda lineage-wide conserva sus columnas seleccionadas");
  assertOperation(sourceFile, candidateQuery[2], "eq", "user_id", "userId");
  assertOperation(sourceFile, candidateQuery[3], "eq", "exercise_lineage_id", "exerciseLineageId");
  assertOperation(sourceFile, candidateQuery[4], "eq", "training_sessions.user_id", "userId");
  assertOperation(sourceFile, candidateQuery[5], "eq", "training_sessions.status", '"completed"');
  assert.equal(candidateQuery[6].method, "is");
  assert.ok(isStringArgument(candidateQuery[6].arguments[0], "training_sessions.deleted_at"));
  assert.equal(candidateQuery[6].arguments[1]?.kind, ts.SyntaxKind.NullKeyword);

  assert.deepEqual(
    sessionEntriesQuery.map((operation) => operation.method),
    ["from", "select", "eq", "eq", "eq", "order", "order"],
    "la query critica conserva filtros y desempate productivos exactos",
  );
  assert.ok(isStringArgument(
    sessionEntriesQuery[1].arguments[0],
    "id,user_id,session_id,exercise_lineage_id,weight,previous_weight,reps,rir,notes,created_at",
  ), "la query critica conserva sus columnas seleccionadas");
  assertOperation(sourceFile, sessionEntriesQuery[2], "eq", "user_id", "userId");
  assertOperation(sourceFile, sessionEntriesQuery[3], "eq", "session_id", "latestSession.id");
  assertOperation(sourceFile, sessionEntriesQuery[4], "eq", "exercise_lineage_id", "exerciseLineageId");
  assert.equal(sessionEntriesQuery[5].method, "order");
  assert.ok(isStringArgument(sessionEntriesQuery[5].arguments[0], "created_at"));
  assert.ok(isAscendingTrue(sessionEntriesQuery[5].arguments[1]));
  assert.equal(sessionEntriesQuery[6].method, "order");
  assert.ok(isStringArgument(sessionEntriesQuery[6].arguments[0], "id"));
  assert.ok(isAscendingTrue(sessionEntriesQuery[6].arguments[1]));

  const forbiddenWrites: string[] = [];
  const visitWrites = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["insert", "update", "upsert", "delete"].includes(node.expression.name.text)
    ) forbiddenWrites.push(node.expression.name.text);
    ts.forEachChild(node, visitWrites);
  };
  visitWrites(repository.body!);
  assert.deepEqual(forbiddenWrites, [], "el repository inspeccionado permanece read-only");
}

function replaceOnce(source: string, target: string, replacement: string) {
  assert.equal(source.split(target).length - 1, 1, `el mutation probe encuentra una vez: ${target}`);
  return source.replace(target, replacement);
}

assertPerf06bContract(migrationSql, repositorySource);

const sqlMutations = [
  {
    name: "mover session_id fuera de la primera posicion",
    source: migrationSql.replace(
      "session_id, user_id, exercise_lineage_id, created_at, id",
      "user_id, session_id, exercise_lineage_id, created_at, id",
    ),
  },
  {
    name: "omitir exercise_lineage_id",
    source: migrationSql.replace(
      "session_id, user_id, exercise_lineage_id, created_at, id",
      "session_id, user_id, created_at, id",
    ),
  },
  {
    name: "reordenar created_at e id",
    source: migrationSql.replace(
      "session_id, user_id, exercise_lineage_id, created_at, id",
      "session_id, user_id, exercise_lineage_id, id, created_at",
    ),
  },
  {
    name: "restaurar forma anterior de cuatro columnas",
    source: migrationSql.replace(
      "session_id, user_id, exercise_lineage_id, created_at, id",
      "user_id, session_id, created_at, id",
    ),
  },
  {
    name: "mover una igualdad despues del orden",
    source: migrationSql.replace(
      "session_id, user_id, exercise_lineage_id, created_at, id",
      "session_id, user_id, created_at, exercise_lineage_id, id",
    ),
  },
  {
    name: "agregar indice redundante",
    source: `${migrationSql}\ncreate index exercise_entries_session_redundant_idx on public.exercise_entries (session_id);\n`,
  },
  {
    name: "forma correcta solo en comentario",
    source: `-- ${migrationSql.trim()}\n`,
  },
  {
    name: "forma correcta solo en string",
    source: `select '${migrationSql.trim().replaceAll("'", "''")}';\n`,
  },
];

for (const mutation of sqlMutations) {
  assert.notEqual(mutation.source, migrationSql, `mutation probe efectivo: ${mutation.name}`);
  assert.throws(
    () => assertPerf06bContract(mutation.source, repositorySource),
    `el contrato mata la mutacion SQL: ${mutation.name}`,
  );
}

const queryMutations = [
  {
    name: "modificar filtro session_id",
    source: replaceOnce(
      repositorySource,
      '.eq("session_id", latestSession.id)',
      '.eq("session_id", input.currentSessionId)',
    ),
  },
  {
    name: "quitar created_at del orden productivo",
    source: replaceOnce(
      repositorySource,
      '    .order("created_at", { ascending: true })\n    .order("id", { ascending: true });',
      '    .order("id", { ascending: true });',
    ),
  },
  {
    name: "quitar filtro lineage-wide",
    source: replaceOnce(
      repositorySource,
      '    .eq("exercise_lineage_id", exerciseLineageId)\n    .eq("training_sessions.user_id", userId)',
      '    .eq("training_sessions.user_id", userId)',
    ),
  },
  {
    name: "forma de orden correcta solo en comentario y string",
    source: replaceOnce(
      repositorySource,
      '    .order("created_at", { ascending: true })\n    .order("id", { ascending: true });',
      '    .order("created_at", { ascending: true });\n  const perf06bOrderDecoy = ".order(\\\"id\\\", { ascending: true })"; // .order("id", { ascending: true })',
    ),
  },
];

for (const mutation of queryMutations) {
  assert.notEqual(mutation.source, repositorySource, `mutation probe efectivo: ${mutation.name}`);
  assert.throws(
    () => assertPerf06bContract(migrationSql, mutation.source),
    `el contrato mata la mutacion productiva: ${mutation.name}`,
  );
}

console.log("PERF-06B exercise_entries index contract and mutation probes passed");
