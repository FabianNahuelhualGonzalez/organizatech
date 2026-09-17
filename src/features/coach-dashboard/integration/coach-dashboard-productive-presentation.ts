import type { CoachActiveRelationshipsSnapshot } from "@/features/coach-clients/hooks/coach-active-relationships-controller-contract";
import type { CoachPendingInvitationsSnapshot } from "@/features/coach-clients/hooks/coach-pending-invitations-controller-contract";
import type {
  CoachClientRowView,
  CoachClientsContentView,
  CoachClientsViewModel,
  CoachClientTab,
} from "@/features/coach-clients/components/coach-clients-view";
import type { CoachDashboardViewModel, CoachMetricView } from "../components/coach-dashboard-view";
import type {
  CoachFeePreset,
  CoachFeePreviewRowView,
  CoachFeeSheetView,
} from "../components/coach-dashboard-sheet-view";
import type { CoachPreferencesControllerState } from "../hooks/coach-preferences-controller-contract";
import {
  calculateCoachCommercialMoney,
  formatCoachClpAmount,
  parseCoachMonthlyFeeInput,
} from "../model/coach-dashboard-money";

const UNKNOWN_LABEL = "Sin información";

function metric(value: number | null, label?: string | null): CoachMetricView {
  return Object.freeze({ value, label: label ?? UNKNOWN_LABEL });
}

function countMetric(value: number | null): CoachMetricView {
  return metric(value, value === null ? null : String(value));
}

function moneyMetric(value: number | null): CoachMetricView {
  return metric(value, formatCoachClpAmount(value));
}

function dateLabel(value: string): string | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    timeZone: "America/Santiago",
  }).format(new Date(time));
}

export function buildCoachDashboardView(input: {
  readonly coachName: string;
  readonly now: Date;
  readonly preferences: CoachPreferencesControllerState;
  readonly active: CoachActiveRelationshipsSnapshot;
  readonly pending: CoachPendingInvitationsSnapshot;
}): CoachDashboardViewModel {
  const activeCount = input.active.totalActive;
  const pendingInvitationCount = input.pending.totalPending;
  const feeClp = input.preferences.confirmed?.monthlyFeeClp ?? null;
  const commercial = calculateCoachCommercialMoney({
    feeClp,
    activeCount,
    pendingInvitationCount,
    declinedCount: null,
    confirmedPaymentsClp: null,
  });
  const feeLabel = formatCoachClpAmount(feeClp);
  const todayLabel = Number.isFinite(input.now.getTime())
    ? new Intl.DateTimeFormat("es-CL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "America/Santiago",
    }).format(input.now)
    : null;

  return Object.freeze({
    welcome: Object.freeze({ coachName: input.coachName, todayLabel }),
    income: Object.freeze({
      amount: moneyMetric(commercial.activeEstimateClp),
      comparisonLabel: null,
      comparisonTone: "neutral" as const,
      formulaLabel: activeCount !== null && feeLabel !== null
        ? `${activeCount} alumnos activos × ${feeLabel} al mes`
        : null,
      atRisk: moneyMetric(null),
      atRiskNote: null,
      potential: moneyMetric(commercial.totalPotentialClp),
      potentialLabel: "SI ACEPTAN LAS INVITACIONES",
      potentialNote: "activos + invitaciones pendientes",
    }),
    portfolio: Object.freeze({
      totalLabel: null,
      active: countMetric(activeCount),
      alert: countMetric(null),
      pending: countMetric(pendingInvitationCount),
      inactive: countMetric(null),
      activeNote: "Vínculos aceptados",
    }),
    alerts: Object.freeze({
      description: "Inactividad y ciclos por vencer.",
      rows: Object.freeze([]),
      emptyLabel: "Datos de actividad no disponibles",
      footerLabel: null,
    }),
    chart: Object.freeze({
      months: Object.freeze([]),
      selectedMonthId: null,
      emptyLabel: "Histórico mensual no disponible",
      noSelectionLabel: null,
    }),
    renewals: Object.freeze({
      title: "Renovaciones",
      description: "Períodos pagados independientes del ciclo de entrenamiento.",
      atStake: moneyMetric(null),
      stack: null,
      rows: Object.freeze([]),
      emptyLabel: "Renovaciones no disponibles",
      retentionLabel: null,
    }),
  });
}

function activeRows(snapshot: CoachActiveRelationshipsSnapshot): readonly CoachClientRowView[] {
  return snapshot.items.map((item) => Object.freeze({
    id: item.id,
    email: item.studentEmail,
    state: "active" as const,
    metaLabel: dateLabel(item.linkedAt),
    name: item.studentName.trim() || null,
    initials: item.studentName.trim()
      ? item.studentName.trim().split(/\s+/u).slice(0, 2).map((part) => [...part][0]).join("")
      : null,
    progressRatio: null,
  }));
}

function pendingRows(snapshot: CoachPendingInvitationsSnapshot): readonly CoachClientRowView[] {
  return snapshot.items.map((item) => Object.freeze({
    id: item.id,
    email: item.recipientEmail,
    state: "pending" as const,
    metaLabel: item.state === "expired"
      ? "Código vencido"
      : `Vence ${dateLabel(item.expiresAt) ?? "próximamente"}`,
  }));
}

function listContent(
  tab: CoachClientTab,
  active: CoachActiveRelationshipsSnapshot,
  pending: CoachPendingInvitationsSnapshot,
): CoachClientsContentView {
  if (tab === "inactive") {
    return Object.freeze({ kind: "message", tone: "polite", label: "Bajas no disponibles" });
  }
  const snapshot = tab === "active" ? active : pending;
  if (snapshot.phase === "idle" || snapshot.phase === "loading") {
    return Object.freeze({ kind: "message", tone: "polite", label: "Cargando…" });
  }
  if (snapshot.phase === "error" || snapshot.phase === "disposed") {
    return Object.freeze({ kind: "message", tone: "error", label: "No pudimos cargar esta lista." });
  }
  const rows = tab === "active" ? activeRows(active) : pendingRows(pending);
  if (rows.length === 0) return Object.freeze({ kind: "empty", view: { kind: tab } });
  return Object.freeze({
    kind: "rows",
    rows,
    resultLabel: snapshot.matchingCount === null ? null : `${snapshot.matchingCount} resultados`,
    canLoadMore: snapshot.nextCursor !== null && snapshot.phase === "ready",
    isLoadingMore: snapshot.phase === "loading-next",
  });
}

export function buildCoachClientsView(input: {
  readonly tab: CoachClientTab;
  readonly query: string;
  readonly active: CoachActiveRelationshipsSnapshot;
  readonly pending: CoachPendingInvitationsSnapshot;
}): CoachClientsViewModel {
  return Object.freeze({
    selectedTab: input.tab,
    query: input.query,
    counts: Object.freeze({
      active: countMetric(input.active.totalActive),
      pending: countMetric(input.pending.totalPending),
      inactive: countMetric(null),
    }),
    content: listContent(input.tab, input.active, input.pending),
  });
}

export function buildCoachFeeSheetView(input: {
  readonly preferences: CoachPreferencesControllerState;
  readonly canSave: boolean;
  readonly activeCount: number | null;
  readonly pendingCount: number | null;
}): CoachFeeSheetView {
  const parsed = input.preferences.feeDraft === null
    ? null
    : parseCoachMonthlyFeeInput(input.preferences.feeDraft);
  const commercial = calculateCoachCommercialMoney({
    feeClp: parsed,
    activeCount: input.activeCount,
    pendingInvitationCount: input.pendingCount,
    declinedCount: null,
    confirmedPaymentsClp: null,
  });
  const selectedPreset = ["25000", "35000", "50000"].includes(input.preferences.feeDraft ?? "")
    ? input.preferences.feeDraft as CoachFeePreset
    : null;
  const issue = input.preferences.issue;
  return Object.freeze({
    isOpen: input.preferences.feeDraft !== null,
    isBusy: input.preferences.pending !== null,
    feeRaw: input.preferences.feeDraft,
    selectedPreset,
    canSave: input.canSave,
    isInvalid: input.preferences.feeDraft !== null
      && input.preferences.feeDraft.trim() !== ""
      && parsed === null,
    preview: Object.freeze([
      Object.freeze({ label: "Alumnos activos", amount: moneyMetric(commercial.activeEstimateClp) }),
      Object.freeze({ label: "En riesgo", amount: moneyMetric(null) }),
      Object.freeze({ label: "Activos + invitaciones pendientes", amount: moneyMetric(commercial.totalPotentialClp) }),
    ]) as readonly [CoachFeePreviewRowView, CoachFeePreviewRowView, CoachFeePreviewRowView],
    message: issue === null ? null : Object.freeze({
      tone: "error" as const,
      label: issue === "version_conflict"
        ? "La tarifa cambió en otra sesión. Vuelve a cargar antes de guardar."
        : "No pudimos completar la operación.",
    }),
  });
}
