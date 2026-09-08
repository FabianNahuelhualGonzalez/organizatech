import { TrainingCycleTransportError } from "./training-cycle-rpc-types";

export const TRAINING_CYCLE_AUTH_DEADLINE_MS = 8_000;
export const TRAINING_CYCLE_RPC_DEADLINE_MS = 15_000;

/** Sólo acota la espera; un timeout no prueba rollback. El retry conserva su request ID. */
export async function waitForTrainingCycleTransport<T>(
  request: PromiseLike<T>,
  milliseconds = TRAINING_CYCLE_AUTH_DEADLINE_MS,
  abort?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TrainingCycleTransportError("service_unavailable", "No pudimos confirmar la respuesta del servidor."));
      abort?.();
    }, milliseconds);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
