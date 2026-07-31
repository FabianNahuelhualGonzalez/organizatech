/**
 * `TrainingReadiness` — valor de interfaz para readiness (motivación, hidratación, sueño,
 * energía u omitido). La pantalla mantiene sus inputs locales y entrega esta forma al root, que
 * conserva el valor aceptado y lo incluye en el workout draft cuando corresponde.
 *
 * Es estructuralmente idéntico hoy a `TrainingDailyReadinessPayload`
 * (`@/lib/training/training-daily-readiness-repository`), pero deliberadamente NO se unifican en
 * un solo tipo ni se declara uno como alias/extensión del otro:
 *
 * - `TrainingReadiness` representa el boundary de UI y borrador en memoria.
 * - `TrainingDailyReadinessPayload` representa el contrato de persistencia hacia el repositorio
 *   (lo que efectivamente viaja a Supabase).
 *
 * Que ambas formas coincidan campo por campo hoy es una coincidencia estructural, no una garantía
 * de que evolucionen juntas: el borrador de UI podría necesitar campos adicionales de solo-interfaz
 * (p.ej. estado de validación, foco de campo) sin que eso deba filtrarse al contrato de
 * persistencia, y viceversa. Mantenerlos como dos declaraciones independientes preserva esa
 * frontera aunque hoy sean idénticas.
 */
export interface TrainingReadiness {
  motivation?: number;
  hydration?: number;
  sleep?: number;
  energy?: number;
  skipped: boolean;
}

export function normalizeTrainingReadiness(value: unknown): TrainingReadiness | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<TrainingReadiness>;
  return {
    motivation: normalizeReadinessScore(parsed.motivation),
    hydration: normalizeReadinessScore(parsed.hydration),
    sleep: normalizeReadinessScore(parsed.sleep),
    energy: normalizeReadinessScore(parsed.energy),
    skipped: Boolean(parsed.skipped),
  };
}

function normalizeReadinessScore(value: unknown) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 7 ? score : undefined;
}
