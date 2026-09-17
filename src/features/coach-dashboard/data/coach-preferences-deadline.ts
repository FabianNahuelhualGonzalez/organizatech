import { CoachPreferencesError } from "./coach-preferences-contract";

export async function withCoachPreferencesDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMilliseconds = 8_000,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new CoachPreferencesError("invalid_input");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new CoachPreferencesError("timeout"));
      controller.abort();
    }, timeoutMilliseconds);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Auth may not support abort: release our caller and ignore any late settlement. */
export function waitForCoachPreferencesAuth<T>(pending: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new CoachPreferencesError("timeout"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new CoachPreferencesError("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(pending).then((value) => {
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) reject(new CoachPreferencesError("timeout"));
      else resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}
