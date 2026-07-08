import assert from "node:assert/strict";

import {
  PROFILE_AVATAR_OUTPUT_SIZE,
  clampAvatarOffset,
  computeAvatarDrawFrame,
  getAvatarEditorInitialState,
  validateAvatarSourceFile,
} from "./profile-avatar-image";

assert.deepEqual(validateAvatarSourceFile({ type: "image/jpeg" }), { ok: true });
assert.deepEqual(validateAvatarSourceFile({ type: "image/png" }), { ok: true });
assert.deepEqual(validateAvatarSourceFile({ type: "image/webp" }), { ok: true });
assert.deepEqual(validateAvatarSourceFile({ type: "image/heic" }), { ok: true });
assert.deepEqual(validateAvatarSourceFile({ type: "image/x-adobe-dng" }), { ok: true });

assert.equal(validateAvatarSourceFile(null).ok, false);
assert.equal(validateAvatarSourceFile({ type: "" }).ok, false);
assert.equal(validateAvatarSourceFile({ type: "application/pdf" }).ok, false);
assert.equal(validateAvatarSourceFile({ type: "image/gif" }).ok, false);
assert.equal(validateAvatarSourceFile({ type: "image/svg+xml" }).ok, false);
assert.equal(validateAvatarSourceFile({ type: "video/mp4" }).ok, false);
assert.equal(validateAvatarSourceFile({ type: "text/plain" }).ok, false);

assert.deepEqual(getAvatarEditorInitialState(), {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
});

{
  const frame = computeAvatarDrawFrame({
    imageWidth: 1024,
    imageHeight: 512,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  });

  assert.equal(frame.height, PROFILE_AVATAR_OUTPUT_SIZE);
  assert.equal(frame.width, PROFILE_AVATAR_OUTPUT_SIZE * 2);
  assert.equal(frame.x, -PROFILE_AVATAR_OUTPUT_SIZE / 2);
  assert.equal(frame.y, 0);
}

{
  const frame = computeAvatarDrawFrame({
    imageWidth: 400,
    imageHeight: 800,
    zoom: 1.5,
    offsetX: 500,
    offsetY: -500,
  });

  assert.equal(frame.width, PROFILE_AVATAR_OUTPUT_SIZE * 1.5);
  assert.equal(frame.height, PROFILE_AVATAR_OUTPUT_SIZE * 3);
  assert.ok(frame.x <= 0);
  assert.ok(frame.y <= 0);
}

assert.deepEqual(clampAvatarOffset({
  drawWidth: 700,
  drawHeight: 512,
  offsetX: 200,
  offsetY: 100,
}), {
  offsetX: 94,
  offsetY: 0,
});

console.log("profile-avatar-image tests passed");
