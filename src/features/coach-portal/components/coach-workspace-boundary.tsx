"use client";

import { useEffect, useRef, type RefObject } from "react";

import { CoachAddClientSheet } from "@/features/coach-clients/components/coach-add-client-sheet";
import { CoachClientDetailSheet } from "@/features/coach-clients/components/coach-client-detail-sheet";
import { CoachClientsView } from "@/features/coach-clients/components/coach-clients";
import { CoachChatComingSoonSheet } from "@/features/coach-dashboard/components/coach-chat-coming-soon-sheet";
import { CoachDashboardView } from "@/features/coach-dashboard/components/coach-dashboard";
import { CoachCommercialStudent } from "@/features/coach-dashboard/commercial/components/coach-commercial-student";
import { useCoachWorkspaceController } from "../hooks/use-coach-workspace-controller";

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
  clientOpenRequest,
  onClientOpenRequestConsumed,
}: {
  readonly userId: string;
  readonly coachName: string;
  readonly identityGeneration: number | null;
  readonly onOpenCalendar: () => void;
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
  const backgroundRef = useRef<HTMLDivElement>(null);
  const chatTriggerRef = useRef<HTMLElement>(null);
  const addTriggerRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLElement>(null);
  const consumedRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!clientOpenRequest || clientOpenRequest.ownerUserId !== userId) return;
    const requestKey = `${clientOpenRequest.ownerUserId}:${clientOpenRequest.episodeId}:${clientOpenRequest.sequence}`;
    if (consumedRequestRef.current === requestKey) return;
    if (!controller.actions.openClient(clientOpenRequest.episodeId)) return;
    consumedRequestRef.current = requestKey;
    onClientOpenRequestConsumed(clientOpenRequest);
  }, [clientOpenRequest, controller, onClientOpenRequestConsumed, userId]);

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
        {!controller.available ? (
          <p className={styles.unavailable} role="status">
            Los datos del Panel Coach no están disponibles en esta sesión.
          </p>
        ) : null}
        {controller.screen === "dashboard" ? (
          <CoachDashboardView
            view={controller.dashboardView}
            actions={{
              onManageRates: controller.available ? () => controller.actions.openClients("active") : undefined,
              onPortfolio: controller.available ? {
                active: () => controller.actions.openClients("active"),
                pending: () => controller.actions.openClients("pending"),
                inactive: () => controller.actions.openClients("inactive"),
              } : undefined,
              onAlert: controller.commercial.snapshot.portfolio ? openCommercialStudent : undefined,
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
            }}
          />
        ) : (
          <CoachClientsView
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
        )}
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
      {controller.detail ? (
        <CoachClientDetailSheet
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
              needsRefresh={controller.commercial.snapshot.needsRefresh}
              issue={controller.commercial.snapshot.issue}
              onSubmit={(command) => { void controller.commercial.submit(command); }}
              onReconcile={() => { void controller.commercial.reconcile(); }}
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
