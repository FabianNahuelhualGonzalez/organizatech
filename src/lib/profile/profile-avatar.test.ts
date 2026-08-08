import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PROFILE_AVATAR_MAX_SIZE_BYTES,
  PROFILE_AVATAR_IMAGE_ERROR_REFRESH_THROTTLE_MS,
  PROFILE_AVATAR_FOREGROUND_EVENT_DEDUP_MS,
  PROFILE_AVATAR_SIGNED_URL_TTL_SECONDS,
  buildProfileAvatarDeletePayload,
  buildProfileAvatarPath,
  buildProfileAvatarUpdatePayload,
  createEmptyProfileAvatarState,
  isOwnProfileAvatarPath,
  mapProfileAvatarState,
  mergeProfileAvatarMetadata,
  normalizeProfileAvatarPath,
  preloadProfileAvatarImage,
  selectProfileAvatarPath,
  shouldRefreshProfileAvatarAfterImageError,
  shouldRefreshProfileAvatarOnForegroundEvent,
  validateProfileAvatarFile,
} from "./profile-avatar";
import { createProfileAvatarRepository } from "./profile-avatar-repository";

const userId = "123e4567-e89b-12d3-a456-426614174000";
const otherUserId = "223e4567-e89b-12d3-a456-426614174000";

function file(type: string, size = 1024) {
  return { type, size, name: "avatar" };
}

function testEmptyAvatarStateIsFreshAndDeterministic() {
  const first = createEmptyProfileAvatarState();
  const second = createEmptyProfileAvatarState();
  const expected = {
    avatarPath: null,
    avatarUrl: null,
    avatarUpdatedAt: null,
  };

  assert.deepEqual(first, expected);
  assert.deepEqual(second, expected);
  assert.notEqual(first, second);

  Object.assign(first, { avatarPath: `${userId}/avatar` });
  assert.deepEqual(second, expected);
  assert.deepEqual(createEmptyProfileAvatarState(), expected);
}

function testAvatarPathSelectionPreservesNullishPrecedence() {
  const candidates = [undefined, null, `${userId}/avatar`] as const;

  assert.equal(selectProfileAvatarPath(...candidates), `${userId}/avatar`);
  assert.equal(selectProfileAvatarPath(...candidates), `${userId}/avatar`);
  assert.equal(selectProfileAvatarPath(`${otherUserId}/avatar`, `${userId}/avatar`), `${otherUserId}/avatar`);
  assert.equal(selectProfileAvatarPath("", `${userId}/avatar`), "");
  assert.equal(selectProfileAvatarPath(undefined, null), null);
  assert.deepEqual(candidates, [undefined, null, `${userId}/avatar`]);
}

function testAvatarMetadataMergeIsImmutableAndIdentityIsolated() {
  const profileA = {
    id: "profile-a",
    displayName: "Usuario A",
    avatarPath: `${otherUserId}/avatar`,
    avatarUpdatedAt: "2026-07-01T12:00:00.000Z",
  };
  const avatarA = {
    avatarPath: `${userId}/avatar`,
    avatarUpdatedAt: "2026-07-07T12:00:00.000Z",
  };
  const profileABefore = { ...profileA };
  const avatarABefore = { ...avatarA };
  const firstMergeA = mergeProfileAvatarMetadata(profileA, avatarA);
  const secondMergeA = mergeProfileAvatarMetadata(profileA, avatarA);

  assert.deepEqual(firstMergeA, {
    ...profileA,
    ...avatarA,
  });
  assert.deepEqual(firstMergeA, secondMergeA);
  assert.notEqual(firstMergeA, secondMergeA);
  assert.notEqual(firstMergeA, profileA);
  assert.deepEqual(profileA, profileABefore);
  assert.deepEqual(avatarA, avatarABefore);

  const profileB = {
    id: "profile-b",
    displayName: "Usuario B",
    avatarPath: null,
    avatarUpdatedAt: null,
  };
  const mergedB = mergeProfileAvatarMetadata(profileB, {
    avatarPath: `${otherUserId}/avatar`,
    avatarUpdatedAt: "2026-07-08T12:00:00.000Z",
  });

  assert.equal(firstMergeA?.id, "profile-a");
  assert.equal(firstMergeA?.avatarPath, `${userId}/avatar`);
  assert.equal(mergedB?.id, "profile-b");
  assert.equal(mergedB?.avatarPath, `${otherUserId}/avatar`);
  assert.equal(mergeProfileAvatarMetadata(null, createEmptyProfileAvatarState()), null);
}

testEmptyAvatarStateIsFreshAndDeterministic();
testAvatarPathSelectionPreservesNullishPrecedence();
testAvatarMetadataMergeIsImmutableAndIdentityIsolated();

assert.deepEqual(validateProfileAvatarFile(file("image/jpeg")), { ok: true });
assert.deepEqual(validateProfileAvatarFile(file("image/png")), { ok: true });
assert.deepEqual(validateProfileAvatarFile(file("image/webp")), { ok: true });
assert.deepEqual(validateProfileAvatarFile(file("image/jpeg", PROFILE_AVATAR_MAX_SIZE_BYTES)), { ok: true });

assert.equal(validateProfileAvatarFile(null).ok, false);
assert.equal(validateProfileAvatarFile(undefined).ok, false);
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
assert.equal(normalizeProfileAvatarPath(`${userId}//avatar`), null);
assert.equal(normalizeProfileAvatarPath(`${userId}/../avatar`), null);
assert.equal(normalizeProfileAvatarPath(`https://example.com/${userId}/avatar`), null);
assert.equal(normalizeProfileAvatarPath(`profile-avatars/${userId}/avatar`), null);
assert.equal(normalizeProfileAvatarPath(`${userId}/avatar.webp`), null);

assert.equal(isOwnProfileAvatarPath(userId, `${userId}/avatar`), true);
assert.equal(isOwnProfileAvatarPath(userId.toUpperCase(), `${userId}/avatar`), true);
assert.equal(isOwnProfileAvatarPath(userId, `${otherUserId}/avatar`), false);
assert.equal(isOwnProfileAvatarPath(userId, "not-a-path"), false);
assert.equal(isOwnProfileAvatarPath("not-a-uuid", `${userId}/avatar`), false);

assert.equal(PROFILE_AVATAR_SIGNED_URL_TTL_SECONDS, 3600);
assert.equal(PROFILE_AVATAR_IMAGE_ERROR_REFRESH_THROTTLE_MS, 8000);
assert.equal(PROFILE_AVATAR_FOREGROUND_EVENT_DEDUP_MS, 1000);
assert.equal(shouldRefreshProfileAvatarAfterImageError(10_000, 17_999), false);
assert.equal(shouldRefreshProfileAvatarAfterImageError(10_000, 18_000), true);
assert.equal(shouldRefreshProfileAvatarAfterImageError(10_000, 9_000), false);
assert.equal(shouldRefreshProfileAvatarOnForegroundEvent(10_000, 10_999), false);
assert.equal(shouldRefreshProfileAvatarOnForegroundEvent(10_000, 11_000), true);

{
  const updatedAt = "2026-07-07T12:00:00.000Z";
  assert.deepEqual(buildProfileAvatarUpdatePayload(userId, updatedAt), {
    avatar_path: `${userId}/avatar`,
    avatar_updated_at: updatedAt,
  });
  assert.throws(() => buildProfileAvatarUpdatePayload("not-a-uuid", updatedAt));
  assert.throws(() => buildProfileAvatarUpdatePayload(userId, "invalid-date"));
}

assert.deepEqual(buildProfileAvatarDeletePayload(), {
  avatar_path: null,
  avatar_updated_at: null,
});

assert.deepEqual(mapProfileAvatarState({
  avatar_path: `${userId}/avatar`,
  avatar_updated_at: "2026-07-07T12:00:00.000Z",
}, " https://signed.example/avatar "), {
  avatarPath: `${userId}/avatar`,
  avatarUrl: "https://signed.example/avatar",
  avatarUpdatedAt: "2026-07-07T12:00:00.000Z",
});

assert.deepEqual(mapProfileAvatarState({
  avatar_path: "https://external.example/avatar",
  avatar_updated_at: "invalid",
}, ""), {
  avatarPath: null,
  avatarUrl: null,
  avatarUpdatedAt: null,
});

interface AvatarRepositoryCalls {
  signedUrls: Array<{ path: string; expiresIn: number }>;
  uploads: Array<{ path: string; options: { upsert?: boolean; contentType?: string } }>;
  removes: string[][];
  profileUpdates: Array<Record<string, unknown>>;
  profileReads: number;
  profileSelects: string[];
}

interface AvatarRepositoryMockOptions {
  switchUserAfterProfileRead?: string;
  switchUserAfterUpload?: string;
  switchUserAfterProfileUpdate?: string;
  switchUserAfterSignedUrl?: string;
  emptySignedUrlResponses?: number;
  signedUrlFailures?: number;
}

function createAvatarRepositoryMock(
  storedPath: string | null = `${userId}/avatar`,
  options: AvatarRepositoryMockOptions = {},
) {
  const calls: AvatarRepositoryCalls = {
    signedUrls: [],
    uploads: [],
    removes: [],
    profileUpdates: [],
    profileReads: 0,
    profileSelects: [],
  };

  let activeUserId = userId;
  let emptySignedUrlResponses = options.emptySignedUrlResponses ?? 0;
  let signedUrlFailures = options.signedUrlFailures ?? 0;
  let profileRow = {
    avatar_path: storedPath,
    avatar_updated_at: storedPath ? "2026-07-07T12:00:00.000Z" : null,
  };

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: activeUserId } },
        error: null,
      }),
    },
    storage: {
      from: () => ({
        createSignedUrl: async (avatarPath: string, expiresIn: number) => {
          calls.signedUrls.push({ path: avatarPath, expiresIn });
          if (options.switchUserAfterSignedUrl) {
            activeUserId = options.switchUserAfterSignedUrl;
          }
          if (signedUrlFailures > 0) {
            signedUrlFailures -= 1;
            return { data: { signedUrl: null }, error: new Error("signed URL unavailable") };
          }
          if (emptySignedUrlResponses > 0) {
            emptySignedUrlResponses -= 1;
            return { data: { signedUrl: "" }, error: null };
          }
          return { data: { signedUrl: "signed-avatar" }, error: null };
        },
        upload: async (
          avatarPath: string,
          _file: File,
          uploadOptions: { upsert?: boolean; contentType?: string },
        ) => {
          calls.uploads.push({ path: avatarPath, options: uploadOptions });
          if (options.switchUserAfterUpload) {
            activeUserId = options.switchUserAfterUpload;
          }
          return { data: { path: avatarPath }, error: null };
        },
        remove: async (avatarPaths: string[]) => {
          calls.removes.push(avatarPaths);
          return { data: [], error: null };
        },
      }),
    },
    from: (table: string) => {
      assert.equal(table, "profiles");
      return {
        select: (columns: string) => ({
          eq: (column: string, value: string) => {
            assert.equal(column, "id");
            assert.equal(value, userId);
            return {
              maybeSingle: async () => {
                calls.profileReads += 1;
                calls.profileSelects.push(columns);
                const selectedColumns = new Set(columns.split(","));
                const selectedRow = {
                  ...(selectedColumns.has("avatar_path") ? { avatar_path: profileRow.avatar_path } : {}),
                  ...(selectedColumns.has("avatar_updated_at")
                    ? { avatar_updated_at: profileRow.avatar_updated_at }
                    : {}),
                };
                if (options.switchUserAfterProfileRead) {
                  activeUserId = options.switchUserAfterProfileRead;
                }
                return { data: selectedRow, error: null };
              },
            };
          },
        }),
        update: (payload: Record<string, unknown>) => {
          calls.profileUpdates.push(payload);
          profileRow = {
            avatar_path: typeof payload.avatar_path === "string" ? payload.avatar_path : null,
            avatar_updated_at: typeof payload.avatar_updated_at === "string" ? payload.avatar_updated_at : null,
          };
          return {
            eq: (column: string, value: string) => {
              assert.equal(column, "id");
              assert.equal(value, userId);
              return {
                select: () => ({
                  single: async () => {
                    if (options.switchUserAfterProfileUpdate) {
                      activeUserId = options.switchUserAfterProfileUpdate;
                    }
                    return { data: profileRow, error: null };
                  },
                }),
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    calls,
    repository: createProfileAvatarRepository(() => client),
  };
}

async function runRepositoryTests() {
  assert.equal(typeof Image, "undefined");
  assert.equal(await preloadProfileAvatarImage("https://signed.invalid/avatar"), true);
  assert.equal(await preloadProfileAvatarImage(null), false);

  const originalImageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
  try {
    class FailingImage {
      complete = false;
      naturalWidth = 0;
      decoding = "auto";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_avatarUrl: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      writable: true,
      value: FailingImage,
    });
    assert.equal(await preloadProfileAvatarImage("https://signed.invalid/onerror"), false);

    class DecodeFailingImage extends FailingImage {
      override set src(_avatarUrl: string) {
        queueMicrotask(() => this.onload?.());
      }

      decode() {
        return Promise.reject(new Error("decode failed"));
      }
    }
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      writable: true,
      value: DecodeFailingImage,
    });
    assert.equal(await preloadProfileAvatarImage("https://signed.invalid/decode-error"), false);
  } finally {
    if (originalImageDescriptor) Object.defineProperty(globalThis, "Image", originalImageDescriptor);
    else Reflect.deleteProperty(globalThis, "Image");
  }

  {
    const { calls, repository } = createAvatarRepositoryMock();
    assert.equal(repository.getProfileAvatarSignedUrl.length, 0);
    assert.equal(await repository.getProfileAvatarSignedUrl(), "signed-avatar");
    assert.deepEqual(calls.signedUrls, [{ path: `${userId}/avatar`, expiresIn: 3600 }]);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock();
    assert.deepEqual(await repository.getCurrentProfileAvatar(userId), {
      avatarPath: `${userId}/avatar`,
      avatarUrl: "signed-avatar",
      avatarUpdatedAt: "2026-07-07T12:00:00.000Z",
    });
    assert.equal(calls.profileReads, 1);
    assert.deepEqual(calls.profileSelects, ["avatar_path,avatar_updated_at"]);
    assert.deepEqual(calls.signedUrls, [{ path: `${userId}/avatar`, expiresIn: 3600 }]);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock();
    await assert.rejects(
      repository.getCurrentProfileAvatar(otherUserId),
      /Tu sesión cambió/,
    );
    assert.equal(calls.profileReads, 0);
    assert.deepEqual(calls.signedUrls, []);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock(`${userId}/avatar`, {
      switchUserAfterProfileRead: otherUserId,
    });
    await assert.rejects(
      repository.getCurrentProfileAvatar(userId),
      /Tu sesión cambió/,
    );
    assert.equal(calls.profileReads, 1);
    assert.deepEqual(calls.signedUrls, []);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock(`${userId}/avatar`, {
      switchUserAfterSignedUrl: otherUserId,
    });
    await assert.rejects(
      repository.getCurrentProfileAvatar(userId),
      /Tu sesión cambió/,
    );
    assert.deepEqual(calls.signedUrls, [{ path: `${userId}/avatar`, expiresIn: 3600 }]);
  }

  {
    const { repository } = createAvatarRepositoryMock(`${userId}/avatar`, { signedUrlFailures: 1 });
    await assert.rejects(
      repository.getCurrentProfileAvatar(userId),
      /No se pudo obtener la foto de perfil/,
    );
    assert.equal((await repository.getCurrentProfileAvatar(userId)).avatarUrl, "signed-avatar");
  }

  {
    const { repository } = createAvatarRepositoryMock(`${userId}/avatar`, { emptySignedUrlResponses: 1 });
    await assert.rejects(
      repository.getCurrentProfileAvatar(userId),
      /No se pudo obtener la foto de perfil/,
    );
    assert.equal((await repository.getCurrentProfileAvatar(userId)).avatarUrl, "signed-avatar");
  }

  for (const storedPath of [
    `${otherUserId}/avatar`,
    `${userId}/avatar.webp`,
    `${userId}/nested/avatar`,
    `../${userId}/avatar`,
  ]) {
    const { calls, repository } = createAvatarRepositoryMock(storedPath);
    assert.equal(await repository.getProfileAvatarSignedUrl(), null);
    assert.deepEqual(calls.signedUrls, []);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock(null);
    const avatarFile = file("image/jpeg") as unknown as File;
    const avatar = await repository.uploadProfileAvatar(avatarFile);
    assert.equal(avatar.avatarPath, `${userId}/avatar`);
    assert.equal(avatar.avatarUrl, "signed-avatar");
    assert.deepEqual(calls.uploads, [{
      path: `${userId}/avatar`,
      options: { upsert: true, contentType: "image/jpeg" },
    }]);
    assert.deepEqual(Object.keys(calls.profileUpdates[0] ?? {}).sort(), [
      "avatar_path",
      "avatar_updated_at",
    ]);
    assert.equal(calls.profileUpdates[0]?.avatar_path, `${userId}/avatar`);
    assert.equal(avatar.avatarUpdatedAt, calls.profileUpdates[0]?.avatar_updated_at);
    assert.match(String(avatar.avatarUpdatedAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(calls.signedUrls, [{ path: `${userId}/avatar`, expiresIn: 3600 }]);

    assert.deepEqual(await repository.getCurrentProfileAvatar(userId), avatar);
    assert.deepEqual(calls.signedUrls, [
      { path: `${userId}/avatar`, expiresIn: 3600 },
      { path: `${userId}/avatar`, expiresIn: 3600 },
    ]);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock(null);
    await assert.rejects(
      repository.uploadProfileAvatar(file("image/jpeg") as unknown as File, otherUserId),
      /Tu sesión cambió/,
    );
    assert.deepEqual(calls.uploads, []);
    assert.deepEqual(calls.profileUpdates, []);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock(null, {
      switchUserAfterUpload: otherUserId,
    });
    await assert.rejects(
      repository.uploadProfileAvatar(file("image/jpeg") as unknown as File, userId),
      /Tu sesión cambió/,
    );
    assert.equal(calls.uploads.length, 1);
    assert.deepEqual(calls.profileUpdates, []);
    assert.deepEqual(calls.signedUrls, []);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock(null, {
      switchUserAfterProfileUpdate: otherUserId,
    });
    await assert.rejects(
      repository.uploadProfileAvatar(file("image/jpeg") as unknown as File, userId),
      /Tu sesión cambió/,
    );
    assert.equal(calls.profileUpdates.length, 1);
    assert.deepEqual(calls.signedUrls, []);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock(null, {
      switchUserAfterSignedUrl: otherUserId,
    });
    await assert.rejects(
      repository.uploadProfileAvatar(file("image/jpeg") as unknown as File, userId),
      /Tu sesión cambió/,
    );
    assert.equal(calls.profileUpdates.length, 1);
    assert.equal(calls.signedUrls.length, 1);
  }

  {
    const { calls, repository } = createAvatarRepositoryMock();
    assert.equal(repository.deleteProfileAvatar.length, 0);
    assert.deepEqual(await repository.deleteProfileAvatar(), {
      avatarPath: null,
      avatarUrl: null,
      avatarUpdatedAt: null,
    });
    assert.deepEqual(calls.removes, [[`${userId}/avatar`]]);
    assert.deepEqual(calls.profileUpdates.at(-1), {
      avatar_path: null,
      avatar_updated_at: null,
    });
  }

  {
    const { calls, repository } = createAvatarRepositoryMock();
    await assert.rejects(
      repository.uploadProfileAvatar(file("image/svg+xml") as unknown as File),
      /JPG, PNG o WEBP/,
    );
    await assert.rejects(
      repository.uploadProfileAvatar(file("image/jpeg", PROFILE_AVATAR_MAX_SIZE_BYTES + 1) as unknown as File),
      /2 MB o menos/,
    );
    assert.deepEqual(calls.uploads, []);
  }
}

function assertMigrationContract() {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20260713_p0_h_profile_avatar_hardening.sql",
  );
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /profiles_avatar_path_canonical_check/);
  assert.match(migration, /avatar_path = id::text \|\| '\/avatar'/);
  assert.match(migration, /P0-H: bucket profile-avatars does not exist/);
  assert.match(migration, /noncanonical profiles\.avatar_path/);
  assert.match(migration, /orphan profile avatar objects/);
  assert.match(migration, /broken profile avatar references/);
  assert.equal((migration.match(/create policy "profile avatars own (?:read|insert|update|delete)"/g) ?? []).length, 8);
  assert.equal((migration.match(/name = auth\.uid\(\)::text \|\| '\/avatar'/g) ?? []).length, 5);
  assert.match(migration, /Rollback P0-H/);
  assert.match(migration, /storage\.foldername\(name\)/);
}

assertMigrationContract();
void runRepositoryTests()
  .then(() => console.log("profile-avatar tests passed"))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
