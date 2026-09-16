"use client";

import { useRef, type RefObject } from "react";

import { CoachAddClientSheet } from "@/features/coach-clients/components/coach-add-client-sheet";
import { CoachClientDetailSheet } from "@/features/coach-clients/components/coach-client-detail-sheet";
import { CoachClientsView } from "@/features/coach-clients/components/coach-clients";
import { CoachChatComingSoonSheet } from "@/features/coach-dashboard/components/coach-chat-coming-soon-sheet";
import { CoachDashboardView } from "@/features/coach-dashboard/components/coach-dashboard";
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
}: {
  readonly userId: string;
  readonly coachName: string;
  readonly identityGeneration: number | null;
  readonly onOpenCalendar: () => void;
}) {
  const controller = useCoachWorkspaceController({ userId, coachName, identityGeneration });
  const backgroundRef = useRef<HTMLDivElement>(null);
  const feeTriggerRef = useRef<HTMLElement>(null);
  const chatTriggerRef = useRef<HTMLElement>(null);
  const addTriggerRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLElement>(null);

  const openAddClient = () => {
    captureActiveElement(addTriggerRef);
    controller.actions.openAddClient();
  };
  const openClient = (id: string) => {
    captureActiveElement(detailTriggerRef);
    controller.actions.openClient(id);
  };

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
              onEditFee: controller.available ? () => {
                captureActiveElement(feeTriggerRef);
                controller.actions.openFee();
              } : undefined,
              onPortfolio: controller.available ? {
                active: () => controller.actions.openClients("active"),
                pending: () => controller.actions.openClients("pending"),
                inactive: () => controller.actions.openClients("inactive"),
              } : undefined,
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
          actions={{
            onCancelDetail: controller.actions.closeClient,
            onResend: controller.actions.resendOrRegenerate,
            onOpenUnlink: controller.actions.openDisconnection,
            onConfirmUnlink: controller.actions.confirmDisconnection,
            onCancelUnlink: controller.actions.closeDisconnection,
          }}
        />
      ) : null}
    </div>
  );
}
