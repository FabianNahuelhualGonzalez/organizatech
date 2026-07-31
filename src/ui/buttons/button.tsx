import type { ButtonHTMLAttributes } from "react";

/**
 * Primitive compartida de botón (P3-47A). Extrae únicamente la composición de la clase base a
 * partir de las cuatro variantes que ya existen en `globals.css`; no introduce estilos nuevos ni
 * cambia la presentación actual.
 *
 * Deliberadamente NO incluye: lógica de negocio, manejo de `isBusy`, decisión de textos,
 * navegación, ni polimorfismo `as`. El label dinámico durante una operación en curso sigue siendo
 * responsabilidad del consumidor, que lo pasa como `children` — igual que antes de esta extracción.
 *
 * `IconButton` no se implementa en P3-47A: dentro del alcance autorizado no hay dos consumidores
 * seguros que lo justifiquen (los `icon-button` actuales viven en App Shell y el root, ambos fuera
 * de alcance).
 */

export type ButtonVariant = "primary" | "secondary" | "success" | "danger";

/**
 * Mapa explícito variante → clase existente. Las clases son las mismas que ya usan los
 * consumidores hoy; renombrarlas o unificarlas está fuera del alcance de esta tarea.
 */
const BUTTON_VARIANT_CLASS_NAMES: Record<ButtonVariant, string> = {
  primary: "button",
  secondary: "button secondary",
  success: "button success-solid",
  danger: "button danger-solid",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * `className` se extrae de las props y se COMPONE sobre la clase de la variante: nunca la
 * reemplaza. Además `className` y `type` se aplican después del spread, de modo que ningún
 * atributo arbitrario pueda sustituir silenciosamente la clase requerida ni el tipo resuelto.
 *
 * `type` por defecto es `"button"` para evitar el submit implícito del HTML; todos los
 * consumidores migrados en P3-47A lo pasan de forma explícita, así que el marcado renderizado es
 * idéntico al previo.
 */
export function Button({ variant = "primary", className, type = "button", ...buttonProps }: ButtonProps) {
  const variantClassName = BUTTON_VARIANT_CLASS_NAMES[variant];
  const composedClassName = className ? `${variantClassName} ${className}` : variantClassName;

  return <button {...buttonProps} type={type} className={composedClassName} />;
}
