"use client";

import { useEffect, useState } from "react";
import { listOwnCoachStudentTrainingCycles } from "@/features/training-cycle-builder/data/coach-student-training-gateway";

export function useCoachStudentRoutineSummary(coachId: string, episodeId: string | null) {
  const [result, setResult] = useState<{ episodeId: string; cycle: {
    cycleNumber: number; endDate: string; updatedLabel: string } | null;
    hasMore: boolean; state: "ready" | "unavailable" } | null>(null);
  useEffect(() => {
    setResult(null);
    if (!episodeId) return;
    let live = true;
    void listOwnCoachStudentTrainingCycles(coachId, episodeId, 50)
      .then((page) => {
        const current = page.items.find((item) => item.status === "active" || item.status === "expiring");
        if (live) setResult({ episodeId, cycle: current ? { cycleNumber: current.cycleNumber, endDate: current.endDate,
          updatedLabel: new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric",
            timeZone: "America/Santiago" }).format(new Date(current.updatedAt)) } : null,
          hasMore: Boolean(page.nextCursor), state: "ready" });
      })
      .catch(() => { if (live) setResult({ episodeId, cycle: null, hasMore: false, state: "unavailable" }); });
    return () => { live = false; };
  }, [coachId, episodeId]);
  return result?.episodeId === episodeId ? result : null;
}
