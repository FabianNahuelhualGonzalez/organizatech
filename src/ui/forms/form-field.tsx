import type { ReactNode } from "react";

/**
 * Primitive compartida de campo de formulario (P3-47A). Extrae la estructura de `ProfileField`
 * tal como existía en `ProfileScreen`: `<label>` envolvente, texto del label en `<span>`, control
 * como `children` y error opcional en `<small>`.
 *
 * La clase se recibe por prop y no tiene valor por defecto: la primitive no presume la clase de
 * ninguna feature. Profile pasa `profile-field`, que es la clase que ya usaba.
 *
 * Deliberadamente NO es un formulario genérico ni una abstracción universal de
 * input/select/textarea: el control lo sigue proveyendo el consumidor, con sus propios eventos,
 * valores, `readOnly`, `inputMode` y `autoComplete` intactos.
 *
 * `controlId` mantiene asociada la etiqueta explicita al control provisto por el consumidor. El
 * mensaje opcional recibe un id determinista para que el consumidor pueda referenciarlo sin que
 * la primitive inspeccione o modifique `children`.
 */

export interface FormFieldProps {
  controlId: string;
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ controlId, label, error, className, children }: FormFieldProps) {
  const errorId = `${controlId}-error`;

  return (
    <label className={className} htmlFor={controlId}>
      <span>{label}</span>
      {children}
      {error && <small id={errorId}>{error}</small>}
    </label>
  );
}
