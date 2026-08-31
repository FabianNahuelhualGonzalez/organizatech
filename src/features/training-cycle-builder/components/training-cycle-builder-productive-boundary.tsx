"use client";

import type { TrainingCycleBuilderShellProps } from "./training-cycle-builder-contracts";
import { TrainingCycleBuilder } from "./training-cycle-builder";
import type { TrainingCycleProductController } from "../hooks/use-training-cycle-product-controller";
import { AppBackButton } from "@/ui/navigation/app-back-button";
import styles from "./training-cycle-builder.module.css";

export function TrainingCycleBuilderProductiveBoundary(props: {
  readonly controller: TrainingCycleProductController;
  readonly shell: TrainingCycleBuilderShellProps;
  readonly onExit: () => void;
  readonly openAlertsRequest?: number;
}) {
  if (props.controller.status === "loading" || props.controller.status === "error") {
    return (
      <section className={styles.feature} aria-label="Constructor de ciclos">
        <div className={styles.utilityRow}><AppBackButton onBack={props.onExit} /></div>
        <main className={styles.content}>
          <p role={props.controller.status === "error" ? "alert" : "status"}>
            {props.controller.status === "loading"
              ? "Cargando tu ciclo de entrenamiento…"
              : props.controller.message}
          </p>
          {props.controller.status === "error" ? (
            <button type="button" onClick={props.controller.reload}>Reintentar</button>
          ) : null}
        </main>
      </section>
    );
  }
  if (props.controller.status !== "ready") return null;
  const initialViewModel = props.openAlertsRequest && props.controller.viewModel.activeCycleId
    ? { ...props.controller.viewModel, initialScreen: "alerts" as const }
    : props.controller.viewModel;
  return (
    <TrainingCycleBuilder
      key={`${initialViewModel.activeCycleId ?? initialViewModel.draft.draftId}:${props.openAlertsRequest ?? 0}`}
      initialViewModel={initialViewModel}
      gateway={props.controller.gateway}
      shell={props.shell}
      chromeMode="embedded"
      onExit={props.onExit}
      onStartTraining={props.controller.onStartTraining}
    />
  );
}
