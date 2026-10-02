import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("preview failure preserves original selection and does not disable saving", () => {
  const sheet = readFileSync("src/features/progress-records/components/student-progress-check-sheet.tsx", "utf8");
  const flow = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  assert.match(sheet, /const selected = selectProgressPhoto\(file\)/);
  assert.match(sheet, /URL\.createObjectURL\(file\)/);
  assert.match(sheet, /catch \{ \/\* Preview is optional\. \*\/ \}/);
  assert.match(sheet, /onError=\{\(\) => previewFailed\(pose/);
  assert.match(sheet, /\[pose\]: \{ selected: current\[pose\]\?\.selected \}/);
  assert.match(sheet, /slots\[pose\]\?\.selected \? \[\{ pose, selected:/);
  assert.match(sheet, /disabled=\{ready\.length === 0 \|\| saving\}/);
  assert.match(flow, /gateway\.stage\(pending\.reservation\.uploadId, photo\.selected\.file\)/);
  assert.doesNotMatch(sheet, /prepareLocalProgressPhoto|createImageBitmap|canvas|toBlob/);
});

test("photo format help is accessible and uses the approved copy", () => {
  const sheet = readFileSync("src/features/progress-records/components/student-progress-check-sheet.tsx", "utf8");
  const css = readFileSync("src/features/progress-records/components/student-progress-photos.module.css", "utf8");
  assert.match(sheet, /aria-label="Información sobre fotos admitidas"/);
  assert.match(sheet, /aria-expanded=\{showFormatHelp\} aria-controls="progress-photo-format-help"/);
  assert.match(sheet, /hidden=\{!showFormatHelp\}/);
  assert.ok(sheet.includes("Por ahora puedes subir imágenes JPG, PNG o WebP. Si tu foto está en formato HEIC, toma una captura de pantalla de la foto y sube esa captura. En iPhone normalmente se guarda como PNG. Tus fotos se almacenan de forma privada."));
  assert.match(css, /\.sheetInfo \{[^}]*width: 44px; height: 44px;/);
});
