import {
  finalizeSessionOperationOwner,
  invalidateSessionOperationOwners,
  isSessionOperationOwnerCurrent,
  settleSessionOperationPromise,
  tryAcquireSessionOperationOwner,
  type SessionOperationOwner,
  type SessionOperationOwnerLock,
} from "@/lib/session/active-workout-session-boundary";
import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";
import type { DataMode } from "@/lib/supabase/session";
import {
  createEmptyProfileAvatarState,
  mergeProfileAvatarMetadata,
  preloadProfileAvatarImage,
  selectProfileAvatarPath,
  type ProfileAvatarState,
} from "@/lib/profile/profile-avatar";
import type { ProfilePersonalDataInput } from "@/lib/profile/profile-form";
import type { ProfilePersonalData } from "@/lib/profile/profile-types";

const PROFILE_AVATAR_REFRESH_THROTTLE_MS = 45 * 1000;

export interface ProfileIdentityPort {
  captureRequestToken(): SessionDataRequestToken;
  isRequestTokenCurrent(token: SessionDataRequestToken): boolean;
}

export interface ProfileDataSource {
  readProfile(expectedUserId: string): Promise<ProfilePersonalData>;
  readAvatar(expectedUserId: string): Promise<ProfileAvatarState>;
  saveProfile(input: ProfilePersonalDataInput, expectedUserId: string): Promise<ProfilePersonalData>;
  uploadAvatar(file: File, expectedUserId: string): Promise<ProfileAvatarState>;
}

export interface ProfileControllerSnapshot {
  readonly profilePersonalData: ProfilePersonalData | null;
  readonly profilePersonalDataLoading: boolean;
  readonly profilePersonalDataError: string;
  readonly profileAvatar: ProfileAvatarState;
  readonly profileAvatarLoading: boolean;
  readonly profileAvatarError: string;
  readonly profileAvatarResetKey: number;
}

export interface ProfileIdentityScopeInput {
  enabled: boolean;
  dataMode: DataMode;
  trainingDataPrepared: boolean;
}

export interface ProfileController {
  getSnapshot(): ProfileControllerSnapshot;
  subscribe(listener: (snapshot: ProfileControllerSnapshot) => void): () => void;
  replaceIdentityScope(input: ProfileIdentityScopeInput): void;
  bootstrap(): Promise<ProfilePersonalData | null>;
  refreshProfile(): Promise<ProfilePersonalData | null>;
  refreshAvatar(options?: ProfileAvatarRefreshOptions): Promise<ProfileAvatarState | null>;
  foreground(): Promise<ProfileAvatarState | null>;
  saveProfile(input: ProfilePersonalDataInput): Promise<ProfilePersonalData | null>;
  uploadAvatar(file: File): Promise<boolean>;
  invalidateIdentity(): void;
  dispose(): void;
}

export interface ProfileAvatarRefreshOptions {
  force?: boolean;
  avatarPath?: string | null;
  allowProfileLookup?: boolean;
  publishProfileLookup?: boolean;
  foreground?: boolean;
  publishLoading?: boolean;
  reuseFreshMemory?: boolean;
}

type ReadLane = "profile" | "avatar";

interface ReadOwner {
  readonly requestId: number;
  readonly requestToken: SessionDataRequestToken;
  readonly userId: string;
  readonly identityKey: string;
}

interface ProfileAvatarMemoryKey {
  readonly generation: number;
  readonly userId: string;
  readonly scope: string;
  readonly identityKey: string;
  readonly avatarPath: string;
  readonly avatarUpdatedAt: string;
}

interface ProfileAvatarMemoryEntry {
  readonly key: ProfileAvatarMemoryKey;
  readonly avatar: ProfileAvatarState;
}

interface ProfileAvatarVersion {
  readonly avatarPath: string;
  readonly avatarUpdatedAt: string;
}

type AvatarPreloadOutcome = "loaded" | "failed" | "stale";

function createInitialSnapshot(resetKey = 0): ProfileControllerSnapshot {
  return {
    profilePersonalData: null,
    profilePersonalDataLoading: false,
    profilePersonalDataError: "",
    profileAvatar: createEmptyProfileAvatarState(),
    profileAvatarLoading: false,
    profileAvatarError: "",
    profileAvatarResetKey: resetKey,
  };
}

export function createProfileController(input: {
  identity: ProfileIdentityPort;
  source: ProfileDataSource;
  now?: () => number;
  preloadAvatarImage?: (avatarUrl: string | null) => Promise<boolean>;
}): ProfileController {
  const listeners = new Set<(snapshot: ProfileControllerSnapshot) => void>();
  const readRequestIds: Record<ReadLane, number> = { profile: 0, avatar: 0 };
  const saveOwner: SessionOperationOwnerLock = { current: null };
  const uploadOwner: SessionOperationOwnerLock = { current: null };
  const now = input.now ?? Date.now;
  const preloadAvatarImage = input.preloadAvatarImage ?? preloadProfileAvatarImage;
  let snapshot = createInitialSnapshot();
  let configuredIdentityKey: string | null = null;
  let enabled = false;
  let dataMode: DataMode = "demo";
  let trainingDataPrepared = false;
  let disposed = false;
  let lastAvatarRefreshAt = 0;
  let bootstrapIdentityKey: string | null = null;
  let bootstrapPromise: Promise<ProfilePersonalData | null> | null = null;
  let avatarMemory: ProfileAvatarMemoryEntry | null = null;
  let foregroundOperation: {
    readonly identityKey: string;
    readonly avatarVersionKey: string;
    readonly promise: Promise<ProfileAvatarState | null>;
  } | null = null;

  function publish(patch: Partial<ProfileControllerSnapshot>) {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  }

  function currentIdentityKey(token: SessionDataRequestToken) {
    return token.userId && token.scope ? `${token.generation}:${token.userId}:${token.scope}` : null;
  }

  function beginRead(lane: ReadLane): ReadOwner | null {
    const requestToken = input.identity.captureRequestToken();
    const identityKey = currentIdentityKey(requestToken);
    if (
      disposed ||
      !enabled ||
      dataMode !== "supabase" ||
      !trainingDataPrepared ||
      !requestToken.userId ||
      !identityKey ||
      identityKey !== configuredIdentityKey ||
      !input.identity.isRequestTokenCurrent(requestToken)
    ) return null;

    const requestId = readRequestIds[lane] + 1;
    readRequestIds[lane] = requestId;
    return { requestId, requestToken, userId: requestToken.userId, identityKey };
  }

  function isReadCurrent(lane: ReadLane, owner: ReadOwner) {
    return !disposed &&
      configuredIdentityKey === owner.identityKey &&
      readRequestIds[lane] === owner.requestId &&
      input.identity.isRequestTokenCurrent(owner.requestToken);
  }

  function createAvatarMemoryKey(
    token: SessionDataRequestToken,
    identityKey: string,
    avatar: ProfileAvatarState,
  ): ProfileAvatarMemoryKey | null {
    if (!token.userId || !token.scope || !avatar.avatarPath || !avatar.avatarUpdatedAt) return null;
    return {
      generation: token.generation,
      userId: token.userId,
      scope: token.scope,
      identityKey,
      avatarPath: avatar.avatarPath,
      avatarUpdatedAt: avatar.avatarUpdatedAt,
    };
  }

  function isAvatarMemoryKeyCurrent(key: ProfileAvatarMemoryKey) {
    const token = input.identity.captureRequestToken();
    return !disposed &&
      configuredIdentityKey === key.identityKey &&
      token.generation === key.generation &&
      token.userId === key.userId &&
      token.scope === key.scope &&
      input.identity.isRequestTokenCurrent(token);
  }

  function getSnapshotAvatarVersion(): ProfileAvatarVersion | null {
    const metadata = snapshot.profilePersonalData ?? snapshot.profileAvatar;
    if (!metadata.avatarPath || !metadata.avatarUpdatedAt) return null;
    return {
      avatarPath: metadata.avatarPath,
      avatarUpdatedAt: metadata.avatarUpdatedAt,
    };
  }

  function avatarVersionKey(version: ProfileAvatarVersion | null) {
    return version ? `${version.avatarPath}:${version.avatarUpdatedAt}` : "unversioned";
  }

  function isAvatarVersionCurrent(version: ProfileAvatarVersion) {
    const currentVersion = getSnapshotAvatarVersion();
    return currentVersion?.avatarPath === version.avatarPath &&
      currentVersion.avatarUpdatedAt === version.avatarUpdatedAt;
  }

  function getCurrentAvatarMemory(version: ProfileAvatarVersion | null): ProfileAvatarMemoryEntry | null {
    if (
      !avatarMemory ||
      !version ||
      !isAvatarMemoryKeyCurrent(avatarMemory.key) ||
      avatarMemory.key.avatarPath !== version.avatarPath ||
      avatarMemory.key.avatarUpdatedAt !== version.avatarUpdatedAt
    ) return null;
    return avatarMemory;
  }

  function rememberAvatar(token: SessionDataRequestToken, identityKey: string, avatar: ProfileAvatarState) {
    const key = createAvatarMemoryKey(token, identityKey, avatar);
    avatarMemory = key && avatar.avatarPath && avatar.avatarUrl
      ? { key, avatar }
      : null;
  }

  function invalidateAvatarMemory() {
    avatarMemory = null;
    foregroundOperation = null;
  }

  async function preloadAvatarForRead(owner: ReadOwner, avatar: ProfileAvatarState): Promise<AvatarPreloadOutcome> {
    let loaded = false;
    try {
      loaded = await preloadAvatarImage(avatar.avatarUrl);
    } catch {
      loaded = false;
    }
    if (!isReadCurrent("avatar", owner)) return "stale";
    return loaded ? "loaded" : "failed";
  }

  async function preloadAvatarForWrite(
    owner: SessionOperationOwner,
    avatar: ProfileAvatarState,
  ): Promise<AvatarPreloadOutcome> {
    let loaded = false;
    try {
      loaded = await preloadAvatarImage(avatar.avatarUrl);
    } catch {
      loaded = false;
    }
    if (!isWriteCurrent(uploadOwner, owner)) return "stale";
    return loaded ? "loaded" : "failed";
  }

  function invalidateReads() {
    readRequestIds.profile += 1;
    readRequestIds.avatar += 1;
  }

  function acquireWrite(lock: SessionOperationOwnerLock) {
    const token = input.identity.captureRequestToken();
    if (
      disposed ||
      !enabled ||
      dataMode !== "supabase" ||
      !token.userId ||
      !token.scope ||
      currentIdentityKey(token) !== configuredIdentityKey ||
      !input.identity.isRequestTokenCurrent(token)
    ) return null;
    const owner = tryAcquireSessionOperationOwner(lock.current, token, { dataMode, operationId: "profile" });
    if (owner) lock.current = owner;
    return owner;
  }

  function isWriteCurrent(lock: SessionOperationOwnerLock, owner: SessionOperationOwner) {
    return isSessionOperationOwnerCurrent({
      currentOwner: lock.current,
      owner,
      isRequestCurrent: input.identity.isRequestTokenCurrent,
    });
  }

  function finalizeWrite(lock: SessionOperationOwnerLock, owner: SessionOperationOwner) {
    const result = finalizeSessionOperationOwner({
      currentOwner: lock.current,
      owner,
      isRequestCurrent: input.identity.isRequestTokenCurrent,
    });
    lock.current = result.nextOwner;
    return result.canFinalize;
  }

  async function runAvatarRead(
    owner: ReadOwner,
    options: ProfileAvatarRefreshOptions,
    publishLoading: boolean,
  ): Promise<ProfileAvatarState | null> {
    if (!isReadCurrent("avatar", owner)) return null;
    let expectedVersion = getSnapshotAvatarVersion();
    const refreshAt = now();
    if (
      (options.reuseFreshMemory || !options.force) &&
      refreshAt - lastAvatarRefreshAt < PROFILE_AVATAR_REFRESH_THROTTLE_MS
    ) {
      const memory = getCurrentAvatarMemory(expectedVersion);
      if (memory) return memory.avatar;
    }
    lastAvatarRefreshAt = refreshAt;
    if (publishLoading) publish({ profileAvatarLoading: true, profileAvatarError: "" });
    try {
      const snapshotAvatarPath = snapshot.profilePersonalData
        ? snapshot.profilePersonalData.avatarPath
        : snapshot.profileAvatar.avatarPath;
      let avatarPath = selectProfileAvatarPath(options.avatarPath, snapshotAvatarPath);
      if (!avatarPath && options.allowProfileLookup) {
        const profile = await input.source.readProfile(owner.userId);
        if (!isReadCurrent("avatar", owner)) return null;
        if (options.publishProfileLookup) publish({ profilePersonalData: profile });
        avatarPath = profile.avatarPath;
        expectedVersion = profile.avatarPath && profile.avatarUpdatedAt
          ? { avatarPath: profile.avatarPath, avatarUpdatedAt: profile.avatarUpdatedAt }
          : null;
      }
      if (!avatarPath) {
        if (!isReadCurrent("avatar", owner)) return null;
        const emptyAvatar = createEmptyProfileAvatarState();
        avatarMemory = null;
        publish({
          profileAvatar: emptyAvatar,
          profileAvatarError: "",
          profileAvatarResetKey: snapshot.profileAvatarResetKey + 1,
        });
        return emptyAvatar;
      }

      const avatar = await input.source.readAvatar(owner.userId);
      if (!isReadCurrent("avatar", owner)) return null;
      if (
        expectedVersion &&
        (avatar.avatarPath || avatar.avatarUpdatedAt) &&
        (avatar.avatarPath !== expectedVersion.avatarPath ||
          avatar.avatarUpdatedAt !== expectedVersion.avatarUpdatedAt)
      ) {
        lastAvatarRefreshAt = 0;
        return null;
      }
      if (expectedVersion && !isAvatarVersionCurrent(expectedVersion) && snapshot.profilePersonalData) {
        lastAvatarRefreshAt = 0;
        return null;
      }
      const hasCompleteAvatarVersion = Boolean(
        avatar.avatarPath && avatar.avatarUrl && avatar.avatarUpdatedAt,
      );
      const hasEmptyAvatarVersion = !avatar.avatarPath && !avatar.avatarUrl && !avatar.avatarUpdatedAt;
      if (!hasCompleteAvatarVersion && !hasEmptyAvatarVersion) {
        throw new Error("Profile avatar version is incomplete");
      }
      if (hasCompleteAvatarVersion) {
        const preloadOutcome = await preloadAvatarForRead(owner, avatar);
        if (preloadOutcome === "stale") return null;
        if (preloadOutcome === "failed") throw new Error("Profile avatar preload failed");
      }
      if (!isReadCurrent("avatar", owner)) return null;
      if (expectedVersion && !isAvatarVersionCurrent(expectedVersion) && snapshot.profilePersonalData) {
        lastAvatarRefreshAt = 0;
        return null;
      }
      rememberAvatar(owner.requestToken, owner.identityKey, avatar);
      publish({
        profileAvatar: avatar,
        profileAvatarError: "",
        profileAvatarResetKey: avatar.avatarUrl
          ? snapshot.profileAvatarResetKey + 1
          : snapshot.profileAvatarResetKey,
      });
      return avatar;
    } catch {
      if (!isReadCurrent("avatar", owner)) return null;
      lastAvatarRefreshAt = 0;
      publish({
        profileAvatarError: "No pudimos actualizar tu foto de perfil. La mostraremos apenas vuelva a estar disponible.",
      });
      return null;
    } finally {
      if (isReadCurrent("avatar", owner)) publish({ profileAvatarLoading: false });
    }
  }

  function startAvatarRead(
    options: ProfileAvatarRefreshOptions,
    publishLoading: boolean,
  ): Promise<ProfileAvatarState | null> {
    const owner = beginRead("avatar");
    if (!owner) return Promise.resolve(null);
    return runAvatarRead(owner, options, publishLoading);
  }

  const controller: ProfileController = {
    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      disposed = false;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    replaceIdentityScope(next) {
      const token = input.identity.captureRequestToken();
      const nextIdentityKey = next.enabled && next.dataMode === "supabase"
        ? currentIdentityKey(token)
        : null;
      const identityChanged = nextIdentityKey !== configuredIdentityKey;
      enabled = next.enabled;
      dataMode = next.dataMode;
      trainingDataPrepared = next.trainingDataPrepared;
      if (!identityChanged) return;

      configuredIdentityKey = nextIdentityKey;
      invalidateReads();
      invalidateSessionOperationOwners([saveOwner, uploadOwner]);
      invalidateAvatarMemory();
      lastAvatarRefreshAt = 0;
      bootstrapIdentityKey = null;
      bootstrapPromise = null;
      publish(createInitialSnapshot(snapshot.profileAvatarResetKey + 1));
    },

    async bootstrap() {
      if (!configuredIdentityKey || !enabled || !trainingDataPrepared) return null;
      if (bootstrapIdentityKey === configuredIdentityKey) return snapshot.profilePersonalData;
      if (bootstrapPromise) return bootstrapPromise;

      const identityKey = configuredIdentityKey;
      bootstrapPromise = controller.refreshProfile().then((profile) => {
        if (
          profile &&
          configuredIdentityKey === identityKey &&
          !snapshot.profileAvatarLoading &&
          !snapshot.profileAvatarError
        ) bootstrapIdentityKey = identityKey;
        return profile;
      }).finally(() => {
        if (configuredIdentityKey === identityKey) bootstrapPromise = null;
      });
      return bootstrapPromise;
    },

    async refreshProfile() {
      const profileOwner = beginRead("profile");
      const avatarOwner = beginRead("avatar");
      if (!profileOwner || !avatarOwner) return null;
      publish({
        profilePersonalDataLoading: true,
        profilePersonalDataError: "",
        profileAvatarLoading: true,
        profileAvatarError: "",
      });
      try {
        const profile = await input.source.readProfile(profileOwner.userId);
        if (!isReadCurrent("profile", profileOwner)) return null;
        publish({ profilePersonalData: profile });
        await runAvatarRead(avatarOwner, { force: true, avatarPath: profile.avatarPath }, false);
        if (!isReadCurrent("profile", profileOwner)) return null;
        return profile;
      } catch (error) {
        if (!isReadCurrent("profile", profileOwner)) return null;
        publish({
          profilePersonalDataError: error instanceof Error
            ? error.message
            : "No pudimos cargar tu perfil.",
        });
        return null;
      } finally {
        const ownsProfileLoading = isReadCurrent("profile", profileOwner);
        const ownsAvatarLoading = isReadCurrent("avatar", avatarOwner);
        if (ownsProfileLoading || ownsAvatarLoading) {
          publish({
            ...(ownsProfileLoading ? { profilePersonalDataLoading: false } : {}),
            ...(ownsAvatarLoading ? { profileAvatarLoading: false } : {}),
          });
        }
      }
    },

    async refreshAvatar(options = {}) {
      const identityKey = configuredIdentityKey;
      const expectedVersion = getSnapshotAvatarVersion();
      const expectedVersionKey = avatarVersionKey(expectedVersion);
      if (options.foreground) {
        if (!identityKey) return null;
        if (
          foregroundOperation?.identityKey === identityKey &&
          foregroundOperation.avatarVersionKey === expectedVersionKey
        ) return foregroundOperation.promise;
        if (uploadOwner.current) return snapshot.profileAvatar.avatarUrl ? snapshot.profileAvatar : null;
        if (snapshot.profileAvatarLoading) return getCurrentAvatarMemory(expectedVersion)?.avatar ?? null;
      }

      const request = startAvatarRead(options, options.publishLoading ?? true);
      if (!options.foreground || !identityKey) return request;
      const trackedRequest = request.finally(() => {
        if (foregroundOperation?.promise === trackedRequest) foregroundOperation = null;
      });
      foregroundOperation = {
        identityKey,
        avatarVersionKey: expectedVersionKey,
        promise: trackedRequest,
      };
      return trackedRequest;
    },

    foreground() {
      return controller.refreshAvatar({
        force: true,
        allowProfileLookup: true,
        publishProfileLookup: false,
        foreground: true,
        publishLoading: false,
        reuseFreshMemory: true,
      });
    },

    async saveProfile(profileInput) {
      const owner = acquireWrite(saveOwner);
      if (!owner || !owner.userId) return null;
      const allowlistedInput: ProfilePersonalDataInput = {
        firstName: profileInput.firstName,
        lastName: profileInput.lastName,
        birthDate: profileInput.birthDate,
        gender: profileInput.gender,
        phoneNumber: profileInput.phoneNumber,
      };
      try {
        if (!isWriteCurrent(saveOwner, owner)) return null;
        const result = await settleSessionOperationPromise({
          request: input.source.saveProfile(allowlistedInput, owner.userId),
          owner,
          getCurrentOwner: () => saveOwner.current,
          isRequestCurrent: input.identity.isRequestTokenCurrent,
        });
        if (result.kind === "stale") return null;
        if (result.kind === "error") throw result.error;
        if (!isWriteCurrent(saveOwner, owner)) return null;
        publish({ profilePersonalData: result.value });
        return result.value;
      } finally {
        finalizeWrite(saveOwner, owner);
      }
    },

    async uploadAvatar(file) {
      const owner = acquireWrite(uploadOwner);
      if (!owner || !owner.userId) return false;
      readRequestIds.avatar += 1;
      invalidateAvatarMemory();
      lastAvatarRefreshAt = 0;
      try {
        if (!isWriteCurrent(uploadOwner, owner)) return false;
        const result = await settleSessionOperationPromise({
          request: input.source.uploadAvatar(file, owner.userId),
          owner,
          getCurrentOwner: () => uploadOwner.current,
          isRequestCurrent: input.identity.isRequestTokenCurrent,
        });
        if (result.kind === "stale") return false;
        if (result.kind === "error") throw result.error;
        if (!isWriteCurrent(uploadOwner, owner)) return false;
        if (!result.value.avatarPath || !result.value.avatarUrl || !result.value.avatarUpdatedAt) {
          publish({
            profileAvatarError: "No pudimos actualizar tu foto de perfil. La mostraremos apenas vuelva a estar disponible.",
          });
          throw new Error("No pudimos guardar la foto. Prueba con otra imagen.");
        }
        const preloadOutcome = await preloadAvatarForWrite(owner, result.value);
        if (preloadOutcome === "stale") return false;
        if (preloadOutcome === "failed") {
          publish({
            profileAvatarError: "No pudimos actualizar tu foto de perfil. La mostraremos apenas vuelva a estar disponible.",
          });
          throw new Error("No pudimos guardar la foto. Prueba con otra imagen.");
        }
        if (!isWriteCurrent(uploadOwner, owner)) return false;
        const identityKey = currentIdentityKey(owner.requestToken);
        if (!identityKey || identityKey !== configuredIdentityKey) return false;
        rememberAvatar(owner.requestToken, identityKey, result.value);
        if (!isWriteCurrent(uploadOwner, owner)) return false;
        readRequestIds.avatar += 1;
        lastAvatarRefreshAt = now();
        publish({
          profileAvatar: result.value,
          profileAvatarLoading: false,
          profileAvatarError: "",
          profileAvatarResetKey: snapshot.profileAvatarResetKey + 1,
          profilePersonalData: mergeProfileAvatarMetadata(snapshot.profilePersonalData, result.value),
        });
        return true;
      } finally {
        finalizeWrite(uploadOwner, owner);
      }
    },

    invalidateIdentity() {
      configuredIdentityKey = null;
      enabled = false;
      trainingDataPrepared = false;
      invalidateReads();
      invalidateSessionOperationOwners([saveOwner, uploadOwner]);
      invalidateAvatarMemory();
      bootstrapIdentityKey = null;
      bootstrapPromise = null;
      publish(createInitialSnapshot(snapshot.profileAvatarResetKey + 1));
    },

    dispose() {
      if (disposed) return;
      controller.invalidateIdentity();
      disposed = true;
      listeners.clear();
    },
  };

  return controller;
}
