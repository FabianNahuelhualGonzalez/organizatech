"use client";

import type { RefObject } from "react";

import {
  CALENDAR_WEEKDAYS,
  CALENDAR_WEEKDAY_LABELS,
} from "../model/calendar-date";
import type {
  CalendarReminderKind,
  CalendarWeekday,
} from "../model/types";
import styles from "../calendar-reminders.module.css";

export interface SegmentedOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly kind?: CalendarReminderKind;
}

export function SegmentedControl<Value extends string>({
  legend,
  name,
  columns,
  options,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly columns: 2 | 3;
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <fieldset className={styles.field}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.segmented} data-columns={columns}>
        {options.map((option) => (
          <label className={styles.segmentOption} data-kind={option.kind} key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.segmentBox}>
              {option.kind ? (
                <span className={styles.segmentDot} data-kind={option.kind} aria-hidden="true" />
              ) : null}
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function WeekdayToggleGroup({
  value,
  error,
  errorId,
  firstInputRef,
  onToggle,
}: {
  readonly value: readonly CalendarWeekday[];
  readonly error?: string;
  readonly errorId: string;
  readonly firstInputRef: RefObject<HTMLInputElement | null>;
  readonly onToggle: (weekday: CalendarWeekday) => void;
}) {
  return (
    <fieldset className={styles.panel}>
      <legend className={styles.panelTitle}>¿Qué días de la semana?</legend>
      <div className={styles.weekdayGrid}>
        {CALENDAR_WEEKDAYS.map((weekday, index) => {
          const label = CALENDAR_WEEKDAY_LABELS[weekday];
          return (
            <label className={styles.weekdayOption} key={weekday}>
              <input
                ref={index === 0 ? firstInputRef : undefined}
                type="checkbox"
                value={weekday}
                checked={value.includes(weekday)}
                aria-describedby={error ? errorId : undefined}
                onChange={() => onToggle(weekday)}
              />
              <span className={styles.weekdayBox}>
                <span aria-hidden="true">{label.initial}</span>
                <span className={styles.srOnly}>{label.full}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? <InlineError id={errorId}>{error}</InlineError> : null}
    </fieldset>
  );
}

export function RadioRows<Value extends string>({
  name,
  options,
  value,
  onChange,
}: {
  readonly name: string;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <div className={styles.radioRows}>
      {options.map((option) => (
        <label className={styles.radioRow} key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.radioBox}>
            <span className={styles.radioDot} aria-hidden="true" />
            <span>{option.label}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function OccurrenceStepper({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        aria-label="Quitar una repetición"
        disabled={value <= 2}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output aria-live="polite">{value} veces</output>
      <button
        type="button"
        aria-label="Añadir una repetición"
        disabled={value >= 52}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export function EmailNotificationSwitch({
  checked,
  onChange,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.switchRow} data-checked={checked}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className={styles.switchCopy}>
        <span className={styles.switchTitle}>Guardar preferencia de correo</span>
        <span className={styles.switchHint}>El envío requiere habilitación y configuración posterior</span>
      </span>
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchKnob} />
      </span>
    </label>
  );
}

export function InlineError({
  id,
  children,
}: {
  readonly id?: string;
  readonly children: string;
}) {
  return (
    <p className={styles.inlineError} id={id} role="alert">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
