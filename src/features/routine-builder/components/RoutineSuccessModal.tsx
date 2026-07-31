import { Save } from "lucide-react";

import { Button } from "@/ui/buttons/button";
import { MODAL_INITIAL_FOCUS_ATTRIBUTE, ModalShell } from "@/ui/modals/modal-shell";

export interface RoutineSuccessModalProps {
  onConfirm: () => void;
}

/**
 * Usa `ModalShell` y NO `ConfirmDialog`: tiene una sola acción, jerarquía `h3` y un icono propio,
 * por lo que no encaja en el patrón cancelar/confirmar. `Escape` ejecuta el mismo cierre que `OK`,
 * que aquí es la única salida posible.
 */
export function RoutineSuccessModal({ onConfirm }: RoutineSuccessModalProps) {
  return (
    <ModalShell ariaLabel="Registro exitoso" onClose={onConfirm} cardClassName="card confirm-modal success-modal">
      <div className="success-icon">
        <Save size={22} />
      </div>
      <h3>Registro exitoso</h3>
      <p>Tu rutina quedó guardada correctamente. Ahora puedes revisar el panel principal y comenzar a seguir tu progreso.</p>
      <Button variant="success" type="button" onClick={onConfirm} {...{ [MODAL_INITIAL_FOCUS_ATTRIBUTE]: "" }}>
        OK
      </Button>
    </ModalShell>
  );
}
