import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const entryPath = "src/app/login/page.tsx";
const rootPath = "src/components/organizatech-app.tsx";
const progressScreenSpecifier = "@/features/progress/components/comparison-screen-v2";
const registration = "tsx src/features/app-shell/perf-04-bundle-contract.test.ts";

function parseSource(path: string, source = readFileSync(path, "utf8")) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function resolveLocalModule(fromPath: string, specifier: string) {
  const base = specifier.startsWith("@/")
    ? join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? normalize(join(dirname(fromPath), specifier))
      : null;
  if (!base) return null;
  const candidates = extname(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function importSpecifiers(
  path: string,
  includeDynamic: boolean,
  source = readFileSync(path, "utf8"),
) {
  const sourceFile = parseSource(path, source);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const importClause = node.importClause;
      const isTypeOnly = importClause?.isTypeOnly || (
        importClause?.namedBindings &&
        ts.isNamedImports(importClause.namedBindings) &&
        importClause.namedBindings.elements.every((element) => element.isTypeOnly)
      );
      if (!isTypeOnly) specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) specifiers.push(node.moduleSpecifier.text);
    if (
      includeDynamic &&
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function reachableModules(includeDynamic: boolean) {
  const pending = [entryPath];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    for (const specifier of importSpecifiers(path, includeDynamic)) {
      assert.doesNotMatch(
        specifier,
        /share-workout|workout-share/i,
        `Workout Share no puede ser alcanzable desde ${path}`,
      );
      const resolved = resolveLocalModule(path, specifier);
      if (resolved) pending.push(resolved);
    }
  }
  return visited;
}

const rootSource = readFileSync(rootPath, "utf8");
const rootFile = parseSource(rootPath, rootSource);
const rootRuntimeImports = importSpecifiers(rootPath, false);
const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

assert.equal(
  packageManifest.scripts.test.split(registration).length - 1,
  1,
  "el contrato PERF-04 debe registrarse exactamente una vez en la suite oficial",
);
assert.equal(
  Object.values(packageManifest.scripts).join("\n").split(registration).length - 1,
  1,
  "el contrato PERF-04 no debe duplicarse en otros scripts",
);

assert.match(rootSource, /import dynamic from "next\/dynamic";/);
assert.match(
  rootSource,
  /const ComparisonScreenV2 = dynamic<ComparisonScreenV2Props>\([\s\S]*?import\("@\/features\/progress\/components\/comparison-screen-v2"\)[\s\S]*?module\.ComparisonScreenV2[\s\S]*?\);/,
);
assert.equal(
  rootRuntimeImports.includes(progressScreenSpecifier),
  false,
  "ComparisonScreenV2 no debe volver al grafo estático",
);
assert.doesNotMatch(rootSource, /ssr\s*:\s*false/, "la pantalla diferida debe conservar SSR");
assert.doesNotMatch(rootSource, /loading\s*:/, "PERF-04 no agrega loaders ni spinners visibles");

const staticImportMutation = rootSource.replace(
  `import type { ComparisonScreenV2Props } from "${progressScreenSpecifier}";`,
  `import { ComparisonScreenV2 } from "${progressScreenSpecifier}";`,
);
assert.notEqual(staticImportMutation, rootSource, "la mutación de import estático debe ser efectiva");
assert.throws(
  () => assert.equal(
    importSpecifiers(rootPath, false, staticImportMutation).includes(progressScreenSpecifier),
    false,
  ),
  "el contrato debe matar una restauración del import estático de Progress",
);

for (const criticalSpecifier of [
  "@/features/dashboard/components/dashboard-screen",
  "@/features/dashboard/components/empty-dashboard",
  "@/features/active-workout/components/GuidedTrainingScreen",
  "@/features/active-workout/components/TrainingCompletionSummaryScreen",
  "@/features/active-workout/components/TrainingReadinessScreen",
  "@/features/active-workout/components/TrainingStartScreen",
  "@/features/app-shell/components/app-shell-layout",
]) {
  assert.ok(rootRuntimeImports.includes(criticalSpecifier), `${criticalSpecifier} permanece estático`);
}

const initialModules = reachableModules(false);
for (const path of initialModules) {
  for (const specifier of importSpecifiers(path, false)) {
    assert.notEqual(specifier, "recharts", `Recharts no es alcanzable desde el entry inicial (${path})`);
  }
}
assert.equal(
  initialModules.has("src/features/progress/components/comparison-screen-v2.tsx"),
  false,
  "Progress visual queda fuera del grafo inicial",
);

const completeProductiveGraph = reachableModules(true);
assert.ok(
  completeProductiveGraph.has("src/features/progress/components/comparison-screen-v2.tsx"),
  "Progress sigue conectado mediante la frontera dinámica",
);

const expectedProps = [
  "model",
  "routineDays",
  "onDaySelect",
  "onExerciseSelect",
  "onWeekSelect",
];
const progressUsages: ts.JsxSelfClosingElement[] = [];
const visit = (node: ts.Node) => {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(rootFile) === "ComparisonScreenV2") {
    progressUsages.push(node);
  }
  ts.forEachChild(node, visit);
};
visit(rootFile);
assert.equal(progressUsages.length, 1, "la pantalla Progress mantiene un único punto de montaje");
assert.deepEqual(
  progressUsages[0].attributes.properties.map((property) => property.name?.getText(rootFile)),
  expectedProps,
  "la frontera dinámica conserva props y orden de montaje",
);

if (process.env.PERF_04_ASSERT_BUILD_ASSETS === "1") {
  const appBuildManifest = JSON.parse(readFileSync(".next/app-build-manifest.json", "utf8")) as {
    pages: Record<string, string[]>;
  };
  const loadableManifest = JSON.parse(readFileSync(".next/react-loadable-manifest.json", "utf8")) as Record<
    string,
    { files: string[] }
  >;
  const initialAssets = appBuildManifest.pages["/login/page"].filter((path) => path.endsWith(".js"));
  assert.equal(initialAssets.length, 9, "/login conserva nueve assets JS iniciales");

  let initialRawBytes = 0;
  let initialGzipBytes = 0;
  let largestInitialGzipBytes = 0;
  for (const asset of initialAssets) {
    const contents = readFileSync(join(".next", asset));
    const gzipBytes = gzipSync(contents, { level: 9 }).length;
    initialRawBytes += contents.length;
    initialGzipBytes += gzipBytes;
    largestInitialGzipBytes = Math.max(largestInitialGzipBytes, gzipBytes);
    assert.doesNotMatch(
      contents.toString("utf8"),
      /ResponsiveContainer|CartesianGrid|\brecharts\b/,
      `Recharts no debe aparecer en el asset inicial ${asset}`,
    );
  }

  const progressBoundary = Object.entries(loadableManifest).find(([key]) => (
    key.endsWith("-> @/features/progress/components/comparison-screen-v2")
  ));
  assert.ok(progressBoundary, "el manifest conserva la frontera dinámica de Progress");
  const deferredAssets = progressBoundary[1].files;
  assert.ok(
    deferredAssets.every((asset) => !initialAssets.includes(asset)),
    "los chunks de Progress no pueden volver a los assets iniciales",
  );
  const deferredSource = deferredAssets
    .map((asset) => readFileSync(join(".next", asset), "utf8"))
    .join("\n");
  assert.match(
    deferredSource,
    /ResponsiveContainer|CartesianGrid|\brecharts\b/,
    "Recharts permanece dentro de la frontera diferida",
  );
  console.log(JSON.stringify({
    initialAssets,
    initialRawBytes,
    initialGzipBytes,
    largestInitialGzipBytes,
    deferredAssets,
  }));
}

console.log("PERF-04 bundle contract tests passed");
