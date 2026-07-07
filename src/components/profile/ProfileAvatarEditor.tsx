"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Check, X } from "lucide-react";

import {
  exportAvatarImage,
  getAvatarEditorInitialState,
  loadAvatarImage,
} from "@/lib/profile/profile-avatar-image";

export function ProfileAvatarEditor({
  file,
  isOpen,
  isSaving = false,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  isOpen: boolean;
  isSaving?: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void> | void;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(() => getAvatarEditorInitialState().zoom);
  const [offset, setOffset] = useState(() => ({
    x: getAvatarEditorInitialState().offsetX,
    y: getAvatarEditorInitialState().offsetY,
  }));
  const [error, setError] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);

  useEffect(() => {
    if (!isOpen || !file) return undefined;

    let isMounted = true;
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setLoadedImage(null);
    setError("");
    setZoom(1);
    setOffset({ x: 0, y: 0 });

    void loadAvatarImage(file)
      .then((image) => {
        if (isMounted) setLoadedImage(image);
      })
      .catch(() => {
        if (isMounted) setError("No pudimos cargar esta imagen. Prueba con otra foto.");
      });

    return () => {
      isMounted = false;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, isOpen]);

  const imageStyle = useMemo(() => ({
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
  }), [offset.x, offset.y, zoom]);

  if (!isOpen || !file) return null;

  async function handleConfirm() {
    if (!loadedImage) {
      setError("No pudimos cargar esta imagen. Prueba con otra foto.");
      return;
    }

    setIsPreparing(true);
    setError("");
    try {
      const previewSize = previewRef.current?.clientWidth || 248;
      const outputRatio = 512 / previewSize;
      const optimizedFile = await exportAvatarImage({
        image: loadedImage,
        zoom,
        offsetX: offset.x * outputRatio,
        offsetY: offset.y * outputRatio,
      });
      await onConfirm(optimizedFile);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No pudimos guardar la foto. Prueba con otra imagen.");
    } finally {
      setIsPreparing(false);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const nextX = offset.x + event.clientX - drag.x;
    const nextY = offset.y + event.clientY - drag.y;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    setOffset({
      x: clampEditorOffset(nextX),
      y: clampEditorOffset(nextY),
    });
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  const busy = isSaving || isPreparing;

  return (
    <div className="profile-avatar-editor-overlay" role="dialog" aria-modal="true" aria-label="Ajustar foto de perfil">
      <div className="profile-avatar-editor">
        <div className="profile-avatar-editor-header">
          <button type="button" aria-label="Cerrar editor de foto" onClick={onCancel} disabled={busy}>
            <X size={18} aria-hidden="true" />
          </button>
          <h3>Foto de perfil</h3>
          <button type="button" aria-label="Guardar foto de perfil" onClick={() => void handleConfirm()} disabled={busy || !loadedImage}>
            <Check size={18} aria-hidden="true" />
          </button>
        </div>

        <p>Elige una foto para tu perfil.</p>
        <div
          ref={previewRef}
          className="profile-avatar-editor-preview"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        >
          {previewUrl && !error && (
            <img src={previewUrl} alt="" draggable={false} style={imageStyle} />
          )}
        </div>
        <p className="profile-avatar-editor-help">Ajusta tu foto dentro del círculo.</p>

        <label className="profile-avatar-zoom">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="2.6"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            disabled={busy || !loadedImage}
          />
        </label>

        {error && <p className="profile-avatar-status">{error}</p>}
        <div className="profile-avatar-editor-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className="button" type="button" onClick={() => void handleConfirm()} disabled={busy || !loadedImage}>
            {busy ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function clampEditorOffset(value: number) {
  return Math.min(Math.max(value, -96), 96);
}
