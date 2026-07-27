import type { Screen } from "@/lib/navigation/app-navigation";
import type { AppNotificationSection } from "@/lib/notifications/notification-types";

/**
 * Intenciones de navegación puras que hoy NO tienen equivalente en `app-navigation.ts` (no se
 * duplica nada de ese módulo: `Screen`, la navegación contextual y el back ya están cubiertos
 * ahí). Cada función reproduce exactamente una regla hoy inline en `organizatech-app.tsx`.
 *
 * Puro: sin React, sin DOM, sin storage, sin Supabase. Integrado parcialmente en
 * organizatech-app.tsx desde P3-07A: `resolveMenuScreens`, `canGoBackFromScreen`,
 * `resolveDayStateReset` y `resolveNotificationScrollTarget` ya se usan en el root;
 * `resolveWorkoutCompletionScreen` queda pendiente de integrar para P3-07B.
 */

/**
 * Igual a `menuScreens` (organizatech-app.tsx:~3530-3538): sin entradas de entrenamiento
 * registradas, el drawer se recorta a un subconjunto fijo de pantallas (más "historial-ciclos"
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
 * Igual a la condición de visibilidad de la fila "Volver" (organizatech-app.tsx:~3676):
 * `screen !== "dashboard" && screen !== "training-summary"`. No considera si `screenHistory`
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
 * Igual al bloque de 3 líneas repetido de forma idéntica en `startNewTrainingCycle` (líneas
 * ~2455-2457, ~2489-2491) y `deleteCurrentTrainingCycle` (líneas ~2538-2540, ~2563-2565) — el
 * "reseteo de día" que acompaña toda transición de ciclo de entrenamiento. Devuelve el paquete de
 * valores, no los aplica (la aplicación via `setActiveRoutineDay`/`setDashboardDayOverride`/
 * `setComparisonDay` permanece en React).
 */
export function resolveDayStateReset(): DayStateReset {
  return { activeRoutineDay: "Lunes", dashboardDayOverride: "", comparisonDay: "Lunes" };
}

/**
 * Igual a la pantalla final tras completar un entrenamiento. `finishCompletedWorkout()`
 * (organizatech-app.tsx:2955-2962) fija `"dashboard"` como parte de la limpieza del intento
 * activo; su llamador aplica INMEDIATAMENTE después `setScreen("training-summary")` (líneas
 * ~3251-3252 y ~3324-3325, dentro del mismo lote de React). El destino EFECTIVO observable es
 * `"training-summary"` — este resolver documenta y devuelve ese destino final, no el valor
 * transitorio intermedio.
 */
export function resolveWorkoutCompletionScreen(): Screen {
  return "training-summary";
}

export interface NotificationScrollTarget {
  selector: string;
}

/**
 * Modela como INTENCIÓN pura el destino de scroll que hoy `scrollToNotificationSection`
 * (organizatech-app.tsx:3515-3528, function name y cuerpo con `document.querySelector`/
 * `window.setTimeout`/`scrollIntoView` fijados por contrato en
 * `notification-integration-contract.test.ts` — NO se toca ni se mueve esa función en esta
 * preparación) ejecuta directamente contra el DOM. Este resolver solo calcula el selector CSS
 * equivalente (`[data-section="${section}"]`), sin tocar `document`. La ejecución real
 * (`querySelector` + `scrollIntoView` + el resaltado con `setTimeout`) permanece,
 * intencionalmente, del lado de React.
 */
export function resolveNotificationScrollTarget(section: AppNotificationSection | null): NotificationScrollTarget | null {
  if (!section) return null;
  return { selector: `[data-section="${section}"]` };
}
