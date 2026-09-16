"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachChatComingSoonProps } from "./coach-dashboard-sheet-view";
import { CoachDashboardSheet } from "./coach-dashboard-sheet";
import shared from "@/ui/coach-overlays/coach-overlay.module.css";
import styles from "./coach-chat-coming-soon-sheet.module.css";

export function CoachChatComingSoonSheet({ view, onRegister, onCancel, backgroundRef, restoreFocusRef }: CoachChatComingSoonProps) {
  const id = useId();
  const canRegister = view.isOpen && !view.isBusy && view.isRegistered === false && Boolean(onRegister);
  const canCancel = view.isOpen && !view.isBusy && Boolean(onCancel);
  return (
    <CoachDashboardSheet isOpen={view.isOpen} isBusy={view.isBusy} titleId={`${id}-title`} variant="chat"
      backgroundRef={backgroundRef} restoreFocusRef={restoreFocusRef} onCancel={onCancel}
      footer={<>
        <button className={shared.primary} type="button" disabled={!canRegister} data-registered={view.isRegistered === true}
          data-modal-initial-focus={canRegister ? "" : undefined} aria-busy={view.isBusy}
          onClick={canRegister ? onRegister : undefined}>
          {view.isRegistered === true ? <><Check size={16} aria-hidden="true" />Te avisamos apenas esté</> : "Avísame cuando esté listo"}
        </button>
        {view.isRegistered === true ? <StatusMessage className={shared.srOnly}>Te avisamos apenas esté</StatusMessage> : null}
        <button className={shared.ghost} type="button" disabled={!canCancel} onClick={canCancel ? onCancel : undefined}>Ahora no</button>
      </>}>
      <div className={styles.body}>
        <div className={styles.demo} aria-hidden="true">
          <div className={styles.them}><span>Coach, ¿subo el peso en sentadilla?</span></div>
          <div className={styles.me}><span>Sí, 5 kilos más. Cuida la técnica.</span></div>
          <div className={styles.typing}><span /><span /><span /></div>
        </div>
        <p className={styles.eyebrow}>MUY PRONTO</p>
        <h2 className={styles.title} id={`${id}-title`}>Vas a poder responderles sin salir de Organizatech</h2>
        <p className={styles.description}>Se acabó el ir y venir entre WhatsApp y la app para saber de qué rutina te están hablando. El chat abrirá con el entrenamiento del alumno al lado.</p>
        <ul className={styles.features}>
          <li>El chat abre con la rutina del alumno a la vista</li>
          <li>Te avisa cuando alguien lleva días sin entrenar</li>
          <li>Corriges una carga y le llega el cambio al instante</li>
        </ul>
        {view.message ? <StatusMessage className={shared.message} tone={view.message.tone}>{view.message.label}</StatusMessage> : null}
      </div>
    </CoachDashboardSheet>
  );
}
