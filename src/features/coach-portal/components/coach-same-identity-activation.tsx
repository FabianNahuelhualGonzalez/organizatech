"use client";

import { useEffect, useState } from "react";

import {
  activateOwnCoachUserProfile,
  hasOwnCoachUserProfile,
} from "@/features/coach-portal/data/coach-user-profile-activation-repository";

import styles from "./coach-portal.module.css";

export function CoachSameIdentityActivation({ expectedUserId }: { readonly expectedUserId: string }) {
  const [state, setState] = useState<"loading" | "inactive" | "activating" | "active" | "error">("loading");
  const [reloadSequence, setReloadSequence] = useState(0);

  useEffect(() => {
    let current = true;
    setState("loading");
    void hasOwnCoachUserProfile(expectedUserId)
      .then((active) => { if (current) setState(active ? "active" : "inactive"); })
      .catch(() => { if (current) setState("error"); });
    return () => { current = false; };
  }, [expectedUserId, reloadSequence]);

  async function activate() {
    setState("activating");
    try {
      await activateOwnCoachUserProfile(expectedUserId);
      setState("active");
    } catch {
      setState("error");
    }
  }

  function openUserProfile() {
    window.location.assign("/login");
  }

  return (
    <section className={styles.userProfileCard} aria-labelledby="coach-user-profile-title" aria-busy={state === "loading" || state === "activating"}>
      <p className={styles.summaryLabel}>Misma identidad</p>
      <h3 id="coach-user-profile-title">Perfil Usuario</h3>
      {state === "loading" ? <p role="status">Comprobando tu perfil Usuario…</p> : null}
      {state === "inactive" || state === "activating" ? (
        <>
          <p>Actívalo para ser tu propio alumno y aceptar el código que enviaste a este mismo correo. No se creará una segunda cuenta.</p>
          <button className={styles.userProfileButton} type="button" disabled={state === "activating"} onClick={() => void activate()}>
            {state === "activating" ? "Activando…" : "Activar mi perfil Usuario"}
          </button>
        </>
      ) : null}
      {state === "active" ? (
        <>
          <p role="status">Tu perfil Usuario está activo. Puedes entrar con esta misma cuenta y aceptar tu código en Perfil → Coaching.</p>
          <button className={styles.userProfileButton} type="button" onClick={openUserProfile}>Ir a mi perfil Usuario</button>
        </>
      ) : null}
      {state === "error" ? (
        <>
          <p className={styles.userProfileError} role="alert">No pudimos comprobar o activar tu perfil Usuario.</p>
          <button className={styles.userProfileButton} type="button" onClick={() => setReloadSequence((current) => current + 1)}>Reintentar</button>
        </>
      ) : null}
    </section>
  );
}
