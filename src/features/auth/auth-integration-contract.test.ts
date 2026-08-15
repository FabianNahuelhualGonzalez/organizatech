import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
assert.match(root, /supabase\.auth\.signInWithPassword\(\{ email, password \}\)/);
assert.match(root, /supabase\.auth\.signUp\(signupPayload\)/);
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
assert.match(authScreen, /id="register-age" value=\{age \?\? ""\}[^>]+readOnly/);
assert.doesNotMatch(authScreen, /id="register-age"[^>]+name=/);
assert.match(authScreen, /COACH_REGISTRATION_SUBMIT_ENABLED/);
assert.match(authScreen, /disabled=\{isBusy \|\| \(isCoachRegistration && !COACH_REGISTRATION_SUBMIT_ENABLED\)\}/);
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
