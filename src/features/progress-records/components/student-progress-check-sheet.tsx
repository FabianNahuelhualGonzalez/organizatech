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
  readonly width?: number;
  readonly height?: number;
};

export interface ProgressCheckSheetPhoto {
  readonly pose: ProgressPhotoPose;
  readonly selected: SelectedProgressPhoto;
}

export function StudentProgressCheckSheet({ checkedOn, saving, status, error, uploadStates, onClose, onInvalidFile, onSlotChange, onSave }: {
  readonly checkedOn: string;
  readonly saving: boolean;
  readonly status: string;
  readonly error: string;
  readonly uploadStates: Partial<Record<ProgressPhotoPose, { readonly state: "uploading" | "error"; readonly progress: number }>>;
  readonly onClose: () => void;
  readonly onInvalidFile: () => void;
  readonly onSlotChange: (pose: ProgressPhotoPose) => Promise<boolean>;
  readonly onSave: (photos: readonly ProgressCheckSheetPhoto[]) => void;
}) {
  const [slots, setSlots] = useState<Partial<Record<ProgressPhotoPose, Slot>>>({});
  const [changing, setChanging] = useState(false);
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

  async function chooseFile(pose: ProgressPhotoPose, file: File | null) {
    if (!file || saving || changing) return;
    let selected: SelectedProgressPhoto;
    try {
      selected = selectProgressPhoto(file);
    } catch {
      onInvalidFile();
      setSlots((current) => ({ ...current, [pose]: { ...current[pose],
        error: file.size > PROGRESS_PHOTO_MAX_BYTES ? "La foto supera 20 MB. Elige otra." : "No pudimos usar esta foto. Elige otra.",
      } }));
      return;
    }
    setChanging(true);
    try {
      if (!(await onSlotChange(pose)) || !mountedRef.current) return;
      const previousUrl = urlsRef.current[pose];
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      delete urlsRef.current[pose];
      let previewUrl: string | undefined;
      try { previewUrl = URL.createObjectURL(file); } catch { /* Preview is optional. */ }
      if (previewUrl) urlsRef.current[pose] = previewUrl;
      setSlots((current) => ({ ...current, [pose]: { selected, previewUrl } }));
      if (previewUrl) {
        const image = new Image();
        image.onload = () => {
          if (mountedRef.current && urlsRef.current[pose] === previewUrl) {
            setSlots((current) => ({ ...current, [pose]: { ...current[pose], width: image.naturalWidth, height: image.naturalHeight } }));
          }
        };
        image.src = previewUrl;
      }
    } finally { if (mountedRef.current) setChanging(false); }
  }

  function previewFailed(pose: ProgressPhotoPose, url: string) {
    if (!mountedRef.current || urlsRef.current[pose] !== url) return;
    URL.revokeObjectURL(url);
    delete urlsRef.current[pose];
    setSlots((current) => current[pose]?.previewUrl === url
      ? { ...current, [pose]: { selected: current[pose]?.selected } } : current);
  }

  async function removeFile(pose: ProgressPhotoPose) {
    if (saving || changing) return;
    setChanging(true);
    try {
      if (!(await onSlotChange(pose)) || !mountedRef.current) return;
      const url = urlsRef.current[pose];
      if (url) URL.revokeObjectURL(url);
      delete urlsRef.current[pose];
      setSlots((current) => {
        const next = { ...current };
        delete next[pose];
        return next;
      });
    } finally { if (mountedRef.current) setChanging(false); }
  }

  function requestClose() {
    if (saving || changing) return;
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
    <button className={styles.sheetScrim} type="button" aria-label="Cerrar nuevo check" disabled={saving || changing} onClick={requestClose} />
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Nuevo check" onKeyDown={handleKeyDown}>
      <div className={styles.sheetHandle}><span /></div>
      <div className={styles.sheetHeader}>
        <h3>Nuevo check · {checkedOn.split("-").reverse().join("/")}</h3>
        <button className={styles.sheetInfo} type="button" aria-label="Información sobre fotos admitidas"
          aria-expanded={showFormatHelp} aria-controls="progress-photo-format-help"
          onClick={() => setShowFormatHelp((value) => !value)}><span aria-hidden="true">i</span></button>
        <button ref={closeRef} className={styles.sheetClose} type="button" aria-label="Cerrar" disabled={saving || changing} onClick={requestClose}>×</button>
      </div>
      <div className={styles.sheetBody}>
        <p className={styles.sheetHelp}>Mismo lugar, misma luz y cámara a la altura de la cintura. Sube las tres poses para comparar mejor.</p>
        <p ref={helpRef} id="progress-photo-format-help" className={styles.sheetFormatHelp} hidden={!showFormatHelp}>Por ahora puedes subir imágenes JPG, PNG o WebP. Si tu foto está en formato HEIC, toma una captura de pantalla de la foto y sube esa captura. En iPhone normalmente se guarda como PNG. Tus fotos se almacenan de forma privada.</p>
        <div className={styles.sheetSlots}>{POSES.map((pose) => {
          const slot = slots[pose];
          const upload = uploadStates[pose];
          return <div className={styles.sheetSlot} key={pose}>
            <div className={`${styles.sheetSlotFrame} ${upload?.state === "error" ? styles.uploadErrorFrame : ""}`}>
              <label className={styles.sheetFileLabel}>
                <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" aria-label={`Elegir foto de ${pose}`} disabled={saving || changing} onChange={(event) => { void chooseFile(pose, event.target.files?.[0] ?? null); event.target.value = ""; }} />
                {slot?.previewUrl ? (
                  // Vista local opcional; next/image no optimiza blob:.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={upload?.state === "uploading" ? styles.uploadDimmed : ""} src={slot.previewUrl} alt="" onError={() => previewFailed(pose, slot.previewUrl!)} />
                ) : <span className={styles.sheetSlotPrompt}><strong>+</strong><span>{pose}</span></span>}
              </label>
              {upload?.state === "uploading" ? <span className={styles.uploadProgress} style={{ width: `${upload.progress}%` }} /> : null}
              {slot ? <button className={styles.sheetRemove} type="button" aria-label={`Quitar foto de ${pose}`} disabled={saving || changing} onClick={() => { void removeFile(pose); }}>×</button> : null}
            </div>
            <span className={`${styles.sheetSlotMeta} ${slot?.error || upload?.state === "error" ? styles.sheetSlotError
              : slot?.width !== undefined && slot.width < 1080 ? styles.sheetSlotWarning : ""}`}>
              {upload?.state === "error" ? "No se subió" : !slot ? "Sin foto" : slot.error
                ?? (slot.width !== undefined && slot.width < 1080 ? "Baja resolución"
                  : slot.width !== undefined && slot.height !== undefined ? `${slot.width}×${slot.height}` : "Foto elegida")}
            </span>
            {upload?.state === "error" ? <button className={styles.retryUpload} type="button" disabled={saving} onClick={() => onSave(ready)}>Reintentar</button> : null}
          </div>;
        })}</div>
        <div className={styles.sheetQuality}><strong>Calidad original</strong><p>Guardamos tus fotos sin comprimir para que la comparación sea fiel. JPG, PNG o WebP, hasta 20 MB por foto. Recomendado: 1080 px de ancho o más.</p></div>
      </div>
      <div className={styles.sheetFooter}>
        {status ? <p className={styles.sheetStatus} role="status">{status}</p> : null}
        {error ? <p className={styles.sheetError} role="alert">{error}</p> : null}
        <button className={styles.sheetSave} type="button" disabled={ready.length === 0 || saving || changing} onClick={() => onSave(ready)}>{saving ? "Subiendo…" : "Guardar check"}</button>
      </div>
    </div>
  </div>;
}
