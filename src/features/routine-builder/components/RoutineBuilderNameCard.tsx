/**
 * Espejo EXACTO de la card inline `setup-card routine-name-card` de organizatech-app.tsx
 * (líneas ~4222-4233): nombre de la rutina del día activo. Input controlado sin `maxLength`, sin
 * `autoFocus` y sin `<label>` asociado — igual que el original.
 *
 * P3-47B: el `<input>` nativo pasó a la primitive compartida `TextInput`, que fija `type="text"`
 * explícito. El original no declaraba `type`, cuyo default HTML es precisamente `text`: el
 * comportamiento y el estilo son idénticos (la única regla por atributo en `globals.css` es
 * `.profile-field input[type="date"]`, que no aplica aquí).
 *
 * `onRoutineNameChange` emite el string crudo; el trim y el fallback al nombre del día ocurren
 * al guardar, en el contenedor. Sin estado propio, sin efectos, sin dominio.
 *
 * No integrado todavía (P3-19A preparación): el bloque original permanece en el root hasta
 * la integración.
 */

import { TextInput } from "@/ui/forms/text-input";

export interface RoutineBuilderNameCardProps {
  day: string;
  routineName: string;
  onRoutineNameChange: (value: string) => void;
}

export function RoutineBuilderNameCard({
  day,
  routineName,
  onRoutineNameChange,
}: RoutineBuilderNameCardProps) {
  return (
    <div className="setup-card routine-name-card">
      <div className="setup-section-heading">
        <p className="eyebrow">Rutina del día {day}</p>
        <h3>Nombre de la rutina</h3>
      </div>
      <TextInput
        className="setup-name-input"
        placeholder="Ej: Empuje, Jalón, Piernas"
        value={routineName}
        onChange={(event) => onRoutineNameChange(event.target.value)}
      />
    </div>
  );
}
