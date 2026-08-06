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
}

type ReadLane = "profile" | "avatar";

interface ReadOwner {
  readonly requestId: number;
  readonly requestToken: SessionDataRequestToken;
  readonly userId: string;
  readonly identityKey: string;
}

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
}): ProfileController {
  const listeners = new Set<(snapshot: ProfileControllerSnapshot) => void>();
  const readRequestIds: Record<ReadLane, number> = { profile: 0, avatar: 0 };
  const saveOwner: SessionOperationOwnerLock = { current: null };
  const uploadOwner: SessionOperationOwnerLock = { current: null };
  const now = input.now ?? Date.now;
  let snapshot = createInitialSnapshot();
  let configuredIdentityKey: string | null = null;
  let enabled = false;
  let dataMode: DataMode = "demo";
  let trainingDataPrepared = false;
  let disposed = false;
  let lastAvatarRefreshAt = 0;
  let bootstrapIdentityKey: string | null = null;
  let bootstrapPromise: Promise<ProfilePersonalData | null> | null = null;

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
    const refreshAt = now();
    if (!options.force && refreshAt - lastAvatarRefreshAt < PROFILE_AVATAR_REFRESH_THROTTLE_MS) {
      return null;
    }
    lastAvatarRefreshAt = refreshAt;
    if (publishLoading) publish({ profileAvatarLoading: true, profileAvatarError: "" });
    try {
      let avatarPath = selectProfileAvatarPath(
        options.avatarPath,
        snapshot.profileAvatar.avatarPath,
        snapshot.profilePersonalData?.avatarPath,
      );
      if (!avatarPath && options.allowProfileLookup) {
        const profile = await input.source.readProfile(owner.userId);
        if (!isReadCurrent("avatar", owner)) return null;
        if (options.publishProfileLookup) publish({ profilePersonalData: profile });
        avatarPath = profile.avatarPath;
      }
      if (!avatarPath) {
        if (!isReadCurrent("avatar", owner)) return null;
        const emptyAvatar = createEmptyProfileAvatarState();
        publish({
          profileAvatar: emptyAvatar,
          profileAvatarError: "",
          profileAvatarResetKey: snapshot.profileAvatarResetKey + 1,
        });
        return emptyAvatar;
      }

      const avatar = await input.source.readAvatar(owner.userId);
      if (!isReadCurrent("avatar", owner)) return null;
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
      publish({
        profileAvatarError: "No pudimos actualizar tu foto de perfil. La mostraremos apenas vuelva a estar disponible.",
      });
      return null;
    } finally {
      if (isReadCurrent("avatar", owner)) publish({ profileAvatarLoading: false });
    }
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
      const owner = beginRead("avatar");
      if (!owner) return null;
      return runAvatarRead(owner, options, true);
    },

    foreground() {
      return controller.refreshAvatar({
        force: true,
        allowProfileLookup: true,
        publishProfileLookup: false,
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
