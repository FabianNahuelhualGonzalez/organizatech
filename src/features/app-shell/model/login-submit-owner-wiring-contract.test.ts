import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const ROOT_PATH = "src/components/organizatech-app.tsx";
const PACKAGE_PATH = "package.json";
const REQUIRED_PERF_REGISTRATIONS = [
  "src/features/app-shell/model/login-performance-harness.test.ts",
  "src/features/app-shell/model/login-submit-owner.test.ts",
  "src/lib/training/cycle-scoped-training-repository.test.ts",
] as const;

function parseRoot(source: string) {
  const sourceFile = ts.createSourceFile(
    ROOT_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const diagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  assert.deepEqual(diagnostics, [], "el probe debe conservar sintaxis TSX válida");
  return sourceFile;
}

function propertyPath(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return `${propertyPath(expression.expression)}.${expression.name.text}`;
  }
  if (ts.isNonNullExpression(expression)) return propertyPath(expression.expression);
  return "";
}

function collect<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T,
) {
  const matches: T[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function findHandleAuth(sourceFile: ts.SourceFile) {
  const declarations = collect(
    sourceFile,
    (node): node is ts.FunctionDeclaration => (
      ts.isFunctionDeclaration(node) && node.name?.text === "handleAuth"
    ),
  );
  assert.equal(declarations.length, 1, "handleAuth debe tener un único owner productivo");
  return declarations[0];
}

function callByPath(root: ts.Node, expectedPath: string) {
  return collect(
    root,
    (node): node is ts.CallExpression => (
      ts.isCallExpression(node) && propertyPath(node.expression) === expectedPath
    ),
  );
}

function assertLoginOwnerWiring(source: string) {
  const sourceFile = parseRoot(source);
  const imports = sourceFile.statements.filter(ts.isImportDeclaration).filter((declaration) => (
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    declaration.moduleSpecifier.text === "@/features/app-shell/model/login-submit-owner"
  ));
  assert.equal(imports.length, 1, "Login Owner debe importarse ejecutablemente una vez");

  assert.equal(
    callByPath(sourceFile, "createLoginSubmitOwnerController").length,
    1,
    "el owner debe crearse una vez por instancia y no quedar sólo en comentario",
  );
  assert.equal(callByPath(sourceFile, "controller.dispose").length, 1, "unmount debe hacer dispose");

  const handleAuth = findHandleAuth(sourceFile);
  const acquireCalls = callByPath(handleAuth, "loginSubmitOwnerController.acquire");
  const signInCalls = callByPath(handleAuth, "supabase.auth.signInWithPassword");
  const settleCalls = callByPath(handleAuth, "loginSubmitOwnerController.settle");
  assert.equal(acquireCalls.length, 1, "login debe adquirir exactamente un owner");
  assert.equal(signInCalls.length, 1, "login debe emitir exactamente un signInWithPassword");
  assert.equal(settleCalls.length, 1, "la respuesta de auth debe pasar por settle(owner)");
  assert.ok(acquireCalls[0].getStart() < signInCalls[0].getStart(), "el lock debe preceder signIn");
  const settleAwait = settleCalls[0].parent;
  assert.ok(ts.isAwaitExpression(settleAwait), "settle debe awaited en el branch login");
  assert.ok(acquireCalls[0].getStart() < settleAwait.getStart(), "el lock debe preceder el await de login");
  assert.equal(
    collect(settleCalls[0], (node): node is ts.CallExpression => (
      ts.isCallExpression(node) && propertyPath(node.expression) === "supabase.auth.signInWithPassword"
    )).length,
    1,
    "signInWithPassword debe estar conectado al settlement del owner",
  );

  const authTry = collect(handleAuth, (node): node is ts.TryStatement => ts.isTryStatement(node))
    .find((statement) => callByPath(statement.tryBlock, "supabase.auth.signInWithPassword").length === 1);
  assert.ok(authTry?.finallyBlock, "login debe finalizar en finally");
  const finallyText = authTry.finallyBlock.getText(sourceFile);
  assert.match(
    finallyText,
    /const canFinalizeAuthAttempt = loginSubmitOwner && loginSubmitOwnerController[\s\S]*loginSubmitOwnerController\.finalize\(loginSubmitOwner\)[\s\S]*const canFinalizePortalResolution[\s\S]*const canFinalizeCoachRegistration[\s\S]*const canFinalizeUserRegistration[\s\S]*if \(\s*canFinalizeAuthAttempt\s*&& canFinalizePortalResolution\s*&& canFinalizeCoachRegistration\s*&& canFinalizeUserRegistration\s*\)/,
    "finally sólo puede liberar UI y owners tras comprobar Login, portal y ambos registros vigentes",
  );

  const signedOutBranches = collect(sourceFile, (node): node is ts.IfStatement => {
    if (!ts.isIfStatement(node)) return false;
    const condition = node.expression.getText(sourceFile);
    return condition === 'event === "SIGNED_OUT"';
  });
  assert.equal(signedOutBranches.length, 1, "SIGNED_OUT debe tener una rama única");
  const signedOutInvalidations = callByPath(
    signedOutBranches[0].thenStatement,
    "loginSubmitOwnerRef.current.invalidate",
  );
  const signedOutClears = callByPath(signedOutBranches[0].thenStatement, "clearUserSessionState");
  assert.equal(signedOutInvalidations.length, 1, "SIGNED_OUT debe invalidar Login Owner ejecutablemente");
  assert.ok(
    signedOutClears.length === 0 || signedOutInvalidations[0].getStart() < signedOutClears[0].getStart(),
    "SIGNED_OUT invalida antes de limpiar/admitir otro login",
  );

  const properties = collect(
    sourceFile,
    (node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node),
  );
  const newIdentity = properties.find((property) => property.name.getText(sourceFile) === "applyNewIdentitySession");
  const sameIdentity = properties.find((property) => property.name.getText(sourceFile) === "applySameIdentitySession");
  assert.ok(newIdentity?.initializer.getText(sourceFile).includes("loginSubmitOwnerRef.current?.invalidate()"));
  assert.ok(!sameIdentity?.initializer.getText(sourceFile).includes("loginSubmitOwnerRef.current?.invalidate()"));
}

function replaceExactlyOnce(source: string, before: string, after: string) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `anchor ausente: ${before}`);
  assert.equal(source.indexOf(before, first + before.length), -1, `anchor duplicado: ${before}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function sha256(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function assertPerfRegistrations(source: string) {
  const manifest = JSON.parse(source) as { scripts: Record<string, string> };
  const commands = Object.values(manifest.scripts).join("\n");
  for (const path of REQUIRED_PERF_REGISTRATIONS) {
    assert.equal(
      commands.split(path).length - 1,
      1,
      `${path} debe estar registrado exactamente una vez`,
    );
  }
}

test("wiring productivo de Login Owner cumple lifecycle y orden síncrono", () => {
  assertLoginOwnerWiring(readFileSync(ROOT_PATH, "utf8"));
});

test("PERF-05A, PERF-05B y PERF-05D están registrados 1:1", () => {
  const source = readFileSync(PACKAGE_PATH, "utf8");
  assertPerfRegistrations(source);
  for (const path of REQUIRED_PERF_REGISTRATIONS) {
    const mutated = replaceExactlyOnce(source, path, path.replace(/\.test\.ts$/, ".disabled.ts"));
    JSON.parse(mutated);
    assert.throws(
      () => assertPerfRegistrations(mutated),
      `desregistrar ${path} debe romper el contrato`,
    );
  }
  assert.equal(sha256(readFileSync(PACKAGE_PATH, "utf8")), sha256(source));
});

for (const mutation of [
  {
    name: "desconectar owner y conservar símbolo sólo en comentario",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      loginSubmitOwner = loginSubmitOwnerController.acquire();",
      "      // loginSubmitOwner = loginSubmitOwnerController.acquire();\n      loginSubmitOwner = null;",
    ),
  },
  {
    name: "adquirir lock después de signInWithPassword",
    apply: (source: string) => replaceExactlyOnce(
      replaceExactlyOnce(
        source,
        "      loginSubmitOwner = loginSubmitOwnerController.acquire();\n      if (!loginSubmitOwner) return;",
        "      loginSubmitOwner = null;",
      ),
      "      const settlement = await loginSubmitOwnerController!.settle(\n        loginSubmitOwner!,\n        supabase.auth.signInWithPassword({ email, password }),\n      );",
      "      const lateRequest = supabase.auth.signInWithPassword({ email, password });\n      loginSubmitOwner = loginSubmitOwnerController.acquire();\n      if (!loginSubmitOwner) return;\n      const settlement = await loginSubmitOwnerController.settle(loginSubmitOwner, lateRequest);",
    ),
  },
  {
    name: "eliminar invalidación SIGNED_OUT",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      if (event === \"SIGNED_OUT\") {\n        loginSubmitOwnerRef.current?.invalidate();",
      "      if (event === \"SIGNED_OUT\") {\n        // loginSubmitOwnerRef.current?.invalidate();",
    ),
  },
  {
    name: "finally libera sin comprobar owner",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      const canFinalizeAuthAttempt = loginSubmitOwner && loginSubmitOwnerController\n        ? loginSubmitOwnerController.finalize(loginSubmitOwner)\n        : true;",
      "      loginSubmitOwnerController?.finalize(loginSubmitOwner!);\n      const canFinalizeAuthAttempt = true;",
    ),
  },
  {
    name: "importar owner pero no crearlo",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const controller = createLoginSubmitOwnerController();",
      "    // const controller = createLoginSubmitOwnerController();\n    const controller = loginSubmitOwnerRef.current;\n    if (!controller) return;",
    ),
  },
] as const) {
  test(`mutation probe wiring: ${mutation.name}`, () => {
    const original = readFileSync(ROOT_PATH, "utf8");
    const originalSha = sha256(original);
    const mutated = mutation.apply(original);
    assert.notEqual(mutated, original, "la mutación debe aplicarse efectivamente");
    parseRoot(mutated);
    assert.throws(() => assertLoginOwnerWiring(mutated), "el contrato debe matar la mutación");
    assert.equal(sha256(readFileSync(ROOT_PATH, "utf8")), originalSha, "el root debe restaurarse byte a byte");
  });
}
