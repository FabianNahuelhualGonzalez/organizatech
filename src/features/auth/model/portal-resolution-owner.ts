export interface PortalResolutionOwner {
  readonly id: symbol;
  readonly revision: number;
  readonly expectedUserId: string;
  isCurrent(): boolean;
}

export interface CoachRegistrationOwner {
  readonly id: symbol;
  readonly revision: number;
  readonly expectedUserId: string | null;
  bindExpectedUserId(userId: string): boolean;
  isCurrent(): boolean;
}

export interface CoachRegistrationOwnerController {
  acceptIdentity(userId: string): boolean;
  begin(options?: { independentIdentity?: boolean }): CoachRegistrationOwner;
  end(owner: CoachRegistrationOwner): void;
  invalidate(): void;
  isCurrent(owner: CoachRegistrationOwner): boolean;
  hasPending(): boolean;
}

export interface UserRegistrationOwner {
  readonly id: symbol;
  readonly revision: number;
  readonly expectedUserId: string | null;
  bindExpectedUserId(userId: string): boolean;
  isCurrent(): boolean;
}

export interface UserRegistrationOwnerController {
  acceptIdentity(userId: string): boolean;
  begin(): UserRegistrationOwner;
  end(owner: UserRegistrationOwner): void;
  invalidate(): void;
  isCurrent(owner: UserRegistrationOwner): boolean;
  hasPending(): boolean;
}

export interface SinglePublicationNoticeController<TReason> {
  begin(reason: TReason): void;
  fail(): void;
  consumeEvent(): TReason | null;
  settle(): TReason | null;
  hasNotice(): boolean;
  clear(): void;
}

export interface PortalResolutionOwnerController {
  acceptIdentity(userId: string): boolean;
  begin(expectedUserId: string): PortalResolutionOwner;
  end(owner: PortalResolutionOwner): void;
  invalidate(): void;
  isCurrent(owner: PortalResolutionOwner): boolean;
  hasPending(): boolean;
}

export function createPortalResolutionOwnerController(): PortalResolutionOwnerController {
  let revision = 0;
  let currentUserId: string | null = null;
  const pending = new Set<PortalResolutionOwner>();

  function isCurrent(owner: PortalResolutionOwner) {
    return owner.revision === revision
      && owner.expectedUserId === currentUserId
      && pending.has(owner);
  }

  function invalidateForIdentity(userId: string | null) {
    revision += 1;
    currentUserId = userId;
    pending.clear();
  }

  return {
    acceptIdentity(userId) {
      if (userId === currentUserId) return false;
      const replacedIdentity = currentUserId !== null;
      invalidateForIdentity(userId);
      return replacedIdentity;
    },

    begin(expectedUserId) {
      const owner: PortalResolutionOwner = Object.freeze({
        id: Symbol("portal-resolution"),
        revision,
        expectedUserId,
        isCurrent: () => isCurrent(owner),
      });
      if (expectedUserId === currentUserId) pending.add(owner);
      return owner;
    },

    end(owner) {
      pending.delete(owner);
    },

    invalidate() {
      invalidateForIdentity(null);
    },

    isCurrent,

    hasPending() {
      return pending.size > 0;
    },
  };
}

export function createCoachRegistrationOwnerController(): CoachRegistrationOwnerController {
  let revision = 0;
  let currentUserId: string | null = null;
  let activeOwner: CoachRegistrationOwner | null = null;
  const expectedUserIds = new WeakMap<CoachRegistrationOwner, string | null>();
  const independentIdentityOwners = new WeakSet<CoachRegistrationOwner>();

  function isCurrent(owner: CoachRegistrationOwner) {
    const expectedUserId = expectedUserIds.get(owner) ?? null;
    return owner.revision === revision
      && activeOwner === owner
      && (
        independentIdentityOwners.has(owner)
        || currentUserId === null
        || expectedUserId === null
        || expectedUserId === currentUserId
      );
  }

  function invalidateForIdentity(userId: string | null) {
    revision += 1;
    currentUserId = userId;
    activeOwner = null;
  }

  return {
    acceptIdentity(userId) {
      if (userId === currentUserId) return false;
      const replacedIdentity = currentUserId !== null;
      const expectedUserId = activeOwner ? expectedUserIds.get(activeOwner) ?? null : null;
      if (activeOwner && expectedUserId === userId) {
        currentUserId = userId;
        return replacedIdentity;
      }
      invalidateForIdentity(userId);
      return replacedIdentity;
    },

    begin(options = {}) {
      revision += 1;
      const ownerRevision = revision;
      const owner: CoachRegistrationOwner = Object.freeze({
        id: Symbol("coach-registration"),
        revision: ownerRevision,
        get expectedUserId() {
          return expectedUserIds.get(owner) ?? null;
        },
        bindExpectedUserId(userId: string) {
          if (!isCurrent(owner)) return false;
          const expectedUserId = expectedUserIds.get(owner) ?? null;
          if (expectedUserId !== null && expectedUserId !== userId) return false;
          if (
            !independentIdentityOwners.has(owner)
            && currentUserId !== null
            && currentUserId !== userId
          ) return false;
          expectedUserIds.set(owner, userId);
          return true;
        },
        isCurrent: () => isCurrent(owner),
      });
      if (options.independentIdentity) independentIdentityOwners.add(owner);
      expectedUserIds.set(owner, options.independentIdentity ? null : currentUserId);
      activeOwner = owner;
      return owner;
    },

    end(owner) {
      if (activeOwner === owner) activeOwner = null;
    },

    invalidate() {
      invalidateForIdentity(null);
    },

    isCurrent,

    hasPending() {
      return activeOwner !== null;
    },
  };
}

export function createUserRegistrationOwnerController(): UserRegistrationOwnerController {
  let revision = 0;
  let currentUserId: string | null = null;
  let activeOwner: UserRegistrationOwner | null = null;
  const expectedUserIds = new WeakMap<UserRegistrationOwner, string | null>();

  function isCurrent(owner: UserRegistrationOwner) {
    const expectedUserId = expectedUserIds.get(owner) ?? null;
    return owner.revision === revision
      && activeOwner === owner
      && (currentUserId === null || expectedUserId === null || expectedUserId === currentUserId);
  }

  function invalidateForIdentity(userId: string | null) {
    revision += 1;
    currentUserId = userId;
    activeOwner = null;
  }

  return {
    acceptIdentity(userId) {
      if (userId === currentUserId) return false;
      const replacedIdentity = currentUserId !== null;
      const expectedUserId = activeOwner ? expectedUserIds.get(activeOwner) ?? null : null;
      if (activeOwner && expectedUserId === userId) {
        currentUserId = userId;
        return replacedIdentity;
      }
      invalidateForIdentity(userId);
      return replacedIdentity;
    },

    begin() {
      revision += 1;
      const ownerRevision = revision;
      const owner: UserRegistrationOwner = Object.freeze({
        id: Symbol("user-registration"),
        revision: ownerRevision,
        get expectedUserId() {
          return expectedUserIds.get(owner) ?? null;
        },
        bindExpectedUserId(userId: string) {
          if (!isCurrent(owner)) return false;
          const expectedUserId = expectedUserIds.get(owner) ?? null;
          if (expectedUserId !== null && expectedUserId !== userId) return false;
          if (currentUserId !== null && currentUserId !== userId) return false;
          expectedUserIds.set(owner, userId);
          return true;
        },
        isCurrent: () => isCurrent(owner),
      });
      expectedUserIds.set(owner, currentUserId);
      activeOwner = owner;
      return owner;
    },

    end(owner) {
      if (activeOwner === owner) activeOwner = null;
    },

    invalidate() {
      invalidateForIdentity(null);
    },

    isCurrent,

    hasPending() {
      return activeOwner !== null;
    },
  };
}

export function createSinglePublicationNoticeController<TReason>(): SinglePublicationNoticeController<TReason> {
  let notice: {
    reason: TReason;
    eventSeen: boolean;
    settled: boolean;
    failed: boolean;
    published: boolean;
  } | null = null;

  function publishCurrent() {
    if (!notice || notice.published) return null;
    notice.published = true;
    return notice.reason;
  }

  function clearIfComplete() {
    if (notice && notice.settled && (notice.eventSeen || notice.failed)) notice = null;
  }

  return {
    begin(reason) {
      notice = {
        reason,
        eventSeen: false,
        settled: false,
        failed: false,
        published: false,
      };
    },

    fail() {
      if (notice) notice.failed = true;
    },

    consumeEvent() {
      if (!notice) return null;
      notice.eventSeen = true;
      const reason = publishCurrent();
      clearIfComplete();
      return reason;
    },

    settle() {
      if (!notice) return null;
      notice.settled = true;
      const reason = notice.failed ? publishCurrent() : null;
      clearIfComplete();
      return reason;
    },

    hasNotice() {
      return notice !== null;
    },

    clear() {
      notice = null;
    },
  };
}
