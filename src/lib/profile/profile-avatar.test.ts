import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PROFILE_AVATAR_MAX_SIZE_BYTES,
  PROFILE_AVATAR_SIGNED_URL_TTL_SECONDS,
  buildProfileAvatarDeletePayload,
  buildProfileAvatarPath,
  buildProfileAvatarUpdatePayload,
  isOwnProfileAvatarPath,
  mapProfileAvatarState,
  normalizeProfileAvatarPath,
  validateProfileAvatarFile,
} from "./profile-avatar";
import { createProfileAvatarRepository } from "./profile-avatar-repository";

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
}

function createAvatarRepositoryMock(storedPath: string | null = `${userId}/avatar`) {
  const calls: AvatarRepositoryCalls = {
    signedUrls: [],
    uploads: [],
    removes: [],
    profileUpdates: [],
  };

  let profileRow = {
    avatar_path: storedPath,
    avatar_updated_at: storedPath ? "2026-07-07T12:00:00.000Z" : null,
  };

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: userId } },
        error: null,
      }),
    },
    storage: {
      from: () => ({
        createSignedUrl: async (avatarPath: string, expiresIn: number) => {
          calls.signedUrls.push({ path: avatarPath, expiresIn });
          return { data: { signedUrl: "signed-avatar" }, error: null };
        },
        upload: async (
          avatarPath: string,
          _file: File,
          options: { upsert?: boolean; contentType?: string },
        ) => {
          calls.uploads.push({ path: avatarPath, options });
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
        select: () => ({
          eq: (column: string, value: string) => {
            assert.equal(column, "id");
            assert.equal(value, userId);
            return {
              maybeSingle: async () => ({ data: profileRow, error: null }),
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
                  single: async () => ({ data: profileRow, error: null }),
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
  {
    const { calls, repository } = createAvatarRepositoryMock();
    assert.equal(repository.getProfileAvatarSignedUrl.length, 0);
    assert.equal(await repository.getProfileAvatarSignedUrl(), "signed-avatar");
    assert.deepEqual(calls.signedUrls, [{ path: `${userId}/avatar`, expiresIn: 3600 }]);
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
    assert.deepEqual(calls.uploads, [{
      path: `${userId}/avatar`,
      options: { upsert: true, contentType: "image/jpeg" },
    }]);
    assert.equal(calls.profileUpdates[0]?.avatar_path, `${userId}/avatar`);
    assert.deepEqual(calls.signedUrls, [{ path: `${userId}/avatar`, expiresIn: 3600 }]);
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
