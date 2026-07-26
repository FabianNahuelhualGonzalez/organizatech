"use client";

import {
  CartesianGrid,
  Line,
  LineChart as ReLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { WeeklyMetricSummaryView } from "@/features/progress/components/weekly-metric-summary-view";
import type { WeeklyExerciseComparisonModel } from "@/lib/progress/weekly-exercise-comparison";

export interface WeeklyMetricProgressCardProps {
  title: string;
  helper: string;
  model: WeeklyExerciseComparisonModel;
  metric: "kg" | "reps";
}

export function WeeklyMetricProgressCard({
  title,
  helper,
  model,
  metric,
}: WeeklyMetricProgressCardProps) {
  const summary = metric === "kg" ? model.kgSummary : model.repsSummary;
  const series = metric === "kg" ? model.kgChartSeries : model.repsChartSeries;
  const chartData = series.map((point) => ({ label: point.label, value: point.value, date: point.date }));
  const hasEnoughChartData = series.length > 1;
  const unit = metric === "kg" ? "kg" : "reps";

  return (
    <section className="weekly-comparison-section weekly-metric-card">
      <h3>{title}</h3>
      <p>{helper}</p>
      <div className="weekly-selected-exercise">{model.selectedExercise?.name ?? "Sin ejercicio seleccionado"}</div>

      {hasEnoughChartData ? (
        <div className="weekly-chart-box">
          <ResponsiveContainer width="100%" height={210}>
            <ReLineChart data={chartData} margin={{ top: 18, right: 18, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="rgba(220,231,255,.12)" />
              <XAxis dataKey="label" stroke="#9CA8B8" />
              <YAxis stroke="#9CA8B8" width={38} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value} ${unit}`, metric === "kg" ? "Peso" : "Reps"]} labelFormatter={(label) => `${label}`} />
              <Line type="monotone" dataKey="value" stroke="#3C7AFF" strokeWidth={3} dot={{ r: 5, strokeWidth: 2 }} activeDot={{ r: 7 }} />
            </ReLineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="weekly-comparison-empty">Aún no hay datos suficientes para graficar este ejercicio.</div>
      )}

      <p className="weekly-chart-copy">
        {metric === "kg"
          ? "El gráfico muestra cómo cambia la carga registrada para este ejercicio durante el ciclo de entrenamiento."
          : "El gráfico muestra cómo cambian las repeticiones registradas para este ejercicio durante el ciclo de entrenamiento."}
      </p>

      <WeeklyMetricSummaryView summary={summary} model={model} metric={metric} />
    </section>
  );
}

const tooltipStyle = {
  background: "#101B27",
  border: "1px solid rgba(220,231,255,.14)",
  borderRadius: 8,
  color: "#FFFFFF",
};
