/**
 * `TrainingReadiness` — estado/borrador de interfaz para el formulario de readiness (motivación,
 * hidratación, sueño, energía, u omitido). Es la forma que React mantiene en `useState` mientras
 * el usuario completa o edita el formulario, ANTES de que ese valor se convierta en un contrato de
 * persistencia.
 *
 * Es estructuralmente idéntico hoy a `TrainingDailyReadinessPayload`
 * (`@/lib/training/training-daily-readiness-repository`), pero deliberadamente NO se unifican en
 * un solo tipo ni se declara uno como alias/extensión del otro:
 *
 * - `TrainingReadiness` representa estado de edición en memoria (dominio de UI/borrador).
 * - `TrainingDailyReadinessPayload` representa el contrato de persistencia hacia el repositorio
 *   (lo que efectivamente viaja a Supabase).
 *
 * Que ambas formas coincidan campo por campo hoy es una coincidencia estructural, no una garantía
 * de que evolucionen juntas: el borrador de UI podría necesitar campos adicionales de solo-interfaz
 * (p.ej. estado de validación, foco de campo) sin que eso deba filtrarse al contrato de
 * persistencia, y viceversa. Mantenerlos como dos declaraciones independientes preserva esa
 * frontera aunque hoy sean idénticas. No se toca `TrainingDailyReadinessPayload`,
 * `saveDailyTrainingReadiness` ni `toTrainingWorkoutReadinessPayload` en esta preparación.
 */
export interface TrainingReadiness {
  motivation?: number;
  hydration?: number;
  sleep?: number;
  energy?: number;
  skipped: boolean;
}
