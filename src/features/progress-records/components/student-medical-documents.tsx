"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getStudentMedicalDocumentGateway,
  MEDICAL_DOCUMENT_MAX_BYTES,
  StudentMedicalDocumentGatewayError,
  type MedicalDocumentAsset,
} from "../data/student-medical-document-gateway";

import styles from "./student-medical-documents.module.css";

const PAGE_SIZE = 50;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

function formatSize(bytes: number): string {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MiB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Santiago" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof StudentMedicalDocumentGatewayError && error.code === "forbidden"
    ? "Tu vínculo ya no permite esta acción. Vuelve a ingresar a Evaluaciones."
    : "No pudimos completar la acción. Reintenta.";
}

export function StudentMedicalDocuments() {
  const [documents, setDocuments] = useState<readonly MedicalDocumentAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const stagedUploadRef = useRef<{ readonly file: File; readonly uploadId: string } | null>(null);
  const [viewer, setViewer] = useState<{ readonly url: string; readonly name: string } | null>(null);
  const viewerCloseRef = useRef<HTMLButtonElement>(null);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getStudentMedicalDocumentGateway().list(PAGE_SIZE);
      setDocuments(next);
      setHasMore(next.length === PAGE_SIZE);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.url); }, [viewer]);
  useEffect(() => { if (viewer) viewerCloseRef.current?.focus(); }, [viewer]);
  useEffect(() => { if (sheetOpen) sheetCloseRef.current?.focus(); }, [sheetOpen]);

  function closeSheet() {
    setSheetOpen(false);
    setFile(null);
    window.requestAnimationFrame(() => uploadButtonRef.current?.focus());
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>, close: () => void) {
    if (event.key === "Escape") { close(); return; }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]"));
    if (controls.length === 0) return;
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault();
      controls[0].focus();
    }
  }

  async function loadMore() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await getStudentMedicalDocumentGateway().list(PAGE_SIZE, documents.length);
      setDocuments((current) => [...current, ...next]);
      setHasMore(next.length === PAGE_SIZE);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function saveDocument() {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")
        || file.size < 1 || file.size > MEDICAL_DOCUMENT_MAX_BYTES
        || PDF_SIGNATURE.some((byte, index) => signature[index] !== byte)) {
        setError("Elige un PDF válido de hasta 25 MiB.");
        return;
      }
      const gateway = getStudentMedicalDocumentGateway();
      let uploadId = stagedUploadRef.current?.file === file ? stagedUploadRef.current.uploadId : null;
      if (!uploadId) {
        const reservation = await gateway.reserve();
        await gateway.stage(reservation.uploadId, file);
        uploadId = reservation.uploadId;
        stagedUploadRef.current = { file, uploadId };
      }
      await gateway.enqueue(uploadId);
      stagedUploadRef.current = null;
      setFile(null);
      closeSheet();
      setNotice("Documento recibido. Aparecerá en tu lista cuando esté disponible.");
      await load();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function openDocument(asset: MedicalDocumentAsset) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const blob = await getStudentMedicalDocumentGateway().downloadOwn(asset.assetId);
      setViewer({ url: URL.createObjectURL(blob), name: asset.displayName });
    } catch (caught) { setError(errorMessage(caught)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <section className={styles.documents} aria-label="Mis documentos">
      <button ref={uploadButtonRef} className={styles.uploadButton} type="button" onClick={() => { setError(""); setSheetOpen(true); }}>
        <span aria-hidden="true">↑</span> Subir documento
      </button>
      <p className={styles.fileHint}>PDF · máx. 25 MiB por archivo</p>
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error && !sheetOpen ? <p className={styles.error} role="alert">{error}</p> : null}
      {loading ? <div className={styles.state} role="status">Cargando tus documentos…</div> : null}
      {!loading && error && documents.length === 0 ? <button className={styles.retry} type="button" onClick={() => void load()}>Reintentar</button> : null}
      {!loading && !error && documents.length === 0 ? <div className={styles.state}>Aún no tienes documentos.</div> : null}
      <div className={styles.list}>
        {documents.map((asset) => <article className={styles.documentCard} key={asset.assetId}>
          <span className={styles.extension}>PDF</span>
          <div className={styles.documentCopy}>
            <strong title={asset.displayName}>{asset.displayName}</strong>
            <span>Otro · {formatSize(asset.bytes)} · {formatDate(asset.availableAt)}</span>
            <span className={styles.privateBadge}>Solo tú</span>
          </div>
          <button className={styles.openButton} type="button" disabled={busy} onClick={() => void openDocument(asset)}>Abrir</button>
        </article>)}
      </div>
      {hasMore ? <button className={styles.retry} type="button" disabled={busy} onClick={() => void loadMore()}>Ver más documentos</button> : null}

      {sheetOpen ? <div className={styles.overlay}>
        <button className={styles.scrim} type="button" aria-label="Cerrar carga" disabled={busy} onClick={closeSheet} />
        <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Subir documento" onKeyDown={(event) => handleDialogKeyDown(event, () => { if (!busy) closeSheet(); })}>
          <div className={styles.sheetHeader}><h3>Subir documento</h3><button ref={sheetCloseRef} className={styles.closeButton} type="button" aria-label="Cerrar" disabled={busy} onClick={closeSheet}>×</button></div>
          <label className={styles.filePicker}>
            <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); stagedUploadRef.current = null; setError(""); event.target.value = ""; }} />
            <span>{file ? "Cambiar PDF" : "Elegir archivo"}</span>
            <small>PDF · máx. 25 MiB</small>
          </label>
          {file ? <div className={styles.selectedFile}><span className={styles.extension}>PDF</span><div><strong>{file.name}</strong><span>{formatSize(file.size)}</span></div></div> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          <button className={styles.saveButton} type="button" disabled={!file || busy} onClick={() => void saveDocument()}>{busy ? "Guardando…" : "Guardar solo para mí"}</button>
        </div>
      </div> : null}

      {viewer ? <div className={styles.overlay}>
        <div className={styles.scrim} />
        <div className={styles.viewer} role="dialog" aria-modal="true" aria-label="Documento privado" onKeyDown={(event) => handleDialogKeyDown(event, () => setViewer(null))}>
          <button ref={viewerCloseRef} className={styles.closeButton} type="button" aria-label="Cerrar" onClick={() => setViewer(null)}>×</button>
          <span className={styles.extension}>PDF</span>
          <strong>{viewer.name}</strong>
          <a className={styles.openLink} href={viewer.url} target="_blank" rel="noopener noreferrer">Abrir PDF</a>
        </div>
      </div> : null}
    </section>
  );
}
