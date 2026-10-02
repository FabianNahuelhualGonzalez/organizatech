"use client";

import { useEffect, useRef, useState } from "react";

import { selectProgressPhoto, type SelectedProgressPhoto } from "../model/select-progress-photo";
import { PROGRESS_PHOTO_MAX_BYTES, type ProgressPhotoPose } from "../model/progress-records-contract";

import styles from "./student-progress-photos.module.css";

const POSES: readonly ProgressPhotoPose[] = ["frente", "perfil", "espalda"];

type Slot = {
  readonly selected?: SelectedProgressPhoto;
  readonly error?: string;
  readonly previewUrl?: string;
};

export interface ProgressCheckSheetPhoto {
  readonly pose: ProgressPhotoPose;
  readonly selected: SelectedProgressPhoto;
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
  const [showFormatHelp, setShowFormatHelp] = useState(false);
  const urlsRef = useRef<Partial<Record<ProgressPhotoPose, string>>>({});
  const helpRef = useRef<HTMLParagraphElement>(null);
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

  useEffect(() => {
    if (showFormatHelp) helpRef.current?.scrollIntoView({ block: "nearest" });
  }, [showFormatHelp]);

  function chooseFile(pose: ProgressPhotoPose, file: File | null) {
    if (!file || saving) return;
    onSlotChange(pose);
    const previousUrl = urlsRef.current[pose];
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    delete urlsRef.current[pose];
    try {
      const selected = selectProgressPhoto(file);
      let previewUrl: string | undefined;
      try { previewUrl = URL.createObjectURL(file); } catch { /* Preview is optional. */ }
      if (previewUrl) urlsRef.current[pose] = previewUrl;
      setSlots((current) => ({ ...current, [pose]: { selected, previewUrl } }));
    } catch {
      setSlots((current) => ({ ...current, [pose]: {
        error: file.size > PROGRESS_PHOTO_MAX_BYTES ? "La foto supera 20 MB. Elige otra." : "No pudimos usar esta foto. Elige otra.",
      } }));
    }
  }

  function previewFailed(pose: ProgressPhotoPose, url: string) {
    if (!mountedRef.current || urlsRef.current[pose] !== url) return;
    URL.revokeObjectURL(url);
    delete urlsRef.current[pose];
    setSlots((current) => current[pose]?.previewUrl === url
      ? { ...current, [pose]: { selected: current[pose]?.selected } } : current);
  }

  function removeFile(pose: ProgressPhotoPose) {
    if (saving) return;
    onSlotChange(pose);
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

  const ready = POSES.flatMap((pose) => slots[pose]?.selected ? [{ pose, selected: slots[pose].selected }] : []);
  return <div className={styles.sheetOverlay}>
    <button className={styles.sheetScrim} type="button" aria-label="Cerrar nuevo check" disabled={saving} onClick={requestClose} />
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Nuevo check" onKeyDown={handleKeyDown}>
      <div className={styles.sheetHandle}><span /></div>
      <div className={styles.sheetHeader}>
        <h3>Nuevo check · {checkedOn.split("-").reverse().join("/")}</h3>
        <button className={styles.sheetInfo} type="button" aria-label="Información sobre fotos admitidas"
          aria-expanded={showFormatHelp} aria-controls="progress-photo-format-help"
          onClick={() => setShowFormatHelp((value) => !value)}><span aria-hidden="true">i</span></button>
        <button ref={closeRef} className={styles.sheetClose} type="button" aria-label="Cerrar" disabled={saving} onClick={requestClose}>×</button>
      </div>
      <div className={styles.sheetBody}>
        <p className={styles.sheetHelp}>Mismo lugar, misma luz y cámara a la altura de la cintura. Sube las tres poses para comparar mejor.</p>
        <p ref={helpRef} id="progress-photo-format-help" className={styles.sheetFormatHelp} hidden={!showFormatHelp}>Por ahora puedes subir imágenes JPG, PNG o WebP. Si tu foto está en formato HEIC, toma una captura de pantalla de la foto y sube esa captura. En iPhone normalmente se guarda como PNG. Tus fotos se almacenan de forma privada.</p>
        <div className={styles.sheetSlots}>{POSES.map((pose) => {
          const slot = slots[pose];
          return <div className={styles.sheetSlot} key={pose}>
            <div className={styles.sheetSlotFrame}>
              <label className={styles.sheetFileLabel}>
                <input type="file" accept="image/*" aria-label={`Elegir foto de ${pose}`} disabled={saving} onChange={(event) => { chooseFile(pose, event.target.files?.[0] ?? null); event.target.value = ""; }} />
                {slot?.previewUrl ? (
                  // Vista local opcional; next/image no optimiza blob:.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.previewUrl} alt="" onError={() => previewFailed(pose, slot.previewUrl!)} />
                ) : <span className={styles.sheetSlotPrompt}><strong>+</strong><span>{pose}</span></span>}
              </label>
              {slot ? <button className={styles.sheetRemove} type="button" aria-label={`Quitar foto de ${pose}`} disabled={saving} onClick={() => removeFile(pose)}>×</button> : null}
            </div>
            <span className={`${styles.sheetSlotMeta} ${slot?.error ? styles.sheetSlotWarning : ""}`}>
              {!slot ? "Sin foto" : slot.error ?? "Foto elegida"}
            </span>
          </div>;
        })}</div>
        <div className={styles.sheetQuality}><strong>Calidad de las fotos</strong><p>Elige fotos nítidas, con buena luz, de hasta 20 MB cada una.</p></div>
      </div>
      <div className={styles.sheetFooter}>
        {status ? <p className={styles.sheetStatus} role="status">{status}</p> : null}
        {error ? <p className={styles.sheetError} role="alert">{error}</p> : null}
        <button className={styles.sheetSave} type="button" disabled={ready.length === 0 || saving} onClick={() => onSave(ready)}>{saving ? "Guardando check…" : "Guardar check"}</button>
      </div>
    </div>
  </div>;
}
