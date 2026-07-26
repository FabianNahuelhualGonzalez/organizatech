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
          <button className="button secondary" type="button" onClick={onCancel}>Cancelar</button>
          <button className="button success-solid" type="button" onClick={onConfirm}>Sí, actualizar rutina</button>
        </div>
      </div>
    </div>
  );
}
