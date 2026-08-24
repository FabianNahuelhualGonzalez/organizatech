export interface PasswordRecoveryPortalMountPermit {
  isCurrent(): boolean;
}

export interface PasswordRecoveryLocalSignOutResult {
  error: unknown | null;
}

export interface PasswordRecoveryPortalGuard {
  begin(): boolean;
  release(): boolean;
  isBlocked(): boolean;
  capturePortalMountPermit(): PasswordRecoveryPortalMountPermit;
  runLocalSignOut(
    signOut: () => Promise<PasswordRecoveryLocalSignOutResult>,
  ): Promise<PasswordRecoveryLocalSignOutResult>;
}

/**
 * Security boundary for the temporary Supabase PASSWORD_RECOVERY session.
 *
 * The revision makes every portal publication captured before recovery permanently stale,
 * including after the guard is released for the next manual login. The cached sign-out promise
 * makes every terminal path single-flight for the lifetime of one recovery attempt.
 */
export function createPasswordRecoveryPortalGuard(
  initiallyBlocked = false,
): PasswordRecoveryPortalGuard {
  let blocked = initiallyBlocked;
  let revision = initiallyBlocked ? 1 : 0;
  let localSignOutOperation: Promise<PasswordRecoveryLocalSignOutResult> | null = null;

  return {
    begin() {
      if (blocked) return false;
      blocked = true;
      revision += 1;
      localSignOutOperation = null;
      return true;
    },

    release() {
      if (!blocked) return false;
      blocked = false;
      revision += 1;
      return true;
    },

    isBlocked() {
      return blocked;
    },

    capturePortalMountPermit() {
      const capturedRevision = revision;
      return Object.freeze({
        isCurrent: () => !blocked && revision === capturedRevision,
      });
    },

    runLocalSignOut(signOut) {
      localSignOutOperation ??= Promise.resolve().then(signOut);
      return localSignOutOperation;
    },
  };
}
