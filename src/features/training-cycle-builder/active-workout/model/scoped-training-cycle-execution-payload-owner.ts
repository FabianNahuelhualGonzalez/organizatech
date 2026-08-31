import type { RecordOwnTrainingCycleExecutionPayload } from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";

export interface ScopedTrainingCycleExecutionPayload {
  readonly scopeKey: string;
  readonly payload: RecordOwnTrainingCycleExecutionPayload;
}

/**
 * Owner efímero del payload avanzado previo al write legacy.
 * Cambiar intento o identidad invalida el valor; sólo el scope capturado por esa operación
 * legacy puede consumirlo una vez.
 */
export class ScopedTrainingCycleExecutionPayloadOwner {
  private scopeKey: string | null = null;
  private pending: ScopedTrainingCycleExecutionPayload | null = null;

  replaceScope(scopeKey: string | null) {
    if (scopeKey === this.scopeKey) return;
    this.scopeKey = scopeKey;
    this.pending = null;
  }

  publish(payload: RecordOwnTrainingCycleExecutionPayload) {
    if (!this.scopeKey) return false;
    this.pending = { scopeKey: this.scopeKey, payload };
    return true;
  }

  captureLegacyOperationScope() {
    return this.scopeKey;
  }

  consumeAfterLegacyCompletion(capturedScopeKey: string | null) {
    const pending = this.pending;
    if (
      !capturedScopeKey
      || capturedScopeKey !== this.scopeKey
      || pending?.scopeKey !== capturedScopeKey
    ) return null;
    this.pending = null;
    return pending;
  }

  hasPendingPayload() {
    return this.pending !== null;
  }
}
