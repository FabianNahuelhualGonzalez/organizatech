import type {
  TrainingCycleActivationResult,
  TrainingCycleBuilderGateway,
  TrainingCycleCatalogExerciseViewModel,
  TrainingCycleGenerateSuggestedDraftInput,
  TrainingCycleSaveActiveInput,
  TrainingCycleSaveActiveResult,
  TrainingCycleSaveDraftInput,
  TrainingCycleDraftViewModel,
} from "../components/training-cycle-builder-contracts";
import {
  mapBuilderDaysToRpcPlan,
  rpcMuscleToUi,
  uiMuscleToRpc,
} from "../data/training-cycle-rpc-mappers";
import {
  TrainingCycleCommittedMutationError,
  TrainingCycleTransportError,
  type TrainingCycleAcceptedOperation,
  type TrainingCycleCatalogItem,
  type TrainingCycleDraftSnapshot,
  type TrainingCycleRpcSnapshot,
} from "../data/training-cycle-rpc-types";
import type { TrainingCycleRpcGateway } from "../data/supabase-training-cycle-rpc-gateway";
import { generateProductTrainingCycleSuggestion } from "./training-cycle-product-suggestion";
import { projectTrainingCycleRpcPlan } from "./training-cycle-product-view-model";

type ProductRpc = Pick<TrainingCycleRpcGateway,
  | "createCustomExercise"
  | "createDraft"
  | "saveDraft"
  | "discardDraft"
  | "duplicateCycle"
  | "getActiveCycleGuard"
  | "replaceActiveCycleToDraft"
  | "activateDraft"
  | "editActiveCycle"
  | "extendActiveCycle"
  | "getCycle"
>;

export interface CreateTrainingCycleProductGatewayInput {
  readonly rpc: ProductRpc;
  readonly catalog: readonly TrainingCycleCatalogItem[];
  readonly remoteDraft: TrainingCycleDraftSnapshot | null;
  readonly remoteDraftReference?: { readonly draftId: string; readonly version: number } | null;
  readonly sourceCycleId: string | null;
  readonly activeCycle: TrainingCycleRpcSnapshot | null;
  readonly entries?: readonly import("@/lib/progress/types").ExerciseEntry[];
  readonly todayIsoDate?: string;
  readonly onDraftPersisted?: (draftId: string, version: number) => void;
  readonly onDraftDiscarded?: () => void;
  readonly onCycleChanged?: (cycle: TrainingCycleRpcSnapshot) => boolean | void | Promise<boolean | void>;
  readonly onCycleReplaced?: (
    cycleId: string,
    draft: TrainingCycleDraftSnapshot,
  ) => boolean | void | Promise<boolean | void>;
}

function asVersion(value: string) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TrainingCycleTransportError("invalid_input", "La revisión no es válida.");
  }
  return version;
}

function savedAtLabel() {
  return new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

async function afterCommitted<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    const result = await operation();
    if (result === false) throw new TrainingCycleCommittedMutationError();
    return result;
  } catch (error) {
    if (error instanceof TrainingCycleCommittedMutationError) throw error;
    throw new TrainingCycleCommittedMutationError();
  }
}

function requiredVersion(result: Pick<TrainingCycleAcceptedOperation, "resultVersion">) {
  if (result.resultVersion === null) {
    throw new TrainingCycleTransportError("invalid_response", "El servidor devolvió una respuesta inválida.");
  }
  return result.resultVersion;
}

class ProductMutationQueue {
  private tail: Promise<void> = Promise.resolve();
  private synchronizationRequired = false;

  run<T>(operation: () => Promise<T>): Promise<T> {
    const runIfSynchronized = async () => {
      if (this.synchronizationRequired) throw new TrainingCycleCommittedMutationError();
      try {
        return await operation();
      } catch (error) {
        if (error instanceof TrainingCycleCommittedMutationError) this.synchronizationRequired = true;
        throw error;
      }
    };
    const result = this.tail.then(runIfSynchronized, runIfSynchronized);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

/**
 * Adapta el contrato visual cerrado al RPC productivo. Conserva los IDs y la
 * revisión remotos fuera del formulario para que un borrador local nunca pueda
 * inventar ownership, aggregate IDs o versiones.
 */
export class TrainingCycleProductGateway implements TrainingCycleBuilderGateway {
  private remoteDraftId: string | null;
  private remoteDraftVersion: number | null;
  private activeCycleId: string | null;
  private activeCycleVersion: number | null;
  private newDraftSourceCycleId: string | null;
  private readonly queue = new ProductMutationQueue();

  constructor(private readonly input: CreateTrainingCycleProductGatewayInput) {
    this.remoteDraftId = input.remoteDraftReference?.draftId ?? input.remoteDraft?.draftId ?? null;
    this.remoteDraftVersion = input.remoteDraftReference?.version ?? input.remoteDraft?.version ?? null;
    this.activeCycleId = input.activeCycle?.cycleId ?? null;
    this.activeCycleVersion = input.activeCycle?.version ?? null;
    this.newDraftSourceCycleId = input.sourceCycleId;
  }

  private adoptDraft(result: Pick<TrainingCycleAcceptedOperation, "aggregateId" | "resultVersion">) {
    const version = requiredVersion(result);
    this.remoteDraftId = result.aggregateId;
    this.remoteDraftVersion = version;
    this.input.onDraftPersisted?.(result.aggregateId, version);
    return { draftId: result.aggregateId, version };
  }

  private async persistNewDraft(input: TrainingCycleSaveDraftInput) {
    const plan = mapBuilderDaysToRpcPlan(input.days);
    if (input.origin === "duplicate") {
      if (!this.newDraftSourceCycleId) {
        throw new TrainingCycleTransportError("invalid_state", "No encontramos el ciclo que quieres duplicar.");
      }
      const duplicated = this.adoptDraft(await this.input.rpc.duplicateCycle({
        sourceCycleId: this.newDraftSourceCycleId,
        startDate: input.startDate,
        endDate: input.endDate,
      }));
      return this.adoptDraft(await this.input.rpc.saveDraft({
        draftId: duplicated.draftId,
        expectedVersion: duplicated.version,
        goal: input.goal,
        startDate: input.startDate,
        endDate: input.endDate,
        plan,
      }));
    }
    if (input.origin === "resume") {
      throw new TrainingCycleTransportError("invalid_state", "El borrador guardado ya no está disponible.");
    }
    return this.adoptDraft(await this.input.rpc.createDraft({
      origin: input.origin,
      goal: input.goal,
      startDate: input.startDate,
      endDate: input.endDate,
      plan,
    }));
  }

  saveDraft(input: TrainingCycleSaveDraftInput) {
    return this.queue.run(async () => {
      if (!this.remoteDraftId || this.remoteDraftVersion === null) {
        await this.persistNewDraft(input);
      } else {
        this.adoptDraft(await this.input.rpc.saveDraft({
          draftId: this.remoteDraftId,
          expectedVersion: this.remoteDraftVersion,
          goal: input.goal,
          startDate: input.startDate,
          endDate: input.endDate,
          plan: mapBuilderDaysToRpcPlan(input.days),
        }));
      }
      return { status: "saved" as const, savedAtLabel: savedAtLabel() };
    });
  }

  async generateSuggestedDraft(input: TrainingCycleGenerateSuggestedDraftInput) {
    return { draft: generateProductTrainingCycleSuggestion(input, this.input.catalog) };
  }

  async createCustomExercise(input: {
    readonly name: string;
    readonly muscleGroup: Parameters<TrainingCycleBuilderGateway["createCustomExercise"]>[0]["muscleGroup"];
    readonly videoUrl: string | null;
  }): Promise<TrainingCycleCatalogExerciseViewModel> {
    const source = await this.input.rpc.createCustomExercise({
      name: input.name,
      muscleGroup: uiMuscleToRpc(input.muscleGroup),
      videoUrl: input.videoUrl,
    });
    return {
      id: source.id,
      source,
      name: input.name.trim(),
      muscleGroup: rpcMuscleToUi(uiMuscleToRpc(input.muscleGroup)),
      sources: ["all"],
    };
  }

  async getActiveCycleGuard() {
    const guard = await this.input.rpc.getActiveCycleGuard();
    return guard ? { cycleId: guard.cycleId } : null;
  }

  completeActiveCycle(input: {
    readonly expectedActiveCycleId: string;
    readonly startDate: string;
    readonly endDate: string;
  }): Promise<TrainingCycleDraftViewModel> {
    return this.queue.run(async () => {
      const result = await this.input.rpc.replaceActiveCycleToDraft({
        expectedActiveCycleId: input.expectedActiveCycleId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      return afterCommitted(async () => {
        const draft = result.draft;
        if (result.aggregateId !== draft.draftId
          || result.resultVersion !== draft.version
          || draft.sourceCycleId !== input.expectedActiveCycleId
          || draft.origin !== "duplicate"
          || draft.state !== "draft"
          || draft.activatedCycleId !== null) {
          throw new TrainingCycleTransportError("invalid_response", "El servidor devolvió una respuesta inválida.");
        }
        const projectedDraft = projectTrainingCycleRpcPlan({
          draftId: draft.draftId,
          goal: draft.goal,
          startDate: draft.startDate,
          endDate: draft.endDate,
          plan: draft.plan,
          catalogBySource: new Map([...this.input.catalog, ...result.exerciseSources].map((item) => [
            `${item.source.kind}:${item.source.id}`,
            item,
          ])),
          sourceCycle: this.input.activeCycle,
          entries: this.input.entries ?? [],
          todayIsoDate: this.input.todayIsoDate ?? draft.startDate,
        });
        this.activeCycleId = null;
        this.activeCycleVersion = null;
        this.newDraftSourceCycleId = input.expectedActiveCycleId;
        this.adoptDraft(result);
        await afterCommitted(() => this.input.onCycleReplaced?.(input.expectedActiveCycleId, draft));
        return projectedDraft;
      });
    });
  }

  activateCycle(): Promise<TrainingCycleActivationResult> {
    return this.queue.run(async () => {
      if (!this.remoteDraftId || this.remoteDraftVersion === null) {
        throw new TrainingCycleTransportError("invalid_state", "Guarda el borrador antes de activarlo.");
      }
      const result = await this.input.rpc.activateDraft(this.remoteDraftId, this.remoteDraftVersion);
      return afterCommitted(async () => {
        const version = requiredVersion(result);
        this.activeCycleId = result.aggregateId;
        this.activeCycleVersion = version;
        const cycle = await this.input.rpc.getCycle(result.aggregateId);
        await afterCommitted(() => this.input.onCycleChanged?.(cycle));
        return { cycleId: result.aggregateId, revision: String(version), status: "activated" as const };
      });
    });
  }

  saveActiveCycle(input: TrainingCycleSaveActiveInput): Promise<TrainingCycleSaveActiveResult> {
    return this.queue.run(async () => {
      try {
        const result = await this.input.rpc.editActiveCycle({
          cycleId: input.cycleId,
          expectedVersion: asVersion(input.expectedRevision),
          goal: input.goal,
          plan: mapBuilderDaysToRpcPlan(input.days),
        });
        return await afterCommitted(async () => {
          const version = requiredVersion(result);
          this.activeCycleId = result.aggregateId;
          this.activeCycleVersion = version;
          const cycle = await this.input.rpc.getCycle(result.aggregateId);
          await afterCommitted(() => this.input.onCycleChanged?.(cycle));
          return { status: "saved" as const, revision: String(version), savedAtLabel: savedAtLabel() };
        });
      } catch (error) {
        if (error instanceof TrainingCycleTransportError && error.code === "conflict") {
          return { status: "conflict" };
        }
        throw error;
      }
    });
  }

  extendCycle(input: Parameters<TrainingCycleBuilderGateway["extendCycle"]>[0]) {
    return this.queue.run(async () => {
      const result = await this.input.rpc.extendActiveCycle({
        cycleId: input.cycleId,
        expectedVersion: asVersion(input.expectedRevision),
        newEndDate: input.newEndDate,
      });
      return afterCommitted(async () => {
        this.activeCycleId = result.aggregateId;
        this.activeCycleVersion = requiredVersion(result);
        const cycle = await this.input.rpc.getCycle(result.aggregateId);
        await afterCommitted(() => this.input.onCycleChanged?.(cycle));
        return { endDate: cycle.endDate, revision: String(this.activeCycleVersion) };
      });
    });
  }

  discardDraft(): Promise<void> {
    return this.queue.run(async () => {
      if (this.remoteDraftId && this.remoteDraftVersion !== null) {
        await this.input.rpc.discardDraft(this.remoteDraftId, this.remoteDraftVersion);
      }
      this.remoteDraftId = null;
      this.remoteDraftVersion = null;
      this.input.onDraftDiscarded?.();
    });
  }

  getActiveReference() {
    return this.activeCycleId && this.activeCycleVersion !== null
      ? { cycleId: this.activeCycleId, version: this.activeCycleVersion }
      : null;
  }
}

export function createTrainingCycleProductGateway(input: CreateTrainingCycleProductGatewayInput) {
  return new TrainingCycleProductGateway(input);
}
