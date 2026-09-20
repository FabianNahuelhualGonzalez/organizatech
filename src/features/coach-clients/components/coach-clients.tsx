"use client";

import { useId, useRef } from "react";
import type { CoachClientsViewProps } from "./coach-clients-view";
import { CoachClientsHeader } from "./coach-clients-header";
import { CoachClientsSearch } from "./coach-clients-search";
import { CoachClientsTabs } from "./coach-clients-tabs";
import { CoachClientsList } from "./coach-clients-list";
import styles from "./coach-clients.module.css";

/** Controlled view. No fetching, persistence or portfolio filtering. */
export function CoachClientsView({ view, actions }: CoachClientsViewProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  function clearSearch() {
    if (!actions.onQueryChange) return;
    actions.onQueryChange("");
    inputRef.current?.focus();
  }
  return (
    <section className={styles.view} aria-labelledby={`${id}-title`} data-coach-clients="productive">
      <CoachClientsHeader titleId={`${id}-title`} onBack={actions.onBack} onLink={actions.onLink} />
      <CoachClientsSearch query={view.query} inputRef={inputRef} onQueryChange={actions.onQueryChange} />
      <CoachClientsTabs selectedTab={view.selectedTab} counts={view.counts} idPrefix={`${id}-tab`}
        panelId={`${id}-panel`} onSelectTab={actions.onSelectTab} />
      <CoachClientsList content={view.content} panelId={`${id}-panel`} tabId={`${id}-tab-${view.selectedTab}`}
        onOpenClient={actions.onOpenClient} onLoadMore={actions.onLoadMore} onLink={actions.onLink}
        onShowActive={actions.onSelectTab ? () => actions.onSelectTab?.("active") : undefined}
        onClearSearch={actions.onQueryChange ? clearSearch : undefined} />
    </section>
  );
}
