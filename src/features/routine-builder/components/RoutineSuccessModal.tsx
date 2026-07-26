import { Save } from "lucide-react";

export interface RoutineSuccessModalProps {
  onConfirm: () => void;
}

export function RoutineSuccessModal({ onConfirm }: RoutineSuccessModalProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Registro exitoso">
      <div className="card confirm-modal success-modal">
        <div className="success-icon">
          <Save size={22} />
        </div>
        <h3>Registro exitoso</h3>
        <p>Tu rutina quedó guardada correctamente. Ahora puedes revisar el panel principal y comenzar a seguir tu progreso.</p>
        <button className="button success-solid" type="button" onClick={onConfirm}>
          OK
        </button>
      </div>
    </div>
  );
}
