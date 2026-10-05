"use client";

import { useMemo, useRef, useState } from "react";
import { CoachOverlay } from "@/ui/coach-overlays/coach-overlay";
import type { CoachCommercialCommand } from "../../data/coach-commercial-contract";
import { summarizeCoachCommercialPortfolio, type CoachCommercialItem,
  type CoachCommercialPortfolio } from "../../model/coach-commercial-portfolio";
import { clp, FREQUENCY_LABELS } from "../../model/coach-commercial-display";
import { CoachCommercialStudent } from "./coach-commercial-student";
import styles from "./coach-commercial.module.css";

function monthLabel(value: string): string {
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}-01T12:00:00Z`));
}

export function CoachCommercialDashboard({ coachName, portfolio, phase, issue, busy, uncertain,
  onReload, onSubmit, onReconcile, onLink, onClients, onCalendar, onChat, pendingInvitations }: {
  readonly coachName: string;
  readonly portfolio: CoachCommercialPortfolio | null;
  readonly phase: "loading" | "ready" | "error";
  readonly issue: string | null;
  readonly busy: boolean;
  readonly uncertain: boolean;
  readonly onReload?: () => void;
  readonly onSubmit: (command: CoachCommercialCommand) => void;
  readonly onReconcile: () => void;
  readonly onLink?: () => void;
  readonly onClients: () => void;
  readonly onCalendar: () => void;
  readonly onChat?: () => void;
  readonly pendingInvitations: number | null;
}) {
  const summary = useMemo(() => portfolio ? summarizeCoachCommercialPortfolio(portfolio) : null, [portfolio]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const selected = portfolio?.items.find((item) => item.episodeId === selectedEpisode) ?? null;
  const month = portfolio?.months.find((entry) => entry.month === selectedMonth) ?? null;

  function open(item: CoachCommercialItem) {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedEpisode(item.episodeId);
  }
  function rows(items: readonly CoachCommercialItem[], empty: string) {
    return items.length === 0 ? <p className={styles.empty}>{empty}</p> : <ul className={styles.rows}>
      {items.map((item) => <li key={item.episodeId}><button type="button" onClick={() => open(item)}>
        <span>{item.studentName}</span>
        <small>{item.latestPeriod ? `${clp(item.latestPeriod.amountClp)} · ${FREQUENCY_LABELS[item.latestPeriod.frequency]}` : "Sin acuerdo comercial"}</small>
      </button></li>)}
    </ul>;
  }

  return <>
    <div className={styles.dashboard} ref={backgroundRef} data-coach-commercial-dashboard>
      <header className={styles.heading}><h2>Hola, {coachName}</h2><p>Portafolio comercial</p></header>
      {phase === "loading" && !portfolio ? <p role="status">Cargando información comercial…</p> : null}
      {phase === "error" && !portfolio ? <div role="alert" className={styles.card}>
        <p>No pudimos cargar la información comercial.</p>{onReload ? <button className={styles.action} type="button" onClick={onReload}>Reintentar</button> : null}
      </div> : null}
      {portfolio && summary ? <>
        {issue && !selected ? <p className={styles.error} role="alert">{issue}</p> : null}
        {onReload ? <button className={styles.action} type="button" disabled={busy} onClick={onReload}>Actualizar datos</button> : null}
        <section className={styles.card} aria-label="Resumen del período actual">
          <h3>Período actual · {monthLabel(portfolio.currentMonth)}</h3>
          <div className={styles.totals}>
            <div><span>Ingreso estimado</span><strong>{clp(summary.currentEstimatedClp)}</strong></div>
            <div><span>Pagos confirmados</span><strong>{clp(summary.currentConfirmedPaymentsClp)}</strong></div>
          </div>
          <p className={styles.note}>El ingreso estimado corresponde a períodos iniciados este mes. Los pagos confirmados se registran en el mes de su confirmación.</p>
        </section>
        <section className={styles.card} aria-label="Desglose por tarifa y frecuencia">
          <h3>Tarifas del período</h3>
          {summary.breakdown.length === 0 ? <p className={styles.empty}>Sin períodos comerciales iniciados este mes.</p> : <ul className={styles.breakdown}>
            {summary.breakdown.map((row) => <li key={`${row.frequency}:${row.amountClp}`}>
              <span>{clp(row.amountClp)} · {FREQUENCY_LABELS[row.frequency]}</span>
              <small>{row.students} {row.students === 1 ? "alumno" : "alumnos"} · {row.periods} {row.periods === 1 ? "período" : "períodos"}</small>
              <strong>Estimado: {clp(row.estimatedClp)}</strong>
            </li>)}
          </ul>}
        </section>
        <section className={styles.card} aria-label="Alumnos vinculados">
          <h3>Alumnos</h3><p>{summary.activeCount} vínculos activos · {summary.unlinkedCount} desvinculados</p>
          <p>{pendingInvitations === null ? "Invitaciones pendientes: sin información" : `${pendingInvitations} invitaciones pendientes`}</p>
          <p className={styles.note}>Una invitación pendiente no suma alumnos activos, ingreso ni pagos.</p>
          <button className={styles.action} type="button" disabled={!onLink} onClick={onLink}>Vincular alumno</button>
          <button className={styles.action} type="button" onClick={onClients}>Ver alumnos</button>
        </section>
        <nav className={styles.quickActions} aria-label="Accesos Coach">
          <button type="button" onClick={onCalendar}>Calendario</button>
          <button type="button" disabled={!onChat} onClick={onChat}>Chat</button>
        </nav>
        <section className={styles.card} aria-label="Requieren tu atención">
          <h3>Requieren tu atención</h3>
          {summary.alertCount === 0 ? <p className={styles.empty}>No hay alertas comerciales registradas.</p> : null}
          <h4>Vencidos</h4>{rows(summary.expired, "Sin períodos vencidos.")}
          <h4>Próximos a vencer</h4>{rows(summary.expiringSoon, "Sin períodos próximos a vencer.")}
          <h4>Pendientes de renovación</h4>{rows(summary.pendingRenewal, "Sin renovaciones pendientes.")}
          <h4>Sin acuerdo inicial</h4>{rows(summary.needsAgreement, "Todos los vínculos aceptados tienen acuerdo.")}
        </section>
        <section className={styles.card} aria-label="Histórico mensual">
          <h3>Histórico mensual</h3>
          {summary.months.length === 0 ? <p className={styles.empty}>Aún no hay meses históricos.</p> : <>
            <div className={styles.months} role="group" aria-label="Seleccionar mes">
              {summary.months.map((entry) => <button key={entry.month} type="button" aria-pressed={selectedMonth === entry.month}
                onClick={() => setSelectedMonth(entry.month)}>{monthLabel(entry.month)}</button>)}
            </div>
            {month ? <dl className={styles.facts} aria-live="polite">
              <div><dt>Alumnos</dt><dd>{month.students}</dd></div>
              <div><dt>Altas</dt><dd>{month.joined}</dd></div>
              <div><dt>Bajas</dt><dd>{month.left}</dd></div>
              <div><dt>Ingreso estimado</dt><dd>{clp(month.estimatedClp)}</dd></div>
              <div><dt>Pagos confirmados</dt><dd>{clp(month.confirmedPaymentsClp)}</dd></div>
              {month.periodCount === 0 ? <div><dt>Períodos</dt><dd>Sin períodos iniciados</dd></div> : null}
            </dl> : <p className={styles.empty}>Selecciona un mes para ver datos registrados.</p>}
          </>}
        </section>
        <section className={styles.card} aria-label="Resumen anual">
          <h3>Resumen anual</h3>
          {summary.years.length === 0 ? <p className={styles.empty}>Aún no hay años con datos.</p> : <ul className={styles.breakdown}>
            {summary.years.map((year) => <li key={year.year}><strong>{year.year}</strong>
              <span>Ingreso estimado: {clp(year.estimatedClp)}</span>
              <span>Pagos confirmados: {clp(year.confirmedPaymentsClp)}</span></li>)}
          </ul>}
          {summary.years.filter((year) => year.estimatedClp > 0 || year.confirmedPaymentsClp > 0).length < 2
            ? <p className={styles.note}>La comparación entre años aparecerá cuando existan datos comerciales reales en al menos dos años.</p> : null}
          {summary.years.filter((year) => year.estimatedClp > 0 || year.confirmedPaymentsClp > 0).length >= 2 ? (() => {
            const [recent, prior] = summary.years.filter((year) => year.estimatedClp > 0 || year.confirmedPaymentsClp > 0);
            return <p className={styles.note}>Comparación {recent.year} vs {prior.year}: ingreso estimado {clp(recent.estimatedClp - prior.estimatedClp)}; pagos confirmados {clp(recent.confirmedPaymentsClp - prior.confirmedPaymentsClp)}.</p>;
          })() : null}
        </section>
        <section className={styles.card} aria-label="Renovaciones">
          <h3>Renovaciones</h3>
          <h4>Pendientes</h4>{rows(summary.pendingRenewal, "Sin renovaciones pendientes.")}
          <h4>Renovadas</h4>{rows(summary.renewed, "Aún no hay renovaciones registradas.")}
          <h4>No continuadas</h4>{rows(summary.notContinuing, "Aún no hay acuerdos no continuados.")}
        </section>
      </> : null}
    </div>
    {selected && portfolio ? <div className={styles.detailLayer}>
      <CoachOverlay variant="detail" isOpen isBusy={busy} titleId="coach-commercial-detail-title"
        backgroundRef={backgroundRef} restoreFocusRef={triggerRef} onCancel={() => setSelectedEpisode(null)}
        footer={<button className={styles.action} type="button" disabled={busy} onClick={() => setSelectedEpisode(null)}>Cerrar</button>}>
        <div className={styles.detailBody}>
          <h2 id="coach-commercial-detail-title">{selected.studentName}</h2>
          <CoachCommercialStudent key={`${selected.episodeId}:${selected.version}`} item={selected} periods={portfolio.periods}
            today={portfolio.serverToday} busy={busy} uncertain={uncertain} issue={issue}
            onSubmit={onSubmit} onReconcile={onReconcile} />
        </div>
      </CoachOverlay>
    </div> : null}
  </>;
}
