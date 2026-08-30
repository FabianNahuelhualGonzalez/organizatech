"use client";

import {
  AlertTriangle,
  Check,
  Clock3,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import type { Dispatch } from "react";

import {
  TRAINING_CYCLE_DAY_LABELS,
  TRAINING_CYCLE_GOAL_LABELS,
  TRAINING_CYCLE_TECHNIQUE_LABELS,
  type TrainingCycleBuilderInitialViewModel,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import type {
  TrainingCycleBuilderAction,
  TrainingCycleBuilderState,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  addDaysToIso,
  formatCycleDate,
  getExtensionValidation,
  getMuscleDistribution,
  getTrainingCycleDraftValidation,
  getTrainingCycleMetrics,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import {
  AccordionSection,
  BottomSheet,
  ChoiceChip,
  PrimaryAction,
  ScreenHeading,
  SecondaryAction,
  StatusBanner,
} from "@/features/training-cycle-builder/components/training-cycle-builder-ui";
import styles from "@/features/training-cycle-builder/components/training-cycle-builder.module.css";

type BuilderDispatch = Dispatch<TrainingCycleBuilderAction>;

function ReviewLines({ lines }: { readonly lines: readonly (readonly [string, string])[] }) {
  return (
    <dl className={styles.reviewLines}>
      {lines.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

export function CycleReviewScreen({
  state,
  dispatch,
  onActivate,
  onSaveActive,
  onRetrySave,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly dispatch: BuilderDispatch;
  readonly onActivate: () => void;
  readonly onSaveActive: () => void;
  readonly onRetrySave: () => void;
}) {
  const metrics = getTrainingCycleMetrics(state.draft);
  const validation = getTrainingCycleDraftValidation(state.draft);
  const distribution = getMuscleDistribution(state.draft);
  const restCount = 7 - state.draft.selectedDays.length;
  const techniques: string[] = [];
  let videos = 0;
  let accepted = 0;
  let modified = 0;
  let ignored = 0;
  for (const day of state.draft.selectedDays) {
    for (const exercise of state.draft.routines[day].exercises) {
      if (exercise.technique !== "linear") techniques.push(`${exercise.name}: ${TRAINING_CYCLE_TECHNIQUE_LABELS[exercise.technique]}`);
      if (exercise.videoUrl) videos += 1;
      if (exercise.recommendationDecision === "accepted") accepted += 1;
      if (exercise.recommendationDecision === "modified") modified += 1;
      if (exercise.recommendationDecision === "ignored") ignored += 1;
    }
  }
  const isActiveEdit = state.workflow === "active_edit";
  const saveBlocksActivation = !isActiveEdit && (state.saveState === "loading" || state.saveState === "saving" || state.saveState === "offline" || state.saveState === "error");
  const activating = state.activationState === "activating";
  const savingActive = state.activeEditState === "saving";
  const activeConflict = state.activeEditState === "conflict";
  const canActivate = validation.canActivate && !saveBlocksActivation && !activating && !savingActive && !activeConflict && (
    !isActiveEdit || Boolean(state.activeCycleId && state.activeCycleRevision)
  );
  const activateLabel = savingActive
    ? "Guardando cambios…"
    : activeConflict
      ? "Recarga para continuar"
    : activating
    ? "Activando…"
    : !validation.hasDays
      ? "Elige al menos un día"
      : !validation.datesValid
        ? "Revisa las fechas"
        : !validation.seriesValid
          ? "Revisa las series"
          : !validation.videosValid
            ? "Revisa los enlaces de YouTube"
          : !isActiveEdit && state.saveState === "offline"
            ? "Conéctate para activar"
            : !isActiveEdit && state.saveState === "error"
              ? "Guarda antes de activar"
              : !isActiveEdit && (state.saveState === "loading" || state.saveState === "saving")
                ? "Espera a que termine de guardar"
                : isActiveEdit
                  ? "Guardar cambios del ciclo"
                  : "Activar mi ciclo";
  const sections = [
    {
      id: "plan",
      title: "Objetivo y fechas",
      summary: `${TRAINING_CYCLE_GOAL_LABELS[state.draft.goal]} · ${formatCycleDate(state.draft.startDate)} – ${formatCycleDate(state.draft.endDate)}`,
      lines: [
        ["Objetivo", TRAINING_CYCLE_GOAL_LABELS[state.draft.goal]],
        ["Inicio", formatCycleDate(state.draft.startDate)],
        ["Término", formatCycleDate(state.draft.endDate)],
        ["Duración", validation.datesValid
          ? `${validation.durationDays} días · ~${Math.max(1, Math.round(validation.durationDays / 7))} semanas`
          : "Fechas no válidas"],
      ] as const,
      target: "setup" as const,
      label: "Editar objetivo y fechas",
    },
    {
      id: "days",
      title: "Días de entrenamiento",
      summary: `${state.draft.selectedDays.length} de entrenamiento · ${restCount} de descanso`,
      lines: [
        ["Entrenamiento", state.draft.selectedDays.map((day) => TRAINING_CYCLE_DAY_LABELS[day]).join(", ") || "Ninguno"],
        ["Descanso", `${restCount} días`],
      ] as const,
      target: "setup" as const,
      label: "Editar días",
    },
    {
      id: "routines",
      title: "Rutina de cada día",
      summary: `${metrics.exercises} ejercicios en total`,
      lines: state.draft.selectedDays.map((day) => [TRAINING_CYCLE_DAY_LABELS[day], `${state.draft.routines[day].name || "Sin nombre"} · ${state.draft.routines[day].exercises.length} ej.`] as const),
      target: "routine" as const,
      label: "Editar rutinas",
    },
    {
      id: "muscle",
      title: "Distribución muscular",
      summary: `${distribution.week.size} grupos cubiertos`,
      lines: [...distribution.week.entries()].sort((left, right) => right[1] - left[1]).map(([group, count]) => [group, `${count} ejercicios`] as const),
      target: "muscle" as const,
      label: "Ver distribución completa",
    },
    {
      id: "techniques",
      title: "Técnicas y videos",
      summary: `${techniques.length} con técnica · ${videos} con video`,
      lines: techniques.length ? techniques.map((line) => ["Técnica", line] as const) : [["Técnicas", "Todos los ejercicios en lineal"]] as const,
      target: "routine" as const,
      label: "Editar ejercicios",
    },
    {
      id: "recommendations",
      title: "Recomendaciones",
      summary: `${accepted} aceptadas · ${modified} modificadas · ${ignored} ignoradas`,
      lines: [["Aceptadas", String(accepted)], ["Modificadas", String(modified)], ["Ignoradas", String(ignored)]] as const,
      target: "routine" as const,
      label: "Revisar ejercicios",
    },
  ];
  return (
    <div className={styles.screen}>
      <ScreenHeading
        title={isActiveEdit ? "Revisa los cambios del ciclo" : "Revisa antes de activar"}
        description={isActiveEdit
          ? "Se guardarán con revisión optimista. Si el ciclo cambió en otro lugar, no lo sobrescribiremos."
          : "Puedes volver a editar cualquier sección desde aquí."}
      />
      <div className={styles.metricGrid}>
        <div><small>EJERCICIOS</small><strong>{metrics.exercises}</strong><span>En {state.draft.selectedDays.length} días</span></div>
        <div><small>SERIES PROGRAMADAS</small><strong>{metrics.sets}</strong></div>
        <div><small>REPETICIONES PROGRAMADAS</small><strong>{Math.round(metrics.repetitions)}</strong></div>
        <div><small>VOLUMEN PROGRAMADO</small><strong>{(metrics.volumeKg / 1000).toFixed(1)} t</strong><span>carga × reps por serie</span></div>
      </div>
      <div className={styles.educationalNote}>
        <AlertTriangle size={15} aria-hidden="true" />
        <p>El <strong>volumen programado</strong> suma carga × repeticiones de cada serie, incluidos los descensos. No es “total de kg”.</p>
      </div>
      {sections.map((section) => (
        <AccordionSection
          key={section.id}
          id={`review-${section.id}`}
          title={section.title}
          summary={section.summary}
          open={state.openReviewSection === section.id}
          onToggle={() => dispatch({ type: "toggle_review_section", section: section.id })}
        >
          <ReviewLines lines={section.lines} />
          <SecondaryAction onClick={() => dispatch({ type: "navigate", screen: section.target })}>{section.label}</SecondaryAction>
        </AccordionSection>
      ))}
      {state.activationState === "error" ? (
        <StatusBanner tone="error" title="No se pudo activar" body={state.activationErrorMessage ?? "Inténtalo nuevamente."} />
      ) : null}
      {isActiveEdit && (state.activeEditState === "error" || state.activeEditState === "conflict") ? (
        <StatusBanner
          tone="error"
          title={state.activeEditState === "conflict" ? "El ciclo cambió en otro lugar" : "No se guardaron los cambios"}
          body={state.activeEditErrorMessage ?? "Tu edición sigue abierta."}
        />
      ) : null}
      {!isActiveEdit && state.saveState === "error" ? (
        <StatusBanner
          tone="error"
          title={!validation.videosValid ? "Revisa los enlaces de YouTube" : "No pudimos guardar tus cambios"}
          body={state.saveErrorMessage ?? "El borrador sigue disponible aquí."}
          actionLabel={validation.videosValid ? "Reintentar" : undefined}
          onAction={validation.videosValid ? onRetrySave : undefined}
        />
      ) : null}
      <PrimaryAction disabled={!canActivate} isBusy={activating || savingActive} onClick={isActiveEdit ? onSaveActive : onActivate}>{activateLabel}</PrimaryAction>
      <p className={styles.actionHint}>{activating || savingActive ? "No cierres la app" : isActiveEdit ? "La fecha de inicio permanece intacta" : "Podrás editarlo mientras esté en curso"}</p>
      {isActiveEdit ? (
        <button className={styles.textAction} type="button" onClick={() => dispatch({ type: "cancel_active_edit" })}>Cancelar esta edición</button>
      ) : (
        <button className={styles.textAction} type="button" onClick={() => dispatch({ type: "open_discard" })}>Descartar este borrador</button>
      )}
    </div>
  );
}

export function CycleSuccessScreen({
  state,
  viewModel,
  onStartTraining,
  onReviewCycle,
  onExit,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly onStartTraining: () => void;
  readonly onReviewCycle: () => void;
  readonly onExit: () => void;
}) {
  const metrics = getTrainingCycleMetrics(state.draft);
  return (
    <div className={`${styles.screen} ${styles.successScreen}`}>
      <div className={styles.successMark}><Check size={31} aria-hidden="true" /></div>
      <ScreenHeading title="Tu ciclo está activo" description="Ya puedes entrenar. Todo sigue siendo editable mientras el ciclo esté en curso." />
      <section className={styles.successSummary}>
        <div><small>TU PRÓXIMO ENTRENAMIENTO</small><strong>{viewModel.nextSessionLabel}</strong><span>{viewModel.nextSessionDetail}</span></div>
        <dl>
          <div><dt>INICIO</dt><dd>{formatCycleDate(state.draft.startDate)}</dd></div>
          <div><dt>TÉRMINO</dt><dd>{formatCycleDate(state.draft.endDate)}</dd></div>
          <div><dt>DÍAS POR SEMANA</dt><dd>{state.draft.selectedDays.length}</dd></div>
          <div><dt>EJERCICIOS</dt><dd>{metrics.exercises}</dd></div>
        </dl>
      </section>
      <PrimaryAction onClick={onStartTraining}>Comenzar a entrenar</PrimaryAction>
      <SecondaryAction onClick={onReviewCycle}>Revisar mi ciclo</SecondaryAction>
      <button className={styles.textAction} type="button" onClick={onExit}>Ir al inicio</button>
    </div>
  );
}

export function CycleActiveScreen({
  state,
  viewModel,
  dispatch,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: BuilderDispatch;
}) {
  const remaining = viewModel.activeCycleDaysRemaining ?? 0;
  const elapsed = viewModel.activeCycleElapsedDays ?? 0;
  const total = Math.max(1, viewModel.activeCycleTotalDays ?? 1);
  const progress = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  return (
    <div className={styles.screen}>
      {state.activeEditSavedMessage ? (
        <StatusBanner
          tone="success"
          title="Ciclo actualizado"
          body={state.activeEditSavedMessage}
          actionLabel="Entendido"
          onAction={() => dispatch({ type: "dismiss_active_edit_saved" })}
        />
      ) : null}
      {remaining <= 3 ? (
        <section className={styles.expiryBanner} data-last-day={remaining === 0}>
          <div><Clock3 size={16} aria-hidden="true" /><span><strong>{remaining === 0 ? "Hoy es el último día" : `Tu ciclo termina en ${remaining} ${remaining === 1 ? "día" : "días"}`}</strong><p>{remaining === 0 ? "Hoy entrenas normal. Mañana se cierra si no lo extiendes." : "Puedes extenderlo ahora o dejar que se cierre y crear uno nuevo."}</p></span></div>
          <button type="button" onClick={() => dispatch({ type: "open_extend" })}>Extender ciclo</button>
        </section>
      ) : null}
      <ScreenHeading title="Mi ciclo" description={`En curso · ${elapsed} de ${total} días`} />
      <section className={styles.activeSummary}>
        <header><span><small>OBJETIVO</small><strong>{TRAINING_CYCLE_GOAL_LABELS[state.draft.goal]}</strong></span><b>ACTIVO</b></header>
        <dl>
          <div><dt>INICIO</dt><dd>{formatCycleDate(state.draft.startDate)}</dd></div>
          <div><dt>TÉRMINO</dt><dd>{formatCycleDate(state.draft.endDate)}</dd></div>
          <div><dt>RESTAN</dt><dd data-warning={remaining <= 3}>{remaining === 0 ? "Hoy" : `${remaining} días`}</dd></div>
        </dl>
        <div className={styles.progressTrack} aria-label={`${progress}% del ciclo completado`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
        <p>{elapsed} de {total} días · {viewModel.registeredSessions ?? 0} sesiones registradas</p>
      </section>
      <h3 className={styles.eyebrowTitle}>DÍAS DEL CICLO</h3>
      <div className={styles.activeDays}>
        {state.draft.selectedDays.map((day) => {
          const routine = state.draft.routines[day];
          return <div key={day}><small>{TRAINING_CYCLE_DAY_LABELS[day].slice(0, 3)}</small><span><strong>{routine.name || "Sin nombre"}</strong><small>{routine.exercises.length} ejercicios</small></span></div>;
        })}
      </div>
      {state.activeCycleRevision ? (
        <PrimaryAction onClick={() => dispatch({ type: "begin_active_edit" })}>Editar objetivo, días y rutinas</PrimaryAction>
      ) : (
        <StatusBanner
          tone="error"
          title="Edición temporalmente no disponible"
          body="Falta la revisión del ciclo activo. Recarga antes de editar para evitar sobrescribir cambios."
        />
      )}
      <SecondaryAction onClick={() => dispatch({ type: "open_extend" })}>Extender la fecha de término</SecondaryAction>
      <SecondaryAction onClick={() => dispatch({ type: "navigate", screen: "alerts" })}>Ver avisos de vencimiento</SecondaryAction>
      <button className={styles.textAction} type="button" onClick={() => dispatch({ type: "navigate", screen: "closing" })}>Ver qué pasa si no lo extiendo</button>
    </div>
  );
}

export function CycleAlertsScreen({
  viewModel,
  dispatch,
}: {
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: BuilderDispatch;
}) {
  return (
    <div className={styles.screen}>
      <ScreenHeading title="Avisos de vencimiento" description="Los avisos T-3, T-2, T-1 y T0 aparecen dentro del ciclo y en la campana." />
      <div className={styles.alertList}>
        {viewModel.expiryAlerts.map((alert) => (
          <article key={alert.offsetDays} data-last-day={alert.offsetDays === 0}>
            <header><span /><div><strong>{alert.title}</strong><small>{alert.whenLabel}</small></div></header>
            <p>{alert.body}</p>
            <div><button type="button" onClick={() => dispatch({ type: "open_extend" })}>Extender ciclo</button>{alert.emailEnabled ? <span><Mail size={12} aria-hidden="true" />También por correo</span> : null}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function CycleClosingScreen({
  dispatch,
}: {
  readonly dispatch: BuilderDispatch;
}) {
  const steps = [
    ["Hoy", "Último día del ciclo", "El día indicado sigue siendo válido: entrenas y registras como siempre."],
    ["Mañana, 00:00", "El ciclo se cierra solo", "Pasa al historial con todas las sesiones registradas."],
    ["Al abrir la app", "Ciclo cerrado", "Ves el resumen de lo que lograste y el acceso para crear el siguiente."],
    ["Enseguida", "Creación del siguiente", "Te recomendamos duplicar el ciclo recién terminado con tus cargas reales."],
  ] as const;
  return (
    <div className={styles.screen}>
      <ScreenHeading title="Si no extiendes" description="Esta es la secuencia completa del cierre automático." />
      <ol className={styles.closingTimeline}>
        {steps.map(([when, title, body], index) => <li key={title} data-final={index === steps.length - 1}><span aria-hidden="true" /><div><small>{when}</small><strong>{title}</strong><p>{body}</p></div></li>)}
      </ol>
      <StatusBanner tone="success" title="Un entrenamiento en curso nunca se interrumpe" body="Si el cierre cae mientras entrenas, el ciclo espera. Terminas, guardas la sesión y recién entonces se cierra." />
      <PrimaryAction onClick={() => dispatch({ type: "navigate", screen: "next" })}>Ver el inicio del ciclo siguiente</PrimaryAction>
    </div>
  );
}

export function CycleNextScreen({
  viewModel,
  dispatch,
}: {
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: BuilderDispatch;
}) {
  return (
    <div className={styles.screen}>
      <section className={styles.closedSummary}>
        <small>CICLO CERRADO</small>
        <strong>{viewModel.closedSummary.cycleLabel}</strong>
        <p>{viewModel.closedSummary.completedSessions} sesiones completadas de {viewModel.closedSummary.plannedSessions} programadas. Tus registros quedan en el historial.</p>
      </section>
      <ScreenHeading title="Listo para el siguiente" description="Lo más rápido es partir del ciclo que acabas de terminar: ya tienes las cargas reales que lograste." />
      <div className={styles.nextOptions}>
        <button type="button" data-recommended onClick={() => dispatch({ type: "choose_origin", origin: "duplicate", screen: "duplicate" })}><b>RECOMENDADO</b><strong>Duplicar el ciclo que terminaste</strong><p>Con las cargas ajustadas a lo que realmente levantaste.</p></button>
        <button type="button" onClick={() => dispatch({ type: "choose_origin", origin: "manual", screen: "setup" })}><strong>Crear mi propia rutina</strong><p>Empezar desde cero.</p></button>
        <button type="button" onClick={() => dispatch({ type: "choose_origin", origin: "suggested", screen: "setup" })}><strong>Recibir una rutina sugerida</strong><p>Cambiar de enfoque con un borrador nuevo.</p></button>
      </div>
    </div>
  );
}

export function CycleExtensionSheet({
  state,
  viewModel,
  dispatch,
  onConfirm,
}: {
  readonly state: TrainingCycleBuilderState;
  readonly viewModel: TrainingCycleBuilderInitialViewModel;
  readonly dispatch: BuilderDispatch;
  readonly onConfirm: () => void;
}) {
  if (!state.extendOpen) return null;
  const validation = getExtensionValidation(state.draft.endDate, state.extendDate, viewModel.todayIsoDate);
  const busy = state.extensionState === "saving";
  return (
    <BottomSheet
      titleId="cycle-extension-sheet-title"
      title="Extender el ciclo"
      description="Sólo puedes mover la fecha de término."
      onClose={() => dispatch({ type: "close_extend" })}
      canClose={!busy}
      footer={<PrimaryAction disabled={!validation.valid || busy || !state.activeCycleId} isBusy={busy} onClick={onConfirm}>{busy ? "Guardando nueva fecha…" : validation.valid ? "Confirmar nueva fecha" : "Elige una fecha válida"}</PrimaryAction>}
    >
      <div className={styles.lockedDate}><Lock size={15} aria-hidden="true" /><span><small>INICIO · BLOQUEADO</small><strong>{formatCycleDate(state.draft.startDate)}</strong></span></div>
      <label className={styles.stackField}><span>Nueva fecha de término</span><input type="date" value={state.extendDate} onChange={(event) => dispatch({ type: "set_extend_date", value: event.target.value })} /></label>
      <div className={styles.extensionShortcuts}>
        {[7, 14, 28].map((days) => {
          const date = addDaysToIso(state.draft.endDate, days);
          return <ChoiceChip key={days} selected={state.extendDate === date} onClick={() => dispatch({ type: "set_extend_date", value: date })}>+{days / 7} {days === 7 ? "semana" : "semanas"}</ChoiceChip>;
        })}
      </div>
      <StatusBanner tone={validation.valid ? "success" : "error"} title={validation.valid ? "Nueva duración válida" : "Revisa la fecha"} body={validation.message} />
      {state.extensionState === "error" ? <StatusBanner tone="error" title="No se pudo extender" body={state.extensionErrorMessage ?? "La fecha actual no cambió."} /> : null}
      <div className={styles.extensionProtection}><ShieldCheck size={15} aria-hidden="true" /><p>La fecha de inicio permanece bloqueada y la nueva fecha nunca puede retroceder.</p></div>
    </BottomSheet>
  );
}
