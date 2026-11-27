"use client";

import { useEffect, useState } from "react";
import { TRAINING_CYCLE_DAY_LABELS } from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import type { TrainingCycleRpcSnapshot } from "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import { getOwnCoachStudentTrainingCycleVersion } from
  "@/features/training-cycle-builder/data/coach-student-training-gateway";
import { getCoachCycleActivity, listCoachCycleSessions,
  type ActualSession, type CycleActivity } from "../data/coach-cycle-activity";
import styles from "./coach-student-record.module.css";

const date = (v: string) => v.split("-").reverse().join("-");
const kg = (v: number) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(v);
type View = "last" | "sessions" | "plan";

export function CoachCycleDetail({ coachId, episodeId, cycle }: {
  readonly coachId: string; readonly episodeId: string; readonly cycle: TrainingCycleRpcSnapshot;
}) {
  const [activity, setActivity] = useState<CycleActivity | null>(null);
  const [initialPlan, setInitialPlan] = useState(cycle.plan);
  const [sessions, setSessions] = useState<readonly ActualSession[]>([]);
  const [view, setView] = useState<View>("plan");
  const [openDay, setOpenDay] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setActivity(null); setInitialPlan(cycle.plan); setSessions([]); setView("plan"); setOpenDay(0); setError(""); setLoading(true);
    void Promise.all([getCoachCycleActivity(coachId, episodeId, cycle.cycleId),
      listCoachCycleSessions(coachId, episodeId, cycle.cycleId),
      cycle.version === 1 ? Promise.resolve(cycle.plan)
        : getOwnCoachStudentTrainingCycleVersion(coachId, episodeId, cycle.cycleId, 1)
          .then((version) => version.plan)]).then(([summary, page, original]) => {
      if (current) { setActivity(summary); setSessions(page); setInitialPlan(original);
        setView(summary.sessionCount ? "last" : "plan"); }
    }).catch(() => { if (current) setError("No pudimos cargar los entrenamientos registrados. Reintenta al abrir el ciclo."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [coachId, episodeId, cycle.cycleId, cycle.plan, cycle.version]);

  const weeks = Math.max(1, Math.ceil((Date.parse(`${cycle.endDate}T00:00:00Z`)
    - Date.parse(`${cycle.startDate}T00:00:00Z`) + 86400000) / (7 * 86400000)));
  const planned = weeks * cycle.plan.days.length;
  const compliance = activity && planned ? Math.round(activity.sessionCount / planned * 100) : null;

  async function more() {
    setMoreBusy(true); setError("");
    try {
      const page = await listCoachCycleSessions(coachId, episodeId, cycle.cycleId, 20, sessions.length);
      setSessions((old) => [...old, ...page]);
    } catch { setError("No pudimos cargar más sesiones."); }
    finally { setMoreBusy(false); }
  }
  const table = (rows: readonly { readonly reps: number; readonly kg: number }[]) =>
    <table className={styles.sets}><thead><tr><th>Serie</th><th>Rep</th><th>Kg</th></tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}><td>{i + 1}</td><td>{row.reps}</td><td>{kg(row.kg)}</td></tr>)}</tbody></table>;

  return <div className={styles.detail} aria-label="Ciclo completo del alumno">
    <div className={styles.detailHead}><div><div className={styles.eyebrow}>CICLO {cycle.cycleNumber} · VERSIÓN {cycle.version}</div>
      <h3>Plan de entrenamiento</h3><div className={styles.dates}>{date(cycle.startDate)} → {date(cycle.endDate)}</div></div>
      <span className={`${styles.chip} ${cycle.status === "closed" ? styles.muted : styles.accent}`}>
        {cycle.status === "closed" ? "Cerrado" : "Vigente"}</span></div>
    <div className={styles.metrics}>
      <div className={styles.metric}><span>SESIONES</span><b>{activity?.sessionCount ?? "—"} <small>de {planned}</small></b></div>
      <div className={styles.metric}><span>CUMPLIMIENTO</span><b>{cycle.status === "closed" && compliance !== null ? `${compliance}%` : "—"}</b></div>
      <div className={styles.metric}><span>DÍAS POR SEMANA</span><b>{cycle.plan.days.length}</b></div>
      <div className={styles.metric}><span>ÚLTIMA SESIÓN</span><b>{activity?.lastSessionOn ? date(activity.lastSessionOn) : "Sin registros"}</b></div>
    </div>
    {loading ? <p role="status">Cargando registros…</p> : null}
    {error ? <p role="alert" className={styles.alert}>{error}</p> : null}
    <div className={styles.tabs} role="tablist" aria-label="Vista del ciclo">
      {(["last", "sessions", "plan"] as const).map((tab) => <button key={tab} type="button"
        role="tab" aria-selected={view === tab} onClick={() => { setView(tab); setOpenDay(0); }}>
        {{ last: "Último registro", sessions: "Sesiones", plan: "Plan" }[tab]}</button>)}
    </div>
    <div role="tabpanel">
      {view === "last" && activity ? activity.sessionCount === 0
        ? <div className={styles.empty}>Este ciclo aún no tiene entrenamientos registrados.</div>
        : <><p className={styles.legend}>Series de la última vez que hizo cada ejercicio (repeticiones × kg), junto al plan con que se creó la rutina.</p>
          <div className={styles.days}>{initialPlan.days.map((day, i) => <div className={styles.day} key={day.snapshotId}>
            <button className={styles.dayHead} type="button" aria-expanded={openDay === i}
              onClick={() => setOpenDay(openDay === i ? -1 : i)}>
              <b>{day.name}</b><span>{TRAINING_CYCLE_DAY_LABELS[day.day]}</span><small>{day.exercises.length} ejercicios</small><span aria-hidden>⌄</span>
            </button>{openDay === i ? <div className={styles.dayBody}>{day.exercises.map((ex) => {
              const history = activity.records.find((r) => r.lineageId === ex.exerciseLineageId);
              const last = history?.last;
              const delta = history ? last!.maxKg - history.first.maxKg : 0;
              return <div className={styles.exercise} key={ex.snapshotId}><strong>{ex.name}</strong>
                {!history || !last ? <p className={styles.pendingText}>No lo registró en este ciclo</p> : <>
                  <small>Último registro · {date(last.performedOn)}</small>
                  <table className={styles.sets}><thead><tr><th>Serie</th><th>Plan</th><th>Último</th></tr></thead>
                    <tbody>{Array.from({ length: Math.max(ex.sets.length, last.sets.length) }, (_, index) => <tr key={index}>
                      <td>{index + 1}</td><td>{ex.sets[index] ? `${ex.sets[index].targetReps} × ${kg(ex.sets[index].targetKg)} kg` : "—"}</td>
                      <td><b>{last.sets[index] ? `${last.sets[index].reps} × ${kg(last.sets[index].kg)} kg` : "—"}</b></td></tr>)}</tbody></table>
                  <small>Partió con {kg(history.first.maxKg)} kg → cerró con {kg(last.maxKg)} kg <span
                    className={delta > 0 ? styles.up : delta < 0 ? styles.down : ""}>
                      {delta > 0 ? `▲ +${kg(delta)}` : delta < 0 ? `▼ ${kg(delta)}` : "="}{delta ? " kg" : ""}</span></small>
                </>}
              </div>;
            })}</div> : null}</div>)}
            {activity.records.filter((r) => !initialPlan.days.some((d) => d.exercises.some(
              (ex) => ex.exerciseLineageId === r.lineageId))).map((r) => <div className={styles.day} key={r.lineageId}>
                <div className={styles.dayBody}><div className={styles.exercise}><strong>{r.name}</strong>
                  <small>Ejercicio agregado después del plan inicial · {date(r.last.performedOn)}</small>
                  {table(r.last.sets)}<small>Partió con {kg(r.first.maxKg)} kg → cerró con {kg(r.last.maxKg)} kg</small>
                </div></div></div>)}</div></> : null}
      {view === "sessions" && activity ? activity.sessionCount === 0
        ? <div className={styles.empty}>Este ciclo aún no tiene entrenamientos registrados.</div>
        : <><div className={styles.sessions}>{sessions.map((session) => <details className={styles.session} key={session.id}>
          <summary><strong>{date(session.performedOn)} · {session.dayName}</strong>
            <small>{session.exercises.length} ejercicios · {session.exercises.reduce((n, ex) => n + ex.sets.length, 0)} series</small>
            <span className={`${styles.chip} ${session.partial ? styles.pending : styles.ok}`}>
              {session.partial ? "Parcial" : "Completa"}</span></summary>
          <div className={styles.sessionBody}>{session.exercises.map((ex) => <div className={styles.exercise} key={ex.lineageId}>
            <strong>{ex.name}</strong>{table(ex.sets)}</div>)}</div></details>)}</div>
          {sessions.length < activity.sessionCount ? <button type="button" className={styles.button}
            disabled={moreBusy} onClick={() => void more()}>{moreBusy ? "Cargando…" : `Ver las ${activity.sessionCount} sesiones`}</button> : null}</> : null}
      {view === "plan" ? <div className={styles.days}>{initialPlan.days.map((day, i) => <div className={styles.day} key={day.snapshotId}>
        <button className={styles.dayHead} type="button" aria-expanded={openDay === i}
          onClick={() => setOpenDay(openDay === i ? -1 : i)}><b>{day.name}</b>
          <span>{TRAINING_CYCLE_DAY_LABELS[day.day]}</span><small>{day.exercises.length} ejercicios</small><span aria-hidden>⌄</span></button>
        {openDay === i ? <div className={styles.dayBody}>{day.exercises.map((ex) => <div className={styles.exercise} key={ex.snapshotId}>
          <strong>{ex.name}</strong><small>{ex.technique}</small>
          {table(ex.sets.map((set) => ({ reps: set.targetReps, kg: set.targetKg })))}
          {ex.videoUrl ? <a href={ex.videoUrl} target="_blank" rel="noopener noreferrer">Ver video de YouTube</a> : null}
        </div>)}</div> : null}</div>)}</div> : null}
    </div>
  </div>;
}
