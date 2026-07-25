/**
 * Estado puro de índice del carrusel del dashboard.
 *
 * Hallazgo de la investigación (confirmado por auditoría): el carrusel productivo NO tiene
 * un índice numérico en estado, NI botones de siguiente/anterior, NI ningún concepto de
 * "moverse N posiciones". La tarjeta activa se identifica por el nombre del día
 * (`activeCarouselDay`, string) y la navegación ocurre exclusivamente por scroll/swipe nativo,
 * resuelto por `resolveActiveCarouselIndex` (ya existente en
 * `training-carousel-card-presentation.ts`, no duplicado aquí).
 *
 * Este módulo reproduce ÚNICAMENTE el cálculo de índice que sí tiene una contraparte
 * productiva demostrable: `DashboardDayDots` — `Math.max(0, weekDays.indexOf(day))`. No se
 * agregan primitivas de "mover" el índice: producción no las tiene, y agregarlas sería
 * inventar una navegación next/previous que no existe.
 */

/** Igual a `DashboardDayDots`: `Math.max(0, weekDays.indexOf(day))`. */
export function resolveDashboardDotIndex(days: readonly string[], activeDay: string): number {
  return Math.max(0, days.indexOf(activeDay));
}
