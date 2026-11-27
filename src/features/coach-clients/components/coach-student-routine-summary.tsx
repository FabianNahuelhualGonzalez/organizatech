"use client";

import { useEffect, useState } from "react";
import { listOwnCoachStudentTrainingCycles } from "@/features/training-cycle-builder/data/coach-student-training-gateway";
import type { TrainingCycleListItem } from "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import styles from "./coach-client-detail-sheet.module.css";

export function CoachStudentRoutineSummary({ coachId, episodeId, onOpenRecord }: {
  readonly coachId: string;
  readonly episodeId: string;
  readonly onOpenRecord: () => void;
}) {
  const [cycle, setCycle] = useState<TrainingCycleListItem | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  useEffect(() => {
    let current = true;
    void listOwnCoachStudentTrainingCycles(coachId, episodeId, 50)
      .then((page) => {
        if (!current) return;
        setCycle(page.items.find((item) => item.status === "active" || item.status === "expiring") ?? null);
        setHasMore(Boolean(page.nextCursor));
        setState("ready");
      })
      .catch(() => { if (current) setState("unavailable"); });
    return () => { current = false; };
  }, [coachId, episodeId]);

  if (state === "loading") return <p className={styles.routineSummary} role="status">Consultando rutina vigente…</p>;
  if (state !== "ready") return null;
  return <div className={styles.routineSummary}>
    <strong>Rutina del alumno</strong>
    {cycle ? <>
      <span>Ciclo {cycle.cycleNumber} · vigente hasta {cycle.endDate}</span>
      <span>Última actualización: {new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Santiago" }).format(new Date(cycle.updatedAt))}</span>
      <button type="button" onClick={onOpenRecord}>Ver rutina, ejercicios y resultados</button>
    </> : <span>{hasMore ? "Consulta la ficha para revisar todos sus ciclos." : "No tiene un ciclo vigente. Puedes revisar sus ciclos finalizados en la ficha."}</span>}
  </div>;
}
