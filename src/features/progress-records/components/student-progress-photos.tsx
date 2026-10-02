"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getStudentProgressPhotoGateway,
  StudentProgressPhotoGatewayError,
  type StudentPhotoCheck,
  type StudentPhotoUpload,
  type StudentPublishedPhoto,
  type StudentPhotoShareStatus,
  type StudentProgressCoachAccess,
} from "../data/student-progress-photo-gateway";
import type { ProgressPhotoPose } from "../model/progress-records-contract";
import { selectProgressPhoto } from "../model/select-progress-photo";
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
const MONTHS = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const UPLOAD_ERROR = "No se pudo subir la foto. Revisa tu conexión.";
const SUCCESS_RETURN_LABEL = "Volver a mis fotos";

function todayInChile(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function checkDate(value: string): string { return value.split("-").reverse().join("/"); }
function sentDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}`;
}
type TileUpload = { readonly state: "uploading" | "error"; readonly progress: number; readonly previewUrl?: string };

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
  const [shareStatuses, setShareStatuses] = useState<readonly StudentPhotoShareStatus[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [coachAccess, setCoachAccess] = useState<StudentProgressCoachAccess | null>(null);
  const [coachAvailability, setCoachAvailability] = useState<"loading" | "linked" | "unlinked">("loading");
  const [sendSheetOpen, setSendSheetOpen] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const reportRequestIdRef = useRef<string | null>(null);
  const reportIdRef = useRef<string | null>(null);
  const pendingReportRef = useRef<{ readonly ids: readonly string[]; readonly message: string } | null>(null);
  const [sentResult, setSentResult] = useState<{ count: number; coach: StudentProgressCoachAccess } | null>(null);
  const [tileUploads, setTileUploads] = useState<Record<string, TileUpload>>({});
  const tilePendingRef = useRef<Record<string, QueuedProgressPhoto>>({});
  const tileRetryFilesRef = useRef<Record<string, File>>({});
  const tilePreviewRef = useRef<Record<string, string>>({});
  const [sheetUploads, setSheetUploads] = useState<Partial<Record<ProgressPhotoPose, TileUpload>>>({});
  const [uploads, setUploads] = useState<readonly StudentPhotoUpload[]>([]);
  const [_photosMore, setPhotosMore] = useState(false);
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
      try {
        setCoachAccess(await gateway.getCoachAccess());
        setCoachAvailability("linked");
      } catch (error) {
        if (!(error instanceof StudentProgressPhotoGatewayError) || error.code !== "forbidden") throw error;
        setCoachAccess(null);
        setCoachAvailability("unlinked");
      }
      const nextPhotos = photoPages.flat();
      const nextChecks = checkPages.flat();
      const sharePages = await Promise.all(checkPages.map((page) => {
        const assetIds = page.flatMap((check) => check.photos.map((photo) => photo.assetId));
        return gateway.listPhotoReportStatuses(assetIds);
      }));
      const nextShares = sharePages.flat();
      setPhotos(nextPhotos);
      setChecks(nextChecks);
      setUploads(nextUploads);
      setShareStatuses(nextShares);
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
  useEffect(() => () => { Object.values(tilePreviewRef.current).forEach((url) => URL.revokeObjectURL(url)); }, []);
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

  async function _cancelRecentUpload(uploadId: string, trigger: HTMLElement) {
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
    setSheetUploads({});
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
      setSheetUploads((current) => ({ ...current, [pose]: undefined }));
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
            setSheetUploads((current) => ({ ...current, [photo.pose]: { state: "uploading", progress: 0 } }));
            try {
              await gateway.stage(pending.reservation.uploadId, photo.selected.file, (progress) => {
                setSheetUploads((current) => ({ ...current, [photo.pose]: { state: "uploading", progress } }));
              });
              pending = { ...pending, staged: true };
            } catch (stageError) {
              // Storage may accept the bytes before its response is lost.
              try {
                await gateway.enqueue(pending.reservation.uploadId);
                pending = { ...pending, staged: true, enqueued: true };
              } catch {
                setSheetUploads((current) => ({ ...current, [photo.pose]: { state: "error", progress: 0 } }));
                setActionError(UPLOAD_ERROR);
                throw stageError;
              }
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
          setSheetUploads((current) => ({ ...current, [photo.pose]: undefined }));
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
          setNotice("Check guardado · solo tú puedes verlo");
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

  async function addPoseToCheck(checkId: string, pose: ProgressPhotoPose, file: File | null) {
    if (!file || busyRef.current) return;
    const key = `${checkId}:${pose}`;
    let selected: ReturnType<typeof selectProgressPhoto>;
    try { selected = selectProgressPhoto(file); }
    catch { setActionError("Formato no admitido o foto superior a 20 MB. Usa JPG, PNG o WebP."); return; }
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    tileRetryFilesRef.current[key] = file;
    if (tilePendingRef.current[key]?.file !== file && tilePreviewRef.current[key]) {
      URL.revokeObjectURL(tilePreviewRef.current[key]);
      delete tilePreviewRef.current[key];
    }
    if (!tilePreviewRef.current[key]) {
      try { tilePreviewRef.current[key] = URL.createObjectURL(file); } catch { /* Preview is optional. */ }
    }
    setTileUploads((current) => ({ ...current, [key]: { state: "uploading", progress: 0,
      previewUrl: tilePreviewRef.current[key] } }));
    try {
      const gateway = uploadGateway();
      let pending: QueuedProgressPhoto | undefined = tilePendingRef.current[key];
      if (pending && !matchesSelectedProgressPhoto(pending, pose, selected)) {
        await gateway.abandon(pending.reservation.uploadId);
        pending = undefined;
        delete tilePendingRef.current[key];
      }
      if (!pending) {
        pending = { reservation: await gateway.reserve(pose, selected.format),
          pose, file, format: selected.format, staged: false, enqueued: false };
        tilePendingRef.current[key] = pending;
      }
      if (!pending.staged) {
        try {
          await gateway.stage(pending.reservation.uploadId, file, (progress) => {
            setTileUploads((current) => ({ ...current, [key]: { state: "uploading", progress,
              previewUrl: tilePreviewRef.current[key] } }));
          });
          pending = { ...pending, staged: true };
        } catch (stageError) {
          try {
            await gateway.enqueue(pending.reservation.uploadId);
            pending = { ...pending, staged: true, enqueued: true };
          } catch { throw stageError; }
        }
        tilePendingRef.current[key] = pending;
      }
      if (!pending.enqueued) {
        await gateway.enqueue(pending.reservation.uploadId);
        pending = { ...pending, enqueued: true };
        tilePendingRef.current[key] = pending;
      }
      await gateway.publishOwnBatch();
      let assetId: string | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const observed = await gateway.getUpload(pending.reservation.uploadId);
        if (observed.status === "fallida") {
          await gateway.abandon(pending.reservation.uploadId);
          delete tilePendingRef.current[key];
          throw new Error("progress_photo_publication_failed");
        }
        if (observed.status === "publicada" && observed.assetId) { assetId = observed.assetId; break; }
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
      if (!assetId) throw new Error("progress_photo_publication_pending");
      await gateway.attachPhotoToCheck(checkId, assetId);
      delete tilePendingRef.current[key];
      delete tileRetryFilesRef.current[key];
      if (tilePreviewRef.current[key]) URL.revokeObjectURL(tilePreviewRef.current[key]);
      delete tilePreviewRef.current[key];
      setTileUploads((current) => { const next = { ...current }; delete next[key]; return next; });
      await load();
      setNotice(`${pose.charAt(0).toUpperCase()}${pose.slice(1)} agregada al check`);
    } catch {
      setTileUploads((current) => ({ ...current, [key]: { state: "error", progress: 0,
        previewUrl: tilePreviewRef.current[key] } }));
      setActionError(UPLOAD_ERROR);
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function startSelection() {
    if (busyRef.current) return;
    setActionError("");
    try {
      const access = await getStudentProgressPhotoGateway().getCoachAccess();
      setCoachAccess(access);
      setSelectedIds(pendingReportRef.current?.ids ?? []);
      setReportMessage(pendingReportRef.current?.message ?? "");
      setSelecting(true);
    } catch (error) { setActionError(message(error)); }
  }

  function cancelSelection() {
    setSelecting(false);
    setSelectedIds([]);
    setSendSheetOpen(false);
    setConfirmSendOpen(false);
    setReportMessage("");
    if (!pendingReportRef.current) {
      reportRequestIdRef.current = null;
      reportIdRef.current = null;
    }
  }

  function toggleSelected(assetId: string) {
    if (pendingReportRef.current) return;
    setSelectedIds((current) => current.includes(assetId)
      ? current.filter((id) => id !== assetId) : [...current, assetId]);
  }

  function toggleAll(check: StudentPhotoCheck) {
    if (pendingReportRef.current) return;
    const ids = check.photos.map((photo) => photo.assetId);
    setSelectedIds((current) => ids.every((id) => current.includes(id))
      ? current.filter((id) => !ids.includes(id))
      : [...current, ...ids.filter((id) => !current.includes(id))]);
  }

  async function sendReport() {
    if (sendingRef.current || !coachAccess || selectedIds.length === 0) return;
    sendingRef.current = true;
    setSending(true);
    setActionError("");
    try {
      const gateway = getStudentProgressPhotoGateway();
      if (!pendingReportRef.current) pendingReportRef.current = { ids: [...selectedIds], message: reportMessage };
      const requestId = reportRequestIdRef.current ?? crypto.randomUUID();
      reportRequestIdRef.current = requestId;
      const reportId = reportIdRef.current ?? await gateway.createPhotoReport(selectedIds, reportMessage, requestId,
        coachAccess.relationshipEpisodeId);
      reportIdRef.current = reportId;
      await gateway.drainOwnReportEmail();
      const delivery = await gateway.getPhotoReportDeliveryStatus(reportId);
      if (delivery.emailStatus !== "sent" || !delivery.notificationAccepted) {
        throw new Error("progress_report_delivery_pending");
      }
      const count = selectedIds.length;
      const coach = { ...coachAccess, coachName: delivery.coachName, coachEmail: delivery.coachEmail };
      setConfirmSendOpen(false);
      setSendSheetOpen(false);
      setSentResult({ count, coach });
      pendingReportRef.current = null;
      cancelSelection();
      await load();
    } catch {
      setConfirmSendOpen(false);
      setActionError("No se pudo enviar. Revisa tu conexión e intenta nuevamente.");
    } finally { sendingRef.current = false; setSending(false); }
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
        const nextShares = await gateway.listPhotoReportStatuses(next.flatMap((check) =>
          check.photos.map((photo) => photo.assetId)));
        setChecks((current) => [...current, ...next]);
        setShareStatuses((current) => [...current, ...nextShares]);
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
  const newCheckButton = <button ref={newCheckButtonRef} className={styles.newCheckButton} type="button" aria-expanded={composerOpen} onClick={() => { setCheckedOn(todayInChile()); setSheetError(""); setSheetStatus(""); setSheetUploads({}); setComposerOpen(true); }}>+ Nuevo check</button>;
  const privacyNote = <p className={styles.privacy}><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg><span>Tus fotos son privadas. Tu coach solo verá las que tú decidas enviarle.</span></p>;
  const selectedPhotos = selectedIds.flatMap((id) => checks.flatMap((check) => check.photos.filter((photo) => photo.assetId === id).map((photo) => ({ ...photo, checkedOn: check.checkedOn }))));
  const selectedDates = [...new Set(selectedPhotos.map((photo) => checkDate(photo.checkedOn)))];
  const selectedSummary = `${selectedIds.length} ${selectedIds.length === 1 ? "foto" : "fotos"} · Check ${selectedDates.join(" y ")}${reportMessage.trim() ? " · con mensaje" : ""}`;
  return (
    <section ref={surfaceRef} tabIndex={-1} className={styles.surface} aria-label="Fotos de progreso">
      {sentResult ? <div className={styles.sentSuccess}>
        <span className={styles.sentIcon} aria-hidden="true">✓</span>
        <strong>Envío exitoso</strong>
        <p>Tu reporte con {sentResult.count} {sentResult.count === 1 ? "foto fue enviado" : "fotos fue enviado"} a {sentResult.coach.coachName}.</p>
        <p>Le avisamos a tu coach por correo ({sentResult.coach.coachEmail}) y en sus notificaciones de Organizatech.</p>
        <button className={styles.newCheckButton} type="button" onClick={() => setSentResult(null)}>{SUCCESS_RETURN_LABEL}</button>
      </div> : <>
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
          </div> : selecting ? <div className={styles.selectBanner}>Toca las fotos que quieres enviar a tu coach. El número indica el orden en que las verá.</div>
            : <><div className={styles.photoActions}>{newCheckButton}<button className={styles.sendAction} type="button" disabled={coachAvailability !== "linked" || !checks.some((check) => check.photos.length > 0)} onClick={() => void startSelection()}>Enviar reporte al coach</button></div>{coachAvailability === "unlinked" ? <p className={styles.coachLinkHint}>Vincúlate con un coach para enviar un reporte.</p> : null}{privacyNote}</>}
          {checks.length > 0 ? <section className={styles.historySection} aria-label="Mis checks">
            <div className={styles.checksTitle}><h4>Mis checks</h4><span>{checks.length} {checks.length === 1 ? "check" : "checks"}</span></div>
            <div className={styles.group}>{checks.map((check, index) => {
              const month = check.checkedOn.slice(0, 7);
              const previousMonth = checks[index - 1]?.checkedOn.slice(0, 7);
              const sentPhotos = check.photos.flatMap((photo) => shareStatuses.filter((share) => share.assetId === photo.assetId));
              const latestSent = sentPhotos.sort((left, right) => right.sentAt.localeCompare(left.sentAt))[0];
              const allSelected = check.photos.length > 0 && check.photos.every((photo) => selectedIds.includes(photo.assetId));
              return <div className={styles.monthGroup} key={check.id}>
                {month !== previousMonth ? <div className={styles.monthHeading}>{MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</div> : null}
                <article className={styles.check}>
                  <div className={styles.checkHeading}><div><strong>{checkDate(check.checkedOn)}</strong><span className={check.photos.length < 3 ? styles.poseCountPending : styles.poseCount}>{check.photos.length} de 3 poses</span></div>
                    {selecting ? <button className={styles.selectAll} type="button" onClick={() => toggleAll(check)}>{allSelected ? "Quitar todo" : "Elegir todo"}</button>
                      : <span className={latestSent ? styles.sentBadge : styles.privateBadge}>{latestSent ? `Enviado a ${latestSent.coachName} · ${sentDate(latestSent.sentAt)}` : "Solo tú"}</span>}
                  </div>
                  <div className={styles.checkGrid}>{POSES.map((pose) => {
                    const photo = check.photos.find((item) => item.pose === pose);
                    const uploadKey = `${check.id}:${pose}`;
                    const upload = tileUploads[uploadKey];
                    const selectedOrder = photo ? selectedIds.indexOf(photo.assetId) + 1 : 0;
                    return <div className={styles.checkPhotoSlot} key={pose}>
                      {photo ? <PrivateCheckPhoto assetId={photo.assetId} pose={pose} selectedOrder={selecting ? selectedOrder : undefined} onOpen={() => selecting ? toggleSelected(photo.assetId) : void openPhoto(photo.assetId)} />
                        : selecting ? <div className={styles.missingTile} aria-disabled="true" />
                        : upload?.state === "error" ? <div className={styles.uploadRetryTile}><span>No se subió</span><button className={styles.retryUpload} type="button" disabled={busy} onClick={() => { void addPoseToCheck(check.id, pose, tileRetryFilesRef.current[uploadKey] ?? null); }}>Reintentar</button></div>
                        : <label className={styles.missingTile} aria-label={`Agregar ${pose}`}><input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void addPoseToCheck(check.id, pose, event.target.files?.[0] ?? null); event.target.value = ""; }} />{upload?.previewUrl ? (
                          // Local preview remains private and is released after attachment.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={styles.uploadDimmed} src={upload.previewUrl} alt="" />
                        ) : <span>+</span>}{upload?.state === "uploading" ? <span className={styles.uploadProgress} style={{ width: `${upload.progress}%` }} /> : null}</label>}
                      <span className={`${styles.tilePoseLabel} ${photo ? styles.tilePosePresent : ""}`}>{pose.charAt(0).toUpperCase()}{pose.slice(1)}</span>
                      {photo && !selecting ? <button className={styles.deletePhotoButton} type="button" disabled={busy} aria-label={`Eliminar foto de ${pose}`} onClick={(event) => { void requestDeletion(photo.assetId, event.currentTarget); }}>Eliminar</button> : null}
                    </div>;
                  })}</div>
                </article>
              </div>;
            })}
            {checksMore ? <button className={styles.secondary} type="button" disabled={busy} onClick={() => void loadMore("checks")}>Ver más checks</button> : null}</div>
          </section> : null}
        </> : null}
        {selecting ? <div className={styles.selectBar}><button className={styles.secondary} type="button" onClick={cancelSelection}>Cancelar</button><button className={styles.newCheckButton} type="button" disabled={selectedIds.length === 0} onClick={() => setSendSheetOpen(true)}>{selectedIds.length ? `Continuar (${selectedIds.length})` : "Selecciona fotos"}</button></div> : null}
      </>}
      {notice ? <p className={styles.toast} role="status">{notice}</p> : null}
      {actionError ? <p className={styles.errorToast} role="alert">{actionError}</p> : null}
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
      {composerOpen ? <StudentProgressCheckSheet checkedOn={checkedOn} saving={busy} status={sheetStatus} error={sheetError} uploadStates={sheetUploads} onClose={() => { void discardCheckSheet(); }} onInvalidFile={() => setActionError("Formato no admitido o foto superior a 20 MB. Usa JPG, PNG o WebP.")} onSlotChange={changeSlot} onSave={(sheetPhotos) => { void saveNewCheck(sheetPhotos); }} /> : null}
      {sendSheetOpen && coachAccess ? <div className={styles.sheetOverlay}>
        <button className={styles.sheetScrim} type="button" aria-label="Cerrar envío" disabled={sending} onClick={() => setSendSheetOpen(false)} />
        <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Enviar reporte al coach">
          <div className={styles.sheetHandle}><span /></div>
          <div className={styles.sheetHeader}><h3>Enviar reporte al coach</h3><button className={styles.sheetClose} type="button" aria-label="Cerrar" disabled={sending} onClick={() => setSendSheetOpen(false)}>×</button></div>
          <div className={styles.sheetBody}>
            <div className={styles.reportThumbs}>{selectedPhotos.map((photo) => <PrivateReportThumbnail key={photo.assetId} assetId={photo.assetId} pose={photo.pose} />)}</div>
            <p className={styles.reportSummary}>{selectedIds.length} {selectedIds.length === 1 ? "foto" : "fotos"} · {selectedDates.join(" y ")}</p>
            <div className={styles.coachCard}><span className={styles.coachInitials}>{coachAccess.coachName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><span>PARA</span><strong>{coachAccess.coachName}</strong><span>{coachAccess.coachEmail}</span></div></div>
            <label className={styles.reportMessageLabel}>Mensaje para tu coach (opcional)<textarea value={reportMessage} maxLength={2000} disabled={sending || Boolean(pendingReportRef.current)} onChange={(event) => setReportMessage(event.target.value)} placeholder="Ej: Esta semana cumplí todos los entrenamientos…" /></label>
            <p className={styles.reportNote}>Tu coach recibirá las fotos en calidad original. Solo él podrá verlas.</p>
          </div>
          <div className={styles.sheetFooter}><button className={styles.sheetSave} type="button" disabled={sending} onClick={() => setConfirmSendOpen(true)}>Enviar reporte</button></div>
        </div>
      </div> : null}
      {confirmSendOpen && coachAccess ? <div className={styles.confirmOverlay}>
        <button className={styles.confirmScrim} type="button" aria-label="Cancelar confirmación" disabled={sending} onClick={() => setConfirmSendOpen(false)} />
        <div className={styles.confirmPanel} role="alertdialog" aria-modal="true" aria-labelledby="progress-report-confirm-title">
          <h3 id="progress-report-confirm-title">¿Estás seguro de que quieres enviar tu reporte al coach?</h3>
          <div className={styles.coachCard}><span className={styles.coachInitials}>{coachAccess.coachName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><strong>{coachAccess.coachName}</strong><span>{coachAccess.coachEmail}</span></div></div>
          <p>{selectedSummary}</p>
          <button className={styles.newCheckButton} type="button" disabled={sending} onClick={() => void sendReport()}>{sending ? "Enviando…" : "Sí, enviar"}</button>
          <button className={styles.secondary} type="button" disabled={sending} onClick={() => setConfirmSendOpen(false)}>Cancelar</button>
        </div>
      </div> : null}
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

function PrivateCheckPhoto({ assetId, pose, onOpen, selectedOrder }: {
  readonly assetId: string;
  readonly pose: ProgressPhotoPose;
  readonly onOpen: () => void;
  readonly selectedOrder?: number;
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

  return <button ref={buttonRef} className={`${styles.checkTile} ${selectedOrder && selectedOrder > 0 ? styles.checkTileSelected : ""}`} type="button" aria-label={selectedOrder === undefined ? `Abrir foto de ${pose}` : `Seleccionar foto de ${pose}`} onClick={onOpen}>
    {url && !failed ? (
      // La miniatura privada proviene de un Blob autorizado por el gateway.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" onError={() => setFailed(true)} />
    ) : <span className={styles.checkTileState}>{failed ? "Vista no disponible" : "Cargando foto…"}</span>}
    {selectedOrder !== undefined ? <span className={`${styles.selectCircle} ${selectedOrder > 0 ? styles.selectCircleActive : ""}`}>{selectedOrder > 0 ? selectedOrder : ""}</span> : null}
  </button>;
}

function PrivateReportThumbnail({ assetId, pose }: { readonly assetId: string; readonly pose: ProgressPhotoPose }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void getStudentProgressPhotoGateway().downloadOwnPhoto(assetId).then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assetId]);
  return <div className={styles.reportThumbnail}>
    {url ? (
      // Blob is returned only after private ownership validation.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" />
    ) : null}
    <span>{pose}</span>
  </div>;
}
