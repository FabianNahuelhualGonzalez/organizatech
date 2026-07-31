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
 * El label sigue siendo IMPLÍCITO (sin `htmlFor`/`id`), igual que antes. Migrar a label explícito
 * con `aria-describedby`/`aria-invalid` cambiaría la API (exigiría un `id` por campo) y la
 * presentación del error, por lo que pertenece a P3-50 y no se adelanta aquí.
 */

export interface FormFieldProps {
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, error, className, children }: FormFieldProps) {
  return (
    <label className={className}>
      <span>{label}</span>
      {children}
      {error && <small>{error}</small>}
    </label>
  );
}
