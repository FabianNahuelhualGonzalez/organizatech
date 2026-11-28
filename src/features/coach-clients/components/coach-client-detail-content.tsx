import { CalendarDays, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachClientDetailView, CoachClientDetailActions } from "./coach-client-detail-view";
import { CoachClientCodeCard } from "./coach-client-code-card";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-client-detail-sheet.module.css";

const STATE_LABELS = { active: "ACTIVO", pending: "PENDIENTE", inactive: "BAJA" } as const;

export function CoachClientDetailContent({ view, disabled, actions, commercialContent }: {
  readonly view: CoachClientDetailView;
  readonly disabled: boolean;
  readonly actions: Pick<CoachClientDetailActions, "onCopyCode" | "onShareCode" | "onResend" | "onRetryDelivery" | "onOpenCycle" | "onOpenRecord">;
  readonly commercialContent?: ReactNode;
}) {
  const facts = view.state === "active"
    ? [{ label: "Vinculado desde", value: view.facts.linkedOnLabel }, { label: "Último entrenamiento", value: view.facts.lastTrainingLabel }, { label: "Sesiones del ciclo", value: view.facts.sessionsLabel }]
    : view.state === "pending"
      ? [{ label: "Solicitud registrada", value: view.facts.requestedOnLabel }, { label: "Correo", value: view.email }, { label: "Espera", value: view.facts.waitingLabel }]
      : [{ label: "Vinculado desde", value: view.facts.linkedOnLabel }, { label: "Desvinculado el", value: view.facts.unlinkedOnLabel }];
  const canOpenCycle = !disabled && view.state === "active" && view.cycle?.canOpen === true && Boolean(actions.onOpenCycle);
  const canOpenRecord = !disabled && view.state === "active" && Boolean(actions.onOpenRecord);
  return <div className={styles.body}>
    <div className={styles.statusLine}>
      <span className={styles.chip} data-state={view.state === "active" ? view.isTraining === true ? "training" : "away" : view.state}>
        <span aria-hidden="true" />{view.state === "active" ? view.isTraining === null || view.isTraining === undefined
          ? "CONSULTANDO" : view.isTraining ? "ACTIVO" : "AUSENTE" : STATE_LABELS[view.state]}</span>
      {view.statusDescription !== null ? <p data-link-active={view.state === "active"}>{view.statusDescription}</p> : null}
    </div>
    <dl className={styles.facts}>
      {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd data-known={fact.value !== null}>{fact.value ?? "—"}</dd></div>)}
    </dl>
    {view.state === "pending" && view.code !== null ? <CoachClientCodeCard view={view.code} disabled={disabled}
      onCopy={actions.onCopyCode ? () => actions.onCopyCode?.(view.id) : undefined}
      onShare={actions.onShareCode ? () => actions.onShareCode?.(view.id) : undefined}
      onResend={actions.onResend ? () => actions.onResend?.(view.id) : undefined}
      onRetryDelivery={actions.onRetryDelivery ? () => actions.onRetryDelivery?.(view.id) : undefined} /> : null}
    {view.state === "active" ? <button className={styles.cycle} type="button" disabled={!canOpenRecord && !canOpenCycle}
      onClick={canOpenRecord ? () => actions.onOpenRecord?.(view.id)
        : canOpenCycle ? () => actions.onOpenCycle?.(view.id) : undefined}>
      <CalendarDays size={16} aria-hidden="true" /><span className={styles.cycleCopy}>
        <span className={styles.cycleTitle}>{actions.onOpenRecord ? "Abrir ficha del alumno" : "Ver su ciclo y rutinas"}</span>
        <span className={styles.cycleLabel} data-known={actions.onOpenRecord ? true : view.cycle?.label != null}>
          {actions.onOpenRecord ? "Entrenamiento, evaluaciones y archivos compartidos" : view.cycle?.label ?? "—"}</span>
      </span><ChevronRight size={13} aria-hidden="true" />
    </button> : null}
    {view.state === "active" ? commercialContent : null}
    {view.state === "inactive" && view.historyNote !== null ? <p className={styles.note}>{view.historyNote}</p> : null}
    {view.message ? <StatusMessage className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
  </div>;
}
