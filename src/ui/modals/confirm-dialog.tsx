import type { ReactNode } from "react";

import { Button, type ButtonVariant } from "@/ui/buttons/button";
import { MODAL_INITIAL_FOCUS_ATTRIBUTE, ModalShell } from "@/ui/modals/modal-shell";

/**
 * Diálogo de confirmación compartido (P3-48A). Se compone sobre `ModalShell` y reutiliza la
 * primitive `Button` (P3-47A): no reimplementa backdrop, card, ARIA, foco ni teclado.
 *
 * Extrae la estructura que los tres modales de confirmación repetían de forma idéntica según el
 * inventario P3-46 (candidato UI-002): card `confirm-modal`, título `h2`, contenido descriptivo y
 * fila `modal-actions` con cancelar + confirmar.
 *
 * NO es un componente universal: sólo modela "cancelar / confirmar". Sin navegación, sin lógica de
 * negocio y sin props booleanas ajenas a esa decisión. El modal de éxito NO lo usa (tiene una sola
 * acción y otra jerarquía) y se compone directamente sobre `ModalShell`.
 */

export interface ConfirmDialogProps {
  ariaLabel: string;
  title: string;
  children: ReactNode;
  cancelLabel: string;
  cancelVariant: ButtonVariant;
  onCancel: () => void;
  confirmLabel: string;
  confirmBusyLabel?: string;
  confirmVariant: ButtonVariant;
  onConfirm: () => void;
  /**
   * Operación en curso: deshabilita ambas acciones y bloquea el cierre con `Escape`, para que el
   * usuario no pueda abandonar el diálogo mientras se persiste.
   */
  isBusy?: boolean;
}

export function ConfirmDialog({
  ariaLabel,
  title,
  children,
  cancelLabel,
  cancelVariant,
  onCancel,
  confirmLabel,
  confirmBusyLabel,
  confirmVariant,
  onConfirm,
  isBusy = false,
}: ConfirmDialogProps) {
  return (
    <ModalShell ariaLabel={ariaLabel} onClose={onCancel} canClose={!isBusy} cardClassName="card confirm-modal">
      <h2>{title}</h2>
      {children}
      <div className="modal-actions">
        {/*
          El foco inicial va a la acción segura (cancelar) cuando está habilitada: si hay una
          operación en curso ambas acciones están deshabilitadas y `ModalShell` recurre a su
          fallback sobre el contenedor del diálogo.
        */}
        <Button
          variant={cancelVariant}
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          {...{ [MODAL_INITIAL_FOCUS_ATTRIBUTE]: isBusy ? undefined : "" }}
        >
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} type="button" onClick={onConfirm} disabled={isBusy}>
          {isBusy && confirmBusyLabel ? confirmBusyLabel : confirmLabel}
        </Button>
      </div>
    </ModalShell>
  );
}
