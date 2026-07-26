import type { TrainingCycleId } from "@/lib/training/training-cycle-id";

export const TRAINING_CYCLE_PRESENTATIONS = [
  {
    id: "macro",
    title: "Macrociclo",
    summary: "Plan grande del objetivo principal.",
    detail:
      "Es la estructura más grande de planificación. Generalmente abarca entre 6 y 11 meses y se enfoca en el objetivo deportivo principal o la forma física deseada.",
  },
  {
    id: "meso",
    title: "Mesociclo",
    summary: "Bloques de 3 a 6 semanas.",
    detail:
      "Son bloques intermedios de entrenamiento. Cada mesociclo trabaja un objetivo específico como fuerza, hipertrofia, potencia, resistencia, descarga o definición.",
  },
  {
    id: "micro",
    title: "Microciclo",
    summary: "Organización semanal del entrenamiento.",
    detail:
      "Representa la planificación semanal. Ordena la distribución de cargas, descansos y tipos de entrenamiento durante la semana.",
  },
  {
    id: "session",
    title: "Sesión de entrenamiento",
    summary: "El entrenamiento de un día específico.",
    detail:
      "Es la unidad más pequeña del sistema. Contiene ejercicios, series, repeticiones, pesos, intensidad y métricas asociadas a ese día.",
  },
] as const satisfies ReadonlyArray<{
  id: TrainingCycleId;
  title: string;
  summary: string;
  detail: string;
}>;
