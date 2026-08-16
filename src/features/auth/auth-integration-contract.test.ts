import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

const landing = readSource("src/app/page.tsx");
const loginPage = readSource("src/app/login/page.tsx");
const authEntry = readSource("src/features/auth/components/auth-entry-client.tsx");
const root = readSource("src/components/organizatech-app.tsx");
const authScreen = readSource("src/features/auth/components/auth-screen.tsx");
const authStyles = readSource("src/features/auth/components/auth-screen.module.css");
const authRouteController = readSource("src/features/auth/hooks/use-auth-route-controller.ts");

// Landing: cada intención entra al modo y tipo de cuenta autorizados.
assert.match(landing, /className=\{styles\.headerCta\} href="\/login"/);
assert.equal(
  landing.match(/href="\/login\?mode=registro&amp;tipo=usuario"/g)?.length ?? 0,
  0,
  "El JSX debe conservar '&' literal; Next se encarga del escape HTML.",
);
assert.equal(landing.match(/href="\/login\?mode=registro&tipo=usuario"/g)?.length, 2);
assert.match(landing, /className=\{styles\.coachCta\} href="\/login\?mode=registro&tipo=coach"/);

// Entrada estable: /login permanece estática y delega searchParams a una frontera cliente con Suspense.
assert.match(loginPage, /<Suspense fallback=\{<main className="app-shell"><AuthLoadingScreen \/><\/main>\}>/);
assert.doesNotMatch(loginPage, /searchParams|async function Home/);
assert.match(authEntry, /useSearchParams\(\)/);
assert.match(authEntry, /resolveAuthRouteState\(\{/);
assert.match(authEntry, /initialAuthRoute=\{initialAuthRoute\}/);
assert.match(root, /resolveInitialAuthState\(initialPasswordRecoveryRouteState, initialAuthRoute\.mode\)/);
assert.match(authRouteController, /window\.history\.replaceState\(/);
assert.match(authRouteController, /createAuthHref\(nextRoute\)/);

// Composition root: sólo integra la feature; la presentación ya no vive dentro del root.
assert.match(root, /import \{[\s\S]*?AuthScreen,[\s\S]*?\} from "@\/features\/auth\/components\/auth-screen";/);
assert.doesNotMatch(root, /function AuthScreen\(/);
assert.match(root, /buildLoginPayload\(formData\)/);
assert.match(root, /buildUserSignupPayload\(formData\)/);
assert.match(root, /buildCoachRegistrationPayload\(formData\)/);
assert.match(root, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
assert.match(root, /supabase\.auth\.signUp\(signupPayload\)/);
assert.match(root, /authorizeAndContinuePortalSession\(/);
assert.match(root, /continueAuthorizedPortalAccess\(/);
assert.match(root, /loginSubmitOwnerController\.acquire\(\)/);
assert.match(root, /resetPasswordForEmail\(email, \{ redirectTo \}\)/);
assert.doesNotMatch(root, /className="login-shell"|Validando sesión<\/h2>/);
assert.match(root, /<AuthLoadingScreen \/>/);
for (const flowScreen of ["PasswordRecoveryScreen", "RecoveryExpiredScreen", "NewPasswordScreen"]) {
  assert.ok(authScreen.includes(`export function ${flowScreen}`));
}

// Presentación y accesibilidad de login/registro.
for (const marker of [
  "Tipo de cuenta",
  'role="tablist"',
  'role="tab"',
  "aria-selected",
  "Correo electrónico",
  "Contraseña",
  "¿Olvidaste tu contraseña?",
  "Continuar con Google",
  "¿No tienes cuenta? Crea una",
  "Nombre",
  "Apellido",
  "Fecha de nacimiento",
  "Edad",
  "Género",
  "Celular",
  "Correo",
  "Confirmar contraseña",
  "Título de estudios",
  "¿Ya tienes cuenta? Iniciar sesión",
]) {
  assert.ok(authScreen.includes(marker), `Falta el contrato visible/accesible: ${marker}`);
}

assert.match(authScreen, /<Image[^>]+src="\/icon\.svg"/);
assertAuthRegistrationInputContract(authScreen);
runAuthRegistrationInputOrderControls(authScreen);
runAuthRegistrationInputMutationProbes(authScreen);
assert.doesNotMatch(authScreen, /COACH_REGISTRATION_SUBMIT_ENABLED/);
assert.match(authScreen, /action=\{onSubmit\}/);
assert.match(authScreen, /disabled=\{isBusy\}/);
assert.match(authScreen, /fieldErrors\["register-professional-title"\]/);
assert.doesNotMatch(authScreen, /auth-tab-coach[\s\S]{0,300}disabled/);
assert.match(authScreen, /aria-label="Continuar con Google \(no disponible\)"[\s\S]*?disabled/);
assert.doesNotMatch(authScreen, /Apple|aria-label="Correo"/);
assert.doesNotMatch(authScreen, /dangerouslySetInnerHTML/);
assert.doesNotMatch(authScreen, /email@email\.com/);
assert.match(authScreen, /placeholder="nombre@organizatech\.cl"/);

// La fecha y la edad respetan sus columnas incluso con el ancho intrínseco del input date en WebKit.
runCssBraceBalanceContractChecks(authStyles);
assertBirthDateAgeCssContract(authStyles);
runBirthDateAgeMutationProbes(authStyles);

// Errores de campo: asociación individual, invalidación y status general con tono semántico.
assert.match(authScreen, /aria-describedby=\{errorId\}/);
assert.match(authScreen, /aria-invalid=\{Boolean\(error\)\}/);
assert.match(authScreen, /<FieldError id=\{`\$\{id\}-error`\} message=\{error\} \/>/);
assert.match(authScreen, /role=\{tone === "error" \? "alert" : "status"\}/);
assert.doesNotMatch(authScreen, /aria-describedby=\{statusId\}/);

// Contraste AA mínimo para texto pequeño sobre las superficies aprobadas.
for (const [foreground, background, label] of [
  ["#b6c0cc", "#27313d", "tab inactivo y ayudas"],
  ["#bdc6d1", "#27313d", "botón inferior"],
  ["#aeb8c5", "#27313d", "placeholders"],
  ["#c0c8d2", "#27313d", "edad read-only"],
  ["#aab4c1", "#07101a", "separador"],
] as const) {
  assert.ok(authStyles.toLowerCase().includes(foreground), `Falta el color de ${label}`);
  assert.ok(contrastRatio(foreground, background) >= 4.5, `${label} no alcanza WCAG AA`);
}

console.log("auth-integration contract tests passed");

type AuthJsxOpeningLikeElement = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

interface ParsedAuthJsx {
  sourceFile: ts.SourceFile;
  elements: AuthJsxOpeningLikeElement[];
}

interface AuthJsxTarget {
  parsed: ParsedAuthJsx;
  element: AuthJsxOpeningLikeElement;
  attributes: ts.JsxAttribute[];
}

function parseAuthJsx(source: string): ParsedAuthJsx {
  const sourceFile = ts.createSourceFile(
    "auth-screen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
  assert.equal(
    parseDiagnostics.length,
    0,
    `[auth-jsx.syntax] La mutación debe conservar sintaxis TSX válida: ${parseDiagnostics.map((diagnostic) => diagnostic.messageText).join(" | ")}`,
  );

  const elements: AuthJsxOpeningLikeElement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, elements };
}

function findUniqueFunctionDeclaration(
  parsed: ParsedAuthJsx,
  name: string,
  assertionName: string,
): ts.FunctionDeclaration & { body: ts.Block } {
  const functions = parsed.sourceFile.statements.filter((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  ));
  assert.equal(
    functions.length,
    1,
    `[${assertionName}] ${name} debe tener una única implementación ejecutable.`,
  );
  assert.ok(functions[0].body, `[${assertionName}] ${name} debe conservar su cuerpo ejecutable.`);
  return functions[0] as ts.FunctionDeclaration & { body: ts.Block };
}

function collectJsxElements(node: ts.Node) {
  const elements: AuthJsxOpeningLikeElement[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      elements.push(current);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return elements;
}

function jsxAttributeName(attribute: ts.JsxAttribute, sourceFile: ts.SourceFile) {
  return attribute.name.getText(sourceFile);
}

function jsxAttributes(
  element: AuthJsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
  name: string,
) {
  return element.attributes.properties.filter((property): property is ts.JsxAttribute => (
    ts.isJsxAttribute(property) && jsxAttributeName(property, sourceFile) === name
  ));
}

function literalJsxString(attribute: ts.JsxAttribute | undefined) {
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function findAuthJsxTarget(parsed: ParsedAuthJsx, id: string, assertionName: string): AuthJsxTarget {
  const matches = parsed.elements.filter((element) => (
    jsxAttributes(element, parsed.sourceFile, "id").some((attribute) => (
      literalJsxString(attribute) === id
    ))
  ));
  assert.equal(
    matches.length,
    1,
    `[${assertionName}.unique-id] Debe existir exactamente un elemento JSX con id literal "${id}".`,
  );
  const element = matches[0];
  const idAttributes = jsxAttributes(element, parsed.sourceFile, "id");
  assert.equal(
    idAttributes.length,
    1,
    `[${assertionName}.id-attribute] El elemento ${id} debe declarar id exactamente una vez.`,
  );
  assert.equal(
    literalJsxString(idAttributes[0]),
    id,
    `[${assertionName}.id-literal] El id ${id} debe ser un literal estático.`,
  );
  return {
    parsed,
    element,
    attributes: element.attributes.properties.filter(ts.isJsxAttribute),
  };
}

function assertNoTargetSpreads(target: AuthJsxTarget, assertionName: string) {
  const spreads = target.element.attributes.properties.filter(ts.isJsxSpreadAttribute);
  assert.equal(
    spreads.length,
    0,
    `[${assertionName}] El elemento auditado no puede reconstruir atributos mediante spread.`,
  );
}

function getUniqueTargetAttribute(target: AuthJsxTarget, name: string, assertionName: string) {
  const attributes = target.attributes.filter((attribute) => (
    jsxAttributeName(attribute, target.parsed.sourceFile) === name
  ));
  assert.equal(
    attributes.length,
    1,
    `[${assertionName}] ${name} debe existir exactamente una vez en el elemento auditado.`,
  );
  return attributes[0];
}

function assertLiteralTargetAttribute(
  target: AuthJsxTarget,
  name: string,
  expected: string,
  assertionName: string,
) {
  const attribute = getUniqueTargetAttribute(target, name, assertionName);
  assert.equal(
    literalJsxString(attribute),
    expected,
    `[${assertionName}] ${name} debe ser el literal "${expected}".`,
  );
}

function assertForwardedIdentifierAttribute(
  target: AuthJsxTarget,
  name: string,
  identifier: string,
) {
  const assertionName = `auth-text-field.${name}-forwarding`;
  const attribute = getUniqueTargetAttribute(target, name, assertionName);
  const initializer = attribute.initializer;
  assert.ok(
    initializer && ts.isJsxExpression(initializer) && initializer.expression
      && ts.isIdentifier(initializer.expression) && initializer.expression.text === identifier,
    `[${assertionName}] El input nativo debe reenviar ${name}={${identifier}} sin reconstrucciones.`,
  );
}

function assertAuthTextFieldInputForwarding(parsed: ParsedAuthJsx) {
  const component = findUniqueFunctionDeclaration(
    parsed,
    "AuthTextField",
    "auth-text-field.unique-component",
  );
  const nativeInputs = collectJsxElements(component.body).filter((element) => (
    element.tagName.getText(parsed.sourceFile) === "input"
  ));
  assert.equal(
    nativeInputs.length,
    1,
    "[auth-text-field.unique-native-input] AuthTextField debe renderizar exactamente un input nativo.",
  );
  const target: AuthJsxTarget = {
    parsed,
    element: nativeInputs[0],
    attributes: nativeInputs[0].attributes.properties.filter(ts.isJsxAttribute),
  };
  assertNoTargetSpreads(target, "auth-text-field.attributes-spread");
  assertForwardedIdentifierAttribute(target, "id", "id");
  assertForwardedIdentifierAttribute(target, "name", "name");
  assertForwardedIdentifierAttribute(target, "type", "type");
}

function assertRegistrationFieldsOwnership(
  parsed: ParsedAuthJsx,
  targets: readonly AuthJsxTarget[],
) {
  const registrationFields = findUniqueFunctionDeclaration(
    parsed,
    "RegistrationFields",
    "registration-fields.unique-component",
  );
  const ownedElements = collectJsxElements(registrationFields.body);
  const ownedElementSet = new Set(ownedElements);
  for (const target of targets) {
    assert.ok(
      ownedElementSet.has(target.element),
      "[registration-fields.target-ownership] Los IDs auditados deben pertenecer a RegistrationFields, no a elementos señuelo.",
    );
  }

  for (const element of ownedElements) {
    assert.equal(
      element.attributes.properties.filter(ts.isJsxSpreadAttribute).length,
      0,
      "[registration-fields.attributes-spread] RegistrationFields no puede reconstruir atributos mediante spreads.",
    );
    for (const idAttribute of jsxAttributes(element, parsed.sourceFile, "id")) {
      assert.ok(
        literalJsxString(idAttribute) !== null,
        "[registration-fields.id-literal] Los IDs de RegistrationFields deben ser literales estáticos.",
      );
    }
  }
}

function assertAuthRegistrationInputContract(source: string) {
  const parsed = parseAuthJsx(source);
  assertAuthTextFieldInputForwarding(parsed);

  const birthDate = findAuthJsxTarget(parsed, "register-birth-date", "register-birth-date");
  assert.equal(
    birthDate.element.tagName.getText(parsed.sourceFile),
    "AuthTextField",
    "[register-birth-date.element] La fecha debe usar el campo que renderiza el input nativo auditado.",
  );
  assertNoTargetSpreads(birthDate, "register-birth-date.attributes-spread");
  assertLiteralTargetAttribute(birthDate, "type", "date", "register-birth-date.type");

  const age = findAuthJsxTarget(parsed, "register-age", "register-age");
  assert.equal(
    age.element.tagName.getText(parsed.sourceFile),
    "input",
    "[register-age.element] Edad debe permanecer como un input nativo único.",
  );
  assertNoTargetSpreads(age, "register-age.name-spread");
  assert.equal(
    jsxAttributes(age.element, parsed.sourceFile, "name").length,
    0,
    "[register-age.name-absent] El input Edad no puede declarar name en ninguna posición.",
  );

  const readOnly = getUniqueTargetAttribute(age, "readOnly", "register-age.readOnly");
  assert.equal(
    readOnly.initializer,
    undefined,
    "[register-age.readOnly] Edad debe conservar readOnly como atributo booleano estático.",
  );
  assertLiteralTargetAttribute(age, "aria-readonly", "true", "register-age.aria-readonly");

  const tabIndex = getUniqueTargetAttribute(age, "tabIndex", "register-age.tabIndex");
  const tabIndexInitializer = tabIndex.initializer;
  assert.ok(
    tabIndexInitializer
      && ts.isJsxExpression(tabIndexInitializer)
      && tabIndexInitializer.expression
      && ts.isPrefixUnaryExpression(tabIndexInitializer.expression)
      && tabIndexInitializer.expression.operator === ts.SyntaxKind.MinusToken
      && ts.isNumericLiteral(tabIndexInitializer.expression.operand)
      && tabIndexInitializer.expression.operand.text === "1",
    "[register-age.tabIndex] Edad debe conservar tabIndex={-1} sin reconstrucciones.",
  );

  assertRegistrationFieldsOwnership(parsed, [birthDate, age]);
}

function getTargetAndAttributeForMutation(source: string, id: string, attributeName: string) {
  const parsed = parseAuthJsx(source);
  const target = findAuthJsxTarget(parsed, id, `probe.${id}`);
  const attribute = getUniqueTargetAttribute(target, attributeName, `probe.${id}.${attributeName}`);
  return { parsed, target, attribute };
}

function replaceJsxAttribute(source: string, id: string, attributeName: string, replacement: string) {
  const { parsed, attribute } = getTargetAndAttributeForMutation(source, id, attributeName);
  return `${source.slice(0, attribute.getStart(parsed.sourceFile))}${replacement}${source.slice(attribute.end)}`;
}

function removeJsxAttribute(source: string, id: string, attributeName: string) {
  return replaceJsxAttribute(source, id, attributeName, "");
}

function insertJsxAttributeRelativeToId(
  source: string,
  id: string,
  attributeSource: string,
  position: "before" | "after",
) {
  const { parsed, attribute } = getTargetAndAttributeForMutation(source, id, "id");
  const insertionIndex = position === "before" ? attribute.getStart(parsed.sourceFile) : attribute.end;
  const insertion = position === "before" ? `${attributeSource} ` : ` ${attributeSource}`;
  return `${source.slice(0, insertionIndex)}${insertion}${source.slice(insertionIndex)}`;
}

function insertSiblingAfterTarget(source: string, id: string, siblingSource: string) {
  const parsed = parseAuthJsx(source);
  const target = findAuthJsxTarget(parsed, id, `probe.${id}`);
  return `${source.slice(0, target.element.end)}\n        ${siblingSource}${source.slice(target.element.end)}`;
}

function duplicateTargetElement(source: string, id: string) {
  const parsed = parseAuthJsx(source);
  const target = findAuthJsxTarget(parsed, id, `probe.${id}`);
  const elementSource = source.slice(target.element.getStart(parsed.sourceFile), target.element.end);
  return `${source.slice(0, target.element.end)}\n        ${elementSource}${source.slice(target.element.end)}`;
}

function moveJsxAttributeBefore(source: string, id: string, attributeName: string) {
  const { parsed, attribute } = getTargetAndAttributeForMutation(source, id, attributeName);
  const attributeSource = source.slice(attribute.getStart(parsed.sourceFile), attribute.end);
  const withoutAttribute = `${source.slice(0, attribute.getStart(parsed.sourceFile))}${source.slice(attribute.end)}`;
  return insertJsxAttributeRelativeToId(withoutAttribute, id, attributeSource, "before");
}

function runAuthRegistrationInputOrderControls(source: string) {
  const reorderedBirthDate = moveJsxAttributeBefore(source, "register-birth-date", "type");
  const reordered = moveJsxAttributeBefore(reorderedBirthDate, "register-age", "tabIndex");
  assert.notEqual(reordered, source, "El control de orden debe reordenar atributos realmente.");
  parseAuthJsx(reordered);
  assertAuthRegistrationInputContract(reordered);
  assert.equal(
    readSource("src/features/auth/components/auth-screen.tsx"),
    source,
    "El control de orden debe conservar auth-screen.tsx byte a byte.",
  );
  console.log("AUTH-01 registration input AST order controls passed");
}

function runAuthRegistrationInputMutationProbes(source: string) {
  const probes: Array<{
    name: string;
    assertion: string;
    mutate: (current: string) => string;
  }> = [
    {
      name: "cambiar fecha a type text",
      assertion: "register-birth-date.type",
      mutate: (current) => replaceJsxAttribute(current, "register-birth-date", "type", 'type="text"'),
    },
    {
      name: "eliminar type de fecha",
      assertion: "register-birth-date.type",
      mutate: (current) => removeJsxAttribute(current, "register-birth-date", "type"),
    },
    {
      name: "dejar type date sólo en comentario JSX",
      assertion: "register-birth-date.type",
      mutate: (current) => insertSiblingAfterTarget(
        removeJsxAttribute(current, "register-birth-date", "type"),
        "register-birth-date",
        '{/* type="date" */}',
      ),
    },
    {
      name: "dejar type date sólo dentro de un string JSX",
      assertion: "register-birth-date.type",
      mutate: (current) => insertSiblingAfterTarget(
        removeJsxAttribute(current, "register-birth-date", "type"),
        "register-birth-date",
        '<span data-contract-decoy={\'type="date"\'} />',
      ),
    },
    {
      name: "mover type date a un input señuelo",
      assertion: "register-birth-date.type",
      mutate: (current) => insertSiblingAfterTarget(
        removeJsxAttribute(current, "register-birth-date", "type"),
        "register-birth-date",
        '<input type="date" aria-hidden="true" />',
      ),
    },
    {
      name: "duplicar id register-birth-date",
      assertion: "register-birth-date.unique-id",
      mutate: (current) => duplicateTargetElement(current, "register-birth-date"),
    },
    {
      name: "agregar name antes del id de Edad",
      assertion: "register-age.name-absent",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        'name="register-age"',
        "before",
      ),
    },
    {
      name: "agregar name después del id de Edad",
      assertion: "register-age.name-absent",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        'name="register-age"',
        "after",
      ),
    },
    {
      name: "agregar name dinámico a Edad",
      assertion: "register-age.name-absent",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        'name={String("register-age")}',
        "after",
      ),
    },
    {
      name: "inyectar name de Edad mediante spread",
      assertion: "register-age.name-spread",
      mutate: (current) => insertJsxAttributeRelativeToId(
        current,
        "register-age",
        '{...{ name: "register-age" }}',
        "after",
      ),
    },
    {
      name: "duplicar id register-age",
      assertion: "register-age.unique-id",
      mutate: (current) => duplicateTargetElement(current, "register-age"),
    },
    {
      name: "eliminar readOnly de Edad",
      assertion: "register-age.readOnly",
      mutate: (current) => removeJsxAttribute(current, "register-age", "readOnly"),
    },
    {
      name: "eliminar aria-readonly de Edad",
      assertion: "register-age.aria-readonly",
      mutate: (current) => removeJsxAttribute(current, "register-age", "aria-readonly"),
    },
    {
      name: "eliminar tabIndex de Edad",
      assertion: "register-age.tabIndex",
      mutate: (current) => removeJsxAttribute(current, "register-age", "tabIndex"),
    },
  ];

  for (const probe of probes) {
    const mutated = probe.mutate(source);
    assert.notEqual(mutated, source, `El probe no alteró auth-screen.tsx: ${probe.name}`);
    parseAuthJsx(mutated);
    assert.throws(
      () => assertAuthRegistrationInputContract(mutated),
      (error: unknown) => (
        error instanceof assert.AssertionError && error.message.includes(`[${probe.assertion}]`)
      ),
      `El contrato AST no rechazó por su aserción específica: ${probe.name}`,
    );
    assert.equal(
      readSource("src/features/auth/components/auth-screen.tsx"),
      source,
      `El probe no conservó auth-screen.tsx byte a byte: ${probe.name}`,
    );
  }

  console.log(`AUTH-01 registration input AST mutation probes passed (${probes.length}/${probes.length})`);
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/../g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

interface StructuredCssRule {
  selector: string;
  body: string;
  bodyStart: number;
  bodyEnd: number;
  atRules: string[];
}

interface CssDeclaration {
  property: string;
  value: string;
}

function topLevelRule(rule: StructuredCssRule) {
  return rule.atRules.length === 0;
}

function mobileRule(rule: StructuredCssRule) {
  return rule.atRules.some((atRule) => normalizeCssText(atRule) === "@media (max-width: 360px)");
}

function iosWebKitRule(rule: StructuredCssRule) {
  return rule.atRules.some((atRule) => (
    normalizeCssText(atRule) === "@supports (-webkit-touch-callout: none)"
  ));
}

function assertBirthDateAgeCssContract(source: string) {
  const rules = extractStructuredCssRules(source);
  const birthRow = getUniqueCssRule(rules, ".birthRow", topLevelRule, "birth-row.selector");
  assertCssDeclaration(
    birthRow,
    "grid-template-columns",
    "minmax(0, 1.45fr) minmax(92px, 0.85fr)",
    "birth-row.grid-template-columns",
  );
  assertCssDeclaration(birthRow, "align-items", "start", "birth-row.align-items");

  const birthField = getUniqueCssRule(rules, ".birthRow > .field", topLevelRule, "birth-field.selector");
  assertCssDeclaration(birthField, "min-width", "0", "birth-field.min-width");
  assertCssDeclaration(birthField, "max-width", "100%", "birth-field.max-width");
  assertCssDeclaration(birthField, "min-inline-size", "0", "birth-field.min-inline-size");
  assertCssDeclaration(birthField, "max-inline-size", "100%", "birth-field.max-inline-size");

  const birthInput = getUniqueCssRule(
    rules,
    ".birthRow > .field > input",
    topLevelRule,
    "birth-input.selector",
  );
  for (const [property, value] of [
    ["display", "block"],
    ["width", "100%"],
    ["min-width", "0"],
    ["max-width", "100%"],
    ["inline-size", "100%"],
    ["min-inline-size", "0"],
    ["max-inline-size", "100%"],
  ] as const) {
    assertCssDeclaration(birthInput, property, value, `birth-input.${property}`);
  }

  const stackedBirthRow = getUniqueCssRule(rules, ".birthRow", mobileRule, "birth-mobile.selector");
  assertCssDeclaration(
    stackedBirthRow,
    "grid-template-columns",
    "1fr",
    "birth-mobile.grid-template-columns",
  );

  const iosDateInput = getUniqueCssRule(
    rules,
    '.field input[type="date"]',
    iosWebKitRule,
    "birth-ios-date.selector",
  );
  assertCssDeclaration(iosDateInput, "-webkit-appearance", "none", "birth-ios-date.webkit-appearance");
  assertCssDeclaration(iosDateInput, "appearance", "none", "birth-ios-date.appearance");

  const iosDateValue = getUniqueCssRule(
    rules,
    '.field input[type="date"]::-webkit-date-and-time-value',
    iosWebKitRule,
    "birth-ios-date-value.selector",
  );
  assertCssDeclaration(iosDateValue, "height", "1.5em", "birth-ios-date-value.height");
  assertCssDeclaration(iosDateValue, "text-align", "left", "birth-ios-date-value.text-align");
}

function runBirthDateAgeMutationProbes(source: string) {
  const probes: Array<{
    name: string;
    assertion: string;
    mutate: (current: string) => string;
  }> = [
    {
      name: "retirar min-inline-size",
      assertion: "birth-input.min-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        removeDeclaration(body, "min-inline-size")
      )),
    },
    {
      name: "retirar max-inline-size",
      assertion: "birth-input.max-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        removeDeclaration(body, "max-inline-size")
      )),
    },
    {
      name: "mover propiedades a otro selector",
      assertion: "birth-field.min-inline-size",
      mutate: (current) => `${mutateRuleBody(current, ".birthRow > .field", topLevelRule, (body) => (
        removeDeclaration(removeDeclaration(body, "min-inline-size"), "max-inline-size")
      ))}\n.birthRowDecoy { min-inline-size: 0; max-inline-size: 100%; }\n`,
    },
    {
      name: "reemplazar las columnas por tracks sin minmax",
      assertion: "birth-row.grid-template-columns",
      mutate: (current) => mutateRuleBody(current, ".birthRow", topLevelRule, (body) => (
        replaceDeclaration(body, "grid-template-columns", "1.45fr 0.85fr")
      )),
    },
    {
      name: "eliminar align-items start",
      assertion: "birth-row.align-items",
      mutate: (current) => mutateRuleBody(current, ".birthRow", topLevelRule, (body) => (
        removeDeclaration(body, "align-items")
      )),
    },
    {
      name: "introducir width 900px",
      assertion: "birth-input.width",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        replaceDeclaration(body, "width", "900px")
      )),
    },
    {
      name: "cambiar min-width cero por auto",
      assertion: "birth-field.min-width",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field", topLevelRule, (body) => (
        replaceDeclaration(body, "min-width", "auto")
      )),
    },
    {
      name: "dejar propiedades sólo en comentario",
      assertion: "birth-input.min-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        `${removeDeclaration(removeDeclaration(body, "min-inline-size"), "max-inline-size")}
  /* min-inline-size: 0; max-inline-size: 100%; */\n`
      )),
    },
    {
      name: "dejar propiedades sólo dentro de un string",
      assertion: "birth-input.min-inline-size",
      mutate: (current) => mutateRuleBody(current, ".birthRow > .field > input", topLevelRule, (body) => (
        `${removeDeclaration(removeDeclaration(body, "min-inline-size"), "max-inline-size")}
  content: "min-inline-size: 0; max-inline-size: 100%;";\n`
      )),
    },
    {
      name: "vaciar bloque real y usar bloque señuelo",
      assertion: "birth-input.display",
      mutate: (current) => `${mutateRuleBody(
        current,
        ".birthRow > .field > input",
        topLevelRule,
        () => "\n",
      )}\n.decoyInput { display: block; width: 100%; min-width: 0; max-width: 100%; inline-size: 100%; min-inline-size: 0; max-inline-size: 100%; }\n`,
    },
    {
      name: "reducir birthRow a una columna fuera del breakpoint",
      assertion: "birth-row.grid-template-columns",
      mutate: (current) => mutateRuleBody(current, ".birthRow", topLevelRule, (body) => (
        replaceDeclaration(body, "grid-template-columns", "1fr")
      )),
    },
    {
      name: "eliminar apilado móvil",
      assertion: "birth-mobile.grid-template-columns",
      mutate: (current) => mutateRuleBody(current, ".birthRow", mobileRule, (body) => (
        removeDeclaration(body, "grid-template-columns")
      )),
    },
  ];

  assert.equal(probes.length, 12, "El contrato debe conservar los 12 mutation probes de Fecha/Edad.");
  for (const probe of probes) {
    const mutated = probe.mutate(source);
    assert.notEqual(mutated, source, `El probe no alteró el CSS: ${probe.name}`);
    assert.throws(
      () => assertBirthDateAgeCssContract(mutated),
      (error: unknown) => (
        error instanceof assert.AssertionError && error.message.includes(`[${probe.assertion}]`)
      ),
      `El contrato no rechazó por su aserción específica: ${probe.name}`,
    );
  }

  console.log(`AUTH-01 Fecha/Edad mutation probes passed (${probes.length}/12)`);
}

function runCssBraceBalanceContractChecks(source: string) {
  assert.throws(
    () => extractStructuredCssRules(`${source}\n}`),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.braces.unexpected-close")
    ),
    "El parser debe rechazar una llave de cierre huérfana por css.braces.unexpected-close.",
  );

  const innocentCss = String.raw`
.example::before {
  content: "}";
}

.singleQuote::before {
  content: '}';
}

.escapedQuote::before {
  content: "\"}";
}

/* comentario con } */
@supports (display: grid) {
  .nested {
    display: grid;
  }
}
`;
  const innocentRules = extractStructuredCssRules(innocentCss);
  assert.ok(
    innocentRules.some((rule) => (
      rule.selector === ".nested"
      && rule.atRules.some((atRule) => normalizeCssText(atRule) === "@supports (display: grid)")
    )),
    "El scanner debe aceptar una regla válida anidada dentro de @supports.",
  );

  assert.throws(
    () => extractStructuredCssRules(".unclosed { color: red;"),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.braces.unclosed-open")
    ),
    "El parser debe distinguir una llave de apertura sin cierre.",
  );
  assert.throws(
    () => extractStructuredCssRules(".unclosed { /* comentario"),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.comments.unclosed")
    ),
    "El parser debe rechazar comentarios sin cierre.",
  );
  assert.throws(
    () => extractStructuredCssRules('.unclosed { content: "string sin cierre; }'),
    (error: unknown) => (
      error instanceof assert.AssertionError && error.message.includes("css.strings.unclosed")
    ),
    "El parser debe rechazar strings sin cierre.",
  );

  console.log("AUTH-01 CSS global brace-balance contract passed");
}

function extractStructuredCssRules(source: string) {
  assertCssGlobalBraceBalance(source);
  return parseCssRange(source, 0, source.length, []);
}

function assertCssGlobalBraceBalance(source: string) {
  let depth = 0;
  let quote = "";
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (character === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }

    if (character === "/" && next === "*") {
      inComment = true;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "\\") {
      index += 1;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      assert.ok(
        depth >= 0,
        `[css.braces.unexpected-close] Llave de cierre sin apertura en el índice ${index}.`,
      );
    }
  }

  assert.ok(!inComment, "[css.comments.unclosed] Comentario CSS sin cierre.");
  assert.equal(quote, "", "[css.strings.unclosed] String CSS sin cierre.");
  assert.equal(depth, 0, `[css.braces.unclosed-open] Quedaron ${depth} llaves de apertura sin cierre.`);
}

function parseCssRange(source: string, start: number, end: number, atRules: string[]): StructuredCssRule[] {
  const rules: StructuredCssRule[] = [];
  let cursor = start;

  while (cursor < end) {
    const openBrace = findNextCssCharacter(source, "{", cursor, end);
    if (openBrace === -1) break;
    const closeBrace = findMatchingCssBrace(source, openBrace, end);
    assert.notEqual(closeBrace, -1, "CSS inválido: bloque sin cierre.");

    const header = normalizeCssText(stripCssComments(source.slice(cursor, openBrace)).replace(/^;+/, ""));
    const bodyStart = openBrace + 1;
    const bodyEnd = closeBrace;
    const body = source.slice(bodyStart, bodyEnd);

    if (header.startsWith("@")) {
      rules.push(...parseCssRange(source, bodyStart, bodyEnd, [...atRules, header]));
    } else if (header) {
      rules.push({ selector: header, body, bodyStart, bodyEnd, atRules });
    }

    cursor = closeBrace + 1;
  }

  return rules;
}

function getUniqueCssRule(
  rules: StructuredCssRule[],
  selector: string,
  context: (rule: StructuredCssRule) => boolean,
  assertionName: string,
) {
  const matches = rules.filter((rule) => rule.selector === selector && context(rule));
  assert.equal(matches.length, 1, `[${assertionName}] se esperaba una única regla estructural ${selector}.`);
  return matches[0];
}

function assertCssDeclaration(
  rule: StructuredCssRule,
  property: string,
  expectedValue: string,
  assertionName: string,
) {
  const declarations = parseCssDeclarations(rule.body).filter((declaration) => declaration.property === property);
  assert.equal(
    declarations.length,
    1,
    `[${assertionName}] ${rule.selector} debe declarar ${property} exactamente una vez dentro de su bloque.`,
  );
  assert.equal(
    declarations[0]?.value,
    expectedValue,
    `[${assertionName}] ${rule.selector} debe declarar ${property}: ${expectedValue}.`,
  );
}

function parseCssDeclarations(body: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  let statementStart = 0;
  let quote = "";
  let parenthesisDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index] ?? ";";
    const next = body[index + 1];

    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      index = findCssCommentEnd(body, index + 2);
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parenthesisDepth += 1;
    else if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === "{" && parenthesisDepth === 0 && bracketDepth === 0) {
      const closeBrace = findMatchingCssBrace(body, index, body.length);
      assert.notEqual(closeBrace, -1, "CSS inválido: regla anidada sin cierre.");
      index = closeBrace;
      statementStart = closeBrace + 1;
    } else if (character === ";" && parenthesisDepth === 0 && bracketDepth === 0) {
      const declaration = parseCssDeclaration(body.slice(statementStart, index));
      if (declaration) declarations.push(declaration);
      statementStart = index + 1;
    }
  }

  return declarations;
}

function parseCssDeclaration(statement: string): CssDeclaration | null {
  const normalized = stripCssComments(statement).trim();
  if (!normalized) return null;
  const colon = findNextCssCharacter(normalized, ":", 0, normalized.length);
  if (colon === -1) return null;
  const property = normalized.slice(0, colon).trim().toLowerCase();
  if (!/^[-a-z]+$/.test(property)) return null;
  return { property, value: normalizeCssText(normalized.slice(colon + 1)) };
}

function mutateRuleBody(
  source: string,
  selector: string,
  context: (rule: StructuredCssRule) => boolean,
  mutate: (body: string) => string,
) {
  const rule = getUniqueCssRule(extractStructuredCssRules(source), selector, context, `probe.${selector}`);
  const body = mutate(rule.body);
  assert.notEqual(body, rule.body, `El probe no modificó el bloque ${selector}.`);
  return `${source.slice(0, rule.bodyStart)}${body}${source.slice(rule.bodyEnd)}`;
}

function removeDeclaration(body: string, property: string) {
  return replaceDeclarationStatement(body, property, "");
}

function replaceDeclaration(body: string, property: string, value: string) {
  return replaceDeclarationStatement(body, property, `${property}: ${value};`);
}

function replaceDeclarationStatement(body: string, property: string, replacement: string) {
  const pattern = new RegExp(`(^|\\n)([ \\t]*)${escapeRegExp(property)}\\s*:[^;]+;`, "m");
  assert.match(body, pattern, `El fixture debe declarar ${property}.`);
  return body.replace(pattern, (_match, lineStart: string, indentation: string) => (
    replacement ? `${lineStart}${indentation}${replacement}` : lineStart
  ));
}

function findNextCssCharacter(source: string, target: string, start: number, end: number) {
  let quote = "";
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === "/" && next === "*") {
      index = findCssCommentEnd(source, index + 2);
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === target) {
      return index;
    }
  }
  return -1;
}

function findMatchingCssBrace(source: string, openBrace: number, end: number) {
  let depth = 0;
  let quote = "";
  for (let index = openBrace; index < end; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      index = findCssCommentEnd(source, index + 2);
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function stripCssComments(source: string) {
  let result = "";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      result += character;
      if (character === "\\" && next) result += source[++index];
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
      result += character;
    } else if (character === "/" && next === "*") {
      const commentEnd = findCssCommentEnd(source, index + 2);
      result += source.slice(index, commentEnd + 1).replace(/[^\n]/g, " ");
      index = commentEnd;
    } else {
      result += character;
    }
  }
  return result;
}

function findCssCommentEnd(source: string, contentStart: number) {
  const end = source.indexOf("*/", contentStart);
  assert.notEqual(end, -1, "CSS inválido: comentario sin cierre.");
  return end + 1;
}

function normalizeCssText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
