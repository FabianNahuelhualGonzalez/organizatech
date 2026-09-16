/** Presentation only: the mapper supplies authorized rows, counts and labels. */
export type CoachClientTab = "active" | "pending" | "inactive";

export interface CoachClientCountView {
  readonly value: number | null;
  /** Includes the unknown label. UI must not derive a count from visible rows. */
  readonly label: string;
}

interface CoachClientRowBase {
  readonly id: string;
  readonly email: string;
  readonly metaLabel: string | null;
}

export type CoachClientRowView =
  | (CoachClientRowBase & {
      readonly state: "pending";
      // No student identity or activity before consent, including in ARIA.
      readonly name?: never;
      readonly initials?: never;
      readonly progressRatio?: never;
    })
  | (CoachClientRowBase & {
      readonly state: "active";
      readonly name: string | null;
      readonly initials: string | null;
      /** Drawing proportion supplied by mapper; null means unavailable. */
      readonly progressRatio: number | null;
    })
  | (CoachClientRowBase & {
      readonly state: "inactive";
      /** Only identity the Coach may still view under the consent projection. */
      readonly name: string | null;
      readonly initials: string | null;
      readonly progressRatio?: never;
    });

export type CoachClientsEmptyView =
  | { readonly kind: CoachClientTab }
  | { readonly kind: "search"; readonly queryLabel: string };

export type CoachClientsContentView =
  | { readonly kind: "rows"; readonly rows: readonly CoachClientRowView[]; readonly resultLabel: string | null;
      readonly canLoadMore: boolean; readonly isLoadingMore: boolean }
  | { readonly kind: "empty"; readonly view: CoachClientsEmptyView }
  | { readonly kind: "message"; readonly tone: "polite" | "error"; readonly label: string };

export interface CoachClientsViewModel {
  readonly selectedTab: CoachClientTab;
  readonly query: string;
  readonly counts: Readonly<Record<CoachClientTab, CoachClientCountView>>;
  /** Filtering, empty-state choice and authorization belong to the controller. */
  readonly content: CoachClientsContentView;
}

export interface CoachClientsActions {
  readonly onBack?: () => void;
  readonly onLink?: () => void;
  readonly onSelectTab?: (tab: CoachClientTab) => void;
  readonly onQueryChange?: (query: string) => void;
  readonly onOpenClient?: (id: string) => void;
  readonly onLoadMore?: () => void;
}

export interface CoachClientsViewProps {
  readonly view: CoachClientsViewModel;
  readonly actions: CoachClientsActions;
}
