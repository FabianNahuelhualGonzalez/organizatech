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
          <button className="button danger-solid" type="button" onClick={onCancel} disabled={isBusy}>No</button>
          <button className="button success-solid" type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? "Finalizando..." : "Si"}
          </button>
        </div>
      </div>
    </div>
  );
}
