"use client";

import { useEffect, useRef, useState } from "react";

import { prepareLocalProgressPhoto, type PreparedProgressPhoto } from "../model/prepare-local-progress-photo";
import type { ProgressPhotoPose } from "../model/progress-records-contract";

import styles from "./student-progress-photos.module.css";

const POSES: readonly ProgressPhotoPose[] = ["frente", "perfil", "espalda"];

type Slot = {
  readonly status: "preparando" | "lista" | "error";
  readonly prepared?: PreparedProgressPhoto;
  readonly previewUrl?: string;
};

export interface ProgressCheckSheetPhoto {
  readonly pose: ProgressPhotoPose;
  readonly prepared: PreparedProgressPhoto;
}

export function StudentProgressCheckSheet({ checkedOn, saving, status, error, onClose, onSlotChange, onSave }: {
  readonly checkedOn: string;
  readonly saving: boolean;
  readonly status: string;
  readonly error: string;
  readonly onClose: () => void;
  readonly onSlotChange: (pose: ProgressPhotoPose) => void;
  readonly onSave: (photos: readonly ProgressCheckSheetPhoto[]) => void;
}) {
  const [slots, setSlots] = useState<Partial<Record<ProgressPhotoPose, Slot>>>({});
  const versionsRef = useRef<Record<ProgressPhotoPose, number>>({ frente: 0, perfil: 0, espalda: 0 });
  const urlsRef = useRef<Partial<Record<ProgressPhotoPose, string>>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    closeRef.current?.focus();
    const urls = urlsRef.current;
    return () => {
      mountedRef.current = false;
      Object.values(urls).forEach((url) => { if (url) URL.revokeObjectURL(url); });
    };
  }, []);

  async function chooseFile(pose: ProgressPhotoPose, file: File | null) {
    if (!file || saving) return;
    onSlotChange(pose);
    const version = ++versionsRef.current[pose];
    const previousUrl = urlsRef.current[pose];
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    delete urlsRef.current[pose];
    setSlots((current) => ({ ...current, [pose]: { status: "preparando" } }));
    try {
      const prepared = await prepareLocalProgressPhoto(file);
      const previewUrl = URL.createObjectURL(prepared.blob);
      if (!mountedRef.current || versionsRef.current[pose] !== version) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      urlsRef.current[pose] = previewUrl;
      setSlots((current) => ({ ...current, [pose]: { status: "lista", prepared, previewUrl } }));
    } catch {
      if (mountedRef.current && versionsRef.current[pose] === version) {
        setSlots((current) => ({ ...current, [pose]: { status: "error" } }));
      }
    }
  }

  function removeFile(pose: ProgressPhotoPose) {
    if (saving) return;
    onSlotChange(pose);
    versionsRef.current[pose] += 1;
    const url = urlsRef.current[pose];
    if (url) URL.revokeObjectURL(url);
    delete urlsRef.current[pose];
    setSlots((current) => {
      const next = { ...current };
      delete next[pose];
      return next;
    });
  }

  function requestClose() {
    if (saving) return;
    if (POSES.some((pose) => slots[pose]) && !window.confirm("¿Descartar este check?")) return;
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
    if (controls.length === 0) return;
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault();
      controls[0].focus();
    }
  }

  const preparing = POSES.some((pose) => slots[pose]?.status === "preparando");
  const ready = POSES.flatMap((pose) => slots[pose]?.prepared ? [{ pose, prepared: slots[pose].prepared }] : []);
  return <div className={styles.sheetOverlay}>
    <button className={styles.sheetScrim} type="button" aria-label="Cerrar nuevo check" disabled={saving} onClick={requestClose} />
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Nuevo check" onKeyDown={handleKeyDown}>
      <div className={styles.sheetHandle}><span /></div>
      <div className={styles.sheetHeader}><h3>Nuevo check · {checkedOn.split("-").reverse().join("/")}</h3><button ref={closeRef} className={styles.sheetClose} type="button" aria-label="Cerrar" disabled={saving} onClick={requestClose}>×</button></div>
      <div className={styles.sheetBody}>
        <p className={styles.sheetHelp}>Mismo lugar, misma luz y cámara a la altura de la cintura. Sube las tres poses para comparar mejor.</p>
        <div className={styles.sheetSlots}>{POSES.map((pose) => {
          const slot = slots[pose];
          return <div className={styles.sheetSlot} key={pose}>
            <div className={styles.sheetSlotFrame}>
              <label className={styles.sheetFileLabel}>
                <input type="file" accept="image/*" aria-label={`Elegir foto de ${pose}`} disabled={saving} onChange={(event) => { void chooseFile(pose, event.target.files?.[0] ?? null); event.target.value = ""; }} />
                {slot?.previewUrl ? (
                  // Vista local del JPEG ya preparado; next/image no optimiza blob:.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.previewUrl} alt="" />
                ) : <span className={styles.sheetSlotPrompt}><strong>+</strong><span>{pose}</span></span>}
              </label>
              {slot ? <button className={styles.sheetRemove} type="button" aria-label={`Quitar foto de ${pose}`} disabled={saving} onClick={() => removeFile(pose)}>×</button> : null}
            </div>
            <span className={`${styles.sheetSlotMeta} ${slot?.prepared ? styles.sheetSlotDimensions : slot?.status === "error" ? styles.sheetSlotWarning : ""}`}>
              {!slot ? "Sin foto" : slot.status === "preparando" ? "Preparando…" : slot.status === "error" ? "No se pudo preparar" : slot.prepared ? `${slot.prepared.width}×${slot.prepared.height}` : "Sin foto"}
            </span>
            {slot?.prepared && slot.prepared.width < 1080 ? <span className={styles.sheetSlotWarning}>Baja resolución</span> : null}
          </div>;
        })}</div>
        <div className={styles.sheetQuality}><strong>Calidad de las fotos</strong><p>Preparamos y sanitizamos las fotos como JPEG antes de guardarlas, hasta 20 MB por foto preparada. Puedes elegir JPG, PNG o HEIC si tu navegador lo puede abrir. Recomendado: 1080 px de ancho o más.</p></div>
        {status ? <p className={styles.sheetStatus} role="status">{status}</p> : null}
        {error ? <p className={styles.sheetError} role="alert">{error}</p> : null}
      </div>
      <div className={styles.sheetFooter}><button className={styles.sheetSave} type="button" disabled={ready.length === 0 || preparing || saving} onClick={() => onSave(ready)}>{saving ? "Guardando check…" : "Guardar check"}</button></div>
    </div>
  </div>;
}
