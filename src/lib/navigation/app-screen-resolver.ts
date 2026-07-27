/**
 * Resolución pura de la VARIANTE visual activa dentro de un `Screen` (organizatech-app.tsx,
 * bloque JSX ~3685-3818). No decide a qué `Screen` navegar (eso ya lo hace
 * `resolveContextualNavigation`/`resolveContextualBackNavigation` en `app-navigation.ts`, no
 * duplicado aquí) — decide, dado que el usuario ya está en un `Screen`, cuál de sus variantes
 * internas corresponde renderizar (bloqueado por plan cycle-scoped, vacío, formulario, etc.).
 *
 * Cada función reproduce EXACTAMENTE la cadena de condiciones `&&` hoy inline en el JSX,
 * incluyendo los huecos de cobertura reales (combinaciones donde ninguna rama actual renderiza
 * nada) — no se "arreglan" ni se inventan variantes nuevas para esos huecos; se los expone como
 * `"none"` para que la paridad sea honesta y verificable por contrato.
 *
 * Puro: sin React, sin DOM, sin storage, sin Supabase. No integrado todavía en
 * organizatech-app.tsx (P3-06 preparación).
 */

export type DashboardScreenVariant = "blocked" | "content";
export type ComparisonScreenVariant = "blocked" | "content";

/** Igual a `isCycleScopedPlanBlocked ? <CycleScopedPlanBlocker/> : <DashboardScreen/>` (línea ~3686). */
export function resolveDashboardScreenVariant(isCycleScopedPlanBlocked: boolean): DashboardScreenVariant {
  return isCycleScopedPlanBlocked ? "blocked" : "content";
}

/** Igual a `isCycleScopedPlanBlocked ? <CycleScopedPlanBlocker/> : <ComparisonScreenV2/>` (línea ~3809). */
export function resolveComparisonScreenVariant(isCycleScopedPlanBlocked: boolean): ComparisonScreenVariant {
  return isCycleScopedPlanBlocked ? "blocked" : "content";
}

export type RoutineBuilderVariant = "blocked" | "editor" | "management" | "none";

export interface ResolveRoutineBuilderVariantInput {
  isCycleScopedPlanBlocked: boolean;
  hasRoutinePlan: boolean;
  isEditingRoutinePlan: boolean;
}

/**
 * Igual a las tres condiciones independientes del bloque `registro-entrenamiento`:
 * - `isCycleScopedPlanBlocked && !isEditingRoutinePlan` → "blocked"
 * - `!isCycleScopedPlanBlocked && (!hasRoutinePlan || isEditingRoutinePlan)` → "editor"
 * - `!isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan` → "management"
 *
 * `isCycleScopedPlanBlocked && isEditingRoutinePlan` no coincide con NINGUNA de las tres
 * condiciones actuales — hoy no renderiza nada. Se preserva ese hueco tal cual, retornando
 * `"none"`, en vez de inventar una cuarta variante.
 */
export function resolveRoutineBuilderVariant(input: ResolveRoutineBuilderVariantInput): RoutineBuilderVariant {
  if (input.isCycleScopedPlanBlocked && !input.isEditingRoutinePlan) return "blocked";
  if (!input.isCycleScopedPlanBlocked && (!input.hasRoutinePlan || input.isEditingRoutinePlan)) return "editor";
  if (!input.isCycleScopedPlanBlocked && input.hasRoutinePlan && !input.isEditingRoutinePlan) return "management";
  return "none";
}

export type ActiveWorkoutVariant = "blocked" | "empty" | "start" | "readiness" | "guided" | "none";

export interface ResolveActiveWorkoutVariantInput {
  isCycleScopedPlanBlocked: boolean;
  hasRoutinePlan: boolean;
  isEditingRoutinePlan: boolean;
  hasStartedTraining: boolean;
  hasReadiness: boolean;
}

/**
 * Igual a las cinco condiciones independientes del bloque `entrenamiento`:
 * - `isCycleScopedPlanBlocked` → "blocked"
 * - `!isCycleScopedPlanBlocked && !hasRoutinePlan` → "empty" (no depende de isEditingRoutinePlan)
 * - `!isCycleScopedPlanBlocked && hasRoutinePlan && !isEditingRoutinePlan && !hasStartedTraining` → "start"
 * - `... && hasStartedTraining && !hasReadiness` → "readiness"
 * - `... && hasStartedTraining && hasReadiness` → "guided"
 *
 * `!isCycleScopedPlanBlocked && hasRoutinePlan && isEditingRoutinePlan` es el mismo tipo de hueco
 * que en `resolveRoutineBuilderVariant` (en producción `screen` pasa a `"registro-entrenamiento"`
 * antes de llegar a este estado, pero se modela igual, sin asumirlo): retorna `"none"`.
 */
export function resolveActiveWorkoutVariant(input: ResolveActiveWorkoutVariantInput): ActiveWorkoutVariant {
  if (input.isCycleScopedPlanBlocked) return "blocked";
  if (!input.hasRoutinePlan) return "empty";
  if (input.isEditingRoutinePlan) return "none";
  if (!input.hasStartedTraining) return "start";
  if (!input.hasReadiness) return "readiness";
  return "guided";
}

/**
 * Igual a la condición de validez de `training-summary`: `screen === "training-summary" &&
 * trainingCompletionSummary` (visibilidad, línea ~3712) y al efecto de saneamiento
 * `screen === "training-summary" && !trainingCompletionSummary → setScreen("dashboard")`
 * (línea ~830-834). Responde: dado que `screen === "training-summary"`, ¿sigue siendo válido
 * permanecer en esa pantalla?
 */
export function isTrainingSummaryScreenValid(hasTrainingCompletionSummary: boolean): boolean {
  return hasTrainingCompletionSummary;
}
