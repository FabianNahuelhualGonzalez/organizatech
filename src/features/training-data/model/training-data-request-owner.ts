import type { SessionDataRequestToken } from "@/lib/session/session-data-epoch";

export type TrainingDataResource =
  | "legacy-snapshot"
  | "active-cycle"
  | "cycle-history"
  | "cycle-snapshot"
  | "profile-prerequisite";

export interface TrainingDataIdentityPort {
  captureRequestToken(): SessionDataRequestToken;
  isRequestTokenCurrent(token: SessionDataRequestToken): boolean;
}

export interface TrainingDataRequestOwner {
  readonly requestToken: SessionDataRequestToken;
  readonly resource: TrainingDataResource;
  readonly requestId: number;
  readonly lifecycle: number;
  readonly cycleId: string | null;
}

export interface TrainingDataRequestOwnerRegistry {
  begin(resource: TrainingDataResource, cycleId?: string | null): TrainingDataRequestOwner;
  isCurrent(owner: TrainingDataRequestOwner): boolean;
  invalidate(resource: TrainingDataResource): void;
  invalidateAll(): void;
  selectCycle(cycleId: string | null): void;
}

export function createTrainingDataRequestOwnerRegistry(
  identity: TrainingDataIdentityPort,
): TrainingDataRequestOwnerRegistry {
  const latestRequestIds: Record<TrainingDataResource, number> = {
    "legacy-snapshot": 0,
    "active-cycle": 0,
    "cycle-history": 0,
    "cycle-snapshot": 0,
    "profile-prerequisite": 0,
  };
  let lifecycle = 0;
  let selectedCycleId: string | null = null;

  function invalidate(resource: TrainingDataResource) {
    latestRequestIds[resource] += 1;
  }

  return {
    begin(resource, cycleId = null) {
      const requestId = ++latestRequestIds[resource];
      return Object.freeze({
        requestToken: identity.captureRequestToken(),
        resource,
        requestId,
        lifecycle,
        cycleId,
      });
    },

    isCurrent(owner) {
      return owner.lifecycle === lifecycle &&
        owner.requestId === latestRequestIds[owner.resource] &&
        identity.isRequestTokenCurrent(owner.requestToken) &&
        (owner.resource !== "cycle-snapshot" || owner.cycleId === selectedCycleId);
    },

    invalidate,

    invalidateAll() {
      lifecycle += 1;
      invalidate("legacy-snapshot");
      invalidate("active-cycle");
      invalidate("cycle-history");
      invalidate("cycle-snapshot");
      invalidate("profile-prerequisite");
      selectedCycleId = null;
    },

    selectCycle(cycleId) {
      if (selectedCycleId === cycleId) return;
      selectedCycleId = cycleId;
      invalidate("cycle-snapshot");
    },
  };
}
