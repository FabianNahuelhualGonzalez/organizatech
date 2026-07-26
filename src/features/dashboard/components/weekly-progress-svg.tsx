"use client";

import { useEffect, useMemo, useState } from "react";

import { buildWeeklyProgressAriaLabel } from "@/lib/dashboard/dashboard-presentation";
import { formatKgNullable } from "@/lib/progress/weight-format";
import {
  buildAreaPath,
  buildSvgPath,
  buildWeeklyProgressChart,
} from "@/lib/progress/weekly-progress-chart";
import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";

export interface WeeklyProgressSvgProps {
  progress: WeeklyEquivalentProgressResult;
}

export function WeeklyProgressSvg({ progress }: WeeklyProgressSvgProps) {
  const hasPreviousReference = progress.status === "ready";
  const chart = useMemo(() => buildWeeklyProgressChart({
    currentSeries: progress.points.map((point) => ({
      label: point.label,
      value: point.currentVolume,
      comparable: point.currentVolume !== null,
      volume: point.currentVolume,
    })),
    previousSeries: progress.points.map((point) => ({
      label: point.label,
      value: hasPreviousReference ? point.previousVolume : null,
      comparable: hasPreviousReference && point.previousVolume !== null,
      volume: hasPreviousReference ? point.previousVolume : null,
    })),
    unit: "kg",
  }), [hasPreviousReference, progress.points]);
  const [activeIndex, setActiveIndex] = useState(chart.activeIndex);
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const labels = chart.labels;
  const currentPoints = chart.currentPoints;
  const previousPoints = chart.previousPoints;
  const chartViewBoxHeight = 144;

  useEffect(() => {
    setActiveIndex(chart.activeIndex);
    setIsTooltipVisible(false);
  }, [chart.activeIndex, labels.length]);

  const activeCurrentPoint = currentPoints[activeIndex] ?? currentPoints.find((point) => point.value !== null) ?? currentPoints[0];
  const activePreviousPoint = previousPoints[activeIndex] ?? previousPoints[0];
  const currentPath = buildSvgPath(currentPoints);
  const previousPath = buildSvgPath(previousPoints);
  const currentAreaPath = buildAreaPath(currentPoints);
  const tooltipAnchorX = activeCurrentPoint?.x ?? activePreviousPoint?.x ?? 240;
  const tooltipLeft = `clamp(68px, ${(tooltipAnchorX / 480) * 100}%, calc(100% - 136px))`;
  const tooltipTop = `clamp(18px, ${((activeCurrentPoint?.y ?? activePreviousPoint?.y ?? 65) / chartViewBoxHeight) * 100}%, calc(100% - 62px))`;
  const tooltipDay = progress.points[activeIndex]?.day ?? activeCurrentPoint?.label ?? "";
  const progressAriaLabel = buildWeeklyProgressAriaLabel(progress);

  return (
    <div
      className="weekly-progress-visual"
      aria-label={progressAriaLabel}
    >
      <div className="weekly-progress-legend" aria-hidden="true">
        <span><i className="current" /> Semana actual</span>
        {hasPreviousReference ? <span><i className="previous" /> Semana anterior</span> : null}
      </div>
      <div className="weekly-chart-stage">
        {isTooltipVisible ? (
          <div className="weekly-tooltip" style={{ left: tooltipLeft, top: tooltipTop }}>
            <strong>{tooltipDay}</strong>
            <span>Semana actual: {formatKgNullable(activeCurrentPoint?.value ?? null)}</span>
            <span>Semana anterior: {formatKgNullable(hasPreviousReference ? activePreviousPoint?.value ?? null : null)}</span>
          </div>
        ) : null}
        <div className="weekly-axis-values" aria-hidden="true">
          {chart.axisLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
        <svg viewBox={`0 0 480 ${chartViewBoxHeight}`} role="img">
          <defs>
            <linearGradient id="weeklyLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#63A2FF" />
              <stop offset="100%" stopColor="#1D5CFF" />
            </linearGradient>
            <filter id="weeklyGlow" x="-20%" y="-80%" width="140%" height="260%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {[18, 42, 65, 89, 112].map((y) => <line className="weekly-grid-line" key={y} x1="6" x2="474" y1={y} y2={y} />)}
          <line className="weekly-zero-line" x1="6" x2="474" y1="112" y2="112" />
          {currentAreaPath ? <path className="weekly-area" d={currentAreaPath} /> : null}
          {hasPreviousReference && previousPath ? <path className="weekly-line previous" d={previousPath} /> : null}
          {currentPath ? <path className="weekly-line current" d={currentPath} stroke="url(#weeklyLine)" filter="url(#weeklyGlow)" /> : null}
          {hasPreviousReference ? previousPoints.map((point, index) => point.y === null ? null : (
            <circle className="weekly-point previous" key={`previous-${point.label}-${index}`} cx={point.x} cy={point.y} r="3" />
          )) : null}
          {currentPoints.map((point, index) => point.y === null ? null : (
            <g
              key={`current-${point.label}-${index}`}
              className="weekly-point-hit"
              role="button"
              tabIndex={0}
              aria-label={`${progress.points[index]?.day ?? point.label}: semana actual ${formatKgNullable(point.value)}, semana anterior ${formatKgNullable(previousPoints[index]?.value ?? null)}`}
              onClick={() => {
                setIsTooltipVisible((current) => index !== activeIndex || !current);
                setActiveIndex(index);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setIsTooltipVisible((current) => index !== activeIndex || !current);
                  setActiveIndex(index);
                }
                if (event.key === "Escape") {
                  setIsTooltipVisible(false);
                }
              }}
            >
              <circle className={index === activeIndex ? "weekly-point-glow active" : "weekly-point-glow"} cx={point.x} cy={point.y} r={index === activeIndex ? 14 : 8} />
              <circle className={index === activeIndex ? "weekly-point current active" : "weekly-point current"} cx={point.x} cy={point.y} r={index === activeIndex ? 5 : 3} />
            </g>
          ))}
        </svg>
      </div>
      <div className="weekly-day-labels" aria-hidden="true">
        {labels.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
      </div>
    </div>
  );
}
