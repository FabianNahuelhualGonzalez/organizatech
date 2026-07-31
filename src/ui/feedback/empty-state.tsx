/**
 * Primitive compartida de estado vacío (P3-48B). Deliberadamente MÍNIMA: sólo el caso "texto simple
 * de vacío", que es el único subconjunto que el inventario P3-46 (UI-009) identificó como
 * unificable. Los demás tratamientos de vacío de la app (`empty-dashboard` con hero y CTA,
 * `weekly-comparison-empty` dentro de una tabla) comparten intención pero NO estructura, y forzarlos
 * a una sola primitive habría sido el error que el propio inventario descartó.
 *
 * `drawer-empty` tampoco se migra: es un backdrop/botón, no un estado vacío.
 *
 * Un estado vacío que aparece tras una carga debe anunciarse, de ahí `role="status"`. Sin diseño
 * propio, sin iconos, sin acciones y sin configuración universal: la clase visual la aporta el
 * consumidor. Pura, sin estado, sin efectos, sin negocio ni navegación.
 */

export interface EmptyStateProps {
  message: string;
  className?: string;
}

export function EmptyState({ message, className }: EmptyStateProps) {
  return (
    <p className={className} role="status">
      {message}
    </p>
  );
}
