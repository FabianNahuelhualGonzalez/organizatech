export class ProgressCheckSaveCancelled extends Error {
  constructor() { super("progress_check_save_cancelled"); }
}

export function createProgressCheckSaveGuard() {
  let cancelled = false;
  let confirmationOpen = false;
  const confirmationWakeups = new Set<() => void>();
  const cancellationWakeups = new Set<() => void>();
  const wake = (callbacks: Set<() => void>) => {
    for (const resolve of callbacks) resolve();
    callbacks.clear();
  };
  const checkpoint = () => { if (cancelled) throw new ProgressCheckSaveCancelled(); };

  return {
    get cancelled() { return cancelled; },
    checkpoint,
    pauseForConfirmation() { if (!cancelled) confirmationOpen = true; },
    continueEditing() { confirmationOpen = false; wake(confirmationWakeups); },
    cancel() { cancelled = true; confirmationOpen = false;
      wake(confirmationWakeups); wake(cancellationWakeups); },
    async beforeCreateCheck() {
      checkpoint();
      while (confirmationOpen && !cancelled) {
        await new Promise<void>((resolve) => confirmationWakeups.add(resolve));
      }
      checkpoint();
    },
    async wait(ms: number) {
      checkpoint();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { cancellationWakeups.delete(cancelWait); resolve(); }, ms);
        const cancelWait = () => { clearTimeout(timer); resolve(); };
        cancellationWakeups.add(cancelWait);
      });
      checkpoint();
    },
  };
}

export type ProgressCheckSaveGuard = ReturnType<typeof createProgressCheckSaveGuard>;
