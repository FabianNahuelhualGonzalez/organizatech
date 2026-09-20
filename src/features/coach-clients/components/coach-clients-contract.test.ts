import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { coachClientTabTarget } from "./coach-client-tab-navigation";

const directory = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(directory, file), "utf8");
const productionFiles = readdirSync(directory).filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"));

test("client components have no data access, domain calculations, seeded names or cross-feature dependencies", () => {
  const allowed = new Set(["react", "lucide-react", "@/ui/navigation/app-back-button", "@/ui/feedback/status-message"]);
  for (const file of productionFiles) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const moduleName = statement.moduleSpecifier.text;
      assert.ok(moduleName.startsWith("./") || moduleName.startsWith("@/ui/coach-overlays/") || allowed.has(moduleName), `${file}: ${moduleName}`);
    }
    assert.doesNotMatch(read(file), /\b(?:fetch|Date|Intl|localStorage|sessionStorage|setTimeout|setInterval)\b|dangerouslySetInnerHTML|Math\.random|\.rpc\(|@gmail\.com|Fabián|Matías|Camila/, file);
  }
});

test("keyboard targets wrap and handle Home/End without changing data or handling ordinary keys", () => {
  assert.equal(coachClientTabTarget("inactive", "ArrowRight"), "active");
  assert.equal(coachClientTabTarget("active", "ArrowLeft"), "inactive");
  assert.equal(coachClientTabTarget("pending", "Home"), "active");
  assert.equal(coachClientTabTarget("active", "End"), "inactive");
  assert.equal(coachClientTabTarget("active", "Tab"), null);
  assert.equal(coachClientTabTarget("pending", " "), null);
});

test("layout keeps search and tabs outside the only vertical scroll, scoped to the global background", () => {
  const view = read("coach-clients.module.css");
  assert.match(view, /background:\s*var\(--background\)/);
  assert.match(view, /max-width:\s*430px/);
  assert.match(view, /container-type:\s*inline-size/);
  assert.match(view, /container-name:\s*coach-clients/);
  assert.match(view, /min-height:\s*0/);
  assert.match(read("coach-clients-list.module.css"), /overflow-y:\s*auto/);
  for (const file of ["coach-clients-header.module.css", "coach-clients-search.module.css", "coach-clients-tabs.module.css"]) assert.match(read(file), /flex:\s*none/);
  assert.doesNotMatch(view, /:root|\bhtml\b|\bbody\b|#07101[Aa]|100vh/);
});

test("interactive targets remain 44px, input 16px, and narrow layout uses named container queries", () => {
  for (const file of ["coach-clients-header.module.css", "coach-clients-search.module.css", "coach-clients-tabs.module.css", "coach-client-row.module.css", "coach-clients-empty.module.css"]) {
    const css = read(file);
    assert.match(css, /min-width:\s*44px/, file);
    assert.match(css, /min-height:\s*(?:44|76)px/, file);
    assert.match(css, /:focus-visible/, file);
    assert.doesNotMatch(css, /font-weight:\s*(?:800|900)|@media\s*\((?:min|max)-width/, file);
  }
  assert.match(read("coach-clients-search.module.css"), /font-size:\s*16px/);
  assert.match(read("coach-client-row.module.css"), /@container coach-clients \(max-width:\s*359px\)/);
});

test("pending stripes never indicate progress and inactive rows do not multiply text opacity", () => {
  const css = read("coach-client-row.module.css");
  assert.match(css, /repeating-linear-gradient/);
  assert.match(css, /\[data-striped="true"\]\s*\{\s*width:\s*100%/);
  assert.doesNotMatch(css, /opacity\s*:/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /text-overflow:\s*ellipsis/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test("detail and code cards keep scoped scrolling, 44px targets and stacked actions at narrow widths", () => {
  const detail = read("coach-client-detail-sheet.module.css");
  const code = read("coach-client-code-card.module.css");
  const confirmation = read("coach-client-unlink-confirmation.module.css");
  for (const css of [detail, confirmation]) {
    assert.match(css, /min-height: 0/); assert.match(css, /overflow-y: auto/); assert.match(css, /\.body > \* \{ flex: none/);
  }
  for (const css of [detail, code, confirmation]) {
    assert.match(css, /min-width: 44px/); assert.match(css, /min-height: (?:44|50|56)px/); assert.match(css, /:focus-visible/);
    assert.doesNotMatch(css, /:root|\bhtml\b|font-weight: 800|@media\s*\((?:min|max)-width/);
  }
  assert.match(code, /@container \(max-width: 359px\).*flex-direction: column/);
  assert.match(read("coach-client-code-button.module.css"), /font-size: 14px; letter-spacing: \.1em/);
  assert.match(confirmation, /border: 1px solid rgba\(248, 113, 113, \.5\)/);
});

test("add sheet keeps scroll below its heading, readable email, touch targets and reduced-motion sending", () => {
  const sheet = read("coach-add-client-sheet.module.css");
  const component = read("coach-add-client-sheet.tsx");
  const email = read("coach-client-invite-email-step.module.css");
  const receipt = read("coach-client-invite-receipt-step.module.css");
  const code = read("coach-client-code-button.module.css");
  assert.match(sheet, /\.header \{ flex: none/); assert.match(sheet, /\.body \{ flex: 1; min-height: 0; min-width: 0/);
  assert.match(sheet, /overflow-y: auto/); assert.match(sheet, /overscroll-behavior-y: contain/);
  assert.match(component, /document\.body\.style\.overflow = "hidden"/);
  assert.match(component, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(component, /document\.body\.style\.overflow = bodyOverflow/);
  assert.match(component, /document\.documentElement\.style\.overflow = rootOverflow/);
  assert.match(sheet, /min-width: 44px; min-height: 44px/); assert.match(sheet, /prefers-reduced-motion: reduce/);
  assert.match(email, /min-width: 0; width: 100%; min-height: 44px/); assert.match(email, /font-size: 16px/);
  assert.match(receipt, /min-width: 44px; min-height: 50px/); assert.match(receipt, /text-overflow: ellipsis/);
  assert.match(code, /data-size="receipt".*font-size: 20px/); assert.match(code, /@container \(max-width: 359px\)/);
  assert.match(code, /data-size="receipt".*font-size: 17px/);
  for (const css of [sheet, email, receipt, code]) {
    assert.match(css, /:focus-visible/); assert.doesNotMatch(css, /:root|\bhtml\b|100vh|font-weight: 800|@media\s*\((?:min|max)-width/);
  }
});

test("add instructions preserve distinct blue, amber and green steps, supplied copy and sufficient secondary opacity", () => {
  const css = read("coach-client-invitation-steps.module.css");
  for (const tone of ["accent", "pending", "ok"]) assert.ok(css.includes(`[data-tone="${tone}"]`));
  assert.match(css, /linear-gradient\(160deg/); assert.match(css, /rgba\(255, 255, 255, \.78\)/);
  assert.match(css, /overflow-wrap: anywhere/); assert.match(read("coach-client-invitation-steps.tsx"), /key=\{step.id\}/);
  for (const file of ["coach-add-client-sheet.tsx", "coach-client-invite-email-step.tsx", "coach-client-invite-receipt-step.tsx", "coach-client-code-button.tsx"]) {
    assert.doesNotMatch(read(file), /navigator\.|window\.|clipboard|new RegExp|setState|useState|addEventListener|onKeyDown|querySelector/, file);
  }
  assert.match(read("coach-add-client-sheet.tsx"), /<CoachOverlay variant="client-detail"/);
});
