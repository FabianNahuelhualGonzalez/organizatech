import ts from "typescript";

const EXPANDABLE_SLOTS = new Set([
  "notificationOverlay",
  "screenHeader",
  "portalScreenContent",
]);

export interface LegacyAppShellLayoutAstOptions {
  readonly ignoredAttributesByElement?: Readonly<Record<string, readonly string[]>>;
  readonly ignoredDirectConditionalElements?: readonly string[];
  readonly ignoredConjunctiveGuardIdentifiers?: readonly string[];
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression)
    || ts.isAsExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) return unwrapExpression(expression.expression);
  return expression;
}

function parseRoot(path: string, source: string) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  ) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`${path}: el composition root debe conservar sintaxis TSX válida`);
  }
  return sourceFile;
}

/**
 * Canonicaliza el layout legacy completo. Los tres slots extraídos por UI-NAV-01 se expanden a su
 * AST original para poder comparar atributos, overlays, children, callbacks y orden de pantalla
 * contra el baseline sin depender de espacios, comentarios o impresión de TypeScript.
 */
export function legacyAppShellLayoutAst(
  path: string,
  source: string,
  options: LegacyAppShellLayoutAstOptions = {},
): string {
  const sourceFile = parseRoot(path, source);
  const root = sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => (
    ts.isFunctionDeclaration(statement) && statement.name?.text === "OrganizatechApp"
  ));
  if (!root?.body) throw new Error(`${path}: falta OrganizatechApp`);

  const ignoredConjunctiveGuards = new Set(options.ignoredConjunctiveGuardIdentifiers ?? []);
  const isIgnoredConjunctiveGuard = (node: ts.Node) => {
    if (!ts.isExpression(node)) return false;
    const candidate = unwrapExpression(node);
    return (
      ts.isIdentifier(candidate)
      && ignoredConjunctiveGuards.has(candidate.text)
    ) || (
      ts.isPrefixUnaryExpression(candidate)
      && candidate.operator === ts.SyntaxKind.ExclamationToken
      && ts.isIdentifier(unwrapExpression(candidate.operand))
      && ignoredConjunctiveGuards.has((unwrapExpression(candidate.operand) as ts.Identifier).text)
    );
  };

  const slotInitializers = new Map<string, ts.Expression>();
  const layouts: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && EXPANDABLE_SLOTS.has(node.name.text)
      && node.initializer
    ) slotInitializers.set(node.name.text, unwrapExpression(node.initializer));
    if (
      ts.isJsxElement(node)
      && node.openingElement.tagName.getText(sourceFile) === "AppShellLayout"
    ) layouts.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root.body);
  if (layouts.length !== 1) {
    throw new Error(`${path}: debe existir exactamente un AppShellLayout legacy, existen ${layouts.length}`);
  }

  const syntaxAst = (node: ts.Node, resolving = new Set<string>()): unknown => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      return jsxAst(node, resolving);
    }
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      if (isIgnoredConjunctiveGuard(node.left)) return syntaxAst(node.right, resolving);
      if (isIgnoredConjunctiveGuard(node.right)) return syntaxAst(node.left, resolving);
    }
    const children = node.getChildren(sourceFile);
    return children.length === 0
      ? [node.kind, node.getText(sourceFile)]
      : [node.kind, children.map((child) => syntaxAst(child, resolving))];
  };

  const expressionAst = (expression: ts.Expression, resolving = new Set<string>()): unknown => {
    const candidate = unwrapExpression(expression);
    if (ts.isIdentifier(candidate) && slotInitializers.has(candidate.text)) {
      if (resolving.has(candidate.text)) throw new Error(`${path}: slot recursivo ${candidate.text}`);
      const nextResolving = new Set(resolving).add(candidate.text);
      return expressionAst(slotInitializers.get(candidate.text)!, nextResolving);
    }
    if (ts.isJsxElement(candidate) || ts.isJsxSelfClosingElement(candidate) || ts.isJsxFragment(candidate)) {
      return jsxAst(candidate, resolving);
    }
    return syntaxAst(candidate, resolving);
  };

  const attributesAst = (
    elementName: string,
    attributes: ts.JsxAttributes,
    resolving: Set<string>,
  ) => {
    const ignoredAttributes = new Set(options.ignoredAttributesByElement?.[elementName] ?? []);
    return attributes.properties.filter((attribute) => (
      ts.isJsxSpreadAttribute(attribute)
      || !ignoredAttributes.has(attribute.name.getText(sourceFile))
    )).map((attribute, index) => {
      if (ts.isJsxSpreadAttribute(attribute)) {
        return [`...${index}`, expressionAst(attribute.expression, resolving)] as const;
      }
      const name = attribute.name.getText(sourceFile);
      if (!attribute.initializer) return [name, true] as const;
      if (ts.isStringLiteral(attribute.initializer)) return [name, attribute.initializer.text] as const;
      if (!ts.isJsxExpression(attribute.initializer)) {
        return [name, jsxAst(attribute.initializer, resolving)] as const;
      }
      return [
        name,
        attribute.initializer.expression
          ? expressionAst(attribute.initializer.expression, resolving)
          : null,
      ] as const;
    }).sort(([left], [right]) => left.localeCompare(right));
  };

  const childrenAst = (children: readonly ts.JsxChild[], resolving: Set<string>): unknown[] => (
    children.flatMap((child) => {
      if (ts.isJsxText(child)) {
        const text = child.getText(sourceFile).replace(/\s+/g, " ").trim();
        return text ? [["text", text]] : [];
      }
      const childExpression = ts.isJsxExpression(child) && child.expression
        ? unwrapExpression(child.expression)
        : undefined;
      if (childExpression && ts.isBinaryExpression(childExpression)) {
        const directBoundary = unwrapExpression(childExpression.right);
        const elementName = ts.isJsxElement(directBoundary)
          ? directBoundary.openingElement.tagName.getText(sourceFile)
          : ts.isJsxSelfClosingElement(directBoundary)
            ? directBoundary.tagName.getText(sourceFile)
            : null;
        if (
          childExpression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          && elementName
          && options.ignoredDirectConditionalElements?.includes(elementName)
        ) return [];
      }
      if (
        ts.isJsxExpression(child)
        && child.expression
        && ts.isIdentifier(unwrapExpression(child.expression))
      ) {
        const identifier = unwrapExpression(child.expression) as ts.Identifier;
        const initializer = slotInitializers.get(identifier.text);
        if (initializer) {
          const candidate = unwrapExpression(initializer);
          if (ts.isJsxFragment(candidate)) {
            return childrenAst(candidate.children, new Set(resolving).add(identifier.text));
          }
        }
      }
      if (ts.isJsxExpression(child)) {
        return [["expression", child.expression ? expressionAst(child.expression, resolving) : null]];
      }
      return [jsxAst(child, resolving)];
    })
  );

  function jsxAst(
    node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
    resolving: Set<string>,
  ): unknown {
    if (ts.isJsxFragment(node)) return ["fragment", childrenAst(node.children, resolving)];
    if (ts.isJsxSelfClosingElement(node)) {
      const elementName = node.tagName.getText(sourceFile);
      return [
        "element",
        elementName,
        attributesAst(elementName, node.attributes, resolving),
        [],
      ];
    }
    const elementName = node.openingElement.tagName.getText(sourceFile);
    return [
      "element",
      elementName,
      attributesAst(elementName, node.openingElement.attributes, resolving),
      childrenAst(node.children, resolving),
    ];
  }

  return JSON.stringify(jsxAst(layouts[0], new Set()));
}
