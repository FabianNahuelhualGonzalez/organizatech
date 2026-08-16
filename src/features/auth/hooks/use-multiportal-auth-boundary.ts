"use client";

import { useEffect, useRef } from "react";

import { createSupabaseMultiportalAuthGateway } from "@/features/auth/data/supabase-multiportal-auth-gateway";
import type {
  CoachRegistrationPreparationPayload,
  UserSignupPayload,
} from "@/features/auth/model/auth-form";
import type { AuthAccountType, AuthRouteState } from "@/features/auth/model/auth-route";
import {
  COACH_REGISTRATION_REQUIRED_MESSAGE,
  MULTIPORTAL_AUTH_ERROR_MESSAGE,
  USER_REGISTRATION_REQUIRED_MESSAGE,
  createMultiportalAuthController,
  type CoachRegistrationResult,
  type MultiportalAuthController,
  type PortalAccessResult,
  type PortalSignOutReason,
  type UserRegistrationResult,
} from "@/features/auth/model/multiportal-auth-controller";
import {
  createCoachRegistrationOwnerController,
  createPortalResolutionOwnerController,
  createSinglePublicationNoticeController,
  createUserRegistrationOwnerController,
  type CoachRegistrationOwner,
  type PortalResolutionOwner,
  type UserRegistrationOwner,
} from "@/features/auth/model/portal-resolution-owner";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SupabaseSessionState } from "@/lib/supabase/session";

export type PortalSessionEventDecision =
  | "continue"
  | "defer"
  | "hold_user_registration"
  | "hold_coach_registration"
  | "authorize_user"
  | "authorize_coach";

export type { CoachRegistrationOwner, PortalResolutionOwner, UserRegistrationOwner };

export function useMultiportalAuthBoundary(input: {
  initialRoute: AuthRouteState;
  currentRoute: AuthRouteState;
}) {
  const routeRef = useRef(input.currentRoute);
  routeRef.current = input.currentRoute;
  const controllerRef = useRef<MultiportalAuthController<SupabaseSessionState> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createMultiportalAuthController<SupabaseSessionState>();
  }
  const portalResolutionOwnersRef = useRef(createPortalResolutionOwnerController());
  const coachRegistrationOwnersRef = useRef(createCoachRegistrationOwnerController());
  const userRegistrationOwnersRef = useRef(createUserRegistrationOwnerController());
  const initialResolutionPendingRef = useRef(true);
  const signOutNoticeRef = useRef(createSinglePublicationNoticeController<PortalSignOutReason>());

  useEffect(() => {
    const controller = controllerRef.current;
    const portalResolutionOwners = portalResolutionOwnersRef.current;
    const coachRegistrationOwners = coachRegistrationOwnersRef.current;
    const userRegistrationOwners = userRegistrationOwnersRef.current;
    return () => {
      controller?.dispose();
      portalResolutionOwners.invalidate();
      coachRegistrationOwners.invalidate();
      userRegistrationOwners.invalidate();
    };
  }, []);

  function beginPortalResolution(expectedUserId: string): PortalResolutionOwner {
    return portalResolutionOwnersRef.current.begin(expectedUserId);
  }

  function endPortalResolution(owner: PortalResolutionOwner) {
    portalResolutionOwnersRef.current.end(owner);
  }

  function isPortalResolutionCurrent(owner: PortalResolutionOwner) {
    return portalResolutionOwnersRef.current.isCurrent(owner);
  }

  function beginCoachRegistrationSubmit(): CoachRegistrationOwner {
    return coachRegistrationOwnersRef.current.begin();
  }

  function endCoachRegistrationSubmit(owner: CoachRegistrationOwner) {
    coachRegistrationOwnersRef.current.end(owner);
  }

  function isCoachRegistrationSubmitCurrent(owner: CoachRegistrationOwner) {
    return coachRegistrationOwnersRef.current.isCurrent(owner);
  }

  function invalidateCoachRegistrationSubmits() {
    coachRegistrationOwnersRef.current.invalidate();
  }

  function beginUserRegistrationSubmit(): UserRegistrationOwner {
    return userRegistrationOwnersRef.current.begin();
  }

  function endUserRegistrationSubmit(owner: UserRegistrationOwner) {
    userRegistrationOwnersRef.current.end(owner);
  }

  function isUserRegistrationSubmitCurrent(owner: UserRegistrationOwner) {
    return userRegistrationOwnersRef.current.isCurrent(owner);
  }

  function invalidateUserRegistrationSubmits() {
    userRegistrationOwnersRef.current.invalidate();
  }

  function invalidatePortalOperations() {
    portalResolutionOwnersRef.current.invalidate();
    coachRegistrationOwnersRef.current.invalidate();
    userRegistrationOwnersRef.current.invalidate();
    initialResolutionPendingRef.current = false;
  }

  function resolveSessionEventDecision(
    event: string,
    currentUserId: string | null,
    deferForInteractiveAttempt = false,
  ): PortalSessionEventDecision {
    if (event === "SIGNED_OUT") {
      invalidatePortalOperations();
    } else if (currentUserId) {
      const replacedIdentity = portalResolutionOwnersRef.current.acceptIdentity(currentUserId);
      coachRegistrationOwnersRef.current.acceptIdentity(currentUserId);
      userRegistrationOwnersRef.current.acceptIdentity(currentUserId);
      if (replacedIdentity) {
        initialResolutionPendingRef.current = false;
      }
    }
    const isSessionEstablishingEvent = event === "SIGNED_IN" || event === "INITIAL_SESSION";
    if (!currentUserId || !isSessionEstablishingEvent) return "continue";
    if (
      deferForInteractiveAttempt
      || portalResolutionOwnersRef.current.hasPending()
      || initialResolutionPendingRef.current
    ) {
      return "defer";
    }

    const route = routeRef.current;
    if (route.mode === "registro") {
      return route.accountType === "coach"
        ? "hold_coach_registration"
        : "hold_user_registration";
    }
    return route.accountType === "coach" ? "authorize_coach" : "authorize_user";
  }

  function resolveInitialSessionDecision(currentUserId: string | null): PortalSessionEventDecision {
    if (!currentUserId) return "continue";
    portalResolutionOwnersRef.current.acceptIdentity(currentUserId);
    coachRegistrationOwnersRef.current.acceptIdentity(currentUserId);
    userRegistrationOwnersRef.current.acceptIdentity(currentUserId);
    if (input.initialRoute.mode === "registro") {
      return input.initialRoute.accountType === "coach"
        ? "hold_coach_registration"
        : "hold_user_registration";
    }
    return input.initialRoute.accountType === "coach" ? "authorize_coach" : "authorize_user";
  }

  function completeInitialResolution() {
    initialResolutionPendingRef.current = false;
  }

  async function resolvePortalAccess(
    authState: SupabaseSessionState,
    requestedPortal: AuthAccountType,
    owner: PortalResolutionOwner,
  ): Promise<PortalAccessResult> {
    const supabase = getSupabaseBrowserClient();
    const expectedUserId = authState.session?.user.id;
    if (
      !expectedUserId
      || owner.expectedUserId !== expectedUserId
      || !owner.isCurrent()
    ) {
      return { state: "stale", requestedPortal };
    }
    if (!supabase) return controlledPortalError(requestedPortal);
    return controllerRef.current!.resolvePortalAccess(
      { requestedPortal, expectedUserId, owner },
      createGateway(supabase),
    );
  }

  async function registerCoach(
    payload: CoachRegistrationPreparationPayload,
    owner: CoachRegistrationOwner,
  ): Promise<CoachRegistrationResult<SupabaseSessionState>> {
    if (!owner.isCurrent()) return { state: "stale", requestedPortal: "coach" };
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return {
        state: "error",
        requestedPortal: "coach",
        message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
      };
    }
    return controllerRef.current!.registerCoach(payload, owner, createGateway(supabase));
  }

  async function registerUser(
    payload: UserSignupPayload,
    owner: UserRegistrationOwner,
  ): Promise<UserRegistrationResult<SupabaseSessionState>> {
    if (!owner.isCurrent()) return { state: "stale", requestedPortal: "usuario" };
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return {
        state: "error",
        requestedPortal: "usuario",
        message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
      };
    }
    return controllerRef.current!.registerUser(payload, owner, createGateway(supabase));
  }

  function createGateway(
    supabase: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>,
  ) {
    return createSupabaseMultiportalAuthGateway(supabase, {
      onBeforeSignOut(reason) {
        signOutNoticeRef.current.begin(reason);
      },
      onSignOutError() {
        signOutNoticeRef.current.fail();
      },
    });
  }

  function consumePortalSignOutMessage(): string | null {
    return mapPortalSignOutReason(signOutNoticeRef.current.consumeEvent());
  }

  function settlePortalSignOutMessage(fallbackMessage: string): string | null {
    const hasNotice = signOutNoticeRef.current.hasNotice();
    const failedReason = signOutNoticeRef.current.settle();
    return hasNotice ? (failedReason ? fallbackMessage : null) : fallbackMessage;
  }

  function clearPortalSignOutReason() {
    signOutNoticeRef.current.clear();
  }

  return {
    beginPortalResolution,
    endPortalResolution,
    isPortalResolutionCurrent,
    beginCoachRegistrationSubmit,
    endCoachRegistrationSubmit,
    isCoachRegistrationSubmitCurrent,
    invalidateCoachRegistrationSubmits,
    beginUserRegistrationSubmit,
    endUserRegistrationSubmit,
    isUserRegistrationSubmitCurrent,
    invalidateUserRegistrationSubmits,
    invalidatePortalOperations,
    resolveSessionEventDecision,
    resolveInitialSessionDecision,
    completeInitialResolution,
    resolvePortalAccess,
    registerCoach,
    registerUser,
    consumePortalSignOutMessage,
    settlePortalSignOutMessage,
    clearPortalSignOutReason,
  };
}

function mapPortalSignOutReason(reason: PortalSignOutReason | null): string | null {
  if (!reason) return null;
  if (reason === "user_registration_required") return USER_REGISTRATION_REQUIRED_MESSAGE;
  if (reason === "coach_registration_required") return COACH_REGISTRATION_REQUIRED_MESSAGE;
  return MULTIPORTAL_AUTH_ERROR_MESSAGE;
}

function controlledPortalError(requestedPortal: AuthAccountType): PortalAccessResult {
  return {
    state: "error",
    requestedPortal,
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  };
}

export type MultiportalAuthBoundary = ReturnType<typeof useMultiportalAuthBoundary>;
