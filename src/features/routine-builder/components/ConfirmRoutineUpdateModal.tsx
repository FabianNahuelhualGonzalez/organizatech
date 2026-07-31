import { ConfirmDialog } from "@/ui/modals/confirm-dialog";

export interface ConfirmRoutineUpdateModalProps {
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Sin estado busy: este diálogo nunca lo tuvo y P3-48A no lo inventa. `Escape` ejecuta `onCancel`,
 * que es la acción segura.
 */
export function ConfirmRoutineUpdateModal({ onCancel, onConfirm }: ConfirmRoutineUpdateModalProps) {
  return (
    <ConfirmDialog
      ariaLabel="Confirmar modificacion de rutina"
      title="Actualizar rutina"
      cancelLabel="Cancelar"
      cancelVariant="secondary"
      onCancel={onCancel}
      confirmLabel="Sí, actualizar rutina"
      confirmVariant="success"
      onConfirm={onConfirm}
    >
      <p>Si modificas esta rutina, se actualizará tu ciclo de entrenamiento actual. Los días eliminados dejarán de aparecer en el ciclo. ¿Quieres continuar?</p>
    </ConfirmDialog>
  );
}
