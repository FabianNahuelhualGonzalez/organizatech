import { getPublicErrorMessage } from "@/lib/errors/public-error";
import { translatePersistenceError } from "@/lib/supabase/auth-errors";
import { CycleScopedTrainingRepositoryError } from "@/lib/training/cycle-scoped-training-repository";
import { PROTECTED_ACTIVE_CYCLE_MESSAGE } from "@/lib/training/training-cycle-protection";
import { TrainingCycleRepositoryError } from "@/lib/training/training-cycles-repository";

/**
 * Traduce errores de las dos vías de gestión de ciclos (cycle-scoped y legacy) al texto que
 * ve el usuario. Los call-sites productivos no saben de antemano cuál de las dos clases va a
 * lanzarse, por eso este módulo une exactamente esas dos — ninguna otra clase de error de
 * training. No es un `training-error.ts` genérico.
 */
export function translateTrainingCycleRepositoryError(error: unknown) {
  if (error instanceof CycleScopedTrainingRepositoryError) {
    if (error.code === "session_required") return "Debes iniciar sesion para gestionar el plan del ciclo.";
    if (error.code === "session_expired") return "Tu sesion expiro. Inicia sesion nuevamente.";
    if (error.code === "invalid_plan") {
      return getPublicErrorMessage(
        error,
        "No pudimos validar el plan de entrenamiento. Revisa los datos e intenta nuevamente.",
      );
    }
    if (error.code === "active_cycle_exists") return "Ya existe un ciclo activo para tu cuenta.";
    if (error.code === "permission_denied") return "No tienes permisos para gestionar este plan de ciclo.";
    return "No pudimos completar la accion sobre el plan del ciclo.";
  }

  if (error instanceof TrainingCycleRepositoryError) {
    if (error.code === "session_required") return "Debes iniciar sesión para gestionar ciclos.";
    if (error.code === "session_expired") return "Tu sesión expiró. Inicia sesión nuevamente.";
    if (error.code === "active_cycle_exists") return "Ya existe un ciclo activo para tu cuenta.";
    if (error.code === "active_cycle_missing") return "No existe un ciclo activo para finalizar.";
    if (error.code === "protected_cycle") return PROTECTED_ACTIVE_CYCLE_MESSAGE;
    if (error.code === "permission_denied") return "No tienes permisos para acceder a este ciclo.";
    return "No pudimos completar la acción sobre ciclos.";
  }

  return translatePersistenceError(error);
}
