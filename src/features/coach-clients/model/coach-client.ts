export type CoachClientState = "active" | "pending" | "inactive";

/** Read model only: these fields never form an invitation or ownership write. */
interface CoachClientIdentity {
  readonly id: string;
  readonly email: string;
}

/** A link may be active even when the student has no cycle to share. */
export interface CoachClientCycleSummary {
  readonly id: string;
  readonly description: string | null;
  readonly completedSessions: number | null;
  readonly plannedSessions: number | null;
}

export interface ActiveCoachClient extends CoachClientIdentity {
  readonly state: "active";
  readonly displayName: string | null;
  readonly cycle: CoachClientCycleSummary | null;
}

export interface PendingCoachClient extends CoachClientIdentity {
  readonly state: "pending";
  /** An invitation must not discover a student's account name by email. */
  readonly displayName: null;
  /** Supplied by the authorized backend; never generated in the client. */
  readonly invitationCode: string | null;
}

export interface InactiveCoachClient extends CoachClientIdentity {
  readonly state: "inactive";
  /** Only the identity previously shared with this coach may be retained. */
  readonly displayName: string | null;
}

export type CoachClient =
  | ActiveCoachClient
  | PendingCoachClient
  | InactiveCoachClient;

export function getCoachClientDisplayName(client: CoachClient): string {
  return client.displayName?.trim() || client.email;
}
