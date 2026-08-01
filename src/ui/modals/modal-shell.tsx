"use client";

import type { ReactNode } from "react";

import {
  OVERLAY_INITIAL_FOCUS_ATTRIBUTE,
  useOverlayFocusManagement,
} from "@/ui/overlays/use-overlay-focus-management";

/**
 * Shell accesible compartido para los modales existentes (P3-48A, remediado tras auditoría;
 * refactorizado en P3-50B0). Resuelve la brecha identificada en el inventario P3-46: los modales
 * declaraban `role="dialog"` + `aria-modal` pero no gestionaban foco ni teclado.
 *
 * Desde P3-50B0 este componente NO implementa el algoritmo: delega ownership, foco, Tab/Shift+Tab,
 * Escape en capture, recuperación en busy y restauración en `useOverlayFocusManagement`, el motor
 * único compartido. No conserva stack, selector de enfocables ni listener propios — así Drawer y
 * NotificationPanel podrán conectarse al MISMO stack en fases posteriores.
 *
 * Su responsabilidad se reduce a la envoltura visual y semántica: backdrop, `role="dialog"`,
 * `aria-modal`, `aria-label`, la clase de la card y `tabIndex={-1}` sobre el contenedor enfocable.
 *
 * Deliberadamente NO hace: cerrar al pulsar el backdrop (los modales actuales no lo hacen), tocar
 * `document.body`/scroll global/navegación, usar repositories/storage/Supabase/estado de dominio,
 * aceptar objetos genéricos de configuración, ni `dangerouslySetInnerHTML`.
 */

/**
 * Alias compatible: los consumidores migrados en P3-48A escriben esta marca en el DOM. Se re-exporta
 * apuntando al marcador genérico del motor compartido, conservando el MISMO valor de atributo, de
 * modo que ningún consumidor cambia.
 */
export const MODAL_INITIAL_FOCUS_ATTRIBUTE = OVERLAY_INITIAL_FOCUS_ATTRIBUTE;

export interface ModalShellProps {
  ariaLabel: string;
  onClose: () => void;
  /** Cuando es `false`, `Escape` no cierra (p. ej. mientras una operación está en curso). */
  canClose?: boolean;
  /** Clase de la card interna; conserva exactamente las clases existentes de cada consumidor. */
  cardClassName: string;
  children: ReactNode;
}

export function ModalShell({
  ariaLabel,
  onClose,
  canClose = true,
  cardClassName,
  children,
}: ModalShellProps) {
  // `isActive` es siempre `true`: `ModalShell` sólo se renderiza cuando el modal está abierto.
  const dialogRef = useOverlayFocusManagement<HTMLDivElement>({ isActive: true, onClose, canClose });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div ref={dialogRef} className={cardClassName} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
