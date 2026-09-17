"use client";

import { Plus, Search } from "lucide-react";
import type { Dispatch } from "react";

import {
  TRAINING_CYCLE_DAY_LABELS,
  type TrainingCycleBuilderInitialViewModel,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import type {
  TrainingCycleBuilderAction,
  TrainingCycleBuilderState,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  CYCLE_CATALOG_TABS,
  filterCycleCatalog,
  getCycleCatalogEmptyState,
  resolveCycleCustomExerciseName,
} from "@/features/training-cycle-builder/model/catalog-presentation";
import { CycleCatalogAdditionNotice } from "./cycle-catalog-addition-notice";
import { PrimaryAction, ScreenHeading, SecondaryAction } from "./training-cycle-builder-ui";
import styles from "./training-cycle-builder.module.css";

export function CycleCatalogScreen({
  state,
  viewModel,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: Dispatch<TrainingCycleBuilderAction>;
}) {
  const results = filterCycleCatalog(viewModel.catalog, state.catalogQuery, state.catalogScope);
  const emptyState = getCycleCatalogEmptyState(state.catalogQuery, state.catalogScope);
  const createCustomExercise = () => {
    const name = resolveCycleCustomExerciseName(state.catalogQuery, state.customName);
    if (name !== state.customName) dispatch({ type: "set_custom_name", value: name });
    dispatch({ type: "navigate", screen: "custom" });
  };

  return (
    <div className={styles.screen}>
      <CycleCatalogAdditionNotice addition={state.catalogAddition} dispatch={dispatch} />
      <ScreenHeading title={`Agregar a ${TRAINING_CYCLE_DAY_LABELS[state.currentDay]}`} />
      <label className={styles.searchField}>
        <Search size={16} aria-hidden="true" />
        <span className={styles.srOnly}>Buscar ejercicio o grupo</span>
        <input
          type="search"
          placeholder="Buscar ejercicio o grupo…"
          value={state.catalogQuery}
          onChange={(event) => dispatch({ type: "set_catalog_query", value: event.target.value })}
        />
      </label>
      <div className={styles.segmentedControl} role="group" aria-label="Origen del catálogo">
        {CYCLE_CATALOG_TABS.map(({ scope, label }) => (
          <button
            type="button"
            key={scope}
            data-selected={state.catalogScope === scope}
            aria-pressed={state.catalogScope === scope}
            onClick={() => dispatch({ type: "set_catalog_scope", scope })}
          >
            {label}
          </button>
        ))}
      </div>
      {results.length ? (
        <ul className={styles.catalogList}>
          {results.map((exercise) => (
            <li key={exercise.id}>
              <div>
                <strong>{exercise.name}</strong>
                <span><small className={styles.groupTag}>{exercise.muscleGroup}</small>{exercise.sources.includes("previous") ? <small>Del ciclo anterior</small> : exercise.sources.includes("recent") ? <small>Reciente</small> : null}</span>
              </div>
              <button
                type="button"
                aria-label={`Agregar ${exercise.name}`}
                onClick={() => dispatch({
                  type: "add_catalog_exercise",
                  source: exercise.source,
                  name: exercise.name,
                  muscleGroup: exercise.muscleGroup,
                  videoUrl: exercise.videoUrl,
                  recommendation: exercise.recommendation ?? {
                    hasHistory: false,
                    title: "Sin historial suficiente",
                    body: "Partimos con una carga conservadora que puedes modificar.",
                    source: "Sugerencia inicial conservadora.",
                  },
                })}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={styles.noResults}>
          <div role="status" aria-live="polite">
            <strong>{emptyState.title}</strong>
            <p>{emptyState.body}</p>
          </div>
          <div className={styles.catalogEmptyActions}>
            {emptyState.showBrowse ? (
              <SecondaryAction onClick={() => {
                dispatch({ type: "set_catalog_query", value: "" });
                dispatch({ type: "set_catalog_scope", scope: "all" });
              }}>
                Ver ejercicios
              </SecondaryAction>
            ) : null}
            <SecondaryAction onClick={createCustomExercise}>{emptyState.createLabel}</SecondaryAction>
          </div>
        </div>
      )}
      {results.length ? (
        <SecondaryAction onClick={createCustomExercise}>
          <Plus size={15} aria-hidden="true" />Crear un ejercicio personalizado
        </SecondaryAction>
      ) : null}
      <PrimaryAction onClick={() => dispatch({ type: "return_to", screen: "routine" })}>
        Listo · ir a la rutina
      </PrimaryAction>
    </div>
  );
}
