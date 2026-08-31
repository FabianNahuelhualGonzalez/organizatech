"use client";

import type { ReactNode } from "react";

import { AppTopbar } from "@/features/app-shell/components/app-topbar";
import {
  TRAINING_CYCLE_WEEK_DAYS,
  TRAINING_CYCLE_GOAL_LABELS,
  type TrainingCycleBuilderGateway,
  type TrainingCycleBuilderInitialViewModel,
  type TrainingCycleBuilderProps,
  type TrainingCycleBuilderShellProps,
  type TrainingCycleStartTrainingHandler,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import {
  CycleDuplicateScreen,
  CycleSetupScreen,
  CycleStartScreen,
} from "@/features/training-cycle-builder/components/cycle-creation-screens";
import {
  CycleCatalogScreen,
  CycleCopySheet,
  CycleCustomExerciseScreen,
  CycleExerciseScreen,
  CycleMuscleScreen,
  CycleRoutineScreen,
} from "@/features/training-cycle-builder/components/cycle-routine-screens";
import {
  CycleActiveScreen,
  CycleAlertsScreen,
  CycleClosingScreen,
  CycleExtensionSheet,
  CycleNextScreen,
  CycleReviewScreen,
  CycleSuccessScreen,
} from "@/features/training-cycle-builder/components/cycle-review-lifecycle-screens";
import {
  SaveChip,
  StatusBanner,
  StepBar,
} from "@/features/training-cycle-builder/components/training-cycle-builder-ui";
import { getIsoDayDifference } from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import { useTrainingCycleBuilderController } from "@/features/training-cycle-builder/hooks/use-training-cycle-builder-controller";
import { AppBackButton } from "@/ui/navigation/app-back-button";
import { ConfirmDialog } from "@/ui/modals/confirm-dialog";
import styles from "@/features/training-cycle-builder/components/training-cycle-builder.module.css";

function hasTrainingCycleGateway(value: TrainingCycleBuilderGateway | null): value is TrainingCycleBuilderGateway {
  return Boolean(value) && [
    value?.saveDraft,
    value?.generateSuggestedDraft,
    value?.createCustomExercise,
    value?.activateCycle,
    value?.saveActiveCycle,
    value?.extendCycle,
    value?.discardDraft,
  ].every((operation) => typeof operation === "function");
}

function hasTrainingCycleViewModel(
  value: TrainingCycleBuilderInitialViewModel | null,
): value is TrainingCycleBuilderInitialViewModel {
  if (!value || typeof value.todayIsoDate !== "string" || !value.draft) return false;
  if (
    typeof value.draft.draftId !== "string" ||
    typeof value.draft.startDate !== "string" ||
    typeof value.draft.endDate !== "string"
  ) return false;
  if (!Array.isArray(value.draft.selectedDays) || !value.draft.routines) return false;
  if (
    !Array.isArray(value.catalog) ||
    !Array.isArray(value.duplicateComparison) ||
    !Array.isArray(value.expiryAlerts) ||
    !value.closedSummary
  ) return false;
  if (
    (value.initialScreen === "active" || value.initialScreen === "alerts" || value.initialScreen === "closing") &&
    (!value.activeCycleId || !value.activeCycleRevision)
  ) return false;
  return TRAINING_CYCLE_WEEK_DAYS.every((day) => {
    const routine = value.draft.routines[day];
    return routine?.day === day && Array.isArray(routine.exercises);
  });
}

/**
 * Boundary visual del rediseño de ciclos. Sigue deliberadamente desconectado del composition root:
 * la integración futura deberá entregar el view-model y gateway tipados de este módulo.
 */
export function TrainingCycleBuilder({
  initialViewModel,
  gateway,
  shell,
  chromeMode = "standalone",
  onExit,
  onStartTraining,
}: TrainingCycleBuilderProps) {
  if (!hasTrainingCycleViewModel(initialViewModel) || !hasTrainingCycleGateway(gateway)) {
    return (
      <section className={styles.feature} aria-label="Constructor de ciclos no disponible">
        <div className={styles.utilityRow}>
          <AppBackButton onBack={onExit} />
        </div>
        <main className={styles.content}>
          <StatusBanner
            tone="error"
            title="No pudimos cargar el constructor de ciclos"
            body="Falta una conexión válida con tus datos. Vuelve e inténtalo nuevamente."
          />
        </main>
      </section>
    );
  }

  return (
    <ConnectedTrainingCycleBuilder
      initialViewModel={initialViewModel}
      gateway={gateway}
      shell={shell}
      chromeMode={chromeMode}
      onExit={onExit}
      onStartTraining={onStartTraining}
    />
  );
}

function ConnectedTrainingCycleBuilder({
  initialViewModel: viewModel,
  gateway,
  shell,
  chromeMode,
  onExit,
  onStartTraining,
}: {
  readonly initialViewModel: TrainingCycleBuilderInitialViewModel;
  readonly gateway: TrainingCycleBuilderGateway;
  readonly shell: TrainingCycleBuilderShellProps;
  readonly chromeMode: "standalone" | "embedded";
  readonly onExit: () => void;
  readonly onStartTraining?: TrainingCycleStartTrainingHandler;
}) {
  const controller = useTrainingCycleBuilderController({ initialViewModel: viewModel, gateway });
  const { state, dispatch } = controller;
  const durationDays = getIsoDayDifference(state.draft.startDate, state.draft.endDate);
  const durationWeeks = Number.isFinite(durationDays) && durationDays > 0
    ? Math.max(1, Math.round(durationDays / 7))
    : 0;
  const trainingMeta = {
    cycleLabel: TRAINING_CYCLE_GOAL_LABELS[state.draft.goal],
    weekLabel: `${durationWeeks} semanas`,
    progressLabel: `${state.draft.selectedDays.length} días`,
  };

  function handleBack() {
    if (state.screen === "success") {
      dispatch({ type: "show_active" });
      return;
    }
    if (state.screen === "active") {
      onExit();
      return;
    }
    if (!controller.goBack()) onExit();
  }

  function handleNotifications() {
    if (shell.onNotificationPanelToggle) {
      shell.onNotificationPanelToggle();
      return;
    }
    dispatch({ type: "navigate", screen: "alerts" });
  }

  async function handleStartTraining() {
    if (!state.activeCycleId || !onStartTraining) {
      dispatch({ type: "show_active" });
      return;
    }
    const started = await onStartTraining(state.activeCycleId);
    if (started !== false) dispatch({ type: "show_active" });
  }

  let screenContent: ReactNode;
  switch (state.screen) {
    case "start":
      screenContent = <CycleStartScreen state={state} viewModel={viewModel} dispatch={dispatch} />;
      break;
    case "duplicate":
      screenContent = <CycleDuplicateScreen state={state} viewModel={viewModel} dispatch={dispatch} />;
      break;
    case "setup":
      screenContent = (
        <CycleSetupScreen
          state={state}
          dispatch={dispatch}
          onGenerateSuggestion={() => void controller.generateSuggestion()}
        />
      );
      break;
    case "routine":
      screenContent = <CycleRoutineScreen state={state} dispatch={dispatch} />;
      break;
    case "catalog":
      screenContent = <CycleCatalogScreen state={state} viewModel={viewModel} dispatch={dispatch} />;
      break;
    case "custom":
      screenContent = (
        <CycleCustomExerciseScreen
          state={state}
          dispatch={dispatch}
          onSave={() => void controller.saveCustomExercise()}
        />
      );
      break;
    case "exercise":
      screenContent = <CycleExerciseScreen state={state} dispatch={dispatch} />;
      break;
    case "muscle":
      screenContent = <CycleMuscleScreen state={state} dispatch={dispatch} />;
      break;
    case "review":
      screenContent = (
        <CycleReviewScreen
          state={state}
          dispatch={dispatch}
          onActivate={() => void controller.activate()}
          onSaveActive={() => void controller.saveActiveCycle()}
          onRetrySave={() => void controller.retrySave()}
        />
      );
      break;
    case "success":
      screenContent = (
        <CycleSuccessScreen
          state={state}
          viewModel={viewModel}
          onStartTraining={() => void handleStartTraining()}
          onReviewCycle={() => dispatch({ type: "show_active" })}
          onExit={onExit}
        />
      );
      break;
    case "active":
      screenContent = <CycleActiveScreen state={state} viewModel={viewModel} dispatch={dispatch} />;
      break;
    case "alerts":
      screenContent = <CycleAlertsScreen viewModel={viewModel} dispatch={dispatch} />;
      break;
    case "closing":
      screenContent = <CycleClosingScreen dispatch={dispatch} />;
      break;
    case "next":
      screenContent = <CycleNextScreen viewModel={viewModel} dispatch={dispatch} />;
      break;
  }

  return (
    <section className={styles.feature} aria-label="Creación y gestión del ciclo de entrenamiento">
      {chromeMode === "standalone" ? (
        <AppTopbar
          isHidden={false}
          isMenuOpen={shell.isMenuOpen}
          onMenuToggle={shell.onMenuToggle}
          trainingMeta={trainingMeta}
          fallbackText="Crea tu ciclo"
          isNotificationPanelOpen={shell.isNotificationPanelOpen}
          notificationBadgeText={shell.notificationBadgeText}
          notificationBadgeAriaLabel={shell.notificationBadgeAriaLabel}
          onToggleNotifications={handleNotifications}
        />
      ) : null}
      <div className={styles.utilityRow}>
        <AppBackButton onBack={handleBack} />
        {state.workflow === "draft" ? (
          <SaveChip state={state.saveState} savedAtLabel={state.savedAtLabel} />
        ) : null}
      </div>
      <StepBar screen={state.screen} />
      <div className={styles.bannerStack}>
        {state.recoveredDraftBannerOpen ? (
          <StatusBanner
            tone="success"
            title="Recuperamos tu borrador"
            body="Volvimos exactamente a donde lo dejaste."
            actionLabel="Entendido"
            onAction={() => dispatch({ type: "dismiss_recovered_banner" })}
          />
        ) : null}
        {state.workflow === "draft" && state.saveState === "offline" ? (
          <StatusBanner tone="warning" title="Sin conexión" body="Seguimos guardando en este dispositivo y enviaremos los cambios al reconectar." />
        ) : null}
        {state.workflow === "draft" && state.saveState === "error" && state.screen !== "review" ? (
          <StatusBanner
            tone="error"
            title={state.saveErrorMessage?.includes("YouTube")
              ? "Revisa los enlaces de YouTube"
              : "No se pudo guardar en el servidor"}
            body={state.saveErrorMessage ?? "Tus cambios siguen disponibles aquí."}
            actionLabel="Reintentar"
            onAction={() => void controller.retrySave()}
          />
        ) : null}
      </div>
      <main className={styles.content}>{screenContent}</main>
      <CycleCopySheet state={state} dispatch={dispatch} />
      <CycleExtensionSheet state={state} viewModel={viewModel} dispatch={dispatch} onConfirm={() => void controller.extendCycle()} />
      {state.discardOpen && state.workflow === "draft" ? (
        <ConfirmDialog
          ariaLabel="Descartar borrador de ciclo"
          title="¿Descartar este borrador?"
          cancelLabel="Seguir editando"
          cancelVariant="primary"
          onCancel={() => dispatch({ type: "close_discard" })}
          confirmLabel="Sí, descartar"
          confirmBusyLabel="Descartando…"
          confirmVariant="danger"
          onConfirm={() => void controller.discardDraft()}
          isBusy={state.discardState === "discarding"}
        >
          <p>Se perderá la configuración local de este ciclo. Esta acción no se puede deshacer desde la aplicación.</p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
