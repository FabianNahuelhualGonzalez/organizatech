"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getStudentProgressPhotoGateway,
  StudentProgressPhotoGatewayError,
  type StudentPhotoCheck,
  type StudentPhotoUpload,
  type StudentPublishedPhoto,
} from "../data/student-progress-photo-gateway";
import type { ProgressPhotoPose } from "../model/progress-records-contract";
import { abandonQueuedProgressPhoto, matchesSelectedProgressPhoto,
  type QueuedProgressPhoto } from "../model/progress-photo-upload-selection";
import { StudentProgressCheckSheet, type ProgressCheckSheetPhoto } from "./student-progress-check-sheet";

import styles from "./student-progress-photos.module.css";

const PAGE_SIZE = 50;
const POSES: readonly ProgressPhotoPose[] = ["frente", "perfil", "espalda"];
const PHOTO_GUIDE = [
  "Mismo lugar y misma pared de fondo, lisa y despejada.",
  "Misma luz: de frente y pareja. Evita el contraluz y la luz directa del techo.",
  "Cámara fija en vertical, a la altura de la cintura y a 2 metros. Usa trípode o apoya el teléfono. Sin zoom, filtros ni modo retrato.",
  "Misma hora y condición: idealmente en la mañana y en ayunas.",
  "Misma ropa ajustada, postura relajada y brazos a los costados.",
  "Siempre tres poses: frente, perfil y espalda.",
] as const;
const STATUS: Readonly<Record<StudentPhotoUpload["status"], string>> = {
  reservada: "Preparando subida",
  en_cola: "En cola",
  procesando: "Procesando",
  publicada: "Publicada",
  fallida: "Error",
};

function todayInChile(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(date);
}

function message(error: unknown): string {
  if (error instanceof StudentProgressPhotoGatewayError && error.code === "forbidden") return "Tu vínculo ya no permite esta acción. Vuelve a ingresar a Progreso.";
  if (error instanceof StudentProgressPhotoGatewayError && error.code === "changed") return "La foto cambió. Revisa el estado y vuelve a intentarlo.";
  return "No pudimos completar la acción. Reintenta.";
}

type DeletionTarget = { readonly assetId: string; readonly kind: "photo" | "check" };

export function StudentProgressPhotos() {
  const surfaceRef = useRef<HTMLElement>(null);
  const viewerCloseRef = useRef<HTMLButtonElement>(null);
  const deletionCancelRef = useRef<HTMLButtonElement>(null);
  const deletionPanelRef = useRef<HTMLDivElement>(null);
  const deletionReturnRef = useRef<HTMLElement | null>(null);
  const newCheckButtonRef = useRef<HTMLButtonElement>(null);
  const queuedPhotosRef = useRef<Partial<Record<ProgressPhotoPose, QueuedProgressPhoto>>>({});
  const uploadGatewayRef = useRef<ReturnType<typeof getStudentProgressPhotoGateway> | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const guideInitializedRef = useRef(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [photos, setPhotos] = useState<readonly StudentPublishedPhoto[]>([]);
  const [checks, setChecks] = useState<readonly StudentPhotoCheck[]>([]);
  const [uploads, setUploads] = useState<readonly StudentPhotoUpload[]>([]);
  const [photosMore, setPhotosMore] = useState(false);
  const [checksMore, setChecksMore] = useState(false);
  const photoPagesRef = useRef(1);
  const checkPagesRef = useRef(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [sheetStatus, setSheetStatus] = useState("");
  const [checkedOn, setCheckedOn] = useState(todayInChile);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [viewer, setViewer] = useState<{ readonly url: string; readonly assetId: string } | null>(null);
  const [viewerError, setViewerError] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<DeletionTarget | null>(null);
  const [deletionError, setDeletionError] = useState("");

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const gateway = getStudentProgressPhotoGateway();
      const [photoPages, checkPages, nextUploads] = await Promise.all([
        Promise.all(Array.from({ length: photoPagesRef.current }, (_, page) => gateway.listPhotos(PAGE_SIZE, page * PAGE_SIZE))),
        Promise.all(Array.from({ length: checkPagesRef.current }, (_, page) => gateway.listChecks(PAGE_SIZE, page * PAGE_SIZE))),
        gateway.listUploads(PAGE_SIZE),
      ]);
      const nextPhotos = photoPages.flat();
      const nextChecks = checkPages.flat();
      setPhotos(nextPhotos);
      setChecks(nextChecks);
      setUploads(nextUploads);
      if (!guideInitializedRef.current) {
        guideInitializedRef.current = true;
        setGuideOpen(nextChecks.length === 0);
      }
      setPhotosMore(photoPages.at(-1)?.length === PAGE_SIZE);
      setChecksMore(checkPages.at(-1)?.length === PAGE_SIZE);
    } catch (error) { setLoadError(message(error)); }
    finally { if (showLoading) setLoading(false); }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => { if (viewer) viewerCloseRef.current?.focus(); }, [viewer]);
  useEffect(() => {
    if (!deletionTarget) return;
    if (busy) deletionPanelRef.current?.focus();
    else deletionCancelRef.current?.focus();
  }, [deletionTarget, busy]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!uploads.some((upload) => upload.status === "reservada" || upload.status === "en_cola" || upload.status === "procesando")) return;
    const timer = window.setTimeout(() => { void load(); }, 10000);
    return () => window.clearTimeout(timer);
  }, [uploads, load]);
  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.url); }, [viewer]);
  useEffect(() => {
    if (!composerOpen) return;
    const scroll = surfaceRef.current?.closest<HTMLElement>("#student-evaluations-content");
    const previousScrollOverflow = scroll?.style.overflowY ?? "";
    const previousBodyOverflow = document.body.style.overflow;
    if (scroll) scroll.style.overflowY = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      if (scroll) scroll.style.overflowY = previousScrollOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [composerOpen]);

  function uploadGateway() {
    if (!uploadGatewayRef.current) uploadGatewayRef.current = getStudentProgressPhotoGateway();
    return uploadGatewayRef.current;
  }

  function dismissDeletion() {
    setDeletionTarget(null);
    setDeletionError("");
    window.requestAnimationFrame(() => {
      const previous = deletionReturnRef.current;
      if (previous?.isConnected) previous.focus();
      else surfaceRef.current?.focus();
    });
  }

  async function requestDeletion(assetId: string, trigger: HTMLElement | null) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const kind = await getStudentProgressPhotoGateway().getDeletionTarget(assetId);
      deletionReturnRef.current = trigger;
      setDeletionError("");
      setDeletionTarget({ assetId, kind });
    } catch (error) {
      setActionError(message(error));
      await load();
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function confirmDeletion() {
    const target = deletionTarget;
    if (!target || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDeletionError("");
    try {
      const gateway = getStudentProgressPhotoGateway();
      const result = await gateway.deletePublishedPhoto(target.assetId, target.kind === "check");
      dismissDeletion();
      await load();
      setNotice(result === "check_deleted" ? "Check eliminado" : "Foto eliminada");
      try { await gateway.cleanupOwn(); } catch { /* Exact cleanup debt remains in SQL. */ }
    } catch (error) {
      if (error instanceof StudentProgressPhotoGatewayError
        && (error.code === "changed" || error.code === "forbidden")) {
        dismissDeletion();
        await load();
        setActionError(message(error));
      } else setDeletionError(message(error));
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function cancelRecentUpload(uploadId: string, trigger: HTMLElement) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const gateway = getStudentProgressPhotoGateway();
      const status = await gateway.abandon(uploadId);
      if (status === "published") {
        const published = await gateway.getUpload(uploadId);
        if (published.assetId) {
          deletionReturnRef.current = trigger;
          setDeletionTarget({ assetId: published.assetId,
            kind: await gateway.getDeletionTarget(published.assetId) });
        }
        await load();
      } else {
        await load();
        setNotice("Carga cancelada");
        try { await gateway.cleanupOwn(); } catch { /* Tracked for retry. */ }
      }
    } catch (error) {
      await load();
      setActionError(message(error));
    } finally { busyRef.current = false; setBusy(false); }
  }

  function finishCheckSheet() {
    setComposerOpen(false);
    setSheetError("");
    setSheetStatus("");
    queuedPhotosRef.current = {};
    uploadGatewayRef.current = null;
    window.requestAnimationFrame(() => newCheckButtonRef.current?.focus());
  }

  async function abandonQueuedPose(pose: ProgressPhotoPose) {
    const queued = queuedPhotosRef.current[pose];
    if (!queued) return;
    await abandonQueuedProgressPhoto(queued, async (uploadId) => {
      const gateway = uploadGateway();
      const status = await gateway.abandon(uploadId);
      if (status === "published") {
        const published = await gateway.getUpload(uploadId);
        if (published.assetId) {
          deletionReturnRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement : null;
          setDeletionTarget({ assetId: published.assetId,
            kind: await gateway.getDeletionTarget(published.assetId) });
          throw new StudentProgressPhotoGatewayError("changed");
        }
      }
    });
    delete queuedPhotosRef.current[pose];
  }

  async function changeSlot(pose: ProgressPhotoPose): Promise<boolean> {
    if (busyRef.current) return false;
    if (!queuedPhotosRef.current[pose]) return true;
    busyRef.current = true;
    setBusy(true);
    try {
      await abandonQueuedPose(pose);
      // The SQL row tracks cleanup even if this best-effort pass is unavailable.
      try { await uploadGateway().cleanupOwn(); } catch { /* Retryable cleanup debt. */ }
      setSheetError("");
      return true;
    } catch (error) {
      setSheetError(message(error));
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function discardCheckSheet() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      for (const pose of POSES) await abandonQueuedPose(pose);
      try { await uploadGateway().cleanupOwn(); } catch { /* Retryable cleanup debt. */ }
      finishCheckSheet();
    } catch (error) { setSheetError(message(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function saveNewCheck(sheetPhotos: readonly ProgressCheckSheetPhoto[]) {
    if (busyRef.current || sheetPhotos.length < 1 || sheetPhotos.length > 3) return;
    busyRef.current = true;
    setBusy(true);
    setSheetError("");
    let failureMessage = "No pudimos guardar el check. Reintenta sin volver a elegir las fotos.";
    try {
      const gateway = uploadGateway();
      let publicationNeeded = false;
      let uploadFailure: unknown = null;
      let uploadFailureMessage = failureMessage;
      for (const [index, photo] of sheetPhotos.entries()) {
        try {
          let pending = queuedPhotosRef.current[photo.pose];
          if (pending && !matchesSelectedProgressPhoto(pending, photo.pose, photo.selected)) {
            await abandonQueuedPose(photo.pose);
            pending = undefined;
            try { await gateway.cleanupOwn(); } catch { /* Tracked by SQL. */ }
          }
          if (pending) {
            const observed = await gateway.getUpload(pending.reservation.uploadId);
            if (observed.status === "fallida") {
              await abandonQueuedPose(photo.pose);
              pending = undefined;
              try { await gateway.cleanupOwn(); } catch { /* Tracked by SQL. */ }
            } else if (observed.status === "publicada") {
              queuedPhotosRef.current[photo.pose] = { ...pending, enqueued: true };
              publicationNeeded = true;
              continue;
            } else if (observed.status === "en_cola" || observed.status === "procesando") {
              queuedPhotosRef.current[photo.pose] = { ...pending, enqueued: true };
              publicationNeeded = true;
              continue;
            }
          }
          setSheetStatus(`Subiendo foto ${index + 1} de ${sheetPhotos.length}…`);
          if (!pending) {
            failureMessage = "No pudimos reservar la foto. Reintenta sin volver a elegirla.";
            pending = { reservation: await gateway.reserve(photo.pose, photo.selected.format),
              pose: photo.pose, file: photo.selected.file, format: photo.selected.format,
              staged: false, enqueued: false };
            queuedPhotosRef.current[photo.pose] = pending;
          }
          if (!pending.staged) {
            failureMessage = "No pudimos subir la foto a la zona privada. Reintenta sin volver a elegirla.";
            try {
              await gateway.stage(pending.reservation.uploadId, photo.selected.file);
              pending = { ...pending, staged: true };
            } catch (stageError) {
              // Storage may accept the bytes before its response is lost.
              try {
                await gateway.enqueue(pending.reservation.uploadId);
                pending = { ...pending, staged: true, enqueued: true };
              } catch { throw stageError; }
            }
            queuedPhotosRef.current[photo.pose] = pending;
          }
          if (!pending.enqueued) {
            failureMessage = "No pudimos poner la foto en cola. Reintenta sin volver a elegirla.";
            try { await gateway.enqueue(pending.reservation.uploadId); }
            catch (enqueueError) {
              const observed = await gateway.getUpload(pending.reservation.uploadId);
              if (observed.status !== "en_cola" && observed.status !== "procesando"
                && observed.status !== "publicada") throw enqueueError;
            }
            pending = { ...pending, enqueued: true };
            queuedPhotosRef.current[photo.pose] = pending;
          }
          publicationNeeded = true;
        } catch (error) {
          uploadFailure = error;
          uploadFailureMessage = failureMessage;
          break;
        }
      }
      // One server request per save action, regardless of the number of selected photos.
      if (publicationNeeded) {
        failureMessage = "No pudimos procesar las fotos ahora. Reintenta sin volver a elegirlas.";
        setSheetStatus("Procesando fotos…");
        try { await gateway.publishOwnBatch(); }
        catch (error) { if (!uploadFailure) throw error; }
      }
      if (uploadFailure) {
        failureMessage = uploadFailureMessage;
        throw uploadFailure;
      }
      await load();
      const uploadIds = sheetPhotos.map((photo) => queuedPhotosRef.current[photo.pose]?.reservation.uploadId);
      if (uploadIds.some((id) => !id)) throw new Error("progress_photo_missing_reservation");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        failureMessage = "No pudimos confirmar la publicación. Reintenta el guardado en esta hoja.";
        const matching = await Promise.all(uploadIds.map((id) => gateway.getUpload(id!)));
        if (matching.some((upload) => upload.status === "fallida")) {
          for (const photo of sheetPhotos) {
            const queued = queuedPhotosRef.current[photo.pose];
            if (matching.some((upload) => upload.uploadId === queued?.reservation.uploadId
              && upload.status === "fallida")) await abandonQueuedPose(photo.pose);
          }
          try { await gateway.cleanupOwn(); } catch { /* Tracked by SQL. */ }
          failureMessage = "No pudimos publicar una foto. Reintenta sin volver a elegirla.";
          throw new Error("progress_photo_publication_failed");
        }
        const publishedAssetIds = matching.map((upload) => upload.status === "publicada" ? upload.assetId : null);
        if (publishedAssetIds.every((assetId): assetId is string => typeof assetId === "string")) {
          setSheetStatus("Creando check…");
          failureMessage = "No pudimos crear el check. Reintenta sin volver a elegir las fotos.";
          await gateway.createCheck(checkedOn, publishedAssetIds);
          setNotice("Check guardado");
          setGuideOpen(false);
          finishCheckSheet();
          await load();
          return;
        }
        setSheetStatus(matching.some((upload) => upload.status === "procesando")
          ? "Procesando fotos…" : "Fotos en cola…");
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
      failureMessage = "Las fotos siguen en proceso. Reintenta el guardado en esta hoja.";
      throw new Error("progress_photo_publication_pending");
    } catch (error) {
      setSheetStatus("");
      setSheetError(error instanceof StudentProgressPhotoGatewayError && error.code === "forbidden"
        ? message(error) : failureMessage);
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function loadMore(kind: "photos" | "checks") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const gateway = getStudentProgressPhotoGateway();
      if (kind === "photos") {
        const next = await gateway.listPhotos(PAGE_SIZE, photoPagesRef.current * PAGE_SIZE);
        setPhotos((current) => [...current, ...next]);
        setPhotosMore(next.length === PAGE_SIZE);
        photoPagesRef.current += 1;
      } else {
        const next = await gateway.listChecks(PAGE_SIZE, checkPagesRef.current * PAGE_SIZE);
        setChecks((current) => [...current, ...next]);
        setChecksMore(next.length === PAGE_SIZE);
        checkPagesRef.current += 1;
      }
    } catch (error) { setActionError(message(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function openPhoto(assetId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const blob = await getStudentProgressPhotoGateway().downloadOwnPhoto(assetId);
      setViewer({ url: URL.createObjectURL(blob), assetId });
      setViewerError(false);
    } catch (error) { setActionError(message(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function handleViewerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      closeViewer();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
    if (controls.length === 0) return;
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault();
      controls[0].focus();
    }
  }

  function handleDeletionKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) dismissDeletion();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (controls.length === 0) {
      event.preventDefault();
      deletionPanelRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault();
      controls[0].focus();
    }
  }

  function closeViewer() {
    setViewer(null);
    window.requestAnimationFrame(() => surfaceRef.current?.focus());
  }

  const noContent = checks.length === 0 && uploads.length === 0 && photos.length === 0;
  const newCheckButton = <button ref={newCheckButtonRef} className={styles.newCheckButton} type="button" aria-expanded={composerOpen} onClick={() => { setCheckedOn(todayInChile()); setSheetError(""); setSheetStatus(""); setComposerOpen(true); }}>+ Nuevo check</button>;
  const privacyNote = <p className={styles.privacy}><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg><span>Tus fotos son privadas. Solo tú puedes verlas aquí.</span></p>;
  return (
    <section ref={surfaceRef} tabIndex={-1} className={styles.surface} aria-label="Fotos de progreso">
      <div className={styles.guide}>
        <button className={styles.guideToggle} type="button" aria-expanded={guideOpen} onClick={() => setGuideOpen((current) => !current)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
          <strong>Cómo tomar tus fotos</strong>
          <svg className={guideOpen ? styles.guideChevronOpen : styles.guideChevron} aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {guideOpen ? <ol>{PHOTO_GUIDE.map((tip, index) => <li key={tip}><span aria-hidden="true">{index + 1}</span><span>{tip}</span></li>)}</ol> : null}
      </div>
      {loading ? <p className={styles.state} role="status">Cargando tus fotos…</p> : null}
      {!loading && loadError ? <div className={styles.state} role="alert"><p>{loadError}</p><button className={styles.secondary} type="button" onClick={() => void load(true)}>Reintentar</button></div> : null}
      {!loading && !loadError ? <>
        {noContent ? <div className={styles.emptyState}>
          <span className={styles.emptyCamera}><svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg></span>
          <strong>Aún no tienes fotos de progreso</strong>
          <p>Crea tu primer check con tus 3 poses: frente, perfil y espalda.</p>
          {newCheckButton}
          <div className={styles.emptyPrivacy}>{privacyNote}</div>
        </div> : <>{newCheckButton}{privacyNote}</>}
        {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
        {checks.length > 0 ? <section className={styles.historySection} aria-label="Mis checks">
          <h4>Mis checks</h4>
          <div className={styles.group}>{checks.map((check) => <article className={styles.check} key={check.id}>
            <div className={styles.checkHeading}><div><strong>Check · {check.checkedOn.split("-").reverse().join("/")}</strong><span>{check.photos.length} {check.photos.length === 1 ? "foto" : "fotos"}</span></div><span className={styles.privateBadge}>Solo tú</span></div>
            <div className={styles.checkGrid}>{POSES.map((pose) => {
              const photo = check.photos.find((item) => item.pose === pose);
              return photo
                ? <div className={styles.checkPhotoSlot} key={pose}>
                  <PrivateCheckPhoto assetId={photo.assetId} pose={pose} onOpen={() => void openPhoto(photo.assetId)} />
                  <button className={styles.deletePhotoButton} type="button" disabled={busy}
                    aria-label={`Eliminar foto de ${pose}`}
                    onClick={(event) => { void requestDeletion(photo.assetId, event.currentTarget); }}>Eliminar</button>
                </div>
                : <div className={styles.missingTile} key={pose}><span>Falta</span><span className={styles.poseLabel}>{pose}</span></div>;
            })}</div>
          </article>)}
          {checksMore ? <button className={styles.secondary} type="button" disabled={busy} onClick={() => void loadMore("checks")}>Ver más checks</button> : null}</div>
        </section> : null}
        {uploads.length > 0 ? <section className={styles.historySection} aria-label="Cargas recientes"><h4>Cargas recientes</h4><div className={styles.group}>{uploads.map((item) => <div className={styles.row} key={item.uploadId}><span>{dateLabel(item.createdAt)} · {item.pose}</span><div className={styles.actions}><strong>{STATUS[item.status]}</strong>{item.status === "reservada" || item.status === "en_cola" || item.status === "procesando"
          ? <button className={styles.secondary} type="button" disabled={busy} onClick={(event) => { void cancelRecentUpload(item.uploadId, event.currentTarget); }}>Cancelar carga</button> : null}</div></div>)}</div></section> : null}
        {photos.length > 0 ? <section className={styles.historySection} aria-label="Mis fotos"><h4>Mis fotos</h4><div className={styles.group}>{photos.map((photo) => <div className={styles.row} key={photo.assetId}><div><strong>{photo.pose ?? "Foto"}</strong><span>{dateLabel(photo.availableAt)}</span></div><div className={styles.actions}><button className={styles.secondary} type="button" disabled={busy} onClick={() => void openPhoto(photo.assetId)}>Abrir</button><button className={styles.secondary} type="button" disabled={busy} onClick={(event) => { void requestDeletion(photo.assetId, event.currentTarget); }}>Eliminar</button></div></div>)}{photosMore ? <button className={styles.secondary} type="button" disabled={busy} onClick={() => void loadMore("photos")}>Ver más fotos</button> : null}</div></section> : null}
      </> : null}
      {notice ? <p className={styles.toast} role="status">{notice}</p> : null}
      {viewer ? <div className={styles.viewer} role="dialog" aria-modal="true" aria-label="Foto de progreso" onKeyDown={handleViewerKeyDown}>
        <div className={styles.viewerPanel}>
          <button ref={viewerCloseRef} className={styles.secondary} type="button" onClick={closeViewer}>Cerrar foto</button>
          {viewerError ? <p>Tu navegador no pudo mostrar esta foto.</p> : (
            // El archivo privado se obtiene como Blob; next/image no optimiza URLs locales blob:.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewer.url} alt="Foto de progreso propia" onError={() => setViewerError(true)} />
          )}
        </div>
      </div> : null}
      {composerOpen ? <StudentProgressCheckSheet checkedOn={checkedOn} saving={busy} status={sheetStatus} error={sheetError} onClose={() => { void discardCheckSheet(); }} onSlotChange={changeSlot} onSave={(sheetPhotos) => { void saveNewCheck(sheetPhotos); }} /> : null}
      {deletionTarget ? <div className={styles.deletionOverlay} role="dialog" aria-modal="true"
        aria-labelledby="progress-photo-deletion-title" aria-describedby="progress-photo-deletion-description"
        onKeyDown={handleDeletionKeyDown}>
        <div ref={deletionPanelRef} className={styles.deletionPanel} tabIndex={-1} aria-busy={busy}>
          <h4 id="progress-photo-deletion-title">Confirmar eliminación</h4>
          <p id="progress-photo-deletion-description">{deletionTarget.kind === "check"
            ? "¿Seguro que quieres eliminar este check?"
            : "¿Seguro que quieres eliminar esta foto?"}</p>
          {deletionError ? <p className={styles.error} role="alert">{deletionError}</p> : null}
          <div className={styles.deletionActions}>
            <button ref={deletionCancelRef} className={styles.secondary} type="button" disabled={busy}
              onClick={dismissDeletion}>Cancelar</button>
            <button className={styles.deletionConfirm} type="button" disabled={busy}
              onClick={() => { void confirmDeletion(); }}>{busy ? "Eliminando…"
                : deletionTarget.kind === "check" ? "Eliminar check" : "Eliminar foto"}</button>
          </div>
        </div>
      </div> : null}
    </section>
  );
}

function PrivateCheckPhoto({ assetId, pose, onOpen }: {
  readonly assetId: string;
  readonly pose: ProgressPhotoPose;
  readonly onOpen: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    async function loadThumbnail() {
      try {
        const blob = await getStudentProgressPhotoGateway().downloadOwnPhoto(assetId);
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch { if (active) setFailed(true); }
    }
    const element = buttonRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      void loadThumbnail();
      return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void loadThumbnail();
      }
    });
    observer.observe(element);
    return () => { active = false; observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId]);

  return <button ref={buttonRef} className={styles.checkTile} type="button" aria-label={`Abrir foto de ${pose}`} onClick={onOpen}>
    {url && !failed ? (
      // La miniatura privada proviene de un Blob autorizado por el gateway.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" onError={() => setFailed(true)} />
    ) : <span className={styles.checkTileState}>{failed ? "Vista no disponible" : "Cargando foto…"}</span>}
    <span className={styles.poseLabel}>{pose}</span>
  </button>;
}
