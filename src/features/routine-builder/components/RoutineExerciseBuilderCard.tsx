import { Trash2 } from "lucide-react";

import type { SetupExerciseRow } from "@/lib/training/training-routine-draft";

/**
 * Espejo EXACTO de la card inline `setup-card exercise-builder-card` de organizatech-app.tsx
 * (líneas ~4235-4267): cabecera, tabla de ejercicios (head + filas de 4 inputs + eliminar),
 * acciones "Agregar más"/guardar y mensaje de estado.
 *
 * Paridad deliberada con el original, sin "mejoras":
 * - Los 4 onChange emiten `event.target.value` crudo (string) — el parseo numérico y el filtro
 *   de peso decimal viven en el contenedor, no aquí.
 * - `value={row.sets || ""}` y `value={row.reps || ""}` muestran 0 como caja vacía;
 *   `value={row.name}` va sin coalescer, como el original.
 * - El botón de guardar usa `onClick={onSave}` por REFERENCIA DESNUDA: el SyntheticEvent fluye
 *   como primer argumento (hoy eso hace truthy el parámetro `confirmedRoutineUpdate` del
 *   contenedor). Envolverlo en `() => onSave()` cambiaría comportamiento observable.
 * - Etiqueta de guardar de tres vías: "Guardando..." / "Finalizar registro de rutina" /
 *   "Guardar y continuar".
 * - `message` llega YA FILTRADO por el contenedor (el original filtra dos strings de estado);
 *   este componente solo decide visibilidad por string vacío, igual que el original.
 * - Sin estado vacío para `rows.length === 0` (el original tampoco lo tiene) y sin `<label>`
 *   en los inputs (solo placeholders), igual que el original.
 *
 * Sin estado propio, sin efectos, sin dominio. No integrado todavía (P3-19A preparación): el
 * bloque original permanece en el root hasta la integración.
 */

export type SetupExerciseRowField = keyof Omit<SetupExerciseRow, "id" | "sourceExerciseId" | "exerciseLineageId">;

export interface RoutineExerciseBuilderCardProps {
  day: string;
  rows: readonly SetupExerciseRow[];
  isBusy: boolean;
  isLastPendingDay: boolean;
  message: string;
  onRowChange: (id: string, field: SetupExerciseRowField, value: string) => void;
  onAddRow: () => void;
  onRemoveRow: (id: string) => void;
  onSave: () => void;
}

export function RoutineExerciseBuilderCard({
  day,
  rows,
  isBusy,
  isLastPendingDay,
  message,
  onRowChange,
  onAddRow,
  onRemoveRow,
  onSave,
}: RoutineExerciseBuilderCardProps) {
  return (
    <div className="setup-card exercise-builder-card">
      <div className="setup-section-heading">
        <p className="eyebrow">Rutina del día {day}</p>
        <h3>Ejercicios a programar</h3>
      </div>
      <div className="setup-table">
        <div className="setup-table-head">
          <span>Nombre ejercicio</span>
          <span>Series</span>
          <span>Repeticiones</span>
          <span>Kg</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <div className="setup-row" key={row.id}>
            <input placeholder={`Ejercicio ${index + 1}`} value={row.name} onChange={(event) => onRowChange(row.id, "name", event.target.value)} />
            <input type="number" min={1} placeholder="Series" value={row.sets || ""} onChange={(event) => onRowChange(row.id, "sets", event.target.value)} />
            <input type="number" min={1} placeholder="Reps" value={row.reps || ""} onChange={(event) => onRowChange(row.id, "reps", event.target.value)} />
            <input inputMode="decimal" placeholder="Kg" value={row.weight || ""} onChange={(event) => onRowChange(row.id, "weight", event.target.value)} />
            <button className="row-delete" type="button" aria-label="Eliminar ejercicio" onClick={() => onRemoveRow(row.id)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="setup-actions">
        <button className="small-yellow-button" type="button" onClick={onAddRow}>Agregar más</button>
        <button className="start-button compact" type="button" onClick={onSave} disabled={isBusy}>
          {isBusy ? "Guardando..." : isLastPendingDay ? "Finalizar registro de rutina" : "Guardar y continuar"}
        </button>
      </div>
      {message ? <p className="setup-message">{message}</p> : null}
    </div>
  );
}
