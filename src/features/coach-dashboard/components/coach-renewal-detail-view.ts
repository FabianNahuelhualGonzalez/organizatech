import type { CoachMetricView, CoachRenewalState } from "./coach-dashboard-view";
import type { CoachSheetFocusProps, CoachSheetMessageView } from "./coach-dashboard-sheet-view";

export interface CoachRenewalDetailView {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly id: string;
  readonly clientName: string;
  readonly initials: string | null;
  readonly metaLabel: string | null;
  readonly state: CoachRenewalState;
  readonly stateLabel: string | null;
  readonly stateCaption: string | null;
  readonly sourceLabel: string | null;
  readonly facts: {
    readonly endsOnLabel: string | null;
    readonly lastTrainingLabel: string | null;
    readonly consistencyLabel: string | null;
    readonly monthlyFee: CoachMetricView;
  };
  readonly paidPeriodDates: { readonly label: string | null; readonly isIncomplete: boolean } | null;
  readonly canSave: boolean;
  readonly saveLabel: "Listo" | "Completa las fechas" | "Corrige las fechas";
  readonly message: CoachSheetMessageView | null;
}

export interface CoachRenewalDatesView {
  readonly isOpen: boolean;
  readonly isBusy: boolean;
  readonly subjectLabel: string | null;
  readonly startRaw: string | null;
  readonly endRaw: string | null;
  readonly startMin: string | null;
  readonly endMin: string | null;
  readonly startInvalid: boolean;
  readonly endInvalid: boolean;
  readonly validation: { readonly kind: "ok" | "warn" | "err"; readonly label: string } | null;
  readonly pauseLabel: string | null;
  readonly canAccept: boolean;
  readonly acceptLabel: "Confirmar fechas" | "Completa las fechas" | "Corrige las fechas";
  readonly message: CoachSheetMessageView | null;
}

export interface CoachRenewalDatesActions {
  readonly onChangeDates?: (field: "start" | "end", raw: string) => void;
  readonly onAcceptDates?: () => void;
  readonly onCancelDates?: () => void;
}

export interface CoachRenewalDetailActions extends CoachRenewalDatesActions {
  readonly onSelectState?: (state: CoachRenewalState) => void;
  readonly onOpenDates?: () => void;
  readonly onSave?: () => void;
  readonly onCancelDetail?: () => void;
}

export interface CoachRenewalDetailSheetProps extends CoachSheetFocusProps {
  readonly view: CoachRenewalDetailView;
  readonly dates: CoachRenewalDatesView;
  readonly actions: CoachRenewalDetailActions;
}

export interface CoachRenewalDatesModalProps extends CoachSheetFocusProps {
  readonly view: CoachRenewalDatesView;
  readonly actions: CoachRenewalDatesActions;
}
