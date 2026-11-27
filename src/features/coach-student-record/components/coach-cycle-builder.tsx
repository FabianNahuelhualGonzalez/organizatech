"use client";

import { useEffect, useState } from "react";

import { TrainingCycleBuilder } from "@/features/training-cycle-builder/components/training-cycle-builder";
import type { TrainingCycleBuilderGateway, TrainingCycleBuilderInitialViewModel,
  TrainingCycleSaveDraftInput } from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import { createTrainingCycleRpcGateway } from "@/features/training-cycle-builder/data/supabase-training-cycle-rpc-gateway";
import { mapBuilderDaysToRpcPlan } from "@/features/training-cycle-builder/data/training-cycle-rpc-mappers";
import type { TrainingCycleCatalogItem, TrainingCycleRpcSnapshot } from
  "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import { createOwnCoachStudentTrainingCycle,
  getOwnCoachStudentTrainingCycle, listOwnCoachStudentTrainingCycles } from
  "@/features/training-cycle-builder/data/coach-student-training-gateway";
import { generateProductTrainingCycleSuggestion } from
  "@/features/training-cycle-builder/integration/training-cycle-product-suggestion";
import { buildTrainingCycleProductViewModel } from
  "@/features/training-cycle-builder/integration/training-cycle-product-view-model";

function todayInSantiago() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function createCoachGateway(input: {
  coachId: string; episodeId: string; catalog: readonly TrainingCycleCatalogItem[];
}): TrainingCycleBuilderGateway {
  let savedDraft: TrainingCycleSaveDraftInput | null = null;
  let requestId: string | null = null;
  return {
    async saveDraft(draft) {
      // The Coach draft lives only in this mounted flow. No student data is written
      // until activation; the save indicator is suppressed in Coach mode.
      savedDraft = draft;
      return { status: "saved", savedAtLabel: "Borrador temporal" };
    },
    async generateSuggestedDraft(suggestion) {
      return { draft: generateProductTrainingCycleSuggestion(suggestion, input.catalog) };
    },
    async createCustomExercise() {
      throw new Error("custom-exercise-requires-student-ownership");
    },
    async getActiveCycleGuard() {
      const page = await listOwnCoachStudentTrainingCycles(input.coachId, input.episodeId);
      const active = page.items.find((item) => item.status === "active" || item.status === "expiring");
      if (active) throw new Error("student-cycle-changed");
      return null;
    },
    async completeActiveCycle() { throw new Error("student-cycle-changed"); },
    async activateCycle() {
      if (!savedDraft) throw new Error("draft-not-ready");
      requestId ??= crypto.randomUUID();
      const accepted = await createOwnCoachStudentTrainingCycle({
        expectedCoachId: input.coachId, episodeId: input.episodeId, requestId,
        goal: savedDraft.goal, startDate: savedDraft.startDate, endDate: savedDraft.endDate,
        plan: mapBuilderDaysToRpcPlan(savedDraft.days, undefined, savedDraft.scheduleMode),
      });
      return { cycleId: accepted.aggregateId, revision: String(accepted.resultVersion),
        status: "activated" };
    },
    async saveActiveCycle() { throw new Error("coach-active-edit-not-in-this-flow"); },
    async extendCycle() { throw new Error("coach-extension-not-in-this-flow"); },
    async discardDraft() { savedDraft = null; requestId = null; },
  };
}

export function CoachCycleBuilder({ coachId, episodeId, studentName, previousCycle,
  onExit, onViewCycle }: {
  readonly coachId: string; readonly episodeId: string; readonly studentName: string;
  readonly previousCycle: TrainingCycleRpcSnapshot | null;
  readonly onExit: () => void; readonly onViewCycle: (cycleId: string) => void;
}) {
  const [ready, setReady] = useState<{
    viewModel: TrainingCycleBuilderInitialViewModel;
    gateway: TrainingCycleBuilderGateway;
  } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const rpc = createTrainingCycleRpcGateway({ expectedUserId: coachId,
          portalScope: "coach", isCurrent: () => current });
        const catalog: TrainingCycleCatalogItem[] = [];
        let cursor = null as Awaited<ReturnType<typeof rpc.listCatalog>>["nextCursor"];
        for (let page = 0; page < 20; page += 1) {
          const next = await rpc.listCatalog({ limit: 100, cursor });
          catalog.push(...next.items.filter((item) => item.source.kind === "catalog"));
          cursor = next.nextCursor;
          if (!cursor) break;
        }
        if (cursor) throw new Error("catalog-limit");
        const history = await listOwnCoachStudentTrainingCycles(coachId, episodeId);
        const last = history.items.find((item) => item.cycleId !== previousCycle?.cycleId);
        const lastCycle = previousCycle ?? (last ? await getOwnCoachStudentTrainingCycle(
          coachId, episodeId, last.cycleId) : null);
        const today = todayInSantiago();
        const viewModel = buildTrainingCycleProductViewModel({ todayIsoDate: today,
          catalog, entries: [], activeCycle: null, draft: null, sourceCycle: null,
          lastCycle });
        if (current) setReady({ viewModel: { ...viewModel, initialScreen: "start",
          hasRecoverableDraft: false }, gateway: createCoachGateway({ coachId,
          episodeId, catalog }) });
      } catch { if (current) setError(true); }
    };
    void load();
    return () => { current = false; };
  }, [coachId, episodeId, previousCycle]);

  if (error) return <div role="alert">No pudimos abrir el constructor del alumno.
    <button type="button" onClick={onExit}>Volver a la ficha</button></div>;
  if (!ready) return <p role="status">Cargando constructor de ciclos…</p>;
  return <TrainingCycleBuilder initialViewModel={ready.viewModel} gateway={ready.gateway}
    shell={{ isMenuOpen: false, onMenuToggle: () => {}, isNotificationPanelOpen: false }}
    chromeMode="embedded" onExit={onExit}
    coachStudent={{ name: studentName, closedPreviousCycle: Boolean(previousCycle), onViewCycle }} />;
}
