"use client";

import { Check, LoaderCircle, LockKeyhole } from "lucide-react";

import type { CoachLinkingController } from "../hooks/use-coach-linking-controller";
import { COACH_LINK_MESSAGES, coachInitial } from "../model/coach-linking";
import styles from "./coach-linking.module.css";

const CONSENT_POINTS = [
  "Tu coach podrá ver tu progreso y tus registros de entrenamiento.",
  "Podrá armar y ajustar tus rutinas dentro de los permisos aprobados.",
  "Puedes desvincularte más adelante desde tu perfil; tu historial se conserva.",
];

export function CoachLinkConfirmationScreen({
  controller,
  onSuccess,
  onCancel,
}: {
  readonly controller: CoachLinkingController;
  readonly onSuccess: () => void;
  readonly onCancel: () => void;
}) {
  const { snapshot, actions } = controller;
  const confirmation = snapshot.confirmation;
  if (!confirmation) return null;

  async function accept() {
    if (await actions.accept() === "success") onSuccess();
  }

  function cancel() {
    actions.cancelConfirmation();
    onCancel();
  }

  const errorMessage = snapshot.confirmationError === "ya_tiene_coach"
    ? COACH_LINK_MESSAGES.ya_tiene_coach
    : snapshot.confirmationError === "network"
      ? "No pudimos completar la vinculación. Intenta de nuevo — no se creará un vínculo duplicado."
      : "";

  return (
    <section className={styles.screen} aria-busy={snapshot.accepting}>
      <header className={styles.coachIdentity}>
        <span className={styles.coachAvatar} aria-hidden="true">{coachInitial(confirmation.coachName)}</span>
        <span>TU COACH SERÍA</span>
        <h2>{confirmation.coachName}</h2>
      </header>

      <section className={styles.consentCard}>
        <h3>AL VINCULARTE</h3>
        <ul>
          {CONSENT_POINTS.map((point) => (
            <li key={point}><span><Check size={10} aria-hidden="true" /></span>{point}</li>
          ))}
        </ul>
      </section>

      <p className={styles.legal}>Al vincularte, autorizas a este coach a ver la información necesaria de tus entrenamientos y a crear o editar tus rutinas. Puedes desvincularte más adelante; tu historial se conserva.</p>

      {snapshot.accepting ? (
        <div className={styles.confirmStatus} role="status" aria-live="polite">
          <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" />
          <span>Vinculando…</span>
        </div>
      ) : errorMessage ? (
        <div className={styles.confirmStatus} role={snapshot.confirmationError === "ya_tiene_coach" ? "alert" : "status"} aria-live="polite">
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {snapshot.confirmationError === "network" ? (
        <button className={styles.secondaryButton} type="button" onClick={() => void accept()}>Reintentar</button>
      ) : null}
      <button className={styles.primaryButton} type="button" disabled={snapshot.accepting} onClick={() => void accept()}>
        {snapshot.accepting ? "Vinculando…" : "Vincularme"}
      </button>
      <button className={styles.secondaryButton} type="button" disabled={snapshot.accepting} onClick={cancel}>Cancelar</button>
    </section>
  );
}

export function CoachLinkSuccessScreen({
  controller,
  onTrain,
  onProfile,
}: {
  readonly controller: CoachLinkingController;
  readonly onTrain: () => void;
  readonly onProfile: () => void;
}) {
  const { snapshot, actions } = controller;
  const success = snapshot.success;
  if (!success) return null;
  const recovered = success.kind === "recovered";

  function finish(callback: () => void) {
    actions.settleSuccess();
    callback();
  }

  return (
    <section className={`${styles.screen} ${styles.successScreen}`}>
      <span className={styles.successIcon}><Check size={28} aria-hidden="true" /></span>
      <h2>{recovered ? "Ya estabas vinculado" : "Quedaste vinculado"}</h2>
      <p>{recovered
        ? `Este vínculo con ${success.coachName} ya estaba activo. No se creó un vínculo duplicado.`
        : `${success.coachName} ya es tu coach en Organizatech y puede ver tu progreso.`}</p>
      <div className={styles.successActions}>
        <button className={styles.primaryButton} type="button" onClick={() => finish(onTrain)}>Ir a Entrenar</button>
        <button className={styles.secondaryButton} type="button" onClick={() => finish(onProfile)}>Volver a Perfil</button>
      </div>
    </section>
  );
}

export function CoachLinkAuthGate({ onLogin, onRegister }: { readonly onLogin: () => void; readonly onRegister: () => void }) {
  return (
    <main className={styles.gate}>
      <span className={styles.gateIcon}><LockKeyhole size={26} aria-hidden="true" /></span>
      <h1>Inicia sesión para continuar</h1>
      <p>Tu coach te invitó a Organizatech. Inicia sesión o crea tu cuenta con el correo al que te llegó la invitación — después volverás aquí mismo, sin perder el código.</p>
      <button className={styles.primaryButton} type="button" onClick={onLogin}>Iniciar sesión</button>
      <button className={styles.secondaryButton} type="button" onClick={onRegister}>Crear cuenta</button>
    </main>
  );
}

