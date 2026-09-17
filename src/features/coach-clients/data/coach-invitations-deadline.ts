import { CoachInvitationsError } from "./coach-invitations-contract";

/** A single total budget for capture + transport, including non-abortable promises. */
export async function withCoachInvitationsDeadline<T>(
  work: (signal: AbortSignal, assertActive: () => void) => Promise<T>,
  timeoutMilliseconds: number,
  callerSignal?: AbortSignal,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 30_000) {
    throw new CoachInvitationsError("invalid_input");
  }
  if (callerSignal?.aborted) throw new CoachInvitationsError("aborted");
  const controller = new AbortController();
  let stopped: CoachInvitationsError | undefined;
  let rejectStop: (error: CoachInvitationsError) => void = () => undefined;
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  const fail = (code: "timeout" | "aborted") => {
    if (stopped) return;
    stopped = new CoachInvitationsError(code);
    // Settle the public deadline before transport abort handlers can reject.
    rejectStop(stopped);
    controller.abort();
  };
  const onAbort = () => fail("aborted");
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => fail("timeout"), timeoutMilliseconds);
  const assertActive = () => {
    if (stopped) throw stopped;
    if (callerSignal?.aborted) throw new CoachInvitationsError("aborted");
  };
  try {
    return await Promise.race([
      Promise.resolve().then(() => { assertActive(); return work(controller.signal, assertActive); }),
      stop,
    ]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onAbort);
  }
}
