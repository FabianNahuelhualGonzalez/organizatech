"use client";

import { useEffect, useRef, type RefObject } from "react";

import { CoachAddClientSheet } from "@/features/coach-clients/components/coach-add-client-sheet";
import { CoachClientDetailSheet } from "@/features/coach-clients/components/coach-client-detail-sheet";
import { CoachClientsView } from "@/features/coach-clients/components/coach-clients";
import { CoachChatComingSoonSheet } from "@/features/coach-dashboard/components/coach-chat-coming-soon-sheet";
import { CoachCommercialDashboard } from "@/features/coach-dashboard/commercial/components/coach-commercial-dashboard";
import { CoachCommercialStudent } from "@/features/coach-dashboard/commercial/components/coach-commercial-student";
import { CoachFeeSheet } from "@/features/coach-dashboard/components/coach-fee-sheet";
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
  const feeTriggerRef = useRef<HTMLElement>(null);
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
  const selectedCommercial = controller.detail?.state === "active"
    ? controller.commercial.snapshot.portfolio?.items.find((item) => item.episodeId === controller.detail?.id) ?? null
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
          <CoachCommercialDashboard
            coachName={coachName}
            portfolio={controller.commercial.snapshot.portfolio}
            phase={controller.commercial.snapshot.phase}
            issue={controller.commercial.snapshot.issue}
            busy={controller.commercial.snapshot.busy}
            uncertain={controller.commercial.snapshot.uncertain}
            onReload={controller.commercial.available ? controller.actions.refreshPortfolio : undefined}
            onSubmit={(command) => { void controller.commercial.submit(command); }}
            onReconcile={() => { void controller.commercial.reconcile(); }}
            onLink={controller.available ? openAddClient : undefined}
            onClients={() => controller.actions.openClients("active")}
            onCalendar={onOpenCalendar}
            onChat={controller.available ? () => {
              captureActiveElement(chatTriggerRef);
              controller.actions.openChat();
            } : undefined}
            pendingInvitations={controller.clientsView.counts.pending.value}
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

      <CoachFeeSheet
        view={controller.feeView}
        backgroundRef={backgroundRef}
        restoreFocusRef={feeTriggerRef}
        onRawChange={controller.actions.editFee}
        onPreset={controller.actions.editFee}
        onSave={controller.actions.saveFee}
        onCancel={controller.actions.cancelFee}
      />
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
              item={selectedCommercial} periods={controller.commercial.snapshot.portfolio.periods}
              today={controller.commercial.snapshot.portfolio.serverToday}
              busy={controller.commercial.snapshot.busy} uncertain={controller.commercial.snapshot.uncertain}
              issue={controller.commercial.snapshot.issue}
              onSubmit={(command) => { void controller.commercial.submit(command); }}
              onReconcile={() => { void controller.commercial.reconcile(); }} />
          ) : controller.detail.state === "active" ? <p role="status">Ficha comercial no disponible.</p> : undefined}
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
