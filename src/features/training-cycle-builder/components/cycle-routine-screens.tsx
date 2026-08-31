"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  EllipsisVertical,
  Info,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  Video,
  X,
} from "lucide-react";
import type { Dispatch } from "react";

import {
  TRAINING_CYCLE_DAY_LABELS,
  TRAINING_CYCLE_DAY_SHORT_LABELS,
  TRAINING_CYCLE_MUSCLE_GROUPS,
  TRAINING_CYCLE_TECHNIQUE_LABELS,
  TRAINING_CYCLE_TECHNIQUES,
  type TrainingCycleBuilderInitialViewModel,
  type TrainingCycleCatalogExerciseViewModel,
  type TrainingCycleCatalogScope,
  type TrainingCycleExerciseDraft,
  type TrainingCycleTechnique,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import type {
  TrainingCycleBuilderAction,
  TrainingCycleBuilderState,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  getMuscleDistribution,
  getTrainingCycleWarnings,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import { validateOptionalYouTubeVideoUrl } from "@/features/training-cycle-builder/hooks/training-cycle-video-url";
import {
  BottomSheet,
  ChoiceChip,
  PrimaryAction,
  ScreenHeading,
  SecondaryAction,
  StatusBanner,
} from "@/features/training-cycle-builder/components/training-cycle-builder-ui";
import styles from "@/features/training-cycle-builder/components/training-cycle-builder.module.css";

type BuilderDispatch = Dispatch<TrainingCycleBuilderAction>;

function exerciseSpecification(exercise: TrainingCycleExerciseDraft) {
  const repetitions = [...new Set(exercise.sets.map((set) => set.targetReps))];
  const kilograms = [...new Set(exercise.sets.map((set) => set.targetKg))];
  return `${exercise.sets.length}×${repetitions.length === 1 ? repetitions[0] : "var"} · ${kilograms.length === 1 ? kilograms[0] : "var"}kg`;
}

export function CycleRoutineScreen({
  state,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: BuilderDispatch;
}) {
  const routine = state.draft.routines[state.currentDay];
  const warnings = getTrainingCycleWarnings(state.draft, state.currentDay);
  const groupCount = new Set(routine.exercises.map((exercise) => exercise.muscleGroup)).size;
  return (
    <div className={styles.screen}>
      <div className={styles.dayTabs} role="tablist" aria-label="Días de entrenamiento">
        {state.draft.selectedDays.map((day) => {
          const selected = day === state.currentDay;
          return (
            <button
              role="tab"
              type="button"
              key={day}
              aria-selected={selected}
              data-selected={selected}
              onClick={() => dispatch({ type: "select_day", day })}
            >
              <strong>{TRAINING_CYCLE_DAY_SHORT_LABELS[day]}</strong>
              <small>{state.draft.routines[day].exercises.length} ej.</small>
            </button>
          );
        })}
      </div>
      <label className={styles.routineNameField}>
        <span>Nombre de la rutina de {TRAINING_CYCLE_DAY_LABELS[state.currentDay]}</span>
        <input
          value={routine.name}
          placeholder="Ej: Empuje, Jalón, Piernas…"
          onChange={(event) => dispatch({ type: "set_routine_name", value: event.target.value })}
        />
      </label>
      {warnings.slice(0, 2).map((warning) => (
        <StatusBanner key={warning} tone="warning" title="Revisa tu distribución" body={warning} />
      ))}
      <div className={styles.sectionTitleRow}>
        <h3>Ejercicios</h3>
        <span>{routine.exercises.length} ejercicios · {groupCount} grupos</span>
      </div>
      {routine.exercises.length === 0 ? (
        <div className={styles.emptyRoutine}>
          <TriangleAlert size={20} aria-hidden="true" />
          <strong>Este día todavía está vacío</strong>
          <p>Puedes agregar ejercicios o dejarlo así por ahora. Es un aviso y no bloquea el ciclo.</p>
        </div>
      ) : (
        <ol className={styles.exerciseList}>
          {routine.exercises.map((exercise, index) => {
            const menuOpen = state.openExerciseMenuId === exercise.id;
            return (
              <li key={exercise.id} data-menu-open={menuOpen}>
                <div className={styles.exerciseRow}>
                  <span className={styles.exerciseOrder}>{index + 1}</span>
                  <button
                    className={styles.exerciseMain}
                    type="button"
                    onClick={() => dispatch({ type: "open_exercise", exerciseId: exercise.id })}
                  >
                    <strong>{exercise.name}</strong>
                    <span>
                      <small className={styles.groupTag}>{exercise.muscleGroup}</small>
                      <small>{exerciseSpecification(exercise)}</small>
                      {exercise.technique !== "linear" ? <small className={styles.techniqueTag}>{TRAINING_CYCLE_TECHNIQUE_LABELS[exercise.technique]}</small> : null}
                      {exercise.videoUrl && validateOptionalYouTubeVideoUrl(exercise.videoUrl).valid
                        ? <Video size={12} aria-label="Con video" />
                        : null}
                    </span>
                  </button>
                  <button
                    className={styles.touchIconButton}
                    type="button"
                    aria-label={`Acciones de ${exercise.name}`}
                    aria-expanded={menuOpen}
                    onClick={() => dispatch({ type: "toggle_exercise_menu", exerciseId: exercise.id })}
                  >
                    <EllipsisVertical size={17} aria-hidden="true" />
                  </button>
                </div>
                {menuOpen ? (
                  <div className={styles.exerciseActions}>
                    <button type="button" disabled={index === 0} onClick={() => dispatch({ type: "move_exercise", exerciseId: exercise.id, direction: "up" })}><ArrowUp size={13} aria-hidden="true" />Subir</button>
                    <button type="button" disabled={index === routine.exercises.length - 1} onClick={() => dispatch({ type: "move_exercise", exerciseId: exercise.id, direction: "down" })}><ArrowDown size={13} aria-hidden="true" />Bajar</button>
                    <button type="button" onClick={() => dispatch({ type: "duplicate_exercise", exerciseId: exercise.id })}><Copy size={13} aria-hidden="true" />Duplicar</button>
                    <button type="button" data-danger onClick={() => dispatch({ type: "remove_exercise", exerciseId: exercise.id })}><Trash2 size={13} aria-hidden="true" />Eliminar</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div className={styles.routineActions}>
        <SecondaryAction onClick={() => dispatch({ type: "navigate", screen: "catalog" })}>
          <Plus size={15} aria-hidden="true" />Agregar ejercicio
        </SecondaryAction>
        <div>
          <SecondaryAction onClick={() => dispatch({ type: "open_copy", mode: "exercises" })}>Copiar ejercicios de otro día</SecondaryAction>
          <SecondaryAction onClick={() => dispatch({ type: "open_copy", mode: "day" })}>Copiar día completo</SecondaryAction>
        </div>
      </div>
      <SecondaryAction onClick={() => dispatch({ type: "navigate", screen: "muscle" })}>
        Ver distribución muscular <span aria-hidden="true">›</span>
      </SecondaryAction>
      <PrimaryAction onClick={() => dispatch({ type: "navigate", screen: "review" })}>
        Revisar el ciclo completo
      </PrimaryAction>
    </div>
  );
}

const DIACRITICS = /[\u0300-\u036f]/g;
function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(DIACRITICS, "").toLocaleLowerCase("es-CL").trim();
}

const CATALOG_SCOPE_LABELS: Record<TrainingCycleCatalogScope, string> = {
  previous: "Ciclo anterior",
  recent: "Recientes",
  all: "Todos",
};

function filterCatalog(
  catalog: readonly TrainingCycleCatalogExerciseViewModel[],
  query: string,
  scope: TrainingCycleCatalogScope,
) {
  const normalizedQuery = normalizeSearch(query);
  return catalog.filter((exercise) => {
    if (normalizedQuery) {
      return normalizeSearch(exercise.name).includes(normalizedQuery) ||
        normalizeSearch(exercise.muscleGroup).includes(normalizedQuery);
    }
    return scope === "all" || exercise.sources.includes(scope);
  });
}

export function CycleCatalogScreen({
  state,
  viewModel,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: BuilderDispatch;
}) {
  const results = filterCatalog(viewModel.catalog, state.catalogQuery, state.catalogScope);
  return (
    <div className={styles.screen}>
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
        {(Object.keys(CATALOG_SCOPE_LABELS) as TrainingCycleCatalogScope[]).map((scope) => (
          <button
            type="button"
            key={scope}
            data-selected={state.catalogScope === scope}
            aria-pressed={state.catalogScope === scope}
            onClick={() => dispatch({ type: "set_catalog_scope", scope })}
          >
            {CATALOG_SCOPE_LABELS[scope]}
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
        <div className={styles.noResults} role="status">
          <strong>No encontramos “{state.catalogQuery}”</strong>
          <p>Puedes crearlo como un ejercicio propio.</p>
          <button type="button" onClick={() => {
            dispatch({ type: "set_custom_name", value: state.catalogQuery });
            dispatch({ type: "navigate", screen: "custom" });
          }}>
            Crear “{state.catalogQuery}”
          </button>
        </div>
      )}
      <SecondaryAction onClick={() => {
        if (state.catalogQuery.trim()) dispatch({ type: "set_custom_name", value: state.catalogQuery });
        dispatch({ type: "navigate", screen: "custom" });
      }}>
        <Plus size={15} aria-hidden="true" />Crear un ejercicio personalizado
      </SecondaryAction>
      <PrimaryAction onClick={() => dispatch({ type: "return_to", screen: "routine" })}>
        Listo · ir a la rutina
      </PrimaryAction>
    </div>
  );
}

export function CycleCustomExerciseScreen({
  state,
  dispatch,
  onSave,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: BuilderDispatch;
  readonly onSave: () => void;
}) {
  const validName = state.customName.trim().length > 0;
  const videoValidation = validateOptionalYouTubeVideoUrl(state.customVideoUrl);
  const canSave = validName && state.customMuscleGroup !== null && videoValidation.valid;
  const label = !validName
    ? "Escribe un nombre"
    : !state.customMuscleGroup
      ? "Elige el grupo muscular"
      : !videoValidation.valid
        ? "Revisa el enlace de YouTube"
      : `Guardar y agregar a ${TRAINING_CYCLE_DAY_LABELS[state.currentDay]}`;
  return (
    <div className={styles.screen}>
      <ScreenHeading
        title="Ejercicio personalizado"
        description="Queda disponible en tu catálogo para reutilizarlo en otros días y ciclos."
      />
      <label className={styles.stackField}>
        <span>Nombre del ejercicio</span>
        <input
          value={state.customName}
          placeholder="Ej: Remo en punta con barra"
          onChange={(event) => dispatch({ type: "set_custom_name", value: event.target.value })}
        />
      </label>
      <fieldset className={styles.musclePicker}>
        <legend>Grupo muscular principal</legend>
        <p>Se usa para contar ejercicios por grupo. Elige uno solo.</p>
        <div>
          {TRAINING_CYCLE_MUSCLE_GROUPS.map((muscle) => (
            <ChoiceChip
              key={muscle}
              selected={state.customMuscleGroup === muscle}
              onClick={() => dispatch({ type: "set_custom_muscle", value: muscle })}
            >
              {muscle}
            </ChoiceChip>
          ))}
        </div>
      </fieldset>
      <label className={styles.stackField}>
        <span>Video de referencia (opcional)</span>
        <input
          type="url"
          inputMode="url"
          placeholder="Pega el link de YouTube"
          value={state.customVideoUrl}
          aria-invalid={!videoValidation.valid}
          aria-describedby={!videoValidation.valid ? "custom-video-error" : undefined}
          onChange={(event) => dispatch({ type: "set_custom_video", value: event.target.value })}
        />
      </label>
      {!videoValidation.valid ? (
        <div id="custom-video-error">
          <StatusBanner tone="error" title="Enlace no válido" body={videoValidation.message} />
        </div>
      ) : null}
      {state.customErrorMessage ? (
        <StatusBanner
          tone="error"
          title="No se pudo guardar el ejercicio"
          body={state.customErrorMessage}
          actionLabel="Reintentar"
          onAction={onSave}
        />
      ) : null}
      <PrimaryAction
        disabled={!canSave || state.customSaveState === "saving"}
        isBusy={state.customSaveState === "saving"}
        onClick={onSave}
      >
        {label}
      </PrimaryAction>
    </div>
  );
}

const TECHNIQUE_HELP: Record<TrainingCycleTechnique, string> = {
  linear: "Todas las series parten iguales y puedes editarlas una por una.",
  ascending: "La carga sube serie a serie y las repeticiones bajan. Cada celda sigue editable.",
  descending: "Partes pesado y bajas la carga mientras aumentan las repeticiones.",
  drop_set: "Dentro de una serie bajas la carga sin descansar. Abre la serie para editar los descensos.",
  failure: "Marca con F las series que llevarás hasta no poder completar otra repetición.",
};

function RecommendationCard({
  exercise,
  dispatch,
}: {
  readonly exercise: TrainingCycleExerciseDraft;
  readonly dispatch: BuilderDispatch;
}) {
  const recommendation = exercise.recommendation;
  const decision = exercise.recommendationDecision;
  const decisionLabel: Record<typeof decision, string> = {
    idle: "",
    accepted: "Sugerencia aplicada; todavía puedes editarla.",
    modified: "Sugerencia modificada con tus propios valores.",
    ignored: "Sugerencia ignorada. Conservamos tus valores.",
  };
  return (
    <section className={styles.recommendationCard} data-decision={decision}>
      <header>
        {decision === "accepted" ? <Check size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
        <div><strong>{decision === "accepted" ? "Sugerencia aplicada" : recommendation.title}</strong><p>{decisionLabel[decision] || recommendation.body}</p></div>
      </header>
      {recommendation.hasHistory ? (
        <dl>
          <div><dt>Último ciclo</dt><dd>{recommendation.previousPlanLabel}</dd></div>
          <div><dt>Lo que lograste</dt><dd>{recommendation.achievedLabel}</dd></div>
          <div><dt>Con esta carga estimamos</dt><dd>{recommendation.estimatedLabel}</dd></div>
          <div><dt>Carga sugerida</dt><dd>{recommendation.suggestedKg} kg</dd></div>
        </dl>
      ) : null}
      <small>{recommendation.source}</small>
      <div className={styles.recommendationActions}>
        <button type="button" onClick={() => dispatch({ type: "accept_recommendation" })}>
          {decision === "accepted" ? "✓ Aplicada" : recommendation.hasHistory ? "Aceptar" : "Usar carga inicial"}
        </button>
        <button type="button" onClick={() => dispatch({ type: "modify_recommendation" })}>Modificar</button>
        <button type="button" onClick={() => dispatch({ type: "ignore_recommendation" })}>Ignorar</button>
      </div>
    </section>
  );
}

export function CycleExerciseScreen({
  state,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: BuilderDispatch;
}) {
  const routine = state.draft.routines[state.currentDay];
  const exercise = routine.exercises.find((candidate) => candidate.id === state.selectedExerciseId);
  if (!exercise) {
    return (
      <div className={styles.screen}>
        <StatusBanner tone="error" title="No encontramos el ejercicio" body="Vuelve a la rutina y ábrelo otra vez." />
        <PrimaryAction onClick={() => dispatch({ type: "return_to", screen: "routine" })}>Ir a la rutina</PrimaryAction>
      </div>
    );
  }
  const exerciseIndex = routine.exercises.findIndex((candidate) => candidate.id === exercise.id);
  const failCount = exercise.sets.filter((set) => set.toFailure).length;
  const dropCount = exercise.sets.reduce((count, set) => count + set.drops.length, 0);
  const videoValidation = validateOptionalYouTubeVideoUrl(exercise.videoUrl);
  const setSummary = `${exercise.sets.length} ${exercise.sets.length === 1 ? "serie" : "series"}${failCount ? ` · ${failCount} al fallo` : ""}${dropCount ? ` · ${dropCount} descensos` : ""}`;
  return (
    <div className={styles.screen}>
      <header className={styles.exerciseHeading}>
        <small>EJERCICIO {exerciseIndex + 1} DE {routine.exercises.length} · {TRAINING_CYCLE_DAY_LABELS[state.currentDay].toLocaleUpperCase("es-CL")}</small>
        <h2>{exercise.name}</h2>
        <span className={styles.groupTag}>{exercise.muscleGroup}</span>
      </header>
      <div className={styles.segmentedControl} role="group" aria-label="Modo de configuración">
        <button type="button" data-selected={state.exerciseMode === "quick"} aria-pressed={state.exerciseMode === "quick"} onClick={() => dispatch({ type: "set_exercise_mode", mode: "quick" })}>Rápido</button>
        <button type="button" data-selected={state.exerciseMode === "per_set"} aria-pressed={state.exerciseMode === "per_set"} onClick={() => dispatch({ type: "set_exercise_mode", mode: "per_set" })}>Por serie</button>
      </div>
      {state.exerciseMode === "quick" ? (
        <section className={styles.quickConfig}>
          <small>MISMO VALOR EN TODAS LAS SERIES</small>
          <div>
            <label><span>Series</span><span className={styles.stepper}><button type="button" aria-label="Quitar una serie" disabled={exercise.sets.length <= 1} onClick={() => dispatch({ type: "change_set_count", delta: -1 })}>−</button><strong>{exercise.sets.length}</strong><button type="button" aria-label="Agregar una serie" onClick={() => dispatch({ type: "change_set_count", delta: 1 })}>+</button></span></label>
            <label><span>Reps</span><input inputMode="numeric" value={state.quickReps} onChange={(event) => dispatch({ type: "set_quick_reps", value: event.target.value })} /></label>
            <label><span>Kg</span><input inputMode="decimal" value={state.quickKg} onChange={(event) => dispatch({ type: "set_quick_kg", value: event.target.value })} /></label>
          </div>
          <SecondaryAction onClick={() => dispatch({ type: "apply_quick_values" })}>Aplicar a las {exercise.sets.length} series</SecondaryAction>
        </section>
      ) : null}
      <fieldset className={styles.techniquePicker}>
        <legend>TÉCNICA DE ENTRENAMIENTO</legend>
        <div>
          {TRAINING_CYCLE_TECHNIQUES.map((technique) => (
            <ChoiceChip key={technique} selected={exercise.technique === technique} onClick={() => dispatch({ type: "set_technique", technique })}>
              {TRAINING_CYCLE_TECHNIQUE_LABELS[technique]}
            </ChoiceChip>
          ))}
        </div>
        <p>{TECHNIQUE_HELP[exercise.technique]}</p>
      </fieldset>
      <div className={styles.sectionTitleRow}><h3>Series</h3><span>{setSummary}</span></div>
      <div className={styles.setTable}>
        <div className={styles.setTableHead}><span>#</span><span>REPS</span><span>KG</span><span>FALLO</span><span /></div>
        {exercise.sets.map((set, index) => {
          const open = state.openSetId === set.id;
          return (
            <div className={styles.setBlock} key={set.id} data-open={open}>
              <div className={styles.setRow}>
                <strong>{index + 1}</strong>
                <label><span className={styles.srOnly}>Repeticiones serie {index + 1}</span><input inputMode="numeric" value={set.targetReps} onChange={(event) => dispatch({ type: "edit_set", setId: set.id, field: "targetReps", value: event.target.value })} /></label>
                <label><span className={styles.srOnly}>Kilogramos serie {index + 1}</span><input inputMode="decimal" value={set.targetKg} onChange={(event) => dispatch({ type: "edit_set", setId: set.id, field: "targetKg", value: event.target.value })} /></label>
                <button className={styles.failureButton} type="button" aria-label={`Serie ${index + 1} al fallo muscular`} aria-pressed={set.toFailure} data-selected={set.toFailure} onClick={() => dispatch({ type: "toggle_set_failure", setId: set.id })}>F</button>
                <button className={styles.touchIconButton} type="button" aria-label={`Acciones de la serie ${index + 1}`} aria-expanded={open} onClick={() => dispatch({ type: "toggle_set_open", setId: set.id })}><ChevronDown size={16} aria-hidden="true" /></button>
              </div>
              {open ? (
                <div className={styles.setDetails}>
                  {exercise.technique === "drop_set" ? (
                    <section className={styles.dropEditor}>
                      <small>DESCENSOS DE CARGA</small>
                      {set.drops.map((drop, dropIndex) => (
                        <div key={drop.id}>
                          <b>↓{dropIndex + 1}</b>
                          <label><span className={styles.srOnly}>Kg descenso {dropIndex + 1}</span><input inputMode="decimal" value={drop.targetKg} onChange={(event) => dispatch({ type: "edit_drop", setId: set.id, dropId: drop.id, field: "targetKg", value: event.target.value })} /></label><span>kg</span>
                          <label><span className={styles.srOnly}>Reps descenso {dropIndex + 1}</span><input inputMode="numeric" value={drop.targetReps} onChange={(event) => dispatch({ type: "edit_drop", setId: set.id, dropId: drop.id, field: "targetReps", value: event.target.value })} /></label><span>reps</span>
                          <button className={styles.touchIconButton} type="button" aria-label={`Quitar descenso ${dropIndex + 1}`} onClick={() => dispatch({ type: "remove_drop", setId: set.id, dropId: drop.id })}><X size={15} aria-hidden="true" /></button>
                        </div>
                      ))}
                      <button type="button" onClick={() => dispatch({ type: "add_drop", setId: set.id })}><Plus size={13} aria-hidden="true" />Agregar descenso</button>
                    </section>
                  ) : null}
                  <div className={styles.setActions}>
                    <button type="button" onClick={() => dispatch({ type: "duplicate_set", setId: set.id })}>Duplicar serie</button>
                    <button type="button" disabled={exercise.sets.length <= 1} onClick={() => dispatch({ type: "remove_set", setId: set.id })}>Eliminar serie</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        <button className={styles.addSetButton} type="button" onClick={() => dispatch({ type: "add_set" })}><Plus size={14} aria-hidden="true" />Agregar serie</button>
      </div>
      <RecommendationCard exercise={exercise} dispatch={dispatch} />
      <section className={styles.videoCard}>
        <header><Video size={16} aria-hidden="true" /><strong>Video de referencia</strong><small>Opcional</small></header>
        <label><span className={styles.srOnly}>Enlace de YouTube</span><input type="url" inputMode="url" placeholder="Pega el link de YouTube" value={exercise.videoUrl} aria-invalid={!videoValidation.valid} aria-describedby={!videoValidation.valid ? "exercise-video-error" : undefined} onChange={(event) => dispatch({ type: "set_video_url", value: event.target.value })} /></label>
        {exercise.videoUrl && videoValidation.valid ? (
          <div className={styles.videoStatus}><Check size={14} aria-hidden="true" /><p>Se mostrará como <strong>Ver técnica</strong> durante el entrenamiento. El borrador se guarda antes de salir.</p></div>
        ) : null}
        {!videoValidation.valid ? (
          <div id="exercise-video-error" role="alert" className={styles.fieldError}>{videoValidation.message}</div>
        ) : null}
      </section>
      <PrimaryAction disabled={!videoValidation.valid} onClick={() => dispatch({ type: "return_to", screen: "routine" })}>
        {videoValidation.valid
          ? `Guardar en ${TRAINING_CYCLE_DAY_LABELS[state.currentDay]}`
          : "Revisa el enlace de YouTube"}
      </PrimaryAction>
    </div>
  );
}

export function CycleMuscleScreen({
  state,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: BuilderDispatch;
}) {
  const distribution = getMuscleDistribution(state.draft);
  const dayEntries = [...(distribution.byDay.get(state.currentDay)?.entries() ?? [])];
  const weekEntries = [...distribution.week.entries()].sort((left, right) => right[1] - left[1]);
  const maximum = Math.max(1, ...weekEntries.map(([, count]) => count));
  const warnings = getTrainingCycleWarnings(state.draft, state.currentDay);
  return (
    <div className={styles.screen}>
      <ScreenHeading title="Distribución muscular" description="Contamos cada ejercicio por su grupo principal." />
      <h3 className={styles.eyebrowTitle}>{TRAINING_CYCLE_DAY_LABELS[state.currentDay]} · {state.draft.routines[state.currentDay].name || "Sin nombre"}</h3>
      <dl className={styles.dayDistribution}>
        {dayEntries.length ? dayEntries.map(([group, count]) => <div key={group}><dt>{group}</dt><dd>{count} {count === 1 ? "ejercicio" : "ejercicios"}</dd></div>) : <div><dt>Sin ejercicios</dt><dd>0</dd></div>}
      </dl>
      <h3 className={styles.eyebrowTitle}>SEMANA COMPLETA</h3>
      <div className={styles.weekDistribution}>
        {weekEntries.map(([group, count]) => (
          <div key={group}>
            <span><strong>{group}</strong><small>{count} {count === 1 ? "ejercicio" : "ejercicios"}</small></span>
            <div aria-hidden="true"><span style={{ width: `${Math.round((count / maximum) * 100)}%` }} data-low={count === 1} /></div>
          </div>
        ))}
      </div>
      {warnings.length ? warnings.map((warning) => <StatusBanner key={warning} tone="warning" title="Aviso" body={warning} />) : <StatusBanner tone="success" title="Distribución equilibrada" body="Todos los grupos elegidos tienen al menos dos ejercicios en la semana." />}
      <SecondaryAction onClick={() => dispatch({ type: "return_to", screen: "routine" })}>Ir a la rutina</SecondaryAction>
    </div>
  );
}

export function CycleCopySheet({
  state,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: BuilderDispatch;
}) {
  if (!state.copyMode) return null;
  const isDay = state.copyMode === "day";
  return (
    <BottomSheet
      titleId="cycle-copy-sheet-title"
      title={isDay ? "Copiar un día completo" : "Copiar ejercicios de otro día"}
      description={isDay
        ? `Reemplaza el nombre y los ejercicios de ${TRAINING_CYCLE_DAY_LABELS[state.currentDay]}.`
        : `Los ejercicios se agregan al final de ${TRAINING_CYCLE_DAY_LABELS[state.currentDay]}.`}
      onClose={() => dispatch({ type: "close_copy" })}
    >
      <div className={styles.copySources}>
        {state.draft.selectedDays.filter((day) => day !== state.currentDay).map((day) => {
          const routine = state.draft.routines[day];
          return (
            <button type="button" key={day} onClick={() => dispatch({ type: "copy_from_day", sourceDay: day })}>
              <span><strong>{TRAINING_CYCLE_DAY_SHORT_LABELS[day]} · {routine.name || "Sin nombre"}</strong><small>{routine.exercises.length} ejercicios · {[...new Set(routine.exercises.map((exercise) => exercise.muscleGroup))].join(", ") || "Sin grupos"}</small></span>
              <span aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
