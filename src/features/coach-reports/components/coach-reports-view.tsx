"use client";
// Private photos use authorized Blob URLs, which Next Image cannot optimize.
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Search, X } from "lucide-react";
import { AppBackButton } from "@/ui/navigation/app-back-button";
import type { CoachReportFilters, CoachReportItem, CoachReportSummary } from "../data/coach-reports-repository";
import type { CoachReportsState } from "../hooks/use-coach-reports";
import styles from "./coach-reports-view.module.css";

type Status = "pending" | "reviewed" | "all";
type Kind = "photos" | "medical_document" | null;
const DATE = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Santiago" });
const TIME = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" });
const CIVIL = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Santiago" });
function date(value: string) { return DATE.format(new Date(value)); }
function day(value: string) { const p = Object.fromEntries(CIVIL.formatToParts(new Date(value)).map((part) => [part.type, part.value])); return Date.UTC(+p.year, +p.month - 1, +p.day); }
function age(value: string, now: string) { return Math.round((day(now) - day(value)) / 86400000); }
function group(value: string, now: string) { const n = age(value, now); return n === 0 ? "HOY" : n === 1 ? "AYER" : n < 7 && n > 1 ? "ESTA SEMANA" : new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "America/Santiago" }).format(new Date(value)).toUpperCase(); }
function relative(value: string, now: string) { const n = age(value, now); return n === 0 ? "hoy " + TIME.format(new Date(value)) : n === 1 ? "ayer " + TIME.format(new Date(value)) : n < 7 && n > 1 ? "hace " + n + " días" : date(value); }
function title(kind: "photos" | "medical_document") { return kind === "photos" ? "Fotos de progreso" : "Documento médico"; }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function usePhotoUrls(items: readonly CoachReportItem[], download: (item: CoachReportItem) => Promise<Blob>) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true; const created: string[] = [];
    setUrls({});
    for (const item of items) if (item.assetKind === "photo") void download(item).then((blob) => {
      if (!active) return;
      const url = URL.createObjectURL(blob); created.push(url);
      setUrls((current) => ({ ...current, [item.assetId]: url }));
    }).catch(() => {});
    return () => { active = false; created.forEach((url) => URL.revokeObjectURL(url)); };
  }, [items, download]);
  return urls;
}
function ReportRow({ report, now, selected, onOpen }: { report: CoachReportSummary; now: string; selected: boolean; onOpen: () => void }) {
  return <button className={styles.report + (!report.reviewedAt ? " " + styles.pendingRow : "")} type="button" aria-current={selected ? "true" : undefined} onClick={onOpen}>
    <span className={styles.avatar}>{initials(report.studentName)}{!report.reviewedAt && <i />}</span>
    <span className={styles.reportName}>{report.studentName}</span><span className={styles.reportDate}>{relative(report.sentAt, now)}</span>
    <span className={styles.reportMeta}>{report.kind === "photos" ? <ImageIcon size={14} /> : <FileText size={14} />}
      <span>{title(report.kind)} · <span className={report.itemCount ? "" : styles.zero}>{report.itemCount
        ? report.itemCount + " " + (report.kind === "photos" ? (report.itemCount === 1 ? "foto" : "fotos") : (report.itemCount === 1 ? "archivo" : "archivos"))
        : "Sin archivos"}</span></span></span>
    <span className={styles.reportStatus}><span className={styles.chip + " " + (report.reviewedAt ? styles.muted : styles.warn)}>{report.reviewedAt ? "Revisado" : "Pendiente"}</span></span>
  </button>;
}
export function CoachReportsView({ state, onBack, onCloseDetail, onRetry, onOpen, onReview, onFilter, onLoadMore, onStudentRecord, onDownload }: {
  readonly state: CoachReportsState; readonly onBack: () => void; readonly onCloseDetail: () => void;
  readonly onRetry: () => void; readonly onOpen: (id: string) => void; readonly onReview: (reviewed: boolean) => Promise<boolean>;
  readonly onFilter: (filters: CoachReportFilters) => void; readonly onLoadMore: () => void;
  readonly onStudentRecord: (episodeId: string) => void; readonly onDownload: (item: CoachReportItem) => Promise<Blob>;
}) {
  const [status, setStatus] = useState<Status>("pending"), [kind, setKind] = useState<Kind>(null);
  const [query, setQuery] = useState(""), [tab, setTab] = useState<"report" | "compare">("report");
  const [pose, setPose] = useState<string | null>(null), [viewer, setViewer] = useState<number | null>(null);
  const [wide, setWide] = useState(false), [pinned, setPinned] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | null>(null), [toast, setToast] = useState("");
  const [now] = useState(() => new Date().toISOString());
  const root = useRef<HTMLElement>(null), photoTrigger = useRef<HTMLButtonElement>(null);
  const closeViewer = useRef<HTMLButtonElement>(null);
  const detailBack = useRef<HTMLDivElement>(null), automaticOpen = useRef<string | null>(null);
  const returning = useRef<string | null>(null);
  const detail = state.detail;
  const detailId = detail?.id;
  const photos = useMemo(() => detail?.items.filter((item) => item.assetKind === "photo") ?? [], [detail]);
  const earlier = useMemo(() => state.previous?.items.filter((item) => item.assetKind === "photo") ?? [], [state.previous]);
  const urls = usePhotoUrls(photos, onDownload), oldUrls = usePhotoUrls(earlier, onDownload);
  const common = [...new Set(photos.map((item) => item.pose).filter((p): p is string => !!p))].filter((p) => earlier.some((item) => item.pose === p));
  const chosenPose = pose && common.includes(pose) ? pose : common[0];
  const filtered = useMemo(() => state.reports.filter((report) =>
    (status === "all" || (status === "pending" ? !report.reviewedAt || report.id === pinned : !!report.reviewedAt))
    && (!kind || report.kind === kind) && report.studentName.toLocaleLowerCase("es-CL").includes(query.trim().toLocaleLowerCase("es-CL"))),
  [state.reports, status, pinned, kind, query]);
  const groups = new Map<string, CoachReportSummary[]>();
  for (const report of filtered) { const label = group(report.sentAt, now); groups.set(label, [...(groups.get(label) ?? []), report]); }
  useEffect(() => { if (!root.current) return; const observer = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) >= 760)); observer.observe(root.current); return () => observer.disconnect(); }, []);
  useEffect(() => { automaticOpen.current = null; }, [status, kind, query]);
  useEffect(() => {
    const id = filtered[0]?.id;
    if (wide && !detail && state.phase === "ready" && state.detailPhase !== "loading" && id && automaticOpen.current !== id) {
      automaticOpen.current = id;
      onOpen(id);
    }
  }, [wide, detail, state.phase, state.detailPhase, filtered, onOpen]);
  useEffect(() => { setTab("report"); setViewer(null); }, [detailId]);
  useEffect(() => { if (detailId && !wide) detailBack.current?.querySelector("button")?.focus(); }, [detailId, wide]);
  useEffect(() => { if (!detail && returning.current) { root.current?.querySelector<HTMLButtonElement>('[data-report-id="' + returning.current + '"] button')?.focus(); returning.current = null; } }, [detail]);
  useEffect(() => {
    if (viewer === null) return;
    closeViewer.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setViewer(null); photoTrigger.current?.focus(); }
      if (event.key === "ArrowLeft") setViewer((n) => n === null ? null : Math.max(0, n - 1));
      if (event.key === "ArrowRight") setViewer((n) => n === null ? null : Math.min(photos.length - 1, n + 1)); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [viewer, photos.length]);
  function open(id: string) { returning.current = id; onOpen(id); }
  async function setReviewed() {
    if (!detail || state.saving) return;
    const next = !detail.reviewedAt;
    if (await onReview(next)) {
      if (next && status === "pending") setPinned(detail.id);
      setToast(next ? "Reporte marcado como revisado" : "Reporte devuelto a pendientes");
      window.setTimeout(() => setToast(""), 3500);
    }
  }
  async function openDocument(item: CoachReportItem) {
    setIssue(null);
    try { const file = await onDownload(item); const url = URL.createObjectURL(file); window.open(url, "_blank", "noopener,noreferrer"); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch { setIssue("No pudimos abrir el documento. Inténtalo nuevamente."); }
  }
  const shown = viewer === null ? null : photos[viewer];
  return <section ref={root} className={styles.view + (detail ? " " + styles.hasDetail : "")} aria-label="Reportes de alumnos">
    <div className={styles.listPane} hidden={!!detail && !wide}><div className={styles.listInner}>
      <AppBackButton onBack={onBack} label="Volver al panel" />
      <div className={styles.heading}><h2>Reportes de alumnos</h2><p>Fotos de progreso y documentos que tus alumnos compartieron contigo.</p></div>
      <div className={styles.filters}>
        <div className={styles.tabs} role="group" aria-label="Estado de reportes">{(["pending", "reviewed", "all"] as const).map((value) =>
          <button type="button" key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setPinned(null); onFilter({ status: value, kind, query }); onCloseDetail(); }}>
            {value === "pending" ? "Pendientes" : value === "reviewed" ? "Revisados" : "Todos"}
            {value !== "all" && <span className={value === "pending" ? styles.countPending : styles.count}>{value === "pending" ? state.pendingCount : state.reviewedCount}</span>}</button>)}</div>
        <label className={styles.search}><Search size={17} aria-hidden="true" /><span className={styles.srOnly}>Buscar alumno</span>
          <input value={query} maxLength={100} onChange={(e) => { setQuery(e.target.value); setPinned(null); onFilter({ status, kind, query: e.target.value }); onCloseDetail(); }} placeholder="Buscar alumno" /></label>
        <div className={styles.types} role="group" aria-label="Tipo de reporte">
          <button type="button" aria-pressed={kind === "photos"} onClick={() => { const next = kind === "photos" ? null : "photos"; setKind(next); setPinned(null); onFilter({ status, kind: next, query }); onCloseDetail(); }}>Fotos</button>
          <button type="button" aria-pressed={kind === "medical_document"} onClick={() => { const next = kind === "medical_document" ? null : "medical_document"; setKind(next); setPinned(null); onFilter({ status, kind: next, query }); onCloseDetail(); }}>Documentos</button>
        </div>
      </div>
      {state.phase === "loading" && <p className={styles.empty} role="status">Cargando reportes…</p>}
      {state.issue && !detail && <><p className={styles.error} role="alert">{state.issue}</p><button type="button" className={styles.action} onClick={onRetry}>Reintentar</button></>}
      {state.phase === "ready" && !filtered.length && <p className={styles.empty}>{status === "pending" && !kind && !query ? "Estás al día: no tienes reportes pendientes." : "No hay reportes con estos filtros."}</p>}
      {[...groups].map(([label, reports]) => <div key={label}><h3 className={styles.groupTitle}>{label}</h3>
        <div className={styles.list}>{reports.map((report) => <div key={report.id} data-report-id={report.id}>
          <ReportRow report={report} now={now} selected={detail?.id === report.id} onOpen={() => open(report.id)} /></div>)}</div></div>)}
      {state.hasMore && <button type="button" className={styles.action} disabled={state.loadingMore} onClick={onLoadMore}>
        {state.loadingMore ? "Cargando…" : "Cargar más reportes"}</button>}
    </div></div>
    <div className={styles.detailPane} hidden={!detail && !wide}>{detail ? <>
      <div className={styles.detailHead}><div className={styles.mobileBack} ref={detailBack}><AppBackButton onBack={onCloseDetail} label="Reportes de alumnos" /></div>
        <div className={styles.person}><span className={styles.avatar}>{initials(detail.studentName)}</span><div><h2>{detail.studentName}</h2>
          <p>{title(detail.kind)} · recibido el {date(detail.sentAt)}, {TIME.format(new Date(detail.sentAt))}</p>
          <span className={styles.chip + " " + (detail.reviewedAt ? styles.ok : styles.warn)}>{detail.reviewedAt ? "Revisado el " + date(detail.reviewedAt) : "Pendiente"}</span></div></div>
        <button className={styles.studentLink} type="button" onClick={() => onStudentRecord(detail.episodeId)}>Ver ficha del alumno ›</button></div>
      {detail.kind === "photos" && !!photos.length && <div className={styles.detailTabs} role="group" aria-label="Vista del reporte">
        <button type="button" aria-pressed={tab === "report"} onClick={() => setTab("report")}>Reporte</button>
        <button type="button" aria-pressed={tab === "compare"} disabled={!common.length} title={common.length ? undefined : "Sin anterior para comparar"} onClick={() => setTab("compare")}>Comparar</button></div>}
      <div className={styles.detailBody}>{tab === "compare" && common.length ? <>
        <div className={styles.poses}>{common.map((p) => <button type="button" aria-pressed={chosenPose === p} key={p} onClick={() => setPose(p)}>{p}</button>)}</div>
        <div className={styles.comparison}>{[
          { label: "Antes · " + date(state.previous!.sentAt), item: earlier.find((i) => i.pose === chosenPose), images: oldUrls },
          { label: "Ahora · " + date(detail.sentAt), item: photos.find((i) => i.pose === chosenPose), images: urls },
        ].map(({ label, item, images }) => <figure key={label}>{item && images[item.assetId]
          ? <img src={images[item.assetId]} alt={label + ", " + chosenPose} /> : <div className={styles.photoUnavailable}>Foto no disponible</div>}<figcaption>{label}</figcaption></figure>)}</div>
      </> : <>
        <article className={styles.box}><h3>MENSAJE DEL ALUMNO</h3><p className={detail.message ? "" : styles.noMessage}>{detail.message || "No dejó mensaje."}</p></article>
        {!detail.items.length && <p className={styles.empty}>El alumno envió este reporte sin archivos adjuntos.</p>}
        {!!photos.length && <article className={styles.box}><h3>FOTOS · {photos.length} {photos.length === 1 ? "FOTO" : "FOTOS"}</h3>
          <div className={styles.photos}>{photos.map((item, index) => <button type="button" className={styles.photo} key={item.assetId} onClick={(event) => { photoTrigger.current = event.currentTarget; setViewer(index); }}>
            <span className={styles.photoImage}>{urls[item.assetId] ? <img src={urls[item.assetId]} alt={"Foto " + (index + 1) + ", " + (item.pose ?? "progreso")} /> : "Foto no disponible"}<span>{index + 1} / {photos.length}</span></span><span>{item.pose ?? "Foto de progreso"}</span></button>)}</div></article>}
        {detail.items.some((i) => i.assetKind === "medical_document") && <article className={styles.box}><h3>DOCUMENTOS</h3>{detail.items.filter((i) => i.assetKind === "medical_document").map((item) =>
          <div className={styles.file} key={item.assetId}><FileText size={22} aria-hidden="true" /><div><strong>{item.displayName ?? "Documento médico"}</strong><small>PDF · {(item.bytes / 1048576).toFixed(1)} MB</small></div>
            <button type="button" className={styles.action} onClick={() => void openDocument(item)}>Abrir</button></div>)}</article>}
      </>}{(issue || state.issue) && <p className={styles.error} role="alert">{issue || state.issue}</p>}</div>
      <div className={styles.detailFoot}><p>{detail.reviewedAt ? "Revisado el " + date(detail.reviewedAt) : "Al marcarlo, el reporte quedará registrado como revisado."}</p>
        <button type="button" className={detail.reviewedAt ? styles.secondary : styles.primary} disabled={state.saving} onClick={() => void setReviewed()}>{state.saving ? "Guardando…" : detail.reviewedAt ? "Volver a pendientes" : "Marcar como revisado"}</button></div>
    </> : <div className={styles.noSelection} role="status">{state.detailPhase === "loading" ? "Abriendo reporte…" : "Selecciona un reporte"}</div>}</div>
    {shown && viewer !== null && <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label="Visor de fotos">
      <div className={styles.lightboxHead}><div><strong>{shown.pose ?? "Foto"} · {viewer + 1} de {photos.length}</strong><p>{detail?.studentName} · {detail && date(detail.sentAt)}</p></div>
        <button ref={closeViewer} type="button" aria-label="Cerrar foto" onClick={() => { setViewer(null); photoTrigger.current?.focus(); }}><X /></button></div>
      <div className={styles.lightboxBody}><button type="button" aria-label="Foto anterior" disabled={viewer === 0} onClick={() => setViewer(viewer - 1)}>‹</button>
        {urls[shown.assetId] ? <img src={urls[shown.assetId]} alt={"Foto " + (viewer + 1) + " de " + photos.length} /> : <p>Foto no disponible</p>}
        <button type="button" aria-label="Foto siguiente" disabled={viewer === photos.length - 1} onClick={() => setViewer(viewer + 1)}>›</button></div></div>}
    {toast && <div className={styles.toast} role="status">{toast}</div>}
  </section>;
}
