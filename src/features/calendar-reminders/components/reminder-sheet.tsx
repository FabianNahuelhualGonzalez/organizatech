"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { formatCalendarDateLong } from "../model/calendar-date";
import { createCalendarRemindersAriaIds } from "../model/calendar-reminders-aria";
import type { CalendarDateKey, CreateCalendarReminderDto } from "../model/types";
import styles from "../calendar-reminders.module.css";
import { ReminderForm } from "./reminder-form";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
]
  .map((selector) => `${selector}:not([hidden]):not([aria-hidden="true"])`)
  .join(",");

function getVisibleFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const checkVisibility = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
    return typeof checkVisibility !== "function" || checkVisibility.call(element);
  });
}

export function ReminderSheet({
  selectedDate,
  dateLabel,
  saving,
  saveError = null,
  inertTargetRef,
  onClose,
  onSubmit,
}: {
  readonly selectedDate: CalendarDateKey;
  readonly dateLabel?: string;
  readonly saving: boolean;
  readonly saveError?: string | null;
  readonly inertTargetRef?: RefObject<HTMLElement | null>;
  readonly onClose: () => void;
  readonly onSubmit: (dto: CreateCalendarReminderDto) => Promise<boolean>;
}) {
  const titleId = createCalendarRemindersAriaIds(useId()).sheetTitle;
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const inertTarget = inertTargetRef?.current;
    if (inertTarget) inertTarget.inert = true;
    return () => {
      if (inertTarget) inertTarget.inert = false;
    };
  }, [inertTargetRef]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!saving) return;
    const container = sheetRef.current;
    if (!container || container.contains(document.activeElement)) return;
    container.focus();
  }, [saving]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const container = sheetRef.current;
    if (!container) return;
    const focusable = getVisibleFocusableElements(container);
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        className={styles.overlay}
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={saving}
        onClick={onClose}
      />
      <div
        className={styles.sheet}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.sheetHeader}>
          <div className={styles.sheetTitles}>
            <h2 id={titleId}>Añadir recordatorio</h2>
            <p>{dateLabel ?? formatCalendarDateLong(selectedDate)}</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Cerrar formulario"
            disabled={saving}
            onClick={onClose}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ReminderForm
          selectedDate={selectedDate}
          saving={saving}
          saveError={saveError}
          titleInputRef={titleInputRef}
          onSubmit={onSubmit}
        />
      </div>
    </>
  );
}
