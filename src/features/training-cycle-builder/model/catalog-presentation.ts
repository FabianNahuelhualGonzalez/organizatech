import type {
  TrainingCycleCatalogExerciseViewModel,
  TrainingCycleCatalogScope,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";

export const CYCLE_CATALOG_TABS = [
  { scope: "all", label: "Todos" },
  { scope: "previous", label: "Ciclo anterior" },
  { scope: "recent", label: "Recientes" },
] as const satisfies readonly { scope: TrainingCycleCatalogScope; label: string }[];

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-CL").trim();
}

/** Returning to an unfinished custom form must not erase the name already entered. */
export function resolveCycleCustomExerciseName(query: string, currentName: string) {
  return query.trim() || currentName;
}

export function filterCycleCatalog(
  catalog: readonly TrainingCycleCatalogExerciseViewModel[],
  query: string,
  scope: TrainingCycleCatalogScope,
) {
  const normalizedQuery = normalizeSearch(query);
  return catalog.filter((exercise) => {
    // Preserve the existing global search across names and muscle groups.
    if (normalizedQuery) {
      return normalizeSearch(exercise.name).includes(normalizedQuery) ||
        normalizeSearch(exercise.muscleGroup).includes(normalizedQuery);
    }
    return scope === "all" || exercise.sources.includes(scope);
  });
}

/** Called only for a successfully loaded catalog with no matching results. */
export function getCycleCatalogEmptyState(query: string, scope: TrainingCycleCatalogScope) {
  const search = query.trim();
  if (search) {
    return {
      title: `No encontramos “${search}”`,
      body: "Puedes crearlo: quedará guardado en tu cuenta para futuras rutinas.",
      showBrowse: true,
      createLabel: `Crear “${search}”`,
    };
  }
  return {
    title: scope === "previous"
      ? "Aún no tienes ejercicios de un ciclo anterior."
      : scope === "recent"
        ? "Aún no tienes ejercicios recientes."
        : "Aún no hay ejercicios disponibles en tu catálogo.",
    body: scope === "all"
      ? "Crea un ejercicio: quedará guardado en tu cuenta para futuras rutinas."
      : "Explora el catálogo o crea el que no encuentres: quedará guardado en tu cuenta para futuras rutinas.",
    showBrowse: scope !== "all",
    createLabel: "Crear ejercicio",
  };
}
