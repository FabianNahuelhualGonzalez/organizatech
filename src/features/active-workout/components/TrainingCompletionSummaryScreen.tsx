import React, { type ReactNode } from "react";
import {
  compareTrainingCompletionSummary,
  type TrainingCompletionComparedExercise,
  type TrainingCompletionSummary,
  type TrainingCompletionTone,
} from "@/lib/training/training-completion-summary";
import styles from "./training-completion-summary.module.css";

export interface TrainingCompletionSummaryScreenProps {
  summary: TrainingCompletionSummary;
  onDashboard: () => void;
  advancedExecutionSync?: ReactNode;
}

export function TrainingCompletionSummaryScreen({
  summary,
  onDashboard,
  advancedExecutionSync,
}: TrainingCompletionSummaryScreenProps) {
  const comparison = compareTrainingCompletionSummary(summary);
  const completed = comparison.registered === comparison.total;
  const titleId = "training-completion-title";
  const summaryLabel = comparison.hasComparison
    ? `Comparado con el ${comparison.previousDateLabel}: ${comparison.increased} subieron, ${comparison.equal} iguales, ${comparison.decreased} bajaron. Repeticiones totales ${comparison.previousTotalReps} a ${comparison.currentTotalReps}.`
    : "Primera sesión de este día, todavía no hay una sesión anterior para comparar.";

  return (
    <main className={styles.screen} aria-labelledby={titleId}>
      <div className={styles.body}>
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <div className={styles.pills}>
              <span className={`${styles.pill} ${styles.dayPill}`}>{summary.dayLabel}</span>
              <span className={`${styles.pill} ${completed ? styles.completedPill : styles.partialPill}`}>
                {completed ? "✓ Completado" : "Registrado"} · {comparison.registered} de {comparison.total}
              </span>
            </div>
            <p className={styles.eyebrow}>ENTRENAMIENTO REGISTRADO</p>
            <h1 className={styles.title} id={titleId}>{summary.workoutName}</h1>
            <p className={styles.meta}>
              {summary.cycleLabel} · {summary.weekLabel} · {formatProgressLabel(summary.progressLabel)}
              {summary.durationMinutes !== null ? <> · Duración <strong>{summary.durationLabel}</strong></> : null}
            </p>
          </div>
          <div className={styles.headerAction}>
            <DashboardButton onDashboard={onDashboard} />
          </div>
        </header>

        <div className={styles.layout}>
          <aside className={styles.side} aria-label="Resumen de la comparación">
            <section className={styles.summary} aria-label={summaryLabel}>
              {comparison.hasComparison ? (
                <>
                  <div className={styles.summaryLabel}>
                    <span className={styles.eyebrow}>VS. SESIÓN ANTERIOR · {comparison.previousDateLabel}</span>
                    <Legend className={styles.inlineLegend} />
                  </div>
                  <div className={styles.summaryGrid}>
                    <SummaryCount tone="up" symbol="▲" value={comparison.increased} label="Subieron" />
                    <SummaryCount tone="eq" symbol="=" value={comparison.equal} label="Iguales" />
                    <SummaryCount tone="down" symbol="▼" value={comparison.decreased} label="Bajaron" />
                    <div className={styles.total}>
                      <span className={styles.totalLabel}>Reps totales</span>
                      <span className={styles.totalValue}>
                        <span>{comparison.previousTotalReps} → {comparison.currentTotalReps}</span>
                        <DifferenceChip kind="reps-total" difference={comparison.totalRepsDifference} />
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className={styles.firstSession}>
                  <p className={styles.eyebrow}>PRIMERA SESIÓN DE ESTE DÍA</p>
                  <p>Aún no hay una sesión anterior para comparar. La próxima vez verás aquí si subiste o bajaste.</p>
                </div>
              )}
            </section>
            <Legend className={styles.sideLegend} />
          </aside>

          <section className={styles.exercises} aria-labelledby="training-completion-exercises-title">
            <p className={styles.eyebrow} id="training-completion-exercises-title">EJERCICIOS · {comparison.total}</p>
            <ul className={styles.exerciseGrid}>
              {comparison.exercises.map((exercise) => (
                <ExerciseCard exercise={exercise} key={exercise.exerciseId} />
              ))}
            </ul>
          </section>
        </div>

        {advancedExecutionSync ?? null}
      </div>

      <footer className={styles.footer}>
        <DashboardButton onDashboard={onDashboard} />
      </footer>
    </main>
  );
}

function SummaryCount({
  tone,
  symbol,
  value,
  label,
}: {
  tone: "up" | "down" | "eq";
  symbol: "▲" | "▼" | "=";
  value: number;
  label: string;
}) {
  return (
    <div className={`${styles.count} ${styles[tone]}`}>
      <span className={styles.countValue}><span aria-hidden="true">{symbol}</span> {value}</span>
      <span className={styles.countLabel}>{label}</span>
    </div>
  );
}

function ExerciseCard({ exercise }: { exercise: TrainingCompletionComparedExercise }) {
  const seriesLabel = `${exercise.currentSeriesCount} ${exercise.currentSeriesCount === 1 ? "serie" : "series"}`;
  const cardClassName = `${styles.exerciseCard} ${styles[`card_${exercise.state}`]}`;

  if (exercise.state === "pending") {
    return (
      <li className={cardClassName}>
        <ExerciseCardHeader name={exercise.exerciseName} seriesLabel={seriesLabel} />
        <div className={styles.pendingRow}>
          <p>No registrado en esta sesión</p>
          <span className={`${styles.chip} ${styles.chip_pending}`} aria-label="Ejercicio sin registro">Sin registro</span>
        </div>
      </li>
    );
  }

  if (exercise.state === "new") {
    return (
      <li className={cardClassName}>
        <ExerciseCardHeader name={exercise.exerciseName} seriesLabel={seriesLabel} />
        <div className={styles.metrics}>
          <span className={styles.metricKey}>REPS</span>
          <span className={styles.metricValue}><strong>{exercise.currentTotalReps}</strong></span>
          <span
            className={`${styles.chip} ${styles.chip_new}`}
            aria-label={exercise.comparisonStatus === "unavailable" ? "Comparación no disponible" : "Primera vez para este ejercicio"}
          >
            {exercise.comparisonStatus === "unavailable" ? "Sin comparación" : "Primera vez"}
          </span>
          <span className={styles.metricKey}>KG</span>
          <span className={styles.metricValue}><strong>{formatWeightValue(exercise.currentWeight)}</strong></span>
          <span />
        </div>
      </li>
    );
  }

  return (
    <li className={cardClassName}>
      <ExerciseCardHeader name={exercise.exerciseName} seriesLabel={seriesLabel} />
      <div className={styles.metrics}>
        <span className={styles.metricKey}>REPS</span>
        <ComparisonValue previous={exercise.previousTotalReps} current={exercise.currentTotalReps} />
        <DifferenceChip kind="reps" difference={exercise.repsDifference ?? 0} />
        <span className={styles.metricKey}>KG</span>
        <ComparisonValue previous={exercise.previousWeightLabel} current={formatWeightValue(exercise.currentWeight)} />
        <DifferenceChip kind="kg" difference={exercise.weightDifference ?? 0} />
      </div>
    </li>
  );
}

function ExerciseCardHeader({ name, seriesLabel }: { name: string; seriesLabel: string }) {
  return (
    <div className={styles.exerciseHeader}>
      <strong>{name}</strong>
      <span>{seriesLabel}</span>
    </div>
  );
}

function ComparisonValue({ previous, current }: { previous: number | string | null; current: number | string }) {
  return (
    <span className={styles.metricValue}>
      <span className={styles.previous}>{previous ?? "—"}</span>{" "}
      <span className={styles.arrow} aria-hidden="true">→</span>
      <span className={styles.srOnly}> a </span>{" "}
      <strong>{current}</strong>
    </span>
  );
}

function DifferenceChip({
  kind,
  difference,
}: {
  kind: "reps" | "kg" | "reps-total";
  difference: number;
}) {
  const tone = differenceTone(difference);
  const symbol = tone === "positive" ? "▲" : tone === "danger" ? "▼" : "=";
  const amount = formatNumber(Math.abs(difference));
  const visibleLabel = difference === 0
    ? "= Igual"
    : kind === "kg"
      ? `${symbol} ${difference > 0 ? "+" : "−"}${amount} kg`
      : kind === "reps"
        ? `${symbol} ${difference > 0 ? "+" : "−"}${amount} ${Math.abs(difference) === 1 ? "rep" : "reps"}`
        : `${symbol} ${difference > 0 ? "+" : "−"}${amount}`;
  const ariaLabel = differenceAriaLabel(kind, difference);

  return (
    <span className={`${styles.chip} ${styles[`chip_${tone}`]}`} aria-label={ariaLabel}>
      <span aria-hidden="true">{visibleLabel}</span>
    </span>
  );
}

function Legend({ className }: { className: string }) {
  return (
    <div className={`${styles.legend} ${className}`} aria-hidden="true">
      <span><strong className={styles.legendUp}>▲</strong> subió</span>
      <span><strong className={styles.legendDown}>▼</strong> bajó</span>
      <span><strong>=</strong> igual</span>
    </div>
  );
}

function DashboardButton({ onDashboard }: { onDashboard: () => void }) {
  return (
    <button className={styles.dashboardButton} type="button" onClick={onDashboard}>
      Ir al panel principal
    </button>
  );
}

function differenceTone(difference: number): TrainingCompletionTone {
  if (difference > 0) return "positive";
  if (difference < 0) return "danger";
  return "neutral";
}

function differenceAriaLabel(kind: "reps" | "kg" | "reps-total", difference: number) {
  if (kind === "kg") {
    if (difference === 0) return "peso igual";
    return `${formatNumber(Math.abs(difference))} kilos ${difference > 0 ? "más" : "menos"}`;
  }
  if (difference === 0) return "repeticiones iguales";
  const amount = Math.abs(difference);
  return `${formatNumber(amount)} ${amount === 1 ? "repetición" : "repeticiones"} ${difference > 0 ? "más" : "menos"}`;
}

function formatWeightValue(value: number | null) {
  return value === null ? "—" : formatNumber(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value);
}

function formatProgressLabel(value: string) {
  const normalized = value.trim();
  if (/^(Día|Rutina)\b/i.test(normalized)) return normalized;

  const progress = /^(\d+\s+de\s+\d+)\s+(días?|rutinas?)$/i.exec(normalized);
  if (!progress) return `Día ${normalized}`;

  return `${/^rutina/i.test(progress[2]) ? "Rutina" : "Día"} ${progress[1]}`;
}
