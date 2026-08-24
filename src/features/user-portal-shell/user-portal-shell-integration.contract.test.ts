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

const BASE_SHA = "8b98ac9774fd7512191551234ebf4ee61fe36181";

const paths = {
  root: "src/components/organizatech-app.tsx",
  authProof: "src/features/auth/model/user-portal-authorization-proof.ts",
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
};

const EXPECTED_IDS = [
  "profile",
  "dashboard",
  "training",
  "comparison",
  "edit-cycle",
  "cycle-history",
  "logout",
];

const EXPECTED_LABELS = [
  "Mi perfil",
  "Panel principal",
  "Entrenemos",
  "Comparación semanal",
  "Modificar ciclo de entrenamiento",
  "Historial ciclo de entrenamiento",
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
    "authorizeAndContinuePortalSession",
    "clearUserSessionState",
    "handleCoachIdentitySwitch",
    "handleAuth",
    "handleLogout",
  ]) requireProofClear(name);

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
    "[UI-NAV-01.proof-stale] stale o owner reemplazado no publica",
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
  assert.equal(publications.length, 1, "[UI-NAV-01.proof-publication] publicación única");
  assert.ok(
    publications[0].pos > awaitContinuations[0].pos,
    "[UI-NAV-01.proof-publication] prueba se publica después de continuación vigente",
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
  ]) assert.ok(rootImports.includes(requiredImport), `[UI-NAV-01.root-import] falta ${requiredImport}`);

  assertExclusiveShellReturns(sources.root);
  assertAuthorizationBoundary(sources);

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
    navigationItems.some(({ label }) => label === "Calendario" || label === "Mensajes"),
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
    sources.model,
    sources.logoutSingleFlight,
    sources.shell,
    sources.topbar,
    sources.drawer,
  ].join("\n");
  const featureImports = [
    ...moduleSpecifiers(paths.authProof, sources.authProof),
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

test("Auth, Coach, NotificationPanel, perfil y fallbacks legacy conservan paridad byte a byte", () => {
  for (const path of [
    "src/features/auth/components/auth-screen.tsx",
    "src/features/auth/hooks/use-multiportal-auth-boundary.ts",
    "src/features/auth/model/password-recovery-portal-guard.ts",
    "src/features/coach-portal/components/coach-portal.tsx",
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
    name: "inventar Calendario o Mensajes",
    target: "model",
    barrier: "[UI-NAV-01.navigation-labels]",
    mutate: (source) => replaceExactlyOnce(
      source,
      'label: "Comparación semanal"',
      'label: "Calendario"',
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
      '        const { error } = await supabase.auth.signOut({ scope: "local" });',
      '        const { error } = await supabase.auth.signOut({ scope: "global" });',
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

test("UI-NAV-01 fija 23/23 mutantes semánticos con TypeScript válido y restauración SHA", () => {
  assert.equal(mutationProbes.length, 23, "conteo fijo de mutantes");
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
