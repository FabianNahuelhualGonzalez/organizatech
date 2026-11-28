"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { CoachAddClientSheet } from "@/features/coach-clients/components/coach-add-client-sheet";
import { CoachClientDetailSheet } from "@/features/coach-clients/components/coach-client-detail-sheet";
import { CoachStudentRoutineSummary } from "@/features/coach-clients/components/coach-student-routine-summary";
import { CoachClientsView } from "@/features/coach-clients/components/coach-clients";
import { loadCoachLinkedStudentAvatar } from "../data/coach-linked-student-avatar";
import { CoachChatComingSoonSheet } from "@/features/coach-dashboard/components/coach-chat-coming-soon-sheet";
import { CoachDashboardView } from "@/features/coach-dashboard/components/coach-dashboard";
import { CoachAlertsCard } from "@/features/coach-dashboard/components/coach-alerts-card";
import { CoachCommercialStudent } from "@/features/coach-dashboard/commercial/components/coach-commercial-student";
import { CoachReportsView } from "@/features/coach-reports/components/coach-reports-view";
import { CoachStudentRecord } from "@/features/coach-student-record/components/coach-student-record";
import { useCoachWorkspaceController } from "../hooks/use-coach-workspace-controller";
import { useCoachStudentRoutineSummary } from "../hooks/use-coach-student-routine-summary";

import styles from "./coach-workspace-boundary.module.css";

function captureActiveElement(ref: RefObject<HTMLElement | null>) {
  if (typeof document === "undefined") return;
  ref.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function CoachWorkspaceBoundary({
  userId,
  coachName,
  identityGeneration,
  onOpenCalendar,
  onOpenEvaluations,
  clientOpenRequest,
  onClientOpenRequestConsumed,
}: {
  readonly userId: string;
  readonly coachName: string;
  readonly identityGeneration: number | null;
  readonly onOpenCalendar: () => void;
  readonly onOpenEvaluations: () => void;
  readonly clientOpenRequest: {
    readonly ownerUserId: string;
    readonly episodeId: string;
    readonly sequence: number;
  } | null;
  readonly onClientOpenRequestConsumed: (request: {
    readonly ownerUserId: string;
    readonly episodeId: string;
    readonly sequence: number;
  }) => void;
}) {
  const controller = useCoachWorkspaceController({ userId, coachName, identityGeneration });
  const routineSummary = useCoachStudentRoutineSummary(userId,
    controller.detail?.state === "active" ? controller.detail.id : null);
  const [recordEpisodeId, setRecordEpisodeId] = useState<string | null>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const chatTriggerRef = useRef<HTMLElement>(null);
  const addTriggerRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLElement>(null);
  const consumedRequestRef = useRef<string | null>(null);
  const consumedReportRouteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!clientOpenRequest || clientOpenRequest.ownerUserId !== userId) return;
    const requestKey = `${clientOpenRequest.ownerUserId}:${clientOpenRequest.episodeId}:${clientOpenRequest.sequence}`;
    if (consumedRequestRef.current === requestKey) return;
    if (!controller.actions.openClient(clientOpenRequest.episodeId)) return;
    consumedRequestRef.current = requestKey;
    onClientOpenRequestConsumed(clientOpenRequest);
  }, [clientOpenRequest, controller, onClientOpenRequestConsumed, userId]);

  useEffect(() => {
    if (typeof window === "undefined" || !controller.available) return;
    const reportId = new URLSearchParams(window.location.search).get("coachReport");
    if (!reportId || consumedReportRouteRef.current === reportId) return;
    consumedReportRouteRef.current = reportId;
    controller.actions.openReports();
    void controller.reports.open(reportId);
    const url = new URL(window.location.href);
    url.searchParams.delete("coachReport");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [controller]);

  const openAddClient = () => {
    captureActiveElement(addTriggerRef);
    controller.actions.openAddClient();
  };
  const openClient = (id: string) => {
    captureActiveElement(detailTriggerRef);
    void controller.commercial.reload();
    controller.actions.openClient(id);
  };
  const openCommercialStudent = (id: string) => {
    captureActiveElement(detailTriggerRef);
    controller.actions.openCommercialStudent(id);
  };
  const selectedCommercial = controller.detail?.state === "active"
    ? controller.commercial.snapshot.portfolio?.stats
      ? controller.commercial.snapshot.students[controller.detail.id] ?? null
      : controller.commercial.snapshot.portfolio?.items.find((item) => item.episodeId === controller.detail?.id) ?? null
    : null;

  return (
    <div className={styles.workspace}>
      <div className={styles.content} ref={backgroundRef}>
        {recordEpisodeId ? <CoachStudentRecord key={recordEpisodeId} coachId={userId}
          episodeId={recordEpisodeId} onSendEvaluation={onOpenEvaluations}
          onBack={() => { setRecordEpisodeId(null); controller.actions.openClient(recordEpisodeId); }} /> : null}
        {!recordEpisodeId && !controller.available ? (
          <p className={styles.unavailable} role="status">
            Los datos del Panel Coach no están disponibles en esta sesión.
          </p>
        ) : null}
        {!recordEpisodeId && (controller.screen === "dashboard" ? (
          <CoachDashboardView
            view={controller.dashboardView}
            actions={{
              onManageRates: controller.available ? () => controller.actions.openClients("active") : undefined,
              onPortfolio: controller.available ? {
                active: () => controller.actions.openClients("active"),
                alert: controller.actions.openAlerts,
                pending: () => controller.actions.openClients("pending"),
                inactive: () => controller.actions.openClients("inactive"),
              } : undefined,
              onAlert: controller.available ? openCommercialStudent : undefined,
              onSelectMonth: controller.commercial.snapshot.portfolio ? controller.actions.selectMonth : undefined,
              onRenewal: controller.commercial.snapshot.portfolio ? openCommercialStudent : undefined,
              onLoadMoreCommercial: () => { void controller.commercial.loadMoreItems(); },
              onLoadMoreMonths: () => { void controller.commercial.loadMoreMonths(); },
              onLink: controller.available ? openAddClient : undefined,
              onCalendar: onOpenCalendar,
              onChat: controller.available ? () => {
                captureActiveElement(chatTriggerRef);
                controller.actions.openChat();
              } : undefined,
              onReports: controller.available ? controller.actions.openReports : undefined,
            }}
          />
        ) : controller.screen === "alerts" ? (
          <section className={styles.alertsScreen} aria-label="Alumnos en alerta">
            <button type="button" className={styles.back} onClick={controller.actions.openDashboard}>← Volver al panel</button>
            <h2>Alumnos en alerta</h2>
            <CoachAlertsCard view={controller.dashboardView.alerts} showAdd={false} onAlert={openCommercialStudent}
              onViewAlerts={controller.attentionBusy ? undefined : controller.actions.loadMoreAttention} />
          </section>
        ) : controller.screen === "clients" ? (
          <CoachClientsView
            coachId={userId}
            loadStudentAvatar={loadCoachLinkedStudentAvatar}
            view={controller.clientsView}
            actions={{
              onBack: controller.actions.openDashboard,
              onLink: controller.available ? openAddClient : undefined,
              onSelectTab: controller.actions.selectTab,
              onQueryChange: controller.actions.setQuery,
              onOpenClient: openClient,
              onLoadMore: controller.actions.loadMore,
            }}
          />
        ) : (
          <CoachReportsView
            state={controller.reports.state}
            onBack={controller.actions.openDashboard}
            onRetry={() => { void controller.reports.reload(); }}
            onOpen={(reportId) => { void controller.reports.open(reportId); }}
            onDownload={controller.reports.download}
          />
        ))}
      </div>

      <CoachChatComingSoonSheet
        view={controller.chatView}
        backgroundRef={backgroundRef}
        restoreFocusRef={chatTriggerRef}
        onRegister={controller.actions.registerChat}
        onCancel={controller.actions.cancelChat}
      />
      <CoachAddClientSheet
        view={controller.addClient}
        backgroundRef={backgroundRef}
        restoreFocusRef={addTriggerRef}
        actions={{
          onEmailChange: controller.actions.setInvitationEmail,
          onAmountChange: controller.actions.setInvitationAmount,
          onFrequencyChange: controller.actions.setInvitationFrequency,
          onSubmit: controller.actions.submitInvitation,
          onCancel: controller.actions.closeAddClient,
          onCopyCode: controller.actions.copyInvitationCode,
          onShareCode: controller.actions.shareInvitationCode,
          onOpenPendingClients: () => {
            controller.actions.closeAddClient();
            controller.actions.openClients("pending");
          },
        }}
      />
      {!recordEpisodeId && controller.detail ? (
        <CoachClientDetailSheet
          coachId={userId}
          loadStudentAvatar={loadCoachLinkedStudentAvatar}
          routineSummaryContent={controller.detail.state === "active" ? <CoachStudentRoutineSummary
            cycle={routineSummary?.cycle ?? null} hasMore={routineSummary?.hasMore ?? false}
            state={routineSummary?.state ?? "loading"} /> : undefined}
          view={controller.detail}
          confirmation={controller.confirmation}
          backgroundRef={backgroundRef}
          restoreFocusRef={detailTriggerRef}
          commercialContent={selectedCommercial && controller.commercial.snapshot.portfolio ? (
            <CoachCommercialStudent key={`${selectedCommercial.episodeId}:${selectedCommercial.version}`}
              item={selectedCommercial}
              periods={controller.commercial.snapshot.periodPages[selectedCommercial.episodeId]?.rows
                ?? controller.commercial.snapshot.portfolio.periods}
              hasMorePeriods={Boolean(controller.commercial.snapshot.periodPages[selectedCommercial.episodeId]?.cursor)}
              today={controller.commercial.snapshot.portfolio.serverToday}
              busy={controller.commercial.snapshot.busy} uncertain={controller.commercial.snapshot.uncertain}
              retryAllowed={controller.commercial.snapshot.retryAllowed}
              needsRefresh={controller.commercial.snapshot.needsRefresh}
              issue={controller.commercial.snapshot.issue}
              onSubmit={(command) => { void controller.commercial.submit(command); }}
              onReconcile={() => { void controller.commercial.reconcile(); }}
              onRetry={() => { void controller.commercial.retry(); }}
              onReload={() => { void controller.commercial.reload(); }}
              onLoadMorePeriods={() => { void controller.commercial.loadMorePeriods(selectedCommercial.episodeId); }} />
          ) : controller.detail.state === "active" ? controller.commercial.snapshot.portfolio?.stats ? (
            <div role="status">
              <p>{controller.commercial.snapshot.studentIssues[controller.detail.id] || "Cargando ficha comercial…"}</p>
              {controller.commercial.snapshot.studentIssues[controller.detail.id]
                ? <button type="button" onClick={() => { void controller.commercial.loadStudent(controller.detail!.id); }}>
                  Reintentar
                </button> : null}
            </div>
          ) : <p role="status">Ficha comercial no disponible.</p> : undefined}
          actions={{
            onCancelDetail: controller.actions.closeClient,
            onOpenRecord: (id) => {
              controller.actions.closeClient();
              setRecordEpisodeId(id);
            },
            onCopyCode: controller.actions.copyInvitationCode,
            onShareCode: controller.actions.shareInvitationCode,
            onResend: controller.actions.resendOrRegenerate,
            onRetryDelivery: controller.actions.retryInvitationDelivery,
            onOpenUnlink: controller.actions.openDisconnection,
            onConfirmUnlink: controller.actions.confirmDisconnection,
            onCancelUnlink: controller.actions.closeDisconnection,
          }}
        />
      ) : null}
    </div>
  );
}
