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
import { join, resolve } from "node:path";
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

function auditAmbiguousExistingIdentitySemantics(sources: Sources) {
  const sourceFile = parseTypeScript(sources.controller, CONTROLLER_PATH);
  const approvedMessage =
    "Revisa tu correo para continuar. Si no recibes un mensaje, inicia sesión o recupera tu contraseña.";
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
  assert.equal(approvedMessageNames.length, 1, AMBIGUOUS_IDENTITY_FAILURE);
  const approvedMessageName = approvedMessageNames[0]!;

  const cases = [
    {
      functionName: "registerUser",
      portal: "usuario",
      payloadName: "signupPayload",
    },
    {
      functionName: "registerCoach",
      portal: "coach",
      payloadName: "coachRegistrationPayload",
    },
  ] as const;

  for (const registrationCase of cases) {
    const registration = findNamedFunction(sourceFile, registrationCase.functionName);
    const gatewayParameter = registration.parameters[2]?.name;
    const gatewayName = gatewayParameter && ts.isIdentifier(gatewayParameter)
      ? gatewayParameter.text
      : null;
    assert.ok(gatewayName, AMBIGUOUS_IDENTITY_FAILURE);
    const guards = collectIfStatements(registration.body).filter(
      (ifStatement) => /\.kind\s*===\s*"existing_identity"/.test(
        ifStatement.expression.getText(sourceFile),
      ),
    );
    assert.equal(guards.length, 1, AMBIGUOUS_IDENTITY_FAILURE);
    const ambiguousBranch = guards[0]!.thenStatement;
    if (!ts.isBlock(ambiguousBranch)) assert.fail(AMBIGUOUS_IDENTITY_FAILURE);
    const returns = collectReturns(ambiguousBranch).filter(
      (returnStatement) => Boolean(returnStatement.expression),
    );
    assert.equal(returns.length, 1, AMBIGUOUS_IDENTITY_FAILURE);
    const expression = returns[0]!.expression!;
    const message = objectLiteralPropertyExpression(expression, "message");
    assert.equal(
      objectLiteralStringProperty(expression, "state") === "error"
        && objectLiteralStringProperty(expression, "requestedPortal") === registrationCase.portal
        && Boolean(message && isIdentifierNamed(message, approvedMessageName)),
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

    const { guard: rootErrorGuard } =
      locateRegistrationErrorGuard(sources.root, registrationCase.payloadName);
    const forbiddenRootCalls = new Set([
      "applySessionState",
      "beginPortalResolution",
      "continueAuthorizedPortalAccess",
      "replaceCoachPortalSession",
      "signOut",
      "transition",
      "replace",
      "push",
      "back",
      "assign",
    ]);
    const rootErrorCalls = collectCallExpressions(rootErrorGuard.thenStatement);
    const hasTerminalReturn = ts.isBlock(rootErrorGuard.thenStatement)
      && rootErrorGuard.thenStatement.statements.some(ts.isReturnStatement);
    assert.equal(
      hasTerminalReturn
        && !rootErrorCalls.some((call) => {
          const callExpression = unwrapExpression(call.expression);
          if (ts.isIdentifier(callExpression)) {
            return forbiddenRootCalls.has(callExpression.text);
          }
          return ts.isPropertyAccessExpression(callExpression)
            && forbiddenRootCalls.has(callExpression.name.text);
        }),
      true,
      `${AMBIGUOUS_IDENTITY_FAILURE}: ${registrationCase.portal}`,
    );
  }
}

function auditDuplicateCoachRegistrationSemantics(sources: Sources) {
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

function auditCoachIdentitySwitchSemantics(sources: Sources) {
  const { controller, gateway, hook, root, screen } = sources;
  const controllerSourceFile = parseTypeScript(controller, CONTROLLER_PATH);
  const registerCoachText = findNamedFunction(
    controllerSourceFile,
    "registerCoach",
  ).getText(controllerSourceFile);
  const identitySwitchBranch = registerCoachText.match(
    /if \(identity && !sameEmail\(identity\.email, input\.auth\.email\)\) \{[\s\S]*?state: "identity_switch_required"[\s\S]*?message: COACH_REGISTRATION_IDENTITY_SWITCH_MESSAGE[\s\S]*?\n    \}/,
  )?.[0] ?? "";
  assert.equal(
    Boolean(identitySwitchBranch),
    true,
    "[AUTH-COACH-01.SWITCH.email-comparison] A/B distinto retorna el estado tipado antes de continuar",
  );
  assert.match(
    controller,
    /"Hay una sesión activa con otro correo\. Cierra sesión para registrar esta cuenta Coach\."/,
    "[AUTH-COACH-01.SWITCH.exact-message] conserva el aviso aprobado",
  );
  const typedIdentitySwitchResult = controller.match(
    /\| \{\n    state: "identity_switch_required";[\s\S]*?\n  \}/,
  )?.[0] ?? "";
  assert.equal(
    Boolean(typedIdentitySwitchResult)
      && !/password|authState|userId|email:/.test(typedIdentitySwitchResult),
    true,
    "[AUTH-COACH-01.SWITCH.minimal-result] el resultado UI no transporta identidad ni secretos",
  );
  assert.equal(
    /const existingCoachRegistration = await gateway\.getCoachRegistration\(identity\.userId, owner\);/.test(registerCoachText)
      && /gateway\.activateCoachRegistrationIdentity\(identity, owner\)/.test(registerCoachText),
    true,
    "[AUTH-COACH-01.SWITCH.session-a-cannot-authorize-b] lookup y activación permanecen ligados a la identidad autenticada",
  );

  const warningBranch = root.match(
    /if \(registration\.state === "identity_switch_required"\) \{[\s\S]*?\n        \}/,
  )?.[0] ?? "";
  assert.equal(
    /replaceCoachPortalSession\(null\)/.test(warningBranch)
      && /setCoachIdentitySwitchRequired\(true\)/.test(warningBranch)
      && /setAuthStatus\(registration\.message, "error"\)/.test(warningBranch),
    true,
    "[AUTH-COACH-01.SWITCH.portal-a-cleared-on-warning] el aviso desmonta A antes de exponer la acción",
  );
  assert.equal(
    !/createCoachRegistration|activateCoachRegistrationIdentity|signInForCoachRegistration|signUpForCoachRegistration/.test(identitySwitchBranch),
    true,
    "[AUTH-COACH-01.SWITCH.no-write-before-switch] el mismatch no alcanza autenticación, lookup ni write Coach",
  );

  const gatewaySourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const switchSignOutText = findNamedMethod(
    gatewaySourceFile,
    "signOutForCoachIdentitySwitch",
  ).getText(gatewaySourceFile);
  assert.equal(
    /getAuthoritativeIdentity\(supabase, owner\.expectedUserId, owner\)/.test(switchSignOutText)
      && /sameEmail\(identity\.email, requestedEmail\)/.test(switchSignOutText)
      && /supabase\.auth\.signOut\(\{ scope: "local" \}\)/.test(switchSignOutText)
      && !/scope: "global"|supabase\.auth\.signOut\(\)/.test(switchSignOutText),
    true,
    "[AUTH-COACH-01.SWITCH.local-signout-only] el cambio revalida A y usa sólo signout local",
  );

  const switchFunctionStart = hook.indexOf("  function signOutForCoachIdentitySwitch(");
  const switchFunctionEnd = hook.indexOf("\n  function createGateway(", switchFunctionStart);
  const switchFunctionText = switchFunctionStart >= 0 && switchFunctionEnd > switchFunctionStart
    ? hook.slice(switchFunctionStart, switchFunctionEnd)
    : "";
  assert.equal(
    /existingSwitch\?\.operation/.test(switchFunctionText)
      && switchFunctionText.indexOf("invalidatePortalOperations();")
        < switchFunctionText.indexOf(".signOutForCoachIdentitySwitch(requestedEmail, owner)")
      && switchFunctionText.split(".signOutForCoachIdentitySwitch(requestedEmail, owner)").length - 1 === 1
      && /return await pending\.event;/.test(switchFunctionText)
      && /settleCoachIdentitySwitch\("signed_out"\)/.test(hook),
    true,
    "[AUTH-COACH-01.SWITCH.coordination] invalida owners, deduplica y espera SIGNED_OUT",
  );

  const signedOutBranch = root.match(
    /if \(portalEventDecision === "complete_coach_identity_switch"\) \{[\s\S]*?\n          return;\n        \}/,
  )?.[0] ?? "";
  assert.equal(
    /navigate: false/.test(signedOutBranch)
      && !/authRouteController|navigation\.|history\./.test(signedOutBranch),
    true,
    "[AUTH-COACH-01.SWITCH.coach-route-preserved] SIGNED_OUT no abandona registro/coach",
  );
  assert.equal(
    /preserveAuthForms: true/.test(signedOutBranch)
      && /if \(options\.preserveAuthForms\) resetUserScopedTransientStatePreservingAuthForms\(\);\s*else resetUserScopedTransientState\(\);/.test(root)
      && /<AuthScreen[\s\S]*?key=\{screen\}/.test(root),
    true,
    "[AUTH-COACH-01.SWITCH.form-b-preserved] el cierre conserva los campos controlados y locales de B",
  );
  assert.equal(
    !/handleAuth\(|requestSubmit\(|\.submit\(|onSubmit/.test(signedOutBranch),
    true,
    "[AUTH-COACH-01.SWITCH.manual-resubmit-required] SIGNED_OUT no reenvía el formulario",
  );
  assert.equal(
    /if \(blockedCoachIdentityUserIdRef\.current === currentUserId\) \{\s*return "defer";/.test(hook)
      && /function beginPortalResolution\(expectedUserId: string\)[\s\S]*portalResolutionOwnersRef\.current\.acceptIdentity\(expectedUserId\);[\s\S]*\.begin\(expectedUserId\)/.test(hook),
    true,
    "[AUTH-COACH-01.SWITCH.stale-a-blocked] un callback tardío de A no vuelve a aplicarse",
  );

  const readOwnCoachText = findNamedFunction(
    gatewaySourceFile,
    "readOwnCoachRegistration",
  ).getText(gatewaySourceFile);
  assert.equal(
    /if \(row && row\.userId !== expectedUserId\) \{[\s\S]*?throw new MultiportalAuthRepositoryError/.test(readOwnCoachText),
    true,
    "[AUTH-COACH-01.SWITCH.crossed-coach-row-rejected] una fila Coach de otro user_id falla cerrada",
  );
  assert.equal(
    /createCoachPortalSession\(\{[\s\S]*?authorizedUserId: access\.userId,[\s\S]*?registration: access\.coach/.test(root),
    true,
    "[AUTH-COACH-01.SWITCH.own-professional-title] el portal deriva professional_title sólo de la fila Coach autorizada",
  );
  assert.equal(
    /const coachRegistration =[\s\S]{0,100}await gateway\.createCoachRegistration\([\s\S]*?input\.registration,[\s\S]*?identity\.userId,[\s\S]*?owner,[\s\S]*?\);/.test(registerCoachText)
      && /coach: coachRegistration/.test(registerCoachText),
    true,
    "[AUTH-COACH-01.SWITCH.membership-required-for-success] no existe éxito Coach sin fila leída o creada",
  );

  assert.equal(
    /isCoachRegistration && coachIdentitySwitchRequired \? \([\s\S]*?type="button"[\s\S]*?onClick=\{onCoachIdentitySwitch\}[\s\S]*?Cerrar sesión y continuar/.test(screen)
      && /disabled=\{isBusy \|\| \(isCoachRegistration && coachIdentitySwitchRequired\)\}/.test(screen),
    true,
    "[AUTH-COACH-01.SWITCH.exact-ui] pantalla Auth muestra el botón exacto y bloquea el submit previo",
  );
}

function auditIntegration(sources: Sources) {
  auditNoSensitiveBrowserStorage(sources);
  auditCoachIdentitySwitchSemantics(sources);
  auditDuplicateCoachRegistrationSemantics(sources);
  auditAmbiguousExistingIdentitySemantics(sources);
  const { root, controller, owner, gateway, hook, form, screen } = sources;
  const controllerSourceFile = parseTypeScript(controller, CONTROLLER_PATH);
  const registerCoachFunction = findNamedFunction(controllerSourceFile, "registerCoach");
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
    controller,
    /async function registerCoach<[\s\S]*?coachRegistration\.userId !== identity\.userId[\s\S]*?controlledCoachRegistrationError\(\)/,
    "[AUTH-COACH-01.controller.registration-owner] registro cruzado falla cerrado",
  );
  assert.match(
    controller,
    /async function registerCoach<[\s\S]*owner: CoachRegistrationOwner[\s\S]*if \(!owner\.isCurrent\(\)\) return staleCoachRegistration\(\)/,
    "[AUTH-COACH-01.registration.owner-whole-lifecycle] registerCoach exige owner vigente desde el inicio",
  );
  assert.match(controller, /owner\.bindExpectedUserId\(identity\.userId\)/);
  assert.match(
    registerCoachFunction.getText(controllerSourceFile),
    /gateway\.signInForCoachRegistration\([\s\S]*?\}, owner\);\n      if \(!owner\.isCurrent\(\) \|\| signIn\.kind === "stale"\)/,
    "[AUTH-COACH-01.registration.post-sign-in-owner] signIn tardío se descarta",
  );
  assert.match(
    controller,
    /gateway\.createCoachRegistration\([\s\S]*?identity\.userId,[\s\S]*?owner,[\s\S]*?\);[\s\S]*if \(!owner\.isCurrent\(\)\)/,
    "[AUTH-COACH-01.registration.post-write-owner] INSERT tardío no publica",
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
    registerCoachFunction.getText(controllerSourceFile),
    /hasUserRegistration|createUserRegistration|activateUserRegistrationIdentity/,
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
  assert.match(owner, /begin\(\) \{[\s\S]*revision \+= 1;[\s\S]*Symbol\("coach-registration"\)/);
  assert.match(owner, /bindExpectedUserId\(userId: string\)[\s\S]*currentUserId !== null && currentUserId !== userId/);

  assert.match(gateway, /await supabase\.auth\.getUser\(\)/);
  assert.match(gateway, /\.from\("coach_registrations"\)/);
  assert.match(
    gateway,
    /client\.rpc\("register_own_coach", rpcPayload\)/,
    "[AUTH-COACH-01.gateway.atomic-rpc] write usa la RPC atómica invoker",
  );
  auditGatewayCoachLookupSemantics(gateway);
  auditGatewayUserLookupSemantics(gateway);
  assert.match(gateway, /p_expected_user_id: expectedUserId[\s\S]*p_first_name:[\s\S]*p_professional_title:/);
  assert.match(gateway, /persistSession: false,[\s\S]*autoRefreshToken: false,[\s\S]*detectSessionInUrl: false/);
  const gatewaySourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const coachSignInMethod = findNamedMethod(gatewaySourceFile, "signInForCoachRegistration");
  const signOutMethod = findNamedMethod(gatewaySourceFile, "signOut");
  assert.match(
    coachSignInMethod.getText(gatewaySourceFile),
    /const isolatedClient = getRegistrationClient\(\);[\s\S]*isolatedClient\.auth\.signInWithPassword/,
    "[AUTH-COACH-01.registration.isolated-sign-in] credenciales A no mutan la sesión global",
  );
  assert.match(
    gateway,
    /async signOut\(reason, owner\) \{\n      if \(!owner\.isCurrent\(\)\) return "stale";/,
    "[AUTH-COACH-01.gateway.signout-owner-guard] gateway rechaza owner stale antes de efectos",
  );
  assert.match(
    signOutMethod.getText(gatewaySourceFile),
    /const identity = await getAuthoritativeIdentity\(supabase, owner\.expectedUserId, owner\);/,
    "[AUTH-COACH-01.gateway.signout-fresh-identity] signOut revalida expectedUserId",
  );
  assert.match(gateway, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(
    gateway,
    /\.from\("coach_registrations"\)[\s\S]{0,180}?\.insert\(|\.upsert\(|return\s*\{\s*\.\.\.input|user_metadata|raw_user_meta_data|app_metadata/,
    "[AUTH-COACH-01.gateway.no-raw-spread] no propaga objetos crudos ni metadata",
  );

  assert.match(form, /registration: \{[\s\S]*professional_title: professionalTitle/);
  assert.doesNotMatch(
    form.match(/registration: \{[\s\S]*?\n      \},/m)?.[0] ?? "",
    /user_id|owner_id|profile_id|\bage\b|\brole\b|password|email/,
  );

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
  assert.match(hook, /beginCoachRegistrationSubmit\(\)[\s\S]*coachRegistrationOwnersRef\.current\.begin\(\)/);
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
    /case "user_authorized": \{[\s\S]*createUserPortalAuthorizationProof\(\{[\s\S]*replaceCoachPortalSession\(null\);[\s\S]*const continuation = await continueAuthenticatedSession\(authState, intent\);[\s\S]*continuation\.kind === "stale"[\s\S]*replaceUserPortalAuthorizationProof\(authorizationProof\);/,
    "[AUTH-COACH-01.USER.root.user-destination] Usuario conserva su continuación productiva",
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
  const credentialsDeclaration = "    const { email, password } = authPayload;";
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

const duplicateCoachPositiveControls = [
  {
    name: "AC-039 acepta renombre inocente de la fila Coach existente",
    apply(source: string) {
      const sourceFile = parseTypeScript(source, CONTROLLER_PATH);
      const registerCoach = findNamedFunction(sourceFile, "registerCoach");
      return renameIdentifiersWithin(
        source,
        sourceFile,
        registerCoach,
        "existingCoachRegistration",
        "authenticatedOwnCoachMembership",
      );
    },
  },
  {
    name: "AC-039 acepta reformateo multilinea del lookup own-only",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const existingCoachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
      `    const existingCoachRegistration = await gateway.getCoachRegistration(
      identity.userId,
      owner,
    );`,
      "control positivo AC-039: reformateo",
    ),
  },
  {
    name: "AC-039 ignora comentarios sobre fallback, metadata y títulos",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (existingCoachRegistration) {",
      `    // No usar metadata ni el professional_title del intento como fallback.
    if (existingCoachRegistration) {`,
      "control positivo AC-039: comentario",
    ),
  },
] as const;

const EXPECTED_DUPLICATE_COACH_POSITIVE_CONTROL_COUNT = 3;
assert.equal(
  duplicateCoachPositiveControls.length,
  EXPECTED_DUPLICATE_COACH_POSITIVE_CONTROL_COUNT,
  "AUTH-COACH-01 AC-039 fija tres controles inocentes de nombre, formato y comentarios",
);

test("controles positivos AC-039 toleran renombres, formato y comentarios", () => {
  const sources = readSources();
  for (const control of duplicateCoachPositiveControls) {
    const transformed = control.apply(sources.controller);
    assert.notEqual(
      sha256(transformed),
      sha256(sources.controller),
      `${control.name}: transformación efectiva`,
    );
    assertValidTypeScript(transformed, CONTROLLER_PATH);
    assert.doesNotThrow(
      () => auditDuplicateCoachRegistrationSemantics({
        ...sources,
        controller: transformed,
      }),
      `${control.name}: no cambia la semántica AC-039`,
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
    ac039Evidence: "restore_existing_fallback" as const,
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
    ac039Evidence: "authorize_existing_registration" as const,
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
    ac039Evidence: "create_before_duplicate_rejection" as const,
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
    ac039Evidence: "activate_before_duplicate_rejection" as const,
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
    ac039Evidence: "overwrite_existing_title" as const,
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
    ac039Evidence: "navigate_after_duplicate" as const,
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
    ac039Evidence: "signout_on_duplicate" as const,
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
    ac039Evidence: "infer_duplicate_from_client_email" as const,
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
    ac039Evidence: "reveal_duplicate_with_invalid_password" as const,
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
    ac039Evidence: "reject_user_only" as const,
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
    ac039Evidence: "break_coach_login" as const,
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
    ac039Evidence: "lookup_before_identity_switch" as const,
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
    ac039Evidence: "accept_crossed_row_as_duplicate" as const,
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
    ac039Evidence: "change_exact_message" as const,
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
    ac039Evidence: "transport_new_title" as const,
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
    ac039Evidence: "signup_before_duplicate_rejection" as const,
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
    name: "SWITCH · omite comparación de correo A/B",
    identitySwitchEvidence: "omit_email_comparison" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.email-comparison] A/B distinto retorna el estado tipado antes de continuar",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (identity && !sameEmail(identity.email, input.auth.email)) {",
      "    if (false) {",
      "SWITCH omite comparación de correo",
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
      "    const existingCoachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
      "    const existingCoachRegistration = await gateway.getCoachRegistration(input.auth.email, owner);",
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
    name: "SWITCH · ejecuta write Coach antes del cambio de identidad",
    identitySwitchEvidence: "write_before_switch" as const,
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.SWITCH.no-write-before-switch] el mismatch no alcanza autenticación, lookup ni write Coach",
    exactFailureLine: true,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (identity && !sameEmail(identity.email, input.auth.email)) {\n      return {",
      "    if (identity && !sameEmail(identity.email, input.auth.email)) {\n      await gateway.createCoachRegistration(input.registration, identity.userId, owner);\n      return {",
      "SWITCH write antes del cambio",
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
      `    const coachRegistration = existingCoachRegistration ?? await gateway.createCoachRegistration(
      input.registration,
      identity.userId,
      owner,
    );`,
      `    const coachRegistration = {
      userId: identity.userId,
      createdAt: "not-persisted",
      firstName: input.registration.first_name,
      lastName: input.registration.last_name,
      birthDate: input.registration.birth_date,
      gender: input.registration.gender,
      phoneNumber: input.registration.phone_number,
      professionalTitle: input.registration.professional_title,
    };`,
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
      '    async signOut(reason, owner) {\n      if (!owner.isCurrent()) return "stale";',
      '    async signOut(reason, owner) {\n      if (false) return "stale";',
      "gateway omite guard de owner antes de signOut",
    ),
  },
  {
    name: "gateway omite identidad fresca antes de signOut",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.signout-fresh-identity]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      '    async signOut(reason, owner) {\n      if (!owner.isCurrent()) return "stale";\n      const identity = await getAuthoritativeIdentity(supabase, owner.expectedUserId, owner);',
      '    async signOut(reason, owner) {\n      if (!owner.isCurrent()) return "stale";\n      const identity = { userId: owner.expectedUserId };',
      "gateway omite identidad fresca antes de signOut",
    ),
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
    name: "repository envía objeto crudo",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.atomic-rpc]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'client.rpc("register_own_coach", rpcPayload)',
      'client.rpc("register_own_coach", payload)',
      "repository envía objeto crudo",
    ),
  },
  {
    name: "repository propaga ownership por spread",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.no-raw-spread]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "  return {\n    first_name: input.first_name,",
      "  return {\n    ...input,\n    first_name: input.first_name,",
      "repository propaga ownership por spread",
    ),
  },
  {
    name: "ownership cruzado deja de fallar cerrado",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.registration-owner]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    if (coachRegistration.userId !== identity.userId) {\n      return controlledCoachRegistrationError();",
      "    if (false) {\n      return controlledCoachRegistrationError();",
      "ownership cruzado deja de fallar cerrado",
    ),
  },
  {
    name: "RPC atómica se reemplaza por endpoint no contractual",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.gateway.atomic-rpc]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'client.rpc("register_own_coach", rpcPayload)',
      'client.rpc("register_coach_without_expected_identity", rpcPayload)',
      "RPC atómica se reemplaza por endpoint no contractual",
    ),
  },
  {
    name: "registro omite guard posterior a signIn",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.registration.post-sign-in-owner]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      'if (!owner.isCurrent() || signIn.kind === "stale") return staleCoachRegistration();',
      'if (signIn.kind === "stale") return staleCoachRegistration();',
      "registro omite guard posterior a signIn",
    ),
  },
  {
    name: "signIn Coach usa cliente global",
    file: "gateway" as const,
    path: GATEWAY_PATH,
    expectedFailure: "[AUTH-COACH-01.registration.isolated-sign-in]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    async signInForCoachRegistration(credentials: LoginPayload, owner) {\n      if (!owner.isCurrent()) return { kind: \"stale\" };\n      const isolatedClient = getRegistrationClient();\n      const { data, error } = await isolatedClient.auth.signInWithPassword({",
      "    async signInForCoachRegistration(credentials: LoginPayload, owner) {\n      if (!owner.isCurrent()) return { kind: \"stale\" };\n      const isolatedClient = getRegistrationClient();\n      const { data, error } = await supabase.auth.signInWithPassword({",
      "signIn Coach usa cliente global",
    ),
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
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, owner);",
      "    await gateway.createCoachRegistration(input as never, identity.userId, owner as never);\n    const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, owner);",
      "Usuario crea Coach",
    ),
  },
  {
    name: "Registro Coach crea accidentalmente Usuario",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.USER.registration.coach-does-not-create-user]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const existingCoachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
      "    await gateway.createUserRegistration(identity.userId, owner as never);\n    const existingCoachRegistration = await gateway.getCoachRegistration(identity.userId, owner);",
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

const EXPECTED_INTEGRATION_MUTATION_PROBE_COUNT = 79;
const EXPECTED_AC039_MUTATION_PROBE_COUNT = 16;
const EXPECTED_IDENTITY_SWITCH_MUTATION_PROBE_COUNT = 26;
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
    "restore_existing_fallback",
    "authorize_existing_registration",
    "create_before_duplicate_rejection",
    "activate_before_duplicate_rejection",
    "overwrite_existing_title",
    "navigate_after_duplicate",
    "signout_on_duplicate",
    "infer_duplicate_from_client_email",
    "reveal_duplicate_with_invalid_password",
    "reject_user_only",
    "break_coach_login",
    "lookup_before_identity_switch",
    "accept_crossed_row_as_duplicate",
    "change_exact_message",
    "transport_new_title",
    "signup_before_duplicate_rejection",
  ],
  `AUTH-COACH-01 AC-039 fija ${EXPECTED_AC039_MUTATION_PROBE_COUNT} probes focales`,
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
  `AUTH-COACH-01 fija ${EXPECTED_IDENTITY_SWITCH_MUTATION_PROBE_COUNT} probes A/B de cambio de identidad`,
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
    symlinkSync(resolve("node_modules"), join(mutationDirectory, "node_modules"), "dir");
    const tsx = resolve("node_modules/.bin/tsx");

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
    symlinkSync(resolve("node_modules"), join(mutationDirectory, "node_modules"), "dir");
    const tsx = resolve("node_modules/.bin/tsx");
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

for (const mutation of mutations) {
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
  `AUTH-COACH-01 integration mutation probes: ${mutations.length}/${EXPECTED_INTEGRATION_MUTATION_PROBE_COUNT}; AC-039: ${EXPECTED_AC039_MUTATION_PROBE_COUNT}/${EXPECTED_AC039_MUTATION_PROBE_COUNT}; cambio A/B: ${EXPECTED_IDENTITY_SWITCH_MUTATION_PROBE_COUNT}/${EXPECTED_IDENTITY_SWITCH_MUTATION_PROBE_COUNT}; M11 Browser Storage: ${EXPECTED_BROWSER_STORAGE_MUTATION_PROBE_COUNT}/${EXPECTED_BROWSER_STORAGE_MUTATION_PROBE_COUNT}; controles AC-039: ${EXPECTED_DUPLICATE_COACH_POSITIVE_CONTROL_COUNT}/${EXPECTED_DUPLICATE_COACH_POSITIVE_CONTROL_COUNT}; controles M11: ${EXPECTED_BROWSER_STORAGE_POSITIVE_CONTROL_COUNT}/${EXPECTED_BROWSER_STORAGE_POSITIVE_CONTROL_COUNT}; runtime: ${EXPECTED_RUNTIME_MUTATION_PROBE_COUNT}/${EXPECTED_RUNTIME_MUTATION_PROBE_COUNT}; Auth suite E7-E9/H1-H3: ${EXPECTED_AUTH_SUITE_MUTATION_PROBE_COUNT}/${EXPECTED_AUTH_SUITE_MUTATION_PROBE_COUNT}`,
);
