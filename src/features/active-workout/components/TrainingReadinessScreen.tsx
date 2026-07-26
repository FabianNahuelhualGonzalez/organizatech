import { useState } from "react";

import type { TrainingReadiness } from "@/lib/training/training-readiness-draft";

export interface TrainingReadinessScreenProps {
  onSubmit: (value: Omit<TrainingReadiness, "skipped">) => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  isSaving: boolean;
  error: string;
}

export function TrainingReadinessScreen({ onSubmit, onSkip, isSaving, error }: TrainingReadinessScreenProps) {
  const [values, setValues] = useState({
    motivation: 4,
    hydration: 4,
    sleep: 4,
    energy: 4,
  });
  const questions = [
    { key: "motivation", label: "Motivación", detail: "Qué tantas ganas tienes de entrenar hoy." },
    { key: "hydration", label: "Hidratación", detail: "Qué tan bien hidratado sientes tu cuerpo." },
    { key: "sleep", label: "Sueño", detail: "Qué tan reparador fue tu descanso." },
    { key: "energy", label: "Energía física", detail: "Qué tan preparado te sientes para rendir." },
  ] as const;

  return (
    <section className="screen">
      <div className="card wide readiness-card">
        <div className="setup-section-heading">
          <p className="eyebrow">Antes de empezar</p>
          <h3>¿Cómo llegas hoy?</h3>
        </div>
        <div className="readiness-list">
          {questions.map((question) => (
            <div className="readiness-row" key={question.key}>
              <div>
                <div className="readiness-title-row">
                  <strong>{question.label}</strong>
                  <span>{values[question.key]}/7</span>
                </div>
                <p>{question.detail}</p>
              </div>
              <div className="readiness-slider-wrap">
                <input
                  aria-label={question.label}
                  className="readiness-slider"
                  disabled={isSaving}
                  max={7}
                  min={1}
                  type="range"
                  value={values[question.key]}
                  onChange={(event) => setValues((current) => ({ ...current, [question.key]: Number(event.target.value) }))}
                />
                <div className="readiness-slider-scale" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6, 7].map((score) => (
                    <span key={score}>{score}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="two-cols">
          <button className="button secondary" type="button" onClick={onSkip} disabled={isSaving}>
            {isSaving ? "Guardando..." : "Omitir por hoy"}
          </button>
          <button className="button" type="button" onClick={() => onSubmit(values)} disabled={isSaving}>
            {isSaving ? "Guardando..." : "Empezar entrenamiento"}
          </button>
        </div>
        {error ? <p className="setup-message">{error}</p> : null}
      </div>
    </section>
  );
}
