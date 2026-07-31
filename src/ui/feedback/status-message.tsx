import type { HTMLAttributes, ReactNode } from "react";

/**
 * Primitive compartida de mensaje dinámico accesible (P3-48B). Resuelve el hallazgo P0 del
 * inventario P3-46 (UI-003): los mensajes que aparecen como consecuencia de una acción del usuario
 * —guardado, error de carga, sesión requerida— se renderizaban como texto plano sin semántica de
 * live region, por lo que un lector de pantalla no los anunciaba. La única excepción correcta ya
 * existente en la base es `CycleHistoryStates`, cuyo patrón (`role="status"` + `aria-live="polite"`
 * para estados neutros y `role="alert"` para errores) se reutiliza aquí sin inventar uno nuevo.
 *
 * Primitive PURA de presentación: sin estado, sin efectos, sin negocio, sin navegación y sin
 * traducción de errores. No usa `dangerouslySetInnerHTML`.
 */

export type StatusMessageTone = "polite" | "error";

/**
 * `role` y `aria-live` se omiten del tipo: son la garantía semántica de la primitive y no pueden
 * llegar desde el consumidor. Combinado con aplicarlos DESPUÉS del spread, ningún atributo
 * arbitrario puede degradarlos.
 */
export interface StatusMessageProps
  extends Omit<HTMLAttributes<HTMLParagraphElement>, "role" | "aria-live" | "children"> {
  tone?: StatusMessageTone;
  children: ReactNode;
}

export function StatusMessage({ tone = "polite", className, children, ...statusMessageProps }: StatusMessageProps) {
  // `role="alert"` conlleva `aria-live="assertive"` de forma implícita: se deja sin declarar para
  // no duplicar el anuncio en los lectores que lo interpretan dos veces.
  if (tone === "error") {
    return (
      <p {...statusMessageProps} className={className} role="alert">
        {children}
      </p>
    );
  }

  return (
    <p {...statusMessageProps} className={className} role="status" aria-live="polite">
      {children}
    </p>
  );
}
