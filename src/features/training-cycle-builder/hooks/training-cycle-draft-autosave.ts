import type {
  TrainingCycleSaveDraftInput,
  TrainingCycleSaveDraftResult,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";

export type TrainingCycleDraftAutosaveOutcome =
  | { readonly status: "saved"; readonly savedAtLabel: string }
  | { readonly status: "offline" }
  | { readonly status: "error"; readonly error: unknown }
  | { readonly status: "superseded" };

export type TrainingCycleDraftAutosaveEvent = Exclude<
  TrainingCycleDraftAutosaveOutcome,
  { readonly status: "superseded" }
>;

export interface TrainingCycleDraftAutosaveClaim {
  readonly generation: number;
  readonly scopeKey: string;
  readonly sequence: number;
}

interface TrainingCycleDraftAutosaveJob {
  readonly generation: number;
  readonly input: TrainingCycleSaveDraftInput;
  readonly scopeKey: string;
  readonly sequence: number;
  readonly resolve: (outcome: TrainingCycleDraftAutosaveOutcome) => void;
}

interface ActiveTrainingCycleDraftAutosaveJob {
  readonly job: TrainingCycleDraftAutosaveJob;
  readonly token: number;
}

interface TrainingCycleDraftAutosaveOptions {
  readonly write: (
    input: TrainingCycleSaveDraftInput,
  ) => Promise<TrainingCycleSaveDraftResult>;
  readonly onEvent: (event: TrainingCycleDraftAutosaveEvent) => void;
}

/**
 * Serializa el autosave de un borrador. Mientras existe una escritura física,
 * conserva sólo el snapshot pendiente más reciente y nunca inicia otra en paralelo.
 */
export class TrainingCycleDraftAutosaveOwner {
  private readonly write: TrainingCycleDraftAutosaveOptions["write"];
  private readonly onEvent: TrainingCycleDraftAutosaveOptions["onEvent"];
  private active: ActiveTrainingCycleDraftAutosaveJob | null = null;
  private pending: TrainingCycleDraftAutosaveJob | null = null;
  private generation = 0;
  private sequence = 0;
  private latestSequence = 0;
  private nextToken = 0;
  private paused = true;
  private scopeKey: string | null = null;
  private readonly idleResolvers = new Set<() => void>();

  constructor({ write, onEvent }: TrainingCycleDraftAutosaveOptions) {
    this.write = write;
    this.onEvent = onEvent;
  }

  resume(scopeKey: string) {
    if (!scopeKey) throw new TypeError("Autosave scope key is required");
    if (!this.paused && this.scopeKey === scopeKey) return;
    this.invalidatePending();
    this.generation += 1;
    this.paused = false;
    this.scopeKey = scopeKey;
  }

  pause() {
    if (this.paused && this.scopeKey === null) return;
    this.generation += 1;
    this.paused = true;
    this.scopeKey = null;
    this.invalidatePending();
    this.resolveIdleIfNeeded();
  }

  claim(scopeKey: string): TrainingCycleDraftAutosaveClaim | null {
    if (this.paused || this.scopeKey !== scopeKey) return null;
    this.sequence += 1;
    this.latestSequence = this.sequence;
    return {
      generation: this.generation,
      scopeKey,
      sequence: this.sequence,
    };
  }

  request(
    input: TrainingCycleSaveDraftInput,
    existingClaim?: TrainingCycleDraftAutosaveClaim,
  ): Promise<TrainingCycleDraftAutosaveOutcome> {
    if (this.paused || this.scopeKey !== input.draftId) {
      return Promise.resolve({ status: "superseded" });
    }

    const claim = existingClaim ?? this.claim(input.draftId);
    if (!claim ||
      claim.generation !== this.generation ||
      claim.scopeKey !== this.scopeKey ||
      claim.sequence !== this.latestSequence) {
      return Promise.resolve({ status: "superseded" });
    }
    const promise = new Promise<TrainingCycleDraftAutosaveOutcome>((resolve) => {
      const job: TrainingCycleDraftAutosaveJob = {
        generation: claim.generation,
        input,
        scopeKey: claim.scopeKey,
        sequence: claim.sequence,
        resolve,
      };
      if (this.active) {
        this.replacePending(job);
      } else {
        this.start(job);
      }
    });
    return promise;
  }

  whenIdle(): Promise<void> {
    if (!this.active && !this.pending) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  private replacePending(job: TrainingCycleDraftAutosaveJob) {
    this.pending?.resolve({ status: "superseded" });
    this.pending = job;
  }

  private invalidatePending() {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve({ status: "superseded" });
  }

  private start(job: TrainingCycleDraftAutosaveJob) {
    const token = this.nextToken + 1;
    this.nextToken = token;
    this.active = { job, token };
    void this.run(job, token);
  }

  private isLatestOwnedJob(job: TrainingCycleDraftAutosaveJob) {
    return !this.paused &&
      this.generation === job.generation &&
      this.scopeKey === job.scopeKey &&
      this.latestSequence === job.sequence;
  }

  private async run(job: TrainingCycleDraftAutosaveJob, token: number) {
    let outcome: TrainingCycleDraftAutosaveOutcome;
    try {
      const result = await this.write(job.input);
      if (result.status === "offline") {
        outcome = { status: "offline" };
      } else if (result.status === "saved" && typeof result.savedAtLabel === "string") {
        outcome = { status: "saved", savedAtLabel: result.savedAtLabel };
      } else {
        throw new TypeError("Invalid training cycle autosave result");
      }
    } catch (error) {
      outcome = { status: "error", error };
    }

    try {
      const publish = this.isLatestOwnedJob(job);
      job.resolve(publish ? outcome : { status: "superseded" });
      if (publish) this.onEvent(outcome);
    } finally {
      // Un finally viejo nunca puede liberar una escritura iniciada por otro owner.
      if (this.active?.token !== token) return;
      this.active = null;
      const pending = this.pending;
      this.pending = null;
      if (pending && this.isLatestOwnedJob(pending)) {
        this.start(pending);
        return;
      }
      pending?.resolve({ status: "superseded" });
      this.resolveIdleIfNeeded();
    }
  }

  private resolveIdleIfNeeded() {
    if (this.active || this.pending) return;
    for (const resolve of this.idleResolvers) resolve();
    this.idleResolvers.clear();
  }
}
