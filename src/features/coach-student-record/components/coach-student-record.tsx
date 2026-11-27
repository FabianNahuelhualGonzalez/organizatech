"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CoachEvaluationDetail } from "@/features/evaluations/components/coach-evaluations";
import { listOwnCoachStudentEvaluations } from "@/features/evaluations/data/evaluations-repository";
import type { CoachEvaluationAssignment } from "@/features/evaluations/model/evaluation-types";
import { closeOwnCoachStudentCycleForReplacement, getOwnCoachStudentTrainingCycle,
  listOwnCoachStudentTrainingCycles } from
  "@/features/training-cycle-builder/data/coach-student-training-gateway";
import type { TrainingCycleListCursor, TrainingCycleListItem, TrainingCycleRpcSnapshot } from
  "@/features/training-cycle-builder/data/training-cycle-rpc-types";
import { AppBackButton } from "@/ui/navigation/app-back-button";
import { ConfirmDialog } from "@/ui/modals/confirm-dialog";
import { CoachCycleBuilder } from "./coach-cycle-builder";
import { getCoachStudentRecordGateway, type CoachStudentRecordSubject,
  type SharedStudentDocument, type SharedStudentPhoto } from "../data/coach-student-record-gateway";

import styles from "./coach-student-record.module.css";
import { CoachCycleDetail } from "./coach-cycle-detail";
import { CoachStudentAvatar, SharedPhotoThumbnail } from "./coach-student-images";

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

const date = (v: string) => v.slice(0, 10).split("-").reverse().join("-");

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
  const [builderOpen, setBuilderOpen] = useState(false);
  const [confirmNewCycle, setConfirmNewCycle] = useState(false);
  const [closingCycle, setClosingCycle] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [previousCycle, setPreviousCycle] = useState<TrainingCycleRpcSnapshot | null>(null);
  const closeRequestRef = useRef<string | null>(null);
  const builderOpenRef = useRef(false);
  builderOpenRef.current = builderOpen || confirmNewCycle;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const [photoLabel, setPhotoLabel] = useState("");
  const overlayTriggerRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async (preserveView = false) => {
    const generation = ++loadGenerationRef.current;
    setError("");
    if (!preserveView) {
      setData(null); setCycle(null); setActiveCycle(null); setEvaluation(null);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null; setPhotoUrl(null);
    }
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
        setCycle((selected) => preserveView && selected && cycles.items.some((item) => item.cycleId === selected.cycleId)
          ? selected.cycleId === activeCycle?.cycleId ? activeCycle : selected : activeCycle);
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
    const onFocus = () => { if (!builderOpenRef.current) void load(true); };
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
        photoUrlRef.current = url; setPhotoLabel(`${asset.pose} · ${date(asset.checkedOn)}`); setPhotoUrl(url);
      }
    } catch { if (currentRef.current && generation === loadGenerationRef.current) {
      setError("El archivo ya no está disponible o su permiso cambió."); } }
    finally { setBusy(false); }
  }

  function closePhoto() {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null; setPhotoUrl(null);
    window.requestAnimationFrame(() => overlayTriggerRef.current?.focus());
  }

  function closeEvaluation() {
    setEvaluation(null);
    window.requestAnimationFrame(() => overlayTriggerRef.current?.focus());
  }

  function keepFocus(event: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    if (!buttons.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function confirmCycleReplacement() {
    if (!activeCycle || closingCycle) return;
    setClosingCycle(true); setCloseError("");
    closeRequestRef.current ??= crypto.randomUUID();
    try {
      await closeOwnCoachStudentCycleForReplacement({ expectedCoachId: coachId,
        episodeId, requestId: closeRequestRef.current,
        cycleId: activeCycle.cycleId, expectedVersion: activeCycle.version });
      setPreviousCycle(activeCycle);
      setConfirmNewCycle(false);
      loadGenerationRef.current += 1;
      setBuilderOpen(true);
      closeRequestRef.current = null;
    } catch {
      setCloseError("No pudimos confirmar el cierre. Reintenta o vuelve a cargar la ficha para comprobar el estado actual.");
    } finally { setClosingCycle(false); }
  }

  if (builderOpen && data) return <CoachCycleBuilder coachId={coachId}
    episodeId={episodeId} studentName={data.subject.studentName}
    previousCycle={previousCycle} onExit={() => { setBuilderOpen(false); void load(); }}
    onViewCycle={(cycleId) => {
      setBuilderOpen(false);
      void load().then(() => getOwnCoachStudentTrainingCycle(coachId, episodeId, cycleId))
        .then((selected) => { if (currentRef.current) setCycle(selected); })
        .catch(() => setError("El ciclo fue guardado. Actualiza la ficha para revisar sus datos."));
    }} />;

  const active = data?.cycles.find((item) => item.status !== "closed");
  const answered = data?.evaluations.filter((item) => item.status === "completed").length ?? 0;
  const initials = data?.subject.studentName.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0] ?? "").join("").toUpperCase();
  return <main className={styles.record}>
    <div className={styles.wrap}>
      <div className={styles.backRow}><AppBackButton onBack={onBack} label="Volver al alumno" /></div>
      <h1>Ficha del alumno</h1>
      {error ? <div role="alert" className={styles.alert}>{error}<button type="button" className={styles.button}
        onClick={() => void load()}>Reintentar</button></div> : null}
      {!data && !error ? <p role="status">Cargando ficha…</p> : null}
      {data ? <>
        <header className={styles.profile}>
          <div className={styles.who}><CoachStudentAvatar coachId={coachId} episodeId={episodeId}
            subject={data.subject} initials={initials ?? ""} /><div>
            <h2>{data.subject.studentName}</h2><p>{data.subject.studentEmail}</p>
            <span className={`${styles.chip} ${styles.ok}`}>Activo</span></div></div>
          <div className={styles.stats}>
            <a href="#record-training" className={styles.stat}><span>CICLO VIGENTE</span><b>{active ? `Ciclo ${active.cycleNumber}` : "—"}</b><em>{active ? `hasta ${date(active.endDate)}` : "Sin ciclo"}</em></a>
            <a href="#record-evaluations" className={styles.stat}><span>RESPUESTAS</span><b>{answered} de {data.evaluations.length}</b><em>{data.evaluations.length - answered} pendientes</em></a>
            <a href="#record-documents" className={styles.stat}><span>DOCUMENTOS</span><b>{data.documents.length}</b><em>compartidos</em></a>
            <a href="#record-photos" className={styles.stat}><span>FOTOS DE CHECK</span><b>{data.photos.length}</b><em>compartidas</em></a>
          </div>
        </header>
        <nav className={styles.secnav} aria-label="Secciones de la ficha">
          <a href="#record-training">Entrenamiento</a><a href="#record-evaluations">Respuestas</a>
          <a href="#record-documents">Documentos</a><a href="#record-photos">Fotos</a>
        </nav>
        <section className={styles.card} id="record-training" aria-labelledby="record-training-title">
          <div className={styles.cardHead}><div><h2 id="record-training-title">Entrenamiento</h2>
            <p>Historial de ciclos y registros del alumno</p></div>
            <div className={styles.newCycle}><button className={`${styles.button} ${styles.primary}`} type="button" onClick={() => {
              if (activeCycle) { setCloseError(""); setConfirmNewCycle(true); }
              else { setPreviousCycle(null); loadGenerationRef.current += 1; setBuilderOpen(true); }
            }}>{activeCycle ? "Crear o modificar rutina en un ciclo nuevo" : "Crear ciclo y rutina para el alumno"}</button>
            {activeCycle ? <p>Antes de crear el nuevo ciclo confirmaremos el cierre del actual. Sus resultados quedarán en el historial.</p> : null}</div>
          </div>
          <div className={styles.train}>
            <div className={styles.cycles}><h3>CICLOS DE ENTRENAMIENTO</h3>
              {data.cycles.length === 0 ? <div className={styles.empty}>Aún no tiene ciclos de entrenamiento.</div> :
                <ul className={styles.cycleList}>{data.cycles.map((item) => <li key={item.cycleId}>
                  <button type="button" className={styles.cycleButton} aria-current={cycle?.cycleId === item.cycleId}
                    disabled={busy} onClick={() => void openCycle(item)}>
                    <span><b>Ciclo {item.cycleNumber}</b><span className={`${styles.chip} ${item.status === "closed" ? styles.muted : styles.accent}`}>
                      {item.status === "closed" ? "Cerrado" : "Vigente"}</span></span>
                    <small>{date(item.startDate)} → {date(item.endDate)}</small></button>
                </li>)}</ul>}
              {data.cycleCursor ? <button className={styles.button} type="button" disabled={moreBusy}
                onClick={() => void loadMore("cycles")}>Ver más ciclos</button> : null}
            </div>
            {cycle ? <CoachCycleDetail key={cycle.cycleId} coachId={coachId} episodeId={episodeId} cycle={cycle} />
              : <div className={styles.empty}>Selecciona un ciclo para revisar su plan y entrenamientos.</div>}
          </div>
        </section>
        {confirmNewCycle && activeCycle ? <ConfirmDialog
          ariaLabel="Confirmar nuevo ciclo de entrenamiento"
          title="¿Estás seguro de que quieres crear un ciclo de entrenamiento nuevo?"
          cancelLabel="No" confirmLabel="Sí" confirmBusyLabel="Finalizando…"
          cancelVariant="primary" confirmVariant="danger"
          onCancel={() => { setConfirmNewCycle(false); closeRequestRef.current = null;
            if (closeError) void load(); }}
          onConfirm={() => void confirmCycleReplacement()} isBusy={closingCycle}>
          <p>El ciclo actual de {data.subject.studentName} se dará por finalizado.
            Sus sesiones y resultados quedarán guardados en el historial.
            Después podrás crear la nueva rutina.</p>
          {closeError ? <p role="alert">{closeError}</p> : null}
        </ConfirmDialog> : null}
        <div className={styles.lower}>
          <section className={styles.card} id="record-evaluations" aria-labelledby="record-evaluations-title">
            <div className={styles.cardHead}><div><h2 id="record-evaluations-title">Respuestas y anamnesis <small>{data.evaluations.length}</small></h2>
              <p>Formularios enviados al alumno</p></div><button type="button" className={styles.button} onClick={onSendEvaluation}>Enviar evaluación</button></div>
            {data.evaluations.length === 0 ? <div className={styles.empty}>Aún no le envías evaluaciones.</div> :
              <ul className={styles.rows}>{data.evaluations.map((item) => <li className={styles.row} key={item.id}>
                <span className={styles.rowIcon} aria-hidden>✓</span><div className={styles.rowMain}><strong>{item.snapshot.name}</strong>
                  <small><span className={`${styles.chip} ${item.status === "completed" ? styles.ok : styles.pending}`}>
                    {item.status === "completed" ? "Respondida" : item.status === "expired" ? "Vencida" : "Pendiente"}</span>
                    {date(item.completedAt ?? item.sentAt)}</small></div>
                {item.status === "completed" ? <button className={styles.button} type="button"
                  onClick={(event) => { overlayTriggerRef.current = event.currentTarget; setEvaluation(item); }}>Ver respuesta</button> : null}</li>)}</ul>}
            {data.moreEvaluations ? <button className={styles.button} type="button" disabled={moreBusy}
              onClick={() => void loadMore("evaluations")}>Ver más evaluaciones</button> : null}
            {evaluation ? <div role="presentation" className={styles.viewer} onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeEvaluation(); }}
              onKeyDown={(event) => keepFocus(event, closeEvaluation)}>
              <div role="dialog" aria-modal="true" aria-label={`Respuesta · ${evaluation.snapshot.name}`}
                className={styles.viewerSheet}><header><h2>{evaluation.snapshot.name}</h2>
                  <button type="button" className={styles.close} aria-label="Cerrar respuesta" autoFocus
                    onClick={closeEvaluation}>×</button></header><div className={styles.viewerBody}>
                  <CoachEvaluationDetail assignment={evaluation} onCloseDetail={closeEvaluation} /></div></div>
            </div> : null}
          </section>
          <section className={styles.card} id="record-documents" aria-labelledby="record-documents-title">
            <div className={styles.cardHead}><h2 id="record-documents-title">Documentos <small>{data.documents.length}</small></h2></div>
            {data.documents.length === 0 ? <div className={styles.empty}>El alumno aún no comparte documentos.</div> :
              <ul className={styles.rows}>{data.documents.map((item) => <li className={styles.row} key={item.assetId}>
                <span className={styles.rowIcon} aria-hidden>PDF</span><div className={styles.rowMain}>
                  <strong>{item.displayName}</strong><small>{date(item.availableAt)} · {new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(item.bytes / 1048576)} MB</small></div>
                <button className={styles.button} type="button" disabled={busy} onClick={() => void openAsset(item)}>Abrir</button></li>)}</ul>}
            {data.moreDocuments ? <button className={styles.button} type="button" disabled={moreBusy}
              onClick={() => void loadMore("documents")}>Ver más documentos</button> : null}
          </section>
          <section className={styles.card} id="record-photos" aria-labelledby="record-photos-title">
            <div className={styles.cardHead}><h2 id="record-photos-title">Fotos de check <small>{data.photos.length}</small></h2></div>
            {data.photos.length === 0 ? <div className={styles.empty}>El alumno aún no comparte fotos de check.</div> :
              <div className={styles.photos}>{data.photos.map((item) => <button className={styles.photo}
                key={item.assetId} type="button" disabled={busy} onClick={(event) => {
                  overlayTriggerRef.current = event.currentTarget; void openAsset(item); }}
                aria-label={`Ver foto ${item.pose} del ${date(item.checkedOn)}`}>
                <SharedPhotoThumbnail coachId={coachId} episodeId={episodeId} photo={item} />
                <span>{date(item.checkedOn)} · {item.pose}</span></button>)}</div>}
            {data.morePhotos ? <button className={styles.button} type="button" disabled={moreBusy}
              onClick={() => void loadMore("photos")}>Ver más fotos</button> : null}
            {photoUrl ? <div role="dialog" aria-modal="true" aria-label={`Foto de check · ${photoLabel}`} className={styles.viewer}
              onMouseDown={(event) => { if (event.target === event.currentTarget) closePhoto(); }}
              onKeyDown={(event) => keepFocus(event, closePhoto)}>
              <div className={styles.viewerSheet}><header><h2>Foto · {photoLabel}</h2>
                <button type="button" className={styles.close} onClick={closePhoto} autoFocus aria-label="Cerrar foto">×</button></header>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt={`Foto de check ${photoLabel}`} /></div>
            </div> : null}
          </section>
        </div>
      </> : null}
    </div>
  </main>;
}
