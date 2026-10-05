"use client";

import { useState, type FormEvent } from "react";
import type { CoachCommercialCommand } from "../../data/coach-commercial-contract";
import { COACH_COMMERCIAL_INITIAL_VERSION } from "../../data/coach-commercial-contract";
import { COACH_COMMERCIAL_FREQUENCIES, type CoachCommercialFrequency,
  type CoachCommercialItem, type CoachCommercialPeriod } from "../../model/coach-commercial-portfolio";
import { canConfirmLatestPayment, civilDate, clp, FREQUENCY_LABELS, latestAction, previousPeriods } from "../../model/coach-commercial-display";
import styles from "./coach-commercial.module.css";

const STATUS = {
  needs_agreement: "Sin acuerdo comercial", active: "Vigente",
  pending_renewal: "Pendiente de renovación", not_continuing: "No continúa",
} as const;
const ACTION = { start: "Configurar acuerdo inicial", renew: "Renovar", correct_future: "Corregir período futuro" } as const;

export function CoachCommercialStudent({ item, periods, today, busy, uncertain, issue, onSubmit, onReconcile }: {
  readonly item: CoachCommercialItem;
  readonly periods: readonly CoachCommercialPeriod[];
  readonly today: string;
  readonly busy: boolean;
  readonly uncertain: boolean;
  readonly issue: string | null;
  readonly onSubmit: (command: CoachCommercialCommand) => void;
  readonly onReconcile: () => void;
}) {
  const action = latestAction(item, today);
  const latest = item.latestPeriod;
  const history = previousPeriods(periods, item);
  const [amountRaw, setAmountRaw] = useState(latest?.amountClp.toString() ?? "");
  const [frequency, setFrequency] = useState<CoachCommercialFrequency>(latest?.frequency ?? "monthly");
  const [startsOn, setStartsOn] = useState(action === "correct_future" ? latest?.startsOn ?? today : today);
  const [endMode, setEndMode] = useState<"indefinite" | "dated">(item.agreementEnd ? "dated" : "indefinite");
  const [endsOn, setEndsOn] = useState(item.agreementEnd ?? "");
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const disabled = busy || uncertain;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || disabled) return;
    const amountClp = Number(amountRaw);
    const agreementEndsOn = endMode === "indefinite" ? null : endsOn;
    if (!Number.isSafeInteger(amountClp) || amountClp < 1 || amountClp > 1_000_000_000_000
      || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || startsOn < today
      || (agreementEndsOn !== null && (agreementEndsOn < startsOn || !/^\d{4}-\d{2}-\d{2}$/.test(agreementEndsOn)))) {
      setValidation("Revisa monto y fechas antes de guardar.");
      return;
    }
    setValidation(null);
    const common = { episodeId: item.episodeId, requestId: crypto.randomUUID(),
      expectedVersion: item.version ?? COACH_COMMERCIAL_INITIAL_VERSION,
      amountClp, frequency, startsOn, agreementEndsOn };
    onSubmit(action === "correct_future" && latest
      ? { ...common, action, periodId: latest.id }
      : { ...common, action: action === "renew" ? "renew" : "start" });
  }

  return <section className={styles.student} aria-label={`Ficha comercial de ${item.studentName}`}>
    <div className={styles.studentHead}>
      <h3>Ficha comercial</h3><span className={styles.status}>{STATUS[item.status]}</span>
    </div>
    <p className={styles.note}>Acuerdo comercial independiente del ciclo de entrenamiento.</p>
    {issue ? <p className={styles.error} role="alert">{issue}</p> : null}
    {uncertain ? <button className={styles.action} type="button" disabled={busy} onClick={onReconcile}>Revisar estado de la operación</button> : null}
    {latest ? <dl className={styles.facts}>
      <div><dt>Monto</dt><dd>{clp(latest.amountClp)}</dd></div>
      <div><dt>Frecuencia</dt><dd>{FREQUENCY_LABELS[latest.frequency]}</dd></div>
      <div><dt>Inicio del período</dt><dd>{civilDate(latest.startsOn)}</dd></div>
      <div><dt>Término del período</dt><dd>{civilDate(latest.endsBefore)} (exclusivo)</dd></div>
      <div><dt>Inicio del acuerdo</dt><dd>{item.agreementStart ? civilDate(item.agreementStart) : "Sin dato"}</dd></div>
      <div><dt>Término del acuerdo</dt><dd>{item.agreementEnd ? civilDate(item.agreementEnd) : "Indefinida"}</dd></div>
      <div><dt>Pago</dt><dd>{latest.paidAt ? "Confirmado" : "Sin confirmar"}</dd></div>
    </dl> : <p className={styles.empty}>Este alumno aún no tiene un acuerdo comercial.</p>}
    {action && !uncertain ? <form className={styles.form} onSubmit={submit}>
      <h4>{ACTION[action]}</h4>
      <label>Monto CLP<input type="number" inputMode="numeric" min="1" max="1000000000000" step="1" required
        value={amountRaw} disabled={disabled} onChange={(event) => setAmountRaw(event.target.value)} /></label>
      <label>Frecuencia<select value={frequency} disabled={disabled} onChange={(event) => setFrequency(event.target.value as CoachCommercialFrequency)}>
        {COACH_COMMERCIAL_FREQUENCIES.map((value) => <option value={value} key={value}>{FREQUENCY_LABELS[value]}</option>)}
      </select></label>
      <label>Fecha de inicio<input type="date" min={today} required value={startsOn}
        disabled={disabled || action === "correct_future"} onChange={(event) => setStartsOn(event.target.value)} /></label>
      <label>Modalidad de término<select value={endMode} disabled={disabled} onChange={(event) => setEndMode(event.target.value as "indefinite" | "dated")}>
        <option value="indefinite">Indefinida</option><option value="dated">Con fecha de término</option>
      </select></label>
      {endMode === "dated" ? <label>Fecha de término<input type="date" min={startsOn} required value={endsOn}
        disabled={disabled} onChange={(event) => setEndsOn(event.target.value)} /></label> : null}
      {action === "correct_future" ? <p className={styles.note}>Sólo se puede corregir el último período futuro sin pago. La fecha de inicio permanece fija.</p> : null}
      {validation ? <p className={styles.error} role="alert">{validation}</p> : null}
      <button className={styles.action} type="submit" disabled={disabled}>{busy ? "Guardando…" : ACTION[action]}</button>
    </form> : null}
    {canConfirmLatestPayment(item, today) && !uncertain ? <div className={styles.payment}>
      {confirmingPayment ? <>
        <p>Confirma el pago de {clp(latest!.amountClp)} correspondiente al período iniciado el {civilDate(latest!.startsOn)}.</p>
        <div className={styles.buttons}>
          <button type="button" disabled={disabled} onClick={() => setConfirmingPayment(false)}>Cancelar</button>
          <button type="button" disabled={disabled} onClick={() => {
            if (!latest || !item.version) return;
            setConfirmingPayment(false);
            onSubmit({ action: "confirm_payment", episodeId: item.episodeId, periodId: latest.id,
              requestId: crypto.randomUUID(), expectedVersion: item.version });
          }}>Confirmar este pago</button>
        </div>
      </> : <button className={styles.action} type="button" disabled={disabled} onClick={() => setConfirmingPayment(true)}>Confirmar pago</button>}
    </div> : null}
    <section className={styles.history} aria-label="Historial de períodos anteriores">
      <h4>Períodos anteriores</h4>
      {history.length === 0 ? <p className={styles.empty}>Aún no hay períodos anteriores.</p> : <ul>
        {history.map((period) => <li key={period.id}>
          <span>{civilDate(period.startsOn)} · {FREQUENCY_LABELS[period.frequency]}</span>
          <strong>{clp(period.amountClp)}</strong>
          <small>{period.paidAt ? "Pago confirmado" : "Pago sin confirmar"}</small>
        </li>)}
      </ul>}
    </section>
  </section>;
}
