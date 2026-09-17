export interface TrainingCycleProductLifecycleCallbacks {
  /** Contexto inmutable al que pertenece este controller. */
  readonly ownerContextKey: string;
  /** Contexto efectivo, actualizado de forma síncrona durante cada render. */
  readonly getCurrentContextKey: () => string | null;
  /**
   * Sincroniza los consumidores legacy con el ciclo canónico. El callback debe
   * devolver false cuando el owner capturado dejó de ser vigente o el refresh falló.
   */
  readonly onCycleChanged?: (cycleId: string) => Promise<boolean>;
  /** Se ejecuta sólo después de una sincronización legacy vigente y exitosa. */
  readonly onStartTraining?: (cycleId: string) => void | Promise<void>;
}

export interface TrainingCycleProductLifecycleController {
  readonly onCycleChanged: (cycleId: string) => Promise<boolean>;
  readonly onStartTraining: (cycleId: string) => Promise<boolean>;
}

/**
 * Mantiene dentro de la feature el orden refresh -> navegación. La captura de
 * identidad y el refresh legacy siguen siendo puertos del composition root.
 */
export function createTrainingCycleProductLifecycleController(
  callbacks: TrainingCycleProductLifecycleCallbacks,
): TrainingCycleProductLifecycleController {
  let startInFlight: Promise<boolean> | null = null;
  const ownsCurrentContext = () =>
    callbacks.getCurrentContextKey() === callbacks.ownerContextKey;

  const onCycleChanged = async (cycleId: string) => {
    const normalizedCycleId = cycleId.trim();
    if (!normalizedCycleId || !callbacks.onCycleChanged || !ownsCurrentContext()) return false;
    try {
      const refreshed = await callbacks.onCycleChanged(normalizedCycleId);
      return ownsCurrentContext() && refreshed === true;
    } catch {
      return false;
    }
  };

  const onStartTraining = (cycleId: string) => {
    if (startInFlight) return startInFlight;
    const operation = (async () => {
      const normalizedCycleId = cycleId.trim();
      if (!normalizedCycleId || !ownsCurrentContext()) return false;
      if (!await onCycleChanged(normalizedCycleId) || !ownsCurrentContext()) return false;
      try {
        await callbacks.onStartTraining?.(normalizedCycleId);
        return ownsCurrentContext();
      } catch {
        return false;
      }
    })();
    startInFlight = operation;
    void operation.then(() => {
      if (startInFlight === operation) startInFlight = null;
    });
    return operation;
  };

  return { onCycleChanged, onStartTraining };
}
