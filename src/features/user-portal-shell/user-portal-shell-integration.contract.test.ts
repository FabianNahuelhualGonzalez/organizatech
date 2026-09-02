import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

export const POST_PERF_06_MIGRATION_OWNERSHIP = {
  "20260826213606_calendar_reminders_shared_portal.sql": "738fd557683411eb30a2fcdeb7ab97c59899e953dbd9929e206f9af00898120e",
} as const;

const BASE_SHA = "8b98ac9774fd7512191551234ebf4ee61fe36181";

const paths = {
  root: "src/components/organizatech-app.tsx",
  authBoundary: "src/features/auth/hooks/use-multiportal-auth-boundary.ts",
  authProof: "src/features/auth/model/user-portal-authorization-proof.ts",
  sessionRevalidation: "src/features/auth/model/user-portal-session-revalidation.ts",
  model: "src/features/user-portal-shell/model/user-portal-navigation.ts",
  logoutSingleFlight: "src/features/user-portal-shell/model/user-portal-logout-single-flight.ts",
  shell: "src/features/user-portal-shell/components/user-portal-shell.tsx",
  topbar: "src/features/user-portal-shell/components/user-portal-topbar.tsx",
  drawer: "src/features/user-portal-shell/components/user-portal-drawer.tsx",
  focusManager: "src/ui/overlays/use-overlay-focus-management.ts",
  css: "src/features/user-portal-shell/components/user-portal-shell.module.css",
  appShellState: "src/features/app-shell/model/app-shell-controller-state.ts",
  package: "package.json",
} as const;

type SourceKey = keyof typeof paths;
type Sources = Record<SourceKey, string>;

const EXPECTED_MAPPING = {
  profile: "perfil",
  dashboard: "dashboard",
  training: "entrenamiento",
  comparison: "comparacion",
  "edit-cycle": "registro-entrenamiento",
  "cycle-history": "historial-ciclos",
  calendar: "calendario",
};

const EXPECTED_IDS = [
  "profile",
  "dashboard",
  "training",
  "comparison",
  "edit-cycle",
  "cycle-history",
  "calendar",
  "logout",
];

const EXPECTED_LABELS = [
  "Mi perfil",
  "Panel principal",
  "Entrenemos",
  "Comparación semanal",
  "Modificar ciclo de entrenamiento",
  "Historial ciclo de entrenamiento",
  "Calendario",
  "Cerrar sesión",
];

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function readSources(base = "."): Sources {
  return Object.fromEntries(
    Object.entries(paths).map(([key, path]) => [key, readFileSync(join(base, path), "utf8")]),
  ) as Sources;
}

function parseSource(path: string, source: string) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  ) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
  assert.equal(
    sourceFile.parseDiagnostics.length,
    0,
    `[UI-NAV-01.syntax] ${path} debe conservar TypeScript válido`,
  );
  return sourceFile;
}

function assertValidMutatedSource(path: string, source: string) {
  if (path === "package.json") {
    assert.doesNotThrow(() => JSON.parse(source), "[UI-NAV-01.syntax] package.json válido");
    return;
  }
  if (/\.tsx?$/.test(path)) parseSource(path, source);
}

function compact(value: string) {
  return value.replace(/\s+/g, "").replace(/'/g, '"');
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression)
    || ts.isSatisfiesExpression(expression)
    || ts.isParenthesizedExpression(expression)
  ) return unwrapExpression(expression.expression);
  return expression;
}

function moduleSpecifiers(path: string, source: string): string[] {
  const sourceFile = parseSource(path, source);
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) result.push(node.moduleSpecifier.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function findNamedFunction(path: string, source: string, name: string) {
  const sourceFile = parseSource(path, source);
  const matches: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(matches.length, 1, `[UI-NAV-01.structure] ${name} debe ser único`);
  return { sourceFile, declaration: matches[0] };
}

function findJsxElements(path: string, source: string, tagName: string) {
  const sourceFile = parseSource(path, source);
  const matches: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(sourceFile) === tagName
    ) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, matches };
}

function countCalls(node: ts.Node, sourceFile: ts.SourceFile, callee: string) {
  let count = 0;
  const visit = (current: ts.Node) => {
    if (
      ts.isCallExpression(current)
      && compact(current.expression.getText(sourceFile)) === compact(callee)
    ) count += 1;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return count;
}

function findCalls(node: ts.Node, predicate: (call: ts.CallExpression) => boolean) {
  const calls: ts.CallExpression[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current) && predicate(current)) calls.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return calls;
}

function findVariableInitializer(path: string, source: string, name: string) {
  const sourceFile = parseSource(path, source);
  const matches: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) matches.push(unwrapExpression(node.initializer));
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.equal(matches.length, 1, `[UI-NAV-01.structure] ${name} debe existir una vez`);
  return { sourceFile, initializer: matches[0] };
}

function propertyName(property: ts.ObjectLiteralElementLike, sourceFile: ts.SourceFile) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) return property.name.text;
  return property.name.getText(sourceFile);
}

function objectPropertyExpression(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  name: string,
) {
  const matches = object.properties.filter((property) => propertyName(property, sourceFile) === name);
  assert.equal(matches.length, 1, `[UI-NAV-01.structure] propiedad ${name} única`);
  const property = matches[0];
  if (ts.isShorthandPropertyAssignment(property)) return property.name as ts.Expression;
  assert.ok(ts.isPropertyAssignment(property), `[UI-NAV-01.structure] ${name} debe tener valor explícito`);
  return unwrapExpression(property.initializer);
}

function jsxAttribute(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
  name: string,
) {
  const matches = opening.attributes.properties.filter((property) => (
    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name
  ));
  assert.equal(matches.length, 1, `[UI-NAV-01.structure] atributo ${name} único`);
  return matches[0] as ts.JsxAttribute;
}

function optionalJsxAttribute(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
  name: string,
) {
  const matches = opening.attributes.properties.filter((property) => (
    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name
  ));
  assert.ok(matches.length <= 1, `[UI-NAV-01.structure] atributo ${name} no se duplica`);
  return matches[0] as ts.JsxAttribute | undefined;
}

function jsxAttributeValue(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
  name: string,
) {
  const attribute = jsxAttribute(opening, sourceFile, name);
  if (!attribute.initializer) return "true";
  if (ts.isStringLiteral(attribute.initializer)) return JSON.stringify(attribute.initializer.text);
  if (!ts.isJsxExpression(attribute.initializer)) {
    return compact(attribute.initializer.getText(sourceFile));
  }
  return attribute.initializer.expression
    ? compact(attribute.initializer.expression.getText(sourceFile))
    : "null";
}

function readNavigationItems(source: string) {
  const { sourceFile, initializer } = findVariableInitializer(
    paths.model,
    source,
    "USER_PORTAL_NAVIGATION_ITEMS",
  );
  assert.ok(ts.isArrayLiteralExpression(initializer), "[UI-NAV-01.navigation-items] menú explícito");
  return initializer.elements.map((element) => {
    const value = unwrapExpression(element as ts.Expression);
    assert.ok(ts.isObjectLiteralExpression(value), "[UI-NAV-01.navigation-items] ítem explícito");
    const readString = (name: string) => {
      const expression = objectPropertyExpression(value, sourceFile, name);
      return ts.isStringLiteralLike(expression) ? expression.text : null;
    };
    return {
      id: readString("id"),
      label: readString("label"),
      kind: readString("kind"),
      availability: readString("availability"),
    };
  });
}

function readDestinationMapping(source: string) {
  const { sourceFile, initializer } = findVariableInitializer(
    paths.model,
    source,
    "USER_PORTAL_DESTINATION_SCREENS",
  );
  assert.ok(ts.isObjectLiteralExpression(initializer), "[UI-NAV-01.navigation-map] mapping explícito");
  return Object.fromEntries(initializer.properties.map((property) => {
    assert.ok(ts.isPropertyAssignment(property), "[UI-NAV-01.navigation-map] propiedad explícita");
    const value = unwrapExpression(property.initializer);
    assert.ok(ts.isStringLiteralLike(value), "[UI-NAV-01.navigation-map] Screen literal");
    return [propertyName(property, sourceFile), value.text];
  }));
}

function replaceExactlyOnce(source: string, find: string, replacement: string, name: string) {
  assert.equal(source.split(find).length - 1, 1, `${name}: seam de mutación único`);
  return source.replace(find, replacement);
}

function jsxRootTag(expression: ts.Expression, sourceFile: ts.SourceFile): string | null {
  const candidate = unwrapExpression(expression);
  if (ts.isJsxElement(candidate)) return candidate.openingElement.tagName.getText(sourceFile);
  if (ts.isJsxSelfClosingElement(candidate)) return candidate.tagName.getText(sourceFile);
  if (ts.isJsxFragment(candidate)) return "Fragment";
  return null;
}

function assertExclusiveShellReturns(source: string) {
  const { sourceFile, declaration } = findNamedFunction(paths.root, source, "OrganizatechApp");
  assert.ok(declaration.body, "[UI-NAV-01.single-shell] OrganizatechApp tiene cuerpo");
  const guardedBranches = declaration.body.statements.filter((statement): statement is ts.IfStatement => (
    ts.isIfStatement(statement)
    && ts.isIdentifier(unwrapExpression(statement.expression))
    && (unwrapExpression(statement.expression) as ts.Identifier).text === "useUserPortalShell"
  ));
  assert.equal(guardedBranches.length, 1, "[UI-NAV-01.single-shell] branch Usuario único y explícito");
  const branchBody = guardedBranches[0].thenStatement;
  assert.ok(ts.isBlock(branchBody), "[UI-NAV-01.single-shell] branch Usuario debe ser bloque");
  assert.equal(branchBody.statements.length, 1, "[UI-NAV-01.single-shell] branch Usuario sólo retorna el shell");
  const shellReturn = branchBody.statements[0];
  assert.ok(
    ts.isReturnStatement(shellReturn)
    && shellReturn.expression
    && jsxRootTag(shellReturn.expression, sourceFile) === "UserPortalShell",
    "[UI-NAV-01.single-shell] branch Usuario retorna exclusivamente UserPortalShell",
  );

  const directReturns = declaration.body.statements.filter((statement): statement is ts.ReturnStatement => (
    ts.isReturnStatement(statement)
  ));
  assert.equal(directReturns.length, 1, "[UI-NAV-01.legacy-exclusive] fallback legacy directo único");
  assert.ok(
    directReturns[0].expression
    && jsxRootTag(directReturns[0].expression, sourceFile) === "AppShellLayout",
    "[UI-NAV-01.legacy-exclusive] fallback final retorna exclusivamente AppShellLayout",
  );
  assert.ok(
    guardedBranches[0].pos < directReturns[0].pos,
    "[UI-NAV-01.legacy-exclusive] Usuario retorna antes del fallback legacy",
  );

  assert.equal(
    findJsxElements(paths.root, source, "UserPortalShell").matches.length,
    1,
    "[UI-NAV-01.single-shell] UserPortalShell se monta una sola vez",
  );
  assert.equal(
    findJsxElements(paths.root, source, "AppShellLayout").matches.length,
    1,
    "[UI-NAV-01.legacy-exclusive] AppShellLayout existe sólo como fallback",
  );
}

const AUTHORIZATION_PROOF_WIRING_BARRIER = "[UI-NAV-01.authorization-proof-wiring]";
const SILENT_REVALIDATION_POLICY_BARRIER = "[UI-NAV-01S.same-identity-policy]";
const SILENT_REVALIDATION_WIRING_BARRIER = "[UI-NAV-01S.silent-wiring]";
const SILENT_REVALIDATION_INVALIDATION_BARRIER = "[UI-NAV-01S.immediate-invalidation]";
const SILENT_REVALIDATION_RESULT_BARRIER = "[UI-NAV-01S.authoritative-result]";
const SILENT_REVALIDATION_RETRYABLE_BARRIER = "[UI-NAV-01S.retryable-continuity]";
const SILENT_REVALIDATION_VISUAL_BARRIER = "[UI-NAV-01S.visual-continuity]";
const SILENT_REVALIDATION_STALE_BARRIER = "[UI-NAV-01S.stale-callback]";
const SILENT_REVALIDATION_TOKEN_BARRIER = "[UI-NAV-01S.token-refresh-continuity]";
const TOKEN_REFRESHED_REACHABILITY_BARRIER =
  "[UI-NAV-01S.token-refresh-authoritative-reachability]";

function flattenLogicalAnd(expression: ts.Expression): ts.Expression[] {
  const candidate = unwrapExpression(expression);
  if (
    ts.isBinaryExpression(candidate)
    && candidate.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return [
      ...flattenLogicalAnd(candidate.left),
      ...flattenLogicalAnd(candidate.right),
    ];
  }
  return [candidate];
}

function flattenLogicalOr(expression: ts.Expression): ts.Expression[] {
  const candidate = unwrapExpression(expression);
  if (
    ts.isBinaryExpression(candidate)
    && candidate.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return [
      ...flattenLogicalOr(candidate.left),
      ...flattenLogicalOr(candidate.right),
    ];
  }
  return [candidate];
}

function isIdentifierExpression(expression: ts.Expression, name: string) {
  const candidate = unwrapExpression(expression);
  return ts.isIdentifier(candidate) && candidate.text === name;
}

function isCallWithIdentifier(
  expression: ts.Expression,
  callee: string,
  argumentNames: readonly string[],
) {
  const candidate = unwrapExpression(expression);
  if (!ts.isCallExpression(candidate)) return false;
  const callTarget = unwrapExpression(candidate.expression);
  return ts.isIdentifier(callTarget)
    && callTarget.text === callee
    && candidate.arguments.length === argumentNames.length
    && candidate.arguments.every((argument, index) => (
      isIdentifierExpression(argument, argumentNames[index])
    ));
}

function findOrganizatechApp(
  sourceFile: ts.SourceFile,
  barrier: string,
) {
  const roots = sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === "OrganizatechApp"
  ));
  assert.equal(roots.length, 1, `${barrier} OrganizatechApp debe ser único`);
  assert.ok(roots[0].body, `${barrier} OrganizatechApp debe conservar cuerpo`);
  return roots[0] as ts.FunctionDeclaration & { body: ts.Block };
}

function findAuthorizationProofDeclaration(
  sourceFile: ts.SourceFile,
  root: ts.FunctionDeclaration & { body: ts.Block },
) {
  const matches: Array<{
    declaration: ts.VariableDeclaration;
    declarationList: ts.VariableDeclarationList;
  }> = [];
  for (const statement of root.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name)
        && declaration.name.text === "hasCurrentUserPortalAuthorizationProof"
      ) matches.push({ declaration, declarationList: statement.declarationList });
    }
  }
  assert.equal(
    matches.length,
    1,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} declaración real única dentro de OrganizatechApp`,
  );
  return matches[0];
}

function readAccessPath(expression: ts.Expression): {
  readonly segments: readonly string[];
  readonly hasOptionalAccess: boolean;
} | null {
  const candidate = unwrapExpression(expression);
  if (ts.isIdentifier(candidate)) {
    return { segments: [candidate.text], hasOptionalAccess: false };
  }
  if (!ts.isPropertyAccessExpression(candidate)) return null;
  const parentPath = readAccessPath(candidate.expression);
  if (!parentPath) return null;
  return {
    segments: [...parentPath.segments, candidate.name.text],
    hasOptionalAccess: parentPath.hasOptionalAccess || Boolean(candidate.questionDotToken),
  };
}

function bindingNameContains(bindingName: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(bindingName)) return bindingName.text === name;
  return bindingName.elements.some((element) => (
    ts.isBindingElement(element) && bindingNameContains(element.name, name)
  ));
}

function findUnprovenFallbackGate(source: string) {
  const sourceFile = parseSource(paths.root, source);
  const root = findOrganizatechApp(sourceFile, "[UI-NAV-01.unproven-fallback]");
  const candidates = root.body.statements.filter((statement): statement is ts.IfStatement => {
    if (!ts.isIfStatement(statement)) return false;
    const terms = flattenLogicalAnd(statement.expression);
    return terms.some((term) => isIdentifierExpression(term, "hasSupabaseSession"))
      && terms.some((term) => isCallWithIdentifier(
        term,
        "isUserPortalRenderableScreen",
        ["screen"],
      ));
  });
  assert.equal(
    candidates.length,
    1,
    "[UI-NAV-01.unproven-fallback] gate de sesión no probada único",
  );
  const gate = candidates[0];
  const terms = flattenLogicalAnd(gate.expression);
  assert.equal(
    terms.length,
    3,
    "[UI-NAV-01.unproven-fallback] gate cerrado sin fallbacks adicionales",
  );
  const proofTerms = terms.filter((term) => {
    const candidate = unwrapExpression(term);
    return ts.isPrefixUnaryExpression(candidate)
      && candidate.operator === ts.SyntaxKind.ExclamationToken
      && isIdentifierExpression(candidate.operand, "hasCurrentUserPortalAuthorizationProof");
  });
  assert.equal(
    proofTerms.length,
    1,
    "[UI-NAV-01.unproven-fallback] sesión productiva exige ausencia de prueba actual",
  );

  const renderedTags: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      renderedTags.push(node.tagName.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(gate.thenStatement);
  assert.equal(
    renderedTags.filter((tag) => tag === "AuthLoadingScreen").length,
    1,
    "[UI-NAV-01.unproven-fallback] gate bloquea con AuthLoadingScreen",
  );
  assert.equal(
    renderedTags.some((tag) => tag === "UserPortalShell" || tag === "AppShellLayout"),
    false,
    "[UI-NAV-01.unproven-fallback] gate no monta shells productivos",
  );
  return { sourceFile, root, gate };
}

function assertAuthorizationProofWiring(source: string) {
  const sourceFile = parseSource(paths.root, source);
  const authoritativeImports = sourceFile.statements.filter((statement): statement is ts.ImportDeclaration => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteralLike(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === "@/features/auth/model/user-portal-authorization-proof"
  ));
  assert.equal(
    authoritativeImports.length,
    1,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} módulo autoritativo importado una vez`,
  );
  const namedBindings = authoritativeImports[0].importClause?.namedBindings;
  assert.ok(
    namedBindings && ts.isNamedImports(namedBindings),
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} helper importado por nombre`,
  );
  const helperImports = namedBindings.elements.filter((element) => (
    (element.propertyName?.text ?? element.name.text) === "hasCurrentUserPortalAuthorization"
    && element.name.text === "hasCurrentUserPortalAuthorization"
  ));
  assert.equal(
    helperImports.length,
    1,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} usa el helper autoritativo sin alias`,
  );

  const root = findOrganizatechApp(sourceFile, AUTHORIZATION_PROOF_WIRING_BARRIER);
  const helperShadowBindings = [
    ...root.parameters.filter((parameter) => (
      bindingNameContains(parameter.name, "hasCurrentUserPortalAuthorization")
    )),
    ...root.body.statements.filter((statement) => {
      if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.some((declaration) => (
          bindingNameContains(declaration.name, "hasCurrentUserPortalAuthorization")
        ));
      }
      return (
        ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement)
      ) && statement.name?.text === "hasCurrentUserPortalAuthorization";
    }),
  ];
  assert.equal(
    helperShadowBindings.length,
    0,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} el import autoritativo no puede ser sombreado`,
  );
  const { declaration, declarationList } = findAuthorizationProofDeclaration(sourceFile, root);
  assert.ok(
    (declarationList.flags & ts.NodeFlags.Const) !== 0,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} resultado calculado inmutable por render`,
  );
  assert.ok(
    declaration.initializer,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} declaración conserva inicializador`,
  );
  const initializer = unwrapExpression(declaration.initializer);
  assert.ok(
    ts.isCallExpression(initializer),
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} resultado deriva directamente del helper`,
  );
  const callTarget = unwrapExpression(initializer.expression);
  assert.ok(
    ts.isIdentifier(callTarget) && callTarget.text === "hasCurrentUserPortalAuthorization",
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} no acepta constante, autorreferencia ni fallback`,
  );
  assert.equal(
    initializer.arguments.length,
    1,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} helper recibe un input explícito`,
  );
  const input = unwrapExpression(initializer.arguments[0]);
  assert.ok(
    ts.isObjectLiteralExpression(input),
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} input autoritativo es objeto literal`,
  );
  assert.equal(
    input.properties.length,
    3,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} no acepta argumentos o spreads adicionales`,
  );

  const expectedProperties = ["authenticatedUserId", "authorizationProof", "sessionUserId"];
  const actualProperties = input.properties.map((property) => propertyName(property, sourceFile)).sort();
  assert.deepEqual(
    actualProperties,
    expectedProperties,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} argumentos autoritativos exactos`,
  );
  const readInput = (name: string) => {
    const properties = input.properties.filter((property) => propertyName(property, sourceFile) === name);
    assert.equal(
      properties.length,
      1,
      `${AUTHORIZATION_PROOF_WIRING_BARRIER} ${name} único`,
    );
    const property = properties[0];
    assert.ok(
      ts.isPropertyAssignment(property),
      `${AUTHORIZATION_PROOF_WIRING_BARRIER} ${name} tiene fuente explícita`,
    );
    return unwrapExpression(property.initializer);
  };

  assert.ok(
    isIdentifierExpression(readInput("authorizationProof"), "userPortalAuthorizationProof"),
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} recibe la prueba efímera Usuario real`,
  );
  const sessionPath = readAccessPath(readInput("sessionUserId"));
  assert.deepEqual(
    sessionPath?.segments,
    ["supabaseSession", "user", "id"],
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} compara la identidad efectiva de sesión`,
  );
  assert.equal(
    sessionPath?.hasOptionalAccess,
    true,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} sesión ausente falla cerrada`,
  );
  const authenticatedUserPath = readAccessPath(readInput("authenticatedUserId"));
  assert.deepEqual(
    authenticatedUserPath?.segments,
    ["supabaseUser", "id"],
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} compara el usuario autenticado efectivo`,
  );
  assert.equal(
    authenticatedUserPath?.hasOptionalAccess,
    true,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} usuario ausente falla cerrado`,
  );

  const proofReferences: ts.Identifier[] = [];
  const visitReferences = (node: ts.Node) => {
    if (
      ts.isIdentifier(node)
      && node.text === "hasCurrentUserPortalAuthorizationProof"
      && node !== declaration.name
    ) proofReferences.push(node);
    ts.forEachChild(node, visitReferences);
  };
  visitReferences(root.body);
  assert.equal(
    proofReferences.length,
    1,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} resultado se consume exactamente una vez`,
  );
  const proofGates = root.body.statements.filter((statement): statement is ts.IfStatement => {
    if (!ts.isIfStatement(statement)) return false;
    const gateReferences: ts.Identifier[] = [];
    const visitGate = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text === "hasCurrentUserPortalAuthorizationProof") {
        gateReferences.push(node);
      }
      ts.forEachChild(node, visitGate);
    };
    visitGate(statement.expression);
    return gateReferences.length === 1 && gateReferences[0] === proofReferences[0];
  });
  assert.equal(
    proofGates.length,
    1,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} gate consume exactamente el resultado calculado`,
  );
  const proofTerms = flattenLogicalAnd(proofGates[0].expression).filter((term) => {
    const candidate = unwrapExpression(term);
    return ts.isPrefixUnaryExpression(candidate)
      && candidate.operator === ts.SyntaxKind.ExclamationToken
      && candidate.operand === proofReferences[0];
  });
  assert.equal(
    proofTerms.length,
    1,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} gate falla cerrado sin la prueba actual`,
  );
}

function assertTokenRefreshedAuthoritativeReachability(sources: Sources) {
  const failure = (message: string) => (
    TOKEN_REFRESHED_REACHABILITY_BARRIER + " " + message
  );
  const decision = findNamedFunction(
    paths.authBoundary,
    sources.authBoundary,
    "resolveSessionEventDecision",
  );
  const decisionBody = decision.declaration.body;
  assert.ok(decisionBody, failure("decisión con cuerpo"));
  assert.equal(decision.declaration.parameters.length, 3, failure("señales del evento exactas"));
  const parameterNames = decision.declaration.parameters.map((parameter) => {
    assert.ok(ts.isIdentifier(parameter.name), failure("parámetros identificables"));
    return parameter.name.text;
  });
  const [eventName, currentUserIdName, interactiveAttemptName] = parameterNames;

  const exactTerms = (
    expression: ts.Expression,
    expected: readonly string[],
    flatten: (candidate: ts.Expression) => ts.Expression[],
  ) => {
    const actual = flatten(expression)
      .map((term) => compact(term.getText(decision.sourceFile)))
      .sort();
    const sortedExpected = [...expected].sort();
    return actual.length === sortedExpected.length
      && actual.every((term, index) => term === sortedExpected[index]);
  };
  const readSingleStringReturn = (
    statement: ts.Statement,
    expected: string,
    description: string,
  ) => {
    const statements = ts.isBlock(statement) ? [...statement.statements] : [statement];
    assert.equal(statements.length, 1, failure(description + " tiene salida única"));
    const candidate = statements[0];
    assert.ok(
      ts.isReturnStatement(candidate) && candidate.expression,
      failure(description + " retorna decisión"),
    );
    const expression = unwrapExpression(candidate.expression);
    assert.ok(ts.isStringLiteralLike(expression), failure(description + " retorna literal"));
    assert.equal(expression.text, expected, failure(description + " retorna " + expected));
    return candidate;
  };

  const directVariables = decisionBody.statements.flatMap((statement) => (
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []
  ));
  const expectedEvents = [
    eventName + '==="INITIAL_SESSION"',
    eventName + '==="SIGNED_IN"',
    eventName + '==="TOKEN_REFRESHED"',
  ].sort();
  const eventBindings = directVariables.filter((declaration) => {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return false;
    const terms = flattenLogicalOr(declaration.initializer)
      .map((term) => compact(term.getText(decision.sourceFile)))
      .sort();
    return terms.length === expectedEvents.length
      && terms.every((term, index) => term === expectedEvents[index]);
  });
  assert.equal(eventBindings.length, 1, failure("tres eventos comparten binding autoritativo"));
  const eventBinding = eventBindings[0];
  const eventBindingName = (eventBinding.name as ts.Identifier).text;
  const topLevelIfs = decisionBody.statements.filter(
    (statement): statement is ts.IfStatement => ts.isIfStatement(statement),
  );

  const recoveryBranches = topLevelIfs.filter((statement) => exactTerms(
    statement.expression,
    [eventName + '!=="SIGNED_OUT"', "isPasswordRecoveryPortalBlocked()"],
    flattenLogicalAnd,
  ));
  assert.equal(recoveryBranches.length, 1, failure("recovery bloquea salvo SIGNED_OUT"));
  readSingleStringReturn(recoveryBranches[0].thenStatement, "defer", "recovery");

  const acceptIdentityCalls = findCalls(decision.declaration, (call) => (
    compact(call.expression.getText(decision.sourceFile))
      === "portalResolutionOwnersRef.current.acceptIdentity"
  ));
  assert.equal(acceptIdentityCalls.length, 1, failure("acceptIdentity único"));
  assert.equal(
    compact(acceptIdentityCalls[0].arguments[0]?.getText(decision.sourceFile) ?? ""),
    currentUserIdName,
    failure("acceptIdentity usa identidad entrante"),
  );
  assert.ok(
    acceptIdentityCalls[0].pos < eventBinding.pos,
    failure("A→B invalida owners A antes de autorizar B"),
  );

  const continueBranches = topLevelIfs.filter((statement) => exactTerms(
    statement.expression,
    ["!" + currentUserIdName, "!" + eventBindingName],
    flattenLogicalOr,
  ));
  assert.equal(continueBranches.length, 1, failure("continue fail-closed único"));
  const continueReturn = readSingleStringReturn(
    continueBranches[0].thenStatement,
    "continue",
    "continue fail-closed",
  );
  const continueReturns: ts.ReturnStatement[] = [];
  const visitContinueReturns = (node: ts.Node) => {
    if (
      ts.isReturnStatement(node)
      && node.expression
      && ts.isStringLiteralLike(unwrapExpression(node.expression))
      && (unwrapExpression(node.expression) as ts.StringLiteralLike).text === "continue"
    ) continueReturns.push(node);
    ts.forEachChild(node, visitContinueReturns);
  };
  visitContinueReturns(decision.declaration);
  assert.deepEqual(continueReturns, [continueReturn], failure("TOKEN_REFRESHED no tiene bypass continue"));

  const pendingBranches = topLevelIfs.filter((statement) => exactTerms(
    statement.expression,
    [
      interactiveAttemptName,
      "initialResolutionPendingRef.current",
      "portalResolutionOwnersRef.current.hasPending()",
    ],
    flattenLogicalOr,
  ));
  assert.equal(pendingBranches.length, 1, failure("defer sólo por interacción o resolución pendiente"));
  readSingleStringReturn(pendingBranches[0].thenStatement, "defer", "resolución pendiente");

  const finalReturns = decisionBody.statements.filter(
    (statement): statement is ts.ReturnStatement => ts.isReturnStatement(statement),
  );
  assert.equal(finalReturns.length, 1, failure("salida autoritativa terminal única"));
  assert.ok(finalReturns[0].expression, failure("salida autoritativa explícita"));
  const authorizationDecision = unwrapExpression(finalReturns[0].expression);
  assert.ok(ts.isConditionalExpression(authorizationDecision), failure("separación Usuario/Coach"));
  assert.equal(
    compact(authorizationDecision.whenTrue.getText(decision.sourceFile)),
    '"authorize_coach"',
    failure("Coach conserva authorize_coach"),
  );
  assert.equal(
    compact(authorizationDecision.whenFalse.getText(decision.sourceFile)),
    '"authorize_user"',
    failure("Usuario alcanza authorize_user"),
  );

  const beginResolution = findNamedFunction(
    paths.authBoundary,
    sources.authBoundary,
    "beginPortalResolution",
  );
  const beginBody = beginResolution.declaration.body;
  assert.ok(beginBody, failure("beginPortalResolution con cuerpo"));
  const expectedUserIdParameter = beginResolution.declaration.parameters[0]?.name;
  assert.ok(
    expectedUserIdParameter && ts.isIdentifier(expectedUserIdParameter),
    failure("owner recibe identidad esperada"),
  );
  const expectedUserIdName = (expectedUserIdParameter as ts.Identifier).text;
  const ownerCalls = findCalls(beginResolution.declaration, (call) => (
    compact(call.expression.getText(beginResolution.sourceFile))
      === "portalResolutionOwnersRef.current.begin"
  ));
  assert.equal(ownerCalls.length, 1, failure("owner creado una vez"));
  assert.equal(
    compact(ownerCalls[0].arguments[0]?.getText(beginResolution.sourceFile) ?? ""),
    expectedUserIdName,
    failure("owner captura identidad esperada"),
  );
  assert.ok(
    ts.isVariableDeclaration(ownerCalls[0].parent) && ts.isIdentifier(ownerCalls[0].parent.name),
    failure("owner local identificable"),
  );
  const ownerName = (ownerCalls[0].parent as ts.VariableDeclaration & {
    name: ts.Identifier;
  }).name.text;
  const permitWrites = findCalls(beginResolution.declaration, (call) => (
    compact(call.expression.getText(beginResolution.sourceFile))
      === "passwordRecoveryMountPermitsRef.current.set"
  ));
  assert.equal(permitWrites.length, 1, failure("permit creado una vez"));
  assert.equal(
    compact(permitWrites[0].arguments[0]?.getText(beginResolution.sourceFile) ?? ""),
    ownerName,
    failure("permit pertenece al owner"),
  );
  const permitCapture = unwrapExpression(permitWrites[0].arguments[1]);
  assert.ok(
    ts.isCallExpression(permitCapture)
    && compact(permitCapture.expression.getText(beginResolution.sourceFile))
      === "passwordRecoveryPortalGuardRef.current!.capturePortalMountPermit",
    failure("permit captura recovery vigente"),
  );
  const ownerReturns = beginBody.statements.filter(
    (statement): statement is ts.ReturnStatement => ts.isReturnStatement(statement),
  );
  assert.equal(ownerReturns.length, 1, failure("owner retorna una vez"));
  assert.ok(ownerReturns[0].expression, failure("owner retornado"));
  assert.equal(
    compact(ownerReturns[0].expression.getText(beginResolution.sourceFile)),
    ownerName,
    failure("retorna owner con permit"),
  );
  assert.ok(
    ownerCalls[0].pos < permitWrites[0].pos && permitWrites[0].pos < ownerReturns[0].pos,
    failure("owner y permit existen antes de continuar"),
  );

  const rootSourceFile = parseSource(paths.root, sources.root);
  const root = findOrganizatechApp(rootSourceFile, TOKEN_REFRESHED_REACHABILITY_BARRIER);
  const listeners = findCalls(root, (call) => (
    compact(call.expression.getText(rootSourceFile)).endsWith(".onAuthStateChange")
  ));
  assert.equal(listeners.length, 1, failure("listener Auth único"));
  const listener = unwrapExpression(listeners[0].arguments[0]);
  assert.ok(
    ts.isArrowFunction(listener) || ts.isFunctionExpression(listener),
    failure("callback Auth identificable"),
  );
  const decisionCalls = findCalls(listener, (call) => (
    compact(call.expression.getText(rootSourceFile))
      === "multiportalAuth.resolveSessionEventDecision"
  ));
  assert.equal(decisionCalls.length, 1, failure("clasificación consumida una vez"));
  assert.deepEqual(
    decisionCalls[0].arguments.map((argument) => compact(argument.getText(rootSourceFile))),
    ["event", "session?.user.id??null", "interactiveAuthAttemptRef.current"],
    failure("clasificación usa evento, identidad e interacción reales"),
  );
  assert.ok(
    ts.isVariableDeclaration(decisionCalls[0].parent)
    && ts.isIdentifier(decisionCalls[0].parent.name),
    failure("decisión root identificable"),
  );
  const rootDecisionName = (decisionCalls[0].parent as ts.VariableDeclaration & {
    name: ts.Identifier;
  }).name.text;
  const policyCalls = findCalls(listener, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "resolveUserPortalSessionRevalidation"
  ));
  assert.equal(policyCalls.length, 1, failure("política silenciosa alcanzable"));
  let authorizationBranch: ts.Node | undefined = policyCalls[0].parent;
  while (
    authorizationBranch
    && !(
      ts.isIfStatement(authorizationBranch)
      && compact(authorizationBranch.expression.getText(rootSourceFile))
        .includes(rootDecisionName + '==="authorize_user"')
    )
  ) authorizationBranch = authorizationBranch.parent;
  assert.ok(
    authorizationBranch && ts.isIfStatement(authorizationBranch),
    failure("authorize_user alcanza política silenciosa"),
  );
  const policyDeclaration = policyCalls[0].parent;
  assert.ok(
    ts.isVariableDeclaration(policyDeclaration) && ts.isIdentifier(policyDeclaration.name),
    failure("decisión silenciosa identificable"),
  );
  const policyDecisionName = (policyDeclaration as ts.VariableDeclaration & {
    name: ts.Identifier;
  }).name.text;
  const beginCalls = findCalls(authorizationBranch.thenStatement, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "multiportalAuth.beginPortalResolution"
  ));
  assert.equal(beginCalls.length, 1, failure("owner root único"));
  assert.ok(
    ts.isVariableDeclaration(beginCalls[0].parent) && ts.isIdentifier(beginCalls[0].parent.name),
    failure("owner root identificable"),
  );
  const rootOwnerName = (beginCalls[0].parent as ts.VariableDeclaration & {
    name: ts.Identifier;
  }).name.text;
  const queueCalls = findCalls(authorizationBranch.thenStatement, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "queueMicrotask"
  ));
  assert.equal(queueCalls.length, 1, failure("continuación diferida única"));
  const authorizationCalls = findCalls(queueCalls[0], (call) => (
    compact(call.expression.getText(rootSourceFile)) === "authorizeAndContinuePortalSession"
  ));
  assert.equal(authorizationCalls.length, 1, failure("microtask alcanza autorización"));
  assert.equal(
    compact(authorizationCalls[0].arguments[3]?.getText(rootSourceFile) ?? ""),
    rootOwnerName,
    failure("continuación recibe owner vigente"),
  );
  assert.equal(
    compact(authorizationCalls[0].arguments[4]?.getText(rootSourceFile) ?? ""),
    policyDecisionName,
    failure("continuación recibe decisión silenciosa"),
  );
  assert.ok(
    decisionCalls[0].pos < policyCalls[0].pos
    && policyCalls[0].pos < beginCalls[0].pos
    && beginCalls[0].pos < queueCalls[0].pos,
    failure("orden clasificación→política→owner→continuación"),
  );

  const authorization = findNamedFunction(
    paths.root,
    sources.root,
    "authorizeAndContinuePortalSession",
  );
  const accessCalls = findCalls(authorization.declaration, (call) => (
    compact(call.expression.getText(authorization.sourceFile))
      === "multiportalAuth.resolvePortalAccess"
  ));
  assert.equal(accessCalls.length, 1, failure("resolvePortalAccess no se omite"));
  assert.ok(ts.isAwaitExpression(accessCalls[0].parent), failure("resolvePortalAccess se espera"));
}

function assertSilentSessionRevalidationBoundary(sources: Sources) {
  const policy = findNamedFunction(
    paths.sessionRevalidation,
    sources.sessionRevalidation,
    "resolveUserPortalSessionRevalidation",
  );
  assert.ok(policy.declaration.body, `${SILENT_REVALIDATION_POLICY_BARRIER} política con cuerpo`);
  assert.equal(
    policy.declaration.parameters.length,
    1,
    `${SILENT_REVALIDATION_POLICY_BARRIER} input único y explícito`,
  );
  const inputParameter = policy.declaration.parameters[0].name;
  assert.ok(
    ts.isIdentifier(inputParameter),
    `${SILENT_REVALIDATION_POLICY_BARRIER} input identificable`,
  );
  const inputName = inputParameter.text;
  const policyVariables = policy.declaration.body.statements.flatMap((statement) => (
    ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []
  ));
  const proofBindings = policyVariables.filter((declaration) => (
    ts.isIdentifier(declaration.name)
    && declaration.initializer
    && compact(declaration.initializer.getText(policy.sourceFile)) === `${inputName}.authorizationProof`
  ));
  assert.equal(
    proofBindings.length,
    1,
    `${SILENT_REVALIDATION_POLICY_BARRIER} prueba efímera leída una vez`,
  );
  const proofName = (proofBindings[0].name as ts.Identifier).text;

  const expectedEventTerms = [
    `${inputName}.event==="INITIAL_SESSION"`,
    `${inputName}.event==="SIGNED_IN"`,
    `${inputName}.event==="TOKEN_REFRESHED"`,
  ].sort();
  const eventBindings = policyVariables.filter((declaration) => {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return false;
    const terms = flattenLogicalOr(declaration.initializer)
      .map((term) => compact(term.getText(policy.sourceFile)))
      .sort();
    return terms.length === expectedEventTerms.length
      && terms.every((term, index) => term === expectedEventTerms[index]);
  });
  assert.equal(
    eventBindings.length,
    1,
    `${SILENT_REVALIDATION_POLICY_BARRIER} eventos redundantes exactos`,
  );
  const eventBindingName = (eventBindings[0].name as ts.Identifier).text;

  const policyIfs = policy.declaration.body.statements.filter((statement): statement is ts.IfStatement => (
    ts.isIfStatement(statement)
  ));
  assert.equal(
    policyIfs.length,
    1,
    `${SILENT_REVALIDATION_POLICY_BARRIER} rechazo fail-closed único`,
  );
  const rejectionTerms = flattenLogicalOr(policyIfs[0].expression);
  const helperTerms = rejectionTerms.filter((term) => {
    const candidate = unwrapExpression(term);
    if (
      !ts.isPrefixUnaryExpression(candidate)
      || candidate.operator !== ts.SyntaxKind.ExclamationToken
    ) return false;
    const operand = unwrapExpression(candidate.operand);
    return ts.isCallExpression(operand)
      && compact(operand.expression.getText(policy.sourceFile)) === "hasCurrentUserPortalAuthorization";
  });
  assert.equal(
    helperTerms.length,
    1,
    `${SILENT_REVALIDATION_POLICY_BARRIER} usa la capacidad autoritativa actual`,
  );
  const helperCall = unwrapExpression(
    (unwrapExpression(helperTerms[0]) as ts.PrefixUnaryExpression).operand,
  );
  assert.ok(ts.isCallExpression(helperCall), `${SILENT_REVALIDATION_POLICY_BARRIER} helper invocable`);
  assert.equal(
    helperCall.arguments.length,
    1,
    `${SILENT_REVALIDATION_POLICY_BARRIER} helper recibe identidad exacta`,
  );
  const helperInput = unwrapExpression(helperCall.arguments[0]);
  assert.ok(
    ts.isObjectLiteralExpression(helperInput),
    `${SILENT_REVALIDATION_POLICY_BARRIER} helper recibe objeto explícito`,
  );
  assert.equal(
    helperInput.properties.length,
    3,
    `${SILENT_REVALIDATION_POLICY_BARRIER} sin fuentes permisivas adicionales`,
  );
  assert.equal(
    compact(objectPropertyExpression(helperInput, policy.sourceFile, "authorizationProof").getText(policy.sourceFile)),
    proofName,
    `${SILENT_REVALIDATION_POLICY_BARRIER} valida la prueba real`,
  );
  assert.equal(
    compact(objectPropertyExpression(helperInput, policy.sourceFile, "sessionUserId").getText(policy.sourceFile)),
    `${inputName}.nextSessionUserId`,
    `${SILENT_REVALIDATION_POLICY_BARRIER} valida la sesión entrante`,
  );
  assert.equal(
    compact(objectPropertyExpression(helperInput, policy.sourceFile, "authenticatedUserId").getText(policy.sourceFile)),
    `${inputName}.nextAuthenticatedUserId`,
    `${SILENT_REVALIDATION_POLICY_BARRIER} valida el usuario efectivo entrante`,
  );

  const helperTermText = compact(helperTerms[0].getText(policy.sourceFile));
  const simpleTerms = rejectionTerms
    .map((term) => compact(term.getText(policy.sourceFile)))
    .filter((term) => term !== helperTermText)
    .sort();
  assert.deepEqual(simpleTerms, [
    `!${eventBindingName}`,
    `!${proofName}`,
    `${inputName}.hasCoachPortalSession`,
    `${inputName}.isInteractiveAuthAttempt`,
    `${inputName}.isLogoutInFlight`,
    `${inputName}.isPasswordRecoveryBlocked`,
    `${inputName}.requestedPortal!=="usuario"`,
  ].sort(), `${SILENT_REVALIDATION_POLICY_BARRIER} guards de seguridad exactos`);

  assert.equal(
    compact(policyIfs[0].thenStatement.getText(policy.sourceFile)),
    "returnFAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION;",
    `${SILENT_REVALIDATION_POLICY_BARRIER} cualquier fallo invalida`,
  );
  const finalReturns = policy.declaration.body.statements.filter((statement): statement is ts.ReturnStatement => (
    ts.isReturnStatement(statement)
  ));
  assert.equal(finalReturns.length, 1, `${SILENT_REVALIDATION_POLICY_BARRIER} éxito único`);
  assert.ok(finalReturns[0].expression, `${SILENT_REVALIDATION_POLICY_BARRIER} éxito explícito`);
  const silentReturn = unwrapExpression(finalReturns[0].expression);
  assert.ok(
    ts.isCallExpression(silentReturn)
    && compact(silentReturn.expression.getText(policy.sourceFile)) === "Object.freeze"
    && silentReturn.arguments.length === 1,
    `${SILENT_REVALIDATION_POLICY_BARRIER} decisión inmutable`,
  );
  const silentDecision = unwrapExpression(silentReturn.arguments[0]);
  assert.ok(
    ts.isObjectLiteralExpression(silentDecision),
    `${SILENT_REVALIDATION_POLICY_BARRIER} decisión explícita`,
  );
  assert.equal(
    compact(objectPropertyExpression(silentDecision, policy.sourceFile, "kind").getText(policy.sourceFile)),
    '"silent_revalidation"',
    `${SILENT_REVALIDATION_POLICY_BARRIER} resultado silencioso`,
  );
  assert.equal(
    compact(objectPropertyExpression(silentDecision, policy.sourceFile, "authorizationProof").getText(policy.sourceFile)),
    proofName,
    `${SILENT_REVALIDATION_POLICY_BARRIER} conserva exactamente la prueba vigente`,
  );

  const retryablePolicy = findNamedFunction(
    paths.sessionRevalidation,
    sources.sessionRevalidation,
    "shouldPreserveUserPortalAfterRetryableRevalidation",
  );
  assert.ok(retryablePolicy.declaration.body, `${SILENT_REVALIDATION_RETRYABLE_BARRIER} política con cuerpo`);
  const retryableIfs = retryablePolicy.declaration.body.statements.filter(
    (statement): statement is ts.IfStatement => ts.isIfStatement(statement),
  );
  assert.equal(retryableIfs.length, 1, `${SILENT_REVALIDATION_RETRYABLE_BARRIER} rechazo fail-closed único`);
  assert.deepEqual(
    flattenLogicalOr(retryableIfs[0].expression)
      .map((term) => compact(term.getText(retryablePolicy.sourceFile)))
      .sort(),
    [
      'input.access.state!=="error"',
      "input.access.retryable!==true",
      "!input.isResolutionCurrent",
      'input.sessionRevalidation.kind!=="silent_revalidation"',
      "input.sessionRevalidation.authorizationProof.userId!==input.expectedUserId",
      "input.expectedUserId!==input.nextSessionUserId",
      "input.expectedUserId!==input.nextAuthenticatedUserId",
    ].sort(),
    `${SILENT_REVALIDATION_RETRYABLE_BARRIER} exige error transitorio, owner e identidad exactos`,
  );
  assert.equal(
    compact(retryableIfs[0].thenStatement.getText(retryablePolicy.sourceFile)),
    "returnfalse;",
    `${SILENT_REVALIDATION_RETRYABLE_BARRIER} cualquier duda rechaza preservar`,
  );
  const retryableReturns = retryablePolicy.declaration.body.statements.filter(
    (statement): statement is ts.ReturnStatement => ts.isReturnStatement(statement),
  );
  assert.equal(retryableReturns.length, 1, `${SILENT_REVALIDATION_RETRYABLE_BARRIER} preservación única`);
  assert.ok(retryableReturns[0].expression, `${SILENT_REVALIDATION_RETRYABLE_BARRIER} preservación explícita`);
  const retryableProofCall = unwrapExpression(retryableReturns[0].expression);
  assert.ok(
    ts.isCallExpression(retryableProofCall)
    && compact(retryableProofCall.expression.getText(retryablePolicy.sourceFile))
      === "hasCurrentUserPortalAuthorization"
    && retryableProofCall.arguments.length === 1,
    `${SILENT_REVALIDATION_RETRYABLE_BARRIER} revalida la prueba vigente`,
  );
  const retryableProofInput = unwrapExpression(retryableProofCall.arguments[0]);
  assert.ok(ts.isObjectLiteralExpression(retryableProofInput), `${SILENT_REVALIDATION_RETRYABLE_BARRIER} identidad explícita`);
  assert.deepEqual(
    retryableProofInput.properties.map((property) => propertyName(property, retryablePolicy.sourceFile)).sort(),
    ["authenticatedUserId", "authorizationProof", "sessionUserId"],
    `${SILENT_REVALIDATION_RETRYABLE_BARRIER} sin fuentes permisivas`,
  );
  const expectedRetryableProofInput = {
    authorizationProof: "input.sessionRevalidation.authorizationProof",
    sessionUserId: "input.nextSessionUserId",
    authenticatedUserId: "input.nextAuthenticatedUserId",
  } as const;
  for (const [name, expected] of Object.entries(expectedRetryableProofInput)) {
    assert.equal(
      compact(objectPropertyExpression(retryableProofInput, retryablePolicy.sourceFile, name).getText(retryablePolicy.sourceFile)),
      expected,
      `${SILENT_REVALIDATION_RETRYABLE_BARRIER} ${name} validado`,
    );
  }
  assert.doesNotMatch(
    sources.sessionRevalidation,
    /localStorage|sessionStorage|cookie|document\.cookie|URLSearchParams|setTimeout|setInterval|hasSupabaseSession|metadata|email/i,
    `${SILENT_REVALIDATION_POLICY_BARRIER} sin persistencia, timers ni señales visuales`,
  );

  const rootSourceFile = parseSource(paths.root, sources.root);
  const root = findOrganizatechApp(rootSourceFile, SILENT_REVALIDATION_WIRING_BARRIER);
  const policyCalls = findCalls(root, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "resolveUserPortalSessionRevalidation"
  ));
  assert.equal(policyCalls.length, 1, `${SILENT_REVALIDATION_WIRING_BARRIER} decisión única`);
  const policyCall = policyCalls[0];
  assert.equal(policyCall.arguments.length, 1, `${SILENT_REVALIDATION_WIRING_BARRIER} input único`);
  const rootPolicyInput = unwrapExpression(policyCall.arguments[0]);
  assert.ok(
    ts.isObjectLiteralExpression(rootPolicyInput),
    `${SILENT_REVALIDATION_WIRING_BARRIER} wiring explícito`,
  );
  assert.deepEqual(
    rootPolicyInput.properties.map((property) => propertyName(property, rootSourceFile)).sort(),
    [
      "authorizationProof",
      "event",
      "hasCoachPortalSession",
      "isInteractiveAuthAttempt",
      "isLogoutInFlight",
      "isPasswordRecoveryBlocked",
      "nextAuthenticatedUserId",
      "nextSessionUserId",
      "requestedPortal",
    ],
    `${SILENT_REVALIDATION_WIRING_BARRIER} señales exactas`,
  );
  const expectedRootWiring = {
    event: "event",
    authorizationProof: "userPortalAuthorizationProofRef.current",
    nextSessionUserId: "nextState.session?.user.id",
    nextAuthenticatedUserId:
      "resolveEffectiveAuthenticatedUser(nextState.session,nextState.user)?.id",
    requestedPortal: "requestedPortal",
    isInteractiveAuthAttempt: "interactiveAuthAttemptRef.current",
    isPasswordRecoveryBlocked: "multiportalAuth.isPasswordRecoveryPortalBlocked()",
    isLogoutInFlight: "logoutInFlightRef.current",
    hasCoachPortalSession: "Boolean(coachPortalSessionRef.current)",
  } as const;
  for (const [name, expected] of Object.entries(expectedRootWiring)) {
    assert.equal(
      compact(objectPropertyExpression(rootPolicyInput, rootSourceFile, name).getText(rootSourceFile))
        .replace(/,\)/g, ")"),
      expected,
      `${SILENT_REVALIDATION_WIRING_BARRIER} ${name} usa su fuente real`,
    );
  }
  assert.ok(
    ts.isVariableDeclaration(policyCall.parent)
    && ts.isIdentifier(policyCall.parent.name),
    `${SILENT_REVALIDATION_WIRING_BARRIER} decisión local tipada`,
  );
  const decisionName = (policyCall.parent as ts.VariableDeclaration & { name: ts.Identifier }).name.text;
  const authorizationCalls = findCalls(root, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "authorizeAndContinuePortalSession"
  ));
  assert.equal(authorizationCalls.length, 3, `${SILENT_REVALIDATION_WIRING_BARRIER} superficies exactas`);
  const silentAuthorizationCalls = authorizationCalls.filter((call) => (
    call.arguments.length === 5
    && isIdentifierExpression(call.arguments[4], decisionName)
  ));
  assert.equal(
    silentAuthorizationCalls.length,
    1,
    `${SILENT_REVALIDATION_WIRING_BARRIER} evento consume la decisión exacta`,
  );
  const failClosedAuthorizationCalls = authorizationCalls.filter((call) => (
    call.arguments.length === 5
    && isIdentifierExpression(call.arguments[4], "FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION")
  ));
  assert.equal(
    failClosedAuthorizationCalls.length,
    2,
    `${SILENT_REVALIDATION_WIRING_BARRIER} bootstrap y login permanecen fail-closed`,
  );
  let queuedAncestor: ts.Node | undefined = silentAuthorizationCalls[0].parent;
  while (
    queuedAncestor
    && !(
      ts.isCallExpression(queuedAncestor)
      && compact(queuedAncestor.expression.getText(rootSourceFile)) === "queueMicrotask"
    )
  ) queuedAncestor = queuedAncestor.parent;
  assert.ok(queuedAncestor, `${SILENT_REVALIDATION_WIRING_BARRIER} revalidación difiere el I/O`);
  const synchronousProofWrites = findCalls(root, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "replaceUserPortalAuthorizationProof"
    && call.arguments.length === 1
    && compact(call.arguments[0].getText(rootSourceFile)) === `${decisionName}.authorizationProof`
  ));
  assert.equal(
    synchronousProofWrites.length,
    1,
    `${SILENT_REVALIDATION_INVALIDATION_BARRIER} aplica la decisión exactamente una vez antes del I/O`,
  );
  assert.ok(
    synchronousProofWrites[0].pos > policyCall.pos
    && synchronousProofWrites[0].pos < queuedAncestor.pos,
    `${SILENT_REVALIDATION_INVALIDATION_BARRIER} A→B, Coach o mismatch invalidan síncronamente`,
  );
  let authorizationBranch: ts.Node | undefined = policyCall.parent;
  while (
    authorizationBranch
    && !(
      ts.isIfStatement(authorizationBranch)
      && compact(authorizationBranch.expression.getText(rootSourceFile))
        .includes('portalEventDecision==="authorize_user"')
    )
  ) authorizationBranch = authorizationBranch.parent;
  assert.ok(
    authorizationBranch && ts.isIfStatement(authorizationBranch),
    `${SILENT_REVALIDATION_WIRING_BARRIER} decisión vive en el branch de autorización`,
  );
  const loadingCalls = findCalls(authorizationBranch.thenStatement, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "setIsAuthLoading"
  ));
  assert.equal(
    loadingCalls.filter((call) => compact(call.arguments[0]?.getText(rootSourceFile) ?? "") === "false").length,
    1,
    `${SILENT_REVALIDATION_VISUAL_BARRIER} revalidación nunca activa AuthLoadingScreen`,
  );
  assert.equal(
    loadingCalls.some((call) => compact(call.arguments[0]?.getText(rootSourceFile) ?? "") !== "false"),
    false,
    `${SILENT_REVALIDATION_VISUAL_BARRIER} branch sin loading permisivo`,
  );
  const authStateListeners = findCalls(root, (call) => (
    compact(call.expression.getText(rootSourceFile)).endsWith(".onAuthStateChange")
  ));
  assert.equal(authStateListeners.length, 1, `${SILENT_REVALIDATION_TOKEN_BARRIER} listener único`);
  const authStateListener = unwrapExpression(authStateListeners[0].arguments[0]);
  assert.ok(
    ts.isArrowFunction(authStateListener) || ts.isFunctionExpression(authStateListener),
    `${SILENT_REVALIDATION_TOKEN_BARRIER} callback identificable`,
  );
  const listenerProofWrites = findCalls(authStateListener, (call) => (
    compact(call.expression.getText(rootSourceFile)) === "replaceUserPortalAuthorizationProof"
  ));
  assert.equal(
    listenerProofWrites.length,
    1,
    `${SILENT_REVALIDATION_TOKEN_BARRIER} TOKEN_REFRESHED no tiene invalidación paralela`,
  );
  assert.equal(
    listenerProofWrites[0],
    synchronousProofWrites[0],
    `${SILENT_REVALIDATION_TOKEN_BARRIER} única escritura directa deriva de la política`,
  );
  assert.ok(
    sources.root.indexOf('if (portalEventDecision === "defer") return;')
      < policyCall.getStart(rootSourceFile),
    `${SILENT_REVALIDATION_WIRING_BARRIER} ráfagas pendientes no tocan la prueba`,
  );

  const authorization = findNamedFunction(
    paths.root,
    sources.root,
    "authorizeAndContinuePortalSession",
  );
  assert.match(
    compact(authorization.declaration.getText(authorization.sourceFile)),
    /if\(sessionRevalidation\.kind!=="silent_revalidation"\)setIsAuthLoading\(true\)/,
    `${SILENT_REVALIDATION_VISUAL_BARRIER} login/bootstrap muestran splash sin interrumpir TOKEN_REFRESHED`,
  );
  assert.equal(
    authorization.declaration.parameters.length,
    5,
    `${SILENT_REVALIDATION_WIRING_BARRIER} resolución recibe decisión explícita`,
  );
  const revalidationParameter = authorization.declaration.parameters[4].name;
  assert.ok(
    ts.isIdentifier(revalidationParameter),
    `${SILENT_REVALIDATION_WIRING_BARRIER} decisión identificable`,
  );
  const revalidationParameterName = revalidationParameter.text;
  assert.ok(authorization.declaration.body, `${SILENT_REVALIDATION_WIRING_BARRIER} resolución con cuerpo`);
  const authorizationProofWrites = findCalls(authorization.declaration, (call) => (
    compact(call.expression.getText(authorization.sourceFile)) === "replaceUserPortalAuthorizationProof"
  ));
  assert.equal(
    authorizationProofWrites.filter((call) => (
      compact(call.arguments[0]?.getText(authorization.sourceFile) ?? "")
        === `${revalidationParameterName}.authorizationProof`
    )).length,
    0,
    `${SILENT_REVALIDATION_STALE_BARRIER} el microtask no republica una decisión capturada`,
  );
  const authorizationIfs = authorization.declaration.body.statements.filter(
    (statement): statement is ts.IfStatement => ts.isIfStatement(statement),
  );
  const staleBranches = authorizationIfs.filter((statement) => (
    compact(statement.expression.getText(authorization.sourceFile)).includes('access.state==="stale"')
  ));
  assert.equal(staleBranches.length, 1, `${SILENT_REVALIDATION_STALE_BARRIER} branch stale único`);
  assert.equal(
    countCalls(staleBranches[0].thenStatement, authorization.sourceFile, "replaceUserPortalAuthorizationProof"),
    0,
    `${SILENT_REVALIDATION_STALE_BARRIER} callback stale no publica ni borra una decisión más nueva`,
  );
  const rejectedBranches = authorizationIfs.filter((statement) => {
    const expression = compact(statement.expression.getText(authorization.sourceFile));
    return expression.includes('access.state==="user_registration_required"')
      && expression.includes('access.state==="coach_registration_required"')
      && expression.includes('access.state==="error"');
  });
  assert.equal(rejectedBranches.length, 1, `${SILENT_REVALIDATION_RESULT_BARRIER} rechazo único`);
  const rejectedWrites = findCalls(rejectedBranches[0].thenStatement, (call) => (
    compact(call.expression.getText(authorization.sourceFile)) === "replaceUserPortalAuthorizationProof"
    && compact(call.arguments[0]?.getText(authorization.sourceFile) ?? "") === "null"
  ));
  assert.equal(
    rejectedWrites.length,
    1,
    `${SILENT_REVALIDATION_RESULT_BARRIER} resultado inválido limpia la prueba`,
  );
  const retryablePreservationCalls = findCalls(rejectedBranches[0].thenStatement, (call) => (
    compact(call.expression.getText(authorization.sourceFile))
      === "shouldPreserveUserPortalAfterRetryableRevalidation"
  ));
  assert.equal(retryablePreservationCalls.length, 1, `${SILENT_REVALIDATION_RETRYABLE_BARRIER} decisión única`);
  const retryablePreservationInput = unwrapExpression(retryablePreservationCalls[0].arguments[0]);
  assert.ok(ts.isObjectLiteralExpression(retryablePreservationInput), `${SILENT_REVALIDATION_RETRYABLE_BARRIER} wiring explícito`);
  const expectedRetryableWiring = {
    access: "access",
    sessionRevalidation: revalidationParameterName,
    expectedUserId: "resolutionOwner.expectedUserId",
    nextSessionUserId: "authState.session?.user.id",
    nextAuthenticatedUserId: "authState.user?.id",
    isResolutionCurrent: "multiportalAuth.isPortalResolutionCurrent(resolutionOwner)",
  } as const;
  assert.deepEqual(
    retryablePreservationInput.properties.map((property) => propertyName(property, authorization.sourceFile)).sort(),
    Object.keys(expectedRetryableWiring).sort(),
    `${SILENT_REVALIDATION_RETRYABLE_BARRIER} señales exactas`,
  );
  for (const [name, expected] of Object.entries(expectedRetryableWiring)) {
    assert.equal(
      compact(objectPropertyExpression(retryablePreservationInput, authorization.sourceFile, name).getText(authorization.sourceFile)),
      expected,
      `${SILENT_REVALIDATION_RETRYABLE_BARRIER} ${name} conectado`,
    );
  }
  const retryableBranches: ts.IfStatement[] = [];
  const visitRetryableBranches = (node: ts.Node) => {
    if (
      ts.isIfStatement(node)
      && compact(node.expression.getText(authorization.sourceFile)) === "preserveAuthorizedUserPortal"
    ) retryableBranches.push(node);
    ts.forEachChild(node, visitRetryableBranches);
  };
  visitRetryableBranches(rejectedBranches[0].thenStatement);
  assert.equal(retryableBranches.length, 1, `${SILENT_REVALIDATION_RETRYABLE_BARRIER} branch único`);
  assert.equal(
    compact(retryableBranches[0].thenStatement.getText(authorization.sourceFile)),
    "applySessionState(authState);",
    `${SILENT_REVALIDATION_RETRYABLE_BARRIER} mantiene renderizable la misma sesión`,
  );
  assert.ok(
    retryableBranches[0].elseStatement
    && compact(retryableBranches[0].elseStatement.getText(authorization.sourceFile))
      === "replaceUserPortalAuthorizationProof(null);",
    `${SILENT_REVALIDATION_RESULT_BARRIER} todo resultado no elegible limpia la prueba`,
  );

  const continuation = findNamedFunction(
    paths.root,
    sources.root,
    "continueAuthorizedPortalAccess",
  );
  assert.ok(continuation.declaration.body, `${SILENT_REVALIDATION_VISUAL_BARRIER} continuación con cuerpo`);
  const continuationParameter = continuation.declaration.parameters[4]?.name;
  assert.ok(
    continuationParameter && ts.isIdentifier(continuationParameter),
    `${SILENT_REVALIDATION_VISUAL_BARRIER} decisión llega a la publicación`,
  );
  const continuationParameterName = (continuationParameter as ts.Identifier).text;
  const silentBranches: ts.IfStatement[] = [];
  const visitSilentBranches = (node: ts.Node) => {
    if (
      ts.isIfStatement(node)
      && compact(node.expression.getText(continuation.sourceFile))
        === `${continuationParameterName}.kind==="silent_revalidation"`
    ) silentBranches.push(node);
    ts.forEachChild(node, visitSilentBranches);
  };
  visitSilentBranches(continuation.declaration);
  assert.equal(silentBranches.length, 1, `${SILENT_REVALIDATION_VISUAL_BARRIER} branch silencioso único`);
  const silentBranchCode = compact(silentBranches[0].thenStatement.getText(continuation.sourceFile));
  assert.equal(
    countCalls(silentBranches[0].thenStatement, continuation.sourceFile, "replaceUserPortalAuthorizationProof"),
    1,
    `${SILENT_REVALIDATION_RESULT_BARRIER} autorización válida renueva la prueba`,
  );
  assert.ok(
    silentBranchCode.includes("replaceUserPortalAuthorizationProof(authorizationProof)")
    && silentBranchCode.endsWith("return;}"),
    `${SILENT_REVALIDATION_RESULT_BARRIER} publica sólo la prueba autoritativa vigente`,
  );
  assert.doesNotMatch(
    silentBranchCode,
    /continueAuthenticatedSession|navigation|reset|transition|setIsAuthLoading|appShell|close|refresh|setScreen/,
    `${SILENT_REVALIDATION_VISUAL_BARRIER} no desmonta, navega, refresca ni cierra overlays`,
  );
  const staleCurrentBranches: ts.IfStatement[] = [];
  const visitCurrentBranches = (node: ts.Node) => {
    if (
      ts.isIfStatement(node)
      && compact(node.expression.getText(continuation.sourceFile)) === "!isAuthorizationCurrent()"
    ) staleCurrentBranches.push(node);
    ts.forEachChild(node, visitCurrentBranches);
  };
  visitCurrentBranches(continuation.declaration);
  assert.equal(staleCurrentBranches.length, 1, `${SILENT_REVALIDATION_STALE_BARRIER} guard owner único previo`);
  assert.equal(
    countCalls(staleCurrentBranches[0].thenStatement, continuation.sourceFile, "replaceUserPortalAuthorizationProof"),
    0,
    `${SILENT_REVALIDATION_STALE_BARRIER} owner stale no borra una prueba vigente más nueva`,
  );
}

function replaceAuthorizationProofInitializer(
  source: string,
  replacement: string | ((currentInitializer: string) => string),
) {
  const sourceFile = parseSource(paths.root, source);
  const root = findOrganizatechApp(sourceFile, AUTHORIZATION_PROOF_WIRING_BARRIER);
  const { declaration } = findAuthorizationProofDeclaration(sourceFile, root);
  assert.ok(
    declaration.initializer,
    `${AUTHORIZATION_PROOF_WIRING_BARRIER} seam de inicializador disponible`,
  );
  const currentInitializer = declaration.initializer.getText(sourceFile);
  const nextInitializer = typeof replacement === "function"
    ? replacement(currentInitializer)
    : replacement;
  return `${source.slice(0, declaration.initializer.getStart(sourceFile))}${nextInitializer}${source.slice(
    declaration.initializer.end,
  )}`;
}

function assertAuthorizationBoundary(sources: Sources) {
  const proofFactory = findNamedFunction(
    paths.authProof,
    sources.authProof,
    "createUserPortalAuthorizationProof",
  );
  const factoryCode = compact(proofFactory.declaration.getText(proofFactory.sourceFile));
  for (const guard of [
    'input.access.state!=="user_authorized"',
    "input.access.userId!==input.sessionUserId",
    "input.access.userId!==input.authenticatedUserId",
    "[USER_PORTAL_AUTHORIZATION_PROOF_BRAND]:true",
  ]) assert.ok(factoryCode.includes(guard), `[UI-NAV-01.proof-factory] falta ${guard}`);

  const currentAuthorization = findNamedFunction(
    paths.authProof,
    sources.authProof,
    "hasCurrentUserPortalAuthorization",
  );
  const currentAuthorizationCode = compact(
    currentAuthorization.declaration.getText(currentAuthorization.sourceFile),
  );
  for (const guard of [
    "proof[USER_PORTAL_AUTHORIZATION_PROOF_BRAND]===true",
    'proof.state==="user_authorized"',
    "proof.userId===input.sessionUserId",
    "proof.userId===input.authenticatedUserId",
  ]) assert.ok(currentAuthorizationCode.includes(guard), `[UI-NAV-01.mount-guard] falta ${guard}`);

  const mountGate = findNamedFunction(
    paths.authProof,
    sources.authProof,
    "shouldMountAuthorizedUserPortal",
  );
  const gateCode = compact(mountGate.declaration.getText(mountGate.sourceFile));
  for (const guard of [
    "hasCurrentUserPortalAuthorization(input)",
    "!input.hasCoachPortalSession",
    "!input.isAuthLoading",
    "!input.isPasswordRecoveryBlocked",
    "input.isRenderableScreen",
  ]) assert.ok(gateCode.includes(guard), `[UI-NAV-01.mount-guard] falta ${guard}`);

  const mount = findVariableInitializer(paths.root, sources.root, "useUserPortalShell");
  assert.ok(
    ts.isCallExpression(mount.initializer)
    && mount.initializer.expression.getText(mount.sourceFile) === "shouldMountAuthorizedUserPortal",
    "[UI-NAV-01.mount-wiring] root usa la barrera de autorización",
  );
  const mountInput = unwrapExpression(mount.initializer.arguments[0]);
  assert.ok(ts.isObjectLiteralExpression(mountInput), "[UI-NAV-01.mount-wiring] input explícito");
  const expectedWiring = {
    authorizationProof: "userPortalAuthorizationProof",
    sessionUserId: "supabaseSession?.user.id",
    authenticatedUserId: "supabaseUser?.id",
    hasCoachPortalSession: "Boolean(coachPortalSession)",
    isAuthLoading: "isAuthLoading",
    isPasswordRecoveryBlocked: "multiportalAuth.isPasswordRecoveryPortalBlocked()",
    isRenderableScreen: "isUserPortalRenderableScreen(screen)",
  };
  for (const [name, expected] of Object.entries(expectedWiring)) {
    assert.equal(
      compact(objectPropertyExpression(mountInput, mount.sourceFile, name).getText(mount.sourceFile)),
      compact(expected),
      `[UI-NAV-01.mount-wiring] ${name} usa el owner correcto`,
    );
  }
  assert.doesNotMatch(
    mount.initializer.getText(mount.sourceFile),
    /hasSupabaseSession/,
    "[UI-NAV-01.mount-wiring] presencia de sesión no autoriza el shell",
  );
  findUnprovenFallbackGate(sources.root);
  assertAuthorizationProofWiring(sources.root);

  const requireProofClear = (name: string) => {
    const fn = findNamedFunction(paths.root, sources.root, name);
    assert.ok(
      compact(fn.declaration.getText(fn.sourceFile)).includes(
        "replaceUserPortalAuthorizationProof(null)",
      ),
      `[UI-NAV-01.proof-invalidation] ${name} invalida la prueba`,
    );
  };
  for (const name of [
    "beginPasswordRecoveryPortalSession",
    "holdAuthenticatedSessionWithoutContinuation",
    "clearUserSessionState",
    "handleAuth",
    "handleLogout",
  ]) requireProofClear(name);

  assert.doesNotMatch(
    sources.root,
    /\bhandleCoachIdentitySwitch\b|\bcoachIdentitySwitchRequired\b|\bsignOutForCoachIdentitySwitch\b/,
    "[AUTH-HYBRID-01.shared-login] el modelo híbrido no restaura el switch absoluto legacy",
  );
  const sharedCoachLogin = findNamedFunction(paths.root, sources.root, "handleSharedCoachLogin");
  const sharedCoachLoginCode = compact(
    sharedCoachLogin.declaration.getText(sharedCoachLogin.sourceFile),
  );
  for (const marker of [
    "registrationForm.controller.beginSharedCoachLogin()",
    'authRouteController.replace({mode:"login",accountType:"coach"})',
    'navigation.transition(createAuthNavigationReset("login","auth-screen-switch"))',
  ]) {
    assert.ok(
      sharedCoachLoginCode.includes(compact(marker)),
      `[AUTH-HYBRID-01.shared-login] falta ${marker}`,
    );
  }

  const replaceCoach = findNamedFunction(paths.root, sources.root, "replaceCoachPortalSession");
  assert.ok(
    compact(replaceCoach.declaration.getText(replaceCoach.sourceFile)).includes(
      "if(session)replaceUserPortalAuthorizationProof(null)",
    ),
    "[UI-NAV-01.proof-invalidation] sesión Coach invalida Usuario",
  );
  const applySession = findNamedFunction(paths.root, sources.root, "applySessionState");
  const applyCode = compact(applySession.declaration.getText(applySession.sourceFile));
  assert.ok(
    applyCode.includes("userPortalAuthorizationProofRef.current?.userId!==authenticatedUser?.id")
    && applyCode.includes("replaceUserPortalAuthorizationProof(null)"),
    "[UI-NAV-01.proof-invalidation] reemplazo A→B invalida antes de render",
  );

  const continuation = findNamedFunction(paths.root, sources.root, "continueAuthorizedPortalAccess");
  const continuationCode = compact(continuation.declaration.getText(continuation.sourceFile));
  assert.ok(
    continuationCode.includes("createUserPortalAuthorizationProof({"),
    "[UI-NAV-01.proof-publication] prueba deriva del access autoritativo",
  );
  assert.ok(
    continuationCode.includes('continuation.kind==="stale"||!isAuthorizationCurrent()'),
    "[UI-NAV-01.proof-stale] stale o owner reemplazado no continúa después de la carga",
  );
  assert.equal(
    countCalls(continuation.declaration, continuation.sourceFile, "isAuthorizationCurrent"),
    2,
    "[UI-NAV-01.proof-stale] se valida owner antes y después del await",
  );
  const awaitContinuations: ts.AwaitExpression[] = [];
  const publications: ts.CallExpression[] = [];
  const visitContinuation = (node: ts.Node) => {
    if (
      ts.isAwaitExpression(node)
      && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(continuation.sourceFile) === "continueAuthenticatedSession"
    ) awaitContinuations.push(node);
    if (
      ts.isCallExpression(node)
      && node.expression.getText(continuation.sourceFile) === "replaceUserPortalAuthorizationProof"
      && node.arguments[0]?.getText(continuation.sourceFile) === "authorizationProof"
    ) publications.push(node);
    ts.forEachChild(node, visitContinuation);
  };
  visitContinuation(continuation.declaration);
  assert.equal(awaitContinuations.length, 1, "[UI-NAV-01.proof-publication] continuación única");
  assert.equal(publications.length, 2, "[UI-NAV-01.proof-publication] publicaciones por lifecycle exactas");
  assert.equal(
    publications.filter((publication) => publication.pos < awaitContinuations[0].pos).length,
    2,
    "[UI-NAV-01.proof-publication] ambas rutas publican autorización antes de esperar datos críticos",
  );
  assert.equal(
    publications.filter((publication) => publication.pos > awaitContinuations[0].pos).length,
    0,
    "[UI-NAV-01.proof-publication] ninguna ruta fabrica autorización después de cargar datos",
  );
  const foregroundPublication = publications
    .filter((publication) => publication.pos < awaitContinuations[0].pos)
    .sort((left, right) => right.pos - left.pos)[0];
  assert.ok(foregroundPublication, "[UI-NAV-01.splash-readiness] bootstrap/login publica su prueba antes de la carga");
  const foregroundPrefix = compact(
    continuation.sourceFile.text.slice(foregroundPublication.getStart(), awaitContinuations[0].getStart()),
  );
  assert.doesNotMatch(
    foregroundPrefix,
    /setIsAuthLoading\(false\)|clearCompletedAuthForm\(\)|restoreActiveFlowForSession|createAuthNavigationReset/,
    "[UI-NAV-01.splash-readiness] el Dashboard no reemplaza el splash antes de completar datos críticos",
  );
  const foregroundContinuationCall = awaitContinuations[0].expression;
  assert.ok(
    ts.isCallExpression(foregroundContinuationCall),
    "[UI-NAV-01.splash-readiness] continuación identificable",
  );
  assert.equal(
    foregroundContinuationCall.arguments.length,
    3,
    "[UI-NAV-01.splash-readiness] la presentación queda en el completion de la carga crítica",
  );
}

function assertEscapeContract(source: string) {
  const handler = findNamedFunction(paths.focusManager, source, "handleKeyDown");
  const escapeBranches: ts.IfStatement[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isIfStatement(node)
      && compact(node.expression.getText(handler.sourceFile)).includes('event.key==="Escape"')
    ) escapeBranches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(handler.declaration);
  assert.equal(escapeBranches.length, 1, "[UI-NAV-01.escape] branch Escape único");
  const body = compact(escapeBranches[0].thenStatement.getText(handler.sourceFile));
  for (const behavior of [
    "event.preventDefault()",
    "event.stopImmediatePropagation()",
    "if(!canCloseRef.current)return",
    "onCloseRef.current()",
  ]) assert.ok(body.includes(behavior), `[UI-NAV-01.escape] falta ${behavior}`);
}

function assertDrawerDialogContract(source: string) {
  const drawer = findJsxElements(paths.drawer, source, "div");
  const dialogs = drawer.matches.filter((element) => (
    element.attributes.properties.some((property) => (
      ts.isJsxAttribute(property)
      && property.name.getText(drawer.sourceFile) === "role"
      && property.initializer
      && ts.isStringLiteral(property.initializer)
      && property.initializer.text === "dialog"
    ))
  ));
  assert.equal(dialogs.length, 1, "[UI-NAV-01.aria-modal] diálogo drawer único");
  assert.ok(
    optionalJsxAttribute(dialogs[0], drawer.sourceFile, "aria-modal"),
    "[UI-NAV-01.aria-modal] drawer declara aria-modal",
  );
  assert.equal(
    jsxAttributeValue(dialogs[0], drawer.sourceFile, "aria-modal"),
    '"true"',
    "[UI-NAV-01.aria-modal] drawer es modal",
  );

  const buttons = findJsxElements(paths.drawer, source, "button");
  const backdrops = buttons.matches.filter((element) => {
    const classAttributes = element.attributes.properties.filter((property) => (
      ts.isJsxAttribute(property) && property.name.getText(buttons.sourceFile) === "className"
    ));
    return classAttributes.length === 1
      && jsxAttributeValue(element, buttons.sourceFile, "className") === "styles.backdrop";
  });
  assert.equal(backdrops.length, 1, "[UI-NAV-01.backdrop-close] backdrop único");
  assert.ok(
    optionalJsxAttribute(backdrops[0], buttons.sourceFile, "onClick"),
    "[UI-NAV-01.backdrop-close] backdrop declara onClick",
  );
  assert.equal(
    jsxAttributeValue(backdrops[0], buttons.sourceFile, "onClick"),
    "onClose",
    "[UI-NAV-01.backdrop-close] backdrop cierra drawer",
  );
}

function validateIntegration(sources: Sources) {
  const rootImports = moduleSpecifiers(paths.root, sources.root);
  for (const requiredImport of [
    "@/features/user-portal-shell/components/user-portal-shell",
    "@/features/user-portal-shell/model/user-portal-navigation",
    "@/features/auth/model/user-portal-authorization-proof",
    "@/features/auth/model/user-portal-session-revalidation",
  ]) assert.ok(rootImports.includes(requiredImport), `[UI-NAV-01.root-import] falta ${requiredImport}`);

  assertExclusiveShellReturns(sources.root);
  assertAuthorizationBoundary(sources);
  assertSilentSessionRevalidationBoundary(sources);
  assertTokenRefreshedAuthoritativeReachability(sources);

  const rootLegacyTopbars = findJsxElements(paths.root, sources.root, "AppTopbar");
  const rootLegacyDrawers = findJsxElements(paths.root, sources.root, "AppNavigationDrawer");
  const rootPanels = findJsxElements(paths.root, sources.root, "NotificationPanel");
  assert.equal(rootLegacyTopbars.matches.length, 1, "[UI-NAV-01.legacy-fallback] topbar legacy único");
  assert.equal(rootLegacyDrawers.matches.length, 1, "[UI-NAV-01.legacy-fallback] drawer legacy único");
  assert.equal(rootPanels.matches.length, 1, "[UI-NAV-01.single-notification-panel] NotificationPanel único");

  const shellBranch = sources.root.indexOf("  if (useUserPortalShell) {");
  for (const marker of [
    '  if (screen === "recovery-expired")',
    "  if (multiportalAuth.isPasswordRecoveryPortalBlocked()",
    "  if (isAuthLoading)",
    "  if (coachPortalSession)",
    '  if (screen === "login" || screen === "registro")',
    '  if (screen === "recuperar-password")',
  ]) {
    const index = sources.root.indexOf(marker);
    assert.ok(
      index >= 0 && index < shellBranch,
      "[UI-NAV-01.auth-gate] Auth, recovery y Coach retornan antes del shell Usuario",
    );
  }

  assert.deepEqual(readDestinationMapping(sources.model), EXPECTED_MAPPING, "[UI-NAV-01.navigation-map]");
  const navigationItems = readNavigationItems(sources.model);
  assert.deepEqual(navigationItems.map(({ id }) => id), EXPECTED_IDS, "[UI-NAV-01.navigation-items]");
  assert.deepEqual(navigationItems.map(({ label }) => label), EXPECTED_LABELS, "[UI-NAV-01.navigation-labels]");
  assert.equal(
    navigationItems.filter(({ kind }) => kind === "destination")
      .every(({ availability }) => availability === "enabled"),
    true,
    "[UI-NAV-01.navigation-enabled] destinos ofrecidos habilitados",
  );
  assert.equal(
    navigationItems.some(({ label }) => label === "Mensajes"),
    false,
    "[UI-NAV-01.navigation-invented] sin destinos inventados",
  );

  const navigationModel = findVariableInitializer(paths.root, sources.root, "userPortalNavigation");
  assert.ok(
    ts.isCallExpression(navigationModel.initializer)
    && navigationModel.initializer.expression.getText(navigationModel.sourceFile)
      === "createUserPortalNavigationModel",
    "[UI-NAV-01.visibility] usa el modelo feature-local",
  );
  const navigationInput = unwrapExpression(navigationModel.initializer.arguments[0]);
  assert.ok(ts.isObjectLiteralExpression(navigationInput), "[UI-NAV-01.visibility] input explícito");
  assert.equal(
    objectPropertyExpression(navigationInput, navigationModel.sourceFile, "visibleScreens")
      .getText(navigationModel.sourceFile),
    "menuScreens",
    "[UI-NAV-01.visibility] consume resolveMenuScreens",
  );
  const menuScreens = findVariableInitializer(paths.root, sources.root, "menuScreens");
  assert.ok(
    ts.isCallExpression(menuScreens.initializer)
    && menuScreens.initializer.expression.getText(menuScreens.sourceFile) === "resolveMenuScreens",
    "[UI-NAV-01.visibility] visibilidad canónica",
  );

  const navigateFunction = findNamedFunction(paths.shell, sources.shell, "handleNavigate");
  assert.equal(
    countCalls(navigateFunction.declaration, navigateFunction.sourceFile, "onNavigate"),
    1,
    "[UI-NAV-01.navigate-once] controller ejecutado una vez",
  );
  assert.equal(
    countCalls(
      navigateFunction.declaration,
      navigateFunction.sourceFile,
      "resolveUserPortalDestinationScreen",
    ),
    1,
    "[UI-NAV-01.navigate-map] traducción feature-local única",
  );
  assert.match(
    sources.root,
    /function navigateTo\(nextScreen: Screen\)[\s\S]*?closeMenu: appShell\.closeMenu,/,
    "[UI-NAV-01.navigate-close] controller canónico cierra drawer",
  );

  assert.equal(
    findJsxElements(paths.shell, sources.shell, "UserPortalTopbar").matches.length,
    1,
    "[UI-NAV-01.legacy-exclusive] topbar Usuario único",
  );
  assert.equal(
    findJsxElements(paths.shell, sources.shell, "UserPortalDrawer").matches.length,
    1,
    "[UI-NAV-01.legacy-exclusive] drawer Usuario único",
  );
  for (const forbiddenTag of ["UserPortalShell", "AppTopbar", "AppNavigationDrawer"]) {
    assert.equal(
      findJsxElements(paths.shell, sources.shell, forbiddenTag).matches.length,
      0,
      "[UI-NAV-01.legacy-exclusive] shell no anida shells ni componentes legacy",
    );
  }

  const rootShell = findJsxElements(paths.root, sources.root, "UserPortalShell");
  const shellTag = rootShell.matches[0];
  const expectedShellProps = {
    profile: "profileViewModel",
    navigation: "userPortalNavigation",
    isDrawerOpen: "isMenuOpen",
    isTopbarHidden: "isTopbarHidden",
    isLogoutDisabled: "isBusy",
    isNotificationPanelOpen: "isNotificationPanelOpen",
    notificationBadgeText: "notificationBadgeText",
    notificationBadgeAriaLabel: "notificationBadgeAriaLabel",
    notificationOverlay: "notificationOverlay",
    screenHeader: "screenHeader",
    avatarResetKey: "profileAvatarResetKey",
    onAvatarImageError: "handleProfileAvatarImageError",
    onOpen: "toggleMenu",
    onClose: "appShell.closeMenu",
    onNavigate: "navigateTo",
    onToggleNotifications: "toggleNotifications",
    onLogout: "handleLogout",
  };
  for (const [name, expected] of Object.entries(expectedShellProps)) {
    assert.equal(
      jsxAttributeValue(shellTag, rootShell.sourceFile, name),
      compact(expected),
      `[UI-NAV-01.root-wiring] falta ${name}`,
    );
  }

  assert.equal(
    (sources.root.match(/useNotificationsController\(\{/g) ?? []).length,
    1,
    "[UI-NAV-01.notifications-owner] controller de notificaciones único",
  );
  assert.match(sources.root, /const notificationOverlay = \(\s*<NotificationPanel/);
  assert.match(sources.root, /onClose=\{appShell\.closeNotifications\}/);
  assert.match(sources.root, /onOpenNotification=\{openNotificationTarget\}/);
  assert.match(sources.topbar, /aria-expanded=\{isNotificationPanelOpen\}/);
  assert.equal(
    jsxAttributeValue(
      findJsxElements(paths.topbar, sources.topbar, "button").matches[1],
      findJsxElements(paths.topbar, sources.topbar, "button").sourceFile,
      "aria-controls",
    ),
    "NOTIFICATION_PANEL_ID",
    "[UI-NAV-01.notification-aria-controls] campana controla NotificationPanel",
  );
  assert.match(sources.topbar, /\{notificationBadgeText \? \(/);
  assert.match(sources.topbar, /aria-label=\{notificationBadgeAriaLabel \?\? undefined\}/);
  assert.match(
    sources.appShellState,
    /case "menu_toggled":[\s\S]*?isNotificationPanelOpen: false,/,
    "[UI-NAV-01.overlay-exclusion] drawer cierra notificaciones",
  );
  assert.match(
    sources.appShellState,
    /case "notifications_toggled":[\s\S]*?isMenuOpen: false,/,
    "[UI-NAV-01.overlay-exclusion] notificaciones cierran drawer",
  );

  assert.equal(
    (sources.root.match(/const profileViewModel = useMemo\(/g) ?? []).length,
    1,
    "[UI-NAV-01.profile-owner] profileViewModel único",
  );
  assert.match(sources.drawer, /<UserAvatar[\s\S]*?profile=\{profile\}/);
  assert.match(sources.drawer, /onImageError=\{onAvatarImageError\}/);
  assert.match(sources.drawer, /resetKey=\{avatarResetKey\}/);
  assert.match(sources.drawer, /\{profile\.displayName\}/);
  assert.match(sources.drawer, /\{profile\.secondaryLabel\}/);

  const featureProduction = [
    sources.authProof,
    sources.sessionRevalidation,
    sources.model,
    sources.logoutSingleFlight,
    sources.shell,
    sources.topbar,
    sources.drawer,
  ].join("\n");
  const featureImports = [
    ...moduleSpecifiers(paths.authProof, sources.authProof),
    ...moduleSpecifiers(paths.sessionRevalidation, sources.sessionRevalidation),
    ...moduleSpecifiers(paths.model, sources.model),
    ...moduleSpecifiers(paths.logoutSingleFlight, sources.logoutSingleFlight),
    ...moduleSpecifiers(paths.shell, sources.shell),
    ...moduleSpecifiers(paths.topbar, sources.topbar),
    ...moduleSpecifiers(paths.drawer, sources.drawer),
  ];
  assert.equal(
    featureImports.some((specifier) => /supabase|repository|storage|data-source/i.test(specifier)),
    false,
    "[UI-NAV-01.data-ownership] feature sin infraestructura de datos",
  );
  assert.doesNotMatch(
    featureProduction,
    /\bfetch\s*\(|\.(?:from|rpc|insert|update|upsert|delete)\s*\(|service_role|owner_id|user_id/i,
    "[UI-NAV-01.data-ownership] sin queries, writes ni ownership nuevo",
  );
  assert.doesNotMatch(featureProduction, /ShareWorkoutCard|workout-share/);

  const focusCall = findCalls(parseSource(paths.shell, sources.shell), (call) => (
    call.expression.getText() === "useOverlayFocusManagement"
  ));
  assert.equal(focusCall.length, 1, "[UI-NAV-01.focus-manager] drawer usa el motor canónico");
  const focusInput = unwrapExpression(focusCall[0].arguments[0]);
  assert.ok(ts.isObjectLiteralExpression(focusInput), "[UI-NAV-01.focus-manager] input explícito");
  const focusSourceFile = focusCall[0].getSourceFile();
  for (const [name, expected] of [
    ["isActive", "isDrawerOpen"],
    ["onClose", "onClose"],
    ["canClose", "true"],
    ["restoreFocusRef", "menuButtonRef"],
  ] as const) {
    assert.equal(
      compact(objectPropertyExpression(focusInput, focusSourceFile, name).getText(focusSourceFile)),
      expected,
      `[UI-NAV-01.focus-manager] ${name}`,
    );
  }
  assert.match(sources.shell, /focusBoundaryRef=\{drawerRef\}/);
  assert.match(sources.shell, /initialFocusAttribute=\{OVERLAY_INITIAL_FOCUS_ATTRIBUTE\}/);
  assert.match(sources.drawer, /\[initialFocusAttribute\]: ""/);
  assert.doesNotMatch(sources.drawer, /autoFocus|onKeyDown|addEventListener|querySelectorAll/);
  const background = findJsxElements(paths.shell, sources.shell, "div").matches.find((element) => (
    element.attributes.properties.some((property) => (
      ts.isJsxAttribute(property)
      && property.name.getText() === "className"
      && property.initializer?.getText() === "{styles.backgroundLayer}"
    ))
  ));
  assert.ok(background, "[UI-NAV-01.background-inert] background identificado");
  assert.ok(
    optionalJsxAttribute(background, background.getSourceFile(), "inert"),
    "[UI-NAV-01.background-inert] background declara inert",
  );
  assert.equal(
    jsxAttributeValue(background, background.getSourceFile(), "inert"),
    'isDrawerOpen?true:undefined',
    "[UI-NAV-01.background-inert] fondo inerte con drawer abierto",
  );
  assert.equal(
    jsxAttributeValue(background, background.getSourceFile(), "aria-hidden"),
    'isDrawerOpen?"true":undefined',
    "[UI-NAV-01.background-inert] fondo oculto al árbol accesible",
  );
  assertEscapeContract(sources.focusManager);
  assertDrawerDialogContract(sources.drawer);

  const shellLogout = findNamedFunction(paths.shell, sources.shell, "handleLogout");
  assert.equal(
    countCalls(
      shellLogout.declaration,
      shellLogout.sourceFile,
      "logoutSingleFlightRef.current.run",
    ),
    1,
    "[UI-NAV-01.logout-once] shell delega una vez al single-flight",
  );
  assert.equal(countCalls(shellLogout.declaration, shellLogout.sourceFile, "onLogout"), 0);
  assert.equal(countCalls(shellLogout.declaration, shellLogout.sourceFile, "onClose"), 0);
  assert.equal(countCalls(shellLogout.declaration, shellLogout.sourceFile, "handleLogout"), 0);

  const logoutFactory = findNamedFunction(
    paths.logoutSingleFlight,
    sources.logoutSingleFlight,
    "createUserPortalLogoutSingleFlight",
  );
  const logoutCode = compact(logoutFactory.declaration.getText(logoutFactory.sourceFile));
  assert.ok(
    logoutCode.includes("if(disabled||inFlight)returnfalse")
    && logoutCode.includes("inFlight=true")
    && logoutCode.includes("finally{inFlight=false"),
    "[UI-NAV-01.logout-single-flight] guard síncrono y liberación finally",
  );
  assert.equal(
    countCalls(logoutFactory.declaration, logoutFactory.sourceFile, "onClose"),
    1,
    "[UI-NAV-01.logout-close] cierra una vez",
  );
  assert.equal(
    countCalls(logoutFactory.declaration, logoutFactory.sourceFile, "onLogout"),
    1,
    "[UI-NAV-01.logout-once] delega una vez",
  );
  assert.ok(
    logoutCode.indexOf("inFlight=true") < logoutCode.indexOf("onClose()")
    && logoutCode.indexOf("onClose()") < logoutCode.indexOf("awaitonLogout()"),
    "[UI-NAV-01.logout-single-flight] bloquea reentrada antes de cerrar y delegar",
  );
  assert.match(sources.drawer, /disabled=\{isLogoutDisabled\}/, "[UI-NAV-01.logout-busy]");
  assert.match(sources.drawer, /aria-busy=\{isLogoutDisabled\}/);

  const rootLogout = findNamedFunction(paths.root, sources.root, "handleLogout");
  const rootLogoutCode = compact(rootLogout.declaration.getText(rootLogout.sourceFile));
  assert.ok(
    rootLogoutCode.includes("if(logoutInFlightRef.current)return")
    && rootLogoutCode.includes("logoutInFlightRef.current=true")
    && rootLogoutCode.includes("finally{")
    && rootLogoutCode.includes("logoutInFlightRef.current=false"),
    "[UI-NAV-01.logout-single-flight] root también protege identidad y signOut",
  );
  assert.equal(countCalls(rootLogout.declaration, rootLogout.sourceFile, "handleLogout"), 0);
  const signOutCalls = findCalls(rootLogout.declaration, (call) => (
    ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "signOut"
  ));
  assert.equal(signOutCalls.length, 1, "[UI-NAV-01.logout-signout] signOut único");
  assert.match(
    signOutCalls[0].getText(rootLogout.sourceFile),
    /scope: "local"/,
    "[UI-NAV-01.logout-local] logout conserva scope local",
  );
  assert.doesNotMatch(signOutCalls[0].getText(rootLogout.sourceFile), /global/);

  const css = sources.css.toLowerCase();
  for (const marker of [
    "background: var(--background, #07101a)",
    "--user-portal-panel: var(--panel, #111827)",
    "--user-portal-primary: var(--primary, #3c7aff)",
    "grid-template-columns: 44px minmax(0, 1fr) 44px",
    "width: min(90vw, 390px)",
    "env(safe-area-inset-top, 0px)",
    "env(safe-area-inset-bottom, 0px)",
    "overflow-wrap: anywhere",
    "@media (max-width: 359px)",
    "@media (min-width: 393px)",
    "@media (prefers-reduced-motion: reduce)",
    ".topbarhidden",
    ".logoutbutton:disabled",
  ]) assert.ok(css.includes(marker), `[UI-NAV-01.responsive] falta ${marker}`);
  for (const width of [320, 360, 393, 430]) {
    const drawerWidth = Math.min(width * 0.9, 390);
    assert.ok(drawerWidth <= width, `[UI-NAV-01.responsive] ${width}px sin overflow`);
    assert.ok(width - drawerWidth >= 32, `[UI-NAV-01.responsive] ${width}px conserva backdrop`);
  }

  const parsedPackage = JSON.parse(sources.package) as { scripts?: Record<string, string> };
  const scripts = Object.values(parsedPackage.scripts ?? {}).join(" && ");
  for (const registeredPath of [
    "src/features/auth/model/user-portal-authorization-proof.test.ts",
    "src/features/user-portal-shell/model/user-portal-logout-single-flight.test.ts",
    "src/features/user-portal-shell/model/user-portal-navigation.contract.ts",
    "src/features/user-portal-shell/user-portal-shell-integration.contract.test.ts",
  ]) {
    assert.equal(
      scripts.split(registeredPath).length - 1,
      1,
      `[UI-NAV-01.runner] ${registeredPath} conectado exactamente una vez`,
    );
  }
}

function collectOverlayConsumers(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectOverlayConsumers(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    if (path === paths.focusManager) return [];
    return readFileSync(path, "utf8").includes("@/ui/overlays/use-overlay-focus-management")
      ? [path]
      : [];
  });
}

function runExternalRunnerBarrier(packagePath: string) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    UI_NAV_01_PACKAGE_PATH: resolve(packagePath),
  };
  delete environment.NODE_TEST_CONTEXT;
  return spawnSync(
    "npx",
    ["tsx", "src/features/app-shell/app-shell-visual-integration-contract.test.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
      timeout: 30_000,
    },
  );
}

const baseline = readSources();

test("UI-NAV-01 integra autorización, shell, owners y accesibilidad sin duplicar infraestructura", () => {
  validateIntegration(baseline);
});

test("wiring AST de autorización tolera cinco controles inocentes focales", () => {
  const sourceFile = parseSource(paths.root, baseline.root);
  const root = findOrganizatechApp(sourceFile, AUTHORIZATION_PROOF_WIRING_BARRIER);
  const { declaration } = findAuthorizationProofDeclaration(sourceFile, root);
  assert.ok(declaration.initializer, "control focal conserva inicializador");
  const initializer = declaration.initializer.getText(sourceFile);
  assert.equal(
    baseline.root.split("menuScreens").length - 1,
    3,
    "control focal usa un rename local completo y acotado",
  );
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const controls = [
    {
      name: "comentario adyacente al wiring",
      source: replaceAuthorizationProofInitializer(
        baseline.root,
        `/* wiring Usuario documentado */ (${initializer})`,
      ),
    },
    {
      name: "reformateo completo con TypeScript printer",
      source: printer.printFile(sourceFile),
    },
    {
      name: "paréntesis redundantes alrededor del helper",
      source: replaceAuthorizationProofInitializer(baseline.root, `(((${initializer})))`),
    },
    {
      name: "renombre de variable local no contractual",
      source: baseline.root.replaceAll("menuScreens", "availableMenuScreens"),
    },
    {
      name: "reordenamiento de argumentos autoritativos",
      source: replaceAuthorizationProofInitializer(
        baseline.root,
        `hasCurrentUserPortalAuthorization({
    authenticatedUserId: supabaseUser?.id,
    sessionUserId: supabaseSession?.user.id,
    authorizationProof: userPortalAuthorizationProof,
  })`,
      ),
    },
  ];
  assert.equal(controls.length, 5, "conteo fijo de controles focales R1");
  for (const control of controls) {
    assert.notEqual(control.source, baseline.root, `${control.name}: transformación efectiva`);
    assertValidMutatedSource(paths.root, control.source);
    assert.doesNotThrow(
      () => assertAuthorizationProofWiring(control.source),
      `${control.name}: la barrera AST no genera falso positivo`,
    );
  }
});

test("UI-NAV-01S tolera comentarios, formato, renombres locales y reordenamiento", () => {
  const policyPrinter = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const printedPolicy = policyPrinter.printFile(
    parseSource(paths.sessionRevalidation, baseline.sessionRevalidation),
  );
  const printedBoundary = policyPrinter.printFile(
    parseSource(paths.authBoundary, baseline.authBoundary),
  );
  const renamedPolicy = baseline.sessionRevalidation
    .replaceAll("isRedundantSessionEvent", "isSilentResumeEvent")
    .replace(/\bproof\b/g, "currentProof");
  const renamedBoundary = baseline.authBoundary.replaceAll(
    "isSessionEstablishingEvent",
    "isAuthoritativeSessionEvent",
  );
  const reorderedBoundary = replaceExactlyOnce(
    baseline.authBoundary,
    `    const isSessionEstablishingEvent = event === "SIGNED_IN"
      || event === "INITIAL_SESSION"
      || event === "TOKEN_REFRESHED";`,
    `    const isSessionEstablishingEvent = event === "TOKEN_REFRESHED"
      || event === "SIGNED_IN"
      || event === "INITIAL_SESSION";`,
    "UI-NAV-01S innocent authorizing-event reorder",
  );
  const reorderedRoot = replaceExactlyOnce(
    baseline.root,
    `        const userPortalSessionRevalidation = resolveUserPortalSessionRevalidation({
          event,
          authorizationProof: userPortalAuthorizationProofRef.current,
          nextSessionUserId: nextState.session?.user.id,
          nextAuthenticatedUserId: resolveEffectiveAuthenticatedUser(
            nextState.session,
            nextState.user,
          )?.id,
          requestedPortal,
          isInteractiveAuthAttempt: interactiveAuthAttemptRef.current,
          isPasswordRecoveryBlocked: multiportalAuth.isPasswordRecoveryPortalBlocked(),
          isLogoutInFlight: logoutInFlightRef.current,
          hasCoachPortalSession: Boolean(coachPortalSessionRef.current),
        });`,
    `        const userPortalSessionRevalidation = resolveUserPortalSessionRevalidation({
          hasCoachPortalSession: Boolean(coachPortalSessionRef.current),
          isLogoutInFlight: logoutInFlightRef.current,
          requestedPortal,
          nextAuthenticatedUserId: resolveEffectiveAuthenticatedUser(
            nextState.session,
            nextState.user,
          )?.id,
          event,
          isPasswordRecoveryBlocked: multiportalAuth.isPasswordRecoveryPortalBlocked(),
          authorizationProof: userPortalAuthorizationProofRef.current,
          isInteractiveAuthAttempt: interactiveAuthAttemptRef.current,
          nextSessionUserId: nextState.session?.user.id,
        });`,
    "UI-NAV-01S innocent property reorder",
  );
  const controls: Sources[] = [
    {
      ...baseline,
      sessionRevalidation: `${baseline.sessionRevalidation}\n// comentario inocente de lifecycle\n`,
    },
    { ...baseline, sessionRevalidation: printedPolicy },
    { ...baseline, sessionRevalidation: renamedPolicy },
    { ...baseline, root: reorderedRoot },
    { ...baseline, authBoundary: `${baseline.authBoundary}\n// comentario inocente de reachability\n` },
    { ...baseline, authBoundary: printedBoundary },
    { ...baseline, authBoundary: renamedBoundary },
    { ...baseline, authBoundary: reorderedBoundary },
  ];
  assert.equal(controls.length, 8, "conteo fijo de controles inocentes UI-NAV-01S");
  for (const control of controls) {
    assert.doesNotThrow(() => validateIntegration(control));
  }
});

test("la lista de consumidores del gestor de foco es exacta e incluye el drawer Usuario", () => {
  assert.deepEqual(collectOverlayConsumers("src").sort(), [
    "src/components/profile/ProfileAvatarEditor.tsx",
    "src/features/app-shell/components/app-navigation-drawer.tsx",
    "src/features/coach-portal/components/coach-portal.tsx",
    "src/features/notifications/components/NotificationPanel.tsx",
    "src/features/user-portal-shell/components/user-portal-shell.tsx",
    "src/ui/modals/modal-shell.tsx",
  ]);
});

test("Recovery, NotificationPanel, perfil y fallbacks no modificados conservan paridad", () => {
  for (const path of [
    "src/features/auth/model/password-recovery-portal-guard.ts",
    "src/features/notifications/components/NotificationPanel.tsx",
    "src/features/app-shell/components/app-topbar.tsx",
    "src/features/app-shell/components/app-navigation-drawer.tsx",
    "src/components/profile/ProfileScreen.tsx",
  ]) {
    assert.equal(
      readFileSync(path, "utf8"),
      execFileSync("git", ["show", `${BASE_SHA}:${path}`], { encoding: "utf8" }),
      `${path} sin cambios internos`,
    );
  }
});

const mutationProbes: Array<{
  readonly name: string;
  readonly target: SourceKey;
  readonly barrier: string;
  readonly externalRunner?: true;
  readonly mutate: (source: string) => string;
}> = [
  {
    name: "R1 · reemplazar wiring autoritativo por presencia de sesión",
    target: "root",
    barrier: AUTHORIZATION_PROOF_WIRING_BARRIER,
    mutate: (source) => replaceAuthorizationProofInitializer(
      source,
      (initializer) => `(${initializer}) || hasSupabaseSession`,
    ),
  },
  {
    name: "F1 · excluir TOKEN_REFRESHED de los eventos autorizantes",
    target: "authBoundary",
    barrier: TOKEN_REFRESHED_REACHABILITY_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      `    const isSessionEstablishingEvent = event === "SIGNED_IN"
      || event === "INITIAL_SESSION"
      || event === "TOKEN_REFRESHED";`,
      `    const isSessionEstablishingEvent = event === "SIGNED_IN"
      || event === "INITIAL_SESSION";`,
      "TOKEN_REFRESHED excluded from authorizing events",
    ),
  },
  {
    name: "F2 · devolver continue exclusivamente para TOKEN_REFRESHED",
    target: "authBoundary",
    barrier: TOKEN_REFRESHED_REACHABILITY_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      '    if (!currentUserId || !isSessionEstablishingEvent) return "continue";',
      '    if (event === "TOKEN_REFRESHED" || !currentUserId || !isSessionEstablishingEvent) return "continue";',
      "TOKEN_REFRESHED forced to continue",
    ),
  },
  {
    name: "UI-NAV-01S · conservar por presencia de sesión sin capacidad válida",
    target: "sessionRevalidation",
    barrier: SILENT_REVALIDATION_POLICY_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      `    || !hasCurrentUserPortalAuthorization({
      authorizationProof: proof,
      sessionUserId: input.nextSessionUserId,
      authenticatedUserId: input.nextAuthenticatedUserId,
    })`,
      "    || !Boolean(input.nextSessionUserId)",
      "Silent revalidation without authoritative proof",
    ),
  },
  {
    name: "UI-NAV-01S · conservar durante recovery",
    target: "sessionRevalidation",
    barrier: SILENT_REVALIDATION_POLICY_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "    || input.isPasswordRecoveryBlocked",
      "    || false",
      "Silent revalidation during recovery",
    ),
  },
  {
    name: "UI-NAV-01S · ignorar decisión silenciosa y ejecutar continuación",
    target: "root",
    barrier: SILENT_REVALIDATION_WIRING_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "            userPortalSessionRevalidation,\n          )",
      "            FAIL_CLOSED_USER_PORTAL_SESSION_REVALIDATION,\n          )",
      "Redundant event discards silent decision",
    ),
  },
  {
    name: "UI-NAV-01S · microtask republica una prueba capturada antes de recovery/A→B",
    target: "root",
    barrier: SILENT_REVALIDATION_STALE_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      `  ): Promise<AuthorizedPortalAccess | null> {
    if (sessionRevalidation.kind !== "silent_revalidation") setIsAuthLoading(true);
    const access = await multiportalAuth.resolvePortalAccess(authState, requestedPortal, resolutionOwner);`,
      `  ): Promise<AuthorizedPortalAccess | null> {
    replaceUserPortalAuthorizationProof(sessionRevalidation.authorizationProof);
    if (sessionRevalidation.kind !== "silent_revalidation") setIsAuthLoading(true);
    const access = await multiportalAuth.resolvePortalAccess(authState, requestedPortal, resolutionOwner);`,
      "Deferred callback republishes captured proof",
    ),
  },
  {
    name: "F3 · conservar prueba A durante A→B",
    target: "root",
    barrier: SILENT_REVALIDATION_INVALIDATION_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "        replaceUserPortalAuthorizationProof(userPortalSessionRevalidation.authorizationProof);",
      "        void userPortalSessionRevalidation.authorizationProof;",
      "Delayed unsafe identity invalidation",
    ),
  },
  {
    name: "F4 · mostrar loading durante TOKEN_REFRESHED A→A",
    target: "root",
    barrier: SILENT_REVALIDATION_VISUAL_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      `    if (sessionRevalidation.kind !== "silent_revalidation") setIsAuthLoading(true);`,
      `    setIsAuthLoading(true);`,
      "Redundant event activates auth loading",
    ),
  },
  {
    name: "F5 · saltarse resolvePortalAccess",
    target: "root",
    barrier: TOKEN_REFRESHED_REACHABILITY_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "    const access = await multiportalAuth.resolvePortalAccess(authState, requestedPortal, resolutionOwner);",
      `    const access = await Promise.resolve({
      state: "stale",
      requestedPortal,
    } as Awaited<ReturnType<typeof multiportalAuth.resolvePortalAccess>>);`,
      "TOKEN_REFRESHED skips resolvePortalAccess",
    ),
  },
  {
    name: "F6 · publicar prueba después de owner stale",
    target: "root",
    barrier: SILENT_REVALIDATION_STALE_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "        if (!isAuthorizationCurrent()) return;",
      "        if (isAuthorizationCurrent()) return;",
      "Stale owner reaches authoritative publication",
    ),
  },
  {
    name: "UI-NAV-01S · TOKEN_REFRESHED borra la prueba vigente",
    target: "root",
    barrier: SILENT_REVALIDATION_TOKEN_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "      const authEventResult = coordinateAuthenticatedSessionEvent({",
      `      if (event === "TOKEN_REFRESHED") replaceUserPortalAuthorizationProof(null);
      const authEventResult = coordinateAuthenticatedSessionEvent({`,
      "Token refresh invalidates current proof",
    ),
  },
  {
    name: "F7 · conservar prueba ante rechazo autoritativo",
    target: "root",
    barrier: SILENT_REVALIDATION_RESULT_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "      else replaceUserPortalAuthorizationProof(null);\n      const rejectionMessage = multiportalAuth.settlePortalSignOutMessage(access.message);",
      "      else void userPortalAuthorizationProofRef.current;\n      const rejectionMessage = multiportalAuth.settlePortalSignOutMessage(access.message);",
      "Invalid authoritative result retains proof",
    ),
  },
  {
    name: "UI-NAV-01S · descartar continuidad ante error transitorio de la misma identidad",
    target: "root",
    barrier: SILENT_REVALIDATION_RETRYABLE_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      "      if (preserveAuthorizedUserPortal) applySessionState(authState);",
      "      if (false) applySessionState(authState);",
      "Retryable same-identity revalidation discards renderable session",
    ),
  },
  {
    name: "F8 · ejecutar refresh o navegación durante continuidad silenciosa",
    target: "root",
    barrier: SILENT_REVALIDATION_VISUAL_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      '        if (sessionRevalidation.kind === "silent_revalidation") {',
      '        if (sessionRevalidation.kind === "fail_closed") {',
      "Silent revalidation falls through to continuation",
    ),
  },
  {
    name: "F9 · tratar TOKEN_REFRESHED como login interactivo",
    target: "authBoundary",
    barrier: TOKEN_REFRESHED_REACHABILITY_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      `    if (
      deferForInteractiveAttempt
      || portalResolutionOwnersRef.current.hasPending()`,
      `    if (
      deferForInteractiveAttempt
      || event === "TOKEN_REFRESHED"
      || portalResolutionOwnersRef.current.hasPending()`,
      "TOKEN_REFRESHED treated as interactive login",
    ),
  },
  {
    name: "F10 · permitir TOKEN_REFRESHED durante recovery bloqueada",
    target: "authBoundary",
    barrier: TOKEN_REFRESHED_REACHABILITY_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      '    if (event !== "SIGNED_OUT" && isPasswordRecoveryPortalBlocked()) {',
      '    if (event !== "SIGNED_OUT" && event !== "TOKEN_REFRESHED" && isPasswordRecoveryPortalBlocked()) {',
      "TOKEN_REFRESHED bypasses recovery guard",
    ),
  },
  {
    name: "UI-NAV-01S · callback stale borra prueba vigente",
    target: "root",
    barrier: SILENT_REVALIDATION_STALE_BARRIER,
    mutate: (source) => replaceExactlyOnce(
      source,
      `    if (access.state === "stale" || !multiportalAuth.isPortalResolutionCurrent(resolutionOwner)) {
      return null;
    }`,
      `    if (access.state === "stale" || !multiportalAuth.isPortalResolutionCurrent(resolutionOwner)) {
      replaceUserPortalAuthorizationProof(null);
      return null;
    }`,
      "Stale callback clears current proof",
    ),
  },
  {
    name: "montar shell Usuario en Coach",
    target: "authProof",
    barrier: "[UI-NAV-01.mount-guard]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "    && !input.hasCoachPortalSession",
      "    && true",
      "Coach mount",
    ),
  },
  {
    name: "montar shell durante recovery",
    target: "authProof",
    barrier: "[UI-NAV-01.mount-guard]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "    && !input.isPasswordRecoveryBlocked",
      "    && true",
      "Recovery mount",
    ),
  },
  {
    name: "duplicar topbar dentro del shell nuevo",
    target: "shell",
    barrier: "[UI-NAV-01.legacy-exclusive]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "        <UserPortalTopbar\n",
      `        <UserPortalTopbar
          isHidden={isTopbarHidden}
          isDrawerOpen={isDrawerOpen}
          isNotificationPanelOpen={isNotificationPanelOpen}
          notificationBadgeText={notificationBadgeText}
          notificationBadgeAriaLabel={notificationBadgeAriaLabel}
          menuButtonRef={menuButtonRef}
          onMenuToggle={isDrawerOpen ? onClose : onOpen}
          onToggleNotifications={onToggleNotifications}
        />
        <UserPortalTopbar
`,
      "Duplicate topbar",
    ),
  },
  {
    name: "duplicar drawer dentro del shell nuevo",
    target: "shell",
    barrier: "[UI-NAV-01.legacy-exclusive]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "      <UserPortalDrawer\n",
      `      <UserPortalDrawer
        isOpen={isDrawerOpen}
        profile={profile}
        navigation={navigation}
        focusBoundaryRef={drawerRef}
        initialFocusAttribute={OVERLAY_INITIAL_FOCUS_ATTRIBUTE}
        isLogoutDisabled={isLogoutDisabled}
        onAvatarImageError={onAvatarImageError}
        avatarResetKey={avatarResetKey}
        onClose={onClose}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />
      <UserPortalDrawer
`,
      "Duplicate drawer",
    ),
  },
  {
    name: "mapear Entrenemos a pantalla incorrecta",
    target: "model",
    barrier: "[UI-NAV-01.navigation-map]",
    mutate: (source) => replaceExactlyOnce(
      source,
      '  training: "entrenamiento",',
      '  training: "dashboard",',
      "Navigation map",
    ),
  },
  {
    name: "bloquear un destino existente",
    target: "model",
    barrier: "[UI-NAV-01.navigation-enabled]",
    mutate: (source) => replaceExactlyOnce(
      source,
      '{ id: "profile", label: "Mi perfil", kind: "destination", availability: "enabled" }',
      '{ id: "profile", label: "Mi perfil", kind: "destination", availability: "disabled" }',
      "Disabled destination",
    ),
  },
  {
    name: "inventar Mensajes",
    target: "model",
    barrier: "[UI-NAV-01.navigation-labels]",
    mutate: (source) => replaceExactlyOnce(
      source,
      'label: "Comparación semanal"',
      'label: "Mensajes"',
      "Invented destination",
    ),
  },
  {
    name: "crear segunda consulta de perfil",
    target: "shell",
    barrier: "[UI-NAV-01.data-ownership]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "  function handleNavigate(destinationId: UserPortalDestinationId) {",
      '  function handleNavigate(destinationId: UserPortalDestinationId) {\n    void fetch("/profile");',
      "Second profile query",
    ),
  },
  {
    name: "desconectar NotificationPanel del shell",
    target: "root",
    barrier: "[UI-NAV-01.root-wiring]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "        notificationOverlay={notificationOverlay}\n        screenHeader={screenHeader}",
      "        notificationOverlay={null}\n        screenHeader={screenHeader}",
      "NotificationPanel disconnect",
    ),
  },
  {
    name: "duplicar delegación de logout",
    target: "logoutSingleFlight",
    barrier: "[UI-NAV-01.logout-once]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "        await onLogout();",
      "        await onLogout();\n        await onLogout();",
      "Duplicate logout",
    ),
  },
  {
    name: "cambiar logout a global",
    target: "root",
    barrier: "[UI-NAV-01.logout-local]",
    mutate: (source) => replaceExactlyOnce(
      source,
      '          const { error } = await supabase.auth.signOut({ scope: "local" });',
      '          const { error } = await supabase.auth.signOut({ scope: "global" });',
      "Global logout",
    ),
  },
  {
    name: "eliminar focus management",
    target: "shell",
    barrier: "[UI-NAV-01.focus-manager]",
    mutate: (source) => replaceExactlyOnce(
      source,
      `  const drawerRef = useOverlayFocusManagement<HTMLDivElement>({
    isActive: isDrawerOpen,
    onClose,
    canClose: true,
    restoreFocusRef: menuButtonRef,
  });`,
      "  const drawerRef = useRef<HTMLDivElement>(null);",
      "Focus manager",
    ),
  },
  {
    name: "permitir foco en background",
    target: "shell",
    barrier: "[UI-NAV-01.background-inert]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "        inert={isDrawerOpen ? true : undefined}",
      '        data-background-interactive={isDrawerOpen ? "true" : undefined}',
      "Background inert",
    ),
  },
  {
    name: "romper aria-controls",
    target: "topbar",
    barrier: "[UI-NAV-01.notification-aria-controls]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "          aria-controls={NOTIFICATION_PANEL_ID}",
      "          aria-controls={USER_PORTAL_DRAWER_ID}",
      "Notification aria-controls",
    ),
  },
  {
    name: "omitir estado busy de logout",
    target: "drawer",
    barrier: "[UI-NAV-01.logout-busy]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "                      disabled={isLogoutDisabled}",
      '                      data-logout-enabled="true"',
      "Logout busy",
    ),
  },
  {
    name: "desconectar sólo el contrato de integración del runner",
    target: "package",
    barrier: "[UI-NAV-01.runner-external]",
    externalRunner: true,
    mutate: (source) => replaceExactlyOnce(
      source,
      " src/features/user-portal-shell/user-portal-shell-integration.contract.test.ts",
      "",
      "Runner disconnect integration only",
    ),
  },
  {
    name: "renderizar AppShellLayout y UserPortalShell simultáneamente",
    target: "root",
    barrier: "[UI-NAV-01.single-shell]",
    mutate: (source) => {
      const opened = replaceExactlyOnce(
        source,
        "    return (\n      <UserPortalShell",
        "    return (\n      <>\n        <AppShellLayout topbar={null} notificationOverlay={null} navigationOverlay={null} screenHeader={null}>{null}</AppShellLayout>\n        <UserPortalShell",
        "Simultaneous shells open",
      );
      return replaceExactlyOnce(
        opened,
        "      </UserPortalShell>\n    );\n  }\n\n  return (",
        "      </UserPortalShell>\n      </>\n    );\n  }\n\n  return (",
        "Simultaneous shells close",
      );
    },
  },
  {
    name: "permitir fallback productivo con sesión sin prueba Usuario",
    target: "root",
    barrier: "[UI-NAV-01.unproven-fallback]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "    && !hasCurrentUserPortalAuthorizationProof",
      "    && false",
      "Unproven legacy fallback",
    ),
  },
  {
    name: "permitir logout recursivo",
    target: "logoutSingleFlight",
    barrier: "[UI-NAV-01.logout-single-flight]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "      inFlight = true;",
      "      void inFlight;",
      "Recursive logout",
    ),
  },
  {
    name: "convertir Escape en no-op",
    target: "focusManager",
    barrier: "[UI-NAV-01.escape]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "        onCloseRef.current();",
      "        void onCloseRef.current;",
      "Escape no-op",
    ),
  },
  {
    name: "eliminar aria-modal del drawer",
    target: "drawer",
    barrier: "[UI-NAV-01.aria-modal]",
    mutate: (source) => replaceExactlyOnce(
      source,
      '        aria-modal="true"',
      '        data-modal="true"',
      "aria-modal",
    ),
  },
  {
    name: "eliminar cierre por backdrop",
    target: "drawer",
    barrier: "[UI-NAV-01.backdrop-close]",
    mutate: (source) => replaceExactlyOnce(
      source,
      "        tabIndex={-1}\n        onClick={onClose}",
      '        tabIndex={-1}\n        data-backdrop-action="none"',
      "Backdrop close",
    ),
  },
];

test("UI-NAV-01/UI-NAV-01S fija 40/40 mutantes semánticos con TypeScript válido y restauración SHA", () => {
  assert.equal(mutationProbes.length, 40, "conteo fijo de mutantes");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "organizatech-ui-nav-01-"));
  try {
    for (const path of Object.values(paths)) {
      const target = join(temporaryRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(path, target);
    }
    const pristine = readSources(temporaryRoot);

    for (const probe of mutationProbes) {
      const targetPath = join(temporaryRoot, paths[probe.target]);
      const before = readFileSync(targetPath, "utf8");
      const beforeHash = sha256(before);
      try {
        const mutated = probe.mutate(before);
        assert.notEqual(mutated, before, `${probe.name}: mutación efectiva`);
        assert.notEqual(sha256(mutated), beforeHash, `${probe.name}: SHA cambia`);
        assertValidMutatedSource(paths[probe.target], mutated);
        writeFileSync(targetPath, mutated);
        assert.equal(readFileSync(targetPath, "utf8"), mutated, `${probe.name}: source mutado real`);
        assert.equal(sha256(readFileSync(targetPath, "utf8")), sha256(mutated), `${probe.name}: SHA mutado real`);

        if (probe.externalRunner) {
          const result = runExternalRunnerBarrier(targetPath);
          assert.notEqual(result.status, 0, `${probe.name}: npm test externo debe fallar`);
          assert.match(
            `${result.stdout}\n${result.stderr}`,
            /\[UI-NAV-01\.runner-external\]/,
            `${probe.name}: muere en ${probe.barrier}`,
          );
        } else {
          assert.throws(
            () => validateIntegration(readSources(temporaryRoot)),
            (error: unknown) => error instanceof Error && error.message.includes(probe.barrier),
            `${probe.name}: muere en ${probe.barrier}`,
          );
        }
      } finally {
        writeFileSync(targetPath, before);
        const restored = readFileSync(targetPath, "utf8");
        assert.equal(restored, pristine[probe.target], `${probe.name}: restaura bytes`);
        assert.equal(sha256(restored), beforeHash, `${probe.name}: restaura SHA-256`);
      }
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("seis controles inocentes no generan falsos positivos", () => {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const printedShell = printer.printFile(parseSource(paths.shell, baseline.shell));
  const renamedShell = baseline.shell.replaceAll("destinationId", "targetId");
  assert.notEqual(renamedShell, baseline.shell, "rename local efectivo");
  const reorderedRoot = replaceExactlyOnce(
    baseline.root,
    `  const userPortalNavigation = createUserPortalNavigationModel({
    currentScreen: screen,
    visibleScreens: menuScreens,
  });`,
    `  const userPortalNavigation = createUserPortalNavigationModel({
    visibleScreens: menuScreens,
    currentScreen: screen,
  });`,
    "Innocent property reorder",
  );
  const controls: Array<{ target: SourceKey; sources: Sources }> = [
    { target: "shell", sources: { ...baseline, shell: `${baseline.shell}\n// innocent shell\n` } },
    { target: "model", sources: { ...baseline, model: `${baseline.model}\n// innocent model\n` } },
    { target: "css", sources: { ...baseline, css: `${baseline.css}\n/* innocent CSS */\n` } },
    { target: "shell", sources: { ...baseline, shell: renamedShell } },
    { target: "shell", sources: { ...baseline, shell: printedShell } },
    { target: "root", sources: { ...baseline, root: reorderedRoot } },
  ];
  assert.equal(controls.length, 6, "conteo fijo de controles inocentes");
  for (const control of controls) {
    assertValidMutatedSource(paths[control.target], control.sources[control.target]);
    assert.doesNotThrow(() => validateIntegration(control.sources));
  }
});
