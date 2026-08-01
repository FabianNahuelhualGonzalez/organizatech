/**
 * Espejo EXACTO de la card inline `setup-card routine-day-builder-card` de
 * organizatech-app.tsx (líneas ~4196-4220): progreso de construcción de rutinas y selector de
 * día por píldoras. `completedDaysCount` y `currentStep` se derivan internamente de las mismas
 * entradas con la misma aritmética de presentación que el root (líneas ~4134-4135) — mismo
 * precedente que `selectedCycle` dentro de TrainingPlanSetupCard.
 *
 * `onSelectDay` emite el día crudo; qué día queda activo y sus efectos son decisión del
 * contenedor. Sin estado propio, sin efectos, sin dominio. No integrado todavía (P3-19A
 * preparación): el bloque original permanece en el root hasta la integración.
 */

import { SectionHeading } from "@/ui/layout/section-heading";
export interface RoutineBuilderDayCardProps {
  plannedDays: readonly string[];
  activeDay: string;
  configuredDays: readonly string[];
  onSelectDay: (day: string) => void;
}

export function RoutineBuilderDayCard({
  plannedDays,
  activeDay,
  configuredDays,
  onSelectDay,
}: RoutineBuilderDayCardProps) {
  const completedDaysCount = plannedDays.filter((item) => configuredDays.includes(item)).length;
  const currentStep = Math.max(1, plannedDays.indexOf(activeDay) + 1);

  return (
    <div className="setup-card routine-day-builder-card">
      <SectionHeading
        className="setup-section-heading"
        eyebrow="Configura tus rutinas por día"
        title={<>Rutina {currentStep} de {plannedDays.length} · {activeDay}</>}
      />
      <div className="routine-build-progress">
        <span>{completedDaysCount} de {plannedDays.length} días completados</span>
        <div className="mini-progress-track">
          <div className="mini-progress-fill" style={{ width: `${Math.round((completedDaysCount / plannedDays.length) * 100)}%` }} />
        </div>
      </div>
      <div className="routine-build-days">
        {plannedDays.map((item) => (
          <button
            className={`routine-build-day ${item === activeDay ? "current" : ""} ${configuredDays.includes(item) ? "done" : ""}`}
            key={item}
            type="button"
            onClick={() => onSelectDay(item)}
          >
            <strong>{item}</strong>
            <span>{configuredDays.includes(item) ? "Listo" : item === activeDay ? "Actual" : "Pendiente"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
