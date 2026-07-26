import { Sparkles } from "lucide-react";

import {
  clampDashboardCoachFactorValue,
  resolveDashboardCoachFactorLabel,
} from "@/lib/dashboard/dashboard-card-model";
import type {
  DashboardAnalyticsSnapshot,
  DashboardCoachVisualStatus,
} from "@/lib/dashboard/dashboard-types";
import type {
  CoachInsight,
  TrainingCoachFeedback,
} from "@/lib/training/training-coach-feedback";

export interface DashboardCoachCardProps {
  feedback: TrainingCoachFeedback;
  analytics: DashboardAnalyticsSnapshot;
  visualStatus: DashboardCoachVisualStatus;
}

export function DashboardCoachCard({
  feedback,
  analytics,
  visualStatus,
}: DashboardCoachCardProps) {
  const blocks: Array<{ id: string; label: string; insight: CoachInsight }> = [];
  const strength = feedback.strengths[0];
  const attention = feedback.attentions[0];
  const trend = feedback.historicalInsight;
  const hasTrend = Boolean(trend);
  const factors = analytics.factors.slice(0, 4).map(([label, value]) => ({
    label: resolveDashboardCoachFactorLabel(String(label)),
    value: clampDashboardCoachFactorValue(value),
  }));

  if (strength) blocks.push({ id: "strength", label: "Fortaleza", insight: strength });
  if (attention) blocks.push({ id: "attention", label: "Atención", insight: attention });
  if (feedback.readinessInsight) blocks.push({ id: "readiness", label: "Estado del cuerpo", insight: feedback.readinessInsight });
  blocks.push({
    id: "next",
    label: feedback.nextTarget ? "Próximo objetivo" : "Consejo",
    insight: {
      title: feedback.nextTarget ?? "Siguiente paso",
      body: feedback.nextAdvice,
      tone: feedback.tone === "warning" ? "warning" : "info",
      priority: 0,
    },
  });

  return (
    <div className={`card wide dashboard-coach-card ${feedback.tone}`}>
      <div className="smart-card-header dashboard-coach-header">
        <div>
          <p className="eyebrow">Coach Organizatech</p>
          <h3>{feedback.headline}</h3>
        </div>
        <Sparkles size={19} />
      </div>
      <div className="coach-status-band">
        {visualStatus.showScore ? (
          <div className={`coach-score ${feedback.tone}`}>
            <strong>{analytics.score}</strong>
            <span>/100</span>
          </div>
        ) : (
          <div className={`coach-status-pill ${feedback.tone}`}>
            <span>{visualStatus.badgeLabel ?? visualStatus.label}</span>
          </div>
        )}
        <div className="coach-status-copy">
          <strong>{visualStatus.label}</strong>
          <span>{visualStatus.detail}</span>
        </div>
      </div>
      {visualStatus.showFactors !== false ? (
        <div className="coach-factor-list" aria-label={visualStatus.factorLabel}>
          <span className="coach-factor-heading">{visualStatus.factorLabel}</span>
          {factors.map((factor) => (
            <div className="coach-factor-row" key={factor.label}>
              <div>
                <span>{factor.label}</span>
                <small>{Math.round(factor.value)}/100</small>
              </div>
              <div className="coach-factor-track" aria-hidden="true">
                <span style={{ width: `${factor.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {trend ? (
        <div className={`coach-trend-block ${trend.tone}`}>
          <span>Tendencia</span>
          <strong>{trend.title}</strong>
          <p>{trend.body}</p>
          {trend.action ? <small>{trend.action}</small> : null}
        </div>
      ) : null}
      <div className="coach-summary-block">
        <span>Lectura rápida</span>
        <p>{feedback.summary}</p>
      </div>
      <div className="coach-insight-grid">
        {blocks.slice(0, hasTrend ? 3 : 4).map((block) => (
          <div className={`coach-insight-block ${block.insight.tone}`} key={block.id}>
            <span>{block.label}</span>
            <strong>{block.insight.title}</strong>
            <p>{block.insight.body}</p>
            {block.insight.action ? <small>{block.insight.action}</small> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
