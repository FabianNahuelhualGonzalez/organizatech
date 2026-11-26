"use client";

import { useEffect, useState } from "react";

import { createTrainingCycleRpcGateway } from
  "@/features/training-cycle-builder/data/supabase-training-cycle-rpc-gateway";
import { closeOwnCoachStudentLastRoutine, createOwnCoachStudentTrainingCycle,
  editOwnCoachStudentActiveTrainingCycle } from
  "@/features/training-cycle-builder/data/coach-student-training-gateway";
import { TRAINING_CYCLE_RPC_WEEKDAYS, type TrainingCycleCatalogItem,
  type TrainingCycleRpcDayPlan, type TrainingCycleRpcExercisePlan,
  type TrainingCycleRpcGoal, type TrainingCycleRpcSnapshot,
  type TrainingCycleRpcWeekday } from
  "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import { editablePlan, replaceRoutine } from "../model/coach-routine-plan";

import styles from "./coach-student-record.module.css";

type Mode = "create_cycle" | "create_routine" | "modify_routine";
const WEEKDAYS: Record<TrainingCycleRpcWeekday, string> = {
  monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles", thursday: "Jueves",
  friday: "Viernes", saturday: "Sábado", sunday: "Domingo",
};
function chileDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function CoachRoutineEditor({ coachId, episodeId, cycle, hasActiveCycle, onSaved }: {
  readonly coachId: string;
  readonly episodeId: string;
  readonly cycle: TrainingCycleRpcSnapshot | null;
  readonly hasActiveCycle: boolean;
  readonly onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [day, setDay] = useState<TrainingCycleRpcWeekday>("monday");
  const [goal, setGoal] = useState<TrainingCycleRpcGoal>("strength");
  const [startDate, setStartDate] = useState(chileDate);
  const [endDate, setEndDate] = useState(() => {
    const date = new Date(`${chileDate()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 28);
    return date.toISOString().slice(0, 10);
  });
  const [exercises, setExercises] = useState<readonly TrainingCycleRpcExercisePlan[]>([]);
  const [catalog, setCatalog] = useState<readonly TrainingCycleCatalogItem[]>([]);
  const [selectedNames, setSelectedNames] = useState<Readonly<Record<string, string>>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!mode) return;
    let current = true;
    const gateway = createTrainingCycleRpcGateway({ expectedUserId: coachId,
      portalScope: "coach", isCurrent: () => current });
    void gateway.listCatalog({ query, limit: 50 }).then((page) => {
      if (current) setCatalog(page.items.filter((item) => item.source.kind === "catalog"));
    }).catch(() => { if (current) setCatalog([]); });
    return () => { current = false; };
  }, [coachId, mode, query]);

  function begin(nextMode: Mode, selected = 0) {
    setMode(nextMode); setIndex(selected); setError(""); setQuery("");
    setGoal(cycle?.goal ?? "strength");
    const routine = nextMode === "modify_routine" ? cycle?.plan.days[selected] : null;
    setName(routine?.name ?? "");
    setDay(routine?.day ?? TRAINING_CYCLE_RPC_WEEKDAYS.find((value) =>
      !cycle?.plan.days.some((item) => item.day === value)) ?? "monday");
    setExercises(routine ? editablePlan(cycle!).days[selected].exercises : []);
    setSelectedNames(Object.fromEntries(routine?.exercises.map((exercise) => [exercise.source.id, exercise.name]) ?? []));
    if (cycle && nextMode !== "create_cycle") {
      setStartDate(cycle.startDate); setEndDate(cycle.endDate);
    }
  }

  function updateExercise(position: number, change: (exercise: TrainingCycleRpcExercisePlan) => TrainingCycleRpcExercisePlan) {
    setExercises((current) => current.map((exercise, i) => i === position ? change(exercise) : exercise));
  }

  async function save() {
    if (!mode || !name.trim() || name.trim().length > 120 || exercises.length === 0 || busy) return;
    setBusy(true); setError("");
    try {
      const routine: TrainingCycleRpcDayPlan = { day, name: name.trim(), order: index,
        exercises: exercises.map((exercise, order) => ({ ...exercise, order,
          sets: exercise.sets.map((set, setOrder) => ({ ...set, order: setOrder,
            drops: set.drops.map((drop, dropOrder) => ({ ...drop, order: dropOrder })) })) })) };
      const requestId = crypto.randomUUID();
      if (mode === "create_cycle") {
        await createOwnCoachStudentTrainingCycle({ expectedCoachId: coachId, episodeId, requestId,
          goal, startDate, endDate, plan: { days: [routine] } });
      } else if (cycle) {
        await editOwnCoachStudentActiveTrainingCycle({ expectedCoachId: coachId, episodeId,
          requestId, cycleId: cycle.cycleId, expectedVersion: cycle.version,
          action: mode, goal, plan: replaceRoutine(editablePlan(cycle), index, routine) });
      }
      setMode(null); await onSaved();
    } catch {
      setMode(null);
      setError("No se confirmó el cambio. Actualizamos el ciclo antes de permitir otro intento.");
      await onSaved().catch(() => {});
    }
    finally { setBusy(false); }
  }

  async function remove() {
    if (removeIndex === null || !cycle || busy) return;
    setBusy(true); setError("");
    try {
      const requestId = crypto.randomUUID();
      if (cycle.plan.days.length === 1) {
        await closeOwnCoachStudentLastRoutine({ expectedCoachId: coachId, episodeId,
          requestId, cycleId: cycle.cycleId, expectedVersion: cycle.version });
      } else {
        await editOwnCoachStudentActiveTrainingCycle({ expectedCoachId: coachId, episodeId,
          requestId, cycleId: cycle.cycleId, expectedVersion: cycle.version,
          action: "remove_routine", goal: cycle.goal,
          plan: replaceRoutine(editablePlan(cycle), removeIndex, null) });
      }
      setRemoveIndex(null); await onSaved();
    } catch {
      setRemoveIndex(null);
      setError("No se confirmó el cambio. Actualizamos el ciclo antes de permitir otro intento.");
      await onSaved().catch(() => {});
    }
    finally { setBusy(false); }
  }

  const editable = cycle?.status === "active" || cycle?.status === "expiring";
  return <div className={styles.editor}>
    {!cycle ? !hasActiveCycle ? <button type="button" onClick={() => begin("create_cycle")}>Crear primera rutina y ciclo</button> : null :
      editable ? <>
        <button type="button" disabled={cycle.plan.days.length >= 7} onClick={() => begin("create_routine", cycle.plan.days.length)}>Crear rutina</button>
        {cycle.plan.days.map((routine, position) => <div className={styles.routineAction} key={routine.snapshotId}>
          <span>{routine.name}</span>
          <button type="button" onClick={() => begin("modify_routine", position)}>Modificar rutina</button>
          <button type="button" onClick={() => setRemoveIndex(position)}>Quitar rutina del ciclo</button>
        </div>)}
      </> : <p>El ciclo cerrado conserva su historial y es de solo lectura.
        {!hasActiveCycle ? <button type="button" onClick={() => begin("create_cycle")}>Crear un ciclo nuevo</button> : null}
      </p>}
    {error ? <p role="alert">{error}</p> : null}
    {mode ? <div className={styles.detail}>
      <h3>{mode === "create_cycle" ? "Primer ciclo" : mode === "create_routine" ? "Nueva rutina" : "Modificar rutina"}</h3>
      <label>Nombre de la rutina<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
      <label>Día<select value={day} onChange={(event) => setDay(event.target.value as TrainingCycleRpcWeekday)}>
        {TRAINING_CYCLE_RPC_WEEKDAYS.map((value) => <option key={value} value={value}
          disabled={cycle?.plan.days.some((item, position) => position !== (mode === "modify_routine" ? index : -1)
            && item.day === value)}>{WEEKDAYS[value]}</option>)}
      </select></label>
      {mode === "create_cycle" ? <>
        <label>Inicio<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label>Término<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      </> : null}
      <label>Objetivo<select value={goal} onChange={(event) => setGoal(event.target.value as TrainingCycleRpcGoal)}>
        <option value="strength">Fuerza</option><option value="volume">Volumen</option>
        <option value="definition">Definición</option><option value="deload">Descarga</option>
      </select></label>
      <h4>Ejercicios</h4>
      {exercises.map((exercise, position) => <div className={styles.routineAction} key={`${position}:${exercise.catalogExerciseId ?? exercise.customExerciseId}`}>
        <span>{selectedNames[exercise.catalogExerciseId ?? exercise.customExerciseId ?? ""] ?? "Ejercicio"}</span>
        <label>Técnica<select value={exercise.technique} onChange={(event) => updateExercise(position, (item) => ({
          ...item, technique: event.target.value as TrainingCycleRpcExercisePlan["technique"],
          sets: event.target.value === "drop_set" ? item.sets.map((set) => ({ ...set,
            drops: set.drops.length ? set.drops : [{ order: 0, kg: 0, reps: 8 }] }))
            : item.sets.map((set) => ({ ...set, drops: [] })),
        }))}>
          <option value="linear">Lineal</option><option value="ascending">Ascendente</option>
          <option value="descending">Descendente</option><option value="drop_set">Drop set</option>
          <option value="failure">Al fallo</option>
        </select></label>
        {exercise.sets.map((set, setIndex) => <div className={styles.setAction} key={setIndex}>
          <span>Serie {setIndex + 1}</span>
          <label>Repeticiones<input type="number" min="1" max="1000" value={set.targetReps}
            onChange={(event) => updateExercise(position, (item) => ({ ...item,
              sets: item.sets.map((entry, i) => i === setIndex
                ? { ...entry, targetReps: Number(event.target.value) } : entry) }))} /></label>
          <label>Kg<input type="number" min="0" max="99999.99" step="0.01" value={set.targetKg}
            onChange={(event) => updateExercise(position, (item) => ({ ...item,
              sets: item.sets.map((entry, i) => i === setIndex
                ? { ...entry, targetKg: Number(event.target.value) } : entry) }))} /></label>
          <label className={styles.inlineCheck}><input type="checkbox" checked={set.toFailure}
            onChange={(event) => updateExercise(position, (item) => ({ ...item,
              sets: item.sets.map((entry, i) => i === setIndex
                ? { ...entry, toFailure: event.target.checked } : entry) }))} />Al fallo</label>
          {exercise.technique === "drop_set" ? <>
            {set.drops.map((drop, dropIndex) => <div className={styles.setAction} key={dropIndex}>
              <span>Descarga {dropIndex + 1}</span>
              <label>Repeticiones<input type="number" min="1" max="1000" value={drop.reps}
                onChange={(event) => updateExercise(position, (item) => ({ ...item,
                  sets: item.sets.map((entry, i) => i === setIndex ? { ...entry,
                    drops: entry.drops.map((value, j) => j === dropIndex
                      ? { ...value, reps: Number(event.target.value) } : value) } : entry) }))} /></label>
              <label>Kg<input type="number" min="0" max="99999.99" step="0.01" value={drop.kg}
                onChange={(event) => updateExercise(position, (item) => ({ ...item,
                  sets: item.sets.map((entry, i) => i === setIndex ? { ...entry,
                    drops: entry.drops.map((value, j) => j === dropIndex
                      ? { ...value, kg: Number(event.target.value) } : value) } : entry) }))} /></label>
              <button type="button" disabled={set.drops.length <= 1} onClick={() => updateExercise(position,
                (item) => ({ ...item, sets: item.sets.map((entry, i) => i === setIndex ? {
                  ...entry, drops: entry.drops.filter((_, j) => j !== dropIndex),
                } : entry) }))}>Quitar descarga</button>
            </div>)}
            <button type="button" disabled={set.drops.length >= 8} onClick={() => updateExercise(position,
              (item) => ({ ...item, sets: item.sets.map((entry, i) => i === setIndex ? {
                ...entry, drops: [...entry.drops, { order: entry.drops.length, kg: 0, reps: 8 }],
              } : entry) }))}>Agregar descarga</button>
          </> : null}
          <button type="button" disabled={exercise.sets.length <= 1} onClick={() => updateExercise(position,
            (item) => ({ ...item, sets: item.sets.filter((_, i) => i !== setIndex) }))}>Quitar serie</button>
        </div>)}
        <button type="button" disabled={exercise.sets.length >= 20} onClick={() => updateExercise(position,
          (item) => ({ ...item, sets: [...item.sets, { order: item.sets.length,
            targetReps: 10, targetKg: 0, toFailure: false,
            drops: item.technique === "drop_set" ? [{ order: 0, kg: 0, reps: 8 }] : [] }] }))}>
          Agregar serie</button>
        <button type="button" onClick={() => setExercises((current) => current.filter((_, i) => i !== position))}>Quitar ejercicio</button>
      </div>)}
      <label>Buscar ejercicio<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <ul>{catalog.slice(0, 12).map((item) => <li key={item.source.id}>{item.name}
        <button type="button" onClick={() => {
          setSelectedNames((current) => ({ ...current, [item.source.id]: item.name }));
          setExercises((current) => [...current, {
            catalogExerciseId: item.source.id, order: current.length, technique: "linear",
            videoUrl: item.videoUrl, sets: [{ order: 0, targetReps: 10, targetKg: 0,
              toFailure: false, drops: [] }],
          }]);
        }}>Agregar</button></li>)}</ul>
      <button type="button" disabled={busy || !name.trim() || exercises.length === 0}
        onClick={() => void save()}>Guardar rutina</button>
      <button type="button" disabled={busy} onClick={() => setMode(null)}>Cancelar</button>
    </div> : null}
    {removeIndex !== null && cycle ? <div role="dialog" aria-modal="true" aria-label="Quitar rutina" className={styles.viewer}>
      <div className={styles.detail}><p>{cycle.plan.days.length === 1
        ? "Al quitar la última rutina se cerrará el ciclo. El historial permanecerá disponible."
        : "Se quitará la rutina del ciclo vigente. El historial anterior permanecerá disponible."}</p>
        <button type="button" disabled={busy} onClick={() => void remove()}>Confirmar</button>
        <button type="button" disabled={busy} onClick={() => setRemoveIndex(null)}>Cancelar</button>
      </div>
    </div> : null}
  </div>;
}
