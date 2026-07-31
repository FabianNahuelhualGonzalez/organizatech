import type { ButtonHTMLAttributes } from "react";

/**
 * Primitive compartida de botón icon-only (P3-47B). Complementa a `Button` (P3-47A) para los
 * controles cuyo contenido es un icono y que, por tanto, dependen de `aria-label` para tener
 * nombre accesible.
 *
 * Garantía de tipos: `aria-label` es OBLIGATORIO en `IconButtonProps` (no opcional, no `?`), de
 * modo que el compilador —no una convención— impide crear un icon-only sin nombre accesible. Esto
 * responde al requisito de accesibilidad identificado en el inventario P3-46 para la categoría
 * `icon-button`.
 *
 * Deliberadamente NO incluye: lógica de busy, navegación, estado, dominio, prop `as`, variantes
 * universales ni `dangerouslySetInnerHTML`. Sólo compone la clase base y fija defaults seguros.
 */

const ICON_BUTTON_BASE_CLASS_NAME = "icon-button";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  "aria-label": string;
}

/**
 * `type`, `className` y `aria-label` se extraen de las props ANTES del spread, por lo que
 * `iconButtonProps` ya no puede contenerlos: el spread es incapaz de sobrescribirlos. Se aplican
 * además después del spread, de modo que la garantía no dependa únicamente del orden.
 *
 * `className` se COMPONE sobre la clase base (`icon-button ${className}`); nunca la reemplaza.
 */
export function IconButton({
  type = "button",
  className,
  "aria-label": ariaLabel,
  ...iconButtonProps
}: IconButtonProps) {
  const composedClassName = className
    ? `${ICON_BUTTON_BASE_CLASS_NAME} ${className}`
    : ICON_BUTTON_BASE_CLASS_NAME;

  return <button {...iconButtonProps} type={type} className={composedClassName} aria-label={ariaLabel} />;
}
