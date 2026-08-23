import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import ts from "typescript";

import { createPasswordRecoveryPortalGuard } from "@/features/auth/model/password-recovery-portal-guard";

const H1_SOURCE_PATHS = {
  app: "src/components/organizatech-app.tsx",
  boundary: "src/features/auth/hooks/use-multiportal-auth-boundary.ts",
} as const;

type H1SourceKey = keyof typeof H1_SOURCE_PATHS;

interface H1Sources {
  app: string;
  boundary: string;
}

const appSource = readFileSync(H1_SOURCE_PATHS.app, "utf8");
const recoverySource = readFileSync("src/lib/auth/password-recovery-session.ts", "utf8");
const storageSource = readFileSync("src/lib/storage/browser-storage.ts", "utf8");
const authBoundarySource = readFileSync(H1_SOURCE_PATHS.boundary, "utf8");
const portalGuardSource = readFileSync("src/features/auth/model/password-recovery-portal-guard.ts", "utf8");

function sourceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `No se encontró el inicio: ${startMarker}`);
  assert.ok(end > start, `No se encontró el final: ${endMarker}`);
  return source.slice(start, end);
}

function sha256(source: string | Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

function parseTypeScript(source: string, path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function assertValidTypeScript(source: string, path: string, label: string): void {
  const sourceFile = parseTypeScript(source, path) as ts.SourceFile & {
    parseDiagnostics: readonly ts.Diagnostic[];
  };
  assert.equal(
    sourceFile.parseDiagnostics.length,
    0,
    label + ": la variante debe conservar sintaxis TypeScript válida",
  );
  const transpilation = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    reportDiagnostics: true,
  });
  const errors = (transpilation.diagnostics ?? []).filter(
    ({ category }) => category === ts.DiagnosticCategory.Error,
  );
  assert.equal(errors.length, 0, label + ": TypeScript debe poder transpilar la variante");
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

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function callName(call: ts.CallExpression): string | null {
  const expression = unwrapExpression(call.expression);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    const argument = unwrapExpression(expression.argumentExpression);
    return ts.isStringLiteralLike(argument) ? argument.text : null;
  }
  return null;
}

function callReceiver(call: ts.CallExpression): ts.Expression | null {
  const expression = unwrapExpression(call.expression);
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expression.expression;
  }
  return null;
}

function nodeContains(node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (candidate: ts.Node) => {
    if (found) return;
    if (predicate(candidate)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function nodeContainsCall(node: ts.Node, expectedName: string): boolean {
  return nodeContains(
    node,
    (candidate) => ts.isCallExpression(candidate) && callName(candidate) === expectedName,
  );
}

function nodeContainsIdentifier(node: ts.Node, expectedName: string): boolean {
  return nodeContains(
    node,
    (candidate) => ts.isIdentifier(candidate) && candidate.text === expectedName,
  );
}

function nodeContainsReturnedLiteral(node: ts.Node, value: string | boolean): boolean {
  return nodeContains(node, (candidate) => {
    if (!ts.isReturnStatement(candidate) || !candidate.expression) return false;
    const expression = unwrapExpression(candidate.expression);
    if (typeof value === "string") {
      return ts.isStringLiteralLike(expression) && expression.text === value;
    }
    return expression.kind === (value ? ts.SyntaxKind.TrueKeyword : ts.SyntaxKind.FalseKeyword);
  });
}

function nodeContainsJsxTag(node: ts.Node, expectedName: string): boolean {
  return nodeContains(node, (candidate) => {
    if (ts.isJsxSelfClosingElement(candidate)) {
      return candidate.tagName.getText() === expectedName;
    }
    if (ts.isJsxOpeningElement(candidate)) {
      return candidate.tagName.getText() === expectedName;
    }
    return false;
  });
}

function findFunctionDeclaration(
  sourceFile: ts.SourceFile,
  expectedName: string,
): ts.FunctionDeclaration {
  const matches: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === expectedName
      && node.body
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(
    matches.length,
    1,
    "[AUTH-RECOVERY-02.H1.structure] función " + expectedName + " única y localizable",
  );
  return matches[0];
}

function identifierParameterName(
  declaration: ts.FunctionDeclaration,
  index: number,
): string {
  const parameter = declaration.parameters[index];
  assert.ok(
    parameter && ts.isIdentifier(parameter.name),
    "[AUTH-RECOVERY-02.H1.structure] parámetro "
      + index
      + " identificable en "
      + declaration.name?.text,
  );
  return parameter.name.text;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  expectedName: string,
): ts.PropertyAssignment | null {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment => (
      ts.isPropertyAssignment(candidate)
      && propertyNameText(candidate.name) === expectedName
    ),
  );
  return property ?? null;
}

function callExpressions(node: ts.Node, expectedName: string): ts.CallExpression[] {
  const matches: ts.CallExpression[] = [];
  const visit = (candidate: ts.Node) => {
    if (ts.isCallExpression(candidate) && callName(candidate) === expectedName) {
      matches.push(candidate);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return matches;
}

function directStatementCallIndex(
  declaration: ts.FunctionDeclaration,
  expectedName: string,
): number {
  assert.ok(declaration.body);
  return declaration.body.statements.findIndex((statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    const expression = unwrapExpression(statement.expression);
    return ts.isCallExpression(expression) && callName(expression) === expectedName;
  });
}

function strictActiveComparison(expression: ts.Expression): boolean {
  const current = unwrapExpression(expression);
  if (
    !ts.isBinaryExpression(current)
    || current.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) return false;
  const left = unwrapExpression(current.left);
  const right = unwrapExpression(current.right);
  return (
    ts.isStringLiteralLike(left) && left.text === "active"
  ) || (
    ts.isStringLiteralLike(right) && right.text === "active"
  );
}

function isPermitCurrentCall(node: ts.Node, ownerName: string): boolean {
  if (!ts.isCallExpression(node) || callName(node) !== "isCurrent" || node.arguments.length !== 0) {
    return false;
  }
  const receiver = callReceiver(node);
  if (!receiver) return false;
  const current = unwrapExpression(receiver);
  if (
    !ts.isCallExpression(current)
    || callName(current) !== "get"
    || current.arguments.length !== 1
  ) return false;
  const argument = unwrapExpression(current.arguments[0]);
  return ts.isIdentifier(argument) && argument.text === ownerName;
}

function containsOwnerCurrentCall(node: ts.Node, ownerName: string): boolean {
  return nodeContains(node, (candidate) => {
    if (
      !ts.isCallExpression(candidate)
      || callName(candidate) !== "isCurrent"
      || candidate.arguments.length !== 1
    ) return false;
    const argument = unwrapExpression(candidate.arguments[0]);
    return ts.isIdentifier(argument) && argument.text === ownerName;
  });
}

function containsReturnedState(node: ts.Node, expectedState: string): boolean {
  return nodeContains(node, (candidate) => {
    if (!ts.isReturnStatement(candidate) || !candidate.expression) return false;
    const expression = unwrapExpression(candidate.expression);
    if (!ts.isObjectLiteralExpression(expression)) return false;
    const state = objectProperty(expression, "state");
    if (!state) return false;
    const initializer = unwrapExpression(state.initializer);
    return ts.isStringLiteralLike(initializer) && initializer.text === expectedState;
  });
}

function isWindowEventCall(
  call: ts.CallExpression,
  method: "addEventListener" | "removeEventListener",
): boolean {
  if (callName(call) !== method || call.arguments.length < 2) return false;
  const receiver = callReceiver(call);
  const eventName = unwrapExpression(call.arguments[0]);
  if (!receiver) return false;
  const currentReceiver = unwrapExpression(receiver);
  return (
    ts.isIdentifier(currentReceiver)
    && currentReceiver.text === "window"
    && ts.isStringLiteralLike(eventName)
    && eventName.text === "popstate"
  );
}

const H1_FAILURES = {
  boundaryDefers:
    "[AUTH-RECOVERY-02.H1.boundary-defers] ambas decisiones de sesión deben diferir mientras recovery está bloqueado",
  portalPermit:
    "[AUTH-RECOVERY-02.H1.portal-permit] isPortalResolutionCurrent debe exigir owner y permit recovery vigentes",
  portalAccess:
    "[AUTH-RECOVERY-02.H1.portal-access] resolvePortalAccess debe validar mediante isPortalResolutionCurrent",
  beginInvalidates:
    "[AUTH-RECOVERY-02.H1.begin-invalidates] beginPasswordRecoveryPortalGuard debe invalidar owners después de begin",
  initialSeed:
    "[AUTH-RECOVERY-02.H1.initial-seed] la ruta recovery activa debe sembrar el guard antes del primer evento",
  blockingRender:
    "[AUTH-RECOVERY-02.H1.blocking-render] recovery debe renderizar sus gates antes de Usuario y Coach",
  continuationGate:
    "[AUTH-RECOVERY-02.H1.continuation-gate] la continuación autenticada debe consultar el bloqueo recovery",
  signOutFailure:
    "[AUTH-RECOVERY-02.H1.signout-failure] un error de signOut local debe conservar el guard bloqueado",
  popstate:
    "[AUTH-RECOVERY-02.H1.popstate] popstate debe cerrar localmente recovery y limpiar su listener",
  immediateUrlCleanup:
    "[AUTH-RECOVERY-02.H1.immediate-url-cleanup] la confirmación recovery debe limpiar la URL inmediatamente",
} as const;

function auditRecoveryH1(sources: H1Sources): void {
  const boundaryFile = parseTypeScript(sources.boundary, H1_SOURCE_PATHS.boundary);
  const appFile = parseTypeScript(sources.app, H1_SOURCE_PATHS.app);

  const sessionDecision = findFunctionDeclaration(boundaryFile, "resolveSessionEventDecision");
  const initialDecision = findFunctionDeclaration(boundaryFile, "resolveInitialSessionDecision");
  const hasRecoveryDefer = (declaration: ts.FunctionDeclaration) => nodeContains(
    declaration.body!,
    (node) => (
      ts.isIfStatement(node)
      && nodeContainsCall(node.expression, "isPasswordRecoveryPortalBlocked")
      && nodeContainsReturnedLiteral(node.thenStatement, "defer")
    ),
  );
  assert.ok(
    hasRecoveryDefer(sessionDecision) && hasRecoveryDefer(initialDecision),
    H1_FAILURES.boundaryDefers,
  );

  const currentResolution = findFunctionDeclaration(boundaryFile, "isPortalResolutionCurrent");
  const currentOwnerName = identifierParameterName(currentResolution, 0);
  const currentReturn = currentResolution.body!.statements.find(ts.isReturnStatement);
  const currentExpression = currentReturn?.expression;
  assert.ok(
    currentExpression
    && nodeContains(currentExpression, (node) => (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ))
    && containsOwnerCurrentCall(currentExpression, currentOwnerName)
    && nodeContains(currentExpression, (node) => isPermitCurrentCall(node, currentOwnerName)),
    H1_FAILURES.portalPermit,
  );

  const resolvePortalAccess = findFunctionDeclaration(boundaryFile, "resolvePortalAccess");
  const portalOwnerName = identifierParameterName(resolvePortalAccess, 2);
  const guardedStaleBranch = nodeContains(resolvePortalAccess.body!, (node) => (
    ts.isIfStatement(node)
    && nodeContains(node.expression, (candidate) => {
      if (
        !ts.isCallExpression(candidate)
        || callName(candidate) !== "isPortalResolutionCurrent"
        || candidate.arguments.length !== 1
      ) return false;
      const argument = unwrapExpression(candidate.arguments[0]);
      return ts.isIdentifier(argument) && argument.text === portalOwnerName;
    })
    && containsReturnedState(node.thenStatement, "stale")
  ));
  assert.ok(guardedStaleBranch, H1_FAILURES.portalAccess);

  const beginGuard = findFunctionDeclaration(boundaryFile, "beginPasswordRecoveryPortalGuard");
  const beginIndex = beginGuard.body!.statements.findIndex(
    (statement) => nodeContainsCall(statement, "begin"),
  );
  const invalidateIndex = beginGuard.body!.statements.findIndex((statement) => {
    if (!ts.isExpressionStatement(statement)) return false;
    const expression = unwrapExpression(statement.expression);
    return (
      ts.isCallExpression(expression)
      && callName(expression) === "invalidatePortalOperations"
    );
  });
  assert.ok(
    beginIndex >= 0 && invalidateIndex > beginIndex,
    H1_FAILURES.beginInvalidates,
  );

  const consumesInitialSeed = callExpressions(boundaryFile, "createPasswordRecoveryPortalGuard")
    .some((call) => (
      call.arguments.length === 1
      && nodeContains(call.arguments[0], (node) => (
        ts.isPropertyAccessExpression(node)
        && node.name.text === "initialPasswordRecoveryActive"
      ))
    ));
  const seedsInitialRecovery = callExpressions(appFile, "useMultiportalAuthBoundary")
    .some((call) => {
      const argument = call.arguments[0] && unwrapExpression(call.arguments[0]);
      if (!argument || !ts.isObjectLiteralExpression(argument)) return false;
      const seed = objectProperty(argument, "initialPasswordRecoveryActive");
      return Boolean(seed && strictActiveComparison(seed.initializer));
    });
  assert.ok(
    consumesInitialSeed && seedsInitialRecovery,
    H1_FAILURES.initialSeed,
  );

  const appFunction = findFunctionDeclaration(appFile, "OrganizatechApp");
  const topLevelIfs = appFunction.body!.statements.filter(ts.isIfStatement);
  const confirmedRecoveryRender = topLevelIfs.find((statement) => (
    nodeContainsCall(statement.expression, "isPasswordRecoveryPortalBlocked")
    && nodeContainsJsxTag(statement.thenStatement, "NewPasswordScreen")
  ));
  const pendingRecoveryRender = topLevelIfs.find((statement) => (
    nodeContainsCall(statement.expression, "isPasswordRecoveryPortalBlocked")
    && nodeContainsJsxTag(statement.thenStatement, "AuthLoadingScreen")
  ));
  const coachRender = topLevelIfs.find(
    (statement) => nodeContainsJsxTag(statement.thenStatement, "CoachPortalBoundary"),
  );
  const userRender = appFunction.body!.statements.find(
    (statement) => ts.isReturnStatement(statement) && nodeContainsJsxTag(statement, "AppShellLayout"),
  );
  assert.ok(
    confirmedRecoveryRender
    && pendingRecoveryRender
    && coachRender
    && userRender
    && confirmedRecoveryRender.getStart(appFile) < coachRender.getStart(appFile)
    && pendingRecoveryRender.getStart(appFile) < coachRender.getStart(appFile)
    && confirmedRecoveryRender.getStart(appFile) < userRender.getStart(appFile)
    && pendingRecoveryRender.getStart(appFile) < userRender.getStart(appFile),
    H1_FAILURES.blockingRender,
  );

  const secureContinuation = callExpressions(appFunction, "coordinateAuthenticatedSessionEvent")
    .some((call) => {
      const eventInput = call.arguments[0] && unwrapExpression(call.arguments[0]);
      const callbacks = call.arguments[1] && unwrapExpression(call.arguments[1]);
      if (
        !eventInput
        || !callbacks
        || !ts.isObjectLiteralExpression(eventInput)
        || !ts.isObjectLiteralExpression(callbacks)
      ) return false;
      const intent = objectProperty(eventInput, "intent");
      const continuation = objectProperty(callbacks, "canContinueAfterSessionApplied");
      if (
        !intent
        || !ts.isConditionalExpression(unwrapExpression(intent.initializer))
        || !continuation
      ) return false;
      const initializer = unwrapExpression(continuation.initializer);
      if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return false;
      return nodeContains(initializer.body, (node) => (
        ts.isPrefixUnaryExpression(node)
        && node.operator === ts.SyntaxKind.ExclamationToken
        && nodeContainsCall(node.operand, "isPasswordRecoveryPortalBlocked")
      ));
    });
  assert.ok(secureContinuation, H1_FAILURES.continuationGate);

  const localClose = findFunctionDeclaration(appFile, "closePasswordRecoverySessionLocally");
  const signOutDeclarationIndex = localClose.body!.statements.findIndex((statement) => (
    ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => (
      declaration.initializer
      && ts.isAwaitExpression(unwrapExpression(declaration.initializer))
      && nodeContainsCall(declaration.initializer, "signOutPasswordRecoveryLocally")
    ))
  ));
  const signOutStatement = localClose.body!.statements[signOutDeclarationIndex];
  let signOutErrorName: string | null = null;
  if (signOutStatement && ts.isVariableStatement(signOutStatement)) {
    for (const declaration of signOutStatement.declarationList.declarations) {
      if (!ts.isObjectBindingPattern(declaration.name)) continue;
      const errorElement = declaration.name.elements.find((element) => (
        propertyNameText(element.propertyName) === "error"
        || (!element.propertyName && ts.isIdentifier(element.name) && element.name.text === "error")
      ));
      if (errorElement && ts.isIdentifier(errorElement.name)) {
        signOutErrorName = errorElement.name.text;
      }
    }
  }
  const failureIndex = signOutErrorName
    ? localClose.body!.statements.findIndex((statement, index) => (
      index > signOutDeclarationIndex
      && ts.isIfStatement(statement)
      && nodeContainsIdentifier(statement.expression, signOutErrorName!)
    ))
    : -1;
  const failureBranch = failureIndex >= 0
    ? localClose.body!.statements[failureIndex] as ts.IfStatement
    : null;
  const finalizationIndex = localClose.body!.statements.findIndex(
    (statement) => ts.isExpressionStatement(statement)
      && nodeContainsCall(statement, "finalizePasswordRecoveryToLogin"),
  );
  assert.ok(
    signOutDeclarationIndex >= 0
    && signOutErrorName
    && failureBranch
    && nodeContainsReturnedLiteral(failureBranch.thenStatement, false)
    && !nodeContainsCall(failureBranch.thenStatement, "releasePasswordRecoveryPortalGuard")
    && !nodeContainsCall(failureBranch.thenStatement, "finalizePasswordRecoveryToLogin")
    && finalizationIndex > failureIndex,
    H1_FAILURES.signOutFailure,
  );

  const popstateAdds = callExpressions(appFunction, "addEventListener")
    .filter((call) => isWindowEventCall(call, "addEventListener"));
  const popstateRemoves = callExpressions(appFunction, "removeEventListener")
    .filter((call) => isWindowEventCall(call, "removeEventListener"));
  const addHandler = popstateAdds[0]?.arguments[1];
  const removeHandler = popstateRemoves[0]?.arguments[1];
  const unwrappedAddHandler = addHandler ? unwrapExpression(addHandler) : null;
  const unwrappedRemoveHandler = removeHandler ? unwrapExpression(removeHandler) : null;
  const popstateHandlerName = unwrappedAddHandler && ts.isIdentifier(unwrappedAddHandler)
    ? unwrappedAddHandler.text
    : null;
  const removesSameHandler = Boolean(
    popstateHandlerName
    && unwrappedRemoveHandler
    && ts.isIdentifier(unwrappedRemoveHandler)
    && unwrappedRemoveHandler.text === popstateHandlerName,
  );
  const handlerClosesLocally = Boolean(
    popstateHandlerName
    && nodeContains(appFunction.body!, (node) => {
      if (
        !ts.isVariableDeclaration(node)
        || !ts.isIdentifier(node.name)
        || node.name.text !== popstateHandlerName
        || !node.initializer
      ) return false;
      const initializer = unwrapExpression(node.initializer);
      return (
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        && nodeContainsCall(initializer, "closePasswordRecoverySessionLocally")
      );
    }),
  );
  assert.ok(
    popstateAdds.length === 1
    && popstateRemoves.length === 1
    && removesSameHandler
    && handlerClosesLocally,
    H1_FAILURES.popstate,
  );

  const confirmRecovery = findFunctionDeclaration(appFile, "confirmPasswordRecoverySession");
  const beginRecoveryIndex = directStatementCallIndex(
    confirmRecovery,
    "beginPasswordRecoveryPortalSession",
  );
  const clearRecoveryUrlIndex = directStatementCallIndex(confirmRecovery, "clearPasswordRecoveryUrl");
  assert.ok(
    beginRecoveryIndex >= 0 && clearRecoveryUrlIndex === beginRecoveryIndex + 1,
    H1_FAILURES.immediateUrlCleanup,
  );
}

interface H1MutationProbe {
  id: string;
  source: H1SourceKey;
  expectedFailure: string;
  mutate(source: string): string;
}

interface H1PositiveControl {
  id: string;
  source: H1SourceKey;
  transform(source: string): string;
}

function replaceExactlyOnce(
  source: string,
  target: string,
  replacement: string,
  label: string,
): string {
  const start = source.indexOf(target);
  assert.ok(start >= 0, label + ": target localizable");
  assert.equal(
    source.indexOf(target, start + target.length),
    -1,
    label + ": target único",
  );
  return source.slice(0, start) + replacement + source.slice(start + target.length);
}

function replaceNodeText(
  source: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  replacement: string,
): string {
  return source.slice(0, node.getStart(sourceFile))
    + replacement
    + source.slice(node.getEnd());
}

function mutateBlockingRecoveryRender(source: string): string {
  const sourceFile = parseTypeScript(source, H1_SOURCE_PATHS.app);
  const appFunction = findFunctionDeclaration(sourceFile, "OrganizatechApp");
  const recoveryRenders = appFunction.body!.statements.filter((statement) => (
    ts.isIfStatement(statement)
    && nodeContainsCall(statement.expression, "isPasswordRecoveryPortalBlocked")
    && (
      nodeContainsJsxTag(statement.thenStatement, "NewPasswordScreen")
      || nodeContainsJsxTag(statement.thenStatement, "AuthLoadingScreen")
    )
  ));
  assert.equal(recoveryRenders.length, 2, "H1.M06: gates recovery localizables");
  return [...recoveryRenders]
    .sort((left, right) => right.getStart(sourceFile) - left.getStart(sourceFile))
    .reduce(
      (current, statement) => (
        current.slice(0, statement.getStart(sourceFile)) + current.slice(statement.getEnd())
      ),
      source,
    );
}

function mutateContinuationGate(source: string): string {
  const sourceFile = parseTypeScript(source, H1_SOURCE_PATHS.app);
  const appFunction = findFunctionDeclaration(sourceFile, "OrganizatechApp");
  const target = callExpressions(appFunction, "coordinateAuthenticatedSessionEvent")
    .map((call) => {
      const input = call.arguments[0] && unwrapExpression(call.arguments[0]);
      const callbacks = call.arguments[1] && unwrapExpression(call.arguments[1]);
      if (!input || !callbacks || !ts.isObjectLiteralExpression(input) || !ts.isObjectLiteralExpression(callbacks)) {
        return null;
      }
      const intent = objectProperty(input, "intent");
      const continuation = objectProperty(callbacks, "canContinueAfterSessionApplied");
      return intent
        && ts.isConditionalExpression(unwrapExpression(intent.initializer))
        && continuation
        ? continuation.initializer
        : null;
    })
    .filter((candidate): candidate is ts.Expression => candidate !== null);
  assert.equal(target.length, 1, "H1.M07: continuación autenticada única");
  return replaceNodeText(source, sourceFile, target[0], "() => true");
}

function mutateBeginInvalidation(source: string): string {
  const sourceFile = parseTypeScript(source, H1_SOURCE_PATHS.boundary);
  const beginGuard = findFunctionDeclaration(sourceFile, "beginPasswordRecoveryPortalGuard");
  const index = directStatementCallIndex(beginGuard, "invalidatePortalOperations");
  assert.ok(index >= 0, "H1.M04: invalidación localizable en begin");
  return replaceNodeText(source, sourceFile, beginGuard.body!.statements[index], "");
}

function mutateSignOutFailureRelease(source: string): string {
  const sourceFile = parseTypeScript(source, H1_SOURCE_PATHS.app);
  const closeRecovery = findFunctionDeclaration(sourceFile, "closePasswordRecoverySessionLocally");
  const failureBranches = closeRecovery.body!.statements.filter((statement): statement is ts.IfStatement => (
    ts.isIfStatement(statement)
    && nodeContainsReturnedLiteral(statement.thenStatement, false)
  ));
  assert.equal(failureBranches.length, 1, "H1.M08: rama de error local única");
  const branch = failureBranches[0].thenStatement;
  assert.ok(ts.isBlock(branch), "H1.M08: rama de error bloque estructurado");
  const insertion = branch.getStart(sourceFile) + 1;
  return source.slice(0, insertion)
    + "\n      multiportalAuth.releasePasswordRecoveryPortalGuard();"
    + source.slice(insertion);
}

function mutatePopstateListener(source: string): string {
  const sourceFile = parseTypeScript(source, H1_SOURCE_PATHS.app);
  const appFunction = findFunctionDeclaration(sourceFile, "OrganizatechApp");
  const calls = callExpressions(appFunction, "addEventListener")
    .filter((call) => isWindowEventCall(call, "addEventListener"));
  assert.equal(calls.length, 1, "H1.M09: listener popstate único");
  const statement = calls[0].parent;
  assert.ok(ts.isExpressionStatement(statement), "H1.M09: listener como statement");
  return replaceNodeText(source, sourceFile, statement, "");
}

function mutateImmediateUrlCleanup(source: string): string {
  const sourceFile = parseTypeScript(source, H1_SOURCE_PATHS.app);
  const confirmation = findFunctionDeclaration(sourceFile, "confirmPasswordRecoverySession");
  const index = directStatementCallIndex(confirmation, "clearPasswordRecoveryUrl");
  assert.ok(index >= 0, "H1.M10: limpieza inmediata localizable");
  return replaceNodeText(source, sourceFile, confirmation.body!.statements[index], "");
}

function renameLocalSignOutError(source: string): string {
  const sourceFile = parseTypeScript(source, H1_SOURCE_PATHS.app);
  const declaration = findFunctionDeclaration(sourceFile, "closePasswordRecoverySessionLocally");
  const original = source.slice(declaration.getStart(sourceFile), declaration.getEnd());
  const renamedBinding = replaceExactlyOnce(
    original,
    "const { error } = await multiportalAuth.signOutPasswordRecoveryLocally();",
    "const { error: recoveryCloseFailure } = await multiportalAuth.signOutPasswordRecoveryLocally();",
    "H1.C03.binding",
  );
  const renamedCondition = replaceExactlyOnce(
    renamedBinding,
    "if (error)",
    "if (recoveryCloseFailure)",
    "H1.C03.condition",
  );
  const renamedUse = replaceExactlyOnce(
    renamedCondition,
    "translateAuthError(error)",
    "translateAuthError(recoveryCloseFailure)",
    "H1.C03.use",
  );
  return replaceNodeText(source, sourceFile, declaration, renamedUse);
}

const H1_MUTATION_PROBES: readonly H1MutationProbe[] = [
  {
    id: "H1.M01.remove-both-boundary-defers",
    source: "boundary",
    expectedFailure: H1_FAILURES.boundaryDefers,
    mutate(source) {
      const withoutSessionDefer = replaceExactlyOnce(
        source,
        [
          "    if (event !== \"SIGNED_OUT\" && isPasswordRecoveryPortalBlocked()) {",
          "      return \"defer\";",
          "    }",
          "",
        ].join("\n"),
        "",
        this.id + ".session",
      );
      return replaceExactlyOnce(
        withoutSessionDefer,
        "    if (isPasswordRecoveryPortalBlocked()) return \"defer\";\n",
        "",
        this.id + ".initial",
      );
    },
  },
  {
    id: "H1.M02.ignore-recovery-permit",
    source: "boundary",
    expectedFailure: H1_FAILURES.portalPermit,
    mutate(source) {
      return replaceExactlyOnce(
        source,
        [
          "    return portalResolutionOwnersRef.current.isCurrent(owner)",
          "      && passwordRecoveryMountPermitsRef.current.get(owner)?.isCurrent() === true;",
        ].join("\n"),
        "    return portalResolutionOwnersRef.current.isCurrent(owner);",
        this.id,
      );
    },
  },
  {
    id: "H1.M03.resolve-access-owner-only",
    source: "boundary",
    expectedFailure: H1_FAILURES.portalAccess,
    mutate(source) {
      return replaceExactlyOnce(
        source,
        "      || !isPortalResolutionCurrent(owner)",
        "      || !portalResolutionOwnersRef.current.isCurrent(owner)",
        this.id,
      );
    },
  },
  {
    id: "H1.M04.remove-begin-invalidation",
    source: "boundary",
    expectedFailure: H1_FAILURES.beginInvalidates,
    mutate: mutateBeginInvalidation,
  },
  {
    id: "H1.M05.remove-initial-seed",
    source: "app",
    expectedFailure: H1_FAILURES.initialSeed,
    mutate(source) {
      return replaceExactlyOnce(
        source,
        "    initialPasswordRecoveryActive: initialPasswordRecoveryRouteState === \"active\",\n",
        "",
        this.id,
      );
    },
  },
  {
    id: "H1.M06.remove-blocking-render",
    source: "app",
    expectedFailure: H1_FAILURES.blockingRender,
    mutate: mutateBlockingRecoveryRender,
  },
  {
    id: "H1.M07-continuation-always-true",
    source: "app",
    expectedFailure: H1_FAILURES.continuationGate,
    mutate: mutateContinuationGate,
  },
  {
    id: "H1.M08-release-on-signout-error",
    source: "app",
    expectedFailure: H1_FAILURES.signOutFailure,
    mutate: mutateSignOutFailureRelease,
  },
  {
    id: "H1.M09-remove-popstate-listener",
    source: "app",
    expectedFailure: H1_FAILURES.popstate,
    mutate: mutatePopstateListener,
  },
  {
    id: "H1.M10-remove-immediate-url-cleanup",
    source: "app",
    expectedFailure: H1_FAILURES.immediateUrlCleanup,
    mutate: mutateImmediateUrlCleanup,
  },
] as const;

const H1_POSITIVE_CONTROLS: readonly H1PositiveControl[] = [
  {
    id: "H1.C01.comment",
    source: "boundary",
    transform(source) {
      return replaceExactlyOnce(
        source,
        "  function isPortalResolutionCurrent(",
        "  // H1 control: comentario inocuo.\n  function isPortalResolutionCurrent(",
        this.id,
      );
    },
  },
  {
    id: "H1.C02-reformat",
    source: "boundary",
    transform(source) {
      return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(
        parseTypeScript(source, H1_SOURCE_PATHS.boundary),
      );
    },
  },
  {
    id: "H1.C03-local-rename",
    source: "app",
    transform: renameLocalSignOutError,
  },
  {
    id: "H1.C04-innocent-reorder",
    source: "boundary",
    transform(source) {
      return replaceExactlyOnce(
        source,
        [
          "    beginPortalResolution,",
          "    endPortalResolution,",
          "    isPortalResolutionCurrent,",
        ].join("\n"),
        [
          "    isPortalResolutionCurrent,",
          "    beginPortalResolution,",
          "    endPortalResolution,",
        ].join("\n"),
        this.id,
      );
    },
  },
] as const;

const EXPECTED_H1_MUTATION_PROBE_COUNT = 10;
const EXPECTED_H1_POSITIVE_CONTROL_COUNT = 4;

function assertFirstH1Failure(
  sources: H1Sources,
  expectedFailure: string,
  label: string,
): void {
  let captured: unknown = null;
  try {
    auditRecoveryH1(sources);
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof assert.AssertionError, label + ": debe fallar con AssertionError");
  assert.equal(captured.message, expectedFailure, label + ": primera causa exacta");
}

function verifyTemporaryH1Variant(input: {
  id: string;
  source: H1SourceKey;
  variant: string;
  verify(sources: H1Sources): void;
}): void {
  const sourcePath = H1_SOURCE_PATHS[input.source];
  const original = input.source === "app" ? appSource : authBoundarySource;
  const originalHash = sha256(original);
  assert.notEqual(input.variant, original, input.id + ": source diff");
  assert.notEqual(sha256(input.variant), originalHash, input.id + ": hash diff");
  assertValidTypeScript(input.variant, sourcePath, input.id);

  const temporaryRoot = mkdtempSync(join(tmpdir(), "auth-recovery-h1-"));
  const temporaryPath = join(temporaryRoot, basename(sourcePath));
  writeFileSync(temporaryPath, original, "utf8");
  const originalBytes = readFileSync(temporaryPath);
  const originalBytesHash = sha256(originalBytes);
  try {
    writeFileSync(temporaryPath, input.variant, "utf8");
    const materialized = readFileSync(temporaryPath, "utf8");
    assert.equal(materialized, input.variant, input.id + ": variante materializada");
    assert.notEqual(sha256(materialized), originalBytesHash, input.id + ": SHA temporal mutado");
    input.verify({
      app: input.source === "app" ? materialized : appSource,
      boundary: input.source === "boundary" ? materialized : authBoundarySource,
    });
  } finally {
    try {
      writeFileSync(temporaryPath, originalBytes);
      const restoredBytes = readFileSync(temporaryPath);
      assert.deepEqual(restoredBytes, originalBytes, input.id + ": bytes restaurados en finally");
      assert.equal(
        sha256(restoredBytes),
        originalBytesHash,
        input.id + ": SHA restaurado en finally",
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
  assert.equal(existsSync(temporaryRoot), false, input.id + ": temporales eliminados");
  assert.equal(readFileSync(sourcePath, "utf8"), original, input.id + ": producto intacto");
  assert.equal(sha256(readFileSync(sourcePath)), originalHash, input.id + ": SHA producto intacto");
}

function assertPasswordRecoveryPortalGuardRuntime(): void {
  const guard = createPasswordRecoveryPortalGuard();
  assert.equal(guard.isBlocked(), false, "guard inicial desbloqueado");
  const beforeRecovery = guard.capturePortalMountPermit();
  assert.equal(beforeRecovery.isCurrent(), true, "permit inicial vigente");
  assert.equal(guard.begin(), true, "primer begin activa recovery");
  assert.equal(guard.begin(), false, "doble begin es idempotente");
  assert.equal(guard.isBlocked(), true, "begin bloquea portales");
  assert.equal(beforeRecovery.isCurrent(), false, "begin invalida permit previo");
  const duringRecovery = guard.capturePortalMountPermit();
  assert.equal(duringRecovery.isCurrent(), false, "permit capturado durante recovery nace stale");
  assert.equal(guard.release(), true, "primer release termina recovery");
  assert.equal(guard.release(), false, "doble release es idempotente");
  assert.equal(guard.isBlocked(), false, "release desbloquea el siguiente login manual");
  assert.equal(beforeRecovery.isCurrent(), false, "release no revive permit previo");
  assert.equal(duringRecovery.isCurrent(), false, "release no revive permit de recovery");
  const afterRecovery = guard.capturePortalMountPermit();
  assert.equal(afterRecovery.isCurrent(), true, "nuevo permit posterior queda vigente");
  assert.equal(guard.begin(), true, "segundo ciclo avanza la revisión");
  assert.equal(afterRecovery.isCurrent(), false, "segundo ciclo invalida permit posterior");
  assert.equal(guard.release(), true, "segundo ciclo puede finalizar");
  assert.equal(afterRecovery.isCurrent(), false, "segunda liberación tampoco revive permisos");

  const initiallyBlocked = createPasswordRecoveryPortalGuard(true);
  assert.equal(initiallyBlocked.isBlocked(), true, "seed activo bloquea antes del primer evento");
  const seededPermit = initiallyBlocked.capturePortalMountPermit();
  assert.equal(seededPermit.isCurrent(), false, "seed activo no emite permit montable");
  assert.equal(initiallyBlocked.begin(), false, "begin duplicado respeta seed activo");
  assert.equal(initiallyBlocked.release(), true, "seed activo puede finalizar");
  assert.equal(seededPermit.isCurrent(), false, "release del seed no revive permits");
}

const baselineH1Sources: H1Sources = {
  app: appSource,
  boundary: authBoundarySource,
};

auditRecoveryH1(baselineH1Sources);
assertPasswordRecoveryPortalGuardRuntime();
assert.equal(
  H1_MUTATION_PROBES.length,
  EXPECTED_H1_MUTATION_PROBE_COUNT,
  "AUTH-RECOVERY-02 H1 debe conservar exactamente diez mutation probes",
);
assert.equal(
  new Set(H1_MUTATION_PROBES.map(({ id }) => id)).size,
  EXPECTED_H1_MUTATION_PROBE_COUNT,
  "AUTH-RECOVERY-02 H1 mutation probes deben tener IDs únicos",
);
for (const probe of H1_MUTATION_PROBES) {
  const original = baselineH1Sources[probe.source];
  const variant = probe.mutate(original);
  verifyTemporaryH1Variant({
    id: probe.id,
    source: probe.source,
    variant,
    verify: (sources) => assertFirstH1Failure(sources, probe.expectedFailure, probe.id),
  });
}

assert.equal(
  H1_POSITIVE_CONTROLS.length,
  EXPECTED_H1_POSITIVE_CONTROL_COUNT,
  "AUTH-RECOVERY-02 H1 debe conservar cuatro controles positivos",
);
for (const control of H1_POSITIVE_CONTROLS) {
  const original = baselineH1Sources[control.source];
  const variant = control.transform(original);
  verifyTemporaryH1Variant({
    id: control.id,
    source: control.source,
    variant,
    verify: (sources) => assert.doesNotThrow(
      () => auditRecoveryH1(sources),
      control.id + ": el control positivo debe pasar",
    ),
  });
}

const bootstrapSource = sourceSection(
  appSource,
  "    async function bootstrapSession()",
  "    void bootstrapSession();",
);
const updateHandlerSource = sourceSection(
  appSource,
  "  async function handleUpdatePassword",
  "  function prepareRoutineBuilderStateFromExercises",
);
const bootstrapCatchSource = sourceSection(
  bootstrapSource,
  "      } catch (error) {",
  "      } finally {",
);
const completionSource = sourceSection(
  appSource,
  "  function completePasswordRecoveryUpdate",
  "  useEffect(() => {",
);
const recoveryFinalizationSource = sourceSection(
  appSource,
  "  function finalizePasswordRecoveryToLogin",
  "  function completePasswordRecoveryUpdate",
);
const recoveryStorageSource = sourceSection(
  storageSource,
  "export function startPasswordRecoveryFlow",
  "function migrateLegacyValue",
);

assert.match(bootstrapSource, /resolvePasswordRecoverySessionDecision\([\s\S]*?event: "bootstrap"/);
assert.match(bootstrapSource, /recoveryDecision === "invalid"[\s\S]*?invalidatePasswordRecoverySession\(\)/);
assert.match(bootstrapSource, /recoveryDecision === "confirmed"[\s\S]*?confirmPasswordRecoverySession\(authState\.session\)/);
assert.match(appSource, /event === "PASSWORD_RECOVERY"[\s\S]*?event === "INITIAL_SESSION"[\s\S]*?event === "SIGNED_IN"[\s\S]*?event === "TOKEN_REFRESHED"/);
assert.match(appSource, /hasPasswordRecoveryCallbackError\(\{\s*error,\s*errorCode,\s*errorDescription,?\s*\}\)/);
assert.match(appSource, /return getBrowserAuthCallbackUrl\(PASSWORD_RECOVERY_FLOW\);/);
assert.match(appSource, /hashParams\.get\("type"\) === "recovery" && accessToken/);
assert.match(appSource, /authState\.session\?\.access_token === recoveryCallbackAccessToken/);
assert.match(appSource, /session\?\.access_token === recoveryCallbackAccessToken/);
assert.match(appSource, /confirmPasswordRecoveryFlow\(\)/);
assert.match(appSource, /const initialPasswordRecoveryRouteStateRef = useRef/);
assert.equal(
  (sourceSection(appSource, "export function OrganizatechApp", "  const [sessionName, setSessionName]")
    .match(/getPasswordRecoveryRouteState\(\)/g) ?? []).length,
  1,
);
assert.match(bootstrapSource, /const recoveryState = initialPasswordRecoveryRouteState;/);
assert.match(bootstrapCatchSource, /sessionLookup: "error"/);
assert.match(bootstrapCatchSource, /setIsAuthLoading\(true\)/);
assert.doesNotMatch(bootstrapCatchSource, /invalidatePasswordRecoverySession|clearPasswordRecovery/);

assert.match(updateHandlerSource, /!confirmedUserId[\s\S]*?!isPasswordRecoveryConfirmed[\s\S]*?passwordRecoveryStateRef\.current !== "confirmed"/);
assert.match(updateHandlerSource, /tryAcquireActiveWorkoutOperation\(passwordRecoveryUpdateOwnerRef\)/);
assert.match(updateHandlerSource, /const operationOwner = tryAcquireActiveWorkoutOperation\(passwordRecoveryUpdateOwnerRef\);\s*\n\s*if \(!operationOwner\) return;/);
assert.match(updateHandlerSource, /isActiveWorkoutOperationCurrent\([\s\S]*?passwordRecoveryUpdateOwnerRef/);
assert.match(updateHandlerSource, /finalizeActiveWorkoutOperation\([\s\S]*?passwordRecoveryUpdateOwnerRef/);
assert.match(updateHandlerSource, /isTerminalOperationCurrent:[\s\S]*?sessionDataMountedRef\.current[\s\S]*?isSessionOperationOwner/);
assert.match(updateHandlerSource, /releaseSessionOperationOwner\(/);
assert.doesNotMatch(updateHandlerSource, /Symbol\(/);
assert.match(updateHandlerSource, /executePasswordRecoveryUpdate\(\{/);
assert.match(updateHandlerSource, /getSession: \(\) => supabase\.auth\.getSession\(\)/);
assert.equal((appSource.match(/supabase\.auth\.updateUser\(/g) ?? []).length, 1);
assert.match(updateHandlerSource, /updateUser: \(attributes\) => supabase\.auth\.updateUser\(attributes\)/);
assert.match(updateHandlerSource, /signOut: \(\) => multiportalAuth\.signOutPasswordRecoveryLocally\(\)/);
assert.match(updateHandlerSource, /result\.kind === "update-error"[\s\S]*?closePasswordRecoverySessionLocally\(/);

const getSessionIndex = recoverySource.indexOf("await input.auth.getSession()");
const updateUserIndex = recoverySource.indexOf("await input.auth.updateUser({ password: input.password })");
assert.ok(getSessionIndex >= 0 && updateUserIndex > getSessionIndex, "getSession debe preceder al write allowlisted");
assert.match(recoverySource, /if \(sessionResult\.error \|\| !sessionResult\.data\.session\) return \{ kind: "invalid-recovery" \};/);
assert.match(recoverySource, /if \(!input\.isOperationCurrent\(\)\) return \{ kind: "stale" \};/);
assert.match(recoverySource, /const confirmedUserId = normalizePasswordRecoveryUserId\(input\.confirmedUserId\)/);
assert.match(recoverySource, /normalizePasswordRecoveryUserId\(sessionResult\.data\.session\.user\.id\) !== confirmedUserId/);
assert.match(recoverySource, /const signOutResult = await input\.auth\.signOut\(\{ scope: "local" \}\);\s*\n\s*if \(!input\.isTerminalOperationCurrent\(\)\)/);
assert.match(recoverySource, /if \(signOutResult\.error\) return \{ kind: "sign-out-error", error: signOutResult\.error \};/);
assert.match(recoverySource, /input\.storedRecoveryStatus === "confirmed"\) return "invalid"/);
assert.match(recoverySource, /confirmedRecoveryUserId === sessionUserId/);
assert.match(recoverySource, /input\.event === "PASSWORD_RECOVERY"[\s\S]*?sessionUserId \? "confirmed" : "invalid"/);
assert.match(recoverySource, /getPasswordRecoveryClearedHref[\s\S]*?return new URL\(href\)\.pathname/);

assert.match(completionSource, /if \(!passwordUpdateSuccessRef\.current\) return false;/);
assert.match(completionSource, /setNewPassword\(""\)[\s\S]*?setNewPasswordConfirm\(""\)/);
assert.match(completionSource, /finalizePasswordRecoveryToLogin\([\s\S]*?"success"/);
assert.match(
  recoveryFinalizationSource,
  /const \{ error \} = await multiportalAuth\.signOutPasswordRecoveryLocally\(\);[\s\S]*?finalizePasswordRecoveryToLogin\(/,
);
assert.match(
  recoveryFinalizationSource,
  /releasePasswordRecoveryPortalGuard\(\);[\s\S]*?clearPasswordRecoveryUrl\(\);[\s\S]*?clearUserSessionState\(/,
);
assert.match(
  recoveryFinalizationSource,
  /authRouteController\.replace\(\{ mode: "login", accountType: "usuario" \}\);[\s\S]*?navigation\.reset\("login"\)/,
);
assert.match(appSource, /event === "SIGNED_OUT"[\s\S]*?completePasswordRecoveryUpdate\(previousStorageScope\)/);
assert.match(updateHandlerSource, /completePasswordRecoveryUpdate\(recoveryStorageScope\)/);

assert.match(storageSource, /PASSWORD_RECOVERY_STORAGE_VERSION = 3/);
assert.match(storageSource, /status: "pending"/);
assert.match(storageSource, /status: "confirmed"/);
assert.match(storageSource, /normalizePasswordRecoveryUserId\(value: unknown\)/);
assert.doesNotMatch(recoveryStorageSource, /userId|accessToken|refreshToken|access_token|refresh_token|fingerprint/i);

assert.match(authBoundarySource, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
assert.doesNotMatch(portalGuardSource, /localStorage|sessionStorage|console\.|access_token|refresh_token|email|userId/i);
assert.match(appSource, /function beginPasswordRecoveryPortalSession[\s\S]*?authenticatedSessionCoordinatorRef\.current\.reset\(\)[\s\S]*?replaceCoachPortalSession\(null\)[\s\S]*?setSupabaseSession\(null\)[\s\S]*?setSupabaseUser\(null\)/);

console.log(
  "password-recovery integration contract tests passed; H1 mutation probes: "
    + H1_MUTATION_PROBES.length
    + "/"
    + EXPECTED_H1_MUTATION_PROBE_COUNT
    + "; positive controls: "
    + H1_POSITIVE_CONTROLS.length
    + "/"
    + EXPECTED_H1_POSITIVE_CONTROL_COUNT,
);
