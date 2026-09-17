import { ChevronRight, Mail } from "lucide-react";
import type { CoachClientRowView } from "./coach-clients-view";
import styles from "./coach-client-row.module.css";

const STATE_LABELS = { active: "ACTIVO", pending: "PENDIENTE", inactive: "BAJA" } as const;

export function CoachClientRow({ view, onOpen }: {
  readonly view: CoachClientRowView;
  readonly onOpen?: (id: string) => void;
}) {
  // Pending identity is email only, even if untyped input carries extra fields.
  const title = view.state === "pending" ? view.email : (view.name ?? view.email);
  const initials = view.state === "pending" ? null : view.initials;
  const ratio = view.state === "active" && view.progressRatio !== null && Number.isFinite(view.progressRatio)
    ? Math.min(1, Math.max(0, view.progressRatio)) : null;
  return (
    <button className={styles.row} type="button" data-client={view.id} data-state={view.state}
      onClick={onOpen ? () => onOpen(view.id) : undefined} disabled={!onOpen}>
      <span className={styles.avatar} aria-hidden="true">{initials ?? <Mail size={16} />}</span>
      <span className={styles.content}>
        <span className={styles.top}>
          <span className={styles.name}>{title}</span>
          <span className={styles.chip}>{STATE_LABELS[view.state]}</span>
        </span>
        {view.state !== "pending" && view.name !== null ? <span className={styles.email}>{view.email}</span> : null}
        <span className={styles.foot}>
          <span className={styles.bar} aria-hidden="true" data-known={ratio !== null}>
            {view.state === "pending" ? <span data-striped="true" />
              : ratio !== null ? <span style={{ width: `${ratio * 100}%` }} /> : null}
          </span>
          {view.metaLabel !== null ? <span className={styles.meta}>{view.metaLabel}</span> : null}
        </span>
      </span>
      <ChevronRight className={styles.chevron} size={14} aria-hidden="true" />
    </button>
  );
}
