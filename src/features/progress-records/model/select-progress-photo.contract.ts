import assert from "node:assert/strict";
import test from "node:test";
import { selectProgressPhoto } from "./select-progress-photo";

function file(name: string, type: string, size = 4): File {
  return { name, type, size } as File;
}

test("selection keeps the original file and uses only a staging format hint", () => {
  for (const [name, type, format] of [
    ["a.jpg", "image/jpeg", "jpeg"], ["a.png", "image/png", "png"],
    ["a.webp", "image/webp", "webp"], ["a.jpeg", "", "jpeg"],
  ]) {
    const original = file(name, type);
    assert.deepEqual(selectProgressPhoto(original), { file: original, format });
  }
});

test("oversize, empty and unsupported selections fail before staging", () => {
  assert.throws(() => selectProgressPhoto(file("a.jpg", "image/jpeg", 20 * 1024 * 1024 + 1)));
  assert.throws(() => selectProgressPhoto(file("a.jpg", "image/jpeg", 0)));
  assert.throws(() => selectProgressPhoto(file("a.gif", "image/gif")));
  for (const [name, type] of [
    ["a.heic", "image/heic"], ["a.heif", "image/heif"],
    ["a.heic", ""], ["a.heic", "image/jpeg"],
    ["a.dng", "image/x-adobe-dng"], ["a.dng", "image/jpeg"],
    ["a.cr3", ""], ["a.raw", "application/octet-stream"],
    ["a.png", "image/jpeg"],
  ]) {
    assert.throws(() => selectProgressPhoto(file(name, type)));
  }
});
