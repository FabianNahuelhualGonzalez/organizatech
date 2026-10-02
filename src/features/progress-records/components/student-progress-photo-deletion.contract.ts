import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
const sheet = readFileSync("src/features/progress-records/components/student-progress-check-sheet.tsx", "utf8");
const css = readFileSync("src/features/progress-records/components/student-progress-photos.module.css", "utf8");

test("published-photo dialog has exact copy, focus, Escape, cancel and one-ID confirmation", () => {
  assert.match(ui, /¿Seguro que quieres eliminar esta foto\?/);
  assert.match(ui, /¿Seguro que quieres eliminar este check\?/);
  assert.match(ui, /"Eliminar foto"/);
  assert.match(ui, /"Eliminar check"/);
  assert.match(ui, /role="dialog" aria-modal="true"[\s\S]*aria-labelledby="progress-photo-deletion-title"/);
  assert.match(ui, /deletionCancelRef\.current\?\.focus\(\)/);
  assert.match(ui, /event\.key === "Escape"[\s\S]*dismissDeletion\(\)/);
  assert.match(ui, /onClick=\{dismissDeletion\}>Cancelar/);
  assert.match(ui, /gateway\.deletePublishedPhoto\(target\.assetId, target\.kind === "check"\)/);
  assert.match(ui, /previous\?\.isConnected[\s\S]*previous\.focus\(\)/);
  assert.match(css, /\.deletionActions button \{ flex: 1; min-height: 44px; \}/);
  assert.match(css, /\.deletePhotoButton \{[\s\S]*min-height: 44px;/);
});

test("unpublished sheet removal stays immediate and queued uploads use cancellation", () => {
  assert.match(sheet, /async function removeFile\(pose: ProgressPhotoPose\)/);
  assert.match(sheet, /await onSlotChange\(pose\)/);
  assert.doesNotMatch(sheet, /¿Seguro que quieres eliminar/);
  assert.doesNotMatch(ui, /Cargas recientes|Mis fotos|Publicada/);
  assert.match(ui, /gateway\.abandon\(uploadId\)/);
  assert.match(ui, /status === "published"[\s\S]*gateway\.getDeletionTarget\(published\.assetId\)/);
});
