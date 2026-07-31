import { Button } from "@/ui/buttons/button";

export interface ConfirmRoutineUpdateModalProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmRoutineUpdateModal({ onCancel, onConfirm }: ConfirmRoutineUpdateModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar modificacion de rutina">
      <div className="card confirm-modal">
        <h2>Actualizar rutina</h2>
        <p>Si modificas esta rutina, se actualizará tu ciclo de entrenamiento actual. Los días eliminados dejarán de aparecer en el ciclo. ¿Quieres continuar?</p>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={onCancel}>Cancelar</Button>
          <Button variant="success" type="button" onClick={onConfirm}>Sí, actualizar rutina</Button>
        </div>
      </div>
    </div>
  );
}
