import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Execute the actual two hooks with a deterministic effect/ref harness and a
// minimal focus DOM. No browser, no copied focus algorithm and no app mounting.
type Effect = { dependencies?: readonly unknown[]; run: () => void | (() => void); cleanup?: () => void; dirty: boolean };
class HookHarness {
  private refs: { current: unknown }[] = [];
  private effects: Effect[] = [];
  private refIndex = 0;
  private effectIndex = 0;
  useRef(value: unknown) { const index = this.refIndex++; return this.refs[index] ??= { current: value }; }
  useEffect(run: Effect["run"], dependencies?: readonly unknown[]) {
    const index = this.effectIndex++;
    const previous = this.effects[index];
    const dirty = !previous || !dependencies || !previous.dependencies
      || dependencies.some((value, i) => value !== previous.dependencies?.[i]);
    this.effects[index] = { run, dependencies, cleanup: previous?.cleanup, dirty };
  }
  render(run: () => void) { this.refIndex = 0; this.effectIndex = 0; run(); }
  flush() {
    for (const effect of this.effects) if (effect.dirty) effect.cleanup?.();
    for (const effect of this.effects) if (effect.dirty) { effect.cleanup = effect.run() || undefined; effect.dirty = false; }
  }
  dispose() { for (const effect of this.effects) { effect.cleanup?.(); effect.cleanup = undefined; } }
}

type KeyEvent = { key: string; shiftKey: boolean; prevented: boolean; stopped: boolean; preventDefault(): void; stopImmediatePropagation(): void };
class FocusDocument {
  activeElement: FocusElement | null = null;
  listeners = new Set<(event: KeyEvent) => void>();
  addEventListener(name: string, listener: (event: KeyEvent) => void, capture: boolean) {
    assert.equal(name, "keydown"); assert.equal(capture, true); this.listeners.add(listener);
  }
  removeEventListener(name: string, listener: (event: KeyEvent) => void, capture: boolean) {
    assert.equal(name, "keydown"); assert.equal(capture, true); this.listeners.delete(listener);
  }
  key(key: string, shiftKey = false) {
    const event: KeyEvent = { key, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    for (const listener of this.listeners) { listener(event); if (event.stopped) break; }
    return event;
  }
}
class FocusElement {
  inert = false;
  isConnected = true;
  disabled = false;
  hidden = false;
  initial = false;
  controls: FocusElement[] = [];
  constructor(readonly id: string, private document: FocusDocument, readonly parent: FocusElement | null = null) {}
  focus() {
    if (this.inert) return;
    for (let node: FocusElement | null = this.parent; node; node = node.parent) if (node.inert) return;
    if (this.isConnected && !this.disabled) this.document.activeElement = this;
  }
  closest() { return this.hidden ? this : null; }
  checkVisibility() { return !this.hidden; }
  querySelector() { return this.controls.find((control) => control.initial) ?? null; }
  querySelectorAll() { return this.controls.filter((control) => !control.disabled && !control.hidden); }
  contains(node: FocusElement | null) { return node === this || this.controls.includes(node as FocusElement); }
}

function setup() {
  const document = new FocusDocument();
  let currentHarness: HookHarness;
  const react = {
    useRef: (value: unknown) => currentHarness.useRef(value),
    useEffect: (effect: Effect["run"], dependencies?: readonly unknown[]) => currentHarness.useEffect(effect, dependencies),
  };
  function load(path: string) {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(resolve(path), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, { exports, require: (name: string) => { assert.equal(name, "react"); return react; }, document, HTMLElement: FocusElement });
    return exports;
  }
  const { useCoachOverlayBackground } = load("src/ui/coach-overlays/use-coach-overlay-background.ts") as unknown as typeof import("@/ui/coach-overlays/use-coach-overlay-background");
  const { useOverlayFocusManagement } = load("src/ui/overlays/use-overlay-focus-management.ts") as unknown as typeof import("@/ui/overlays/use-overlay-focus-management");
  const background = new FocusElement("background", document);
  const opener = new FocusElement("opener", document, background);
  opener.focus();
  function sheet(sheetBackground = background, sheetOpener = opener) {
    const backgroundRef = { current: sheetBackground as unknown as HTMLElement };
    const restoreFocusRef = { current: sheetOpener as unknown as HTMLElement };
    const harness = new HookHarness();
    const dialog = new FocusElement("dialog", document);
    const input = new FocusElement("input", document, dialog);
    input.initial = true;
    const close = new FocusElement("close", document, dialog);
    const save = new FocusElement("save", document, dialog);
    dialog.controls = [close, input, save];
    let calls = 0;
    function render(isActive: boolean, canClose = true) {
      currentHarness = harness;
      harness.render(() => {
        // Same hook order as CoachOverlay, asserted by a source contract.
        useCoachOverlayBackground(isActive, backgroundRef);
        const ref = useOverlayFocusManagement({ isActive, canClose, onClose: () => { calls++; }, restoreFocusRef });
        ref.current = isActive ? dialog as unknown as HTMLElement : null;
      });
      harness.flush();
    }
    return { harness, dialog, input, close, save, render, calls: () => calls };
  }
  return { document, background, opener, sheet };
}

test("actual shared focus hook selects the marked field, traps both directions and cancels only through Escape", () => {
  const { document, background, opener, sheet } = setup();
  const open = sheet(); open.render(true);
  assert.equal(background.inert, true); assert.equal(document.activeElement, open.input);
  open.save.focus(); assert.equal(document.key("Tab").prevented, true); assert.equal(document.activeElement, open.close);
  open.close.focus(); assert.equal(document.key("Tab", true).prevented, true); assert.equal(document.activeElement, open.save);
  const escape = document.key("Escape");
  assert.equal(escape.prevented, true); assert.equal(escape.stopped, true); assert.equal(open.calls(), 1);
  open.render(false);
  assert.equal(background.inert, false); assert.equal(document.activeElement, opener);
  assert.equal(document.listeners.size, 0);
});

test("busy update reconciles unusable focus and prevents Escape cancellation without reinstalling the listener", () => {
  const { document, sheet } = setup(); const open = sheet();
  open.render(true); const listener = [...document.listeners][0];
  for (const control of open.dialog.controls) { control.disabled = true; control.initial = false; }
  open.render(true, false);
  assert.equal(document.activeElement, open.dialog); assert.equal([...document.listeners][0], listener);
  const escape = document.key("Escape"); assert.equal(escape.stopped, true); assert.equal(open.calls(), 0);
  assert.equal(document.key("Tab").prevented, true); assert.equal(document.activeElement, open.dialog);
  open.harness.dispose(); assert.equal(document.listeners.size, 0);
});

test("email-to-receipt content replacement keeps the same overlay owner and traps the newly available actions", () => {
  const { document, background, opener, sheet } = setup(); const open = sheet();
  open.render(true); const listener = [...document.listeners][0];
  for (const control of open.dialog.controls) control.disabled = true;
  open.render(true, false); assert.equal(document.activeElement, open.dialog);
  // Server receipt replaces the email form while the same sheet remains mounted.
  open.input.isConnected = false; open.dialog.controls = [open.close, open.save];
  open.close.disabled = false; open.save.disabled = false; open.save.initial = true;
  open.render(true, true);
  assert.equal([...document.listeners][0], listener); assert.equal(document.listeners.size, 1);
  assert.equal(background.inert, true); assert.equal(document.activeElement, open.dialog);
  open.save.focus(); document.key("Tab"); assert.equal(document.activeElement, open.close);
  open.close.focus(); document.key("Tab", true); assert.equal(document.activeElement, open.save);
  document.key("Escape"); assert.equal(open.calls(), 1);
  open.render(false); assert.equal(document.activeElement, opener); assert.equal(background.inert, false);
  assert.equal(document.listeners.size, 0);
});

test("nested shared ownership closes only the upper sheet and inert leases survive out-of-order cleanup", () => {
  const { document, background, sheet } = setup(); const lower = sheet(); const upper = sheet();
  lower.render(true); upper.render(true);
  document.key("Escape"); assert.equal(lower.calls(), 0); assert.equal(upper.calls(), 1);
  lower.harness.dispose(); assert.equal(background.inert, true);
  upper.harness.dispose(); assert.equal(background.inert, false); assert.equal(document.listeners.size, 0);
});

test("dates layer inerts the mounted detail independently and restores its real trigger before the app opener", () => {
  const { document, background, opener, sheet } = setup();
  const detail = sheet(); detail.render(true);
  const dates = sheet(detail.dialog, detail.save);
  detail.save.focus(); dates.render(true); detail.render(true, false);
  assert.equal(background.inert, true); assert.equal(detail.dialog.inert, true);
  assert.equal(document.activeElement, dates.input);
  detail.close.focus(); assert.equal(document.activeElement, dates.input);
  document.key("Escape"); assert.equal(detail.calls(), 0); assert.equal(dates.calls(), 1);
  dates.render(false);
  assert.equal(detail.dialog.inert, false); assert.equal(background.inert, true);
  assert.equal(document.activeElement, detail.save);
  detail.render(true, true); document.key("Escape"); assert.equal(detail.calls(), 1);
  detail.render(false);
  assert.equal(background.inert, false); assert.equal(document.activeElement, opener);
  assert.equal(document.listeners.size, 0);
});

test("client confirmation initially focuses its safe action and Escape leaves the detail open", () => {
  const { document, background, sheet } = setup();
  const detail = sheet(); detail.render(true);
  const confirmation = sheet(detail.dialog, detail.save);
  confirmation.input.initial = false; confirmation.save.initial = true;
  confirmation.render(true);
  assert.equal(document.activeElement, confirmation.save);
  assert.equal(background.inert, true); assert.equal(detail.dialog.inert, true);
  document.key("Escape"); assert.equal(confirmation.calls(), 1); assert.equal(detail.calls(), 0);
  confirmation.render(false);
  assert.equal(document.activeElement, detail.save); assert.equal(detail.dialog.inert, false);
  assert.equal(background.inert, true); detail.harness.dispose();
});

test("pre-existing inert state is preserved and disconnected openers are not forcibly focused", () => {
  const { document, background, opener, sheet } = setup(); background.inert = true;
  const open = sheet(); open.render(true); opener.isConnected = false;
  open.harness.dispose(); assert.equal(background.inert, true);
  assert.notEqual(document.activeElement, opener);
});

test("closed sheet acquires no inert lease or keyboard handler", () => {
  const { document, background, opener, sheet } = setup(); const closed = sheet(); closed.render(false);
  assert.equal(background.inert, false); assert.equal(document.listeners.size, 0); assert.equal(document.activeElement, opener);
  closed.harness.dispose();
});

test("sheet delegates focus once and registers inert cleanup first; no local keyboard stack or body changes", () => {
  const source = readFileSync("src/ui/coach-overlays/coach-overlay.tsx", "utf8");
  assert.ok(source.indexOf("useCoachOverlayBackground(isOpen, backgroundRef)") < source.indexOf("useOverlayFocusManagement<HTMLDivElement>"));
  assert.equal((source.match(/useOverlayFocusManagement<HTMLDivElement>/g) ?? []).length, 1);
  assert.match(source, /isActive: isOpen, onClose: onCancel \?\? ignoreClose, canClose, restoreFocusRef/);
  assert.doesNotMatch(source, /addEventListener|querySelectorAll|document\.body|onKeyDown|activeOverlayOwners/);
});

test("sheets preserve touch sizes, independent scroll, safe area and reduced motion without new global tokens", () => {
  const css = readFileSync("src/ui/coach-overlays/coach-overlay.module.css", "utf8");
  const fee = readFileSync("src/features/coach-dashboard/components/coach-fee-sheet.module.css", "utf8");
  const chat = readFileSync("src/features/coach-dashboard/components/coach-chat-coming-soon-sheet.module.css", "utf8");
  assert.match(css, /z-index: 20/); assert.match(css, /z-index: 21/);
  assert.match(css, /max-width: 430px/); assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-width: 44px/); assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(chat, /prefers-reduced-motion: reduce/);
  for (const body of [fee, chat]) { assert.match(body, /min-height: 0/); assert.match(body, /overflow-y: auto/); assert.match(body, /\.body > \* \{ flex: none/); }
  assert.match(fee, /font-size: 19px/); assert.match(fee, /min-width: 0/); assert.match(fee, /flex-wrap: wrap/);
  assert.doesNotMatch(css + fee + chat, /:root|\bhtml\b|font-weight: 800|100vh/);
});

test("renewal layers keep independent heights and stacking, readable native date inputs and narrow layouts", () => {
  const css = readFileSync("src/ui/coach-overlays/coach-overlay.module.css", "utf8");
  const dates = readFileSync("src/features/coach-dashboard/components/coach-renewal-dates-modal.module.css", "utf8");
  const detail = readFileSync("src/features/coach-dashboard/components/coach-renewal-detail-sheet.module.css", "utf8");
  const options = readFileSync("src/features/coach-dashboard/components/coach-renewal-state-choices.module.css", "utf8");
  assert.match(css, /data-variant="detail".*max-height: 86%/);
  assert.match(css, /data-variant="dates".*z-index: 30/);
  assert.match(css, /z-index: 31/); assert.match(css, /translateY\(-50%\)/);
  assert.match(css, /\.layer \{[^}]*container-type: inline-size/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.sheet, \.sheet\[data-variant\] \{ animation: none/);
  assert.match(dates, /font-size: 16px/); assert.match(dates, /box-sizing: border-box/);
  assert.match(dates, /width: 100%; min-width: 0/);
  assert.match(dates, /@container \(max-width: 359px\).*flex-direction: column/);
  assert.match(dates, /::-webkit-date-and-time-value.*min-width: 0/);
  for (const body of [detail, dates]) {
    assert.match(body, /min-height: 0/); assert.match(body, /overflow-y: auto/);
    assert.match(body, /min-width: 44px/); assert.match(body, /min-height: 44px/);
  }
  assert.match(options, /min-height: 56px/); assert.match(options, /:focus-visible/);
});
