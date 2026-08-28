export interface GoogleOAuthOperationOwner {
  readonly id: symbol;
  readonly revision: number;
  readonly expectedUserId: string | null;
  bindExpectedUserId(userId: string): boolean;
  isCurrent(): boolean;
}

export interface GoogleOAuthOperationOwnerController {
  mount(): void;
  scheduleUnmount(schedule?: (callback: () => void) => void): void;
  begin(): GoogleOAuthOperationOwner;
  acceptPrincipalIdentity(userId: string | null): void;
  invalidate(): void;
  isCurrent(owner: GoogleOAuthOperationOwner): boolean;
}

export function createGoogleOAuthOperationOwnerController(): GoogleOAuthOperationOwnerController {
  let revision = 0;
  let mounted = false;
  let activeOwner: GoogleOAuthOperationOwner | null = null;
  const expectedUserIds = new WeakMap<GoogleOAuthOperationOwner, string | null>();

  function isCurrent(owner: GoogleOAuthOperationOwner) {
    return mounted && activeOwner === owner && owner.revision === revision;
  }

  function invalidate() {
    revision += 1;
    activeOwner = null;
  }

  return {
    mount() {
      mounted = true;
    },

    scheduleUnmount(schedule = queueMicrotask) {
      mounted = false;
      schedule(() => {
        if (!mounted) invalidate();
      });
    },

    begin() {
      revision += 1;
      const ownerRevision = revision;
      const owner: GoogleOAuthOperationOwner = Object.freeze({
        id: Symbol("google-oauth-operation"),
        revision: ownerRevision,
        get expectedUserId() {
          return expectedUserIds.get(owner) ?? null;
        },
        bindExpectedUserId(userId: string) {
          if (!isCurrent(owner) || !userId) return false;
          const expectedUserId = expectedUserIds.get(owner) ?? null;
          if (expectedUserId && expectedUserId !== userId) return false;
          expectedUserIds.set(owner, userId);
          return true;
        },
        isCurrent: () => isCurrent(owner),
      });
      expectedUserIds.set(owner, null);
      activeOwner = owner;
      return owner;
    },

    acceptPrincipalIdentity(userId) {
      if (!activeOwner || !userId) return;
      const expectedUserId = expectedUserIds.get(activeOwner) ?? null;
      if (expectedUserId && expectedUserId !== userId) invalidate();
    },

    invalidate,
    isCurrent,
  };
}

export interface GoogleOAuthSingleFlight {
  run<T>(key: string, operation: () => Promise<T>): Promise<T>;
  clear(): void;
}

export interface GoogleOAuthStartController {
  start<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

export function createGoogleOAuthStartController(): GoogleOAuthStartController {
  const singleFlight = createGoogleOAuthSingleFlight();
  return {
    start(key, operation) {
      return singleFlight.run(key, operation);
    },
  };
}

export async function transferGoogleOAuthAndNavigate(input: {
  transfer(): Promise<void>;
  guard: { isCurrent(): boolean };
  navigate(): void;
}) {
  await input.transfer();
  if (!input.guard.isCurrent()) return false;
  input.navigate();
  return true;
}

export function createGoogleOAuthSingleFlight(): GoogleOAuthSingleFlight {
  let active: { key: string; operation: Promise<unknown> } | null = null;

  return {
    run<T>(key: string, operation: () => Promise<T>) {
      if (active) return active.operation as Promise<T>;
      let resolvePending!: (value: T | PromiseLike<T>) => void;
      let rejectPending!: (reason?: unknown) => void;
      const pending = new Promise<T>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      active = { key, operation: pending };
      void (async () => {
        try {
          resolvePending(await operation());
        } catch (error) {
          rejectPending(error);
        } finally {
          if (active?.operation === pending) active = null;
        }
      })();
      return pending;
    },

    clear() {
      active = null;
    },
  };
}
