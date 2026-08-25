export interface UserPortalLogoutSingleFlight {
  run(input: {
    readonly disabled: boolean;
    readonly onClose: () => void;
    readonly onLogout: () => void | Promise<void>;
  }): Promise<boolean>;
}

export function createUserPortalLogoutSingleFlight(): UserPortalLogoutSingleFlight {
  let inFlight = false;

  return {
    async run({ disabled, onClose, onLogout }) {
      if (disabled || inFlight) return false;
      inFlight = true;
      try {
        onClose();
        await onLogout();
        return true;
      } finally {
        inFlight = false;
      }
    },
  };
}
