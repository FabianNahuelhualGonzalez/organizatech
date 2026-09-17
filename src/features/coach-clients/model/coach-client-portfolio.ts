import type { CoachClient, CoachClientState } from "./coach-client";

export interface CoachClientCounts {
  readonly active: number;
  readonly pending: number;
  readonly inactive: number;
}

function normalizeSearch(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** The caller supplies only this coach's authorized, complete portfolio. */
export function countCoachClients(clients: readonly CoachClient[]): CoachClientCounts {
  let active = 0;
  let pending = 0;
  let inactive = 0;
  for (const client of clients) {
    switch (client.state) {
      case "active": active += 1; break;
      case "pending": pending += 1; break;
      case "inactive": inactive += 1; break;
    }
  }
  return { active, pending, inactive };
}

/** Filtering is not authorization; it never fetches or discovers accounts. */
export function filterCoachClients(
  clients: readonly CoachClient[],
  state: CoachClientState,
  query: string,
): readonly CoachClient[] {
  const search = normalizeSearch(query);
  return clients.filter((client) => client.state === state && (
    search === ""
    || normalizeSearch(client.displayName ?? "").includes(search)
    || normalizeSearch(client.email).includes(search)
  ));
}
