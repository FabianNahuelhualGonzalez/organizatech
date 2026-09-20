"use client";

import type { CoachDashboardViewProps } from "./coach-dashboard-view";
import { CoachWelcome } from "./coach-welcome";
import { CoachIncomeCard } from "./coach-income-card";
import { CoachPortfolioGrid } from "./coach-portfolio-grid";
import { CoachAlertsCard } from "./coach-alerts-card";
import { CoachQuickActions } from "./coach-quick-actions";
import { CoachMonthlyChart } from "./coach-monthly-chart";
import { CoachRenewalsCard } from "./coach-renewals-card";
import styles from "./coach-dashboard.module.css";

/** Isolated presentational infrastructure. It does not replace the productive shell. */
export function CoachDashboardView({ view, actions }: CoachDashboardViewProps) {
  return (
    <section className={styles.view} aria-label="Panel principal Coach" data-coach-dashboard="productive">
      <div className={styles.content}>
        <CoachWelcome view={view.welcome} />
        <CoachIncomeCard view={view.income} onEditFee={actions.onEditFee} />
        <CoachPortfolioGrid view={view.portfolio} onSelect={actions.onPortfolio} />
        <CoachAlertsCard view={view.alerts} onAdd={actions.onLink} onAlert={actions.onAlert}
          onViewAlerts={actions.onPortfolio?.alert} />
        <CoachQuickActions onCalendar={actions.onCalendar} onLink={actions.onLink} onChat={actions.onChat} />
        <CoachMonthlyChart view={view.chart} onSelectMonth={actions.onSelectMonth} />
        <CoachRenewalsCard view={view.renewals} onSelect={actions.onRenewal} />
      </div>
    </section>
  );
}
