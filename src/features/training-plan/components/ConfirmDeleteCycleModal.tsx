import { ConfirmDialog } from "@/ui/modals/confirm-dialog";

export interface ConfirmDeleteCycleModalProps {
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteCycleModal({ isBusy, onCancel, onConfirm }: ConfirmDeleteCycleModalProps) {
  return (
    <ConfirmDialog
      ariaLabel="Eliminar ciclo actual"
      title="¿Eliminar ciclo actual?"
      cancelLabel="Cancelar"
      cancelVariant="secondary"
      onCancel={onCancel}
      confirmLabel="Sí, eliminar ciclo"
      confirmBusyLabel="Eliminando..."
      confirmVariant="danger"
      onConfirm={onConfirm}
      isBusy={isBusy}
    >
      <p>Este ciclo dejará de estar visible en tu cuenta. Los datos asociados no se mostrarán en tu progreso actual.</p>
      <p>Esta acción no se puede deshacer desde la aplicación.</p>
    </ConfirmDialog>
  );
}
