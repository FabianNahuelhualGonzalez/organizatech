"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExerciseEntry } from "@/lib/progress/types";

import type {
  TrainingCycleBuilderGateway,
  TrainingCycleBuilderInitialViewModel,
} from "../components/training-cycle-builder-contracts";
import {
  createTrainingCycleRpcGateway,
  TrainingCycleTransportError,
  type TrainingCycleCatalogCursor,
  type TrainingCycleCatalogItem,
  type TrainingCycleDraftSnapshot,
  type TrainingCycleRpcSnapshot,
} from "../data";
import { createTrainingCycleProductGateway } from "../integration/training-cycle-product-gateway";
import {
  createTrainingCycleProductLifecycleController,
  type TrainingCycleProductLifecycleCallbacks,
  type TrainingCycleProductLifecycleController,
} from "../integration/training-cycle-product-lifecycle";
import {
  buildTrainingCycleProductViewModel,
  findTrainingCycleSourceCycleId,
} from "../integration/training-cycle-product-view-model";

const CATALOG_PAGE_LIMIT = 100;
const MAX_CATALOG_PAGES = 3;

type ProductRpc = ReturnType<typeof createTrainingCycleRpcGateway>;
type ProductLifecycleCallbackRefs = Pick<
  TrainingCycleProductLifecycleCallbacks,
  "onCycleChanged" | "onStartTraining"
>;

export interface TrainingCycleProductData {
  readonly catalog: readonly TrainingCycleCatalogItem[];
  readonly draft: TrainingCycleDraftSnapshot | null;
  readonly activeCycle: TrainingCycleRpcSnapshot | null;
  readonly sourceCycle: TrainingCycleRpcSnapshot | null;
  readonly lastCycle: TrainingCycleRpcSnapshot | null;
  readonly draftReference: { readonly draftId: string; readonly version: number } | null;
}

export type TrainingCycleProductControllerState =
  | { readonly status: "disabled" }
  | { readonly status: "loading" }
  | { readonly status: "unsupported" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly viewModel: TrainingCycleBuilderInitialViewModel;
      readonly gateway: TrainingCycleBuilderGateway;
      readonly activeCycle: TrainingCycleRpcSnapshot | null;
      readonly recordExecution: ProductRpc["recordExecution"];
      readonly onCycleChanged: TrainingCycleProductLifecycleController["onCycleChanged"];
      readonly onStartTraining: TrainingCycleProductLifecycleController["onStartTraining"];
    };
export type TrainingCycleProductController = TrainingCycleProductControllerState & {
  readonly reload: () => void;
};

export type TrainingCycleProductSnapshot =
  | {
      readonly ownerContextKey: string | null;
      readonly status: "disabled" | "loading" | "unsupported";
    }
  | {
      readonly ownerContextKey: string;
      readonly status: "error";
      readonly message: string;
    }
  | {
      readonly ownerContextKey: string;
      readonly status: "ready";
      readonly rpc: ProductRpc;
      readonly data: TrainingCycleProductData;
    };

function productContextKey(enabled: boolean, expectedUserId: string | null) {
  return enabled && expectedUserId ? `usuario:${expectedUserId}` : null;
}

/**
 * Selecciona el snapshot únicamente para su identidad efectiva. React puede
 * renderizar la identidad nueva antes de ejecutar el cleanup/effect anterior;
 * durante ese intervalo el contenido del owner previo debe quedar invisible.
 */
export function selectOwnedTrainingCycleProductSnapshot(
  snapshot: TrainingCycleProductSnapshot,
  requestedContextKey: string | null,
): TrainingCycleProductSnapshot {
  if (requestedContextKey === null) {
    return { ownerContextKey: null, status: "disabled" };
  }
  if (snapshot.ownerContextKey !== requestedContextKey) {
    return { ownerContextKey: requestedContextKey, status: "loading" };
  }
  return snapshot;
}

export async function loadTrainingCycleProductData(rpc: ProductRpc): Promise<TrainingCycleProductData> {
  await rpc.refreshLifecycle();
  const catalog: TrainingCycleCatalogItem[] = [];
  let cursor: TrainingCycleCatalogCursor | null = null;
  for (let pageIndex = 0; pageIndex < MAX_CATALOG_PAGES; pageIndex += 1) {
    const page = await rpc.listCatalog({ limit: CATALOG_PAGE_LIMIT, cursor });
    catalog.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  if (cursor) {
    throw new TrainingCycleTransportError("invalid_response", "El catálogo excede el límite seguro.");
  }

  const [draft, activeCycle, cyclePage] = await Promise.all([
    rpc.getDraft(),
    rpc.getActiveCycle(),
    rpc.listCycles({ limit: 5 }),
  ]);
  const lastCycleId = cyclePage.items.find((cycle) => cycle.cycleId !== activeCycle?.cycleId)?.cycleId ?? null;
  const sourceCycleId = draft?.sourceCycleId ?? null;
  const ids = [...new Set([sourceCycleId, lastCycleId].filter((id): id is string => Boolean(id)))];
  const loadedCycles = new Map<string, TrainingCycleRpcSnapshot>();
  await Promise.all(ids.map(async (cycleId) => {
    loadedCycles.set(cycleId, await rpc.getCycle(cycleId));
  }));
  return {
    catalog,
    draft,
    activeCycle,
    sourceCycle: sourceCycleId ? loadedCycles.get(sourceCycleId) ?? null : null,
    lastCycle: lastCycleId ? loadedCycles.get(lastCycleId) ?? null : null,
    draftReference: draft ? { draftId: draft.draftId, version: draft.version } : null,
  };
}

export function clearDiscardedTrainingCycleProductData(
  data: TrainingCycleProductData,
): TrainingCycleProductData {
  return {
    ...data,
    draft: null,
    draftReference: null,
    sourceCycle: null,
  };
}

function todayInSantiago() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function useTrainingCycleProductController(input: {
  readonly enabled: boolean;
  readonly expectedUserId: string | null;
  readonly entries: readonly ExerciseEntry[];
  readonly onCycleChanged?: TrainingCycleProductLifecycleCallbacks["onCycleChanged"];
  readonly onStartTraining?: TrainingCycleProductLifecycleCallbacks["onStartTraining"];
}): TrainingCycleProductController {
  const generation = useRef(0);
  const requestedContextKey = productContextKey(input.enabled, input.expectedUserId);
  const requestedContextKeyRef = useRef<string | null>(requestedContextKey);
  requestedContextKeyRef.current = requestedContextKey;
  const callbacksRef = useRef<ProductLifecycleCallbackRefs>({});
  callbacksRef.current = {
    onCycleChanged: input.onCycleChanged,
    onStartTraining: input.onStartTraining,
  };
  const [reloadVersion, setReloadVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<TrainingCycleProductSnapshot>(
    requestedContextKey
      ? { ownerContextKey: requestedContextKey, status: "loading" }
      : { ownerContextKey: null, status: "disabled" },
  );
  const visibleSnapshot = selectOwnedTrainingCycleProductSnapshot(snapshot, requestedContextKey);

  const reload = useCallback(() => setReloadVersion((value) => value + 1), []);

  useEffect(() => {
    const current = ++generation.current;
    if (!input.enabled || !input.expectedUserId || !requestedContextKey) {
      setSnapshot({ ownerContextKey: null, status: "disabled" });
      return;
    }
    const expectedUserId = input.expectedUserId;
    const ownerContextKey = requestedContextKey;
    const isCurrent = () => generation.current === current
      && requestedContextKeyRef.current === ownerContextKey;
    setSnapshot({ ownerContextKey, status: "loading" });
    const rpc = createTrainingCycleRpcGateway({
      expectedUserId,
      portalScope: "usuario",
      isCurrent,
    });
    void loadTrainingCycleProductData(rpc).then((data) => {
      if (isCurrent()) setSnapshot({ ownerContextKey, status: "ready", rpc, data });
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      if (error instanceof TrainingCycleTransportError && error.code === "not_supported") {
        setSnapshot({ ownerContextKey, status: "unsupported" });
        return;
      }
      setSnapshot({
        ownerContextKey,
        status: "error",
        message: "No pudimos cargar tus ciclos. Tu entrenamiento actual no fue modificado.",
      });
    });
    return () => { generation.current += 1; };
  }, [input.enabled, input.expectedUserId, reloadVersion, requestedContextKey]);

  const ready = useMemo(() => {
    if (visibleSnapshot.status !== "ready") return null;
    const { data, ownerContextKey, rpc } = visibleSnapshot;
    const ownsCurrentContext = () => requestedContextKeyRef.current === ownerContextKey;
    const ownerCallbacks = callbacksRef.current;
    const lifecycle = createTrainingCycleProductLifecycleController({
      ownerContextKey,
      getCurrentContextKey: () => requestedContextKeyRef.current,
      onCycleChanged: ownerCallbacks.onCycleChanged,
      onStartTraining: ownerCallbacks.onStartTraining,
    });
    const notifyCycleChanged = async (cycleId: string) => {
      if (!ownsCurrentContext()) return false;
      return lifecycle.onCycleChanged(cycleId);
    };
    const startTraining = async (cycleId: string) => {
      if (!ownsCurrentContext()) return false;
      return lifecycle.onStartTraining(cycleId);
    };
    const productGateway = createTrainingCycleProductGateway({
      rpc,
      catalog: data.catalog,
      remoteDraft: data.draft,
      remoteDraftReference: data.draftReference,
      sourceCycleId: findTrainingCycleSourceCycleId({ draft: data.draft, lastCycle: data.lastCycle }),
      activeCycle: data.activeCycle,
      onDraftPersisted(draftId, version) {
        if (!ownsCurrentContext()) return;
        setSnapshot((current) => current.status === "ready"
          && current.ownerContextKey === ownerContextKey
          && current.rpc === rpc
          ? { ...current, data: { ...current.data, draftReference: { draftId, version } } }
          : current);
      },
      onDraftDiscarded() {
        if (!ownsCurrentContext()) return;
        setSnapshot((current) => current.status === "ready"
          && current.ownerContextKey === ownerContextKey
          && current.rpc === rpc
          ? { ...current, data: clearDiscardedTrainingCycleProductData(current.data) }
          : current);
      },
      async onCycleChanged(cycle) {
        if (!ownsCurrentContext()) return;
        setSnapshot((current) => current.status === "ready"
          && current.ownerContextKey === ownerContextKey
          && current.rpc === rpc
          ? { ...current, data: { ...current.data, activeCycle: cycle } }
          : current);
        await notifyCycleChanged(cycle.cycleId);
      },
    });
    return {
      status: "ready" as const,
      gateway: productGateway,
      activeCycle: data.activeCycle,
      recordExecution: (payload: Parameters<ProductRpc["recordExecution"]>[0]) => rpc.recordExecution(payload),
      onCycleChanged: notifyCycleChanged,
      onStartTraining: startTraining,
      viewModel: buildTrainingCycleProductViewModel({
        todayIsoDate: todayInSantiago(),
        catalog: data.catalog,
        entries: input.entries,
        activeCycle: data.activeCycle,
        draft: data.draft,
        sourceCycle: data.sourceCycle,
        lastCycle: data.lastCycle,
      }),
    };
  }, [input.entries, visibleSnapshot]);

  if (visibleSnapshot.status === "ready") {
    return ready
      ? { ...ready, reload }
      : { status: "error", message: "No pudimos preparar el constructor de ciclos.", reload };
  }
  if (visibleSnapshot.status === "error") {
    return { status: "error", message: visibleSnapshot.message, reload };
  }
  return { status: visibleSnapshot.status, reload };
}
