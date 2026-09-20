"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";

import { DashboardCoachCard } from "@/features/dashboard/components/dashboard-coach-card";
import { DashboardDayDots } from "@/features/dashboard/components/dashboard-day-dots";
import { DashboardTrainingCardContent } from "@/features/dashboard/components/dashboard-training-card-content";
import { EmptyDashboard } from "@/features/dashboard/components/empty-dashboard";
import { WeeklyProgressSvg } from "@/features/dashboard/components/weekly-progress-svg";
import {
  buildDashboardCoachAnalytics,
  buildDashboardTrainingCardModel,
} from "@/lib/dashboard/dashboard-card-model";
import {
  resolveDashboardCardVisibility,
  resolveDashboardCarouselDays,
} from "@/lib/dashboard/dashboard-card-selector";
import {
  getCurrentSantiagoWeekDates,
  getTrainingDayCode,
} from "@/lib/dashboard/dashboard-santiago-calendar";
import {
  findDashboardEntries,
  findDashboardSessionForDay,
  getDashboardEntryExerciseIdentity,
  getDashboardExerciseIdentity,
} from "@/lib/dashboard/dashboard-session-selection";
import {
  buildEmptyCurrentWeekCoachFeedback,
  buildWeeklyProgressTrendLabel,
  resolveDashboardCoachVisualStatus,
  resolveIsCurrentWeekEmptyCoach,
} from "@/lib/dashboard/dashboard-presentation";
import type { DashboardTrainingCardData } from "@/lib/dashboard/dashboard-types";
import {
  calculateWeeklyComparison,
  calculateWeeklySummary,
} from "@/lib/progress/calculations";
import type {
  ExerciseEntry,
  ExerciseTemplate,
  TrainingSession,
} from "@/lib/progress/types";
import type { WeeklyEquivalentProgressResult } from "@/lib/progress/weekly-equivalent-progress";
import { getSessionEffectiveCalendarWeekStart } from "@/lib/training/cycle-calendar-week";
import { getCycleScopedDayCoverage } from "@/lib/training/cycle-scoped-plan-edit";
import { getSantiagoDateKey } from "@/lib/training/santiago-training-date";
import { buildTrainingCoachDashboardInput } from "@/lib/training/training-coach-dashboard-mapper";
import { buildTrainingCoachFeedback } from "@/lib/training/training-coach-feedback";
import {
  resolveActiveCarouselIndex,
  resolveTrainingCarouselAction,
} from "@/lib/training/training-carousel-card-presentation";
import { MetricGrid } from "@/ui/data-display/metric-grid";

export interface DashboardScreenProps {
  exercises: ExerciseTemplate[];
  hasTrainingEntries: boolean;
  hasRoutinePlan: boolean;
  usesCycleScopedSessions: boolean;
  day: string;
  weekDays: readonly string[];
  dayExercises: ExerciseTemplate[];
  summary: ReturnType<typeof calculateWeeklySummary>;
  weeklyEquivalentProgress: WeeklyEquivalentProgressResult;
  currentWeek: number;
  entries: ExerciseEntry[];
  sessions: TrainingSession[];
  startRegistration: () => void;
  goToRoutine: () => void;
  viewSummary: (day: string) => void;
  switchDay: (day: string) => void;
}

export function DashboardScreen({
  exercises,
  hasTrainingEntries,
  hasRoutinePlan,
  usesCycleScopedSessions,
  day,
  weekDays,
  dayExercises,
  summary,
  weeklyEquivalentProgress,
  currentWeek,
  entries,
  sessions,
  startRegistration,
  goToRoutine,
  viewSummary,
  switchDay,
}: DashboardScreenProps) {
  const hasTodayRoutine = dayExercises.length > 0;
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const lastCarouselDay = useRef(day);
  const [activeCarouselDay, setActiveCarouselDay] = useState(day);
  const carouselDays = useMemo(
    () => resolveDashboardCarouselDays(hasRoutinePlan, weekDays, day),
    [hasRoutinePlan, weekDays, day],
  );
  const currentWeekDates = useMemo(() => getCurrentSantiagoWeekDates(), []);
  const currentWeekStart = currentWeekDates.Lunes;
  const activeSessions = useMemo(
    () => sessions.filter((session) => (
      session.status === "completed" &&
      !session.deletedAt &&
      (usesCycleScopedSessions
        ? getSessionEffectiveCalendarWeekStart(session) === currentWeekStart
        : session.calendarWeekStart === currentWeekStart)
    )),
    [sessions, currentWeekStart, usesCycleScopedSessions],
  );

  useEffect(() => {
    setActiveCarouselDay(day);
    lastCarouselDay.current = day;
    const index = carouselDays.indexOf(day);
    const container = carouselRef.current;
    const slide = index >= 0 ? container?.children.item(index) as HTMLElement | null : null;
    const firstSlide = container?.children.item(0) as HTMLElement | null;
    if (container && slide && firstSlide) {
      container.scrollTo({ left: slide.offsetLeft - firstSlide.offsetLeft, behavior: "smooth" });
    }
  }, [day, carouselDays]);

  function getDashboardDayData(item: string): DashboardTrainingCardData & {
    title: string;
    session: TrainingSession | undefined;
  } {
    const itemExercises = exercises.filter((exercise) => (exercise.day ?? item) === item);
    const expectedDate = currentWeekDates[item] ?? "";
    const plannedDay = getTrainingDayCode(item);
    const session = findDashboardSessionForDay(activeSessions, itemExercises, expectedDate, plannedDay, usesCycleScopedSessions);
    const sessionEntries = session ? findDashboardEntries(session.entries, itemExercises, expectedDate, usesCycleScopedSessions) : [];
    const allMatchingEntries = usesCycleScopedSessions ? [] : findDashboardEntries(entries, itemExercises, expectedDate, false);
    const fallbackEntries = sessionEntries.length > 0 ? [] : allMatchingEntries;
    const itemEntries = usesCycleScopedSessions
      ? sessionEntries
      : sessionEntries.length > 0
        ? sessionEntries
        : fallbackEntries;
    const itemMetrics = itemEntries.length > 0 ? calculateWeeklyComparison(itemEntries) : [];
    const coverage = usesCycleScopedSessions
      ? getCycleScopedDayCoverage(itemExercises, itemEntries)
      : null;
    const status = coverage?.status ?? (Boolean(session) || fallbackEntries.length > 0 ? "completed" : "pending");
    const isCompleted = status === "completed";
    const pendingExercises = coverage
      ? itemExercises.filter((exercise) =>
        !coverage.registeredIds.has(exercise.trainingCycleExerciseId ?? exercise.id))
      : isCompleted
        ? []
        : itemExercises;

    return {
      day: item,
      title: itemExercises.length > 0 ? `Entrenamiento · ${item}` : `Entrenamiento · ${item}: no registra entrenamientos`,
      exercises: itemExercises,
      metrics: itemMetrics,
      session,
      status,
      registeredCount: coverage?.registeredCount ?? itemMetrics.length,
      plannedCount: coverage?.plannedCount ?? itemExercises.length,
      pendingExercises,
      isToday: expectedDate === getSantiagoDateKey(new Date()),
      hasRoutine: itemExercises.length > 0 || isCompleted,
      isCompleted,
    };
  }

  const activeDayData = getDashboardDayData(activeCarouselDay);
  const activeCoachEntries = getDashboardCoachEntries(entries, activeDayData.exercises, usesCycleScopedSessions);
  const activeCoachMetrics = activeDayData.metrics;
  const activeCoachSummary = calculateWeeklySummary(activeCoachMetrics, currentWeek);
  const analytics = buildDashboardCoachAnalytics(activeCoachSummary, activeCoachMetrics);
  const coachInput = useMemo(() => buildTrainingCoachDashboardInput({
    activeDay: activeCarouselDay,
    activeDayCoverage: {
      registeredExercises: activeDayData.registeredCount,
      plannedExercises: activeDayData.plannedCount,
    },
    summary: activeCoachSummary,
    currentMetrics: activeCoachMetrics,
    entries: activeCoachEntries,
    currentWeek,
    weeklyEquivalentProgress,
  }), [
    activeCarouselDay,
    activeCoachEntries,
    activeCoachMetrics,
    activeCoachSummary,
    activeDayData.plannedCount,
    activeDayData.registeredCount,
    currentWeek,
    weeklyEquivalentProgress,
  ]);
  const coachFeedback = useMemo(() => buildTrainingCoachFeedback(coachInput), [coachInput]);
  const isCurrentWeekEmptyCoach = resolveIsCurrentWeekEmptyCoach(
    activeCoachEntries,
    activeCoachMetrics,
    currentWeek,
  );
  const displayedCoachFeedback = isCurrentWeekEmptyCoach
    ? buildEmptyCurrentWeekCoachFeedback()
    : coachFeedback;
  const coachVisualStatus = resolveDashboardCoachVisualStatus({
    isCurrentWeekEmptyCoach,
    comparisonStatus: coachInput.comparisonStatus,
    displayedCoachFeedback,
  });
  const activeDayAction = resolveTrainingCarouselAction(activeDayData.status);
  const cardVisibility = resolveDashboardCardVisibility({
    hasRoutinePlan,
    hasTrainingEntries,
    hasTodayRoutine,
    activeDayHasRoutine: activeDayData.hasRoutine,
  });

  function handleTrainingCarouselScroll(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    const children = Array.from(container.children) as HTMLElement[];
    const nearestIndex = resolveActiveCarouselIndex({
      scrollLeft: container.scrollLeft,
      viewportWidth: container.clientWidth,
      slides: children.map((child) => ({
        offsetLeft: child.offsetLeft,
        offsetWidth: child.offsetWidth,
      })),
    });

    const nextDay = carouselDays[nearestIndex] ?? activeCarouselDay;
    if (nextDay !== lastCarouselDay.current) {
      lastCarouselDay.current = nextDay;
      setActiveCarouselDay(nextDay);
      switchDay(nextDay);
    }
  }

  if (cardVisibility.emptyState === "no-plan") {
    return <EmptyDashboard startRegistration={startRegistration} />;
  }

  if (cardVisibility.emptyState === "no-entries") {
    return (
      <section className="screen">
        <div className="card wide dashboard-empty-progress">
          <p className="eyebrow">Rutina creada</p>
          <h3>Aún no registras progreso</h3>
          <p>Ya tienes tu planificación lista. Para comenzar a medir avances, inicia el entrenamiento del día y registra tus series.</p>
          {cardVisibility.showEmptyRoutineAction ? (
            <button className="button dashboard-routine-button" onClick={goToRoutine}>
              Ir a rutina de entrenamiento
            </button>
          ) : null}
        </div>
        <div className="card wide dashboard-training-card" data-section="training-carousel">
          <div className="dashboard-training-carousel" ref={carouselRef} onScroll={handleTrainingCarouselScroll}>
            {carouselDays.map((item) => {
              const itemData = getDashboardDayData(item);
              const itemModel = buildDashboardTrainingCardModel(itemData);

              return (
                <article className="dashboard-training-slide" key={item}>
                  {itemData.hasRoutine ? (
                    <DashboardTrainingCardContent model={itemModel} />
                  ) : (
                    <p className="eyebrow">No hay rutina registrada para {item}. Puedes agregarla desde Registro de entrenamiento.</p>
                  )}
                </article>
              );
            })}
          </div>
          <DashboardDayDots day={activeCarouselDay} weekDays={carouselDays} />
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <MetricGrid summary={summary} />
      <div className="card wide dashboard-progress-card" data-section="weekly-progress">
        <div className="weekly-progress-summary">
          <div className="weekly-progress-value-block">
            <p className="small-label">Progreso semanal</p>
            {weeklyEquivalentProgress.status === "ready" ? (
              <div className="weekly-progress-comparison-list">
                <span>Volumen semana anterior: <strong>{weeklyEquivalentProgress.previousVolumeLabel}</strong></span>
                <span>Volumen actual: <strong>{weeklyEquivalentProgress.currentVolumeLabel}</strong></span>
                <span className={`weekly-progress-difference ${weeklyEquivalentProgress.tone}`}>
                  Diferencia de volumen: <strong>{weeklyEquivalentProgress.primaryLabel}</strong>
                </span>
                <small className={`weekly-progress-trend-pill ${weeklyEquivalentProgress.tone}`}>{buildWeeklyProgressTrendLabel(weeklyEquivalentProgress)}</small>
              </div>
            ) : (
              <strong className={weeklyEquivalentProgress.tone}>{weeklyEquivalentProgress.primaryLabel}</strong>
            )}
          </div>
          {weeklyEquivalentProgress.status !== "ready" ? (
            <div className="weekly-progress-empty-copy">
              <span>{weeklyEquivalentProgress.detailLabel}</span>
              <small>Completa esta semana para crear tu primera referencia</small>
            </div>
          ) : null}
        </div>
        <WeeklyProgressSvg progress={weeklyEquivalentProgress} />
      </div>
      <div className={`card wide dashboard-training-card ${activeDayData.status}`} data-section="training-carousel">
        <div className="dashboard-training-carousel" ref={carouselRef} onScroll={handleTrainingCarouselScroll}>
          {carouselDays.map((item) => {
            const itemData = getDashboardDayData(item);
            const itemModel = buildDashboardTrainingCardModel(itemData);

            return (
              <article className="dashboard-training-slide" key={item}>
                {itemData.hasRoutine ? (
                  <DashboardTrainingCardContent model={itemModel} />
                ) : (
                  <p className="eyebrow">No hay rutina registrada para {item}. Puedes agregarla desde Registro de entrenamiento.</p>
                )}
              </article>
            );
          })}
        </div>
        {cardVisibility.showTrainingCardAction ? (
          <button
            className={`button secondary dashboard-routine-button ${activeDayData.status}`}
            onClick={() => activeDayAction.action === "summary" ? viewSummary(activeDayData.day) : goToRoutine()}
          >
            {activeDayAction.label}
          </button>
        ) : null}
        <DashboardDayDots day={activeCarouselDay} weekDays={carouselDays} />
      </div>
      <div data-section="coach">
        <DashboardCoachCard feedback={displayedCoachFeedback} analytics={analytics} visualStatus={coachVisualStatus} />
      </div>
    </section>
  );
}

function getDashboardCoachEntries(
  entries: ExerciseEntry[],
  dayExercises: ExerciseTemplate[],
  usesCycleScopedSessions: boolean,
) {
  if (dayExercises.length === 0) return [];

  const exerciseIds = new Set(dayExercises.map((exercise) => getDashboardExerciseIdentity(exercise, usesCycleScopedSessions)));
  const lineageIds = new Set(dayExercises.map((exercise) => exercise.exerciseLineageId?.trim()).filter(Boolean));
  const legacyIds = new Set(dayExercises.map((exercise) => exercise.sourceLegacyExerciseId?.trim()).filter(Boolean));

  return entries.filter((entry) => {
    const identity = getDashboardEntryExerciseIdentity(entry, usesCycleScopedSessions);
    if (exerciseIds.has(identity)) return true;

    const lineageId = entry.exerciseLineageId?.trim();
    if (lineageId && lineageIds.has(lineageId)) return true;

    return legacyIds.has(entry.exerciseId);
  });
}
