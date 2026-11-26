"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CoachEvaluationDetail } from "@/features/evaluations/components/coach-evaluations";
import { listOwnCoachStudentEvaluations } from "@/features/evaluations/data/evaluations-repository";
import type { CoachEvaluationAssignment } from "@/features/evaluations/model/evaluation-types";
import { getOwnCoachStudentTrainingCycle, listOwnCoachStudentTrainingCycles } from
  "@/features/training-cycle-builder/data/coach-student-training-gateway";
import type { TrainingCycleListCursor, TrainingCycleListItem, TrainingCycleRpcSnapshot } from
  "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import { AppBackButton } from "@/ui/navigation/app-back-button";
import { CoachRoutineEditor } from "./coach-routine-editor";
import { getCoachStudentRecordGateway, type CoachStudentRecordSubject,
  type SharedStudentDocument, type SharedStudentPhoto } from "../data/coach-student-record-gateway";

import styles from "./coach-student-record.module.css";

type Data = {
  readonly subject: CoachStudentRecordSubject;
  readonly cycles: readonly TrainingCycleListItem[];
  readonly cycleCursor: TrainingCycleListCursor | null;
  readonly evaluations: readonly CoachEvaluationAssignment[];
  readonly moreEvaluations: boolean;
  readonly documents: readonly SharedStudentDocument[];
  readonly moreDocuments: boolean;
  readonly photos: readonly SharedStudentPhoto[];
  readonly morePhotos: boolean;
};

export function CoachStudentRecord({ coachId, episodeId, onBack, onSendEvaluation }: {
  readonly coachId: string;
  readonly episodeId: string;
  readonly onBack: () => void;
  readonly onSendEvaluation: () => void;
}) {
  const currentRef = useRef(true);
  const loadGenerationRef = useRef(0);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [cycle, setCycle] = useState<TrainingCycleRpcSnapshot | null>(null);
  const [activeCycle, setActiveCycle] = useState<TrainingCycleRpcSnapshot | null>(null);
  const [evaluation, setEvaluation] = useState<CoachEvaluationAssignment | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photoUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setError("");
    setData(null); setCycle(null); setActiveCycle(null); setEvaluation(null);
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null; setPhotoUrl(null);
    try {
      const access = getCoachStudentRecordGateway(coachId, episodeId, () => currentRef.current);
      const subject = await access.getSubject();
      const [cycles, evaluations, documents, photos] = await Promise.all([
        listOwnCoachStudentTrainingCycles(coachId, episodeId),
        listOwnCoachStudentEvaluations(coachId, episodeId),
        access.listDocuments(), access.listPhotos(),
      ]);
      await access.getSubject();
      const active = cycles.items.find((item) => item.status === "active" || item.status === "expiring");
      const activeCycle = active ? await getOwnCoachStudentTrainingCycle(coachId, episodeId, active.cycleId) : null;
      if (currentRef.current && generation === loadGenerationRef.current) {
        setData({ subject, cycles: cycles.items, cycleCursor: cycles.nextCursor,
          evaluations, moreEvaluations: evaluations.length === 50,
          documents, moreDocuments: documents.length === 50,
          photos, morePhotos: photos.length === 50 });
        setCycle(activeCycle);
        setActiveCycle(activeCycle);
      }
    } catch {
      if (currentRef.current && generation === loadGenerationRef.current) {
        setData(null); setCycle(null); setActiveCycle(null); setEvaluation(null);
        setError("La ficha no está disponible. Comprueba el vínculo y vuelve a intentar."); }
    }
  }, [coachId, episodeId]);

  useEffect(() => {
    currentRef.current = true;
    void load();
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { currentRef.current = false;
      window.removeEventListener("focus", onFocus);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current); };
  }, [load]);

  async function openCycle(item: TrainingCycleListItem) {
    const generation = loadGenerationRef.current;
    setBusy(true); setError("");
    try {
      const selected = await getOwnCoachStudentTrainingCycle(coachId, episodeId, item.cycleId);
      await getCoachStudentRecordGateway(coachId, episodeId, () => currentRef.current).getSubject();
      if (currentRef.current && generation === loadGenerationRef.current) setCycle(selected);
    } catch { if (currentRef.current && generation === loadGenerationRef.current) {
      setData(null); setCycle(null); setActiveCycle(null);
      setError("No pudimos abrir el ciclo. Actualiza la ficha."); } }
    finally { setBusy(false); }
  }

  async function loadMore(kind: "cycles" | "evaluations" | "documents" | "photos") {
    if (!data || moreBusy) return;
    const generation = loadGenerationRef.current;
    setMoreBusy(true); setError("");
    try {
      const access = getCoachStudentRecordGateway(coachId, episodeId, () => currentRef.current);
      let next: Data;
      if (kind === "cycles") {
        const page = await listOwnCoachStudentTrainingCycles(coachId, episodeId, 30, data.cycleCursor);
        next = { ...data, cycles: [...data.cycles, ...page.items], cycleCursor: page.nextCursor };
      } else if (kind === "evaluations") {
        const page = await listOwnCoachStudentEvaluations(coachId, episodeId, 50, data.evaluations.length);
        next = { ...data, evaluations: [...data.evaluations, ...page], moreEvaluations: page.length === 50 };
      } else if (kind === "documents") {
        const page = await access.listDocuments(50, data.documents.length);
        next = { ...data, documents: [...data.documents, ...page], moreDocuments: page.length === 50 };
      } else {
        const page = await access.listPhotos(50, data.photos.length);
        next = { ...data, photos: [...data.photos, ...page], morePhotos: page.length === 50 };
      }
      await access.getSubject();
      if (currentRef.current && generation === loadGenerationRef.current) setData(next);
    } catch { if (currentRef.current && generation === loadGenerationRef.current) {
      setData(null); setCycle(null); setActiveCycle(null);
      setError("No pudimos continuar la lectura. Actualiza la ficha para verificar el vínculo."); } }
    finally { setMoreBusy(false); }
  }

  async function openAsset(asset: SharedStudentDocument | SharedStudentPhoto) {
    const generation = loadGenerationRef.current;
    setBusy(true); setError("");
    try {
      const blob = await getCoachStudentRecordGateway(coachId, episodeId, () => currentRef.current).download(asset);
      if (!currentRef.current || generation !== loadGenerationRef.current) return;
      const url = URL.createObjectURL(blob);
      if (asset.bucketId === "progress-medical-documents") {
        const link = document.createElement("a");
        link.href = url; link.download = asset.displayName;
        link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
        photoUrlRef.current = url; setPhotoUrl(url);
      }
    } catch { if (currentRef.current && generation === loadGenerationRef.current) {
      setError("El archivo ya no está disponible o su permiso cambió."); } }
    finally { setBusy(false); }
  }

  function closePhoto() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null; setPhotoUrl(null);
  }

  return <main className={styles.record}>
    <AppBackButton onBack={onBack} label="Volver al alumno" />
    <h1>Ficha del alumno</h1>
    {error ? <div role="alert" className={styles.alert}>{error}<button type="button" onClick={() => void load()}>Reintentar</button></div> : null}
    {!data && !error ? <p role="status">Cargando ficha…</p> : null}
    {data ? <>
      <header className={styles.header}><h2>{data.subject.studentName}</h2>
        <p>{data.subject.studentEmail} · Vínculo activo</p></header>
      <section className={styles.section} aria-labelledby="record-training"><h2 id="record-training">Entrenamiento</h2>
        <CoachRoutineEditor coachId={coachId} episodeId={episodeId} cycle={cycle}
          hasActiveCycle={data.cycles.some((item) => item.status === "active" || item.status === "expiring")}
          onSaved={load} />
        {activeCycle && cycle?.cycleId !== activeCycle.cycleId ? <button type="button"
          onClick={() => setCycle(activeCycle)}>Volver al ciclo vigente</button> : null}
        {data.cycles.length === 0 ? <p>Aún no tiene ciclos de entrenamiento.</p> :
          <ul>{data.cycles.map((item) => <li key={item.cycleId}>
            <button type="button" disabled={busy} onClick={() => void openCycle(item)}>
              Ciclo {item.cycleNumber} · {item.status} · {item.startDate} a {item.endDate}
            </button></li>)}</ul>}
        {data.cycleCursor ? <button type="button" disabled={moreBusy} onClick={() => void loadMore("cycles")}>Ver más ciclos</button> : null}
        {cycle ? <div className={styles.detail}><h3>Ciclo {cycle.cycleNumber} · versión {cycle.version}</h3>
          <ul>{cycle.plan.days.map((day) => <li key={day.snapshotId}>
            <strong>{day.name}</strong> · {day.day}
            <ul>{day.exercises.map((exercise) => <li key={exercise.snapshotId}>{exercise.name}</li>)}</ul>
          </li>)}</ul>
          <button type="button" onClick={() => setCycle(null)}>Cerrar detalle</button>
        </div> : null}
      </section>
      <section className={styles.section} aria-labelledby="record-evaluations"><h2 id="record-evaluations">Evaluaciones y anamnesis</h2>
        <button type="button" onClick={onSendEvaluation}>Enviar evaluación</button>
        {data.evaluations.length === 0 ? <p>Aún no hay evaluaciones para este vínculo.</p> :
          <ul>{data.evaluations.map((item) => <li key={item.id}>{item.snapshot.name} · {item.status}
            {item.status === "completed" ? <button type="button" onClick={() => setEvaluation(item)}>Ver respuesta</button> : null}
          </li>)}</ul>}
        {data.moreEvaluations ? <button type="button" disabled={moreBusy}
          onClick={() => void loadMore("evaluations")}>Ver más evaluaciones</button> : null}
        {evaluation ? <CoachEvaluationDetail assignment={evaluation} onCloseDetail={() => setEvaluation(null)} /> : null}
      </section>
      <section className={styles.section} aria-labelledby="record-documents"><h2 id="record-documents">Documentos compartidos</h2>
        {data.documents.length === 0 ? <p>El alumno no ha compartido documentos.</p> :
          <ul>{data.documents.map((item) => <li key={item.assetId}>{item.displayName}
            <button type="button" disabled={busy} onClick={() => void openAsset(item)}>Abrir PDF</button></li>)}</ul>}
        {data.moreDocuments ? <button type="button" disabled={moreBusy}
          onClick={() => void loadMore("documents")}>Ver más documentos</button> : null}
      </section>
      <section className={styles.section} aria-labelledby="record-photos"><h2 id="record-photos">Fotos de check compartidas</h2>
        {data.photos.length === 0 ? <p>El alumno no ha compartido fotos de check.</p> :
          <ul>{data.photos.map((item) => <li key={item.assetId}>{item.checkedOn} · {item.pose}
            <button type="button" disabled={busy} onClick={() => void openAsset(item)}>Ver foto</button></li>)}</ul>}
        {data.morePhotos ? <button type="button" disabled={moreBusy}
          onClick={() => void loadMore("photos")}>Ver más fotos</button> : null}
        {photoUrl ? <div role="dialog" aria-modal="true" aria-label="Foto de check" className={styles.viewer}>
          <button type="button" onClick={closePhoto}>Cerrar foto</button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="Foto de check compartida por el alumno" />
        </div> : null}
      </section>
    </> : null}
  </main>;
}
