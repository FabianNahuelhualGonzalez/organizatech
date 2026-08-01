import { TRAINING_CYCLE_PRESENTATIONS } from "@/features/training-plan/model/training-cycle-presentation";
import type { TrainingCycleId } from "@/lib/training/training-cycle-id";
import { TRAINING_DAY_LABELS } from "@/lib/training/training-day-order";
import { SectionHeading } from "@/ui/layout/section-heading";

export interface TrainingPlanSetupCardProps {
  cycleType: TrainingCycleId;
  objectiveValue: string;
  objectiveOptions: readonly string[];
  objectiveDescription: string;
  durationValue: number;
  durationOptions: ReadonlyArray<{
    value: number;
    label: string;
  }>;
  plannedDays: readonly string[];
  activeDay: string;
  configuredDays: readonly string[];
  onCycleTypeChange: (value: string) => void;
  onObjectiveChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onToggleTrainingDay: (day: string) => void;
}

export function TrainingPlanSetupCard({
  cycleType,
  objectiveValue,
  objectiveOptions,
  objectiveDescription,
  durationValue,
  durationOptions,
  plannedDays,
  activeDay,
  configuredDays,
  onCycleTypeChange,
  onObjectiveChange,
  onDurationChange,
  onToggleTrainingDay,
}: TrainingPlanSetupCardProps) {
  const selectedCycle = TRAINING_CYCLE_PRESENTATIONS.find((cycle) => cycle.id === cycleType)
    ?? TRAINING_CYCLE_PRESENTATIONS[0];

  return (
    <div className="setup-card training-cycles-card">
      <SectionHeading
        className="setup-section-heading"
        eyebrow="Planificación deportiva"
        title="Selecciona tu ciclo de entrenamiento"
      />
      <div className="cycle-flow-card">
        <label className="cycle-select-field">
          <span>Ciclo de entrenamiento</span>
          <select
            className="cycle-select"
            value={cycleType}
            onChange={(event) => onCycleTypeChange(event.target.value)}
          >
            {TRAINING_CYCLE_PRESENTATIONS.map((cycle) => (
              <option key={cycle.id} value={cycle.id}>{cycle.title}</option>
            ))}
          </select>
        </label>
        <div className="cycle-description">
          <strong>{selectedCycle.title}</strong>
          <p>{selectedCycle.detail}</p>
        </div>
        <label className="cycle-select-field">
          <span>¿Cuál es el objetivo principal?</span>
          <select className="cycle-select" value={objectiveValue} onChange={(event) => onObjectiveChange(event.target.value)}>
            {objectiveOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <div className="cycle-description objective-description">
          <strong>{objectiveValue}</strong>
          <p>{objectiveDescription}</p>
        </div>
        <label className="cycle-select-field">
          <span>Duración</span>
          <select className="cycle-select" value={durationValue} onChange={(event) => onDurationChange(event.target.value)}>
            {durationOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="cycle-select-field">
          <span>Selecciona días de entrenamiento</span>
          <div className="cycle-chip-grid days">
            {TRAINING_DAY_LABELS.map((item) => (
              <button
                className={`cycle-chip ${plannedDays.includes(item) ? "active" : ""} ${activeDay === item ? "current" : ""} ${configuredDays.includes(item) ? "configured" : ""}`}
                key={item}
                type="button"
                onClick={() => onToggleTrainingDay(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
