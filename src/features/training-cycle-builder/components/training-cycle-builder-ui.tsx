"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  LoaderCircle,
  WifiOff,
  X,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import type {
  TrainingCycleBuilderScreen,
  TrainingCycleSaveState,
} from "@/features/training-cycle-builder/components/training-cycle-builder-contracts";
import styles from "@/features/training-cycle-builder/components/training-cycle-builder.module.css";
import { MODAL_INITIAL_FOCUS_ATTRIBUTE, ModalShell } from "@/ui/modals/modal-shell";

export function ScreenHeading({
  title,
  description,
}: {
  readonly title: string;
  readonly description?: string;
}) {
  return (
    <header className={styles.screenHeading}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </header>
  );
}

export function PrimaryAction({
  children,
  isBusy = false,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly isBusy?: boolean }) {
  return (
    <button
      {...buttonProps}
      className={`${styles.primaryAction} ${buttonProps.className ?? ""}`}
      type={buttonProps.type ?? "button"}
      aria-busy={isBusy || undefined}
    >
      {isBusy ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function SecondaryAction({
  children,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...buttonProps}
      className={`${styles.secondaryAction} ${buttonProps.className ?? ""}`}
      type={buttonProps.type ?? "button"}
    >
      {children}
    </button>
  );
}

export function SaveChip({
  state,
  savedAtLabel,
}: {
  readonly state: TrainingCycleSaveState;
  readonly savedAtLabel: string;
}) {
  const labels: Record<TrainingCycleSaveState, string> = {
    loading: "Cargando…",
    saving: "Guardando…",
    saved: savedAtLabel,
    offline: "Sin conexión · guardado aquí",
    error: "No se pudo guardar",
  };
  return (
    <div className={styles.saveChip} data-state={state} role="status" aria-live="polite">
      {state === "loading" || state === "saving"
        ? <LoaderCircle className={styles.spinner} size={12} aria-hidden="true" />
        : null}
      {labels[state]}
    </div>
  );
}

const STEP_SCREEN: Partial<Record<TrainingCycleBuilderScreen, number>> = {
  setup: 0,
  routine: 1,
  catalog: 1,
  custom: 1,
  exercise: 1,
  muscle: 1,
  review: 2,
};

export function StepBar({ screen }: { readonly screen: TrainingCycleBuilderScreen }) {
  const activeStep = STEP_SCREEN[screen];
  if (activeStep === undefined) return null;
  return (
    <ol className={styles.stepBar} aria-label="Progreso de creación">
      {["Objetivo", "Rutina", "Revisión"].map((label, index) => (
        <li key={label} data-current={index === activeStep} data-complete={index < activeStep}>
          <span aria-hidden="true" />
          <small>{label}</small>
        </li>
      ))}
    </ol>
  );
}

export function StatusBanner({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  readonly tone: "success" | "warning" | "error" | "info";
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  const Icon = tone === "success"
    ? Check
    : tone === "warning"
      ? AlertTriangle
      : tone === "error"
        ? WifiOff
        : Info;
  return (
    <div className={styles.statusBanner} data-tone={tone} role={tone === "error" ? "alert" : "status"}>
      <Icon size={15} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      ) : null}
    </div>
  );
}

export function ChoiceChip({
  selected,
  children,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly selected: boolean }) {
  return (
    <button
      {...buttonProps}
      className={styles.choiceChip}
      data-selected={selected}
      type="button"
      aria-pressed={selected}
    >
      {children}
    </button>
  );
}

export function AccordionSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  const panelId = `${id}-panel`;
  return (
    <section className={styles.accordionSection}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        <span>
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? <div id={panelId} className={styles.accordionPanel}>{children}</div> : null}
    </section>
  );
}

export function BottomSheet({
  titleId,
  title,
  description,
  onClose,
  canClose = true,
  children,
  footer,
}: {
  readonly titleId: string;
  readonly title: string;
  readonly description: string;
  readonly onClose: () => void;
  readonly canClose?: boolean;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <ModalShell
      ariaLabel={title}
      onClose={onClose}
      canClose={canClose}
      cardClassName={styles.bottomSheet}
    >
        <div className={styles.sheetGrip} aria-hidden="true"><span /></div>
        <header className={styles.sheetHeader}>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            disabled={!canClose}
            onClick={onClose}
            {...{ [MODAL_INITIAL_FOCUS_ATTRIBUTE]: "" }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.sheetBody}>{children}</div>
        {footer ? <footer className={styles.sheetFooter}>{footer}</footer> : null}
    </ModalShell>
  );
}
