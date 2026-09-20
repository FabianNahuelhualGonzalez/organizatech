import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const directory = "src/ui/coach-overlays/";
test("shared Coach wrapper owns visuals and background leases, not a second focus engine or a feature dependency", () => {
  const wrapper = readFileSync(`${directory}coach-overlay.tsx`, "utf8");
  assert.match(wrapper, /@\/ui\/overlays\/use-overlay-focus-management/);
  assert.equal((wrapper.match(/useOverlayFocusManagement<HTMLDivElement>/g) ?? []).length, 1);
  for (const file of readdirSync(directory).filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))) {
    const source = readFileSync(`${directory}${file}`, "utf8");
    assert.doesNotMatch(source, /features\/|addEventListener|querySelector|activeOverlayOwners|localStorage|sessionStorage|clipboard|window\.open|document\.body|fetch\(/, file);
  }
  const adapter = readFileSync("src/features/coach-dashboard/components/coach-dashboard-sheet.tsx", "utf8");
  assert.match(adapter, /export \{ CoachOverlay as CoachDashboardSheet \}/);
  assert.doesNotMatch(adapter, /useEffect|useOverlayFocusManagement|useCoachOverlayBackground/);
});

test("client variants preserve dashboard variants with red centered confirmation and independent stacking", () => {
  const css = readFileSync(`${directory}coach-overlay.module.css`, "utf8");
  assert.match(css, /\.layer\[data-variant="client-add"\] \{[\s\S]*position: fixed;[\s\S]*height: 100dvh;/);
  assert.match(css, /\.layer\[data-variant="client-add"\] \.scrim \{[\s\S]*position: fixed;[\s\S]*height: 100dvh;/);
  assert.match(css, /\.sheet\[data-variant="client-add"\] \{[\s\S]*position: fixed;[\s\S]*bottom: 0;[\s\S]*width: min\(100%, 430px\);[\s\S]*max-height: 88%;/);
  assert.match(css, /@media \(max-width: 430px\) \{[\s\S]*width: 100%;[\s\S]*max-width: none;[\s\S]*max-height: calc\(100dvh - env\(safe-area-inset-top, 0px\)\);[\s\S]*margin-inline: 0;/);
  assert.match(css, /data-variant="client-detail".*max-height: 88%/);
  assert.match(css, /data-variant="client-confirm".*z-index: 30/);
  assert.match(css, /data-variant="client-confirm".*border-color: rgba\(248, 113, 113, \.3\)/);
  assert.match(css, /z-index: 31/); assert.match(css, /container-type: inline-size/);
  assert.match(css, /\.sheet\[data-variant\] \{ animation: none/);
  for (const variant of ["fee", "chat", "detail", "dates"]) assert.ok(css.includes(`data-variant="${variant}"`));
});
