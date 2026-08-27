export interface CreateReminderOperationOwner {
  readonly run: (operation: () => Promise<boolean>) => Promise<boolean>;
}

export function createReminderOperationOwner(): CreateReminderOperationOwner {
  let inFlight: Promise<boolean> | null = null;

  return {
    run(operation) {
      if (inFlight) return inFlight;
      const current = operation().finally(() => {
        if (inFlight === current) inFlight = null;
      });
      inFlight = current;
      return current;
    },
  };
}
