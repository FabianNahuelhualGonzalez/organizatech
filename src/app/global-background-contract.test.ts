import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

function readSource(path: string) {
  return readFileSync(path, "utf8");
}

function walk(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const absolute = join(path, entry);
    return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
  });
}

const globals = readSource("src/app/globals.css");
const layout = readSource("src/app/layout.tsx");
const manifest = readSource("public/manifest.json");
const landingStyles = readSource("src/app/page.module.css");
const qaCyclesClient = readSource("src/app/qa/training-cycles/training-cycles-qa-client.tsx");
const authScreen = readSource("src/features/auth/components/auth-screen.tsx");

assert.match(globals, /:root\s*\{[\s\S]*?--background:\s*#07101A;/);
assert.match(globals, /html\s*\{[\s\S]*?background:\s*var\(--background\);/);
assert.match(globals, /body\s*\{[\s\S]*?background-color:\s*var\(--background\);/);
assert.match(layout, /themeColor:\s*"#07101A"/);
assert.equal(JSON.parse(manifest).background_color, "#07101A");
assert.equal(JSON.parse(manifest).theme_color, "#07101A");

const cssPaths = walk("src").filter((path) => path.endsWith(".css"));
const cssSources = cssPaths.map(readSource).join("\n");
assert.equal(
  cssSources.match(/--background\s*:/g)?.length,
  1,
  "--background debe tener una única definición global.",
);

// Recorre reglas CSS reales en todo src/, ignorando comentarios y descendiendo en @media/@supports.
const checkedCssCanvases: string[] = [];
for (const path of cssPaths) {
  for (const rule of extractCssRules(readSource(path))) {
    if (!isCanvasSelector(rule.selector) || !hasViewportCanvasSize(rule.declarations)) continue;
    checkedCssCanvases.push(`${path}:${rule.selector}`);
    assert.ok(
      resolvesCanonicalBackground(rule.declarations),
      `${path} (${rule.selector}) define un canvas completo sin resolver a --background.`,
    );
  }
}

for (const expectedCanvas of [
  "src/app/globals.css:body",
  "src/app/globals.css:.app-shell",
  "src/app/globals.css:.empty-dashboard",
  "src/app/page.module.css:.site",
  "src/app/website-preview/page.module.css:.site",
  "src/app/qa/training-cycle-history/training-cycle-history-qa.module.css:.shell",
  "src/features/auth/components/auth-screen.module.css:.shell",
]) {
  assert.ok(
    checkedCssCanvases.some((canvas) => canvas.includes(expectedCanvas)),
    `El contrato no inspeccionó ${expectedCanvas}.`,
  );
}

// Recorre objetos style reales con AST: los comentarios y strings sueltos no satisfacen el contrato.
const checkedInlineCanvases: string[] = [];
for (const path of walk("src").filter(isProductTypeScriptSource)) {
  const sourceFile = ts.createSourceFile(
    path,
    readSource(path),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const role = getObjectRole(node);
      const viewportValue = readObjectProperty(node, ["minHeight", "height", "minBlockSize", "blockSize"]);
      if (role && isCanvasRole(role) && viewportValue && containsViewportUnit(viewportValue)) {
        checkedInlineCanvases.push(`${path}:${role}`);
        const background = readObjectProperty(node, ["background", "backgroundColor"]);
        assert.equal(
          background,
          "var(--background)",
          `${path} (${role}) define un canvas inline sin resolver a --background.`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

assert.ok(
  checkedInlineCanvases.includes("src/app/qa/training-cycles/training-cycles-qa-client.tsx:shell"),
  "El contrato debe inspeccionar el shell inline de Training Cycles QA.",
);
assert.match(qaCyclesClient, /background:\s*"var\(--background\)"/);

// AuthScreen y todos los estados AUTH-01 comparten el mismo frame/canvas real.
assert.match(authScreen, /function AuthFrame\([\s\S]*?className=\{styles\.shell\}/);
for (const authState of [
  "AuthScreen",
  "AuthLoadingScreen",
  "PasswordRecoveryScreen",
  "RecoveryExpiredScreen",
  "NewPasswordScreen",
]) {
  assert.match(authScreen, new RegExp(`(?:export )?function ${authState}\\([\\s\\S]*?<AuthFrame`));
}

// La normalización no sustituye superficies elevadas ni colores semánticos.
assert.match(globals, /--panel:\s*#101b27;/);
assert.match(globals, /--green:\s*#74df71;/);
assert.match(globals, /--yellow:\s*#ffbf4d;/);
assert.match(globals, /--red:\s*#ff5d69;/);
assert.match(landingStyles, /--paper-raised:\s*#101b27;/);
assert.match(qaCyclesClient, /panel:\s*\{[\s\S]*?background:\s*"#ffffff"/);

console.log("global-background contract tests passed");

interface CssRule {
  selector: string;
  declarations: string;
}

function extractCssRules(source: string): CssRule[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return parseCssRange(withoutComments, 0, withoutComments.length);
}

function parseCssRange(source: string, start: number, end: number): CssRule[] {
  const rules: CssRule[] = [];
  let cursor = start;

  while (cursor < end) {
    const openBrace = findNextUnquoted(source, "{", cursor, end);
    if (openBrace === -1) break;
    const closeBrace = findMatchingBrace(source, openBrace, end);
    if (closeBrace === -1) break;
    const header = source.slice(cursor, openBrace).trim().replace(/^;+/, "").trim();
    const body = source.slice(openBrace + 1, closeBrace);

    if (header.startsWith("@")) {
      rules.push(...parseCssRange(body, 0, body.length));
    } else if (header) {
      rules.push({ selector: header, declarations: body });
    }
    cursor = closeBrace + 1;
  }

  return rules;
}

function findNextUnquoted(source: string, target: string, start: number, end: number) {
  let quote = "";
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === target) {
      return index;
    }
  }
  return -1;
}

function findMatchingBrace(source: string, openBrace: number, end: number) {
  let depth = 0;
  let quote = "";
  for (let index = openBrace; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }
  return -1;
}

function hasViewportCanvasSize(declarations: string) {
  return [...declarations.matchAll(/(?:^|;)\s*(?:min-height|height|min-block-size|block-size)\s*:\s*([^;]+)/gi)]
    .some((match) => containsViewportUnit(match[1]));
}

function containsViewportUnit(value: string) {
  return /\b100(?:d|s|l)?vh\b/i.test(value);
}

function resolvesCanonicalBackground(declarations: string) {
  return /(?:^|;)\s*background(?:-color)?\s*:\s*var\(--background\)(?:\s*!important)?\s*(?:;|$)/i
    .test(declarations);
}

function isCanvasSelector(selector: string) {
  return selector.split(",").some((part) => isCanvasRole(part.trim()));
}

function isCanvasRole(role: string) {
  const normalized = role.toLowerCase();
  if (/card|panel|modal|drawer|overlay|dialog|sheet|popover|input|form/.test(normalized)) return false;
  return normalized === "html"
    || normalized === "body"
    || normalized === "main"
    || /(?:^|[-_.])(root|page|site|screen|shell|canvas|empty)(?:$|[-_.:#\s])/.test(normalized);
}

function isProductTypeScriptSource(path: string) {
  return /\.(?:ts|tsx)$/.test(path)
    && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path)
    && !path.endsWith(".d.ts");
}

function getObjectRole(node: ts.ObjectLiteralExpression): string | null {
  if (ts.isPropertyAssignment(node.parent)) return readPropertyName(node.parent.name);

  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isJsxAttribute(current)) current = current.parent;
  if (!current || current.name.getText() !== "style") return null;

  const element = current.parent.parent;
  if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
    return element.tagName.getText();
  }
  return null;
}

function readObjectProperty(node: ts.ObjectLiteralExpression, names: string[]) {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = readPropertyName(property.name);
    if (!propertyName || !names.includes(propertyName)) continue;
    return readStaticString(property.initializer);
  }
  return null;
}

function readPropertyName(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function readStaticString(node: ts.Expression) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}
