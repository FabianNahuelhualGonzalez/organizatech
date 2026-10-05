import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");

test("portal selection bar hides for the send sheet and returns with selection after closing", () => {
  assert.match(ui, /const selectionBar = selecting && !sendSheetOpen && !confirmSendOpen \? <div className=\{styles\.selectBar\}>/);
  assert.match(ui, /selectionBar && selectionActionsLayer \? createPortal\(selectionBar, selectionActionsLayer\) : null/);
  assert.match(ui, /onClick=\{\(\) => setSendSheetOpen\(true\)\}>\{selectedIds\.length \? `Continuar/);
  assert.match(ui, /aria-label="Cerrar envío"[^>]*onClick=\{\(\) => setSendSheetOpen\(false\)\}/);
  assert.match(ui, /aria-label="Cerrar"[^>]*onClick=\{\(\) => setSendSheetOpen\(false\)\}/);
  assert.ok(ui.includes('className={styles.sheetFooter}><button className={styles.sheetSave} type="button" disabled={sending} onClick={() => setConfirmSendOpen(true)}>Enviar reporte</button>'));
});
