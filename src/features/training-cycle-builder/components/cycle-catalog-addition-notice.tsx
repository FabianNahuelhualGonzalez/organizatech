"use client";

import { Check } from "lucide-react";
import { useEffect, type Dispatch } from "react";

import { TRAINING_CYCLE_DAY_LABELS } from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import type {
  TrainingCycleBuilderAction,
  TrainingCycleBuilderState,
} from "@/features/training-cycle-builder/hooks/training-cycle-builder-state";
import styles from "@/features/training-cycle-builder/components/training-cycle-builder.module.css";

/** Acknowledges the reducer's addition to this draft, never server persistence. */
export function CycleCatalogAdditionNotice({
  addition,
  dispatch,
}: {
  readonly addition: TrainingCycleBuilderState["catalogAddition"];
  readonly dispatch: Dispatch<TrainingCycleBuilderAction>;
}) {
  useEffect(() => {
    if (!addition) return;
    const timeout = setTimeout(() => {
      dispatch({ type: "dismiss_catalog_addition", exerciseId: addition.exerciseId });
    }, 4000);
    return () => clearTimeout(timeout);
  }, [addition, dispatch]);

  return (
    <div className={styles.catalogNoticeRegion} role="status" aria-live="polite" aria-atomic="true">
      {addition ? (
        <div key={addition.exerciseId} className={styles.catalogAdditionNotice}>
          <Check size={20} aria-hidden="true" />
          <span>{addition.name} agregado a {TRAINING_CYCLE_DAY_LABELS[addition.day]}</span>
        </div>
      ) : null}
    </div>
  );
}
