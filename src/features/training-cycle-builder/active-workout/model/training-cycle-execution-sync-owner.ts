import type { RecordOwnTrainingCycleExecutionPayload } from "@/features/training-cycle-builder/active-workout/model/active-workout-execution";

export type TrainingCycleExecutionSyncState =
  | { readonly status: "idle" }
  | { readonly status: "syncing" }
  | { readonly status: "synced" }
  | { readonly status: "error" };

export type TrainingCycleExecutionSyncWriter = (
  payload: RecordOwnTrainingCycleExecutionPayload,
) => Promise<unknown>;

export class TrainingCycleExecutionSyncOwner {
  private scopeKey: string | null = null;
  private generation = 0;
  private requestSequence = 0;
  private payload: RecordOwnTrainingCycleExecutionPayload | null = null;
  private pending: Promise<boolean> | null = null;
  private state: TrainingCycleExecutionSyncState = { status: "idle" };

  constructor(
    private readonly write: TrainingCycleExecutionSyncWriter,
    private readonly publish: (state: TrainingCycleExecutionSyncState) => void,
  ) {}

  getState() {
    return this.state;
  }

  replaceScope(scopeKey: string | null) {
    if (scopeKey === this.scopeKey) return;
    this.generation += 1;
    this.scopeKey = scopeKey;
    this.payload = null;
    this.pending = null;
    this.setState({ status: "idle" });
  }

  /** Se invoca sólo después del PASS del write legacy. Nunca recibe ni ejecuta ese write. */
  syncAfterLegacyCompletion(payload: RecordOwnTrainingCycleExecutionPayload) {
    if (!this.scopeKey) return Promise.resolve(false);
    if (this.pending) return this.pending;
    this.payload = payload;
    return this.start(payload);
  }

  retry() {
    if (this.state.status !== "error" || !this.payload || !this.scopeKey) {
      return Promise.resolve(false);
    }
    if (this.pending) return this.pending;
    return this.start(this.payload);
  }

  private start(payload: RecordOwnTrainingCycleExecutionPayload) {
    const generation = this.generation;
    const sequence = this.requestSequence + 1;
    this.requestSequence = sequence;
    this.setState({ status: "syncing" });
    const operation = this.run(payload, generation, sequence);
    this.pending = operation;
    return operation;
  }

  private async run(
    payload: RecordOwnTrainingCycleExecutionPayload,
    generation: number,
    sequence: number,
  ) {
    let success = false;
    try {
      await this.write(payload);
      success = true;
    } catch {
      success = false;
    }
    if (generation !== this.generation || sequence !== this.requestSequence) return false;
    this.pending = null;
    this.setState(success ? { status: "synced" } : { status: "error" });
    return success;
  }

  private setState(state: TrainingCycleExecutionSyncState) {
    this.state = state;
    this.publish(state);
  }
}
