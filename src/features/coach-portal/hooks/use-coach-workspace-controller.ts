"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  CoachAddClientView,
  CoachClientInstructionSteps,
} from "@/features/coach-clients/components/coach-add-client-view";
import type {
  CoachClientDetailView,
  CoachClientUnlinkConfirmationView,
} from "@/features/coach-clients/components/coach-client-detail-view";
import type { CoachClientTab } from "@/features/coach-clients/components/coach-clients-view";
import { createCoachActiveRelationshipsRuntime } from "@/features/coach-clients/integration/coach-active-relationships-runtime";
import { createCoachClientDisconnectionRuntime } from "@/features/coach-clients/integration/coach-client-disconnection-runtime";
import { createCoachInvitationActionsRuntime } from "@/features/coach-clients/integration/coach-invitation-actions-runtime";
import {
  hasUnresolvedCoachInvitationAction,
  resolveCoachInvitationDetailAction,
} from "@/features/coach-clients/integration/coach-invitation-actions-presentation";
import { createCoachInvitationCreationRuntime } from "@/features/coach-clients/integration/coach-invitation-creation-runtime";
import {
  createCoachInvitationDeliveryRuntime,
  type CoachInvitationDeliveryState,
} from "@/features/coach-clients/data/coach-invitation-delivery-runtime";
import { resolveCoachInvitationCreationAction } from "@/features/coach-clients/integration/coach-invitation-creation-presentation";
import { createCoachPendingInvitationsRuntime } from "@/features/coach-clients/integration/coach-pending-invitations-runtime";
import type { CoachPublicRpcRuntimeInput } from "@/features/coach-clients/data/coach-public-rpc-runtime";
import type { CoachActiveRelationshipsSnapshot } from "@/features/coach-clients/hooks/coach-active-relationships-controller-contract";
import type { CoachPendingInvitationsSnapshot } from "@/features/coach-clients/hooks/coach-pending-invitations-controller-contract";
import type { CoachInvitationCreationSnapshot } from "@/features/coach-clients/hooks/coach-invitation-creation-contract";
import type { CoachInvitationActionsSnapshot } from "@/features/coach-clients/hooks/coach-invitation-actions-contract";
import type { CoachClientDisconnectionSnapshot } from "@/features/coach-clients/hooks/coach-client-disconnection-contract";
import { createCoachPreferencesRuntime } from "@/features/coach-dashboard/integration/coach-preferences-runtime";
import {
  buildCoachClientsView,
  buildCoachDashboardView,
  buildCoachFeeSheetView,
} from "@/features/coach-dashboard/integration/coach-dashboard-productive-presentation";
import type { CoachPreferencesControllerState } from "@/features/coach-dashboard/hooks/coach-preferences-controller-contract";
import {
  getActiveSupabaseAuthIdentityScope,
  getSupabaseBrowserClient,
} from "@/lib/supabase/client";

const EMPTY_ACTIVE: CoachActiveRelationshipsSnapshot = Object.freeze({
  query: "",
  pageSize: 25,
  phase: "idle",
  items: Object.freeze([]),
  serverNow: null,
  totalActive: null,
  matchingCount: null,
  nextCursor: null,
  issue: null,
});
const EMPTY_PENDING: CoachPendingInvitationsSnapshot = Object.freeze({
  query: "",
  pageSize: 25,
  phase: "idle",
  items: Object.freeze([]),
  serverNow: null,
  totalPending: null,
  matchingCount: null,
  nextCursor: null,
  issue: null,
});
const EMPTY_CREATION: CoachInvitationCreationSnapshot = Object.freeze({
  isOpen: false,
  emailRaw: "",
  emailValid: false,
  pending: null,
  attempt: null,
  confirmed: null,
  rateLimit: null,
  issue: null,
  needsRefresh: false,
  disposed: false,
});
const EMPTY_ACTIONS: CoachInvitationActionsSnapshot = Object.freeze({
  confirmed: null,
  pending: null,
  attempt: null,
  rateLimit: null,
  issue: null,
  needsRefresh: false,
  disposed: false,
});
const EMPTY_DISCONNECTION: CoachClientDisconnectionSnapshot = Object.freeze({
  confirmed: null,
  confirmationOpen: false,
  pending: null,
  attempt: null,
  issue: null,
  needsRefresh: false,
  disposed: false,
});
const EMPTY_PREFERENCES: CoachPreferencesControllerState = Object.freeze({
  confirmed: null,
  feeDraft: null,
  chatOpen: false,
  pending: null,
  issue: null,
  needsRefresh: false,
});

interface ExternalController<T> {
  getSnapshot(): T;
  subscribe(listener: (snapshot: T) => void): () => void;
}

function useControllerSnapshot<T>(controller: ExternalController<T> | null, fallback: T): T {
  return useSyncExternalStore(
    controller ? controller.subscribe : () => () => undefined,
    controller ? controller.getSnapshot : () => fallback,
    () => fallback,
  );
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("secure-request-id-unavailable");
  return globalThis.crypto.randomUUID();
}

function formatDate(value: string | null): string | null {
  if (value === null) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Santiago",
  }).format(new Date(time));
}

function initials(value: string): string | null {
  const name = value.trim();
  return name ? name.split(/\s+/u).slice(0, 2).map((part) => [...part][0]).join("") : null;
}

function createConnection(
  userId: string,
  identityGeneration: number | null,
): CoachPublicRpcRuntimeInput | null {
  const principal = getSupabaseBrowserClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!principal || !url || !publicKey || identityGeneration === null) return null;
  const expectedIdentity = Object.freeze({ userId, generation: identityGeneration });
  return Object.freeze({
    configuration: Object.freeze({ url, publicKey }),
    principal,
    expectedIdentity,
    isCurrent(snapshot: typeof expectedIdentity) {
      const live = getActiveSupabaseAuthIdentityScope();
      return live?.userId === snapshot.userId
        && live.sessionEpoch === snapshot.generation
        && snapshot.userId === userId
        && snapshot.generation === identityGeneration;
    },
  });
}

export function useCoachWorkspaceController(input: {
  readonly userId: string;
  readonly coachName: string;
  readonly identityGeneration: number | null;
}) {
  const connection = useMemo(
    () => createConnection(input.userId, input.identityGeneration),
    [input.identityGeneration, input.userId],
  );
  const [screen, setScreen] = useState<"dashboard" | "clients">("dashboard");
  const [tab, setTab] = useState<CoachClientTab>("active");
  const [query, setQuery] = useState("");
  const [creationEpoch, setCreationEpoch] = useState(0);
  const [creationDelivery, setCreationDelivery] = useState<{
    readonly requestId: string;
    readonly state: CoachInvitationDeliveryState;
  } | null>(null);
  const [detailDelivery, setDetailDelivery] = useState<{
    readonly invitationId: string;
    readonly requestId: string | null;
    readonly state: CoachInvitationDeliveryState;
  } | null>(null);
  const [detailDeliveryPendingInvitationId, setDetailDeliveryPendingInvitationId] = useState<string | null>(null);
  const detailDeliveryPendingRef = useRef<string | null>(null);
  const [copiedInvitationId, setCopiedInvitationId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    readonly kind: "invitation" | "relationship";
    readonly id: string;
  } | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const base = useMemo(() => {
    if (!connection) return null;
    try {
      return Object.freeze({
        active: createCoachActiveRelationshipsRuntime({ connection }),
        pending: createCoachPendingInvitationsRuntime({ connection }),
        preferences: createCoachPreferencesRuntime({
          configuration: connection.configuration,
          principal: connection.principal,
          expectedUserId: input.userId,
          isCurrent: () => connection.isCurrent(connection.expectedIdentity),
        }),
      });
    } catch {
      return null;
    }
  }, [connection, input.userId]);

  useEffect(() => {
    if (!base) return;
    void base.active.load();
    void base.pending.load();
    void base.preferences.load();
    return () => {
      base.active.dispose();
      base.pending.dispose();
      base.preferences.dispose();
    };
  }, [base]);

  const active = useControllerSnapshot(base?.active ?? null, EMPTY_ACTIVE);
  const pending = useControllerSnapshot(base?.pending ?? null, EMPTY_PENDING);
  const preferences = useControllerSnapshot(base?.preferences ?? null, EMPTY_PREFERENCES);

  const creationController = useMemo(() => {
    if (!connection) return null;
    // A resolved intent rotates only after close; uncertain attempts keep this instance for reconcile/retry.
    void creationEpoch;
    try { return createCoachInvitationCreationRuntime({ connection, createRequestId }); }
    catch { return null; }
  }, [connection, creationEpoch]);
  useEffect(() => () => creationController?.dispose(), [creationController]);
  const creation = useControllerSnapshot(creationController, EMPTY_CREATION);
  const deliveryRuntime = useMemo(() => {
    if (!connection) return null;
    try { return createCoachInvitationDeliveryRuntime({ connection }); }
    catch { return null; }
  }, [connection]);
  useEffect(() => {
    if (!deliveryRuntime) return;
    void deliveryRuntime.recover().catch(() => undefined);
  }, [deliveryRuntime]);
  useEffect(() => {
    setCreationDelivery(null);
    setDetailDelivery(null);
    detailDeliveryPendingRef.current = null;
    setDetailDeliveryPendingInvitationId(null);
    setCopiedInvitationId(null);
  }, [connection, creationEpoch]);

  const selectionControllers = useMemo(() => {
    if (!connection || !selected) return null;
    const isSelectionCurrent = (candidate: { readonly id?: string; readonly invitationId?: string }) => {
      const current = selectedRef.current;
      const candidateId = candidate.id ?? candidate.invitationId;
      return current?.kind === selected.kind && current.id === selected.id && candidateId === selected.id;
    };
    try {
      return Object.freeze({
        disconnection: createCoachClientDisconnectionRuntime({
          connection,
          selection: selected,
          isSelectionCurrent,
          createRequestId,
        }),
        actions: selected.kind === "invitation"
          ? createCoachInvitationActionsRuntime({
            connection,
            selection: { invitationId: selected.id },
            isSelectionCurrent,
            createRequestId,
          })
          : null,
      });
    } catch {
      return null;
    }
  }, [connection, selected]);

  useEffect(() => {
    if (!selectionControllers) return;
    void selectionControllers.disconnection.load();
    if (selectionControllers.actions) void selectionControllers.actions.load();
    return () => {
      selectionControllers.disconnection.dispose();
      selectionControllers.actions?.dispose();
    };
  }, [selectionControllers]);

  const disconnection = useControllerSnapshot(
    selectionControllers?.disconnection ?? null,
    EMPTY_DISCONNECTION,
  );
  const invitationActions = useControllerSnapshot(
    selectionControllers?.actions ?? null,
    EMPTY_ACTIONS,
  );
  const invitationDetailAction = resolveCoachInvitationDetailAction(invitationActions, {
    canResend: selectionControllers?.actions?.canResend() === true,
    canRegenerate: selectionControllers?.actions?.canRegenerate() === true,
  });
  const invitationActionUnresolved = hasUnresolvedCoachInvitationAction(invitationActions);

  const selectedActive = selected?.kind === "relationship"
    ? active.items.find((item) => item.id === selected.id) ?? null
    : null;
  const selectedPending = selected?.kind === "invitation"
    ? pending.items.find((item) => item.id === selected.id) ?? null
    : null;
  const selectedInvitationCode = selectedPending
    && invitationActions.confirmed?.id === selectedPending.id
    && invitationActions.confirmed.state === "pending"
    ? invitationActions.confirmed.code
    : null;

  const detail: CoachClientDetailView | null = selectedActive
    ? Object.freeze({
      id: selectedActive.id,
      isOpen: true,
      isBusy: disconnection.pending !== null,
      canClose: true,
      state: "active" as const,
      email: selectedActive.studentEmail,
      identity: Object.freeze({
        name: selectedActive.studentName.trim() || null,
        initials: initials(selectedActive.studentName),
      }),
      statusDescription: "Vínculo activo",
      facts: Object.freeze({
        linkedOnLabel: formatDate(selectedActive.linkedAt),
        lastTrainingLabel: null,
        sessionsLabel: null,
      }),
      cycle: null,
      actionLabel: "Desvincular alumno",
      canAct: disconnection.confirmed?.kind === "relationship"
        && disconnection.confirmed.endedAt === null
        && disconnection.pending === null,
      message: disconnection.issue ? Object.freeze({
        tone: "error" as const,
        label: "No pudimos completar la desvinculación.",
      }) : null,
    })
    : selectedPending
      ? Object.freeze({
        id: selectedPending.id,
        isOpen: true,
        isBusy: disconnection.pending !== null || invitationActions.pending !== null
          || detailDeliveryPendingInvitationId !== null,
        canClose: !invitationActionUnresolved,
        state: "pending" as const,
        email: selectedPending.recipientEmail,
        statusDescription: selectedPending.state === "expired" ? "Código vencido" : "Esperando aceptación",
        facts: Object.freeze({
          requestedOnLabel: formatDate(selectedPending.issuedAt),
          waitingLabel: selectedPending.state === "expired" ? "Vencida" : "Pendiente",
        }),
        code: Object.freeze({
          code: selectedInvitationCode,
          isBusy: invitationActions.pending !== null
            || detailDeliveryPendingInvitationId !== null,
          isCopied: copiedInvitationId === selectedPending.id,
          isResent: detailDelivery?.invitationId === selectedPending.id
            ? detailDelivery.state === "provider-accepted" : null,
          canCopy: selectedInvitationCode !== null,
          canShare: selectedInvitationCode !== null,
          canResend: invitationDetailAction !== null,
          resendLabel: invitationDetailAction === "reconcile"
            ? "Revisar estado"
            : invitationDetailAction === "retry"
              ? invitationActions.attempt?.action === "regenerate" ? "Reintentar generación" : "Reintentar reenvío"
              : invitationDetailAction === "regenerate" ? "Generar nuevo código" : "Reenviar código",
          canRetryDelivery: selectedInvitationCode !== null && deliveryRuntime !== null
            && detailDeliveryPendingInvitationId === null
            && !(detailDelivery?.invitationId === selectedPending.id
              && detailDelivery.state === "provider-accepted"),
          retryDeliveryLabel: "Reintentar entrega pendiente",
          deliveryLabel: detailDelivery?.invitationId === selectedPending.id
            ? detailDelivery.state === "provider-accepted"
              ? "Brevo aceptó los dos correos de esta operación."
              : "La entrega por correo sigue pendiente; el código no cambió."
            : null,
          expiryLabel: `Vence ${formatDate(selectedPending.expiresAt) ?? "próximamente"}`,
          hint: selectedInvitationCode === null
            ? "El código sólo está disponible mientras la invitación vigente está confirmada."
            : "Puedes copiarlo o compartirlo desde el selector seguro del dispositivo.",
          message: detailDelivery?.invitationId === selectedPending.id
            ? null
            : invitationActions.attempt?.resolution === "reserved"
            ? Object.freeze({
              tone: "polite" as const,
              label: "Operación registrada. La entrega del correo aún no está confirmada.",
            })
            : invitationActions.rateLimit !== null
              ? Object.freeze({ tone: "polite" as const, label: "La operación alcanzó un límite temporal. Reintenta cuando corresponda." })
              : invitationActions.needsRefresh
                ? Object.freeze({ tone: "polite" as const, label: "El resultado no está confirmado. Revisa su estado antes de cerrar." })
                : invitationActions.issue
                  ? Object.freeze({ tone: "error" as const, label: "No pudimos completar la operación." })
                  : null,
        }),
        actionLabel: "Cancelar solicitud",
        canAct: !invitationActionUnresolved
          && disconnection.confirmed?.kind === "invitation"
          && (disconnection.confirmed.state === "pending" || disconnection.confirmed.state === "expired")
          && disconnection.pending === null,
        message: disconnection.issue ? Object.freeze({
          tone: "error" as const,
          label: "No pudimos cancelar la solicitud.",
        }) : null,
      })
      : null;

  const confirmation: CoachClientUnlinkConfirmationView | null = detail
    && disconnection.confirmationOpen
    ? Object.freeze({
      id: detail.id,
      isOpen: true,
      isBusy: disconnection.pending !== null,
      canConfirm: selectionControllers?.disconnection.canConfirm() === true,
      state: detail.state,
      ...(detail.state === "active" ? {
        subjectLabel: detail.identity.name ?? detail.email,
      } : {}),
      message: disconnection.issue ? Object.freeze({
        tone: "error" as const,
        label: "No pudimos completar la operación.",
      }) : null,
    }) as CoachClientUnlinkConfirmationView
    : null;

  const creationAction = resolveCoachInvitationCreationAction(
    creation,
    creationController?.canSubmit() === true,
  );
  const invitationMessage = creation.attempt?.resolution === "reserved"
    ? Object.freeze({
      tone: "polite" as const,
      label: "Solicitud registrada. La entrega del correo aún no está confirmada.",
    })
    : creation.attempt?.resolution === "inactive"
      ? Object.freeze({ tone: "polite" as const, label: "La solicitud ya no está pendiente. Puedes cerrar e iniciar otra." })
      : creation.rateLimit !== null
        ? Object.freeze({ tone: "polite" as const, label: "La operación alcanzó un límite temporal. Reintenta cuando corresponda." })
        : creation.needsRefresh
          ? Object.freeze({ tone: "polite" as const, label: "El resultado no está confirmado. Revisa su estado antes de continuar." })
          : creation.issue
      ? Object.freeze({ tone: "error" as const, label: "No pudimos registrar la solicitud." })
      : null;
  const creationReceipt = creation.confirmed?.state === "pending"
    && creation.confirmed.code !== null
    && creation.attempt?.resolution === "reserved"
    && creation.attempt.operation?.requestId === creation.attempt.requestId
    ? Object.freeze({
      source: "server" as const,
      delivery: creationDelivery?.requestId === creation.attempt.requestId
        ? creationDelivery.state : "pending" as const,
      id: creation.confirmed.id,
      email: creation.confirmed.recipientEmail,
      code: creation.confirmed.code,
      headingLabel: "Código de vinculación creado",
      descriptionLabel: "La invitación queda pendiente hasta que el alumno ingrese el código.",
      deliveryLabel: creationDelivery?.requestId === creation.attempt.requestId
        && creationDelivery.state === "provider-accepted"
        ? "Brevo aceptó los correos para coach y alumno."
        : "La entrega por correo está pendiente; el código sigue vigente.",
      copyHint: "Cópialo o compártelo como respaldo. Nunca se agrega a la URL.",
      footerHint: `Vence ${formatDate(creation.confirmed.expiresAt) ?? "en 7 días"}.`,
      steps: Object.freeze([
        Object.freeze({ id: "account", label: "El alumno inicia sesión o crea su cuenta con el correo invitado." }),
        Object.freeze({ id: "profile", label: "Va a Perfil > Coaching e ingresa este código." }),
        Object.freeze({ id: "accept", label: "El vínculo se activa sólo tras su aceptación autenticada." }),
      ]) as CoachClientInstructionSteps,
      isCopied: copiedInvitationId === creation.confirmed.id,
      canCopy: true,
      canShare: true,
      canOpenPending: true,
    })
    : null;
  const addClientBase = {
    isOpen: creation.isOpen,
    isBusy: creation.pending !== null || detailDeliveryPendingInvitationId !== null,
    draft: Object.freeze({
      emailRaw: creationAction === "submit"
        ? creation.emailRaw
        : creation.attempt?.recipientEmail ?? creation.emailRaw,
      validation: Object.freeze({
        tone: creationAction !== "submit"
          ? "neutral" as const
          : creation.emailRaw === ""
            ? "neutral" as const
            : creation.emailValid ? "ok" as const : "err" as const,
        errorLabel: creationAction === "submit" && creation.emailRaw !== "" && !creation.emailValid
          ? "Revisa el correo ingresado."
          : null,
      }),
      canSubmit: creationAction !== null,
      action: creationAction,
      submitLabel: creationAction === "reconcile"
        ? "Revisar estado"
        : creationAction === "retry"
          ? "Reintentar solicitud"
          : "Registrar solicitud",
      busyLabel: creation.pending === "reconcile" ? "Revisando…" : "Registrando…",
      hint: creationAction === "reconcile" || creationAction === "retry"
        ? `La recuperación conserva la solicitud original para ${creation.attempt?.recipientEmail ?? "ese correo"}.`
        : "La reserva no confirma que el proveedor haya aceptado o entregado el correo.",
      steps: Object.freeze([
        Object.freeze({ id: "request", label: "Organizatech registra la solicitud para ese correo." }),
        Object.freeze({ id: "code", label: "El código vence a los 7 días." }),
        Object.freeze({ id: "accept", label: "El vínculo se activa sólo después de la aceptación del alumno." }),
      ]) as CoachClientInstructionSteps,
    }),
    message: creationReceipt ? null : invitationMessage,
  };
  const addClient: CoachAddClientView = creationReceipt
    ? Object.freeze({ ...addClientBase, step: "receipt" as const, receipt: creationReceipt })
    : Object.freeze({ ...addClientBase, step: "email" as const });

  const dashboardView = buildCoachDashboardView({
    coachName: input.coachName,
    now: new Date(),
    preferences,
    active,
    pending,
  });
  const clientsView = buildCoachClientsView({ tab, query, active, pending });
  const feeView = buildCoachFeeSheetView({
    preferences,
    canSave: base?.preferences.canSaveFee() === true,
    activeCount: active.totalActive,
    pendingCount: pending.totalPending,
  });

  async function refreshRelations() {
    await Promise.all([base?.active.reload(), base?.pending.reload()]);
  }

  function codeForInvitation(invitationId: string): { code: string; expiresAt: string } | null {
    const created = creationController?.getSnapshot().confirmed;
    if (created?.id === invitationId && created.state === "pending" && created.code) {
      return { code: created.code, expiresAt: created.expiresAt };
    }
    const current = selectionControllers?.actions?.getSnapshot().confirmed;
    if (current?.id === invitationId && current.state === "pending" && current.code) {
      return { code: current.code, expiresAt: current.expiresAt };
    }
    return null;
  }

  async function copyInvitationCode(invitationId: string) {
    const current = codeForInvitation(invitationId);
    if (!current || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(current.code);
      if (codeForInvitation(invitationId)?.code === current.code) setCopiedInvitationId(invitationId);
    } catch { /* The visible code remains available for manual copy. */ }
  }

  async function shareInvitationCode(invitationId: string) {
    const current = codeForInvitation(invitationId);
    if (!current || typeof navigator === "undefined") return;
    const expiry = formatDate(current.expiresAt) ?? "7 días";
    const text = `Código de vinculación Organizatech: ${current.code}. Vence ${expiry}. Inicia sesión con el correo invitado y ve a Perfil > Coaching para aceptarlo.`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "Código de vinculación Organizatech", text });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        if (codeForInvitation(invitationId)?.code === current.code) setCopiedInvitationId(invitationId);
      }
    } catch { /* User cancellation and unavailable share targets are non-destructive. */ }
  }

  return {
    available: base !== null,
    screen,
    tab,
    dashboardView,
    clientsView,
    feeView,
    chatView: Object.freeze({
      isOpen: preferences.chatOpen,
      isBusy: preferences.pending !== null,
      isRegistered: preferences.confirmed?.chatInterestRegistered ?? null,
      message: preferences.issue ? Object.freeze({
        tone: "error" as const,
        label: "No pudimos completar la operación.",
      }) : null,
    }),
    detail,
    confirmation,
    addClient,
    actions: {
      openDashboard: () => setScreen("dashboard"),
      openClients: (nextTab: CoachClientTab = "active") => {
        setTab(nextTab);
        setScreen("clients");
      },
      selectTab: setTab,
      loadMore: () => {
        if (tab === "active") void base?.active.loadNext();
        if (tab === "pending") void base?.pending.loadNext();
      },
      setQuery(raw: string) {
        setQuery(raw);
        base?.active.setQuery(raw);
        base?.pending.setQuery(raw);
        void Promise.all([base?.active.reload(), base?.pending.reload()]);
      },
      openClient(id: string) {
        if (active.items.some((item) => item.id === id)) {
          setSelected({ kind: "relationship", id });
          setTab("active");
          setScreen("clients");
          return true;
        } else if (pending.items.some((item) => item.id === id)) {
          setSelected({ kind: "invitation", id });
          return true;
        }
        return false;
      },
      closeClient: () => setSelected(null),
      openAddClient: () => creationController?.open(),
      closeAddClient: () => {
        const canStartAnotherIntent = creation.attempt?.phase === "resolved";
        const closed = creationController?.close() === true;
        if (closed && canStartAnotherIntent) setCreationEpoch((value) => value + 1);
      },
      setInvitationEmail: (raw: string) => creationController?.setEmail(raw),
      async submitInvitation() {
        const completed = creationAction === "reconcile"
          ? await creationController?.reconcile()
          : creationAction === "retry"
            ? await creationController?.retry()
            : creationAction === "submit"
              ? await creationController?.submit()
              : false;
        if (completed) {
          const resolved = creationController?.getSnapshot();
          const requestId = resolved?.attempt?.requestId;
          const invitationId = resolved?.confirmed?.id;
          if (requestId && invitationId && detailDeliveryPendingRef.current === null) {
            detailDeliveryPendingRef.current = invitationId;
            setDetailDeliveryPendingInvitationId(invitationId);
            setCreationDelivery({ requestId, state: "pending" });
            try {
              const state = await deliveryRuntime?.dispatch(requestId).catch(() => "pending" as const) ?? "pending";
              if (creationController?.getSnapshot().attempt?.requestId === requestId) {
                setCreationDelivery({ requestId, state });
              }
            } finally {
              if (detailDeliveryPendingRef.current === invitationId) {
                detailDeliveryPendingRef.current = null;
                setDetailDeliveryPendingInvitationId(null);
              }
            }
          }
          await base?.pending.reload();
        }
      },
      copyInvitationCode: (invitationId: string) => { void copyInvitationCode(invitationId); },
      shareInvitationCode: (invitationId: string) => { void shareInvitationCode(invitationId); },
      async retryInvitationDelivery(invitationId: string) {
        if (selectedRef.current?.kind !== "invitation" || selectedRef.current.id !== invitationId
          || detailDeliveryPendingRef.current !== null || invitationActions.pending !== null) return;
        detailDeliveryPendingRef.current = invitationId;
        setDetailDeliveryPendingInvitationId(invitationId);
        try {
          setDetailDelivery({ invitationId, requestId: null, state: "pending" });
          const state = await deliveryRuntime?.recoverInvitation(invitationId).catch(() => "pending" as const) ?? "pending";
          if (selectedRef.current?.kind === "invitation" && selectedRef.current.id === invitationId) {
            setDetailDelivery({ invitationId, requestId: null, state });
          }
        } finally {
          if (detailDeliveryPendingRef.current === invitationId) {
            detailDeliveryPendingRef.current = null;
            setDetailDeliveryPendingInvitationId(null);
          }
        }
      },
      openDisconnection: () => selectionControllers?.disconnection.openConfirmation(),
      closeDisconnection: () => selectionControllers?.disconnection.cancelConfirmation(),
      async confirmDisconnection() {
        const completed = await selectionControllers?.disconnection.confirm();
        if (completed) {
          setSelected(null);
          await refreshRelations();
        }
      },
      async resendOrRegenerate() {
        const controller = selectionControllers?.actions;
        const selectedInvitationId = selectedRef.current?.kind === "invitation" ? selectedRef.current.id : null;
        if (!controller || selectedInvitationId === null || detailDeliveryPendingRef.current !== null) return;
        detailDeliveryPendingRef.current = selectedInvitationId;
        setDetailDeliveryPendingInvitationId(selectedInvitationId);
        try {
          const completed = invitationDetailAction === "retry"
            ? await controller.retry()
            : invitationDetailAction === "reconcile"
              ? await controller.reconcile()
              : invitationDetailAction === "resend"
                ? await controller.resend()
                : invitationDetailAction === "regenerate"
                  ? await controller.regenerate()
                  : false;
          if (completed) {
            const resolved = controller.getSnapshot();
            const requestId = resolved.attempt?.requestId;
            const invitationId = resolved.attempt?.invitationId;
            if (requestId && invitationId) {
              setDetailDelivery({ invitationId, requestId, state: "pending" });
              const state = await deliveryRuntime?.dispatch(requestId).catch(() => "pending" as const) ?? "pending";
              if (selectedRef.current?.kind === "invitation" && selectedRef.current.id === invitationId) {
                setDetailDelivery({ invitationId, requestId, state });
              }
            }
            await base?.pending.reload();
          }
        } finally {
          if (detailDeliveryPendingRef.current === selectedInvitationId) {
            detailDeliveryPendingRef.current = null;
            setDetailDeliveryPendingInvitationId(null);
          }
        }
      },
      openFee: () => base?.preferences.openFee(),
      editFee: (raw: string) => base?.preferences.editFee(raw),
      cancelFee: () => base?.preferences.cancelFee(),
      saveFee: () => { void base?.preferences.saveFee(); },
      openChat: () => base?.preferences.openChat(),
      cancelChat: () => base?.preferences.cancelChat(),
      registerChat: () => { void base?.preferences.registerChatInterest(); },
    },
  };
}
