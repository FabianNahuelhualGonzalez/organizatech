"use client";

import { useId, useRef, type FormEvent } from "react";

import { useReminderForm } from "../hooks/use-reminder-form";
import { formatCalendarDateLong } from "../model/calendar-date";
import type {
  CalendarDateKey,
  CalendarReminderEndMode,
  CalendarReminderKind,
  CalendarReminderLeadTime,
  CalendarReminderMonthlyMode,
  CalendarReminderRepeat,
  CreateCalendarReminderDto,
} from "../model/types";
import styles from "../calendar-reminders.module.css";
import {
  EmailNotificationSwitch,
  InlineError,
  OccurrenceStepper,
  RadioRows,
  SegmentedControl,
  WeekdayToggleGroup,
} from "./form-controls";

const KIND_OPTIONS = [
  { value: "revision", label: "Revisión", kind: "revision" },
  { value: "vencimiento", label: "Vencimiento", kind: "vencimiento" },
  { value: "personal", label: "Personal", kind: "personal" },
] as const satisfies readonly {
  readonly value: CalendarReminderKind;
  readonly label: string;
  readonly kind: CalendarReminderKind;
}[];

const REPEAT_OPTIONS = [
  { value: "once", label: "No se repite" },
  { value: "daily", label: "Diario" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
] as const satisfies readonly { readonly value: CalendarReminderRepeat; readonly label: string }[];

const END_OPTIONS = [
  { value: "never", label: "Siempre" },
  { value: "on_date", label: "Hasta una fecha" },
  { value: "after_occurrences", label: "Después de varias veces" },
] as const satisfies readonly { readonly value: CalendarReminderEndMode; readonly label: string }[];

const LEAD_OPTIONS = [
  { value: "at_time", label: "A la hora" },
  { value: "10_minutes", label: "10 min antes" },
  { value: "1_hour", label: "1 hora antes" },
  { value: "1_day", label: "1 día antes" },
] as const satisfies readonly { readonly value: CalendarReminderLeadTime; readonly label: string }[];

export function ReminderForm({
  selectedDate,
  saving,
  saveError,
  titleInputRef,
  onSubmit,
}: {
  readonly selectedDate: CalendarDateKey;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly titleInputRef: React.RefObject<HTMLInputElement | null>;
  readonly onSubmit: (dto: CreateCalendarReminderDto) => Promise<boolean>;
}) {
  const form = useReminderForm(selectedDate);
  const id = useId().replaceAll(":", "");
  const weekdayInputRef = useRef<HTMLInputElement>(null);
  const titleId = `${id}-title`;
  const titleErrorId = `${id}-title-error`;
  const timeId = `${id}-time`;
  const timeErrorId = `${id}-time-error`;
  const endDateId = `${id}-end-date`;
  const endDateErrorId = `${id}-end-date-error`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const result = form.validateAndBuild();
    if (!result.ok) {
      if (result.errors.title) titleInputRef.current?.focus();
      else if (result.errors.weekdays) weekdayInputRef.current?.focus();
      else if (result.errors.time) document.getElementById(timeId)?.focus();
      else if (result.errors.endDate) document.getElementById(endDateId)?.focus();
      return;
    }
    await onSubmit(result.dto);
  }

  return (
    <form className={styles.reminderForm} noValidate aria-busy={saving} onSubmit={handleSubmit}>
      <div className={styles.sheetBody}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={titleId}>Título</label>
          <input
            className={styles.textInput}
            id={titleId}
            ref={titleInputRef}
            type="text"
            autoComplete="off"
            required
            value={form.values.title}
            placeholder="Ej: Revisión Fabián"
            aria-invalid={Boolean(form.errors.title)}
            aria-describedby={form.errors.title ? titleErrorId : undefined}
            disabled={saving}
            onChange={(event) => form.setField("title", event.currentTarget.value)}
          />
          {form.errors.title ? <InlineError id={titleErrorId}>{form.errors.title}</InlineError> : null}
        </div>

        <SegmentedControl
          legend="Tipo"
          name={`${id}-kind`}
          columns={3}
          options={KIND_OPTIONS}
          value={form.values.kind}
          onChange={(value) => form.setField("kind", value)}
        />

        <div className={`${styles.field} ${styles.fieldSpacious}`}>
          <label className={`${styles.label} ${styles.labelRow}`} htmlFor={`${id}-description`}>
            <span>Descripción</span><span className={styles.optionalLabel}>Opcional</span>
          </label>
          <textarea
            className={styles.textArea}
            id={`${id}-description`}
            value={form.values.description}
            placeholder="Agrega detalles que quieras recordar"
            disabled={saving}
            onChange={(event) => form.setField("description", event.currentTarget.value)}
          />
        </div>

        <hr className={styles.divider} />

        <div className={`${styles.field} ${styles.fieldSpacious}`}>
          <label className={styles.legendAsLabel} htmlFor={timeId}>¿A qué hora?</label>
          <div className={styles.timeField}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
            <input
              id={timeId}
              type="time"
              step="300"
              value={form.values.time}
              aria-invalid={Boolean(form.errors.time)}
              aria-describedby={form.errors.time ? timeErrorId : undefined}
              disabled={saving}
              onChange={(event) => form.setField("time", event.currentTarget.value)}
            />
          </div>
          {form.errors.time ? <InlineError id={timeErrorId}>{form.errors.time}</InlineError> : null}
        </div>

        <div className={styles.fieldSpacious}>
          <SegmentedControl
            legend="¿Se repite?"
            name={`${id}-repeat`}
            columns={2}
            options={REPEAT_OPTIONS}
            value={form.values.repeat}
            onChange={(value) => form.setField("repeat", value)}
          />
        </div>

        {form.view.showWeeklyPanel ? (
          <WeekdayToggleGroup
            value={form.values.weekdays}
            error={form.errors.weekdays}
            errorId={`${id}-weekdays-error`}
            firstInputRef={weekdayInputRef}
            onToggle={form.toggleWeekday}
          />
        ) : null}

        {form.view.showMonthlyPanel ? (
          <fieldset className={styles.panel}>
            <legend className={styles.panelTitle}>¿Qué día del mes?</legend>
            <RadioRows<CalendarReminderMonthlyMode>
              name={`${id}-monthly-mode`}
              options={[
                { value: "day_of_month", label: form.view.monthlyLabels.byDay },
                { value: "weekday_position", label: form.view.monthlyLabels.byWeekdayPosition },
              ]}
              value={form.values.monthlyMode}
              onChange={(value) => form.setField("monthlyMode", value)}
            />
          </fieldset>
        ) : null}

        {form.view.showEndSection ? (
          <fieldset className={`${styles.field} ${styles.fieldSpacious}`}>
            <legend className={styles.legend}>¿Hasta cuándo?</legend>
            <RadioRows<CalendarReminderEndMode>
              name={`${id}-end-mode`}
              options={END_OPTIONS}
              value={form.values.endMode}
              onChange={(value) => form.setField("endMode", value)}
            />
            {form.view.showEndDate ? (
              <>
                <label className={styles.srOnly} htmlFor={endDateId}>Fecha de término</label>
                <input
                  className={`${styles.textInput} ${styles.conditionalControl}`}
                  id={endDateId}
                  type="date"
                  min={selectedDate}
                  value={form.values.endDate}
                  aria-invalid={Boolean(form.errors.endDate)}
                  aria-describedby={form.errors.endDate ? endDateErrorId : undefined}
                  disabled={saving}
                  onChange={(event) => form.setField("endDate", event.currentTarget.value)}
                />
                {form.errors.endDate ? <InlineError id={endDateErrorId}>{form.errors.endDate}</InlineError> : null}
              </>
            ) : null}
            {form.view.showOccurrences ? (
              <OccurrenceStepper value={form.values.occurrences} onChange={form.setOccurrences} />
            ) : null}
          </fieldset>
        ) : null}

        <div className={styles.fieldSpacious}>
          <SegmentedControl
            legend="Avisarme"
            name={`${id}-lead`}
            columns={2}
            options={LEAD_OPTIONS}
            value={form.values.leadTime}
            onChange={(value) => form.setField("leadTime", value)}
          />
        </div>

        <EmailNotificationSwitch
          checked={form.values.emailNotification}
          onChange={(value) => form.setField("emailNotification", value)}
        />
      </div>

      <div className={styles.sheetFooter}>
        {saveError ? <p className={styles.saveError} role="alert">{saveError}</p> : null}
        <p className={styles.summary} aria-live="polite">{form.view.summary}</p>
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={!form.view.canSubmit || saving}
          data-loading={saving}
        >
          {saving ? <span className={styles.spinner} aria-hidden="true" /> : null}
          <span>{saving ? "Guardando…" : "Guardar recordatorio"}</span>
        </button>
      </div>
      <span className={styles.srOnly}>Fecha seleccionada: {formatCalendarDateLong(selectedDate)}</span>
    </form>
  );
}
