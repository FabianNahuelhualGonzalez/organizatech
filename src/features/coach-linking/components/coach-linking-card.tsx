"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronRight, Link2, LoaderCircle, X } from "lucide-react";

import type { CoachLinkingController } from "../hooks/use-coach-linking-controller";
import {
  COACH_LINK_MESSAGES,
  isCompleteCoachLinkCode,
  lookupMessageRole,
  normalizeCoachLinkCode,
} from "../model/coach-linking";
import styles from "./coach-linking.module.css";

const OPEN_TRIGGER_ID = "coach-link-open-trigger";

export function CoachLinkingCardBoundary({
  controller,
  onOpenConfirmation,
  onOpenSuccess,
}: {
  readonly controller: CoachLinkingController;
  readonly onOpenConfirmation: () => void;
  readonly onOpenSuccess: () => void;
}) {
  const { snapshot, actions } = controller;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (snapshot.cardMode === "form") inputRef.current?.focus();
  }, [snapshot.cardMode]);

  function closeForm() {
    actions.closeForm();
    window.setTimeout(() => document.getElementById(OPEN_TRIGGER_ID)?.focus(), 0);
  }

  async function submit() {
    const outcome = await actions.lookup();
    if (outcome === "confirmation") onOpenConfirmation();
    if (outcome === "success") onOpenSuccess();
  }

  const complete = isCompleteCoachLinkCode(snapshot.code);
  const messageStatus = snapshot.lookupStatus === "idle" ? "incompleto" : snapshot.lookupStatus;
  const message = COACH_LINK_MESSAGES[messageStatus];

  return (
    <section className={styles.card} data-section="coach-linking" aria-busy={snapshot.lookupStatus === "validando"}>
      <h3>Coaching</h3>

      {snapshot.activeState === "linked" && snapshot.coachName ? (
        <>
          <p className={styles.description}>Estás siendo entrenado por tu coach en Organizatech.</p>
          <div className={styles.linked}>
            <span className={styles.iconBox} data-tone="success"><Check size={18} aria-hidden="true" /></span>
            <span className={styles.linkedCopy}>
              <strong>VINCULADO</strong>
              <span>{snapshot.coachName}</span>
            </span>
          </div>
        </>
      ) : snapshot.cardMode === "closed" ? (
        <>
          <p className={styles.description}>Vincúlate con un coach, comparte tu progreso y recibe seguimiento de tus entrenamientos.</p>
          <button id={OPEN_TRIGGER_ID} className={styles.openButton} type="button" onClick={actions.openForm}>
            <span className={styles.iconBox}><Link2 size={18} aria-hidden="true" /></span>
            <span className={styles.openCopy}>
              <strong>Ingresa el código de tu coach</strong>
              <span>Te lo comparte tu entrenador para conectarte con él</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </>
      ) : (
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className={styles.formHeading}>
            <p>Ingresa el código que te compartió tu coach.</p>
            <button className={styles.closeButton} type="button" aria-label="Cerrar formulario de vinculación" onClick={closeForm}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <input
            ref={inputRef}
            className={styles.codeInput}
            data-error={messageStatus === "invalido" || messageStatus === "ya_usado" || messageStatus === "no_corresponde"}
            value={normalizeCoachLinkCode(snapshot.code).display}
            onChange={(event) => actions.setCode(event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              if (!pasted) return;
              event.preventDefault();
              actions.setCode(pasted);
            }}
            placeholder="AB2-CD3-EF4"
            maxLength={11}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="coach-link-code-message coach-link-code-expiry"
          />
          <div
            id="coach-link-code-message"
            className={styles.status}
            data-status={messageStatus}
            role={lookupMessageRole(messageStatus)}
            aria-live="polite"
          >
            {messageStatus === "validando" ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" /> : null}
            <span>{message}</span>
          </div>
          {messageStatus === "error_red" ? (
            <button className={styles.secondaryButton} type="button" onClick={() => void submit()}>Reintentar</button>
          ) : null}
          <button
            className={styles.primaryButton}
            type="submit"
            disabled={!complete || snapshot.lookupStatus === "validando"}
          >
            {snapshot.lookupStatus === "validando" ? "Validando…" : "Vincular"}
          </button>
          <p id="coach-link-code-expiry" className={styles.expiry}>El código vence a los 7 días.</p>
        </form>
      )}
    </section>
  );
}

