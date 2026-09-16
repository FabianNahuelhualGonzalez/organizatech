/**
 * Presentational contract only. Selectors supply formatted values and civil-date
 * labels; components never infer income, renewal state, permissions or ownership.
 * null means unknown, not zero. Productive consumers still supply every fact.
 */
export type CoachDashboardTone = "neutral" | "accent" | "ok" | "pending" | "error";
export type CoachPortfolioFilter = "active" | "alert" | "pending" | "inactive";
export type CoachPortfolioActions = Readonly<Partial<Record<CoachPortfolioFilter, () => void>>>;
export type CoachRenewalState = "renewed" | "pending" | "declined";

export interface CoachMetricView {
  readonly value: number | null;
  /** Includes its unavailable label when value is null. Never formatted by UI. */
  readonly label: string;
}

export interface CoachWelcomeView {
  readonly coachName: string;
  readonly todayLabel: string | null;
}

export interface CoachIncomeView {
  readonly amount: CoachMetricView;
  readonly comparisonLabel: string | null;
  readonly comparisonTone: "neutral" | "ok" | "pending";
  readonly formulaLabel: string | null;
  readonly atRisk: CoachMetricView;
  readonly atRiskNote: string | null;
  readonly potential: CoachMetricView;
  readonly potentialLabel: string;
  readonly potentialNote: string | null;
}

export interface CoachPortfolioView {
  readonly totalLabel: string | null;
  readonly active: CoachMetricView;
  readonly alert: CoachMetricView;
  readonly pending: CoachMetricView;
  readonly inactive: CoachMetricView;
  /** The controller distinguishes accepted links from students with a cycle. */
  readonly activeNote: string;
}

export interface CoachAlertRowView {
  readonly id: string;
  readonly clientName: string;
  readonly initials: string;
  readonly reason: string;
  readonly whenLabel: string | null;
  readonly dateLabel: string | null;
  readonly tone: "pending" | "error";
}

export interface CoachAlertsView {
  readonly description: string;
  readonly rows: readonly CoachAlertRowView[];
  readonly emptyLabel: string | null;
  readonly footerLabel: string | null;
}

export interface CoachMonthView {
  readonly id: string;
  readonly shortLabel: string;
  readonly fullLabel: string;
  readonly ariaLabel: string;
  readonly students: CoachMetricView;
  readonly joined: CoachMetricView;
  readonly left: CoachMetricView;
  readonly leftTone: "neutral" | "pending";
  readonly estimatedIncome: CoachMetricView;
  readonly readingLabel: string | null;
  readonly readingTone: CoachDashboardTone;
  readonly isBest: boolean;
  /** Geometric proportion, 0..1, supplied by the mapper; null draws no bar. */
  readonly barRatio: number | null;
}

export interface CoachMonthlyChartView {
  readonly months: readonly CoachMonthView[];
  readonly selectedMonthId: string | null;
  readonly emptyLabel: string | null;
  readonly noSelectionLabel: string | null;
}

export interface CoachRenewalRowView {
  readonly id: string;
  readonly clientName: string;
  readonly state: CoachRenewalState;
  readonly stateLabel: string;
  readonly subtitle: string;
  readonly subtitleTone: CoachDashboardTone;
  readonly endDateLabel: string | null;
  readonly remainingLabel: string | null;
  readonly ariaLabel: string;
}

export interface CoachRenewalSegmentView {
  readonly state: CoachRenewalState;
  readonly label: string;
  /** Domain supplies the distribution; zero/null draw no segment. No summing in UI. */
  readonly ratio: number | null;
}

export interface CoachRenewalsView {
  readonly title: string;
  readonly description: string;
  readonly atStake: CoachMetricView;
  readonly stack: {
    readonly ariaLabel: string;
    readonly segments: readonly CoachRenewalSegmentView[];
  } | null;
  readonly rows: readonly CoachRenewalRowView[];
  readonly emptyLabel: string | null;
  readonly retentionLabel: string | null;
}

export interface CoachDashboardViewModel {
  readonly welcome: CoachWelcomeView;
  readonly income: CoachIncomeView;
  readonly portfolio: CoachPortfolioView;
  readonly alerts: CoachAlertsView;
  readonly chart: CoachMonthlyChartView;
  readonly renewals: CoachRenewalsView;
}

export interface CoachDashboardActions {
  readonly onEditFee?: () => void;
  /** Each destination is authorized independently; no generic catch-all handler. */
  readonly onPortfolio?: CoachPortfolioActions;
  readonly onAlert?: (id: string) => void;
  readonly onLink?: () => void;
  readonly onCalendar?: () => void;
  readonly onChat?: () => void;
  readonly onSelectMonth?: (id: string) => void;
  readonly onRenewal?: (id: string) => void;
}

export interface CoachDashboardViewProps {
  readonly view: CoachDashboardViewModel;
  readonly actions: CoachDashboardActions;
}
