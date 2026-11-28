import styles from "./coach-client-detail-sheet.module.css";

export function CoachStudentRoutineSummary({ cycle, hasMore, state }: {
  readonly cycle: { readonly cycleNumber: number; readonly endDate: string; readonly updatedLabel: string } | null;
  readonly hasMore: boolean;
  readonly state: "loading" | "ready" | "unavailable";
}) {
  if (state === "loading") return <p className={styles.routineSummary} role="status">Consultando rutina vigente…</p>;
  if (state !== "ready") return null;
  return <div className={styles.routineSummary}>
    <strong>Rutina del alumno</strong>
    {cycle ? <>
      <span>Ciclo {cycle.cycleNumber} · vigente hasta {cycle.endDate}</span>
      <span>Última actualización: {cycle.updatedLabel}</span>
    </> : <span>{hasMore ? "Consulta la ficha para revisar todos sus ciclos." : "No tiene un ciclo vigente. Puedes revisar sus ciclos finalizados en la ficha."}</span>}
  </div>;
}
