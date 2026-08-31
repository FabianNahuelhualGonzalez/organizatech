"use client";

import { Check, ChevronDown, Clock3, LineChart, Lock, Sparkles } from "lucide-react";
import type { Dispatch, ReactNode } from "react";

import {
  TRAINING_CYCLE_DAY_LABELS,
  TRAINING_CYCLE_DAY_LETTERS,
  TRAINING_CYCLE_DAY_SHORT_LABELS,
  TRAINING_CYCLE_GOAL_LABELS,
  TRAINING_CYCLE_GOALS,
  TRAINING_CYCLE_WEEK_DAYS,
  type TrainingCycleBuilderInitialViewModel,
  type TrainingCycleDuplicateComparisonRowViewModel,
  type TrainingCycleGoal,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import type {
  TrainingCycleBuilderAction,
  TrainingCycleBuilderState,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  formatCycleDate,
  getIsoDayDifference,
  getTrainingCycleDraftValidation,
  getTrainingCycleMetrics,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  PrimaryAction,
  ScreenHeading,
  SecondaryAction,
  StatusBanner,
} from "@/features/training-cycle-builder/components/training-cycle-builder-ui";
import styles from "@/features/training-cycle-builder/components/training-cycle-builder.module.css";

type BuilderDispatch = Dispatch<TrainingCycleBuilderAction>;

function StartOption({
  recommended = false,
  time,
  title,
  description,
  onClick,
  children,
}: {
  readonly recommended?: boolean;
  readonly time: string;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <button
      className={styles.startOption}
      data-recommended={recommended}
      type="button"
      onClick={onClick}
    >
      <span className={styles.optionMeta}>
        {recommended ? <b>RECOMENDADO</b> : null}
        <span><Clock3 size={12} aria-hidden="true" />{time}</span>
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {children}
    </button>
  );
}

export function CycleStartScreen({
  state,
  viewModel,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: BuilderDispatch;
}) {
  const sourceDraft = state.sourceDraft;
  const metrics = getTrainingCycleMetrics(sourceDraft);
  const duration = getIsoDayDifference(sourceDraft.startDate, sourceDraft.endDate);
  const hasDuplicateSource = sourceDraft.selectedDays.some(
    (day) => sourceDraft.routines[day].exercises.length > 0,
  );
  return (
    <div className={styles.screen}>
      <ScreenHeading
        title="Vamos a armar tu próximo ciclo"
        description="Un ciclo es tu plan de entrenamiento entre dos fechas. Elige por dónde empezar; todo se puede editar antes de activarlo."
      />
      <div className={styles.startOptions}>
        {hasDuplicateSource ? (
          <StartOption
            recommended
            time="~2 MIN"
            title="Duplicar mi último ciclo"
            description="Copia días, rutinas, ejercicios, series, cargas, técnicas y videos. Ajustas lo que quieras antes de activar."
            onClick={() => dispatch({ type: "choose_origin", origin: "duplicate", screen: "duplicate" })}
          >
            <span className={styles.optionMetrics}>
              <span><small>CICLO</small>{TRAINING_CYCLE_GOAL_LABELS[sourceDraft.goal]} · {Math.max(1, Math.round(duration / 7))} sem</span>
              <span><small>DÍAS</small>{sourceDraft.selectedDays.length}</span>
              <span><small>EJERCICIOS</small>{metrics.exercises}</span>
            </span>
          </StartOption>
        ) : null}
        <StartOption
          recommended={!hasDuplicateSource}
          time="~15 MIN"
          title="Crear mi propia rutina"
          description="Eliges día por día desde el catálogo o escribes tus propios ejercicios."
          onClick={() => dispatch({ type: "choose_origin", origin: "manual", screen: "setup" })}
        />
        <StartOption
          time="~5 MIN"
          title="Recibir una rutina sugerida"
          description="Con tu objetivo, días y fechas preparamos un borrador completo que podrás editar."
          onClick={() => dispatch({ type: "choose_origin", origin: "suggested", screen: "setup" })}
        />
      </div>
      {viewModel.hasRecoverableDraft ? (
        <section className={styles.resumeDraft}>
          <div>
            <strong>Tienes un borrador sin terminar</strong>
            <p>{viewModel.recoveredDraftLabel ?? "Borrador guardado automáticamente"}</p>
          </div>
          <button type="button" onClick={() => dispatch({ type: "resume_draft" })}>Retomar</button>
        </section>
      ) : null}
    </div>
  );
}

function ComparisonTable({
  rows,
}: {
  readonly rows: readonly TrainingCycleDuplicateComparisonRowViewModel[];
}) {
  return (
    <div className={styles.comparisonTable} role="table" aria-label="Planificado versus rendimiento real">
      <div role="row" className={styles.comparisonHead}>
        <span role="columnheader">EJERCICIO</span>
        <span role="columnheader">PLAN</span>
        <span role="columnheader">REAL</span>
      </div>
      {rows.map((row) => (
        <div role="row" key={row.id}>
          <span role="cell">{row.exerciseName}</span>
          <span role="cell">{row.plannedLabel}</span>
          <strong role="cell" data-outcome={row.outcome}>{row.actualLabel}</strong>
        </div>
      ))}
      <p>Último registro comparable. Verde: cumpliste o superaste. Ámbar: quedaste bajo el objetivo.</p>
    </div>
  );
}

export function CycleDuplicateScreen({
  state,
  viewModel,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: BuilderDispatch;
}) {
  return (
    <div className={styles.screen}>
      <ScreenHeading
        title="Esto es lo que vamos a copiar"
        description={`De tu ciclo ${TRAINING_CYCLE_GOAL_LABELS[state.draft.goal]} · ${formatCycleDate(state.draft.startDate)} – ${formatCycleDate(state.draft.endDate)}. Nada se activa todavía.`}
      />
      <section className={styles.summaryCard}>
        <small>SE COPIA COMPLETO</small>
        <div className={styles.copiedGrid}>
          {["Días", "Rutinas", "Ejercicios", "Orden", "Grupo muscular", "Series", "Repeticiones", "Cargas", "Técnicas", "Videos"].map((item) => (
            <span key={item}><Check size={13} aria-hidden="true" />{item}</span>
          ))}
        </div>
      </section>
      <section className={styles.daySummaryCard}>
        <h3>{state.draft.selectedDays.length} días con rutina</h3>
        {state.draft.selectedDays.map((day) => {
          const routine = state.draft.routines[day];
          const groups = [...new Set(routine.exercises.map((exercise) => exercise.muscleGroup))];
          return (
            <div key={day}>
              <small>{TRAINING_CYCLE_DAY_SHORT_LABELS[day]}</small>
              <span><strong>{routine.name || "Sin nombre"}</strong><small>{groups.join(" · ") || "Sin ejercicios"}</small></span>
              <b>{routine.exercises.length} ej.</b>
            </div>
          );
        })}
      </section>
      <section className={styles.compareCard}>
        <button
          type="button"
          aria-expanded={state.comparisonOpen}
          aria-controls="cycle-duplicate-comparison"
          onClick={() => dispatch({ type: "toggle_comparison" })}
        >
          <LineChart size={17} aria-hidden="true" />
          <span><strong>Comparar con mi rendimiento real</strong><small>Lo que planificaste vs. lo que hiciste</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {state.comparisonOpen ? (
          <div id="cycle-duplicate-comparison">
            <ComparisonTable rows={viewModel.duplicateComparison} />
          </div>
        ) : null}
      </section>
      <PrimaryAction onClick={() => dispatch({ type: "navigate", screen: "setup" })}>
        Continuar con la copia
      </PrimaryAction>
      <SecondaryAction onClick={() => dispatch({ type: "navigate", screen: "start" })}>
        Elegir otra forma de empezar
      </SecondaryAction>
    </div>
  );
}

const GOAL_HINTS: Record<TrainingCycleGoal, string> = {
  strength: "Cargas altas, pocas reps",
  volume: "Más series y repeticiones",
  definition: "Ritmo alto, cargas medias",
  deload: "Semanas suaves de recuperación",
};

export function CycleSetupScreen({
  state,
  dispatch,
  onGenerateSuggestion,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: BuilderDispatch;
  readonly onGenerateSuggestion: () => void;
}) {
  const validation = getTrainingCycleDraftValidation(state.draft);
  const isActiveEdit = state.workflow === "active_edit";
  const generating = state.suggestionState === "loading";
  const restDays = TRAINING_CYCLE_WEEK_DAYS.filter((day) => !state.draft.selectedDays.includes(day));
  const durationWeeks = validation.datesValid ? Math.max(1, Math.round(validation.durationDays / 7)) : 0;
  const continueLabel = !validation.hasDays
    ? "Elige al menos un día"
    : !validation.datesValid
      ? "Revisa las fechas"
      : state.origin === "suggested" && !isActiveEdit
        ? "Generar mi rutina sugerida"
        : isActiveEdit
          ? "Continuar a editar rutinas"
          : "Continuar a la rutina";
  return (
    <div className={styles.screen}>
      <ScreenHeading
        title={isActiveEdit ? "Edita tu ciclo activo" : "¿Qué buscas en este ciclo?"}
        description={isActiveEdit
          ? "Puedes cambiar el objetivo, días y rutina. Las fechas tienen sus propias protecciones."
          : "El objetivo orienta las cargas y repeticiones que podremos sugerir."}
      />
      <fieldset className={styles.goalGrid}>
        <legend>OBJETIVO PRINCIPAL</legend>
        {TRAINING_CYCLE_GOALS.map((goal) => (
          <button
            type="button"
            key={goal}
            data-selected={state.draft.goal === goal}
            aria-pressed={state.draft.goal === goal}
            disabled={generating}
            onClick={() => dispatch({ type: "set_goal", goal })}
          >
            <strong>{TRAINING_CYCLE_GOAL_LABELS[goal]}</strong>
            <small>{GOAL_HINTS[goal]}</small>
          </button>
        ))}
      </fieldset>
      <fieldset className={styles.dateFields}>
        <legend>FECHAS DEL CICLO</legend>
        <label><span>Inicio {isActiveEdit ? "· bloqueado" : ""}</span><input type="date" disabled={isActiveEdit || generating} value={state.draft.startDate} onChange={(event) => dispatch({ type: "set_start_date", value: event.target.value })} /></label>
        <label><span>Término {isActiveEdit ? "· sólo extensión" : ""}</span><input type="date" disabled={isActiveEdit || generating} value={state.draft.endDate} onChange={(event) => dispatch({ type: "set_end_date", value: event.target.value })} /></label>
      </fieldset>
      {isActiveEdit ? (
        <div className={styles.lockedDate}>
          <Lock size={15} aria-hidden="true" />
          <span><small>FECHAS PROTEGIDAS</small><strong>El inicio no cambia. Para extender el término, vuelve a Mi ciclo.</strong></span>
        </div>
      ) : null}
      <div className={styles.durationBox} data-invalid={!validation.datesValid} role="status">
        <span><small>DURACIÓN</small><strong>{validation.datesValid ? `${validation.durationDays} días · ~${durationWeeks} semanas` : "Fechas no válidas"}</strong></span>
        {!validation.datesValid ? <p>El término debe ser posterior al inicio</p> : null}
      </div>
      <div className={styles.educationalNote}>
        <Sparkles size={15} aria-hidden="true" />
        <p>Con esta duración muchos entrenadores hablarían de un <strong>mesociclo</strong>. Es sólo una forma de nombrarlo: mandan tus fechas.</p>
      </div>
      <fieldset className={styles.dayPicker}>
        <legend>DÍAS QUE VAS A ENTRENAR</legend>
        <div>
          {TRAINING_CYCLE_WEEK_DAYS.map((day) => {
            const selected = state.draft.selectedDays.includes(day);
            return (
              <button
                type="button"
                key={day}
                data-selected={selected}
                aria-pressed={selected}
                disabled={generating}
                aria-label={`${selected ? "Quitar" : "Agregar"} ${TRAINING_CYCLE_DAY_LABELS[day]}`}
                onClick={() => dispatch({ type: "toggle_day", day })}
              >
                {TRAINING_CYCLE_DAY_LETTERS[day]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className={styles.trainRestGrid}>
        <div><small>ENTRENAMIENTO</small><strong>{state.draft.selectedDays.length}</strong><span>{state.draft.selectedDays.map((day) => TRAINING_CYCLE_DAY_SHORT_LABELS[day]).join(" ") || "—"}</span></div>
        <div><small>DESCANSO</small><strong>{restDays.length}</strong><span>{restDays.map((day) => TRAINING_CYCLE_DAY_SHORT_LABELS[day]).join(" ") || "—"}</span></div>
      </div>
      {state.origin === "suggested" && !isActiveEdit ? (
        <section className={styles.suggestedDistribution}>
          <small>GENERACIÓN PERSONALIZADA</small>
          <strong>{generating ? "Preparando el borrador…" : "La rutina se creará con estos datos"}</strong>
          <span>Objetivo, {state.draft.selectedDays.length} días y {validation.datesValid ? `${validation.durationDays} días de duración` : "fechas pendientes"}. El resultado seguirá siendo editable.</span>
        </section>
      ) : null}
      {state.suggestionState === "error" ? (
        <StatusBanner
          tone="error"
          title="No se pudo generar la rutina"
          body={state.suggestionErrorMessage ?? "Inténtalo nuevamente."}
        />
      ) : null}
      <PrimaryAction
        disabled={!validation.datesValid || !validation.hasDays || generating}
        isBusy={generating}
        onClick={state.origin === "suggested" && !isActiveEdit
          ? onGenerateSuggestion
          : () => dispatch({ type: "navigate", screen: "routine" })}
      >
        {generating ? "Generando una rutina editable…" : continueLabel}
      </PrimaryAction>
    </div>
  );
}
