"use client";

import { useRef, type RefObject } from "react";
import type { CoachRenewalState } from "./coach-dashboard-view";
import { COACH_RENEWAL_OPTIONS, coachRenewalRadioTarget } from "./coach-renewal-state-options";
import styles from "./coach-renewal-state-choices.module.css";

export function CoachRenewalStateChoices({ state, disabled, onSelectState, triggerRef }: {
  readonly state: CoachRenewalState;
  readonly disabled: boolean;
  readonly onSelectState?: (state: CoachRenewalState) => void;
  readonly triggerRef: RefObject<HTMLElement | null>;
}) {
  const controls = useRef<Partial<Record<CoachRenewalState, HTMLButtonElement | null>>>({});
  const canSelect = !disabled && Boolean(onSelectState);
  return (
    <div className={styles.choices} role="radiogroup" aria-label="Estado del pago">
      {COACH_RENEWAL_OPTIONS.map((option) => <button key={option.state} className={styles.choice}
        ref={(node) => { controls.current[option.state] = node; }} type="button" role="radio"
        aria-checked={state === option.state} tabIndex={state === option.state ? 0 : -1}
        data-state={option.state} disabled={!canSelect}
        onClick={canSelect ? (event) => { triggerRef.current = event.currentTarget; onSelectState?.(option.state); } : undefined}
        onKeyDown={canSelect ? (event) => {
          const target = coachRenewalRadioTarget(option.state, event.key);
          if (!target) return;
          event.preventDefault();
          const control = controls.current[target];
          triggerRef.current = control ?? event.currentTarget;
          control?.focus();
          onSelectState?.(target);
        } : undefined}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.copy}><span className={styles.label}>{option.label}</span><span className={styles.caption}>{option.caption}</span></span>
      </button>)}
    </div>
  );
}
