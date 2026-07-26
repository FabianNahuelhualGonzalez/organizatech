export interface ConfirmDeleteCycleModalProps {
  isBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteCycleModal({ isBusy, onCancel, onConfirm }: ConfirmDeleteCycleModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Eliminar ciclo actual">
      <div className="card confirm-modal">
        <h2>¿Eliminar ciclo actual?</h2>
        <p>Este ciclo dejará de estar visible en tu cuenta. Los datos asociados no se mostrarán en tu progreso actual.</p>
        <p>Esta acción no se puede deshacer desde la aplicación.</p>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isBusy}>Cancelar</button>
          <button className="button danger-solid" type="button" onClick={onConfirm} disabled={isBusy}>
            {isBusy ? "Eliminando..." : "Sí, eliminar ciclo"}
          </button>
        </div>
      </div>
    </div>
  );
}
