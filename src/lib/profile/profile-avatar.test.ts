import assert from "node:assert/strict";

import {
  PROFILE_AVATAR_MAX_SIZE_BYTES,
  buildProfileAvatarPath,
  isOwnProfileAvatarPath,
  normalizeProfileAvatarPath,
  validateProfileAvatarFile,
} from "./profile-avatar";

const userId = "123e4567-e89b-12d3-a456-426614174000";
const otherUserId = "223e4567-e89b-12d3-a456-426614174000";

function file(type: string, size = 1024) {
  return { type, size, name: "avatar" };
}

assert.deepEqual(validateProfileAvatarFile(file("image/jpeg")), { ok: true });
assert.deepEqual(validateProfileAvatarFile(file("image/png")), { ok: true });
assert.deepEqual(validateProfileAvatarFile(file("image/webp")), { ok: true });
assert.deepEqual(validateProfileAvatarFile(file("image/jpeg", PROFILE_AVATAR_MAX_SIZE_BYTES)), { ok: true });

assert.equal(validateProfileAvatarFile(null).ok, false);
assert.equal(validateProfileAvatarFile(file("image/svg+xml")).ok, false);
assert.equal(validateProfileAvatarFile(file("image/gif")).ok, false);
assert.equal(validateProfileAvatarFile(file("text/plain")).ok, false);
assert.equal(validateProfileAvatarFile(file("image/jpeg", 0)).ok, false);
assert.equal(validateProfileAvatarFile(file("image/jpeg", PROFILE_AVATAR_MAX_SIZE_BYTES + 1)).ok, false);

assert.equal(buildProfileAvatarPath(userId), `${userId}/avatar`);
assert.throws(() => buildProfileAvatarPath(""));
assert.throws(() => buildProfileAvatarPath(`${userId}/avatar`));
assert.throws(() => buildProfileAvatarPath(`../${userId}`));
assert.throws(() => buildProfileAvatarPath("not-a-uuid"));

assert.equal(normalizeProfileAvatarPath(null), null);
assert.equal(normalizeProfileAvatarPath(""), null);
assert.equal(normalizeProfileAvatarPath(` ${userId.toUpperCase()}/avatar `), `${userId}/avatar`);
assert.equal(normalizeProfileAvatarPath(`/${userId}/avatar`), null);
assert.equal(normalizeProfileAvatarPath(`${userId}/../avatar`), null);
assert.equal(normalizeProfileAvatarPath(`https://example.com/${userId}/avatar`), null);
assert.equal(normalizeProfileAvatarPath(`profile-avatars/${userId}/avatar`), null);
assert.equal(normalizeProfileAvatarPath(`${userId}/avatar.webp`), null);

assert.equal(isOwnProfileAvatarPath(userId, `${userId}/avatar`), true);
assert.equal(isOwnProfileAvatarPath(userId, `${otherUserId}/avatar`), false);
assert.equal(isOwnProfileAvatarPath(userId, "not-a-path"), false);
assert.equal(isOwnProfileAvatarPath("not-a-uuid", `${userId}/avatar`), false);

console.log("profile-avatar tests passed");
