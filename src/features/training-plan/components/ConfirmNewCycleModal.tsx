import { ConfirmDialog } from "@/ui/modals/confirm-dialog";

export interface ConfirmNewCycleModalProps {
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmNewCycleModal({ isBusy, onCancel, onConfirm }: ConfirmNewCycleModalProps) {
  return (
    <ConfirmDialog
      ariaLabel="Confirmar nuevo ciclo"
      title="¿Estas seguro?"
      cancelLabel="No"
      cancelVariant="danger"
      onCancel={onCancel}
      confirmLabel="Si"
      confirmBusyLabel="Finalizando..."
      confirmVariant="success"
      onConfirm={onConfirm}
      isBusy={isBusy}
    >
      <p>Si decides crear un nuevo ciclo de entrenamiento, finalizaremos el ciclo actual que tienes registrado.</p>
    </ConfirmDialog>
  );
}
