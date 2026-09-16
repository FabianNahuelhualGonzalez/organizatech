import assert from "node:assert/strict";
import test from "node:test";

import type { CoachActiveRelationshipsSnapshot } from "@/features/coach-clients/hooks/coach-active-relationships-controller-contract";
import type { CoachPendingInvitationsSnapshot } from "@/features/coach-clients/hooks/coach-pending-invitations-controller-contract";
import type { CoachPreferencesControllerState } from "../hooks/coach-preferences-controller-contract";
import {
  buildCoachClientsView,
  buildCoachDashboardView,
  buildCoachFeeSheetView,
} from "./coach-dashboard-productive-presentation";

const active: CoachActiveRelationshipsSnapshot = Object.freeze({
  query: "",
  pageSize: 25,
  phase: "ready",
  items: Object.freeze([
    Object.freeze({
      id: "11111111-1111-4111-8111-111111111111",
      linkedAt: "2026-09-10T12:00:00.000Z",
      studentName: "Ana Pérez",
      studentEmail: "ana@example.test",
    }),
  ]),
  serverNow: "2026-09-16T12:00:00.000Z",
  totalActive: 2,
  matchingCount: 1,
  nextCursor: null,
  issue: null,
});

const pending: CoachPendingInvitationsSnapshot = Object.freeze({
  query: "",
  pageSize: 25,
  phase: "ready",
  items: Object.freeze([
    Object.freeze({
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-09-15T12:00:00.000Z",
      issuedAt: "2026-09-15T12:00:00.000Z",
      expiresAt: "2026-09-22T12:00:00.000Z",
      recipientEmail: "pendiente@example.test",
      state: "pending" as const,
    }),
  ]),
  serverNow: "2026-09-16T12:00:00.000Z",
  totalPending: 1,
  matchingCount: 1,
  nextCursor: null,
  issue: null,
});

const preferences: CoachPreferencesControllerState = Object.freeze({
  confirmed: Object.freeze({
    monthlyFeeClp: 35_000,
    version: 3,
    chatInterestRegistered: false,
  }),
  feeDraft: null,
  chatOpen: false,
  pending: null,
  issue: null,
  needsRefresh: false,
});

test("separa invitaciones pendientes de pagos y conserva métricas sin fuente como desconocidas", () => {
  const view = buildCoachDashboardView({
    coachName: "Coach Uno",
    now: new Date("2026-09-16T12:00:00.000Z"),
    preferences,
    active,
    pending,
  });

  assert.deepEqual(view.portfolio.active, { value: 2, label: "2" });
  assert.deepEqual(view.portfolio.pending, { value: 1, label: "1" });
  assert.deepEqual(view.income.amount, { value: 70_000, label: "$70.000" });
  assert.deepEqual(view.income.potential, { value: 105_000, label: "$105.000" });
  assert.equal(view.income.potentialLabel, "SI ACEPTAN LAS INVITACIONES");
  assert.equal(view.income.atRisk.value, null);
  assert.equal(view.chart.months.length, 0);
  assert.equal(view.renewals.atStake.value, null);
  assert.equal(view.renewals.rows.length, 0);
});

test("la fila pendiente expone sólo email y metadatos de invitación", () => {
  const view = buildCoachClientsView({ tab: "pending", query: "", active, pending });
  assert.equal(view.content.kind, "rows");
  if (view.content.kind !== "rows") return;
  assert.equal(view.content.rows.length, 1);
  const row = view.content.rows[0];
  assert.equal(row?.state, "pending");
  assert.equal(row?.email, "pendiente@example.test");
  assert.equal(row && "name" in row, false);
  assert.equal(row && "initials" in row, false);
  assert.equal(row && "progressRatio" in row, false);
  assert.equal(view.content.canLoadMore, false);
  assert.equal(view.content.isLoadingMore, false);
});

test("expone paginación sólo cuando el cursor autoritativo permite cargar otra página", () => {
  const view = buildCoachClientsView({
    tab: "active",
    query: "",
    active: {
      ...active,
      nextCursor: active.items[0] ? { linkedAt: active.items[0].linkedAt, id: active.items[0].id } : null,
    },
    pending,
  });
  assert.equal(view.content.kind, "rows");
  if (view.content.kind !== "rows") return;
  assert.equal(view.content.canLoadMore, true);
  assert.equal(view.content.isLoadingMore, false);
});

test("el preview de tarifa mantiene el potencial de invitaciones separado del cobro", () => {
  const view = buildCoachFeeSheetView({
    preferences: { ...preferences, feeDraft: "50000" },
    canSave: true,
    activeCount: 2,
    pendingCount: 1,
  });

  assert.equal(view.selectedPreset, "50000");
  assert.deepEqual(view.preview.map(({ amount }) => amount.value), [100_000, null, 150_000]);
  assert.equal(view.preview[2].label, "Activos + invitaciones pendientes");
});
