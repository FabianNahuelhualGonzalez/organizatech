import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import "@/features/coach-portal/coach-portal-integration-contract";
import "@/features/coach-portal/model/coach-portal.contract";
import { useMultiportalAuthBoundary } from "@/features/auth/hooks/use-multiportal-auth-boundary";
import type { AuthRouteState } from "@/features/auth/model/auth-route";

const ROOT_PATH = "src/components/organizatech-app.tsx";
const CONTROLLER_PATH = "src/features/auth/model/multiportal-auth-controller.ts";
const OWNER_PATH = "src/features/auth/model/portal-resolution-owner.ts";
const GATEWAY_PATH = "src/features/auth/data/supabase-multiportal-auth-gateway.ts";
const HOOK_PATH = "src/features/auth/hooks/use-multiportal-auth-boundary.ts";
const FORM_PATH = "src/features/auth/model/auth-form.ts";
const SCREEN_PATH = "src/features/auth/components/auth-screen.tsx";
const AUTH_SOURCE_DIRECTORY = "src/features/auth";
const METADATA_RUNTIME_PROBE_PATH =
  "src/features/auth/model/multiportal-auth-metadata-mutation-runtime.test.ts";
const NO_SENSITIVE_BROWSER_STORAGE_FAILURE =
  "[AUTH-COACH-01.SWITCH.no-sensitive-browser-storage]";
const TOKEN_REFRESHED_AUTHORIZATION_FAILURE =
  "[UI-NAV-01S.token-refresh-authoritative-reachability]";
const AMBIGUOUS_IDENTITY_FAILURE =
  "[AUTH-CONFIRM-01.existing-identity-neutral] existing_identity termina sin autorización ni navegación";
const EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE =
  "[AUTH-SEPARATE-01.gateway.explicit-existing-identity-error] Usuario y Coach clasifican code/message antes de traducir otros errores";
const CONFIRMATION_ROOT_NO_EFFECTS_FAILURE =
  "[AUTH-SEPARATE-01.root.confirmation-no-effects] ambos estados neutralizados sólo reinician Auth, publican copy y retornan";
const AC039_FAILURES = {
  exactMessage: "[AUTH-COACH-01.AC039.exact-message] conserva el mensaje de duplicado aprobado",
  authenticatedLookup: "[AUTH-COACH-01.AC039.authenticated-own-lookup] el duplicado deriva sólo de identity.userId autenticado",
  switchPrecedence: "[AUTH-COACH-01.AC039.switch-precedence] A→B se resuelve antes de consultar membresía Coach",
  existingBranch: "[AUTH-COACH-01.AC039.existing-branch] una fila Coach existente tiene una rama terminal propia",
  crossedRow: "[AUTH-COACH-01.AC039.crossed-row] una fila cruzada falla cerrada antes del mensaje de duplicado",
  controlledError: "[AUTH-COACH-01.AC039.controlled-error] el duplicado retorna error register-email y nunca coach_authorized",
  noCreate: "[AUTH-COACH-01.AC039.no-create] el duplicado no ejecuta createCoachRegistration",
  noActivation: "[AUTH-COACH-01.AC039.no-activation] el duplicado no activa ni aplica sesión Coach",
  immutableRow: "[AUTH-COACH-01.AC039.immutable-row] el duplicado no aplica campos nuevos sobre la fila existente",
  noSignOut: "[AUTH-COACH-01.AC039.no-signout] el duplicado no ejecuta signOut local ni global",
  noEmail: "[AUTH-COACH-01.AC039.no-email] el duplicado autenticado no ejecuta signup ni emisión de correo",
  minimalResult: "[AUTH-COACH-01.AC039.minimal-result] el error no transporta coach, authState, userId ni professional_title",
  userOnlyAllowed: "[AUTH-COACH-01.AC039.user-only-allowed] una identidad Usuario-only alcanza exactamente un create Coach",
  noClientInference: "[AUTH-COACH-01.AC039.no-client-inference] metadata, email, roles y estado cliente no revelan duplicado",
  invalidPasswordPrivacy: "[AUTH-COACH-01.AC039.invalid-password-privacy] contraseña incorrecta conserva el mensaje ambiguo neutral",
  rootNoContinuation: "[AUTH-COACH-01.AC039.root-no-continuation] el error corta sesión, portal y navegación antes de publicar éxito",
} as const;

interface Sources {
  root: string;
  controller: string;
  owner: string;
  gateway: string;
  hook: string;
  form: string;
  screen: string;
}

function collectProductTypeScriptPaths(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...collectProductTypeScriptPaths(path));
      continue;
    }
    if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      paths.push(path);
    }
  }
  return paths.sort();
}

function resolveNodeModulesDirectory() {
  const localNodeModules = resolve("node_modules");
  if (existsSync(join(localNodeModules, ".bin", "tsx"))) return localNodeModules;

  const inheritedNodeModules = (process.env.NODE_PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((path) => resolve(path))
    .find((path) => existsSync(join(path, ".bin", "tsx")));
  assert.ok(inheritedNodeModules, "la suite runtime requiere un tsx disponible sin instalar paquetes");
  return inheritedNodeModules;
}

const BROWSER_STORAGE_AUDIT_PATHS = [
  ROOT_PATH,
  ...collectProductTypeScriptPaths(AUTH_SOURCE_DIRECTORY),
] as const;

function readSources(): Sources {
  return {
    root: readFileSync(ROOT_PATH, "utf8"),
    controller: readFileSync(CONTROLLER_PATH, "utf8"),
    owner: readFileSync(OWNER_PATH, "utf8"),
    gateway: readFileSync(GATEWAY_PATH, "utf8"),
    hook: readFileSync(HOOK_PATH, "utf8"),
    form: readFileSync(FORM_PATH, "utf8"),
    screen: readFileSync(SCREEN_PATH, "utf8"),
  };
}

function readBrowserStorageAuditSources(sources: Sources) {
  const sourceOverrides = new Map<string, string>([
    [ROOT_PATH, sources.root],
    [CONTROLLER_PATH, sources.controller],
    [OWNER_PATH, sources.owner],
    [GATEWAY_PATH, sources.gateway],
    [HOOK_PATH, sources.hook],
    [FORM_PATH, sources.form],
    [SCREEN_PATH, sources.screen],
  ]);
  return BROWSER_STORAGE_AUDIT_PATHS.map((path) => ({
    path,
    source: sourceOverrides.get(path) ?? readFileSync(path, "utf8"),
  }));
}

function sha256(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function assertValidTypeScript(source: string, path: string) {
  const result = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    reportDiagnostics: true,
  });
  const syntaxErrors = (result.diagnostics ?? []).filter(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    syntaxErrors,
    [],
    `[AUTH-COACH-01.mutation.syntax] ${path} debe conservar sintaxis TypeScript ejecutable`,
  );
}

function parseTypeScript(source: string, path: string) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

const BROWSER_STORAGE_NAMES = new Set(["localStorage", "sessionStorage"]);
const BROWSER_GLOBAL_NAMES = new Set(["window", "globalThis"]);

function memberAccessName(expression: ts.Expression): string | null {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current) && current.argumentExpression) {
    const argument = unwrapExpression(current.argumentExpression);
    return ts.isStringLiteralLike(argument) ? argument.text : null;
  }
  return null;
}

function memberAccessReceiver(expression: ts.Expression): ts.Expression | null {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    return current.expression;
  }
  return null;
}

function isBrowserStorageReference(
  expression: ts.Expression,
  storageAliases: ReadonlySet<string>,
  globalAliases: ReadonlySet<string>,
): boolean {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    return BROWSER_STORAGE_NAMES.has(current.text) || storageAliases.has(current.text);
  }

  const storageName = memberAccessName(current);
  const receiver = memberAccessReceiver(current);
  if (!storageName || !BROWSER_STORAGE_NAMES.has(storageName) || !receiver) return false;
  return isBrowserGlobalReference(receiver, globalAliases);
}

function isBrowserGlobalReference(
  expression: ts.Expression,
  aliases: ReadonlySet<string>,
): boolean {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current)
    && (BROWSER_GLOBAL_NAMES.has(current.text) || aliases.has(current.text));
}

function bindingElementSourceProperty(element: ts.BindingElement): string | null {
  if (!element.propertyName) {
    return ts.isIdentifier(element.name) ? element.name.text : null;
  }
  if (ts.isComputedPropertyName(element.propertyName)) {
    const expression = unwrapExpression(element.propertyName.expression);
    return ts.isStringLiteralLike(expression) ? expression.text : null;
  }
  return propertyNameText(element.propertyName);
}

function collectBrowserStorageAliases(sourceFile: ts.SourceFile) {
  const referenceCandidates: Array<{ name: string; initializer: ts.Expression }> = [];
  const destructuringCandidates: Array<{
    initializer: ts.Expression;
    pattern: ts.ObjectBindingPattern;
  }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        referenceCandidates.push({ name: node.name.text, initializer: node.initializer });
      } else if (ts.isObjectBindingPattern(node.name)) {
        destructuringCandidates.push({ initializer: node.initializer, pattern: node.name });
      }
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
    ) {
      referenceCandidates.push({ name: node.left.text, initializer: node.right });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const globalAliases = new Set<string>();
  const storageAliases = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of referenceCandidates) {
      if (
        !globalAliases.has(candidate.name)
        && isBrowserGlobalReference(candidate.initializer, globalAliases)
      ) {
        globalAliases.add(candidate.name);
        changed = true;
      }
      if (
        !storageAliases.has(candidate.name)
        && isBrowserStorageReference(candidate.initializer, storageAliases, globalAliases)
      ) {
        storageAliases.add(candidate.name);
        changed = true;
      }
    }
    for (const candidate of destructuringCandidates) {
      if (!isBrowserGlobalReference(candidate.initializer, globalAliases)) continue;
      for (const element of candidate.pattern.elements) {
        if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
        const sourceProperty = bindingElementSourceProperty(element);
        if (
          sourceProperty
          && BROWSER_STORAGE_NAMES.has(sourceProperty)
          && !storageAliases.has(element.name.text)
        ) {
          storageAliases.add(element.name.text);
          changed = true;
        }
      }
    }
  }
  return { globalAliases, storageAliases };
}

function containsBrowserStorageSetItem(source: string, path: string): boolean {
  const sourceFile = parseTypeScript(source, path);
  const { globalAliases, storageAliases } = collectBrowserStorageAliases(sourceFile);
  let violation = false;
  const visit = (node: ts.Node) => {
    if (violation) return;
    if (ts.isCallExpression(node)) {
      const methodName = memberAccessName(node.expression);
      const receiver = memberAccessReceiver(node.expression);
      if (
        methodName === "setItem"
        && receiver
        && isBrowserStorageReference(receiver, storageAliases, globalAliases)
      ) {
        violation = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violation;
}

function auditNoSensitiveBrowserStorage(sources: Sources) {
  const violations = readBrowserStorageAuditSources(sources)
    .filter(({ path, source }) => containsBrowserStorageSetItem(source, path));
  assert.equal(violations.length, 0, NO_SENSITIVE_BROWSER_STORAGE_FAILURE);
}

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isNestedFunctionBoundary(node: ts.Node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node);
}

function visitFunctionBody(body: ts.Block, visitor: (node: ts.Node) => void) {
  const visit = (node: ts.Node) => {
    if (node !== body && isNestedFunctionBoundary(node)) return;
    visitor(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
}

function findNamedFunction(sourceFile: ts.SourceFile, name: string) {
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration => (
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
    ),
  );
  assert.ok(declaration?.body, `función ${name} debe tener implementación`);
  return declaration as ts.FunctionDeclaration & { body: ts.Block };
}

function findNamedMethod(sourceFile: ts.SourceFile, name: string) {
  let declaration: ts.MethodDeclaration | null = null;
  const visit = (node: ts.Node) => {
    if (declaration) return;
    if (ts.isMethodDeclaration(node) && propertyNameText(node.name) === name && node.body) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const resolvedDeclaration = declaration as ts.MethodDeclaration | null;
  assert.ok(resolvedDeclaration?.body, `método ${name} debe tener implementación`);
  return resolvedDeclaration as ts.MethodDeclaration & { body: ts.Block };
}

function collectReturns(body: ts.Block) {
  const returns: ts.ReturnStatement[] = [];
  visitFunctionBody(body, (node) => {
    if (ts.isReturnStatement(node)) returns.push(node);
  });
  return returns;
}

function collectVariableInitializers(body: ts.Block) {
  const initializers = new Map<string, ts.Expression>();
  visitFunctionBody(body, (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      initializers.set(node.name.text, node.initializer);
    }
  });
  return initializers;
}

function objectLiteralStringProperty(expression: ts.Expression, propertyName: string) {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped)) return null;
  for (const property of unwrapped.properties) {
    if (
      ts.isPropertyAssignment(property)
      && propertyNameText(property.name) === propertyName
    ) {
      const value = unwrapExpression(property.initializer);
      return ts.isStringLiteralLike(value) ? value.text : null;
    }
  }
  return null;
}

function objectLiteralPropertyExpression(
  expression: ts.Expression,
  propertyName: string,
): ts.Expression | null {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped)) return null;
  for (const property of unwrapped.properties) {
    if (
      ts.isPropertyAssignment(property)
      && propertyNameText(property.name) === propertyName
    ) {
      return unwrapExpression(property.initializer);
    }
  }
  return null;
}

function objectLiteralPropertyNames(expression: ts.Expression): string[] {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrapped)) return [];
  return unwrapped.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const name = propertyNameText(property.name);
      return name ? [name] : [];
    }
    return [];
  });
}

function collectIfStatements(container: ts.Node): ts.IfStatement[] {
  const statements: ts.IfStatement[] = [];
  const visit = (node: ts.Node) => {
    if (node !== container && isNestedFunctionBoundary(node)) return;
    if (ts.isIfStatement(node)) statements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(container);
  return statements;
}

function collectCallExpressions(container: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (node !== container && isNestedFunctionBoundary(node)) return;
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(container);
  return calls;
}

function findNamedFunctionDeep(sourceFile: ts.SourceFile, name: string) {
  const declarations: Array<ts.FunctionDeclaration & { body: ts.Block }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      declarations.push(node as ts.FunctionDeclaration & { body: ts.Block });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(declarations.length, 1, `función ${name} debe tener una implementación única`);
  return declarations[0]!;
}

function isCoachAuthorizedReturn(statement: ts.ReturnStatement) {
  return Boolean(
    statement.expression
    && objectLiteralStringProperty(statement.expression, "state") === "coach_authorized",
  );
}

function isUserAuthorizedReturn(statement: ts.ReturnStatement) {
  return Boolean(
    statement.expression
    && objectLiteralStringProperty(statement.expression, "state") === "user_authorized",
  );
}

function ancestorIfStatements(node: ts.Node, body: ts.Block) {
  const ancestors: ts.IfStatement[] = [];
  let current: ts.Node | undefined = node;
  while (current.parent && current.parent !== body) {
    current = current.parent;
    if (ts.isIfStatement(current)) ancestors.push(current);
  }
  return ancestors;
}

function isWithin(node: ts.Node, container: ts.Node) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === container) return true;
    current = current.parent;
  }
  return false;
}

function expressionContainsSemanticNode(
  expression: ts.Expression,
  initializers: ReadonlyMap<string, ts.Expression>,
  predicate: (node: ts.Node) => boolean,
) {
  const followedBindings = new Set<string>();
  let match = false;
  const visit = (node: ts.Node) => {
    if (match) return;
    if (predicate(node)) {
      match = true;
      return;
    }
    if (ts.isIdentifier(node)) {
      const initializer = initializers.get(node.text);
      if (initializer && !followedBindings.has(node.text)) {
        followedBindings.add(node.text);
        visit(initializer);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return match;
}

function isPropertyRead(node: ts.Node, propertyNames: ReadonlySet<string>) {
  if (ts.isPropertyAccessExpression(node)) return propertyNames.has(node.name.text);
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const argument = unwrapExpression(node.argumentExpression);
    return ts.isStringLiteralLike(argument) && propertyNames.has(argument.text);
  }
  return false;
}

function awaitedMethodCall(expression: ts.Expression, methodName: string) {
  let current = unwrapExpression(expression);
  if (ts.isAwaitExpression(current)) current = unwrapExpression(current.expression);
  if (
    !ts.isCallExpression(current)
    || !ts.isPropertyAccessExpression(current.expression)
    || current.expression.name.text !== methodName
  ) {
    return null;
  }
  return current;
}

function isIdentifierNamed(expression: ts.Expression | undefined, name: string) {
  if (!expression) return false;
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) && current.text === name;
}

function isPropertyPath(expression: ts.Expression | undefined, root: string, property: string) {
  if (!expression) return false;
  const current = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(current)) return false;
  const base = unwrapExpression(current.expression);
  return current.name.text === property
    && ts.isIdentifier(base)
    && base.text === root;
}

function awaitedNamedCall(expression: ts.Expression, functionName: string) {
  let current = unwrapExpression(expression);
  if (ts.isAwaitExpression(current)) current = unwrapExpression(current.expression);
  if (
    !ts.isCallExpression(current)
    || !ts.isIdentifier(current.expression)
    || current.expression.text !== functionName
  ) {
    return null;
  }
  return current;
}

function isNullExpression(expression: ts.Expression | undefined) {
  return Boolean(expression && unwrapExpression(expression).kind === ts.SyntaxKind.NullKeyword);
}

function statementContainsThrowCall(statement: ts.Statement, functionName: string) {
  let match = false;
  const visit = (node: ts.Node) => {
    if (match || (node !== statement && isNestedFunctionBoundary(node))) return;
    if (ts.isThrowStatement(node) && node.expression) {
      const expression = unwrapExpression(node.expression);
      if (
        ts.isCallExpression(expression)
        && ts.isIdentifier(expression.expression)
        && expression.expression.text === functionName
      ) {
        match = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return match;
}

function statementContainsThrow(statement: ts.Statement) {
  let match = false;
  const visit = (node: ts.Node) => {
    if (match || (node !== statement && isNestedFunctionBoundary(node))) return;
    if (ts.isThrowStatement(node)) {
      match = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return match;
}

function statementContainsReturn(
  statement: ts.Statement,
  predicate: (expression: ts.Expression) => boolean,
) {
  let match = false;
  const visit = (node: ts.Node) => {
    if (match || (node !== statement && isNestedFunctionBoundary(node))) return;
    if (ts.isReturnStatement(node) && node.expression && predicate(node.expression)) {
      match = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return match;
}

function replaceNodeText(
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  replacement: string,
) {
  return `${source.slice(0, node.getStart(sourceFile))}${replacement}${source.slice(node.end)}`;
}

function renameIdentifiersWithin(
  source: string,
  sourceFile: ts.SourceFile,
  container: ts.Node,
  currentName: string,
  nextName: string,
) {
  const ranges: Array<{ start: number; end: number }> = [];
  const visit = (node: ts.Node) => {
    if (node !== container && isNestedFunctionBoundary(node)) return;
    if (ts.isIdentifier(node) && node.text === currentName) {
      ranges.push({ start: node.getStart(sourceFile), end: node.end });
    }
    ts.forEachChild(node, visit);
  };
  visit(container);
  assert.ok(ranges.length > 0, `renombre semántico encuentra ${currentName}`);
  let transformed = source;
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, range.start)}${nextName}${transformed.slice(range.end)}`;
  }
  return transformed;
}

function positiveBindingName(expression: ts.Expression): string | null {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (!ts.isBinaryExpression(current)) return null;
  const operator = current.operatorToken.kind;
  const left = unwrapExpression(current.left);
  const right = unwrapExpression(current.right);
  const leftIdentifier = ts.isIdentifier(left) ? left.text : null;
  const rightIdentifier = ts.isIdentifier(right) ? right.text : null;
  const leftBoolean = left.kind === ts.SyntaxKind.TrueKeyword
    ? true
    : left.kind === ts.SyntaxKind.FalseKeyword ? false : null;
  const rightBoolean = right.kind === ts.SyntaxKind.TrueKeyword
    ? true
    : right.kind === ts.SyntaxKind.FalseKeyword ? false : null;
  if (
    operator === ts.SyntaxKind.EqualsEqualsToken
    || operator === ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    if (leftIdentifier && rightBoolean === true) return leftIdentifier;
    if (rightIdentifier && leftBoolean === true) return rightIdentifier;
  }
  if (
    operator === ts.SyntaxKind.ExclamationEqualsToken
    || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    if (leftIdentifier && rightBoolean === false) return leftIdentifier;
    if (rightIdentifier && leftBoolean === false) return rightIdentifier;
  }
  return null;
}

function negativeBindingName(expression: ts.Expression): string | null {
  const current = unwrapExpression(expression);
  if (ts.isPrefixUnaryExpression(current) && current.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = unwrapExpression(current.operand);
    return ts.isIdentifier(operand) ? operand.text : null;
  }
  if (!ts.isBinaryExpression(current)) return null;
  const operator = current.operatorToken.kind;
  if (
    operator !== ts.SyntaxKind.EqualsEqualsToken
    && operator !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) return null;
  const left = unwrapExpression(current.left);
  const right = unwrapExpression(current.right);
  if (ts.isIdentifier(left) && isNullExpression(right)) return left.text;
  if (ts.isIdentifier(right) && isNullExpression(left)) return right.text;
  return null;
}

function gatewayMethodName(call: ts.CallExpression, gatewayName: string): string | null {
  const expression = unwrapExpression(call.expression);
  if (!ts.isPropertyAccessExpression(expression)) return null;
  const receiver = unwrapExpression(expression.expression);
  return ts.isIdentifier(receiver) && receiver.text === gatewayName
    ? expression.name.text
    : null;
}

function locateRegistrationErrorGuard(root: string, payloadName: string) {
  const sourceFile = parseTypeScript(root, ROOT_PATH);
  const handleAuth = findNamedFunctionDeep(sourceFile, "handleAuth");
  const guard = collectIfStatements(handleAuth.body).find((ifStatement) => {
    if (!/\.state\s*===\s*"error"/.test(ifStatement.expression.getText(sourceFile))) return false;
    return ancestorIfStatements(ifStatement, handleAuth.body).some((ancestor) => (
      isIdentifierNamed(ancestor.expression, payloadName)
      && isWithin(ifStatement, ancestor.thenStatement)
    ));
  });
  assert.ok(guard, `handleAuth conserva la rama error de ${payloadName}`);
  return { sourceFile, handleAuth, guard: guard! };
}

function locateRegistrationStateGuard(root: string, state: string) {
  const sourceFile = parseTypeScript(root, ROOT_PATH);
  const handleAuth = findNamedFunctionDeep(sourceFile, "handleAuth");
  const guards = collectIfStatements(handleAuth.body).filter((ifStatement) => (
    ifStatement.expression.getText(sourceFile) === `registration.state === "${state}"`
  ));
  assert.equal(guards.length, 1, CONFIRMATION_ROOT_NO_EFFECTS_FAILURE);
  return { sourceFile, guard: guards[0]! };
}

function auditExplicitExistingIdentitySignupErrors(gateway: string) {
  assert.match(
    gateway,
    /const EXISTING_IDENTITY_SIGNUP_ERROR_CODES = new Set\(\[\s*"user_already_exists",\s*"email_exists",\s*\]\);/,
    EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE,
  );
  assert.match(
    gateway,
    /const EXISTING_IDENTITY_SIGNUP_ERROR_MESSAGES = new Set\(\[\s*"user already registered",\s*\]\);/,
    EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE,
  );
  const sourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const classifier = findNamedFunction(sourceFile, "isExistingIdentitySignupError")
    .getText(sourceFile);
  assert.equal(
    /EXISTING_IDENTITY_SIGNUP_ERROR_CODES\.has\(code\)/.test(classifier)
      && /EXISTING_IDENTITY_SIGNUP_ERROR_MESSAGES\.has\(message\)/.test(classifier),
    true,
    EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE,
  );

  for (const methodName of [
    "signUpForCoachRegistration",
    "signUpForUserRegistration",
  ] as const) {
    const method = findNamedMethod(sourceFile, methodName).getText(sourceFile);
    const classifierPosition = method.indexOf("isExistingIdentitySignupError(error)");
    const translationPosition = method.indexOf("translateAuthError(error)");
    assert.equal(
      classifierPosition >= 0 && translationPosition > classifierPosition,
      true,
      EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE,
    );
  }
}

function auditAmbiguousExistingIdentitySemantics(sources: Sources) {
  const sourceFile = parseTypeScript(sources.controller, CONTROLLER_PATH);
  const approvedMessage =
    "Si corresponde, completa la confirmación desde tu correo. También puedes iniciar sesión, recuperar tu contraseña o usar otro correo de acceso.";
  const approvedMessageNames: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
        ? unwrapExpression(declaration.initializer)
        : null;
      if (
        ts.isIdentifier(declaration.name)
        && initializer
        && ts.isStringLiteralLike(initializer)
        && initializer.text === approvedMessage
      ) approvedMessageNames.push(declaration.name.text);
    }
  }
  assert.deepEqual(
    approvedMessageNames,
    ["USER_REGISTRATION_CONFIRMATION_MESSAGE"],
    AMBIGUOUS_IDENTITY_FAILURE,
  );
  assert.match(
    sources.controller,
    /export const COACH_REGISTRATION_CONFIRMATION_MESSAGE\s*=\s*\n\s*USER_REGISTRATION_CONFIRMATION_MESSAGE;/,
    AMBIGUOUS_IDENTITY_FAILURE,
  );
  assert.doesNotMatch(
    approvedMessage,
    /existe|registrad[oa]|encontramos|enviad[oa]|cuenta creada|Usuario|Coach/i,
    AMBIGUOUS_IDENTITY_FAILURE,
  );

  const cases = [
    {
      functionName: "registerUser",
      portal: "usuario",
      state: "user_confirmation_required",
      messageName: "USER_REGISTRATION_CONFIRMATION_MESSAGE",
    },
    {
      functionName: "registerSeparateCoach",
      portal: "coach",
      state: "coach_confirmation_required",
      messageName: "COACH_REGISTRATION_CONFIRMATION_MESSAGE",
    },
  ] as const;

  for (const registrationCase of cases) {
    const registration = findNamedFunction(sourceFile, registrationCase.functionName);
    const gatewayParameter = registration.parameters[2]?.name;
    const gatewayName = gatewayParameter && ts.isIdentifier(gatewayParameter)
      ? gatewayParameter.text
      : null;
    assert.ok(gatewayName, AMBIGUOUS_IDENTITY_FAILURE);
    const guards = collectIfStatements(registration.body).filter((ifStatement) => {
      const condition = ifStatement.expression.getText(sourceFile);
      return /\.kind\s*===\s*"confirmation_required"/.test(condition)
        || /\.kind\s*===\s*"existing_identity"/.test(condition);
    });
    assert.equal(guards.length, 1, AMBIGUOUS_IDENTITY_FAILURE);
    const condition = guards[0]!.expression.getText(sourceFile);
    assert.equal(
      /\.kind\s*===\s*"confirmation_required"/.test(condition)
        && /\.kind\s*===\s*"existing_identity"/.test(condition),
      true,
      AMBIGUOUS_IDENTITY_FAILURE,
    );
    const ambiguousBranch = guards[0]!.thenStatement;
    if (!ts.isBlock(ambiguousBranch)) assert.fail(AMBIGUOUS_IDENTITY_FAILURE);
    const returns = collectReturns(ambiguousBranch).filter(
      (returnStatement) => Boolean(returnStatement.expression),
    );
    assert.equal(returns.length, 1, AMBIGUOUS_IDENTITY_FAILURE);
    const expression = returns[0]!.expression!;
    const message = objectLiteralPropertyExpression(expression, "message");
    assert.equal(
      objectLiteralStringProperty(expression, "state") === registrationCase.state
        && objectLiteralStringProperty(expression, "requestedPortal") === registrationCase.portal
        && Boolean(message && isIdentifierNamed(message, registrationCase.messageName)),
      true,
      AMBIGUOUS_IDENTITY_FAILURE,
    );
    assert.deepEqual(
      objectLiteralPropertyNames(expression).sort(),
      ["message", "requestedPortal", "state"],
      AMBIGUOUS_IDENTITY_FAILURE,
    );
    assert.equal(
      collectCallExpressions(ambiguousBranch).some(
        (call) => gatewayMethodName(call, gatewayName!) !== null,
      ),
      false,
      AMBIGUOUS_IDENTITY_FAILURE,
    );
  }

  const rootBranches = [
    locateRegistrationStateGuard(sources.root, "user_confirmation_required"),
    locateRegistrationStateGuard(sources.root, "coach_confirmation_required"),
  ];
  const branchTexts: string[] = [];
  for (const { sourceFile: rootSourceFile, guard } of rootBranches) {
    const branch = guard.thenStatement;
    if (!ts.isBlock(branch)) assert.fail(CONFIRMATION_ROOT_NO_EFFECTS_FAILURE);
    assert.equal(branch.statements.length, 2, CONFIRMATION_ROOT_NO_EFFECTS_FAILURE);
    assert.equal(ts.isReturnStatement(branch.statements[1]!), true, CONFIRMATION_ROOT_NO_EFFECTS_FAILURE);
    assert.deepEqual(
      collectCallExpressions(branch).map((call) => call.expression.getText(rootSourceFile)),
      ["registrationForm.controller.resetIfCurrent", "setAuthStatus"],
      CONFIRMATION_ROOT_NO_EFFECTS_FAILURE,
    );
    assert.match(
      branch.getText(rootSourceFile),
      /^\{\s*if \(registrationForm\.controller\.resetIfCurrent\(registrationRevision\)\) \{\s*setAuthStatus\(registration\.message, "success"\);\s*\}\s*return;\s*\}$/,
      CONFIRMATION_ROOT_NO_EFFECTS_FAILURE,
    );
    branchTexts.push(branch.getText(rootSourceFile));
  }
  assert.equal(branchTexts[0], branchTexts[1], CONFIRMATION_ROOT_NO_EFFECTS_FAILURE);
}

function _auditDuplicateCoachRegistrationSemantics(sources: Sources) {
  const sourceFile = parseTypeScript(sources.controller, CONTROLLER_PATH);
  const registerCoach = findNamedFunction(sourceFile, "registerCoach");
  const inputParameter = registerCoach.parameters[0]?.name;
  const ownerParameter = registerCoach.parameters[1]?.name;
  const gatewayParameter = registerCoach.parameters[2]?.name;
  const inputName = inputParameter && ts.isIdentifier(inputParameter) ? inputParameter.text : null;
  const ownerName = ownerParameter && ts.isIdentifier(ownerParameter) ? ownerParameter.text : null;
  const gatewayName = gatewayParameter && ts.isIdentifier(gatewayParameter)
    ? gatewayParameter.text
    : null;
  assert.ok(inputName && ownerName && gatewayName, "registerCoach conserva parámetros identificables");

  const approvedMessage =
    "Este correo ya se encuentra registrado como Coach. Intente con otro correo.";
  const approvedMessageNames: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.initializer
        && ts.isStringLiteralLike(unwrapExpression(declaration.initializer))
        && (unwrapExpression(declaration.initializer) as ts.StringLiteralLike).text === approvedMessage
      ) approvedMessageNames.push(declaration.name.text);
    }
  }
  assert.equal(approvedMessageNames.length, 1, AC039_FAILURES.exactMessage);
  const approvedMessageName = approvedMessageNames[0]!;

  const initializers = collectVariableInitializers(registerCoach.body);
  const identityEntry = [...initializers.entries()].find(([, initializer]) => {
    const call = awaitedMethodCall(initializer, "getCurrentIdentity");
    return Boolean(call && gatewayMethodName(call, gatewayName!) === "getCurrentIdentity");
  });
  const identityName = identityEntry?.[0] ?? null;
  assert.ok(identityName, AC039_FAILURES.authenticatedLookup);

  const calls = collectCallExpressions(registerCoach.body);
  const coachLookupCalls = calls.filter(
    (call) => gatewayMethodName(call, gatewayName!) === "getCoachRegistration",
  );
  assert.equal(
    coachLookupCalls.length > 0
      && coachLookupCalls.every((call) => (
        call.arguments.length === 2
        && isPropertyPath(call.arguments[0], identityName!, "userId")
        && isIdentifierNamed(call.arguments[1], ownerName!)
      )),
    true,
    AC039_FAILURES.authenticatedLookup,
  );

  const ifStatements = collectIfStatements(registerCoach.body);
  const identitySwitchGuard = ifStatements.find((ifStatement) => (
    statementContainsReturn(
      ifStatement.thenStatement,
      (expression) => objectLiteralStringProperty(expression, "state") === "identity_switch_required",
    )
  ));
  assert.ok(identitySwitchGuard, AC039_FAILURES.switchPrecedence);
  assert.equal(
    coachLookupCalls.every((call) => call.getStart(sourceFile) > identitySwitchGuard!.end),
    true,
    AC039_FAILURES.switchPrecedence,
  );

  const lookupEntry = [...initializers.entries()].find(([, initializer]) => {
    const call = awaitedMethodCall(initializer, "getCoachRegistration");
    return Boolean(call && gatewayMethodName(call, gatewayName!) === "getCoachRegistration");
  });
  const lookupName = lookupEntry?.[0] ?? null;
  assert.ok(lookupName, AC039_FAILURES.existingBranch);
  const existingGuard = ifStatements.find(
    (ifStatement) => positiveBindingName(ifStatement.expression) === lookupName,
  );
  assert.ok(existingGuard, AC039_FAILURES.existingBranch);

  const duplicateReturns = collectReturns(registerCoach.body).filter((returnStatement) => {
    if (!returnStatement.expression) return false;
    const message = objectLiteralPropertyExpression(returnStatement.expression, "message");
    return Boolean(message && isIdentifierNamed(message, approvedMessageName));
  });
  const guardedDuplicateReturns = duplicateReturns.filter((returnStatement) => (
    isWithin(returnStatement, existingGuard!.thenStatement)
  ));

  const crossedRowGuard = collectIfStatements(existingGuard!.thenStatement).find((ifStatement) => {
    const expression = unwrapExpression(ifStatement.expression);
    if (!ts.isBinaryExpression(expression)) return false;
    if (
      expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
      && expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken
    ) return false;
    const leftMatches = isPropertyPath(expression.left, lookupName!, "userId")
      && isPropertyPath(expression.right, identityName!, "userId");
    const rightMatches = isPropertyPath(expression.right, lookupName!, "userId")
      && isPropertyPath(expression.left, identityName!, "userId");
    return (leftMatches || rightMatches) && statementContainsReturn(
      ifStatement.thenStatement,
      (returnExpression) => Boolean(awaitedNamedCall(
        returnExpression,
        "controlledCoachRegistrationError",
      )),
    );
  });
  assert.equal(guardedDuplicateReturns.length, 1, AC039_FAILURES.controlledError);
  const duplicateReturn = guardedDuplicateReturns[0]!;
  assert.equal(
    Boolean(
      duplicateReturn.expression
      && objectLiteralStringProperty(duplicateReturn.expression, "state") === "error"
      && objectLiteralStringProperty(duplicateReturn.expression, "requestedPortal") === "coach"
      && objectLiteralStringProperty(duplicateReturn.expression, "field") === "register-email"
    ),
    true,
    AC039_FAILURES.controlledError,
  );
  assert.equal(
    Boolean(
      crossedRowGuard
      && crossedRowGuard.getStart(sourceFile) < duplicateReturn.getStart(sourceFile)
    ),
    true,
    AC039_FAILURES.crossedRow,
  );

  const duplicateBranchCalls = collectCallExpressions(existingGuard!.thenStatement);
  assert.equal(
    duplicateBranchCalls.some(
      (call) => gatewayMethodName(call, gatewayName!) === "createCoachRegistration",
    ),
    false,
    AC039_FAILURES.noCreate,
  );
  assert.equal(
    duplicateBranchCalls.some(
      (call) => gatewayMethodName(call, gatewayName!) === "activateCoachRegistrationIdentity",
    ),
    false,
    AC039_FAILURES.noActivation,
  );

  let mutatesExistingRow = false;
  const visitDuplicateBranch = (node: ts.Node) => {
    if (mutatesExistingRow || (node !== existingGuard!.thenStatement && isNestedFunctionBoundary(node))) {
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (
        operator >= ts.SyntaxKind.FirstAssignment
        && operator <= ts.SyntaxKind.LastAssignment
        && expressionContainsSemanticNode(
          node.left,
          new Map(),
          (candidate) => ts.isIdentifier(candidate) && candidate.text === lookupName,
        )
      ) mutatesExistingRow = true;
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === "Object"
      && node.expression.name.text === "assign"
      && isIdentifierNamed(node.arguments[0], lookupName!)
    ) mutatesExistingRow = true;
    ts.forEachChild(node, visitDuplicateBranch);
  };
  visitDuplicateBranch(existingGuard!.thenStatement);
  assert.equal(mutatesExistingRow, false, AC039_FAILURES.immutableRow);
  assert.equal(
    duplicateBranchCalls.some((call) => {
      const method = gatewayMethodName(call, gatewayName!);
      return method === "signOut" || method === "signOutForCoachIdentitySwitch";
    }),
    false,
    AC039_FAILURES.noSignOut,
  );
  assert.equal(
    duplicateBranchCalls.some(
      (call) => gatewayMethodName(call, gatewayName!) === "signUpForCoachRegistration",
    ),
    false,
    AC039_FAILURES.noEmail,
  );
  assert.deepEqual(
    objectLiteralPropertyNames(duplicateReturn.expression!).sort(),
    ["field", "message", "requestedPortal", "state"],
    AC039_FAILURES.minimalResult,
  );

  const createCalls = calls.filter(
    (call) => gatewayMethodName(call, gatewayName!) === "createCoachRegistration",
  );
  assert.equal(
    createCalls.length === 1
      && createCalls[0]!.getStart(sourceFile) > existingGuard!.end
      && isPropertyPath(createCalls[0]!.arguments[0], inputName!, "registration")
      && isPropertyPath(createCalls[0]!.arguments[1], identityName!, "userId")
      && isIdentifierNamed(createCalls[0]!.arguments[2], ownerName!),
    true,
    AC039_FAILURES.userOnlyAllowed,
  );

  const duplicateReturnsOutsideExistingGuard = duplicateReturns.filter(
    (returnStatement) => !isWithin(returnStatement, existingGuard!.thenStatement),
  );
  const userOnlyDuplicateReturns = duplicateReturnsOutsideExistingGuard.filter((returnStatement) => (
    ancestorIfStatements(returnStatement, registerCoach.body).some((ifStatement) => (
      negativeBindingName(ifStatement.expression) === lookupName
      && isWithin(returnStatement, ifStatement.thenStatement)
    ))
  ));
  assert.equal(userOnlyDuplicateReturns.length, 0, AC039_FAILURES.userOnlyAllowed);
  const invalidPasswordDuplicateReturns = duplicateReturnsOutsideExistingGuard.filter(
    (returnStatement) => ancestorIfStatements(returnStatement, registerCoach.body).some(
      (ifStatement) => /\.kind\s*===\s*"existing_identity"/.test(
        ifStatement.expression.getText(sourceFile),
      ),
    ),
  );
  assert.equal(
    duplicateReturnsOutsideExistingGuard.length
      - userOnlyDuplicateReturns.length
      - invalidPasswordDuplicateReturns.length,
    0,
    AC039_FAILURES.noClientInference,
  );

  const existingIdentityGuard = ifStatements.find(
    (ifStatement) => /\.kind\s*===\s*"existing_identity"/.test(
      ifStatement.expression.getText(sourceFile),
    ),
  );
  assert.equal(
    Boolean(existingIdentityGuard && statementContainsReturn(
      existingIdentityGuard.thenStatement,
      (expression) => {
        const message = objectLiteralPropertyExpression(expression, "message");
        return objectLiteralStringProperty(expression, "state") === "error"
          && Boolean(message && isIdentifierNamed(
            message,
            "REGISTRATION_EXISTING_IDENTITY_MESSAGE",
          ));
      },
    )),
    true,
    AC039_FAILURES.invalidPasswordPrivacy,
  );

  const { guard: rootErrorGuard } = locateRegistrationErrorGuard(
    sources.root,
    "coachRegistrationPayload",
  );
  const rootErrorCalls = collectCallExpressions(rootErrorGuard.thenStatement);
  const forbiddenRootCalls = new Set([
    "applySessionState",
    "beginPortalResolution",
    "continueAuthorizedPortalAccess",
    "replaceCoachPortalSession",
    "signOut",
    "transition",
  ]);
  const hasTerminalReturn = ts.isBlock(rootErrorGuard.thenStatement)
    && rootErrorGuard.thenStatement.statements.some(ts.isReturnStatement);
  assert.equal(
    hasTerminalReturn
      && !rootErrorCalls.some((call) => {
        const expression = unwrapExpression(call.expression);
        if (ts.isIdentifier(expression)) return forbiddenRootCalls.has(expression.text);
        return ts.isPropertyAccessExpression(expression)
          && forbiddenRootCalls.has(expression.name.text);
      }),
    true,
    AC039_FAILURES.rootNoContinuation,
  );
}

function auditCoachAuthorizationSemantics(controller: string) {
  const sourceFile = parseTypeScript(controller, CONTROLLER_PATH);
  const resolution = findNamedFunction(sourceFile, "resolvePortalAccess");
  const inputParameter = resolution.parameters[0]?.name;
  const gatewayParameter = resolution.parameters[1]?.name;
  const inputName = inputParameter && ts.isIdentifier(inputParameter)
    ? inputParameter.text
    : null;
  const gatewayName = gatewayParameter && ts.isIdentifier(gatewayParameter)
    ? gatewayParameter.text
    : null;
  assert.ok(inputName && gatewayName, "resolvePortalAccess conserva parámetros identificables");

  const initializers = collectVariableInitializers(resolution.body);
  const identityEntry = [...initializers.entries()].find(([, initializer]) => {
    const call = awaitedMethodCall(initializer, "getCurrentIdentity");
    return Boolean(
      call
      && ts.isPropertyAccessExpression(call.expression)
      && ts.isIdentifier(call.expression.expression)
      && call.expression.expression.text === gatewayName
      && isPropertyPath(call.arguments[0], inputName, "expectedUserId"),
    );
  });
  const identityName = identityEntry?.[0] ?? null;
  assert.ok(
    identityName,
    "[AUTH-COACH-01.controller.authoritative-coach-row] identidad fresca debe derivar de expectedUserId",
  );

  const coachReturns = collectReturns(resolution.body).filter(isCoachAuthorizedReturn);
  const authoritativeReturns = coachReturns.filter((coachReturn) => (
    ancestorIfStatements(coachReturn, resolution.body).some((ifStatement) => {
      if (!isWithin(coachReturn, ifStatement.thenStatement)) return false;
      const bindingName = positiveBindingName(ifStatement.expression);
      if (!bindingName) return false;
      const initializer = initializers.get(bindingName);
      if (!initializer) return false;
      const call = awaitedMethodCall(initializer, "getCoachRegistration");
      return Boolean(
        call
        && ts.isPropertyAccessExpression(call.expression)
        && ts.isIdentifier(call.expression.expression)
        && call.expression.expression.text === gatewayName
        && call.arguments.length === 2
        && isPropertyPath(call.arguments[0], identityName!, "userId")
        && isPropertyPath(call.arguments[1], inputName, "owner"),
      );
    })
  ));
  const alternativeReturns = coachReturns.filter((coachReturn) => (
    !authoritativeReturns.includes(coachReturn)
  ));

  const emailProperties = new Set(["email"]);
  const emailAuthorizedReturns = alternativeReturns.filter((coachReturn) => (
    ancestorIfStatements(coachReturn, resolution.body).some((ifStatement) => (
      expressionContainsSemanticNode(
        ifStatement.expression,
        initializers,
        (node) => isPropertyRead(node, emailProperties),
      )
    ))
  ));
  assert.equal(
    emailAuthorizedReturns.length,
    0,
    "[AUTH-COACH-01.E7.no-email-domain-authority] ningún dato derivado del correo abre una ruta Coach",
  );

  const identityProperties = new Set(["userId", "expectedUserId"]);
  const localIdentityRegistryReturns = alternativeReturns.filter((coachReturn) => {
    const conditions = ancestorIfStatements(coachReturn, resolution.body);
    const readsIdentity = conditions.some((ifStatement) => (
      expressionContainsSemanticNode(
        ifStatement.expression,
        initializers,
        (node) => isPropertyRead(node, identityProperties),
      )
    ));
    const readsLocalRegistry = conditions.some((ifStatement) => (
      expressionContainsSemanticNode(
        ifStatement.expression,
        initializers,
        (node) => (
          ts.isArrayLiteralExpression(node)
          || (
            ts.isNewExpression(node)
            && ts.isIdentifier(node.expression)
            && ["Set", "Map", "WeakSet", "WeakMap"].includes(node.expression.text)
          )
        ),
      )
    ));
    return readsIdentity && readsLocalRegistry;
  });
  assert.equal(
    localIdentityRegistryReturns.length,
    0,
    "[AUTH-COACH-01.E8.no-user-id-backdoor] ninguna colección local de identidades abre una ruta Coach",
  );

  assert.equal(
    coachReturns.length,
    1,
    "[AUTH-COACH-01.controller.unique-coach-authorization-path] resolvePortalAccess tiene un único retorno Coach",
  );
  assert.equal(
    authoritativeReturns.length,
    1,
    "[AUTH-COACH-01.controller.authoritative-coach-row] el único retorno Coach depende del lookup positivo de la identidad fresca",
  );
}

function auditUserAuthorizationSemantics(controller: string) {
  const sourceFile = parseTypeScript(controller, CONTROLLER_PATH);
  const resolution = findNamedFunction(sourceFile, "resolvePortalAccess");
  const inputParameter = resolution.parameters[0]?.name;
  const gatewayParameter = resolution.parameters[1]?.name;
  const inputName = inputParameter && ts.isIdentifier(inputParameter) ? inputParameter.text : null;
  const gatewayName = gatewayParameter && ts.isIdentifier(gatewayParameter) ? gatewayParameter.text : null;
  assert.ok(inputName && gatewayName, "resolvePortalAccess conserva parámetros Usuario identificables");

  const initializers = collectVariableInitializers(resolution.body);
  const identityEntry = [...initializers.entries()].find(([, initializer]) => {
    const call = awaitedMethodCall(initializer, "getCurrentIdentity");
    return Boolean(
      call
      && ts.isPropertyAccessExpression(call.expression)
      && ts.isIdentifier(call.expression.expression)
      && call.expression.expression.text === gatewayName
      && isPropertyPath(call.arguments[0], inputName!, "expectedUserId"),
    );
  });
  const identityName = identityEntry?.[0] ?? null;
  assert.ok(
    identityName,
    "[AUTH-COACH-01.USER.controller.authoritative-user-row] identidad fresca deriva de expectedUserId",
  );

  const userReturns = collectReturns(resolution.body).filter(isUserAuthorizedReturn);
  const authoritativeReturns = userReturns.filter((userReturn) => (
    ancestorIfStatements(userReturn, resolution.body).some((ifStatement) => {
      if (!isWithin(userReturn, ifStatement.thenStatement)) return false;
      const bindingName = positiveBindingName(ifStatement.expression);
      if (!bindingName) return false;
      const initializer = initializers.get(bindingName);
      if (!initializer) return false;
      const call = awaitedMethodCall(initializer, "hasUserRegistration");
      return Boolean(
        call
        && ts.isPropertyAccessExpression(call.expression)
        && ts.isIdentifier(call.expression.expression)
        && call.expression.expression.text === gatewayName
        && call.arguments.length === 2
        && isPropertyPath(call.arguments[0], identityName!, "userId")
        && isPropertyPath(call.arguments[1], inputName!, "owner"),
      );
    })
  ));
  const alternativeReturns = userReturns.filter((userReturn) => !authoritativeReturns.includes(userReturn));

  const emailAuthorized = alternativeReturns.filter((userReturn) => (
    ancestorIfStatements(userReturn, resolution.body).some((ifStatement) => (
      expressionContainsSemanticNode(
        ifStatement.expression,
        initializers,
        (node) => isPropertyRead(node, new Set(["email"])),
      )
    ))
  ));
  assert.equal(
    emailAuthorized.length,
    0,
    "[AUTH-COACH-01.USER.controller.no-email-authority] email o dominio no conceden Usuario",
  );

  const untrustedProperties = new Set([
    "user_metadata",
    "app_metadata",
    "claims",
    "accountType",
    "query",
    "searchParams",
    "role",
    "roles",
    "privileges",
    "profileExists",
  ]);
  const untrustedAuthorized = alternativeReturns.filter((userReturn) => (
    ancestorIfStatements(userReturn, resolution.body).some((ifStatement) => (
      expressionContainsSemanticNode(
        ifStatement.expression,
        initializers,
        (node) => isPropertyRead(node, untrustedProperties),
      )
    ))
  ));
  assert.equal(
    untrustedAuthorized.length,
    0,
    "[AUTH-COACH-01.USER.controller.no-client-signal-authority] metadata, parámetros y roles no conceden Usuario",
  );

  const localRegistryAuthorized = alternativeReturns.filter((userReturn) => (
    ancestorIfStatements(userReturn, resolution.body).some((ifStatement) => (
      expressionContainsSemanticNode(
        ifStatement.expression,
        initializers,
        (node) => (
          ts.isArrayLiteralExpression(node)
          || (
            ts.isNewExpression(node)
            && ts.isIdentifier(node.expression)
            && ["Set", "Map", "WeakSet", "WeakMap"].includes(node.expression.text)
          )
        ),
      )
    ))
  ));
  assert.equal(
    localRegistryAuthorized.length,
    0,
    "[AUTH-COACH-01.USER.controller.no-local-id-authority] IDs locales no conceden Usuario",
  );

  assert.equal(
    userReturns.length,
    1,
    "[AUTH-COACH-01.USER.controller.unique-user-authorization-path] existe una única salida Usuario",
  );
  assert.equal(
    authoritativeReturns.length,
    1,
    "[AUTH-COACH-01.USER.controller.authoritative-user-row] la salida Usuario depende del lookup own-only",
  );
}

function auditGatewayCoachLookupSemantics(gateway: string) {
  const sourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const method = findNamedMethod(sourceFile, "getCoachRegistration");
  const expectedUserIdParameter = method.parameters[0]?.name;
  const ownerParameter = method.parameters[1]?.name;
  const expectedUserIdName = expectedUserIdParameter && ts.isIdentifier(expectedUserIdParameter)
    ? expectedUserIdParameter.text
    : null;
  const ownerName = ownerParameter && ts.isIdentifier(ownerParameter)
    ? ownerParameter.text
    : null;
  assert.ok(
    expectedUserIdName && ownerName,
    "[AUTH-COACH-01.E9.authoritative-select-required] lookup productivo conserva expectedUserId y owner",
  );

  const initializers = collectVariableInitializers(method.body);
  const authoritativeReads = [...initializers.entries()].filter(([, initializer]) => {
    let current = unwrapExpression(initializer);
    if (ts.isAwaitExpression(current)) current = unwrapExpression(current.expression);
    if (!ts.isCallExpression(current) || !ts.isIdentifier(current.expression)) return false;
    if (current.expression.text !== "readOwnCoachRegistration") return false;
    const directDataClient = current.arguments[0]
      ? unwrapExpression(current.arguments[0])
      : null;
    const hasExpectedDataClient = Boolean(
      directDataClient
      && ts.isCallExpression(directDataClient)
      && ts.isIdentifier(directDataClient.expression)
      && directDataClient.expression.text === "dataClientFor"
      && isIdentifierNamed(directDataClient.arguments[0], expectedUserIdName!),
    );
    return hasExpectedDataClient
      && isIdentifierNamed(current.arguments[1], expectedUserIdName!)
      && isIdentifierNamed(current.arguments[2], ownerName!);
  });
  const returns = collectReturns(method.body);

  assert.equal(
    authoritativeReads.length,
    1,
    "[AUTH-COACH-01.E9.authoritative-select-required] existe una única lectura own-only ligada a expectedUserId y owner",
  );
  assert.equal(
    returns.length,
    1,
    "[AUTH-COACH-01.E9.authoritative-select-required] no existe retorno ejecutable antes de la lectura autoritativa",
  );

  const [evidenceName] = authoritativeReads[0] ?? [];
  const returnExpression = returns[0]?.expression
    ? unwrapExpression(returns[0].expression!)
    : null;
  const returnsAuthoritativeEvidence = Boolean(
    evidenceName
    && returnExpression
    && isIdentifierNamed(returnExpression, evidenceName)
  );
  assert.equal(
    returnsAuthoritativeEvidence,
    true,
    "[AUTH-COACH-01.E9.authoritative-select-required] la fila tipada deriva exclusivamente del SELECT own-only",
  );
}

function locateUserActivationGlobalSessionGuard(sourceFile: ts.SourceFile) {
  const activation = findNamedFunction(sourceFile, "activateRegistrationIdentity");
  const supabaseParameter = activation.parameters[0]?.name;
  const identityParameter = activation.parameters[1]?.name;
  const ownerParameter = activation.parameters[2]?.name;
  const supabaseName = supabaseParameter && ts.isIdentifier(supabaseParameter)
    ? supabaseParameter.text
    : null;
  const identityName = identityParameter && ts.isIdentifier(identityParameter)
    ? identityParameter.text
    : null;
  const ownerName = ownerParameter && ts.isIdentifier(ownerParameter) ? ownerParameter.text : null;
  const evidenceEntry = [...collectVariableInitializers(activation.body).entries()].find(
    ([, initializer]) => {
      const call = awaitedNamedCall(initializer, "getAuthoritativeIdentity");
      return Boolean(
        call
        && supabaseName
        && ownerName
        && isIdentifierNamed(call.arguments[0], supabaseName)
        && isIdentifierNamed(call.arguments[1], "undefined")
        && isIdentifierNamed(call.arguments[2], ownerName),
      );
    },
  );
  const evidenceName = evidenceEntry?.[0] ?? null;
  const guard = evidenceName
    ? activation.body.statements.find((statement): statement is ts.IfStatement => (
      ts.isIfStatement(statement) && isIdentifierNamed(statement.expression, evidenceName)
    )) ?? null
    : null;
  return {
    activation,
    supabaseName,
    identityName,
    ownerName,
    evidenceName,
    guard,
  };
}

function isSafeGlobalIdentityReturn(
  expression: ts.Expression,
  evidenceName: string,
  identityName: string,
) {
  const current = unwrapExpression(expression);
  if (!ts.isConditionalExpression(current)) return false;
  const condition = unwrapExpression(current.condition);
  if (!ts.isBinaryExpression(condition)) return false;
  const equality = condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
    || condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const comparesIdentities = (
    isPropertyPath(condition.left, evidenceName, "userId")
    && isPropertyPath(condition.right, identityName, "userId")
  ) || (
    isPropertyPath(condition.right, evidenceName, "userId")
    && isPropertyPath(condition.left, identityName, "userId")
  );
  return equality
    && comparesIdentities
    && isIdentifierNamed(current.whenTrue, evidenceName)
    && isNullExpression(current.whenFalse);
}

function auditUserActivationGlobalSessionGuard(sourceFile: ts.SourceFile) {
  const located = locateUserActivationGlobalSessionGuard(sourceFile);
  let setSessionCall: ts.CallExpression | null = null;
  visitFunctionBody(located.activation.body, (node) => {
    if (
      !setSessionCall
      && ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "setSession"
    ) {
      setSessionCall = node;
    }
  });
  const resolvedSetSessionCall = setSessionCall as ts.CallExpression | null;
  const safeReturn = Boolean(
    located.guard
    && located.evidenceName
    && located.identityName
    && statementContainsReturn(
      located.guard.thenStatement,
      (expression) => isSafeGlobalIdentityReturn(
        expression,
        located.evidenceName!,
        located.identityName!,
      ),
    ),
  );
  assert.equal(
    Boolean(
      located.supabaseName
      && located.ownerName
      && safeReturn
      && resolvedSetSessionCall
      && located.guard!.end < resolvedSetSessionCall.getStart(sourceFile)
    ),
    true,
    "[AUTH-COACH-01.USER.H1.global-session-preserved]",
  );
}

function locateInitialUserWriteOwnershipGuard(sourceFile: ts.SourceFile) {
  const method = findNamedMethod(sourceFile, "createUserRegistration");
  const expectedUserIdParameter = method.parameters[0]?.name;
  const ownerParameter = method.parameters[1]?.name;
  const expectedUserIdName = expectedUserIdParameter && ts.isIdentifier(expectedUserIdParameter)
    ? expectedUserIdParameter.text
    : null;
  const ownerName = ownerParameter && ts.isIdentifier(ownerParameter) ? ownerParameter.text : null;
  const firstStatement = method.body.statements[0] ?? null;
  let guard: ts.IfStatement | null = null;
  if (firstStatement && ts.isIfStatement(firstStatement)) {
    const condition = unwrapExpression(firstStatement.expression);
    if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
      const ownershipCall = unwrapExpression(condition.operand);
      if (
        ts.isCallExpression(ownershipCall)
        && ts.isIdentifier(ownershipCall.expression)
        && ownershipCall.expression.text === "ownsRegistration"
        && ownerName
        && expectedUserIdName
        && isIdentifierNamed(ownershipCall.arguments[0], ownerName)
        && isIdentifierNamed(ownershipCall.arguments[1], expectedUserIdName)
        && statementContainsThrowCall(firstStatement.thenStatement, "staleRegistrationError")
      ) {
        guard = firstStatement;
      }
    }
  }
  return { method, expectedUserIdName, ownerName, guard };
}

function auditInitialUserWriteOwnershipGuard(sourceFile: ts.SourceFile) {
  const located = locateInitialUserWriteOwnershipGuard(sourceFile);
  assert.equal(
    Boolean(located.expectedUserIdName && located.ownerName && located.guard),
    true,
    "[AUTH-COACH-01.USER.H2.stale-owner-prewrite]",
  );
}

function locateCrossedUserRowGuard(sourceFile: ts.SourceFile) {
  const readFunction = findNamedFunction(sourceFile, "readOwnUserRegistration");
  const expectedUserIdParameter = readFunction.parameters[1]?.name;
  const expectedUserIdName = expectedUserIdParameter && ts.isIdentifier(expectedUserIdParameter)
    ? expectedUserIdParameter.text
    : null;
  const rowEntry = [...collectVariableInitializers(readFunction.body).entries()].find(
    ([, initializer]) => Boolean(awaitedNamedCall(initializer, "mapUserRegistrationRow")),
  );
  const rowName = rowEntry?.[0] ?? null;
  const guard = rowName && expectedUserIdName
    ? readFunction.body.statements.find((statement): statement is ts.IfStatement => {
      if (!ts.isIfStatement(statement)) return false;
      const condition = unwrapExpression(statement.expression);
      if (
        !ts.isBinaryExpression(condition)
        || condition.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        return false;
      }
      const left = unwrapExpression(condition.left);
      const right = unwrapExpression(condition.right);
      const truthyEvidence = isIdentifierNamed(left, rowName) || isIdentifierNamed(right, rowName);
      const mismatch = [left, right].some((candidate) => {
        if (!ts.isBinaryExpression(candidate)) return false;
        const inequality = candidate.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
          || candidate.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
        return inequality && (
          (
            isPropertyPath(candidate.left, rowName, "userId")
            && isIdentifierNamed(candidate.right, expectedUserIdName)
          )
          || (
            isPropertyPath(candidate.right, rowName, "userId")
            && isIdentifierNamed(candidate.left, expectedUserIdName)
          )
        );
      });
      return truthyEvidence && mismatch && statementContainsThrow(statement.thenStatement);
    }) ?? null
    : null;
  return { readFunction, expectedUserIdName, rowName, guard };
}

function auditCrossedUserRowGuard(sourceFile: ts.SourceFile) {
  const located = locateCrossedUserRowGuard(sourceFile);
  assert.equal(
    Boolean(located.expectedUserIdName && located.rowName && located.guard),
    true,
    "[AUTH-COACH-01.USER.H3.crossed-row-rejected]",
  );
}

function auditGatewayUserLookupSemantics(gateway: string) {
  const sourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const method = findNamedMethod(sourceFile, "hasUserRegistration");
  const expectedUserIdParameter = method.parameters[0]?.name;
  const ownerParameter = method.parameters[1]?.name;
  const expectedUserIdName = expectedUserIdParameter && ts.isIdentifier(expectedUserIdParameter)
    ? expectedUserIdParameter.text
    : null;
  const ownerName = ownerParameter && ts.isIdentifier(ownerParameter) ? ownerParameter.text : null;
  assert.ok(
    expectedUserIdName && ownerName,
    "[AUTH-COACH-01.USER.gateway.authoritative-select] lookup conserva expectedUserId y owner",
  );

  const initializers = collectVariableInitializers(method.body);
  const authoritativeReads = [...initializers.entries()].filter(([, initializer]) => {
    let current = unwrapExpression(initializer);
    if (ts.isAwaitExpression(current)) current = unwrapExpression(current.expression);
    if (!ts.isCallExpression(current) || !ts.isIdentifier(current.expression)) return false;
    if (current.expression.text !== "readOwnUserRegistration") return false;
    const dataClient = current.arguments[0] ? unwrapExpression(current.arguments[0]) : null;
    return Boolean(
      dataClient
      && ts.isCallExpression(dataClient)
      && ts.isIdentifier(dataClient.expression)
      && dataClient.expression.text === "dataClientFor"
      && isIdentifierNamed(dataClient.arguments[0], expectedUserIdName!)
      && isIdentifierNamed(current.arguments[1], expectedUserIdName!)
      && isIdentifierNamed(current.arguments[2], ownerName!),
    );
  });
  const returns = collectReturns(method.body);
  assert.equal(
    authoritativeReads.length,
    1,
    "[AUTH-COACH-01.USER.gateway.authoritative-select] existe una lectura own-only exacta",
  );
  assert.equal(
    returns.length,
    1,
    "[AUTH-COACH-01.USER.gateway.authoritative-select] no existe retorno anticipado",
  );
  const [evidenceName] = authoritativeReads[0] ?? [];
  const returnExpression = returns[0]?.expression ? unwrapExpression(returns[0].expression) : null;
  assert.equal(
    Boolean(
      evidenceName
      && returnExpression
      && ts.isBinaryExpression(returnExpression)
      && (
        returnExpression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
        || returnExpression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      )
      && isIdentifierNamed(returnExpression.left, evidenceName)
      && unwrapExpression(returnExpression.right).kind === ts.SyntaxKind.NullKeyword
    ),
    true,
    "[AUTH-COACH-01.USER.gateway.authoritative-select] true deriva sólo de la fila SELECT",
  );

  const readFunction = findNamedFunction(sourceFile, "readOwnUserRegistration");
  const readText = readFunction.getText(sourceFile);
  assert.match(
    readText,
    /\.from\("user_registrations"\)[\s\S]*\.select\(USER_REGISTRATION_COLUMNS\)[\s\S]*\.maybeSingle\(\)/,
    "[AUTH-COACH-01.USER.gateway.user-table-only] autorización consulta user_registrations",
  );
  assert.doesNotMatch(
    readText,
    /\.from\("profiles"\)|\.eq\(|\.filter\(/,
    "[AUTH-COACH-01.USER.gateway.user-table-only] profiles y filtros cliente no son autoridad",
  );

  const createMethod = findNamedMethod(sourceFile, "createUserRegistration");
  const createText = createMethod.getText(sourceFile);
  assert.match(
    createText,
    /client\.rpc\("register_own_user"\)/,
    "[AUTH-COACH-01.USER.gateway.no-client-ownership] RPC no recibe payload de ownership",
  );
  assert.doesNotMatch(
    createText,
    /client\.rpc\("register_own_user",|\.insert\(|\.upsert\(/,
    "[AUTH-COACH-01.USER.gateway.no-client-ownership] frontend no envía user_id ni inserta directo",
  );
  auditUserActivationGlobalSessionGuard(sourceFile);
  auditInitialUserWriteOwnershipGuard(sourceFile);
  auditCrossedUserRowGuard(sourceFile);
}

function auditCoachHybridSemantics(sources: Sources) {
  const { controller, gateway, hook, root, screen } = sources;
  const controllerSourceFile = parseTypeScript(controller, CONTROLLER_PATH);
  const registerCoachText = findNamedFunction(
    controllerSourceFile,
    "registerCoach",
  ).getText(controllerSourceFile);
  const sharedText = findNamedFunction(
    controllerSourceFile,
    "registerSharedCoach",
  ).getText(controllerSourceFile);
  const separateText = findNamedFunction(
    controllerSourceFile,
    "registerSeparateCoach",
  ).getText(controllerSourceFile);
  const preparationText = findNamedFunction(
    controllerSourceFile,
    "prepareSharedCoachRegistration",
  ).getText(controllerSourceFile);
  assert.match(
    registerCoachText,
    /input\.flow === "shared"[\s\S]*registerSharedCoach\(input\.registration, owner, gateway\)[\s\S]*registerSeparateCoach\(input, owner, gateway\)/,
    "[AUTH-HYBRID-01.controller.explicit-flow] selector tipado decide el flujo",
  );
  assert.match(
    preparationText,
    /getCurrentIdentity\(expectedUserId, owner\)[\s\S]*hasUserRegistration\(identity\.userId, owner\)[\s\S]*if \(!hasUserRegistration\) return \{ state: "sign_in_required" \};[\s\S]*state: "authorized"/,
    "[AUTH-HYBRID-01.shared.login-and-membership] sesión y membresía Usuario son obligatorias",
  );
  assert.match(
    sharedText,
    /getCurrentIdentity\(owner\.expectedUserId \?\? undefined, owner\)[\s\S]*hasUserRegistration\(currentIdentity\.userId, owner\)[\s\S]*if \(!hasUserRegistration\) return controlledCoachRegistrationError\(\);[\s\S]*createSharedCoachRegistration\([\s\S]*currentIdentity\.userId[\s\S]*coachRegistration\.userId !== currentIdentity\.userId/,
    "[AUTH-HYBRID-01.shared.same-identity] activación queda ligada a la identidad Usuario",
  );
  assert.doesNotMatch(
    sharedText,
    /signUpForCoachRegistration|activateCoachRegistrationIdentity|password|email:/,
    "[AUTH-HYBRID-01.shared.no-new-credential] cuenta compartida no crea ni reemplaza credencial",
  );
  assert.match(
    separateText,
    /signUpForCoachRegistration\(input, owner\)[\s\S]*signup\.kind === "confirmation_required" \|\| signup\.kind === "existing_identity"[\s\S]*getCoachRegistration\(identity\.userId, owner\)[\s\S]*getCurrentIdentity\(undefined, owner\)[\s\S]*if \(activeIdentity && activeIdentity\.userId !== identity\.userId\)[\s\S]*state: "coach_confirmation_required"/,
    "[AUTH-HYBRID-01.separate.isolated-and-neutral] signUp separado no reutiliza sesión activa",
  );
  assert.doesNotMatch(
    separateText,
    /signInForCoachRegistration|signInWithPassword|createSharedCoachRegistration|hasUserRegistration/,
    "[AUTH-HYBRID-01.separate.no-existing-password-probe] no prueba credenciales Usuario",
  );

  const gatewaySourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const sharedGatewayText = findNamedMethod(
    gatewaySourceFile,
    "createSharedCoachRegistration",
  ).getText(gatewaySourceFile);
  assert.match(
    sharedGatewayText,
    /requireAuthoritativeIdentity\(supabase, expectedUserId, owner\)[\s\S]*supabase\.rpc\("register_own_coach", \{[\s\S]*p_first_name:[\s\S]*p_contact_email:[\s\S]*row\.userId !== expectedUserId[\s\S]*requireAuthoritativeIdentity\(supabase, expectedUserId, owner\)/,
    "[AUTH-HYBRID-01.gateway.allowlist-and-owner] RPC exacta revalida antes y después",
  );
  assert.doesNotMatch(
    sharedGatewayText,
    /\.\.\.payload|user_id|owner_id|profile_id|role:|\.insert\(|\.upsert\(/,
    "[AUTH-HYBRID-01.gateway.no-client-ownership] no existe mass assignment ni ownership cliente",
  );
  assert.match(
    hook,
    /beginCoachRegistrationSubmit\([\s\S]*independentIdentity: flow === "separate"/,
    "[AUTH-HYBRID-01.owner.flow-bound] sólo cuenta separada admite identidad aislada",
  );
  assert.match(
    root,
    /beginCoachRegistrationSubmit\(\s*coachRegistrationPayload\.flow/,
    "[AUTH-HYBRID-01.root.typed-flow] root sólo conecta el flujo tipado",
  );
  assert.match(
    screen,
    /value="shared"[\s\S]*Usar mi cuenta Usuario[\s\S]*value="separate"[\s\S]*Crear una cuenta Coach separada/,
    "[AUTH-HYBRID-01.ui.approved-selector] selector conserva opciones aprobadas",
  );
  assert.match(screen, /Iniciar sesión y continuar/);
  assert.match(screen, /Activar cuenta Coach/);
  assert.match(screen, /Crear cuenta Coach/);
  assert.doesNotMatch(
    `${controller}\n${gateway}\n${hook}\n${root}\n${screen}`,
    /identity_switch_required|signOutForCoachIdentitySwitch|coachIdentitySwitch|Cerrar sesión y continuar/,
    "[AUTH-HYBRID-01.no-absolute-switch] el modelo absoluto quedó retirado",
  );
  assert.doesNotMatch(
    `${controller}\n${gateway}\n${hook}\n${root}\n${screen}`,
    /listUsers|getUserByEmail|from\("auth\.users"\)|\.eq\("email"/,
    "[AUTH-HYBRID-01.anti-enumeration] no consulta existencia pública de correo",
  );
}

function auditIntegration(sources: Sources) {
  auditNoSensitiveBrowserStorage(sources);
  auditAmbiguousExistingIdentitySemantics(sources);
  auditExplicitExistingIdentitySignupErrors(sources.gateway);
  auditCoachHybridSemantics(sources);
  const { root, controller, owner, gateway, hook, form, screen } = sources;
  const controllerSourceFile = parseTypeScript(controller, CONTROLLER_PATH);
  const registerSharedCoachFunction = findNamedFunction(controllerSourceFile, "registerSharedCoach");
  const registerSeparateCoachFunction = findNamedFunction(controllerSourceFile, "registerSeparateCoach");
  const registerUserFunction = findNamedFunction(controllerSourceFile, "registerUser");

  assert.match(
    controller,
    /"Cuenta Usuario no registrada\. Crea una cuenta Usuario para iniciar sesión\."/,
    "[AUTH-COACH-01.USER.controller.exact-message] conserva el mensaje aprobado",
  );
  assert.match(
    controller,
    /"Cuenta Coach no registrada\. Crea una cuenta Coach para iniciar sesión\."/,
    "[AUTH-COACH-01.controller.exact-message] conserva el mensaje aprobado",
  );
  assert.match(
    controller,
    /const coachRegistration = await gateway\.getCoachRegistration\(identity\.userId, input\.owner\);[\s\S]*if \(coachRegistration\) \{[\s\S]*state: "coach_authorized"[\s\S]*coach: coachRegistration/,
    "[AUTH-COACH-01.controller.authoritative-coach-row] sólo la fila backend concede Coach",
  );
  assert.match(
    controller,
    /const coachRegistration = await gateway\.getCoachRegistration[\s\S]*if \(!ownsPortalResolution\(input\)\) return stalePortalResolution/,
    "[AUTH-COACH-01.controller.post-lookup-owner] valida owner después del lookup",
  );
  assert.match(
    controller,
    /async function rejectPortalSession[\s\S]*?\n\): Promise<PortalAccessResult> \{\n  if \(!ownsPortalResolution\(input\)\) return stalePortalResolution/,
    "[AUTH-COACH-01.controller.reject-owner-guard] un rechazo stale no alcanza signOut",
  );
  assert.match(
    controller,
    /const signOutResult = await gateway\.signOut\(reason, input\.owner\);[\s\S]*signOutResult === "stale"/,
    "[AUTH-COACH-01.controller.conditional-signout] procesa explícitamente el cierre stale",
  );
  assert.match(controller, /identity\.userId !== input\.expectedUserId/);
  assert.match(
    registerSharedCoachFunction.getText(controllerSourceFile),
    /coachRegistration\.userId !== currentIdentity\.userId[\s\S]*?controlledCoachRegistrationError\(\)/,
    "[AUTH-COACH-01.controller.registration-owner] registro cruzado falla cerrado",
  );
  assert.match(
    registerSeparateCoachFunction.getText(controllerSourceFile),
    /!coachRegistration \|\| coachRegistration\.userId !== identity\.userId[\s\S]*?controlledCoachRegistrationError\(\)/,
    "[AUTH-COACH-01.controller.registration-owner] registro cruzado falla cerrado",
  );
  for (const registrationFunction of [registerSharedCoachFunction, registerSeparateCoachFunction]) {
    assert.match(
      registrationFunction.getText(controllerSourceFile),
      /owner: CoachRegistrationOwner[\s\S]*if \(!owner\.isCurrent\(\)\) return staleCoachRegistration\(\)/,
      "[AUTH-COACH-01.registration.owner-whole-lifecycle] cada flujo exige owner vigente desde el inicio",
    );
  }
  assert.match(controller, /owner\.bindExpectedUserId\(identity\.userId\)/);
  assert.match(
    registerSeparateCoachFunction.getText(controllerSourceFile),
    /gateway\.signUpForCoachRegistration\(input, owner\);[\s\S]*?if \(!owner\.isCurrent\(\) \|\| signup\.kind === "stale"\)/,
    "[AUTH-SEPARATE-01.registration.post-signup-owner] signup tardío se descarta",
  );
  assert.doesNotMatch(
    `${registerSharedCoachFunction.getText(controllerSourceFile)}\n${registerSeparateCoachFunction.getText(controllerSourceFile)}`,
    /signInForCoachRegistration|createCoachRegistration|signInWithPassword/,
    "[AUTH-SEPARATE-01.registration.no-existing-identity-reuse] registro Coach no prueba contraseña ni crea membresía cliente",
  );
  assert.match(
    controller,
    /gateway\.activateCoachRegistrationIdentity\(identity, owner\);[\s\S]*if \(!owner\.isCurrent\(\)\)/,
    "[AUTH-COACH-01.registration.pre-publication-owner] sesión se aplica bajo el mismo owner",
  );
  assert.doesNotMatch(
    controller,
    /user_metadata|raw_user_meta_data|app_metadata|searchParams|query\./,
    "[AUTH-COACH-01.controller.no-metadata-authority] metadata cliente/JWT no concede Coach",
  );
  auditCoachAuthorizationSemantics(controller);
  auditUserAuthorizationSemantics(controller);
  const registerUserText = registerUserFunction.getText(controllerSourceFile);
  assert.match(
    registerUserText,
    /gateway\.signInForUserRegistration[\s\S]*gateway\.hasUserRegistration[\s\S]*gateway\.createUserRegistration[\s\S]*gateway\.activateUserRegistrationIdentity/,
    "[AUTH-COACH-01.USER.registration.closed-path] Registro Usuario usa sólo sus puertos autoritativos",
  );
  assert.doesNotMatch(
    registerUserText,
    /getCoachRegistration|createCoachRegistration|activateCoachRegistrationIdentity/,
    "[AUTH-COACH-01.USER.registration.no-coach-write] Registro Usuario no crea Coach",
  );
  assert.doesNotMatch(
    `${registerSharedCoachFunction.getText(controllerSourceFile)}\n${registerSeparateCoachFunction.getText(controllerSourceFile)}`,
    /createUserRegistration|activateUserRegistrationIdentity/,
    "[AUTH-COACH-01.USER.registration.coach-does-not-create-user] Registro Coach no crea Usuario",
  );
  assert.match(
    registerUserText,
    /if \(!owner\.isCurrent\(\) \|\| signIn\.kind === "stale"\) return staleUserRegistration\(\)/,
    "[AUTH-COACH-01.USER.registration.post-sign-in-owner] respuesta tardía se descarta",
  );

  assert.match(owner, /readonly expectedUserId: string;/);
  assert.match(
    owner,
    /owner(?:: PortalResolutionOwner)? = Object\.freeze\(\{[\s\S]*expectedUserId,[\s\S]*isCurrent:/,
  );
  assert.match(
    owner,
    /owner\.expectedUserId === currentUserId[\s\S]*pending\.has\(owner\)/,
    "[AUTH-COACH-01.owner.identity-bound] owner y usuario vigente deben coincidir",
  );
  assert.match(owner, /export interface CoachRegistrationOwner[\s\S]*readonly id: symbol;[\s\S]*readonly revision: number;[\s\S]*readonly expectedUserId: string \| null;[\s\S]*isCurrent\(\): boolean;/);
  assert.match(owner, /begin\(options = \{\}\) \{[\s\S]*revision \+= 1;[\s\S]*Symbol\("coach-registration"\)/);
  assert.match(owner, /bindExpectedUserId\(userId: string\)[\s\S]*currentUserId !== null && currentUserId !== userId/);

  assert.match(gateway, /await supabase\.auth\.getUser\(\)/);
  assert.match(gateway, /\.from\("coach_registrations"\)/);
  auditGatewayCoachLookupSemantics(gateway);
  auditGatewayUserLookupSemantics(gateway);
  assert.match(gateway, /persistSession: false,[\s\S]*autoRefreshToken: false,[\s\S]*detectSessionInUrl: false/);
  const gatewaySourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const coachSignupMethod = findNamedMethod(gatewaySourceFile, "signUpForCoachRegistration");
  const coachSignupText = coachSignupMethod.getText(gatewaySourceFile);
  assert.equal(
    /withSignupConfirmationMetadata\([\s\S]*contactEmail: payload\.registration\.contact_email[\s\S]*\)/.test(coachSignupText)
      && /\.auth\.signUp\(signupPayload\)/.test(coachSignupText)
      && !/\.auth\.signUp\(payload/.test(coachSignupText),
    true,
    "[AUTH-SEPARATE-01.gateway.allowlisted-coach-signup]",
  );
  assert.equal(
    /isolatedClient\.auth\.signUp\(signupPayload\)/.test(coachSignupText)
      && !/supabase\.auth\.signUp/.test(coachSignupText),
    true,
    "[AUTH-SEPARATE-01.gateway.isolated-coach-signup]",
  );
  const signOutMethod = findNamedMethod(gatewaySourceFile, "signOut");
  const signOutText = signOutMethod.getText(gatewaySourceFile);
  assert.doesNotMatch(
    gateway,
    /signInForCoachRegistration|async createCoachRegistration\(/,
    "[AUTH-HYBRID-01.gateway.closed-coach-ports] sólo existen signup separado y RPC compartida",
  );
  assert.match(
    signOutText,
    /const expectedUserId = owner\.expectedUserId;[\s\S]*?if \(!expectedUserId \|\| !owner\.isCurrent\(\)\) return "stale";/,
    "[AUTH-COACH-01.gateway.signout-owner-guard] gateway rechaza owner stale antes de efectos",
  );
  assert.match(
    signOutText,
    /const localSessionUserId = await getLocalSessionUserId\(supabase, owner\);/,
    "[AUTH-COACH-01.gateway.signout-local-session-read] signOut lee la sesión local vigente",
  );
  assert.match(
    signOutText,
    /localSessionUserId !== expectedUserId/,
    "[AUTH-COACH-01.gateway.signout-local-identity-match] signOut compara la identidad local exacta",
  );
  assert.match(
    signOutText,
    /owner\.expectedUserId !== expectedUserId[\s\S]*?!owner\.isCurrent\(\)/,
    "[AUTH-COACH-01.gateway.signout-post-read-owner-guard] signOut revalida owner tras la lectura local",
  );
  const localSessionIdentityFunction = findNamedFunction(
    gatewaySourceFile,
    "getLocalSessionUserId",
  ).getText(gatewaySourceFile);
  assert.match(
    localSessionIdentityFunction,
    /if \(!owner\.isCurrent\(\)\) return null;[\s\S]*?await supabase\.auth\.getSession\(\);[\s\S]*?if \(!owner\.isCurrent\(\) \|\| error\) return null;[\s\S]*?data\.session\?\.user\.id \?\? null/,
    "[AUTH-COACH-01.gateway.local-session-owner-guard] helper local falla cerrado antes y después del await",
  );
  assert.match(signOutText, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(
    gateway,
    /\.from\("coach_registrations"\)[\s\S]{0,180}?\.insert\(|\.upsert\(|return\s*\{\s*\.\.\.input|user_metadata|raw_user_meta_data|app_metadata/,
    "[AUTH-COACH-01.gateway.no-raw-spread] no propaga objetos crudos ni metadata",
  );

  const formSourceFile = parseTypeScript(form, FORM_PATH);
  const confirmationMetadataFunction = findNamedFunction(
    formSourceFile,
    "withSignupConfirmationMetadata",
  ).getText(formSourceFile);
  assert.equal(
    /const allowlistedData: UserSignupMetadata = \{[\s\S]*display_name: data\.display_name,[\s\S]*first_name: data\.first_name,[\s\S]*last_name: data\.last_name,[\s\S]*birth_date: data\.birth_date,[\s\S]*gender: data\.gender,[\s\S]*phone_number: data\.phone_number/.test(
      confirmationMetadataFunction,
    )
      && !/allowlistedData[^=]*= \{[\s\S]*\.\.\.data/.test(confirmationMetadataFunction),
    true,
    "[AUTH-SEPARATE-01.form.explicit-metadata-allowlist]",
  );
  const coachWriteBuilder = findNamedFunction(
    formSourceFile,
    "buildCoachRegistrationWritePayload",
  ).getText(formSourceFile);
  assert.match(
    coachWriteBuilder,
    /payload: \{[\s\S]*first_name,[\s\S]*last_name,[\s\S]*birth_date,[\s\S]*gender,[\s\S]*phone_number,[\s\S]*professional_title: professionalTitle,[\s\S]*contact_email: contactEmail/,
  );
  assert.doesNotMatch(
    coachWriteBuilder,
    /user_id|owner_id|profile_id|\bage\b|\brole\b|password/,
  );
  assert.match(form, /contact_email: registration\.contactEmail/);
  assert.match(gateway, /contactEmail: payload\.registration\.contact_email/);
  assert.match(gateway, /contactEmail: row\.contact_email/);
  assert.match(screen, /Correo de acceso Coach[\s\S]*Correo de contacto/);
  assert.match(screen, /¿Ya tienes una cuenta Organizatech Usuario\?[\s\S]*crea tu cuenta Coach con otro correo\./);
  assert.match(screen, /aria-label="Continuar con Google"[\s\S]*googleOAuth\.start\(\{ mode, portal: accountType \}\)/);

  assert.match(hook, /portalResolutionOwnersRef\.current\.hasPending\(\)/);
  assert.match(
    hook,
    /function invalidatePortalOperations\(\) \{[\s\S]*portalResolutionOwnersRef\.current\.invalidate\(\);[\s\S]*coachRegistrationOwnersRef\.current\.invalidate\(\);[\s\S]*userRegistrationOwnersRef\.current\.invalidate\(\);[\s\S]*event === "SIGNED_OUT"[\s\S]*invalidatePortalOperations\(\)/,
    "[AUTH-COACH-01.hook.signed-out-invalidation] SIGNED_OUT invalida antes de continuar",
  );
  assert.match(
    hook,
    /const replacedIdentity = portalResolutionOwnersRef\.current\.acceptIdentity\(currentUserId\);/,
    "[AUTH-COACH-01.hook.identity-change-invalidation] acepta B mediante el owner controller",
  );
  assert.match(
    hook,
    /const isSessionEstablishingEvent = event === "SIGNED_IN"\s*\|\| event === "INITIAL_SESSION"\s*\|\| event === "TOKEN_REFRESHED";/,
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} TOKEN_REFRESHED comparte el camino autoritativo`,
  );
  assert.match(hook, /beginPortalResolution\(expectedUserId: string\)/);
  assert.match(hook, /\{ requestedPortal, expectedUserId, owner \}/);
  assert.match(hook, /beginCoachRegistrationSubmit\([\s\S]*independentIdentity: flow === "separate"/);
  assert.match(
    hook,
    /beginUserRegistrationSubmit\(\)[\s\S]*userRegistrationOwnersRef\.current\.begin\(\)/,
    "[AUTH-COACH-01.USER.hook.registration-owner] Usuario conserva owner feature-local",
  );
  assert.match(
    hook,
    /return input\.initialRoute\.accountType === "coach" \? "authorize_coach" : "authorize_user"/,
    "[AUTH-COACH-01.USER.hook.initial-authorization] sesión inicial Usuario exige resolución backend",
  );
  assert.match(
    hook,
    /return route\.accountType === "coach" \? "authorize_coach" : "authorize_user"/,
    "[AUTH-COACH-01.USER.hook.event-authorization] evento Auth Usuario exige resolución backend",
  );
  assert.match(hook, /registerCoach\(payload, owner, createGateway\(supabase\)\)/);
  assert.match(hook, /registerUser\(payload, owner, createGateway\(supabase\)\)/);
  assert.match(hook, /onBeforeSignOut\(reason\)[\s\S]*signOutNoticeRef\.current\.begin\(reason\)/);
  assert.match(hook, /consumePortalSignOutMessage[\s\S]*consumeEvent\(\)/);
  assert.match(hook, /settlePortalSignOutMessage[\s\S]*settle\(\)/);
  assert.match(
    hook,
    /return hasNotice \? \(failedReason \? fallbackMessage : null\) : fallbackMessage/,
    "[AUTH-COACH-01.message.signout-failure] un signOut fallido conserva el error genérico",
  );

  assert.match(root, /authorizeAndContinuePortalSession\(\s*authenticatedState,[\s\S]*requestedPortal/);
  assert.match(root, /multiportalAuth\.resolvePortalAccess\(authState, requestedPortal, resolutionOwner\)/);
  assert.match(
    root,
    /const access = await multiportalAuth\.resolvePortalAccess[\s\S]*if \(access\.state === "stale" \|\| !multiportalAuth\.isPortalResolutionCurrent\(resolutionOwner\)\) \{[\s\S]*return null;[\s\S]*access\.state === "coach_registration_required"/,
    "[AUTH-COACH-01.root.stale-before-publication] descarta stale antes de mensajes o estado",
  );
  assert.match(
    root,
    /resolveSessionEventDecision\(\s*event,\s*session\?\.user\.id \?\? null,\s*interactiveAuthAttemptRef\.current/,
  );
  assert.match(
    root,
    /const requestedPortal = portalEventDecision === "authorize_coach" \? "coach" : "usuario";\n        const userPortalSessionRevalidation = resolveUserPortalSessionRevalidation\(\{[\s\S]*?\n        \}\);\n        replaceUserPortalAuthorizationProof\(userPortalSessionRevalidation\.authorizationProof\);\n        const resolutionOwner = multiportalAuth\.beginPortalResolution\(session!\.user\.id\);\n        queueMicrotask\(/,
    "[AUTH-COACH-01.root.no-timeout-authorization] autorización Auth se difiere sin timeout",
  );
  assert.match(root, /event === "SIGNED_OUT"[\s\S]*interactiveAuthAttemptRef\.current = false/);
  assert.match(
    root,
    /case "user_authorized": \{[\s\S]*createUserPortalAuthorizationProof\(\{[\s\S]*replaceCoachPortalSession\(null\);[\s\S]*replaceUserPortalAuthorizationProof\(authorizationProof\);[\s\S]*const continuation = await continueAuthenticatedSession\(\s*authState,\s*intent,\s*clearCompletedAuthForm,\s*\);[\s\S]*continuation\.kind === "stale"/,
    "[AUTH-COACH-01.USER.root.user-destination] Usuario conserva el splash hasta completar su carga productiva",
  );
  assert.match(
    root,
    /case "coach_authorized": \{[\s\S]*createCoachPortalSession\([\s\S]*registration: access\.coach[\s\S]*replaceCoachPortalSession\(nextCoachPortalSession\)/,
    "[AUTH-COACH-01.root.coach-destination] Coach publica sólo su portal tipado",
  );
  const coachContinuation = root.match(/case "coach_authorized": \{[\s\S]*?\n      \}/)?.[0] ?? "";
  assert.doesNotMatch(
    coachContinuation,
    /continueAuthenticatedSession|refreshTrainingDataForSession|navigation\.transition/,
    "[AUTH-COACH-01.root.destinations-separated] Coach no continúa hacia Usuario",
  );
  assert.match(root, /consumePortalSignOutMessage\(\)/);
  assert.match(root, /settlePortalSignOutMessage\(access\.message\)/);
  assert.match(root, /invalidateCoachRegistrationSubmits\(\)[\s\S]*supabase\.auth\.signInWithPassword/);
  assert.match(root, /registration\.state === "busy" \|\| registration\.state === "stale"/);
  assert.match(
    root,
    /multiportalAuth\.registerUser\(\s*signupPayload,[\s\S]*state: "user_authorized"/,
    "[AUTH-COACH-01.USER.root.registration-controller] root sólo conecta el controller Usuario",
  );
  assert.doesNotMatch(
    root,
    /supabase\.auth\.signUp\(signupPayload\)/,
    "[AUTH-COACH-01.USER.root.no-raw-signup] Registro Usuario no evade el boundary",
  );
  assert.match(
    root,
    /portalDecision === "authorize_user" \|\| portalDecision === "authorize_coach"/,
    "[AUTH-COACH-01.USER.root.initial-session-authorization] bootstrap autoriza ambos portales",
  );
  assert.match(
    root,
    /portalEventDecision === "authorize_user" \|\|[\s\S]*portalEventDecision === "authorize_coach"/,
    "[AUTH-COACH-01.USER.root.session-event-authorization] eventos Auth autorizan ambos portales",
  );
  assert.doesNotMatch(root, /\.from\("coach_registrations"\)/);

  assert.match(screen, /action=\{onSubmit\}/);
  assert.match(screen, /disabled=\{isBusy\}/);
  assert.doesNotMatch(screen, /COACH_REGISTRATION_SUBMIT_ENABLED|isCoachRegistration \? undefined : onSubmit/);
}

type RuntimeMultiportalAuthBoundary = ReturnType<typeof useMultiportalAuthBoundary>;

function renderRuntimeMultiportalAuthBoundary(input: {
  route?: AuthRouteState;
  initialPasswordRecoveryActive?: boolean;
  completeInitialResolution?: boolean;
} = {}): RuntimeMultiportalAuthBoundary {
  const route = input.route ?? { mode: "login", accountType: "usuario" };
  const captured: { current: RuntimeMultiportalAuthBoundary | null } = { current: null };

  function BoundaryHarness() {
    captured.current = useMultiportalAuthBoundary({
      initialRoute: route,
      currentRoute: route,
      initialPasswordRecoveryActive: input.initialPasswordRecoveryActive,
    });
    return null;
  }

  renderToStaticMarkup(createElement(BoundaryHarness));
  assert.ok(captured.current, `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} harness disponible`);
  if (input.completeInitialResolution !== false) captured.current.completeInitialResolution();
  return captured.current;
}

test("TOKEN_REFRESHED comparte autorización autoritativa y conserva invalidaciones", () => {
  const userIdA = "user-a";
  const userIdB = "user-b";

  for (const event of ["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED"] as const) {
    const boundary = renderRuntimeMultiportalAuthBoundary();
    assert.equal(
      boundary.resolveSessionEventDecision(event, userIdA, false),
      "authorize_user",
      `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} ${event} alcanza Usuario`,
    );
  }

  const sameIdentity = renderRuntimeMultiportalAuthBoundary();
  assert.equal(sameIdentity.resolveSessionEventDecision("SIGNED_IN", userIdA), "authorize_user");
  const completedOwner = sameIdentity.beginPortalResolution(userIdA);
  assert.equal(sameIdentity.isPortalResolutionCurrent(completedOwner), true);
  sameIdentity.endPortalResolution(completedOwner);
  assert.equal(
    sameIdentity.resolveSessionEventDecision("TOKEN_REFRESHED", userIdA),
    "authorize_user",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} A→A vuelve a autorización backend`,
  );

  const identitySwitch = renderRuntimeMultiportalAuthBoundary();
  assert.equal(identitySwitch.resolveSessionEventDecision("SIGNED_IN", userIdA), "authorize_user");
  const ownerA = identitySwitch.beginPortalResolution(userIdA);
  assert.equal(identitySwitch.isPortalResolutionCurrent(ownerA), true);
  assert.equal(
    identitySwitch.resolveSessionEventDecision("TOKEN_REFRESHED", userIdB),
    "authorize_user",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} A→B inicia autorización B`,
  );
  assert.equal(
    identitySwitch.isPortalResolutionCurrent(ownerA),
    false,
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} A→B invalida owner y permit A`,
  );

  const pendingOwnerBoundary = renderRuntimeMultiportalAuthBoundary();
  assert.equal(pendingOwnerBoundary.resolveSessionEventDecision("SIGNED_IN", userIdA), "authorize_user");
  pendingOwnerBoundary.beginPortalResolution(userIdA);
  assert.equal(
    pendingOwnerBoundary.resolveSessionEventDecision("TOKEN_REFRESHED", userIdA),
    "defer",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} resolución pendiente difiere`,
  );

  const initialPending = renderRuntimeMultiportalAuthBoundary({ completeInitialResolution: false });
  assert.equal(
    initialPending.resolveSessionEventDecision("TOKEN_REFRESHED", userIdA),
    "defer",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} bootstrap pendiente difiere`,
  );

  const recovery = renderRuntimeMultiportalAuthBoundary({ initialPasswordRecoveryActive: true });
  assert.equal(
    recovery.resolveSessionEventDecision("TOKEN_REFRESHED", userIdA),
    "defer",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} recovery bloqueada difiere`,
  );

  const interactive = renderRuntimeMultiportalAuthBoundary();
  assert.equal(
    interactive.resolveSessionEventDecision("TOKEN_REFRESHED", userIdA, true),
    "defer",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} intento interactivo no es continuidad silenciosa`,
  );

  const registration = renderRuntimeMultiportalAuthBoundary({
    route: { mode: "registro", accountType: "usuario" },
  });
  assert.equal(
    registration.resolveSessionEventDecision("TOKEN_REFRESHED", userIdA),
    "hold_user_registration",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} registro conserva su boundary`,
  );

  const coach = renderRuntimeMultiportalAuthBoundary({
    route: { mode: "login", accountType: "coach" },
  });
  assert.equal(
    coach.resolveSessionEventDecision("TOKEN_REFRESHED", userIdA),
    "authorize_coach",
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} Coach permanece separado`,
  );

  const logout = renderRuntimeMultiportalAuthBoundary();
  assert.equal(logout.resolveSessionEventDecision("SIGNED_IN", userIdA), "authorize_user");
  const logoutOwner = logout.beginPortalResolution(userIdA);
  assert.equal(logout.resolveSessionEventDecision("SIGNED_OUT", null), "continue");
  assert.equal(
    logout.isPortalResolutionCurrent(logoutOwner),
    false,
    `${TOKEN_REFRESHED_AUTHORIZATION_FAILURE} logout invalida owner y permit`,
  );
});

function replaceExactlyOnce(source: string, target: string, replacement: string, name: string) {
  assert.equal(source.split(target).length - 1, 1, `${name}: target único`);
  return source.replace(target, replacement);
}

function injectAfterAuthCredentials(source: string, injectedSource: string, name: string) {
  const credentialsDeclaration = '    const password = authPayload?.password ?? "";';
  return replaceExactlyOnce(
    source,
    credentialsDeclaration,
    `${credentialsDeclaration}\n${injectedSource}`,
    name,
  );
}

const semanticPositiveControls = [
  {
    name: "controller acepta un nombre local inocente para la evidencia backend",
    file: "controller" as const,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const resolution = findNamedFunction(sourceFile, "resolvePortalAccess");
      return renameIdentifiersWithin(
        source,
        sourceFile,
        resolution,
        "coachRegistration",
        "backendEvidence",
      );
    },
  },
  {
    name: "controller acepta reformateo multilinea del lookup autoritativo",
    file: "controller" as const,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const coachRegistration = await gateway.getCoachRegistration(identity.userId, input.owner);",
      `    const coachRegistration = await gateway.getCoachRegistration(
      identity.userId,
      input.owner,
    );`,
      "control positivo controller: reformateo",
    ),
  },
  {
    name: "gateway acepta nombre y formato inocentes para la evidencia SELECT",
    file: "gateway" as const,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "getCoachRegistration");
      return renameIdentifiersWithin(
        source,
        sourceFile,
        method,
        "row",
        "registrationEvidence",
      );
    },
  },
] as const;

const EXPECTED_SEMANTIC_POSITIVE_CONTROL_COUNT = 3;
assert.equal(
  semanticPositiveControls.length,
  EXPECTED_SEMANTIC_POSITIVE_CONTROL_COUNT,
  "AUTH-COACH-01 fija tres controles positivos semánticos",
);

test("controles positivos semánticos toleran nombres y reformateos inocentes", () => {
  const sources = readSources();
  for (const control of semanticPositiveControls) {
    const original = sources[control.file];
    const transformed = control.apply(original);
    assert.notEqual(sha256(transformed), sha256(original), `${control.name}: transformación efectiva`);
    assertValidTypeScript(
      transformed,
      control.file === "controller" ? CONTROLLER_PATH : GATEWAY_PATH,
    );
    if (control.file === "controller") {
      auditCoachAuthorizationSemantics(transformed);
    } else {
      auditGatewayCoachLookupSemantics(transformed);
    }
  }
});

const authSeparatePositiveControls = [
  {
    name: "AUTH-SEPARATE-01 tolera comentario antes del signup Coach",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const signup = await gateway.signUpForCoachRegistration(input, owner);",
      `    // La identidad Coach se crea únicamente mediante este signup aislado.
    const signup = await gateway.signUpForCoachRegistration(input, owner);`,
      "control positivo AUTH-SEPARATE-01 controller",
    ),
  },
  {
    name: "AUTH-SEPARATE-01 tolera comentario antes del payload allowlisted",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "signUpForCoachRegistration");
      const transformedMethod = replaceExactlyOnce(
        method.getText(sourceFile),
        "      const signupPayload = withSignupConfirmationMetadata(",
        `      // El transporte conserva sólo los campos explícitos del registro.
      const signupPayload = withSignupConfirmationMetadata(`,
        "control positivo AUTH-SEPARATE-01 gateway",
      );
      return replaceNodeText(source, sourceFile, method, transformedMethod);
    },
  },
  {
    name: "AUTH-SEPARATE-01 tolera comentario sobre el correo de contacto",
    file: "form" as const,
    path: FORM_PATH,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  const rawContactEmail = readRawText(formData, \"register-contact-email\");",
      `  // El contacto profesional no participa del inicio de sesión.
  const rawContactEmail = readRawText(formData, "register-contact-email");`,
      "control positivo AUTH-SEPARATE-01 form",
    ),
  },
] as const;

const EXPECTED_AUTH_SEPARATE_POSITIVE_CONTROL_COUNT = 3;
assert.equal(
  authSeparatePositiveControls.length,
  EXPECTED_AUTH_SEPARATE_POSITIVE_CONTROL_COUNT,
  "AUTH-SEPARATE-01 fija tres controles positivos inocentes",
);

test("controles positivos AUTH-SEPARATE-01 toleran comentarios inocentes", () => {
  const sources = readSources();
  for (const control of authSeparatePositiveControls) {
    const original = sources[control.file];
    const transformed = control.apply(original);
    assert.notEqual(
      sha256(transformed),
      sha256(original),
      `${control.name}: transformación efectiva`,
    );
    assertValidTypeScript(transformed, control.path);
    assert.doesNotThrow(
      () => auditIntegration({
        ...sources,
        [control.file]: transformed,
      }),
      `${control.name}: no cambia la semántica AUTH-SEPARATE-01`,
    );
  }
});

const userSemanticPositiveControls = [
  {
    name: "H1 acepta renombre inocente de la evidencia de sesión global",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateUserActivationGlobalSessionGuard(sourceFile);
      assert.ok(located.evidenceName, "control H1 localiza evidencia global");
      return renameIdentifiersWithin(
        source,
        sourceFile,
        located.activation,
        located.evidenceName,
        "authenticatedGlobalSession",
      );
    },
  },
  {
    name: "H2 acepta renombre inocente del parámetro esperado",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateInitialUserWriteOwnershipGuard(sourceFile);
      assert.ok(located.expectedUserIdName, "control H2 localiza expectedUserId");
      return renameIdentifiersWithin(
        source,
        sourceFile,
        located.method,
        located.expectedUserIdName,
        "requestedIdentityId",
      );
    },
  },
  {
    name: "H2 acepta reformateo multilinea del guard pre-write",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateInitialUserWriteOwnershipGuard(sourceFile);
      assert.ok(
        located.guard && located.ownerName && located.expectedUserIdName,
        "control H2 localiza guard pre-write",
      );
      return replaceNodeText(
        source,
        sourceFile,
        located.guard,
        `if (
        !ownsRegistration(
          ${located.ownerName},
          ${located.expectedUserIdName},
        )
      ) {
        throw staleRegistrationError();
      }`,
      );
    },
  },
  {
    name: "H3 ignora comentarios junto al guard de ownership cruzado",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateCrossedUserRowGuard(sourceFile);
      assert.ok(located.guard, "control H3 localiza guard cruzado");
      const start = located.guard.getStart(sourceFile);
      return `${source.slice(0, start)}/* evidencia backend own-only */\n  ${source.slice(start)}`;
    },
  },
  {
    name: "H3 acepta renombre inocente de la variable de evidencia",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateCrossedUserRowGuard(sourceFile);
      assert.ok(located.rowName, "control H3 localiza variable de evidencia");
      return renameIdentifiersWithin(
        source,
        sourceFile,
        located.readFunction,
        located.rowName,
        "userRegistrationEvidence",
      );
    },
  },
] as const;

const EXPECTED_USER_SEMANTIC_POSITIVE_CONTROL_COUNT = 5;
assert.equal(
  userSemanticPositiveControls.length,
  EXPECTED_USER_SEMANTIC_POSITIVE_CONTROL_COUNT,
  "AUTH-COACH-01 Usuario fija cinco controles positivos semánticos H1-H3",
);

test("controles positivos Usuario H1-H3 toleran renombres, formato y comentarios", () => {
  const gateway = readSources().gateway;
  for (const control of userSemanticPositiveControls) {
    const transformed = control.apply(gateway);
    assert.notEqual(sha256(transformed), sha256(gateway), `${control.name}: transformación efectiva`);
    assertValidTypeScript(transformed, GATEWAY_PATH);
    auditGatewayUserLookupSemantics(transformed);
  }
});

const browserStoragePositiveControls = [
  {
    name: "comentario que menciona destructuring de localStorage",
    apply: (source: string) => (
      `${source}\n// const { localStorage: storage } = window; storage.setItem(\"key\", payload);\n`
    ),
  },
  {
    name: "string de documentación que menciona sessionStorage",
    apply: (source: string) => (
      `${source}\nconst authSessionStorageDocumentation = \"sessionStorage no conserva formularios Coach\";\n`
    ),
  },
  {
    name: "identificador localStorageWarning inocente",
    apply: (source: string) => (
      `${source}\nconst localStorageWarning = \"Persistencia Auth deshabilitada\";\n`
    ),
  },
  {
    name: "fixture textual con destructuring no ejecutable",
    apply: (source: string) => (
      `${source}\nconst browserStorageFixture = 'const { sessionStorage: storage } = window; storage.setItem("key", payload);';\n`
    ),
  },
  {
    name: "destructuring de location desde window",
    apply: (source: string) => (
      `${source}\nconst { location: currentBrowserLocation } = window; void currentBrowserLocation;\n`
    ),
  },
  {
    name: "objeto de dominio con propiedad localStorage",
    apply: (source: string) => (
      `${source}\nconst customRepository = { setItem(_key: string, _value: string) {} };\nconst domainSource = { localStorage: customRepository };\nconst { localStorage: repository } = domainSource;\nrepository.setItem("key", "value");\n`
    ),
  },
  {
    name: "getItem sobre Browser Storage reconocido",
    apply: (source: string) => (
      `${source}\nwindow.localStorage.getItem("coach-switch-form");\n`
    ),
  },
  {
    name: "alias global y destructuring inocentes reformateados",
    apply: (source: string) => (
      `${source}\nconst browserWindowAlias = window;\nconst {\n  location: renamedBrowserLocation,\n} = browserWindowAlias;\nvoid renamedBrowserLocation;\n`
    ),
  },
] as const;

const EXPECTED_BROWSER_STORAGE_POSITIVE_CONTROL_COUNT = 8;
assert.equal(
  browserStoragePositiveControls.length,
  EXPECTED_BROWSER_STORAGE_POSITIVE_CONTROL_COUNT,
  "AUTH-COACH-01 M11 fija ocho controles inocentes AST",
);

test("M11 ignora destructuring, comentarios, strings, dominios y lecturas inocentes", () => {
  const sources = readSources();
  for (const control of browserStoragePositiveControls) {
    const transformed = control.apply(sources.root);
    assert.notEqual(transformed, sources.root, `${control.name}: transformación efectiva`);
    assert.notEqual(
      sha256(transformed),
      sha256(sources.root),
      `${control.name}: cambia realmente el SHA`,
    );
    assertValidTypeScript(transformed, ROOT_PATH);
    assert.doesNotThrow(
      () => auditIntegration({ ...sources, root: transformed }),
      `${control.name}: no representa persistencia ejecutable`,
    );
  }
});

test("wiring multiportal bloquea bypass cliente y deja seam Coach tipado", () => {
  const sources = readSources();
  for (const [path, source] of [
    [ROOT_PATH, sources.root],
    [CONTROLLER_PATH, sources.controller],
    [OWNER_PATH, sources.owner],
    [GATEWAY_PATH, sources.gateway],
    [HOOK_PATH, sources.hook],
  ] as const) {
    assertValidTypeScript(source, path);
  }
  auditIntegration(sources);
});

const mutations = [
  {
    name: "AC-039 · restaura fallback existing ?? create",
    supersededAc039Evidence: "restore_existing_fallback" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.existingBranch,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      `    if (existingCoachRegistration) {
      if (existingCoachRegistration.userId !== identity.userId) {
        return controlledCoachRegistrationError();
      }
      return {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
      };
    }

    const coachRegistration = existingCoachRegistration ?? await gateway.createCoachRegistration(
      input.registration,
      identity.userId,
      owner,
    );`,
      `    const coachRegistration = existingCoachRegistration ?? await gateway.createCoachRegistration(
      input.registration,
      identity.userId,
      owner,
    );`,
      "AC-039 restaura fallback existing ?? create",
    ),
  },
  {
    name: "AC-039 · fila existente retorna coach_authorized",
    supersededAc039Evidence: "authorize_existing_registration" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.controlledError,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      `      return {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
      };`,
      `      return {
        state: "coach_authorized",
        requestedPortal: "coach",
        userId: identity.userId,
        coach: existingCoachRegistration,
        authState: identity.authState,
      };`,
      "AC-039 autoriza fila existente",
    ),
  },
  {
    name: "AC-039 · crea antes de rechazar duplicado",
    supersededAc039Evidence: "create_before_duplicate_rejection" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.noCreate,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (existingCoachRegistration) {",
      `    if (existingCoachRegistration) {
      await gateway.createCoachRegistration(input.registration, identity.userId, owner);`,
      "AC-039 crea antes de rechazar",
    ),
  },
  {
    name: "AC-039 · activa identidad antes de rechazar duplicado",
    supersededAc039Evidence: "activate_before_duplicate_rejection" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.noActivation,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (existingCoachRegistration) {",
      `    if (existingCoachRegistration) {
      await gateway.activateCoachRegistrationIdentity(identity, owner);`,
      "AC-039 activa antes de rechazar",
    ),
  },
  {
    name: "AC-039 · aplica professional_title nuevo sobre la fila existente",
    supersededAc039Evidence: "overwrite_existing_title" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.immutableRow,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (existingCoachRegistration) {",
      `    if (existingCoachRegistration) {
      Object.assign(existingCoachRegistration, {
        professionalTitle: input.registration.professional_title,
      });`,
      "AC-039 sobrescribe título existente",
    ),
  },
  {
    name: "AC-039 · navega después de publicar el error duplicado",
    supersededAc039Evidence: "navigate_after_duplicate" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: AC039_FAILURES.rootNoContinuation,
    exactFailureLine: true,
    apply(source: string) {
      const { sourceFile, guard } = locateRegistrationErrorGuard(
        source,
        "coachRegistrationPayload",
      );
      assert.ok(ts.isBlock(guard.thenStatement), "AC-039 localiza bloque error Coach");
      const block = guard.thenStatement;
      const mutatedBlock = replaceExactlyOnce(
        block.getText(sourceFile),
        "          return;",
        `          navigation.transition(
            createAuthNavigationReset("dashboard", "session-established"),
          );
          return;`,
        "AC-039 navega tras duplicado",
      );
      return replaceNodeText(source, sourceFile, block, mutatedBlock);
    },
  },
  {
    name: "AC-039 · ejecuta signOut durante el rechazo duplicado",
    supersededAc039Evidence: "signout_on_duplicate" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.noSignOut,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (existingCoachRegistration) {",
      `    if (existingCoachRegistration) {
      await gateway.signOut(
        "authorization_error",
        owner as unknown as PortalResolutionOwner,
      );`,
      "AC-039 signOut en duplicado",
    ),
  },
  {
    name: "AC-039 · infiere duplicado desde el correo controlado por cliente",
    supersededAc039Evidence: "infer_duplicate_from_client_email" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.noClientInference,
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const registerCoach = findNamedFunction(sourceFile, "registerCoach");
      const identitySwitchGuard = collectIfStatements(registerCoach.body).find((ifStatement) => (
        statementContainsReturn(
          ifStatement.thenStatement,
          (expression) => objectLiteralStringProperty(
            expression,
            "state",
          ) === "identity_switch_required",
        )
      ));
      assert.ok(identitySwitchGuard, "AC-039 localiza mismatch A→B");
      const injected = `
    if (input.auth.email.endsWith("@coach.example")) {
      return {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
      };
    }`;
      return `${source.slice(0, identitySwitchGuard.end)}${injected}${source.slice(identitySwitchGuard.end)}`;
    },
  },
  {
    name: "AC-039 · revela duplicado con contraseña incorrecta",
    supersededAc039Evidence: "reveal_duplicate_with_invalid_password" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.invalidPasswordPrivacy,
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const registerCoach = findNamedFunction(sourceFile, "registerCoach");
      const existingIdentityGuard = collectIfStatements(registerCoach.body).find(
        (ifStatement) => /\.kind\s*===\s*"existing_identity"/.test(
          ifStatement.expression.getText(sourceFile),
        ),
      );
      assert.ok(existingIdentityGuard, "AC-039 localiza respuesta Auth ofuscada");
      const branch = existingIdentityGuard.thenStatement.getText(sourceFile);
      const mutatedBranch = replaceExactlyOnce(
        branch,
        "message: REGISTRATION_EXISTING_IDENTITY_MESSAGE,",
        "message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,",
        "AC-039 revela duplicado con password inválida",
      );
      return replaceNodeText(source, sourceFile, existingIdentityGuard.thenStatement, mutatedBranch);
    },
  },
  {
    name: "AC-039 · rechaza incorrectamente a Usuario-only",
    supersededAc039Evidence: "reject_user_only" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.userOnlyAllowed,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      `    }

    const coachRegistration = existingCoachRegistration ?? await gateway.createCoachRegistration(`,
      `    }
    if (!existingCoachRegistration) {
      return {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
      };
    }

    const coachRegistration = existingCoachRegistration ?? await gateway.createCoachRegistration(`,
      "AC-039 rechaza Usuario-only",
    ),
  },
  {
    name: "AC-039 · rompe Login Coach con fila propia",
    supersededAc039Evidence: "break_coach_login" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.unique-coach-authorization-path] resolvePortalAccess tiene un único retorno Coach",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const resolution = findNamedFunction(sourceFile, "resolvePortalAccess");
      const coachReturn = collectReturns(resolution.body).find(isCoachAuthorizedReturn);
      assert.ok(coachReturn, "AC-039 localiza éxito de Login Coach");
      const mutatedReturn = replaceExactlyOnce(
        coachReturn.getText(sourceFile),
        'state: "coach_authorized"',
        'state: "error"',
        "AC-039 rompe Login Coach",
      );
      return replaceNodeText(source, sourceFile, coachReturn, mutatedReturn);
    },
  },
  {
    name: "AC-039 · consulta duplicado antes del mismatch A→B",
    supersededAc039Evidence: "lookup_before_identity_switch" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.switchPrecedence,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (identity && !sameEmail(identity.email, input.auth.email)) {\n      return {",
      `    if (identity && !sameEmail(identity.email, input.auth.email)) {
      await gateway.getCoachRegistration(identity.userId, owner);
      return {`,
      "AC-039 lookup antes de mismatch",
    ),
  },
  {
    name: "AC-039 · acepta fila cruzada como duplicado",
    supersededAc039Evidence: "accept_crossed_row_as_duplicate" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.crossedRow,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      if (existingCoachRegistration.userId !== identity.userId) {",
      "      if (false) {",
      "AC-039 acepta fila cruzada",
    ),
  },
  {
    name: "AC-039 · cambia el mensaje exacto aprobado",
    supersededAc039Evidence: "change_exact_message" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.exactMessage,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '"Este correo ya se encuentra registrado como Coach. Intente con otro correo."',
      '"Este Coach ya existe."',
      "AC-039 cambia mensaje exacto",
    ),
  },
  {
    name: "AC-039 · transporta professional_title nuevo en el error",
    supersededAc039Evidence: "transport_new_title" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.minimalResult,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,\n      };",
      `        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
        professionalTitle: input.registration.professional_title,
      };`,
      "AC-039 transporta título nuevo",
    ),
  },
  {
    name: "AC-039 · ejecuta signup antes de rechazar y puede emitir correo",
    supersededAc039Evidence: "signup_before_duplicate_rejection" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AC039_FAILURES.noEmail,
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (existingCoachRegistration) {",
      `    if (existingCoachRegistration) {
      await gateway.signUpForCoachRegistration(input.auth, owner);`,
      "AC-039 signup antes de rechazo",
    ),
  },
  {
    name: "AC-039 R1 · Coach distingue existing_identity de confirmation_required",
    ac039Evidence: "coach_public_outcome_diverges" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AMBIGUOUS_IDENTITY_FAILURE,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (signup.kind === "confirmation_required" || signup.kind === "existing_identity") {',
      '    if (signup.kind === "confirmation_required") {',
      "AC-039 R1 separa existing_identity Coach",
    ),
  },
  {
    name: "AC-039 R1 · Usuario distingue existing_identity de confirmation_required",
    ac039Evidence: "user_public_outcome_diverges" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AMBIGUOUS_IDENTITY_FAILURE,
    apply: (source: string) => replaceExactlyOnce(
      source,
      `          signup.kind === "confirmation_required"
          || signup.kind === "existing_identity"`,
      '          signup.kind === "confirmation_required"',
      "AC-039 R1 separa existing_identity Usuario",
    ),
  },
  {
    name: "AC-039 R1 · consulta membresía Coach antes del resultado neutral",
    ac039Evidence: "coach_membership_lookup_before_neutral_result" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AMBIGUOUS_IDENTITY_FAILURE,
    apply: (source: string) => replaceExactlyOnce(
      source,
      `    if (signup.kind === "confirmation_required" || signup.kind === "existing_identity") {
      return {`,
      `    if (signup.kind === "confirmation_required" || signup.kind === "existing_identity") {
      await gateway.getCoachRegistration("enumerated-user", owner);
      return {`,
      "AC-039 R1 agrega lookup Coach al resultado neutral",
    ),
  },
  {
    name: "AC-039 R1 · copy público afirma existencia",
    ac039Evidence: "public_copy_reveals_existing_account" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: AMBIGUOUS_IDENTITY_FAILURE,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "Si corresponde, completa la confirmación desde tu correo. También puedes iniciar sesión, recuperar tu contraseña o usar otro correo de acceso.",
      "Esta cuenta ya existe.",
      "AC-039 R1 revela existencia en copy público",
    ),
  },
  {
    name: "AUTH-SEPARATE-01 R2 · omite code estable de identidad existente",
    r2Evidence: "existing_identity_code" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '  "user_already_exists",',
      '  "user_identity_unknown",',
      "R2 omite code estable",
    ),
  },
  {
    name: "AUTH-SEPARATE-01 R2 · omite fallback de mensaje conocido",
    r2Evidence: "existing_identity_message" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '  "user already registered",',
      '  "unknown signup error",',
      "R2 omite fallback message",
    ),
  },
  {
    name: "AUTH-SEPARATE-01 R2 · clasifica cualquier error como identidad existente",
    r2Evidence: "non_identity_error_control" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: EXPLICIT_EXISTING_IDENTITY_ERROR_FAILURE,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  return EXISTING_IDENTITY_SIGNUP_ERROR_MESSAGES.has(message);",
      "  return Boolean(message);",
      "R2 elimina control inocente no-identidad",
    ),
  },
  {
    name: "AUTH-SEPARATE-01 R2 · Coach cambia ruta tras confirmación neutral",
    r2Evidence: "coach_auth_route" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: CONFIRMATION_ROOT_NO_EFFECTS_FAILURE,
    apply(source: string) {
      const { sourceFile, guard } = locateRegistrationStateGuard(
        source,
        "coach_confirmation_required",
      );
      assert.ok(ts.isBlock(guard.thenStatement), "R2 localiza confirmación Coach");
      const block = guard.thenStatement;
      const mutatedBlock = replaceExactlyOnce(
        block.getText(sourceFile),
        "          return;",
        `          authRouteController.replace({ mode: "login", accountType: "coach" });
          return;`,
        "R2 Coach cambia ruta",
      );
      return replaceNodeText(source, sourceFile, block, mutatedBlock);
    },
  },
  {
    name: "AUTH-SEPARATE-01 R2 · Usuario navega tras confirmación neutral",
    r2Evidence: "user_navigation" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: CONFIRMATION_ROOT_NO_EFFECTS_FAILURE,
    apply(source: string) {
      const { sourceFile, guard } = locateRegistrationStateGuard(
        source,
        "user_confirmation_required",
      );
      assert.ok(ts.isBlock(guard.thenStatement), "R2 localiza confirmación Usuario");
      const block = guard.thenStatement;
      const mutatedBlock = replaceExactlyOnce(
        block.getText(sourceFile),
        "          return;",
        `          navigation.transition(
            createAuthNavigationReset("login", "signup-confirmation-pending"),
          );
          return;`,
        "R2 Usuario navega",
      );
      return replaceNodeText(source, sourceFile, block, mutatedBlock);
    },
  },
  {
    name: "AUTH-SEPARATE-01 R2 · Coach aplica sesión tras confirmación neutral",
    r2Evidence: "coach_session_application" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: CONFIRMATION_ROOT_NO_EFFECTS_FAILURE,
    apply(source: string) {
      const { sourceFile, guard } = locateRegistrationStateGuard(
        source,
        "coach_confirmation_required",
      );
      assert.ok(ts.isBlock(guard.thenStatement), "R2 localiza confirmación Coach");
      const block = guard.thenStatement;
      const mutatedBlock = replaceExactlyOnce(
        block.getText(sourceFile),
        "          return;",
        `          applySessionState(registration.authState);
          return;`,
        "R2 Coach aplica sesión",
      );
      return replaceNodeText(source, sourceFile, block, mutatedBlock);
    },
  },
  {
    name: "AUTH-SEPARATE-01 R2 · Coach publica portal tras confirmación neutral",
    r2Evidence: "coach_portal_application" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: CONFIRMATION_ROOT_NO_EFFECTS_FAILURE,
    apply(source: string) {
      const { sourceFile, guard } = locateRegistrationStateGuard(
        source,
        "coach_confirmation_required",
      );
      assert.ok(ts.isBlock(guard.thenStatement), "R2 localiza confirmación Coach");
      const block = guard.thenStatement;
      const mutatedBlock = replaceExactlyOnce(
        block.getText(sourceFile),
        "          return;",
        `          replaceCoachPortalSession(null);
          return;`,
        "R2 Coach publica portal",
      );
      return replaceNodeText(source, sourceFile, block, mutatedBlock);
    },
  },
  {
    name: "SWITCH · permite reutilizar una sesión activa del mismo correo",
    identitySwitchEvidence: "omit_email_comparison" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-SEPARATE-01.SWITCH.any-session] cualquier sesión activa exige cierre antes del signup",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (currentIdentity) {",
      "    if (currentIdentity.email !== input.auth.email) {",
      "SWITCH permite reutilizar sesión del mismo correo",
    ),
  },
  {
    name: "SWITCH · autoriza B usando el lookup de formulario bajo sesión A",
    identitySwitchEvidence: "authorize_b_with_session_a" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.session-a-cannot-authorize-b] lookup y activación permanecen ligados a la identidad autenticada",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const coachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
      "    const coachRegistration = await gateway.getCoachRegistration(input.auth.email, owner);",
      "SWITCH autoriza B con sesión A",
    ),
  },
  {
    name: "SWITCH · conserva coachPortalSession A al mostrar el aviso",
    identitySwitchEvidence: "keep_portal_a" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.portal-a-cleared-on-warning] el aviso desmonta A antes de exponer la acción",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '        if (registration.state === "identity_switch_required") {\n          replaceCoachPortalSession(null);',
      '        if (registration.state === "identity_switch_required") {\n          void coachPortalSessionRef.current;',
      "SWITCH conserva portal A",
    ),
  },
  {
    name: "SWITCH · consulta membresía Coach antes del cambio de identidad",
    identitySwitchEvidence: "write_before_switch" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.no-write-before-switch] el mismatch no alcanza autenticación, lookup ni write Coach",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (currentIdentity) {\n      if (!owner.bindExpectedUserId(currentIdentity.userId)) return staleCoachRegistration();",
      "    if (currentIdentity) {\n      await gateway.getCoachRegistration(currentIdentity.userId, owner);\n      if (!owner.bindExpectedUserId(currentIdentity.userId)) return staleCoachRegistration();",
      "SWITCH lookup antes del cambio",
    ),
  },
  {
    name: "SWITCH · usa signout global",
    identitySwitchEvidence: "global_signout" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.local-signout-only] el cambio revalida A y usa sólo signout local",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "signOutForCoachIdentitySwitch");
      const mutatedMethod = replaceExactlyOnce(
        method.getText(sourceFile),
        'supabase.auth.signOut({ scope: "local" })',
        "supabase.auth.signOut()",
        "SWITCH signout global",
      );
      return replaceNodeText(source, sourceFile, method, mutatedMethod);
    },
  },
  {
    name: "SWITCH · navega fuera de registro/coach tras SIGNED_OUT",
    identitySwitchEvidence: "navigate_after_signed_out" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.coach-route-preserved] SIGNED_OUT no abandona registro/coach",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '          clearUserSessionState("", previousStorageScope, {\n            navigate: false,',
      '          clearUserSessionState("", previousStorageScope, {\n            navigate: true,',
      "SWITCH navega tras SIGNED_OUT",
    ),
  },
  {
    name: "SWITCH · limpia los valores Coach B",
    identitySwitchEvidence: "clear_form_b" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.form-b-preserved] el cierre conserva los campos controlados y locales de B",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "            preserveAuthForms: true,",
      "            preserveAuthForms: false,",
      "SWITCH limpia formulario B",
    ),
  },
  {
    name: "SWITCH · autoenvía el formulario después del cierre",
    identitySwitchEvidence: "auto_submit_after_close" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.manual-resubmit-required] SIGNED_OUT no reenvía el formulario",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '          setIsAuthLoading(false);\n          setAuthStatus("", "info");\n          return;',
      '          setIsAuthLoading(false);\n          setAuthStatus("", "info");\n          void handleAuth("registro", new FormData());\n          return;',
      "SWITCH autoenvía formulario",
    ),
  },
  {
    name: "SWITCH · callback stale remonta A",
    identitySwitchEvidence: "stale_callback_remounts_a" as const,
    file: "hook" as const,
    path: HOOK_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.stale-a-blocked] un callback tardío de A no vuelve a aplicarse",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      if (blockedCoachIdentityUserIdRef.current === currentUserId) {",
      "      if (false) {",
      "SWITCH callback stale remonta A",
    ),
  },
  {
    name: "SWITCH · acepta fila Coach con otro user_id",
    identitySwitchEvidence: "accept_crossed_coach_row" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.crossed-coach-row-rejected] una fila Coach de otro user_id falla cerrada",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const readFunction = findNamedFunction(sourceFile, "readOwnCoachRegistration");
      const mutatedFunction = replaceExactlyOnce(
        readFunction.getText(sourceFile),
        "  if (row && row.userId !== expectedUserId) {",
        "  if (false) {",
        "SWITCH acepta fila Coach cruzada",
      );
      return replaceNodeText(source, sourceFile, readFunction, mutatedFunction);
    },
  },
  {
    name: "SWITCH · muestra professional_title de la sesión anterior",
    identitySwitchEvidence: "show_previous_professional_title" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.own-professional-title] el portal deriva professional_title sólo de la fila Coach autorizada",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "          registration: access.coach,",
      "          registration: coachPortalSessionRef.current?.registration ?? access.coach,",
      "SWITCH usa professional_title anterior",
    ),
  },
  {
    name: "SWITCH · declara éxito sin membresía Coach",
    identitySwitchEvidence: "success_without_coach_membership" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.membership-required-for-success] no existe éxito Coach sin fila leída o creada",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (!coachRegistration || coachRegistration.userId !== identity.userId) {",
      "    if (false) {",
      "SWITCH éxito sin membresía",
    ),
  },
  {
    name: "SWITCH M11 · persiste password y email en window.localStorage",
    identitySwitchEvidence: "sensitive_window_local_storage" as const,
    browserStorageEvidence: "window_local_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    window.localStorage.setItem(
      "coach-switch-form",
      JSON.stringify({ email, password }),
    );`,
      "M11 window.localStorage",
    ),
  },
  {
    name: "SWITCH M11 · persiste password en localStorage global",
    identitySwitchEvidence: "sensitive_bare_local_storage" as const,
    browserStorageEvidence: "bare_local_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      '    localStorage.setItem("coach-switch-password", password);',
      "M11 localStorage global",
    ),
  },
  {
    name: "SWITCH M11 · persiste formulario completo en window.sessionStorage",
    identitySwitchEvidence: "sensitive_window_session_storage" as const,
    browserStorageEvidence: "window_session_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    window.sessionStorage.setItem(
      "coach-switch-form",
      JSON.stringify(formData),
    );`,
      "M11 window.sessionStorage",
    ),
  },
  {
    name: "SWITCH M11 · persiste email en sessionStorage global",
    identitySwitchEvidence: "sensitive_bare_session_storage" as const,
    browserStorageEvidence: "bare_session_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      '    sessionStorage.setItem("coach-switch-email", email);',
      "M11 sessionStorage global",
    ),
  },
  {
    name: "SWITCH M11 · usa acceso computado window localStorage",
    identitySwitchEvidence: "sensitive_computed_local_storage" as const,
    browserStorageEvidence: "computed_local_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    window["localStorage"].setItem(
      "coach-switch-form",
      JSON.stringify({ email, password }),
    );`,
      "M11 acceso computado localStorage",
    ),
  },
  {
    name: "SWITCH M11 · persiste mediante alias directo de localStorage",
    identitySwitchEvidence: "sensitive_storage_alias" as const,
    browserStorageEvidence: "direct_storage_alias" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const coachSwitchStorage = window.localStorage;
    coachSwitchStorage.setItem(
      "coach-switch-form",
      JSON.stringify({ email, password }),
    );`,
      "M11 alias directo localStorage",
    ),
  },
  {
    name: "SWITCH M11 · persiste mediante globalThis.sessionStorage",
    identitySwitchEvidence: "sensitive_global_session_storage" as const,
    browserStorageEvidence: "global_session_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    globalThis.sessionStorage.setItem(
      "coach-switch-form",
      JSON.stringify({ email, password }),
    );`,
      "M11 globalThis.sessionStorage",
    ),
  },
  {
    name: "SWITCH M11 · destructuring explícito de localStorage",
    identitySwitchEvidence: "sensitive_destructured_local_storage_alias" as const,
    browserStorageEvidence: "destructured_local_storage_alias" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const form = formData;
    const { localStorage: storage } = window;
    storage.setItem("key", JSON.stringify(form));`,
      "M11 destructuring explícito localStorage",
    ),
  },
  {
    name: "SWITCH M11 · destructuring shorthand de localStorage",
    identitySwitchEvidence: "sensitive_destructured_local_storage_shorthand" as const,
    browserStorageEvidence: "destructured_local_storage_shorthand" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const { localStorage } = window;
    localStorage.setItem("key", JSON.stringify(formData));`,
      "M11 destructuring shorthand localStorage",
    ),
  },
  {
    name: "SWITCH M11 · destructuring explícito de sessionStorage",
    identitySwitchEvidence: "sensitive_destructured_session_storage_alias" as const,
    browserStorageEvidence: "destructured_session_storage_alias" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const { sessionStorage: storage } = window;
    storage.setItem("key", JSON.stringify(formData));`,
      "M11 destructuring explícito sessionStorage",
    ),
  },
  {
    name: "SWITCH M11 · destructuring desde globalThis",
    identitySwitchEvidence: "sensitive_destructured_global_this_storage" as const,
    browserStorageEvidence: "destructured_global_this_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const { localStorage: storage } = globalThis;
    storage.setItem("key", JSON.stringify(formData));`,
      "M11 destructuring globalThis",
    ),
  },
  {
    name: "SWITCH M11 · destructuring con propiedad computada",
    identitySwitchEvidence: "sensitive_destructured_computed_storage" as const,
    browserStorageEvidence: "destructured_computed_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const { ["sessionStorage"]: storage } = window;
    storage.setItem("key", JSON.stringify(formData));`,
      "M11 destructuring computado",
    ),
  },
  {
    name: "SWITCH M11 · destructuring desde alias de window",
    identitySwitchEvidence: "sensitive_destructured_global_alias" as const,
    browserStorageEvidence: "destructured_global_alias" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const browser = window;
    const { localStorage: storage } = browser;
    storage.setItem("key", JSON.stringify(formData));`,
      "M11 destructuring desde alias global",
    ),
  },
  {
    name: "SWITCH M11 · cadena posterior a destructuring",
    identitySwitchEvidence: "sensitive_destructured_storage_alias_chain" as const,
    browserStorageEvidence: "destructured_storage_alias_chain" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      `    const { localStorage: first } = window;
    const second = first;
    second.setItem("key", JSON.stringify(formData));`,
      "M11 cadena posterior a destructuring",
    ),
  },
  {
    name: "AUTH-HYBRID-01 · el dispatcher ignora el flujo elegido",
    hybridEvidence: "explicit_flow" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.controller.explicit-flow] selector tipado decide el flujo",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      'input.flow === "shared"',
      "true",
      "HYBRID dispatcher ignora flujo",
    ),
  },
  {
    name: "AUTH-HYBRID-01 · preparación compartida omite membresía Usuario",
    hybridEvidence: "preparation_user_membership" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.shared.login-and-membership] sesión y membresía Usuario son obligatorias",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const preparation = findNamedFunction(sourceFile, "prepareSharedCoachRegistration");
      const mutatedPreparation = replaceExactlyOnce(
        preparation.getText(sourceFile),
        '    if (!hasUserRegistration) return { state: "sign_in_required" };',
        '    if (false) return { state: "sign_in_required" };',
        "HYBRID preparación sin Usuario",
      );
      return replaceNodeText(source, sourceFile, preparation, mutatedPreparation);
    },
  },
  {
    name: "AUTH-HYBRID-01 · activación compartida omite membresía Usuario",
    hybridEvidence: "shared_user_membership" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.shared.same-identity] activación queda ligada a la identidad Usuario",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const shared = findNamedFunction(sourceFile, "registerSharedCoach");
      const mutatedShared = replaceExactlyOnce(
        shared.getText(sourceFile),
        "    if (!hasUserRegistration) return controlledCoachRegistrationError();",
        "    if (false) return controlledCoachRegistrationError();",
        "HYBRID activación sin Usuario",
      );
      return replaceNodeText(source, sourceFile, shared, mutatedShared);
    },
  },
  {
    name: "AUTH-HYBRID-01 · cuenta compartida ejecuta signUp",
    hybridEvidence: "shared_signup" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.shared.no-new-credential] cuenta compartida no crea ni reemplaza credencial",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const shared = findNamedFunction(sourceFile, "registerSharedCoach");
      const mutatedShared = replaceExactlyOnce(
        shared.getText(sourceFile),
        "    const coachRegistration = await gateway.createSharedCoachRegistration(",
        "    await gateway.signUpForCoachRegistration(registration as never, owner);\n    const coachRegistration = await gateway.createSharedCoachRegistration(",
        "HYBRID shared signUp",
      );
      return replaceNodeText(source, sourceFile, shared, mutatedShared);
    },
  },
  {
    name: "AUTH-HYBRID-01 · cuenta compartida acepta fila cruzada",
    hybridEvidence: "shared_crossed_row" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.shared.same-identity] activación queda ligada a la identidad Usuario",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const shared = findNamedFunction(sourceFile, "registerSharedCoach");
      const mutatedShared = replaceExactlyOnce(
        shared.getText(sourceFile),
        "    if (coachRegistration.userId !== currentIdentity.userId) {",
        "    if (coachRegistration.userId === currentIdentity.userId) {",
        "HYBRID shared fila cruzada",
      );
      return replaceNodeText(source, sourceFile, shared, mutatedShared);
    },
  },
  {
    name: "AUTH-HYBRID-01 · cuenta separada prueba contraseña existente",
    hybridEvidence: "separate_password_probe" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.separate.no-existing-password-probe] no prueba credenciales Usuario",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const separate = findNamedFunction(sourceFile, "registerSeparateCoach");
      const mutatedSeparate = replaceExactlyOnce(
        separate.getText(sourceFile),
        "    const signup = await gateway.signUpForCoachRegistration(input, owner);",
        "    await gateway.signInForCoachRegistration(input.auth, owner);\n    const signup = await gateway.signUpForCoachRegistration(input, owner);",
        "HYBRID separate prueba password",
      );
      return replaceNodeText(source, sourceFile, separate, mutatedSeparate);
    },
  },
  {
    name: "AUTH-HYBRID-01 · cuenta separada reutiliza silenciosamente la sesión A",
    hybridEvidence: "separate_silent_identity_reuse" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.separate.isolated-and-neutral] signUp separado no reutiliza sesión activa",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (activeIdentity && activeIdentity.userId !== identity.userId) {",
      "    if (false) {",
      "HYBRID separate reutiliza A",
    ),
  },
  {
    name: "AUTH-HYBRID-01 · cuenta separada invoca la RPC compartida",
    hybridEvidence: "separate_shared_rpc" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-HYBRID-01.separate.no-existing-password-probe] no prueba credenciales Usuario",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const separate = findNamedFunction(sourceFile, "registerSeparateCoach");
      const mutatedSeparate = replaceExactlyOnce(
        separate.getText(sourceFile),
        "    const signup = await gateway.signUpForCoachRegistration(input, owner);",
        "    await gateway.createSharedCoachRegistration(input.registration, \"other-user\", owner);\n    const signup = await gateway.signUpForCoachRegistration(input, owner);",
        "HYBRID separate usa RPC shared",
      );
      return replaceNodeText(source, sourceFile, separate, mutatedSeparate);
    },
  },
  {
    name: "AUTH-HYBRID-01 · RPC compartida recibe ownership cliente",
    hybridEvidence: "shared_client_ownership" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-HYBRID-01.gateway.no-client-ownership] no existe mass assignment ni ownership cliente",
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const shared = findNamedMethod(sourceFile, "createSharedCoachRegistration");
      const mutatedShared = replaceExactlyOnce(
        shared.getText(sourceFile),
        "        p_first_name: payload.first_name,",
        "        user_id: expectedUserId,\n        p_first_name: payload.first_name,",
        "HYBRID RPC ownership cliente",
      );
      return replaceNodeText(source, sourceFile, shared, mutatedShared);
    },
  },
  {
    name: "AUTH-HYBRID-01 · persiste credenciales de registro en Browser Storage",
    hybridEvidence: "sensitive_browser_storage" as const,
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: NO_SENSITIVE_BROWSER_STORAGE_FAILURE,
    exactFailureLine: true,
    apply: (source: string) => injectAfterAuthCredentials(
      source,
      '    window.localStorage.setItem("auth-registration", JSON.stringify({ email, password }));',
      "HYBRID Browser Storage",
    ),
  },
  {
    name: "accountType concede Coach sin fila",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.authoritative-coach-row]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "if (coachRegistration) {",
      'if (input.requestedPortal === "coach") {',
      "accountType concede Coach sin fila",
    ),
  },
  {
    name: "metadata concede Coach con lógica productiva ejecutable",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.no-metadata-authority]",
    runtimeFailure: "[AUTH-COACH-01.metadata-authority-runtime]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (input.requestedPortal === "usuario") {',
      `    const authorizationMetadata = identity as typeof identity & {
      user_metadata?: { role?: string };
      app_metadata?: { role?: string };
    };
    if (
      input.requestedPortal === "coach"
      && (
        authorizationMetadata.user_metadata?.role === "coach"
        || authorizationMetadata.app_metadata?.role === "coach"
      )
    ) {
      return {
        state: "coach_authorized",
        requestedPortal: "coach",
        userId: identity.userId,
      };
    }

    if (input.requestedPortal === "usuario") {`,
      "metadata concede Coach con lógica productiva ejecutable",
    ),
  },
  {
    name: "rechazo stale alcanza signOut",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.reject-owner-guard]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '): Promise<PortalAccessResult> {\n  if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);\n\n  try {\n    const signOutResult',
      '): Promise<PortalAccessResult> {\n  if (false) return stalePortalResolution(input.requestedPortal);\n\n  try {\n    const signOutResult',
      "rechazo stale alcanza signOut",
    ),
  },
  {
    name: "gateway omite guard de owner antes de signOut",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.signout-owner-guard]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '      if (!expectedUserId || !owner.isCurrent()) return "stale";',
      '      if (!expectedUserId || false) return "stale";',
      "gateway omite guard de owner antes de signOut",
    ),
  },
  {
    name: "gateway omite lectura de sesión local antes de signOut",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.signout-local-session-read]",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "signOut");
      const mutatedMethod = replaceExactlyOnce(
        method.getText(sourceFile),
        "      const localSessionUserId = await getLocalSessionUserId(supabase, owner);",
        "      const localSessionUserId = expectedUserId;",
        "gateway omite lectura de sesión local antes de signOut",
      );
      return replaceNodeText(source, sourceFile, method, mutatedMethod);
    },
  },
  {
    name: "gateway omite comparar sesión local antes de signOut",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.signout-local-identity-match]",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "signOut");
      const mutatedMethod = replaceExactlyOnce(
        method.getText(sourceFile),
        "        localSessionUserId !== expectedUserId",
        "        false",
        "gateway omite comparar sesión local antes de signOut",
      );
      return replaceNodeText(source, sourceFile, method, mutatedMethod);
    },
  },
  {
    name: "gateway omite guard owner posterior a lectura local",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.signout-post-read-owner-guard]",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "signOut");
      const mutatedMethod = replaceExactlyOnce(
        method.getText(sourceFile),
        "        || !owner.isCurrent()",
        "        || false",
        "gateway omite guard owner posterior a lectura local",
      );
      return replaceNodeText(source, sourceFile, method, mutatedMethod);
    },
  },
  {
    name: "SIGNED_OUT conserva owner A",
    file: "hook" as const,
    path: HOOK_PATH,
    expectedFailure: "[AUTH-COACH-01.hook.signed-out-invalidation]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    portalResolutionOwnersRef.current.invalidate();",
      "    void portalResolutionOwnersRef.current;",
      "SIGNED_OUT conserva owner A",
    ),
  },
  {
    name: "cambio A→B no pasa por owner controller",
    file: "hook" as const,
    path: HOOK_PATH,
    expectedFailure: "[AUTH-COACH-01.hook.identity-change-invalidation]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      const replacedIdentity = portalResolutionOwnersRef.current.acceptIdentity(currentUserId);",
      "      const replacedIdentity = false;",
      "cambio A→B no pasa por owner controller",
    ),
  },
  {
    name: "root publica resolución stale",
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.root.stale-before-publication]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (access.state === "stale" || !multiportalAuth.isPortalResolutionCurrent(resolutionOwner)) {',
      "    if (false) {",
      "root publica resolución stale",
    ),
  },
  {
    name: "evento Auth vuelve a depender de timeout",
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.root.no-timeout-authorization]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "        queueMicrotask(() => {",
      "        window.setTimeout(() => {",
      "evento Auth vuelve a depender de timeout",
    ),
  },
  {
    name: "signup Coach envía el objeto crudo sin allowlist",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-SEPARATE-01.gateway.allowlisted-coach-signup]",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "signUpForCoachRegistration");
      const mutatedMethod = replaceExactlyOnce(
        method.getText(sourceFile),
        "isolatedClient.auth.signUp(signupPayload)",
        "isolatedClient.auth.signUp(payload as never)",
        "signup Coach envía objeto crudo",
      );
      return replaceNodeText(source, sourceFile, method, mutatedMethod);
    },
  },
  {
    name: "metadata Coach propaga el payload Auth por spread",
    file: "form" as const,
    path: FORM_PATH,
    expectedFailure: "[AUTH-SEPARATE-01.form.explicit-metadata-allowlist]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  const allowlistedData: UserSignupMetadata = {\n    display_name: data.display_name,",
      "  const allowlistedData: UserSignupMetadata = {\n    ...data,\n    display_name: data.display_name,",
      "metadata Coach propaga payload por spread",
    ),
  },
  {
    name: "ownership cruzado deja de fallar cerrado",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.registration-owner] registro cruzado falla cerrado",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (!coachRegistration || coachRegistration.userId !== identity.userId) {\n      return controlledCoachRegistrationError();",
      "    if (!coachRegistration || coachRegistration.userId === identity.userId) {\n      return controlledCoachRegistrationError();",
      "ownership cruzado deja de fallar cerrado",
    ),
  },
  {
    name: "gateway reintroduce el write Coach desde el cliente",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-HYBRID-01.gateway.closed-coach-ports] sólo existen signup separado y RPC compartida",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    async createUserRegistration(expectedUserId, owner) {",
      "    async createCoachRegistration() {\n      return supabase.rpc(\"register_own_coach\");\n    },\n\n    async createUserRegistration(expectedUserId, owner) {",
      "gateway reintroduce write Coach",
    ),
  },
  {
    name: "registro omite guard posterior a signup",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-SEPARATE-01.registration.post-signup-owner] signup tardío se descarta",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'if (!owner.isCurrent() || signup.kind === "stale") return staleCoachRegistration();',
      'if (signup.kind === "stale") return staleCoachRegistration();',
      "registro omite guard posterior a signup",
    ),
  },
  {
    name: "signup Coach usa cliente global",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-SEPARATE-01.gateway.isolated-coach-signup]",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const method = findNamedMethod(sourceFile, "signUpForCoachRegistration");
      const mutatedMethod = replaceExactlyOnce(
        method.getText(sourceFile),
        "isolatedClient.auth.signUp(signupPayload)",
        "supabase.auth.signUp(signupPayload)",
        "signup Coach usa cliente global",
      );
      return replaceNodeText(source, sourceFile, method, mutatedMethod);
    },
  },
  {
    name: "SIGNED_OUT conserva owner de registro A",
    file: "hook" as const,
    path: HOOK_PATH,
    expectedFailure: "[AUTH-COACH-01.hook.signed-out-invalidation]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    portalResolutionOwnersRef.current.invalidate();\n    coachRegistrationOwnersRef.current.invalidate();\n    userRegistrationOwnersRef.current.invalidate();",
      "    portalResolutionOwnersRef.current.invalidate();\n    void coachRegistrationOwnersRef.current;\n    userRegistrationOwnersRef.current.invalidate();",
      "SIGNED_OUT conserva owner de registro A",
    ),
  },
  {
    name: "E7 · dominio de correo concede Coach",
    securityEvidence: "E7" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.E7.no-email-domain-authority]",
    runtimeFailure: "[AUTH-COACH-01.E7.domain-runtime]",
    runtimeSuite: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (input.requestedPortal === "usuario") {',
      `    const tenant = identity.email?.split("@")[1];
    if (input.requestedPortal === "coach" && tenant === "organizatech.cl") {
      return { state: "coach_authorized", requestedPortal: "coach", userId: identity.userId };
    }

    if (input.requestedPortal === "usuario") {`,
      "E7 · dominio de correo concede Coach",
    ),
  },
  {
    name: "E8 · backdoor por allowlist local de userId",
    securityEvidence: "E8" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.E8.no-user-id-backdoor]",
    runtimeFailure: "[AUTH-COACH-01.E8.user-id-runtime]",
    runtimeSuite: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (input.requestedPortal === "usuario") {',
      `    const registry = new Set(["usuario-autorizado"]);
    if (input.requestedPortal === "coach" && registry.has(identity.userId)) {
      return { state: "coach_authorized", requestedPortal: "coach", userId: identity.userId };
    }

    if (input.requestedPortal === "usuario") {`,
      "E8 · backdoor por allowlist local de userId",
    ),
  },
  {
    name: "E9 · gateway retorna true sin SELECT",
    securityEvidence: "E9" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.E9.authoritative-select-required]",
    runtimeFailure: "[AUTH-COACH-01.E9.owner-select-runtime]",
    runtimeSuite: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      `      const row = await readOwnCoachRegistration(
        dataClientFor(expectedUserId),
        expectedUserId,
        owner,
      );
      return row;`,
      `      if (owner) return {} as never;
      const row = await readOwnCoachRegistration(
        dataClientFor(expectedUserId),
        expectedUserId,
        owner,
      );
      return row;`,
      "E9 · gateway retorna true sin SELECT",
    ),
  },
  {
    name: "H1 · activación Usuario reemplaza sesión global B con la aislada A",
    userSecurityEvidence: "H1" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.H1.global-session-preserved]",
    runtimeFailure: "[AUTH-COACH-01.USER.H1.global-session-preserved]",
    runtimeSuite: true,
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateUserActivationGlobalSessionGuard(sourceFile);
      assert.ok(located.guard, "mutante H1 localiza el guard de sesión global");
      return replaceNodeText(source, sourceFile, located.guard, "");
    },
  },
  {
    name: "H2 · createUserRegistration despacha RPC con owner stale",
    userSecurityEvidence: "H2" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.H2.stale-owner-prewrite]",
    runtimeFailure: "[AUTH-COACH-01.USER.H2.stale-owner-prewrite]",
    runtimeSuite: true,
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateInitialUserWriteOwnershipGuard(sourceFile);
      assert.ok(located.guard, "mutante H2 localiza el guard inicial de ownership");
      return replaceNodeText(source, sourceFile, located.guard, "");
    },
  },
  {
    name: "H3 · readOwnUserRegistration acepta una fila cruzada",
    userSecurityEvidence: "H3" as const,
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.H3.crossed-row-rejected]",
    runtimeFailure: "[AUTH-COACH-01.USER.H3.crossed-row-rejected]",
    runtimeSuite: true,
    exactFailureLine: true,
    apply(source: string) {
      const sourceFile = parseTypeScript(source, GATEWAY_PATH);
      const located = locateCrossedUserRowGuard(sourceFile);
      assert.ok(located.guard, "mutante H3 localiza validación de fila cruzada");
      return replaceNodeText(source, sourceFile, located.guard, "");
    },
  },
  {
    name: "Usuario se autoriza inmediatamente sólo por sesión",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.controller.authoritative-user-row]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      `    if (input.requestedPortal === "usuario") {
      const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, input.owner);
      if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
      if (hasUserRegistration) {
        return {
          state: "user_authorized",
          requestedPortal: "usuario",
          userId: identity.userId,
        };
      }

      return rejectPortalSession(input, gateway, "user_registration_required");
    }`,
      `    if (input.requestedPortal === "usuario") {
      return { state: "user_authorized", requestedPortal: "usuario", userId: identity.userId };
    }`,
      "Usuario inmediato por sesión",
    ),
  },
  {
    name: "lookup Usuario existe pero una segunda ruta lo evade",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.controller.unique-user-authorization-path]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const coachRegistration = await gateway.getCoachRegistration(identity.userId, input.owner);",
      `    if (input.requestedPortal === "usuario") {
      return { state: "user_authorized", requestedPortal: "usuario", userId: identity.userId };
    }
    const coachRegistration = await gateway.getCoachRegistration(identity.userId, input.owner);`,
      "segunda ruta Usuario",
    ),
  },
  {
    name: "dominio de email concede Usuario",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.controller.no-email-authority]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (input.requestedPortal === "usuario") {',
      `    if (input.requestedPortal === "usuario" && identity.email?.endsWith("@organizatech.cl")) {
      return { state: "user_authorized", requestedPortal: "usuario", userId: identity.userId };
    }
    if (input.requestedPortal === "usuario") {`,
      "email concede Usuario",
    ),
  },
  {
    name: "metadata concede Usuario",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.no-metadata-authority]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (input.requestedPortal === "usuario") {',
      `    if (input.requestedPortal === "usuario" && (identity as never as { user_metadata?: { role?: string } }).user_metadata?.role === "usuario") {
      return { state: "user_authorized", requestedPortal: "usuario", userId: identity.userId };
    }
    if (input.requestedPortal === "usuario") {`,
      "metadata concede Usuario",
    ),
  },
  {
    name: "allowlist local de ID concede Usuario",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.controller.no-local-id-authority]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    if (input.requestedPortal === "usuario") {',
      `    const userRegistry = new Set(["usuario-autorizado"]);
    if (input.requestedPortal === "usuario" && userRegistry.has(identity.userId)) {
      return { state: "user_authorized", requestedPortal: "usuario", userId: identity.userId };
    }
    if (input.requestedPortal === "usuario") {`,
      "ID concede Usuario",
    ),
  },
  {
    name: "gateway Usuario retorna true antes del SELECT",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.gateway.authoritative-select]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      const row = await readOwnUserRegistration(dataClientFor(expectedUserId), expectedUserId, owner);\n      return row !== null;",
      "      if (owner) return true;\n      const row = await readOwnUserRegistration(dataClientFor(expectedUserId), expectedUserId, owner);\n      return row !== null;",
      "Usuario true sin SELECT",
    ),
  },
  {
    name: "profiles reemplaza user_registrations como autoridad",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.gateway.user-table-only]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '.from("user_registrations")',
      '.from("profiles")',
      "profiles como autoridad",
    ),
  },
  {
    name: "cliente envía user_id a RPC Usuario",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.gateway.no-client-ownership]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'client.rpc("register_own_user")',
      'client.rpc("register_own_user", { user_id: expectedUserId })',
      "ownership Usuario desde cliente",
    ),
  },
  {
    name: "Registro Usuario crea accidentalmente Coach",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.registration.no-coach-write]",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const registerUser = findNamedFunction(sourceFile, "registerUser");
      const mutatedRegisterUser = replaceExactlyOnce(
        registerUser.getText(sourceFile),
        "    const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, owner);",
        "    await gateway.createCoachRegistration(input as never, identity.userId, owner as never);\n    const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, owner);",
        "Usuario crea Coach",
      );
      return replaceNodeText(source, sourceFile, registerUser, mutatedRegisterUser);
    },
  },
  {
    name: "Registro Coach crea accidentalmente Usuario",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.registration.coach-does-not-create-user]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const coachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
      "    await gateway.createUserRegistration(identity.userId, owner as never);\n    const coachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
      "Coach crea Usuario",
    ),
  },
  {
    name: "Registro Usuario omite guard después de signIn",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.registration.post-sign-in-owner]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'if (!owner.isCurrent() || signIn.kind === "stale") return staleUserRegistration();',
      'if (signIn.kind === "stale") return staleUserRegistration();',
      "guard Usuario post-signIn",
    ),
  },
  {
    name: "SIGNED_OUT conserva owner de Registro Usuario A",
    file: "hook" as const,
    path: HOOK_PATH,
    expectedFailure: "[AUTH-COACH-01.hook.signed-out-invalidation]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    portalResolutionOwnersRef.current.invalidate();\n    coachRegistrationOwnersRef.current.invalidate();\n    userRegistrationOwnersRef.current.invalidate();",
      "    portalResolutionOwnersRef.current.invalidate();\n    coachRegistrationOwnersRef.current.invalidate();\n    void userRegistrationOwnersRef.current;",
      "SIGNED_OUT conserva owner Usuario",
    ),
  },
  {
    name: "root evade controller con signUp Usuario crudo",
    file: "root" as const,
    path: ROOT_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.root.registration-controller]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      `        const registration = await multiportalAuth.registerUser(
          signupPayload,
          userRegistrationSubmitOwner!,
        );`,
      "        const registration = await supabase.auth.signUp(signupPayload);",
      "signUp Usuario crudo",
    ),
  },
  {
    name: "bootstrap Usuario evita autorización backend",
    file: "hook" as const,
    path: HOOK_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.hook.initial-authorization]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    return input.initialRoute.accountType === "coach" ? "authorize_coach" : "authorize_user";',
      '    return input.initialRoute.accountType === "coach" ? "authorize_coach" : "continue";',
      "bootstrap Usuario sin autorización",
    ),
  },
  {
    name: "mensaje aprobado Usuario cambia",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.controller.exact-message]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "Cuenta Usuario no registrada. Crea una cuenta Usuario para iniciar sesión.",
      "Cuenta Usuario inválida.",
      "mensaje Usuario",
    ),
  },
] as const;

const EXPECTED_INTEGRATION_MUTATION_PROBE_COUNT = 102;
const EXPECTED_AC039_MUTATION_PROBE_COUNT = 4;
const EXPECTED_R2_MUTATION_PROBE_COUNT = 7;
const EXPECTED_IDENTITY_SWITCH_MUTATION_PROBE_COUNT = 26;
const EXPECTED_HYBRID_MUTATION_PROBE_COUNT = 10;
const EXPECTED_BROWSER_STORAGE_MUTATION_PROBE_COUNT = 14;
const EXPECTED_RUNTIME_MUTATION_PROBE_COUNT = 7;
const EXPECTED_AUTH_SUITE_MUTATION_PROBE_COUNT = 6;
const EXPECTED_E7_E9_SEMANTIC_MUTATION_PROBE_COUNT = 3;
const EXPECTED_USER_H1_H3_SEMANTIC_MUTATION_PROBE_COUNT = 3;

assert.equal(mutations.length, EXPECTED_INTEGRATION_MUTATION_PROBE_COUNT);
assert.deepEqual(
  mutations
    .filter((mutation) => "ac039Evidence" in mutation)
    .map((mutation) => mutation.ac039Evidence),
  [
    "coach_public_outcome_diverges",
    "user_public_outcome_diverges",
    "coach_membership_lookup_before_neutral_result",
    "public_copy_reveals_existing_account",
  ],
  `AUTH-SEPARATE-01 R1 AC-039 fija ${EXPECTED_AC039_MUTATION_PROBE_COUNT} probes focales activos`,
);
assert.deepEqual(
  mutations
    .filter((mutation) => "r2Evidence" in mutation)
    .map((mutation) => mutation.r2Evidence),
  [
    "existing_identity_code",
    "existing_identity_message",
    "non_identity_error_control",
    "coach_auth_route",
    "user_navigation",
    "coach_session_application",
    "coach_portal_application",
  ],
  `AUTH-SEPARATE-01 R2 fija ${EXPECTED_R2_MUTATION_PROBE_COUNT} probes focales activos`,
);
assert.deepEqual(
  mutations
    .filter((mutation) => "identitySwitchEvidence" in mutation)
    .map((mutation) => mutation.identitySwitchEvidence),
  [
    "omit_email_comparison",
    "authorize_b_with_session_a",
    "keep_portal_a",
    "write_before_switch",
    "global_signout",
    "navigate_after_signed_out",
    "clear_form_b",
    "auto_submit_after_close",
    "stale_callback_remounts_a",
    "accept_crossed_coach_row",
    "show_previous_professional_title",
    "success_without_coach_membership",
    "sensitive_window_local_storage",
    "sensitive_bare_local_storage",
    "sensitive_window_session_storage",
    "sensitive_bare_session_storage",
    "sensitive_computed_local_storage",
    "sensitive_storage_alias",
    "sensitive_global_session_storage",
    "sensitive_destructured_local_storage_alias",
    "sensitive_destructured_local_storage_shorthand",
    "sensitive_destructured_session_storage_alias",
    "sensitive_destructured_global_this_storage",
    "sensitive_destructured_computed_storage",
    "sensitive_destructured_global_alias",
    "sensitive_destructured_storage_alias_chain",
  ],
  `AUTH-SEPARATE-01 conserva ${EXPECTED_IDENTITY_SWITCH_MUTATION_PROBE_COUNT} probes históricos superseded`,
);
assert.deepEqual(
  mutations
    .filter((mutation) => "hybridEvidence" in mutation)
    .map((mutation) => mutation.hybridEvidence),
  [
    "explicit_flow",
    "preparation_user_membership",
    "shared_user_membership",
    "shared_signup",
    "shared_crossed_row",
    "separate_password_probe",
    "separate_silent_identity_reuse",
    "separate_shared_rpc",
    "shared_client_ownership",
    "sensitive_browser_storage",
  ],
  `AUTH-HYBRID-01 fija ${EXPECTED_HYBRID_MUTATION_PROBE_COUNT} probes focales activos`,
);
assert.deepEqual(
  mutations
    .filter((mutation) => "browserStorageEvidence" in mutation)
    .map((mutation) => mutation.browserStorageEvidence),
  [
    "window_local_storage",
    "bare_local_storage",
    "window_session_storage",
    "bare_session_storage",
    "computed_local_storage",
    "direct_storage_alias",
    "global_session_storage",
    "destructured_local_storage_alias",
    "destructured_local_storage_shorthand",
    "destructured_session_storage_alias",
    "destructured_global_this_storage",
    "destructured_computed_storage",
    "destructured_global_alias",
    "destructured_storage_alias_chain",
  ],
  `AUTH-COACH-01 M11 fija ${EXPECTED_BROWSER_STORAGE_MUTATION_PROBE_COUNT} probes de Browser Storage`,
);
assert.equal(
  mutations.filter((mutation) => "runtimeFailure" in mutation).length,
  EXPECTED_RUNTIME_MUTATION_PROBE_COUNT,
);
assert.equal(
  mutations.filter((mutation) => "runtimeSuite" in mutation).length,
  EXPECTED_AUTH_SUITE_MUTATION_PROBE_COUNT,
);
assert.deepEqual(
  mutations
    .filter((mutation) => "securityEvidence" in mutation)
    .map((mutation) => mutation.securityEvidence),
  ["E7", "E8", "E9"],
  `AUTH-COACH-01 fija ${EXPECTED_E7_E9_SEMANTIC_MUTATION_PROBE_COUNT} probes semánticos E7-E9`,
);
assert.deepEqual(
  mutations
    .filter((mutation) => "userSecurityEvidence" in mutation)
    .map((mutation) => mutation.userSecurityEvidence),
  ["H1", "H2", "H3"],
  `AUTH-COACH-01 Usuario fija ${EXPECTED_USER_H1_H3_SEMANTIC_MUTATION_PROBE_COUNT} probes semánticos H1-H3`,
);

function assertMetadataRuntimeMutation(mutatedController: string, expectedFailure: string) {
  const mutationDirectory = mkdtempSync(join(tmpdir(), "organizatech-auth-coach-01-"));
  const originalController = readFileSync(CONTROLLER_PATH, "utf8");
  const originalHash = sha256(originalController);
  const mutatedHash = sha256(mutatedController);
  const copiedControllerPath = join(mutationDirectory, CONTROLLER_PATH);
  const runtimeProbePath = join(mutationDirectory, METADATA_RUNTIME_PROBE_PATH);
  assert.notEqual(mutatedHash, originalHash, "metadata runtime cambia realmente el SHA del source");
  try {
    cpSync("src", join(mutationDirectory, "src"), { recursive: true });
    cpSync("tsconfig.json", join(mutationDirectory, "tsconfig.json"));
    cpSync("package.json", join(mutationDirectory, "package.json"));
    const nodeModulesDirectory = resolveNodeModulesDirectory();
    symlinkSync(nodeModulesDirectory, join(mutationDirectory, "node_modules"), "dir");
    const tsx = join(nodeModulesDirectory, ".bin", "tsx");

    writeFileSync(copiedControllerPath, mutatedController, "utf8");
    assert.equal(
      sha256(readFileSync(copiedControllerPath, "utf8")),
      mutatedHash,
      "metadata runtime materializa el source mutado y su SHA",
    );
    writeFileSync(runtimeProbePath, `import assert from "node:assert/strict";
import { createMultiportalAuthController } from "./multiportal-auth-controller";
import { createPortalResolutionOwnerController } from "./portal-resolution-owner";

async function runMetadataAuthorizationProbe() {
  const owners = createPortalResolutionOwnerController();
  owners.acceptIdentity("user-a");
  const owner = owners.begin("user-a");
  let signOuts = 0;
  const identity = {
    userId: "user-a",
    email: "coach@example.com",
    authState: { sessionId: "session-a" },
    user_metadata: { role: "coach" },
    app_metadata: { role: "coach" },
  };
  const gateway = {
    getCurrentIdentity: async () => identity,
    signInForCoachRegistration: async () => assert.fail("signIn inesperado"),
    signUpForCoachRegistration: async () => assert.fail("signUp inesperado"),
    hasCoachRegistration: async () => false,
    createCoachRegistration: async () => assert.fail("write inesperado"),
    signOut: async () => {
      signOuts += 1;
      return "signed_out" as const;
    },
  };

  const result = await createMultiportalAuthController<{ sessionId: string }>().resolvePortalAccess({
    requestedPortal: "coach",
    expectedUserId: "user-a",
    owner,
  }, gateway);
  assert.equal(
    result.state,
    "coach_registration_required",
    "[AUTH-COACH-01.metadata-authority-runtime] metadata no puede conceder acceso Coach",
  );
  assert.equal(signOuts, 1);
}

runMetadataAuthorizationProbe().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
`, "utf8");
    const mutation = spawnSync(tsx, [METADATA_RUNTIME_PROBE_PATH], {
      cwd: mutationDirectory,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = `${mutation.stdout ?? ""}\n${mutation.stderr ?? ""}`;
    assert.notEqual(
      mutation.status,
      0,
      `la lógica metadata mutada debe fallar en runtime\n${output}`,
    );
    assert.match(output, new RegExp(expectedFailure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(output, /SyntaxError|Transform failed|TypeScript compilation/i);

  } finally {
    try {
      if (existsSync(copiedControllerPath)) {
        writeFileSync(copiedControllerPath, originalController, "utf8");
        assert.equal(
          readFileSync(copiedControllerPath, "utf8"),
          originalController,
          "el controller temporal se restaura byte a byte en finally",
        );
        assert.equal(
          sha256(readFileSync(copiedControllerPath, "utf8")),
          originalHash,
          "el controller temporal recupera su SHA en finally",
        );
      }
      assert.equal(
        sha256(readFileSync(CONTROLLER_PATH, "utf8")),
        originalHash,
        "el controller productivo permanece byte-idéntico tras el probe runtime",
      );
    } finally {
      rmSync(mutationDirectory, { recursive: true, force: true });
    }
  }
}

const AUTH_RUNTIME_SUITE = [
  "src/features/auth/model/multiportal-auth-controller.test.ts",
  "src/features/auth/data/supabase-multiportal-auth-gateway.test.ts",
  "src/features/auth/coach-registration-migration-contract.test.ts",
  "src/features/auth/model/auth-route.test.ts",
  "src/features/auth/model/auth-form.test.ts",
  "src/features/auth/auth-integration-contract.test.ts",
] as const;
const EXPECTED_AUTH_RUNTIME_SUITE_FILE_COUNT = 6;
assert.equal(
  AUTH_RUNTIME_SUITE.length,
  EXPECTED_AUTH_RUNTIME_SUITE_FILE_COUNT,
  "la barrera runtime E7-E9/H1-H3 ejecuta toda la suite Auth no recursiva",
);

function assertAuthSuiteRuntimeMutation(
  mutatedSource: string,
  path: string,
  expectedFailure: string,
) {
  const mutationDirectory = mkdtempSync(join(tmpdir(), "organizatech-auth-coach-suite-"));
  const originalSource = readFileSync(path, "utf8");
  const originalHash = sha256(originalSource);
  const mutatedHash = sha256(mutatedSource);
  const copiedPath = join(mutationDirectory, path);
  assert.notEqual(mutatedHash, originalHash, `la mutación runtime cambia realmente el SHA: ${path}`);
  try {
    cpSync("src", join(mutationDirectory, "src"), { recursive: true });
    cpSync("tsconfig.json", join(mutationDirectory, "tsconfig.json"));
    cpSync("package.json", join(mutationDirectory, "package.json"));
    const nodeModulesDirectory = resolveNodeModulesDirectory();
    symlinkSync(nodeModulesDirectory, join(mutationDirectory, "node_modules"), "dir");
    const tsx = join(nodeModulesDirectory, ".bin", "tsx");
    const childEnvironment = { ...process.env };
    delete childEnvironment.NODE_TEST_CONTEXT;
    writeFileSync(copiedPath, mutatedSource, "utf8");
    assert.equal(
      sha256(readFileSync(copiedPath, "utf8")),
      mutatedHash,
      `la mutación runtime materializa el source y SHA esperados: ${path}`,
    );

    const mutation = spawnSync(
      tsx,
      ["--test", "--test-concurrency=1", ...AUTH_RUNTIME_SUITE],
      {
        cwd: mutationDirectory,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        env: childEnvironment,
      },
    );
    const output = `${mutation.stdout ?? ""}\n${mutation.stderr ?? ""}`;
    assert.notEqual(mutation.status, 0, `la suite Auth debe matar ${expectedFailure}\n${output}`);
    const firstSecurityFailure = output.match(
      /\[AUTH-COACH-01\.(?:E[789]|USER\.H[123])[^\]]*\]/,
    )?.[0] ?? null;
    assert.equal(
      firstSecurityFailure,
      expectedFailure,
      `la primera causa de seguridad debe ser exactamente ${expectedFailure}\n${output}`,
    );
    assert.doesNotMatch(output, /SyntaxError|Transform failed|TypeScript compilation/i);

  } finally {
    try {
      if (existsSync(copiedPath)) {
        writeFileSync(copiedPath, originalSource, "utf8");
        assert.equal(
          readFileSync(copiedPath, "utf8"),
          originalSource,
          `la fuente temporal se restaura byte a byte en finally: ${path}`,
        );
        assert.equal(
          sha256(readFileSync(copiedPath, "utf8")),
          originalHash,
          `la restauración recupera el SHA: ${path}`,
        );
      }
      assert.equal(
        sha256(readFileSync(path, "utf8")),
        originalHash,
        `la fuente productiva permanece byte-idéntica: ${path}`,
      );
    } finally {
      rmSync(mutationDirectory, { recursive: true, force: true });
    }
  }
}

function assertFocalMutationContract(
  originalSource: string,
  mutatedSource: string,
  path: string,
  name: string,
  assertExpectedFailure: (materializedMutation: string) => void,
) {
  const mutationDirectory = mkdtempSync(join(tmpdir(), "organizatech-auth-coach-focal-"));
  const temporarySourcePath = join(
    mutationDirectory,
    path.endsWith(".tsx") ? "mutated-source.tsx" : "mutated-source.ts",
  );
  const originalHash = sha256(originalSource);
  const mutatedHash = sha256(mutatedSource);
  writeFileSync(temporarySourcePath, originalSource, "utf8");
  try {
    writeFileSync(temporarySourcePath, mutatedSource, "utf8");
    const materializedMutation = readFileSync(temporarySourcePath, "utf8");
    assert.equal(materializedMutation, mutatedSource, `source mutado materializado: ${name}`);
    assert.equal(sha256(materializedMutation), mutatedHash, `SHA mutado materializado: ${name}`);
    assert.notEqual(mutatedHash, originalHash, `el SHA cambia realmente: ${name}`);
    assertExpectedFailure(materializedMutation);
  } finally {
    try {
      if (existsSync(temporarySourcePath)) {
        writeFileSync(temporarySourcePath, originalSource, "utf8");
        const restoredSource = readFileSync(temporarySourcePath, "utf8");
        assert.equal(restoredSource, originalSource, `restauración byte a byte en finally: ${name}`);
        assert.equal(sha256(restoredSource), originalHash, `restauración de SHA en finally: ${name}`);
      }
      assert.equal(
        sha256(readFileSync(path, "utf8")),
        originalHash,
        `la fuente productiva permanece byte-idéntica: ${name}`,
      );
    } finally {
      rmSync(mutationDirectory, { recursive: true, force: true });
    }
  }
}

const activeMutations = mutations.filter((mutation) => (
  !("supersededAc039Evidence" in mutation)
  && !("identitySwitchEvidence" in mutation)
));
assert.equal(
  activeMutations.filter((mutation) => "ac039Evidence" in mutation).length,
  EXPECTED_AC039_MUTATION_PROBE_COUNT,
  "AUTH-SEPARATE-01 R1 mantiene todos los probes ac039Evidence dentro de la suite activa",
);

for (const mutation of activeMutations) {
  test(`mutation probe integración: ${mutation.name}`, () => {
    const sources = readSources();
    const original = sources[mutation.file];
    const originalHash = sha256(original);
    const mutated = mutation.apply(original);
    assert.notEqual(mutated, original, `probe efectivo: ${mutation.name}`);
    assert.notEqual(
      sha256(mutated),
      originalHash,
      `probe cambia realmente el SHA del source: ${mutation.name}`,
    );
    assertFocalMutationContract(
      original,
      mutated,
      mutation.path,
      mutation.name,
      (materializedMutation) => {
        assertValidTypeScript(materializedMutation, mutation.path);
        assert.throws(
          () => auditIntegration({ ...sources, [mutation.file]: materializedMutation }),
          (error: unknown) => {
            if (!(error instanceof assert.AssertionError)) return false;
            if ("exactFailureLine" in mutation) {
              return error.message.split(/\r?\n/, 1)[0] === mutation.expectedFailure;
            }
            return error.message.includes(mutation.expectedFailure);
          },
          `el contrato debe fallar sólo por la aserción esperada: ${mutation.name}`,
        );
      },
    );
    if ("runtimeFailure" in mutation) {
      if ("runtimeSuite" in mutation) {
        assertAuthSuiteRuntimeMutation(mutated, mutation.path, mutation.runtimeFailure);
      } else {
        assertMetadataRuntimeMutation(mutated, mutation.runtimeFailure);
      }
    }
  });
}

console.log(
  `AUTH-HYBRID-01 active integration mutation probes: ${activeMutations.length}; probes SWITCH superseded excluidos`,
);
