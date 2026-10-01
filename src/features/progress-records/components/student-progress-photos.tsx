"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getStudentProgressPhotoGateway,
  StudentProgressPhotoGatewayError,
  type StudentPhotoCheck,
  type StudentPhotoUpload,
  type StudentPublishedPhoto,
} from "../data/student-progress-photo-gateway";
import { prepareLocalProgressPhoto } from "../model/prepare-local-progress-photo";
import type { ProgressPhotoPose } from "../model/progress-records-contract";

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
type Draft = { readonly id: number; readonly file: File; readonly pose: ProgressPhotoPose; readonly status: "seleccionada" | "preparación" | "subida" | "error" };

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
  return "No pudimos completar la acción. Reintenta.";
}

export function StudentProgressPhotos() {
  const surfaceRef = useRef<HTMLElement>(null);
  const viewerCloseRef = useRef<HTMLButtonElement>(null);
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
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [checkedOn, setCheckedOn] = useState(todayInChile);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [viewer, setViewer] = useState<{ readonly url: string; readonly assetId: string } | null>(null);
  const [viewerError, setViewerError] = useState(false);

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
      setSelected((current) => current.filter((id) => nextPhotos.some((photo) => photo.assetId === id && photo.checkId === null)));
    } catch (error) { setLoadError(message(error)); }
    finally { if (showLoading) setLoading(false); }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => { if (viewer) viewerCloseRef.current?.focus(); }, [viewer]);
  useEffect(() => {
    if (!uploads.some((upload) => upload.status === "reservada" || upload.status === "en_cola" || upload.status === "procesando")) return;
    const timer = window.setTimeout(() => { void load(); }, 10000);
    return () => window.clearTimeout(timer);
  }, [uploads, load]);
  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.url); }, [viewer]);

  function setDraftStatus(id: number, status: Draft["status"]) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, status } : draft));
  }

  function chooseFiles(files: FileList | null) {
    setActionError("");
    if (!files?.length) return;
    if (files.length > 3) { setActionError("Selecciona entre 1 y 3 fotos."); return; }
    setDrafts(Array.from(files, (file, index) => ({ id: index, file, pose: POSES[index], status: "seleccionada" as const })));
  }

  async function upload() {
    if (busyRef.current || drafts.length < 1 || drafts.length > 3) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      const gateway = getStudentProgressPhotoGateway();
      for (const draft of drafts) {
        if (draft.status !== "seleccionada" && draft.status !== "error") continue;
        try {
          setDraftStatus(draft.id, "preparación");
          const prepared = await prepareLocalProgressPhoto(draft.file);
          const reservation = await gateway.reserve(draft.pose, "jpeg");
          setDraftStatus(draft.id, "subida");
          await gateway.stage(reservation.uploadId, prepared.blob);
          await gateway.enqueue(reservation.uploadId);
          setDrafts((current) => current.filter((item) => item.id !== draft.id));
        } catch (error) {
          setDraftStatus(draft.id, "error");
          setActionError(error instanceof StudentProgressPhotoGatewayError ? message(error) : "No pudimos preparar esta imagen. Prueba con una foto que tu navegador pueda abrir.");
        }
      }
      await load();
    } catch (error) { setActionError(message(error)); }
    finally { busyRef.current = false; setBusy(false); }
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

  async function createCheck() {
    if (busyRef.current || !checkedOn || checkedOn > todayInChile() || selected.length < 1 || selected.length > 3) return;
    const chosen = selected.map((id) => photos.find((photo) => photo.assetId === id));
    if (chosen.some((photo) => !photo || photo.checkId !== null || !photo.pose) || new Set(chosen.map((photo) => photo?.pose)).size !== chosen.length) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    try {
      await getStudentProgressPhotoGateway().createCheck(checkedOn, [...selected]);
      setSelected([]);
      setNotice("Check creado.");
      setComposerOpen(false);
      setGuideOpen(false);
      await load();
    } catch (error) { setActionError(message(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function togglePhoto(photo: StudentPublishedPhoto) {
    if (!photo.pose || photo.checkId !== null) return;
    setActionError("");
    if (selected.includes(photo.assetId)) {
      setSelected(selected.filter((id) => id !== photo.assetId));
      return;
    }
    if (selected.length >= 3 || selected.some((id) => photos.find((item) => item.assetId === id)?.pose === photo.pose)) {
      setActionError("Elige hasta 3 fotos con poses distintas.");
      return;
    }
    setSelected([...selected, photo.assetId]);
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

  function closeViewer() {
    setViewer(null);
    window.requestAnimationFrame(() => surfaceRef.current?.focus());
  }

  const available = photos.filter((photo) => photo.checkId === null && photo.pose !== null);
  const noContent = checks.length === 0 && uploads.length === 0 && photos.length === 0;
  const newCheckButton = <button className={styles.newCheckButton} type="button" aria-expanded={composerOpen} onClick={() => setComposerOpen((current) => !current)}>+ Nuevo check</button>;
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
        {composerOpen ? <div className={styles.card}>
          <h4>Nueva carga</h4>
          <p>Selecciona de 1 a 3 fotos. Las prepararemos antes de subirlas.</p>
          <label className={styles.fileLabel}>Elegir fotos<input type="file" accept="image/*" multiple disabled={busy} onChange={(event) => { chooseFiles(event.target.files); event.target.value = ""; }} /></label>
          {drafts.map((draft) => <div className={styles.draft} key={draft.id}><span className={styles.fileName}>{draft.file.name}</span><label>Pose<select value={draft.pose} disabled={busy} onChange={(event) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, pose: event.target.value as ProgressPhotoPose } : item))}>{POSES.map((pose) => <option value={pose} key={pose}>{pose}</option>)}</select></label><span role="status">{draft.status === "seleccionada" ? "Lista" : draft.status === "preparación" ? "Preparación" : draft.status === "subida" ? "Subida" : "Error"}</span></div>)}
          {drafts.length > 0 ? <button className={styles.primary} type="button" disabled={busy} onClick={() => void upload()}>{drafts.some((draft) => draft.status === "error") ? "Reintentar carga" : "Subir fotos"}</button> : null}
        </div> : null}
        {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {checks.length > 0 ? <section className={styles.historySection} aria-label="Checks">
          <h4>Checks</h4>
          <div className={styles.group}>{checks.map((check) => <article className={styles.check} key={check.id}>
            <div className={styles.checkHeading}><div><strong>Check · {check.checkedOn.split("-").reverse().join("/")}</strong><span>{check.photos.length} {check.photos.length === 1 ? "foto" : "fotos"}</span></div><span className={styles.privateBadge}>Solo tú</span></div>
            <div className={styles.checkGrid}>{check.photos.map((photo) => <PrivateCheckPhoto key={photo.assetId} assetId={photo.assetId} pose={photo.pose} onOpen={() => void openPhoto(photo.assetId)} />)}</div>
          </article>)}
          {checksMore ? <button className={styles.secondary} type="button" disabled={busy} onClick={() => void loadMore("checks")}>Ver más checks</button> : null}</div>
        </section> : null}
        {uploads.length > 0 ? <section className={styles.historySection} aria-label="Cargas recientes"><h4>Cargas recientes</h4><div className={styles.group}>{uploads.map((item) => <div className={styles.row} key={item.uploadId}><span>{dateLabel(item.createdAt)} · {item.pose}</span><strong>{STATUS[item.status]}</strong></div>)}</div></section> : null}
        {photos.length > 0 ? <section className={styles.historySection} aria-label="Mis fotos"><h4>Mis fotos</h4><div className={styles.group}>{photos.map((photo) => <div className={styles.row} key={photo.assetId}><div><strong>{photo.pose ?? "Foto"}</strong><span>{dateLabel(photo.availableAt)}</span></div><div className={styles.actions}><button className={styles.secondary} type="button" disabled={busy} onClick={() => void openPhoto(photo.assetId)}>Abrir</button>{photo.checkId === null && photo.pose ? <label className={styles.select}><input type="checkbox" checked={selected.includes(photo.assetId)} disabled={busy} onChange={() => togglePhoto(photo)} />Check</label> : null}</div></div>)}{photosMore ? <button className={styles.secondary} type="button" disabled={busy} onClick={() => void loadMore("photos")}>Ver más fotos</button> : null}</div></section> : null}
        {composerOpen && available.length > 0 ? <div className={styles.card}><h4>Crear check</h4><p>Elige de 1 a 3 fotos publicadas con poses distintas.</p><label className={styles.dateLabel}>Fecha<input type="date" value={checkedOn} max={todayInChile()} onChange={(event) => setCheckedOn(event.target.value)} /></label><button className={styles.primary} type="button" disabled={busy || selected.length === 0 || !checkedOn || checkedOn > todayInChile()} onClick={() => void createCheck()}>Crear check ({selected.length})</button></div> : null}
      </> : null}
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
