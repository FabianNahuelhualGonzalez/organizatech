"use client";

import { CalendarDays, Link, MessageSquare } from "lucide-react";
import styles from "./coach-quick-actions.module.css";

export function CoachQuickActions({ onCalendar, onLink, onChat }: {
  readonly onCalendar?: () => void;
  readonly onLink?: () => void;
  readonly onChat?: () => void;
}) {
  return (
    <nav className={styles.tiles} aria-label="Accesos rápidos Coach">
      <button className={styles.tile} type="button" disabled={!onCalendar} onClick={onCalendar}>
        <CalendarDays size={21} strokeWidth={1.9} aria-hidden="true" />
        <span className={styles.title}>Calendario</span>
        <span className={styles.subtitle}>Rutinas y recordatorios</span>
      </button>
      <button className={styles.tile} type="button" disabled={!onLink} onClick={onLink}>
        <Link size={21} strokeWidth={1.9} aria-hidden="true" />
        <span className={styles.title}>Vincular</span>
        <span className={styles.subtitle}>Alumnos y bajas</span>
      </button>
      <button className={`${styles.tile} ${styles.soon}`} type="button" disabled={!onChat} onClick={onChat}>
        <span className={styles.badge}>PRONTO</span>
        <MessageSquare size={21} strokeWidth={1.9} aria-hidden="true" />
        <span className={styles.title}>Chat</span>
        <span className={styles.subtitle}>Habla con tus alumnos</span>
      </button>
    </nav>
  );
}
