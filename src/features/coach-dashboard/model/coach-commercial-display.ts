import type { CoachCommercialItem, CoachCommercialPeriod } from "./coach-commercial-portfolio";

export const FREQUENCY_LABELS = {
  daily: "Diaria", weekly: "Semanal", monthly: "Mensual", quarterly: "Trimestral",
  semiannual: "Semestral", annual: "Anual",
} as const;

export function clp(amount: number): string {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(amount)} CLP`;
}

export function civilDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function latestAction(item: CoachCommercialItem, today: string): "start" | "renew" | "correct_future" | null {
  if (item.unlinkedAt !== null || item.status === "not_continuing") return null;
  if (item.status === "needs_agreement") return "start";
  const period = item.latestPeriod;
  if (!period) return null;
  if (period.startsOn > today && period.paidAt === null) return "correct_future";
  if (item.status === "pending_renewal" && period.endsBefore <= today) return "renew";
  return null;
}

export function canConfirmLatestPayment(item: CoachCommercialItem, today: string): boolean {
  const period = item.latestPeriod;
  return item.unlinkedAt === null && item.status !== "not_continuing"
    && period !== null && period.paidAt === null && period.startsOn <= today;
}

export function previousPeriods(periods: readonly CoachCommercialPeriod[], item: CoachCommercialItem): readonly CoachCommercialPeriod[] {
  return periods.filter((period) => period.episodeId === item.episodeId && period.id !== item.latestPeriod?.id)
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn));
}
