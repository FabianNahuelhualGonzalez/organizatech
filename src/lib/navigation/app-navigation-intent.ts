import type { Screen } from "@/lib/navigation/app-navigation";
import type { AppNotificationSection } from "@/lib/notifications/notification-types";

/**
 * Intenciones de navegación puras que hoy NO tienen equivalente en `app-navigation.ts` (no se
 * duplica nada de ese módulo: `Screen`, la navegación contextual y el back ya están cubiertos
 * ahí). Cada función reproduce exactamente una regla hoy inline en `organizatech-app.tsx`.
 *
 * Puro: sin React, sin DOM, sin storage, sin Supabase. Las cuatro funciones están integradas en
 * organizatech-app.tsx. La finalización de workouts, incluido el reintento de link de readiness
 * pendiente, se modela por separado mediante `resolveWorkoutCompletionTransition` en
 * `app-navigation-transition.ts`.
 */

/**
 * Sin entradas de entrenamiento registradas, el drawer se recorta a un subconjunto fijo de
 * pantallas (más "historial-ciclos"
 * solo si hay ciclos visibles); con entradas, se muestran todas las `primaryScreens`. Retorna
 * siempre un arreglo nuevo (no la misma referencia de `primaryScreens`) — una mejora de pureza
 * deliberada y segura: no se observó ningún punto del código que dependa de la identidad de
 * referencia del arreglo original.
 */
export function resolveMenuScreens(
  primaryScreens: readonly Screen[],
  hasTrainingEntries: boolean,
  visibleCycleHistoryCount: number,
): Screen[] {
  if (hasTrainingEntries) return [...primaryScreens];
  return primaryScreens.filter((item) =>
    item === "dashboard" ||
    item === "entrenamiento" ||
    item === "perfil" ||
    item === "comparacion" ||
    item === "registro-entrenamiento" ||
    (item === "historial-ciclos" && visibleCycleHistoryCount > 0)
  );
}

/**
 * Modela la condición de visibilidad de la fila "Volver": `screen !== "dashboard" && screen !==
 * "training-summary"`. No considera si `screenHistory`
 * está vacío (la propia producción tampoco lo hace hoy — `goBack()` cae a su fallback en ese
 * caso vía `resolveContextualBackNavigation`, ya cubierto en `app-navigation.ts`).
 */
export function canGoBackFromScreen(screen: Screen): boolean {
  return screen !== "dashboard" && screen !== "training-summary";
}

export interface DayStateReset {
  activeRoutineDay: string;
  dashboardDayOverride: string;
  comparisonDay: string;
}

/**
 * Devuelve el reseteo de día que acompaña las transiciones productivas de ciclo; no aplica los
 * valores (la aplicación via `setActiveRoutineDay`/`setDashboardDayOverride`/
 * `setComparisonDay` permanece en React).
 */
export function resolveDayStateReset(): DayStateReset {
  return { activeRoutineDay: "Lunes", dashboardDayOverride: "", comparisonDay: "Lunes" };
}

export interface NotificationScrollTarget {
  selector: string;
}

/**
 * Modela como intención pura el destino que `scrollToNotificationSection` ejecuta contra el DOM.
 * Este resolver sólo calcula el selector CSS equivalente (`[data-section="${section}"]`), sin
 * tocar `document`. La ejecución real
 * (`querySelector` + `scrollIntoView` + el resaltado con `setTimeout`) permanece,
 * intencionalmente, del lado de React.
 */
export function resolveNotificationScrollTarget(section: AppNotificationSection | null): NotificationScrollTarget | null {
  if (!section) return null;
  return { selector: `[data-section="${section}"]` };
}
