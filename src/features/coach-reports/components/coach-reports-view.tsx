"use client";

import { useEffect, useState } from "react";

import type { CoachReportItem } from "../data/coach-reports-repository";
import type { CoachReportsState } from "../hooks/use-coach-reports";
import styles from "./coach-reports-view.module.css";

function date(value: string) {
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Santiago" }).format(new Date(value));
}
function title(kind: "photos" | "medical_document") {
  return kind === "photos" ? "Fotos de progreso" : "Documento médico";
}
function detailLabel(item: CoachReportItem) {
  if (item.assetKind === "photo") return item.checkedOn ? `Foto · ${item.checkedOn}` : "Foto de progreso";
  return "Documento médico · PDF";
}

export function CoachReportsView({ state, onBack, onRetry, onOpen, onDownload }: {
  readonly state: CoachReportsState;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly onOpen: (reportId: string) => void;
  readonly onDownload: (item: CoachReportItem) => Promise<Blob>;
}) {
  const [preview, setPreview] = useState<{ readonly assetId: string; readonly url: string; readonly mimeType: string } | null>(null);
  const [fileIssue, setFileIssue] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function openFile(item: CoachReportItem) {
    setFileIssue(null);
    try {
      const blob = await onDownload(item);
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { assetId: item.assetId, url: URL.createObjectURL(blob), mimeType: item.mimeType };
      });
    } catch { setFileIssue("No pudimos abrir este archivo. Inténtalo nuevamente."); }
  }

  if (state.detail) {
    const detail = state.detail;
    return <section className={styles.view} aria-label="Detalle de reporte">
      <button className={styles.back} type="button" onClick={onBack}>← Reportes de alumnos</button>
      <div className={styles.heading}><h2>{title(detail.kind)}</h2><p>Recibido el {date(detail.sentAt)} · {detail.reviewedAt ? "Revisado" : "Pendiente"}</p></div>
      {detail.message ? <article className={styles.detailCard}><h3>Mensaje del alumno</h3><p>{detail.message}</p></article> : null}
      <article className={styles.detailCard}><h3>Contenido</h3><div className={styles.files}>
        {detail.items.map((item) => <div className={styles.file} key={item.assetId}>
          <div className={styles.fileCopy}><strong>{item.assetKind === "photo" ? "Foto de progreso" : "Documento médico"}</strong><span>{detailLabel(item)}</span></div>
          <button className={styles.fileButton} type="button" onClick={() => void openFile(item)}>Abrir</button>
          {preview?.assetId === item.assetId && preview.mimeType === "image/jpeg" ? <img className={styles.preview} src={preview.url} alt="Foto de progreso enviada por el alumno" /> : null}
          {preview?.assetId === item.assetId && preview.mimeType === "application/pdf" ? <a className={styles.pdf} href={preview.url} target="_blank" rel="noopener noreferrer">Abrir PDF</a> : null}
        </div>)}
      </div></article>
      {fileIssue ? <p className={styles.error} role="alert">{fileIssue}</p> : null}
    </section>;
  }

  return <section className={styles.view} aria-label="Reportes de alumnos">
    <button className={styles.back} type="button" onClick={onBack}>← Volver al panel</button>
    <div className={styles.heading}><h2>Reportes de alumnos</h2><p>Fotos de progreso y documentos médicos compartidos contigo.</p></div>
    {state.phase === "loading" ? <p className={styles.state} role="status">Cargando reportes…</p> : null}
    {state.issue ? <><p className={styles.error} role="alert">{state.issue}</p><button className={styles.retry} type="button" onClick={onRetry}>Reintentar</button></> : null}
    {state.phase === "ready" && state.reports.length === 0 ? <p className={styles.empty}>Aún no tienes reportes de alumnos.</p> : null}
    {state.reports.length > 0 ? <div className={styles.list}>{state.reports.map((report) => <button className={styles.report} type="button" key={report.id} onClick={() => onOpen(report.id)}>
      <span><span className={styles.reportName}>{report.studentName}</span><span className={styles.reportMeta}>{title(report.kind)} · {date(report.sentAt)} · {report.itemCount} {report.itemCount === 1 ? "archivo" : "archivos"}</span></span>
      <span className={`${styles.badge} ${report.reviewedAt ? styles.reviewed : ""}`}>{report.reviewedAt ? "Revisado" : "Pendiente"}</span>
    </button>)}</div> : null}
    {state.detailPhase === "loading" ? <p className={styles.state} role="status">Abriendo reporte…</p> : null}
  </section>;
}
