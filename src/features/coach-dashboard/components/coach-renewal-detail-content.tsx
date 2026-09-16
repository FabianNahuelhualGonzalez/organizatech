import type { RefObject } from "react";
import { CalendarDays, Info } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachRenewalDetailView, CoachRenewalDetailActions } from "./coach-renewal-detail-view";
import { CoachRenewalStateChoices } from "./coach-renewal-state-choices";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-renewal-detail-sheet.module.css";

export function CoachRenewalDetailContent({ view, disabled, actions, triggerRef }: {
  readonly view: CoachRenewalDetailView;
  readonly disabled: boolean;
  readonly actions: Pick<CoachRenewalDetailActions, "onSelectState" | "onOpenDates">;
  readonly triggerRef: RefObject<HTMLElement | null>;
}) {
  const facts = [
    { id: "ends", label: "Período pagado hasta", value: view.facts.endsOnLabel },
    { id: "last", label: "Último entrenamiento", value: view.facts.lastTrainingLabel },
    { id: "attendance", label: "Avance del ciclo", value: view.facts.consistencyLabel },
  ];
  return (
    <div className={styles.body}>
      <div className={styles.statusLine}>
        <span className={styles.chip} data-state={view.state}>{view.stateLabel ?? "—"}</span>
        {view.stateCaption !== null ? <span className={styles.caption}>{view.stateCaption}</span> : null}
      </div>
      <div className={styles.source}>
        <Info size={14} aria-hidden="true" />
        <div><h3>DE DÓNDE SALE ESTE ESTADO</h3><p data-known={view.sourceLabel !== null}>{view.sourceLabel ?? "—"}</p></div>
      </div>
      <dl className={styles.facts}>
        {facts.map((fact) => <div key={fact.id}><dt>{fact.label}</dt><dd data-known={fact.value !== null}>{fact.value ?? "—"}</dd></div>)}
        <div><dt>Vale al mes</dt><dd data-known={view.facts.monthlyFee.value !== null}>{view.facts.monthlyFee.label}</dd></div>
      </dl>
      <h3 className={styles.askTitle}>¿En qué quedaron?</h3>
      <p className={styles.askHint}>Registra el pago y las fechas del período. El ciclo de entrenamiento es independiente.</p>
      <CoachRenewalStateChoices state={view.state} disabled={disabled} onSelectState={actions.onSelectState} triggerRef={triggerRef} />
      {view.state === "renewed" && view.paidPeriodDates !== null ? <button className={styles.cycle} type="button"
        disabled={disabled || !actions.onOpenDates} onClick={!disabled && actions.onOpenDates ? (event) => {
          triggerRef.current = event.currentTarget; actions.onOpenDates?.();
        } : undefined}>
        <CalendarDays size={16} aria-hidden="true" /><span className={styles.cycleCopy}>
          <span className={styles.cycleTitle}>FECHAS DEL PERÍODO PAGADO</span>
          <span className={styles.cycleValue} data-incomplete={view.paidPeriodDates.isIncomplete}>{view.paidPeriodDates.label ?? "—"}</span>
        </span><span className={styles.change}>Cambiar</span>
      </button> : null}
      {view.message ? <StatusMessage className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
    </div>
  );
}
