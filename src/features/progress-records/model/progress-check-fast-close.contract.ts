import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createProgressCheckSaveGuard, ProgressCheckSaveCancelled } from "./progress-check-save-guard";
import { cancelDiscardedProgressCheckUploads } from "./progress-photo-upload-selection";

test("confirmation pauses check creation and Seguir editando resumes it", async () => {
  const guard = createProgressCheckSaveGuard();
  let created = false;
  guard.pauseForConfirmation();
  const creating = guard.beforeCreateCheck().then(() => { created = true; });
  await Promise.resolve();
  assert.equal(created, false);
  guard.continueEditing();
  await creating;
  assert.equal(created, true);
  assert.equal(guard.cancelled, false);
});

test("confirmed discard prevents a check even when publication finished while confirmation was open", async () => {
  const guard = createProgressCheckSaveGuard();
  guard.pauseForConfirmation();
  const creating = guard.beforeCreateCheck();
  guard.cancel();
  await assert.rejects(creating, ProgressCheckSaveCancelled);
});

test("discard wakes polling without waiting for its timer", async () => {
  const guard = createProgressCheckSaveGuard();
  const polling = guard.wait(10_000);
  guard.cancel();
  await assert.rejects(polling, ProgressCheckSaveCancelled);
});

test("late reservation is recorded for background abandonment, never for check creation", async () => {
  const guard = createProgressCheckSaveGuard();
  const reserved: string[] = [];
  let finishReservation!: (id: string) => void;
  const reservation = new Promise<string>((resolve) => { finishReservation = resolve; });
  let created = false;
  const saving = (async () => {
    const id = await reservation;
    reserved.push(id);
    guard.checkpoint();
    created = true;
  })();
  guard.cancel();
  finishReservation("late-reservation");
  await assert.rejects(saving, ProgressCheckSaveCancelled);
  const calls: string[] = [];
  const result = await cancelDiscardedProgressCheckUploads(reserved, {
    abandon: async (id) => { calls.push(`abandon:${id}`); return "cleaning"; },
    cleanupOwn: async () => { calls.push("cleanup"); },
  });
  assert.equal(created, false);
  assert.deepEqual(calls, ["abandon:late-reservation", "cleanup"]);
  assert.deepEqual(result, { published: false, failed: false });
});

test("local-only discard makes no remote calls and a linked published asset remains intact", async () => {
  const calls: string[] = [];
  const port = {
    abandon: async (id: string): Promise<"published"> => { calls.push(`abandon:${id}`); return "published"; },
    cleanupOwn: async () => { calls.push("cleanup"); },
  };
  assert.deepEqual(await cancelDiscardedProgressCheckUploads([], port), { published: false, failed: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(await cancelDiscardedProgressCheckUploads(["published-id"], port),
    { published: true, failed: false });
  assert.deepEqual(calls, ["abandon:published-id"]);

  const sql = readFileSync("supabase/migrations/20261002014402_progress_photo_automatic_publication.sql", "utf8");
  assert.match(sql, /if v_upload\.state = 'published' then[\s\S]*exists \([\s\S]*private\.progress_check_photos link[\s\S]*then return 'published'; end if;[\s\S]*private\.delete_own_progress_photo/);
});

test("the sheet opens an accessible confirmation while saving and closes before background cleanup", () => {
  const sheet = readFileSync("src/features/progress-records/components/student-progress-check-sheet.tsx", "utf8");
  const photos = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  const gateway = readFileSync("src/features/progress-records/data/student-progress-photo-gateway.ts", "utf8");
  const css = readFileSync("src/features/progress-records/components/student-progress-photos.module.css", "utf8");
  assert.match(sheet, /POSES\.some\(\(pose\) => slots\[pose\]\) \|\| hasRemoteDraft \|\| saving \|\| changing/);
  assert.match(sheet, /aria-label="Cerrar nuevo check" disabled=\{creatingCheck\}/);
  assert.match(sheet, /aria-label="Cerrar" disabled=\{creatingCheck\}/);
  assert.match(sheet, /event\.key === "Escape"[\s\S]*requestClose\(\)/);
  assert.match(sheet, /role="alertdialog" aria-modal="true"[\s\S]*¿Descartar este check\?[\s\S]*Seguir editando[\s\S]*Descartar/);
  assert.doesNotMatch(sheet, /window\.confirm/);
  assert.match(sheet, /continueRef\.current\?\.focus\(\)/);
  assert.match(sheet, /aria-hidden=\{confirmDiscard\} inert=\{confirmDiscard\}/);
  assert.match(css, /\.deletionActions button \{[^}]*min-height: 44px;/);
  const discard = photos.match(/function discardCheckSheet\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(discard.indexOf("finishCheckSheet();") < discard.indexOf("await save?.promise"));
  assert.match(discard, /save\?\.guard\.cancel\(\)/);
  assert.match(discard, /save\?\.abort\.abort\(\)/);
  assert.match(discard, /cancelDiscardedProgressCheckUploads\(ids, gateway!\)/);
  assert.match(photos, /draft\[photo\.pose\] = pending;\s*guard\.checkpoint\(\)/);
  assert.match(photos, /sheetGenerationRef\.current === generation && queuedPhotos\[pose\] === queued\) delete queuedPhotos\[pose\]/);
  assert.match(photos, /await guard\.beforeCreateCheck\(\);[\s\S]*gateway\.createCheck\(checkedOn, publishedAssetIds\)/);
  assert.match(photos, /\}, save\.abort\.signal\)/);
  assert.match(gateway, /signal\?\.addEventListener\("abort", onAbort, \{ once: true \}\)/);
  assert.match(gateway, /const onAbort = \(\) => request\.abort\(\)/);
});
