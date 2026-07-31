/**
 * Guard compartido (P3-32) para las cargas de historial del ejercicio activo (última performance y
 * última observación). Ambas cargas repetían, después de cada `await`, exactamente la misma tripleta
 * de comprobaciones antes de escribir estado:
 *
 * 1. que el consumidor siga montado;
 * 2. que la request key siga siendo la vigente (lo resuelve el loader y llega como `stale`);
 * 3. que el `SessionDataRequestToken` capturado antes del await siga perteneciendo a la identidad y
 *    epoch actuales.
 *
 * La comprobación 3 es la que protege el caso en que la identidad cambia (A→B, SIGNED_OUT) mientras
 * una request está en vuelo y la request key coincide por accidente entre usuarios: la key sola no
 * distingue identidades, el token sí.
 *
 * Este módulo NO conoce React, repositories, queries ni presentación: sólo decide si un resultado ya
 * resuelto puede comprometerse. No modifica los loaders ni sus contratos.
 */

export type ActiveWorkoutHistoryCommitReason =
  | "commit"
  | "unmounted"
  | "stale_request_key"
  | "stale_session_epoch";

export interface ActiveWorkoutHistoryCommitDecision {
  commit: boolean;
  reason: ActiveWorkoutHistoryCommitReason;
}

export interface ActiveWorkoutHistoryCommitInput {
  stale: boolean;
  isMounted: boolean;
  isRequestTokenCurrent: boolean;
}

/**
 * Precedencia idéntica a la del root antes de P3-32
 * (`if (!isMounted || result.stale || !isSessionDataRequestCurrent(token)) return;`): primero el
 * desmontaje, luego la request key, y por último el epoch de sesión. La razón sólo describe el
 * primer motivo de descarte; el resultado observable (no escribir estado) es el mismo en los tres.
 */
export function resolveActiveWorkoutHistoryCommit(
  input: ActiveWorkoutHistoryCommitInput,
): ActiveWorkoutHistoryCommitDecision {
  if (!input.isMounted) return { commit: false, reason: "unmounted" };
  if (input.stale) return { commit: false, reason: "stale_request_key" };
  if (!input.isRequestTokenCurrent) return { commit: false, reason: "stale_session_epoch" };
  return { commit: true, reason: "commit" };
}

export interface RunActiveWorkoutHistoryLoadInput<TResult extends { stale: boolean }> {
  load: () => Promise<TResult>;
  isMounted: () => boolean;
  isRequestTokenCurrent: () => boolean;
}

export interface RunActiveWorkoutHistoryLoadOutput<TResult extends { stale: boolean }> {
  result: TResult;
  decision: ActiveWorkoutHistoryCommitDecision;
}

/**
 * Ejecuta una carga de historial ya construida y evalúa el guard DESPUÉS del await, que es el único
 * momento en que las tres condiciones pueden haber cambiado. Devuelve el resultado íntegro junto a la
 * decisión, sin mutarlo: quien llama decide qué estado escribir cuando `decision.commit` es `true`.
 *
 * `load` se invoca tal cual: este helper no captura errores, porque los loaders de performance y
 * observación ya traducen sus fallos a un resultado con `error` y nunca rechazan. Mantener aquí un
 * try/catch enmascararía un cambio futuro en ese contrato.
 */
export async function runActiveWorkoutHistoryLoad<TResult extends { stale: boolean }>(
  input: RunActiveWorkoutHistoryLoadInput<TResult>,
): Promise<RunActiveWorkoutHistoryLoadOutput<TResult>> {
  const result = await input.load();
  const decision = resolveActiveWorkoutHistoryCommit({
    stale: result.stale,
    isMounted: input.isMounted(),
    isRequestTokenCurrent: input.isRequestTokenCurrent(),
  });
  return { result, decision };
}
