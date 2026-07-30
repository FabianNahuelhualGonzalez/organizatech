/**
 * `SetupExerciseRow`/`SetupDayState` — borrador de configuración de una rutina (el estado que el
 * usuario edita en la pantalla de registro de entrenamiento antes de guardarla).
 *
 * Son independientes de `TrainingPlan`: ambos tipos pueden coexistir en el mismo registro de
 * borrador persistido (`RoutineDraftStorageRecord`, en `@/lib/storage/app-flow-storage`) sin que
 * exista ninguna dependencia de tipos entre ellos — ese registro los trata como dos campos
 * hermanos, cada uno con su propio parámetro genérico independiente. Este módulo no importa
 * `TrainingPlan` ni ningún tipo de storage.
 *
 * El reducer, la normalización, el mapping y la recuperación canónicos viven bajo
 * `@/features/routine-builder/model`; el root conserva sólo la orquestación React y la generación
 * externa de IDs que requieren los flujos productivos.
 */

export interface SetupExerciseRow {
  id: string;
  sourceExerciseId?: string;
  exerciseLineageId?: string | null;
  name: string;
  sets: number;
  reps: number;
  weight: string;
}

export interface SetupDayState {
  routineName: string;
  rows: SetupExerciseRow[];
}
