import { StatusMessage } from "@/ui/feedback/status-message";
import type { CoachClientsContentView } from "./coach-clients-view";
import { CoachClientRow } from "./coach-client-row";
import { CoachClientsEmpty } from "./coach-clients-empty";
import styles from "./coach-clients-list.module.css";

export function CoachClientsList({ content, panelId, tabId, onOpenClient, onLoadMore, onLink, onShowActive, onClearSearch }: {
  readonly content: CoachClientsContentView;
  readonly panelId: string;
  readonly tabId: string;
  readonly onOpenClient?: (id: string) => void;
  readonly onLoadMore?: () => void;
  readonly onLink?: () => void;
  readonly onShowActive?: () => void;
  readonly onClearSearch?: () => void;
}) {
  return (
    <div className={styles.list} role="tabpanel" id={panelId} aria-labelledby={tabId} tabIndex={0}>
      {content.kind === "rows" ? <>
        {content.resultLabel !== null ? <StatusMessage className={styles.result}>{content.resultLabel}</StatusMessage> : null}
        <ul className={styles.rows}>
          {content.rows.map((row) => <li key={row.id}><CoachClientRow view={row} onOpen={onOpenClient} /></li>)}
        </ul>
        {content.canLoadMore || content.isLoadingMore ? (
          <button className={styles.loadMore} type="button" disabled={content.isLoadingMore || !onLoadMore}
            onClick={!content.isLoadingMore && onLoadMore ? onLoadMore : undefined}>
            {content.isLoadingMore ? "Cargando…" : "Cargar más"}
          </button>
        ) : null}
      </> : content.kind === "empty" ? (
        <CoachClientsEmpty view={content.view} onLink={onLink} onShowActive={onShowActive} onClearSearch={onClearSearch} />
      ) : <StatusMessage className={styles.message} tone={content.tone}>{content.label}</StatusMessage>}
    </div>
  );
}
