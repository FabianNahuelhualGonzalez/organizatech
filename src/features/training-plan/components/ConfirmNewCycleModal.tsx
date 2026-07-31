import { Button } from "@/ui/buttons/button";

export interface ConfirmNewCycleModalProps {
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmNewCycleModal({ isBusy, onCancel, onConfirm }: ConfirmNewCycleModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirmar nuevo ciclo">
      <div className="card confirm-modal">
        <h2>¿Estas seguro?</h2>
        <p>Si decides crear un nuevo ciclo de entrenamiento, finalizaremos el ciclo actual que tienes registrado.</p>
        <div className="modal-actions">
          <Button variant="danger" type="button" onClick={onCancel} disabled={isBusy}>No</Button>
          <Button variant="success" type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? "Finalizando..." : "Si"}
          </Button>
        </div>
      </div>
    </div>
  );
}
