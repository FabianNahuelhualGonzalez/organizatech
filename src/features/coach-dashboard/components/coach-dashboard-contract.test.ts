import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { coachChartRatio } from "./coach-chart-geometry";

const directory = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(directory, name), "utf8");
const productionFiles = readdirSync(directory).filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"));

test("components import only presentation, React and existing icons, not repositories or other worktrees", () => {
  for (const filename of productionFiles) {
    const source = ts.createSourceFile(filename, read(filename), ts.ScriptTarget.Latest, true, filename.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const moduleName = statement.moduleSpecifier.text;
      assert.ok(moduleName.startsWith("./") || moduleName === "react" || moduleName === "lucide-react"
        || moduleName === "@/ui/feedback/status-message"
        || moduleName.startsWith("@/ui/coach-overlays/")
        || moduleName === "@/ui/overlays/use-overlay-focus-management", `${filename}: ${moduleName}`);
    }
    assert.doesNotMatch(read(filename), /\b(?:fetch|localStorage|sessionStorage|setTimeout|setInterval|Date|Intl)\b|dangerouslySetInnerHTML|Math\.random|supabase\.|\.rpc\(/, filename);
  }
});

test("production UI has no seeded people, static calendar dates or example CLP amounts", () => {
  for (const filename of productionFiles) {
    assert.doesNotMatch(read(filename), /\b2026-\d{2}-\d{2}\b|Fabián|Camila|Ignacio|@gmail\.com/, filename);
    if (!["coach-fee-presets.ts", "coach-dashboard-sheet-view.ts"].includes(filename)) {
      assert.doesNotMatch(read(filename), /35000|50000/, filename);
    }
  }
});

test("geometry is bounded for tiny, unknown, negative and invalid values without inventing a ratio", () => {
  assert.equal(coachChartRatio(null), null);
  assert.equal(coachChartRatio(Number.NaN), null);
  assert.equal(coachChartRatio(Infinity), null);
  assert.equal(coachChartRatio(-1), 0);
  assert.equal(coachChartRatio(7), 1);
  assert.equal(coachChartRatio(.001), .001);
});

test("view uses the global canvas token and a named local container, without replacing shell or globals", () => {
  const css = read("coach-dashboard.module.css");
  assert.match(css, /background:\s*var\(--background\)/);
  assert.match(css, /max-width:\s*430px/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /min-width:\s*0/);
  assert.doesNotMatch(css, /:root|\bhtml\b|\bbody\b|#07101[Aa]|100vh/);
  assert.doesNotMatch(read("coach-dashboard.tsx"), /<main|Topbar|Boundary|Modal|Drawer|useEffect|useState|useReducer/);
});

test("responsive modules preserve small-width targets, graph bar minimum and reduced motion", () => {
  const quick = read("coach-quick-actions.module.css");
  const chart = read("coach-monthly-chart.module.css");
  assert.match(quick, /@container\s*\(max-width:\s*359px\)/);
  assert.match(quick, /flex-basis:\s*100%/);
  assert.match(chart, /minmax\(44px,\s*1fr\)/);
  assert.match(chart, /max\(10px,/);
  assert.match(chart, /prefers-reduced-motion:\s*reduce/);
  assert.ok(chart.indexOf('[aria-pressed="true"] .bar') > chart.indexOf('[data-best="true"] .bar'), "selection overrides best-month color");
  for (const filename of readdirSync(directory).filter((name) => name.endsWith(".css"))) {
    const css = read(filename);
    assert.doesNotMatch(css, /font-weight:\s*(?:800|900)|@media\s*\((?:min|max)-width/, filename);
  }
});

test("all interactive sections declare a complete minimum target and a visible focus ring", () => {
  for (const filename of ["coach-income-card.module.css", "coach-portfolio-grid.module.css", "coach-alerts-card.module.css", "coach-quick-actions.module.css", "coach-monthly-chart.module.css", "coach-dashboard-card.module.css"]) {
    const css = read(filename);
    assert.match(css, /min-width:\s*44px/, filename);
    assert.match(css, /min-height:\s*(?:44|48|52|56|112)px/, filename);
    assert.match(css, /:focus-visible/, filename);
  }
});
