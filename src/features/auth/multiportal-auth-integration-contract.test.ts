import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const ROOT_PATH = "src/components/organizatech-app.tsx";
const CONTROLLER_PATH = "src/features/auth/model/multiportal-auth-controller.ts";
const OWNER_PATH = "src/features/auth/model/portal-resolution-owner.ts";
const GATEWAY_PATH = "src/features/auth/data/supabase-multiportal-auth-gateway.ts";
const HOOK_PATH = "src/features/auth/hooks/use-multiportal-auth-boundary.ts";
const FORM_PATH = "src/features/auth/model/auth-form.ts";
const SCREEN_PATH = "src/features/auth/components/auth-screen.tsx";
const METADATA_RUNTIME_PROBE_PATH =
  "src/features/auth/model/multiportal-auth-metadata-mutation-runtime.test.ts";

interface Sources {
  root: string;
  controller: string;
  owner: string;
  gateway: string;
  hook: string;
  form: string;
  screen: string;
}

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

function isCoachAuthorizedReturn(statement: ts.ReturnStatement) {
  return Boolean(
    statement.expression
    && objectLiteralStringProperty(statement.expression, "state") === "coach_authorized",
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
      const call = awaitedMethodCall(initializer, "hasCoachRegistration");
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

function auditGatewayCoachLookupSemantics(gateway: string) {
  const sourceFile = parseTypeScript(gateway, GATEWAY_PATH);
  const method = findNamedMethod(sourceFile, "hasCoachRegistration");
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
  const returnsPositiveEvidence = Boolean(
    evidenceName
    && returnExpression
    && ts.isBinaryExpression(returnExpression)
    && (
      returnExpression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
      || returnExpression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    )
    && (
      (
        isIdentifierNamed(returnExpression.left, evidenceName)
        && unwrapExpression(returnExpression.right).kind === ts.SyntaxKind.NullKeyword
      )
      || (
        isIdentifierNamed(returnExpression.right, evidenceName)
        && unwrapExpression(returnExpression.left).kind === ts.SyntaxKind.NullKeyword
      )
    )
  );
  assert.equal(
    returnsPositiveEvidence,
    true,
    "[AUTH-COACH-01.E9.authoritative-select-required] true deriva exclusivamente de evidencia SELECT no nula",
  );
}

function auditIntegration(sources: Sources) {
  const { root, controller, owner, gateway, hook, form, screen } = sources;

  assert.match(
    controller,
    /"Cuenta Coach no registrada\. Crea una cuenta Coach para iniciar sesión\."/,
    "[AUTH-COACH-01.controller.exact-message] conserva el mensaje aprobado",
  );
  assert.match(
    controller,
    /const hasCoachRegistration = await gateway\.hasCoachRegistration\(identity\.userId, input\.owner\);[\s\S]*if \(hasCoachRegistration\) \{[\s\S]*state: "coach_authorized"/,
    "[AUTH-COACH-01.controller.authoritative-coach-row] sólo la fila backend concede Coach",
  );
  assert.match(
    controller,
    /const hasCoachRegistration = await[\s\S]*if \(!ownsPortalResolution\(input\)\) return stalePortalResolution/,
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
    /registration\.userId !== identity\.userId/,
    "[AUTH-COACH-01.controller.registration-owner] registro cruzado falla cerrado",
  );
  assert.match(
    controller,
    /async function registerCoach<[\s\S]*owner: CoachRegistrationOwner[\s\S]*if \(!owner\.isCurrent\(\)\) return staleCoachRegistration\(\)/,
    "[AUTH-COACH-01.registration.owner-whole-lifecycle] registerCoach exige owner vigente desde el inicio",
  );
  assert.match(controller, /owner\.bindExpectedUserId\(identity\.userId\)/);
  assert.match(
    controller,
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
  assert.match(gateway, /p_expected_user_id: expectedUserId[\s\S]*p_first_name:[\s\S]*p_professional_title:/);
  assert.match(gateway, /persistSession: false,[\s\S]*autoRefreshToken: false,[\s\S]*detectSessionInUrl: false/);
  assert.match(
    gateway,
    /const isolatedClient = getRegistrationClient\(\);[\s\S]*isolatedClient\.auth\.signInWithPassword/,
    "[AUTH-COACH-01.registration.isolated-sign-in] credenciales A no mutan la sesión global",
  );
  assert.match(
    gateway,
    /async signOut\(reason, owner\) \{\n      if \(!owner\.isCurrent\(\)\) return "stale";/,
    "[AUTH-COACH-01.gateway.signout-owner-guard] gateway rechaza owner stale antes de efectos",
  );
  assert.match(
    gateway,
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
    /event === "SIGNED_OUT"[\s\S]*portalResolutionOwnersRef\.current\.invalidate\(\);[\s\S]*coachRegistrationOwnersRef\.current\.invalidate\(\)/,
    "[AUTH-COACH-01.hook.signed-out-invalidation] SIGNED_OUT invalida antes de continuar",
  );
  assert.match(
    hook,
    /const replacedIdentity = portalResolutionOwnersRef\.current\.acceptIdentity\(currentUserId\);/,
    "[AUTH-COACH-01.hook.identity-change-invalidation] acepta B mediante el owner controller",
  );
  assert.match(hook, /beginPortalResolution\(expectedUserId: string\)/);
  assert.match(hook, /\{ requestedPortal, expectedUserId, owner \}/);
  assert.match(hook, /beginCoachRegistrationSubmit\(\)[\s\S]*coachRegistrationOwnersRef\.current\.begin\(\)/);
  assert.match(hook, /registerCoach\(payload, owner, createGateway\(supabase\)\)/);
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
    /const access = await multiportalAuth\.resolvePortalAccess[\s\S]*if \(access\.state === "stale" \|\| !multiportalAuth\.isPortalResolutionCurrent\(resolutionOwner\)\) \{[\s\S]*return null;[\s\S]*if \(access\.state === "coach_registration_required"/,
    "[AUTH-COACH-01.root.stale-before-publication] descarta stale antes de mensajes o estado",
  );
  assert.match(
    root,
    /resolveSessionEventDecision\(\s*event,\s*session\?\.user\.id \?\? null,\s*interactiveAuthAttemptRef\.current/,
  );
  assert.match(
    root,
    /const resolutionOwner = multiportalAuth\.beginPortalResolution\(session!\.user\.id\);\n        queueMicrotask\(/,
    "[AUTH-COACH-01.root.no-timeout-authorization] autorización Auth se difiere sin timeout",
  );
  assert.match(root, /event === "SIGNED_OUT"[\s\S]*interactiveAuthAttemptRef\.current = false/);
  assert.match(root, /case "coach_authorized":[\s\S]*return continueAuthenticatedSession/);
  assert.match(root, /consumePortalSignOutMessage\(\)/);
  assert.match(root, /settlePortalSignOutMessage\(access\.message\)/);
  assert.match(root, /invalidateCoachRegistrationSubmits\(\)[\s\S]*supabase\.auth\.signInWithPassword/);
  assert.match(root, /registration\.state === "busy" \|\| registration\.state === "stale"/);
  assert.doesNotMatch(root, /\.from\("coach_registrations"\)/);

  assert.match(screen, /action=\{onSubmit\}/);
  assert.match(screen, /disabled=\{isBusy\}/);
  assert.doesNotMatch(screen, /COACH_REGISTRATION_SUBMIT_ENABLED|isCoachRegistration \? undefined : onSubmit/);
}

function replaceExactlyOnce(source: string, target: string, replacement: string, name: string) {
  assert.equal(source.split(target).length - 1, 1, `${name}: target único`);
  return source.replace(target, replacement);
}

const semanticPositiveControls = [
  {
    name: "controller acepta un nombre local inocente para la evidencia backend",
    file: "controller" as const,
    apply(source: string) {
      const renamedDeclaration = replaceExactlyOnce(
        source,
        "    const hasCoachRegistration = await gateway.hasCoachRegistration(identity.userId, input.owner);",
        "    const backendEvidence = await gateway.hasCoachRegistration(identity.userId, input.owner);",
        "control positivo controller: declaración",
      );
      return replaceExactlyOnce(
        renamedDeclaration,
        "    if (hasCoachRegistration) {",
        "    if (backendEvidence) {",
        "control positivo controller: condición",
      );
    },
  },
  {
    name: "controller acepta reformateo multilinea del lookup autoritativo",
    file: "controller" as const,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "    const hasCoachRegistration = await gateway.hasCoachRegistration(identity.userId, input.owner);",
      `    const hasCoachRegistration = await gateway.hasCoachRegistration(
      identity.userId,
      input.owner,
    );`,
      "control positivo controller: reformateo",
    ),
  },
  {
    name: "gateway acepta nombre y formato inocentes para la evidencia SELECT",
    file: "gateway" as const,
    apply: (source: string) => replaceExactlyOnce(
      source,
      "      const row = await readOwnCoachRegistration(dataClientFor(expectedUserId), expectedUserId, owner);\n      return row !== null;",
      `      const registrationEvidence = await readOwnCoachRegistration(
        dataClientFor(expectedUserId),
        expectedUserId,
        owner,
      );
      return registrationEvidence !== null;`,
      "control positivo gateway: nombre y reformateo",
    ),
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
    name: "accountType concede Coach sin fila",
    file: "controller" as const,
    path: CONTROLLER_PATH,
    expectedFailure: "[AUTH-COACH-01.controller.authoritative-coach-row]",
    apply: (source: string) => replaceExactlyOnce(
      source,
      "if (hasCoachRegistration) {",
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
      '      if (!owner.isCurrent()) return "stale";',
      '      if (false) return "stale";',
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
      "      const identity = await getAuthoritativeIdentity(supabase, owner.expectedUserId, owner);",
      "      const identity = { userId: owner.expectedUserId };",
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
      "      portalResolutionOwnersRef.current.invalidate();",
      "      void portalResolutionOwnersRef.current;",
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
      "if (registration.userId !== identity.userId) {",
      "if (false) {",
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
      "      const isolatedClient = getRegistrationClient();\n      const { data, error } = await isolatedClient.auth.signInWithPassword({",
      "      const isolatedClient = getRegistrationClient();\n      const { data, error } = await supabase.auth.signInWithPassword({",
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
      "      coachRegistrationOwnersRef.current.invalidate();",
      "      void coachRegistrationOwnersRef.current;",
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
      "      const row = await readOwnCoachRegistration(dataClientFor(expectedUserId), expectedUserId, owner);\n      return row !== null;",
      "      if (owner) return true;\n      const row = await readOwnCoachRegistration(dataClientFor(expectedUserId), expectedUserId, owner);\n      return row !== null;",
      "E9 · gateway retorna true sin SELECT",
    ),
  },
] as const;

const EXPECTED_INTEGRATION_MUTATION_PROBE_COUNT = 19;
const EXPECTED_RUNTIME_MUTATION_PROBE_COUNT = 4;
const EXPECTED_AUTH_SUITE_MUTATION_PROBE_COUNT = 3;
const EXPECTED_E7_E9_SEMANTIC_MUTATION_PROBE_COUNT = 3;

assert.equal(mutations.length, EXPECTED_INTEGRATION_MUTATION_PROBE_COUNT);
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
  "la barrera runtime E7-E9 ejecuta toda la suite Auth no recursiva",
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
    const firstSecurityFailure = output.match(/\[AUTH-COACH-01\.E[789][^\]]*\]/)?.[0] ?? null;
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
          (error: unknown) => (
            error instanceof assert.AssertionError
            && error.message.includes(mutation.expectedFailure)
          ),
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
  `AUTH-COACH-01 integration mutation probes: ${mutations.length}/${EXPECTED_INTEGRATION_MUTATION_PROBE_COUNT}; runtime: ${EXPECTED_RUNTIME_MUTATION_PROBE_COUNT}/${EXPECTED_RUNTIME_MUTATION_PROBE_COUNT}; Auth suite E7-E9: ${EXPECTED_AUTH_SUITE_MUTATION_PROBE_COUNT}/${EXPECTED_AUTH_SUITE_MUTATION_PROBE_COUNT}`,
);
