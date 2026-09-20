export interface CoachDashboardMoneyInput {
  readonly feeClp: number | null;
  readonly activeCount: number | null;
  readonly alertCount: number | null;
  readonly pendingCount: number | null;
}

export interface CoachDashboardMoney {
  readonly incomeClp: number | null;
  readonly atRiskClp: number | null;
  readonly potentialClp: number | null;
}

export interface CoachRenewalCounts {
  readonly renewed: number | null;
  readonly pending: number | null;
  readonly declined: number | null;
}

export interface CoachCommercialMoneyInput {
  readonly feeClp: number | null;
  /** Accepted active links only: not invitations, inactive links or paid counts. */
  readonly activeCount: number | null;
  /** Invitations not yet accepted, never payments pending confirmation. */
  readonly pendingInvitationCount: number | null;
  /** Explicitly confirmed no-sigue/baja cohort, never expiry or inactivity alerts. */
  readonly declinedCount: number | null;
  /** Explicit server aggregate of manually confirmed payments, not count × fee. */
  readonly confirmedPaymentsClp: number | null;
}

export interface CoachCommercialMoney {
  readonly activeEstimateClp: number | null;
  readonly invitationPotentialClp: number | null;
  readonly totalPotentialClp: number | null;
  readonly declinedLossEstimateClp: number | null;
  readonly confirmedPaymentsClp: number | null;
}

/** A supplied historical read fact, not a request or mechanism to close a month. */
export interface CoachClosedMonthMoneySnapshot {
  readonly kind: "closed-month";
  readonly month: string;
  readonly feeClpAtClose: number | null;
  readonly portfolioAtClose: {
    readonly activeCount: number | null;
    readonly pendingInvitationCount: number | null;
    readonly declinedCount: number | null;
  };
  readonly confirmedPaymentsClpAtClose: number | null;
}

export interface CoachClosedMonthMoney extends CoachClosedMonthMoneySnapshot {
  readonly money: CoachCommercialMoney;
}

function isNonNegativeSafeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

/** Monthly CLP input without the UI's currency sign. Invalid or incomplete stays unknown. */
export function parseCoachMonthlyFeeInput(raw: string): number | null {
  const value = raw.trim();
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:\.[0-9]{3})+)$/.test(value)) return null;

  // Separators are removed only after the entire input matches the allowed grammar.
  const amount = Number(value.replace(/\./g, ""));
  return isNonNegativeSafeInteger(amount) ? amount : null;
}

function addCounts(left: number | null, right: number | null): number | null {
  if (!isNonNegativeSafeInteger(left) || !isNonNegativeSafeInteger(right)
    || left > Number.MAX_SAFE_INTEGER - right) return null;
  return left + right;
}

function multiplyFee(count: number | null, feeClp: number | null): number | null {
  if (!isNonNegativeSafeInteger(count) || !isNonNegativeSafeInteger(feeClp)
    || (count > 0 && feeClp > Math.floor(Number.MAX_SAFE_INTEGER / count))) return null;
  // Normalize negative zero at the domain boundary as well as during formatting.
  return count === 0 || feeClp === 0 ? 0 : count * feeClp;
}

/**
 * Legacy projection, preserved unchanged. incomeClp is active × fee, NOT collected
 * income; atRiskClp is an alert estimate, NOT a confirmed loss or an unpaid debt.
 * New income-card/fee-preview selectors should use calculateCoachCommercialMoney.
 */
export function calculateCoachDashboardMoney(input: CoachDashboardMoneyInput): CoachDashboardMoney {
  return {
    incomeClp: multiplyFee(input.activeCount, input.feeClp),
    atRiskClp: multiplyFee(input.alertCount, input.feeClp),
    potentialClp: multiplyFee(addCounts(input.activeCount, input.pendingCount), input.feeClp),
  };
}

/**
 * Legacy potential of renewed + pending, preserved unchanged; never collected
 * payments or debt. Declined renewals are excluded even when their count is unknown.
 */
export function calculateCoachRenewalAmountInPlay(
  feeClp: number | null,
  counts: CoachRenewalCounts,
): number | null {
  return multiplyFee(addCounts(counts.renewed, counts.pending), feeClp);
}

function knownAmount(value: number | null): number | null {
  return isNonNegativeSafeInteger(value) ? (value === 0 ? 0 : value) : null;
}

/**
 * For the existing CoachIncomeCard amount/atRisk/potential and CoachFeeSheet preview.
 * The caller supplies complete, authorized, deduplicated cohorts in the same calendar
 * month: active links and pending invitations must be disjoint. Aggregate counts
 * cannot verify membership, overlap or confirmation provenance; do not infer those.
 * Expired payments never become declinedCount. No estimate is a charge or a debt,
 * and confirmed payments are never added to projections or recalculated with feeClp.
 */
export function calculateCoachCommercialMoney(input: CoachCommercialMoneyInput): CoachCommercialMoney {
  return Object.freeze({
    activeEstimateClp: multiplyFee(input.activeCount, input.feeClp),
    invitationPotentialClp: multiplyFee(input.pendingInvitationCount, input.feeClp),
    totalPotentialClp: multiplyFee(addCounts(input.activeCount, input.pendingInvitationCount), input.feeClp),
    declinedLossEstimateClp: multiplyFee(input.declinedCount, input.feeClp),
    confirmedPaymentsClp: knownAmount(input.confirmedPaymentsClp),
  });
}

/**
 * Historical source for CoachMonthView.estimatedIncome / CoachMonthDetail.
 * No current tariff, clock, automatic closure or backend persistence is accepted.
 * Closure/provenance is a caller/server fact; a syntactically valid month proves
 * neither that it has closed nor that these counts came from that month's ledger.
 */
export function projectCoachClosedMonthMoney(
  snapshot: CoachClosedMonthMoneySnapshot | null,
): CoachClosedMonthMoney | null {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.kind !== "closed-month" || typeof snapshot.month !== "string" || snapshot.month.length !== 7
    || !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(snapshot.month)
    || !snapshot.portfolioAtClose || typeof snapshot.portfolioAtClose !== "object"
    || Array.isArray(snapshot.portfolioAtClose)) return null;
  const feeClpAtClose = knownAmount(snapshot.feeClpAtClose);
  const portfolioAtClose = Object.freeze({
    activeCount: knownAmount(snapshot.portfolioAtClose.activeCount),
    pendingInvitationCount: knownAmount(snapshot.portfolioAtClose.pendingInvitationCount),
    declinedCount: knownAmount(snapshot.portfolioAtClose.declinedCount),
  });
  const confirmedPaymentsClpAtClose = knownAmount(snapshot.confirmedPaymentsClpAtClose);
  return Object.freeze({
    kind: "closed-month",
    month: snapshot.month,
    feeClpAtClose,
    portfolioAtClose,
    confirmedPaymentsClpAtClose,
    money: calculateCoachCommercialMoney({
      feeClp: feeClpAtClose, ...portfolioAtClose, confirmedPaymentsClp: confirmedPaymentsClpAtClose,
    }),
  });
}

/** CLP without decimals. Null is not formatted as zero; signed amounts support risk/deltas. */
export function formatCoachClpAmount(amount: number | null): string | null {
  if (amount === null || !Number.isSafeInteger(amount)) return null;
  const digits = Math.abs(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "−" : ""}$${digits}`;
}
