"use client";

import { useRef } from "react";
import type { CoachClientTab, CoachClientCountView } from "./coach-clients-view";
import { COACH_CLIENT_TABS, coachClientTabTarget } from "./coach-client-tab-navigation";
import styles from "./coach-clients-tabs.module.css";

const LABELS = { active: "Activos", pending: "Pendientes", inactive: "Bajas" } as const;

export function CoachClientsTabs({ selectedTab, counts, idPrefix, panelId, onSelectTab }: {
  readonly selectedTab: CoachClientTab;
  readonly counts: Readonly<Record<CoachClientTab, CoachClientCountView>>;
  readonly idPrefix: string;
  readonly panelId: string;
  readonly onSelectTab?: (tab: CoachClientTab) => void;
}) {
  const buttons = useRef<Partial<Record<CoachClientTab, HTMLButtonElement | null>>>({});
  return (
    <div className={styles.tabs} role="tablist" aria-label="Estado de clientes">
      {COACH_CLIENT_TABS.map((tab) => (
        <button key={tab} ref={(node) => { buttons.current[tab] = node; }}
          className={styles.tab} type="button" role="tab" data-state={tab}
          id={`${idPrefix}-${tab}`} aria-controls={panelId} aria-selected={selectedTab === tab}
          tabIndex={selectedTab === tab ? 0 : -1} disabled={!onSelectTab}
          onClick={onSelectTab ? () => onSelectTab(tab) : undefined}
          onKeyDown={onSelectTab ? (event) => {
            const target = coachClientTabTarget(tab, event.key);
            if (!target) return;
            event.preventDefault();
            buttons.current[target]?.focus();
            onSelectTab(target);
          } : undefined}>
          <span className={styles.dot} aria-hidden="true" />
          {LABELS[tab]}
          <span className={styles.count} data-known={counts[tab].value !== null}>{counts[tab].label}</span>
        </button>
      ))}
    </div>
  );
}
