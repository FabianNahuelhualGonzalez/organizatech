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
  SIGNUP_CONFIRMATION_INVALID_MESSAGE,
  USER_REGISTRATION_REQUIRED_MESSAGE,
  createMultiportalAuthController,
  type CoachRegistrationResult,
  type MultiportalAuthController,
  type PortalAccessResult,
  type PortalSignOutReason,
  type PortalSignOutResult,
  type SignupConfirmationResult,
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
  | "complete_coach_identity_switch"
  | "complete_signup_confirmation"
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
  const signupConfirmationOwnersRef = useRef(createPortalResolutionOwnerController());
  const currentUserIdRef = useRef<string | null>(null);
  const blockedCoachIdentityUserIdRef = useRef<string | null>(null);
  const coachIdentitySwitchRef = useRef<CoachIdentitySwitchPending | null>(null);
  const signupConfirmationRef = useRef<SignupConfirmationPending | null>(null);
  const initialResolutionPendingRef = useRef(true);
  const signOutNoticeRef = useRef(createSinglePublicationNoticeController<PortalSignOutReason>());
  const signupConfirmationNoticeRef = useRef(
    createSinglePublicationNoticeController<PublishableSignupConfirmationResult>(),
  );

  useEffect(() => {
    const controller = controllerRef.current;
    const portalResolutionOwners = portalResolutionOwnersRef.current;
    const coachRegistrationOwners = coachRegistrationOwnersRef.current;
    const userRegistrationOwners = userRegistrationOwnersRef.current;
    const signupConfirmationOwners = signupConfirmationOwnersRef.current;
    return () => {
      controller?.dispose();
      portalResolutionOwners.invalidate();
      coachRegistrationOwners.invalidate();
      userRegistrationOwners.invalidate();
      signupConfirmationOwners.invalidate();
      settleCoachIdentitySwitch("stale");
      settleSignupConfirmation("stale");
    };
  }, []);

  function beginPortalResolution(expectedUserId: string): PortalResolutionOwner {
    blockedCoachIdentityUserIdRef.current = null;
    currentUserIdRef.current = expectedUserId;
    portalResolutionOwnersRef.current.acceptIdentity(expectedUserId);
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
    signupConfirmationOwnersRef.current.invalidate();
    initialResolutionPendingRef.current = false;
  }

  function settleCoachIdentitySwitch(result: PortalSignOutResult): boolean {
    const pending = coachIdentitySwitchRef.current;
    if (!pending || pending.settled) return false;
    pending.settled = true;
    pending.resolveEvent(result);
    return true;
  }

  function settleSignupConfirmation(result: PortalSignOutResult): boolean {
    const pending = signupConfirmationRef.current;
    if (!pending || pending.settled) return false;
    pending.settled = true;
    pending.resolveEvent(result);
    return true;
  }

  function resolveSessionEventDecision(
    event: string,
    currentUserId: string | null,
    deferForInteractiveAttempt = false,
  ): PortalSessionEventDecision {
    if (event === "SIGNED_OUT") {
      const pendingIdentitySwitch = coachIdentitySwitchRef.current;
      const pendingSignupConfirmation = signupConfirmationRef.current;
      invalidatePortalOperations();
      currentUserIdRef.current = null;
      if (pendingSignupConfirmation && settleSignupConfirmation("signed_out")) {
        return "complete_signup_confirmation";
      }
      if (pendingIdentitySwitch && settleCoachIdentitySwitch("signed_out")) {
        blockedCoachIdentityUserIdRef.current = pendingIdentitySwitch.expectedUserId;
        return "complete_coach_identity_switch";
      }
    } else if (currentUserId) {
      if (blockedCoachIdentityUserIdRef.current === currentUserId) {
        return "defer";
      }
      blockedCoachIdentityUserIdRef.current = null;
      currentUserIdRef.current = currentUserId;
      const replacedIdentity = portalResolutionOwnersRef.current.acceptIdentity(currentUserId);
      coachRegistrationOwnersRef.current.acceptIdentity(currentUserId);
      userRegistrationOwnersRef.current.acceptIdentity(currentUserId);
      signupConfirmationOwnersRef.current.acceptIdentity(currentUserId);
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
    currentUserIdRef.current = currentUserId;
    portalResolutionOwnersRef.current.acceptIdentity(currentUserId);
    coachRegistrationOwnersRef.current.acceptIdentity(currentUserId);
    userRegistrationOwnersRef.current.acceptIdentity(currentUserId);
    signupConfirmationOwnersRef.current.acceptIdentity(currentUserId);
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

  function completeSignupConfirmation(
    authState: SupabaseSessionState,
    forceInvalid = false,
  ): Promise<PortalSignOutResult> {
    const expectedUserId = authState.session?.user.id ?? null;
    if (!expectedUserId) return Promise.resolve("stale");

    const existing = signupConfirmationRef.current;
    if (existing?.operation && existing.expectedUserId === expectedUserId) {
      return existing.operation;
    }
    if (existing && existing.expectedUserId !== expectedUserId) {
      settleSignupConfirmation("stale");
      signupConfirmationRef.current = null;
    }

    signupConfirmationOwnersRef.current.acceptIdentity(expectedUserId);
    const owner = signupConfirmationOwnersRef.current.begin(expectedUserId);
    if (!owner.isCurrent()) return Promise.resolve("stale");

    const pending = createSignupConfirmationPending(expectedUserId);
    signupConfirmationRef.current = pending;
    const operation = (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        if (!supabase || !owner.isCurrent()) {
          settleSignupConfirmation("stale");
          return await pending.event;
        }
        const gateway = createGateway(supabase);
        const resolution: SignupConfirmationResult = forceInvalid
          ? {
            state: "invalid",
            requestedPortal: "usuario",
            message: SIGNUP_CONFIRMATION_INVALID_MESSAGE,
          }
          : await controllerRef.current!.resolveSignupConfirmation(
            { expectedUserId, owner },
            gateway,
          );
        if (!owner.isCurrent() || resolution.state === "stale") {
          settleSignupConfirmation("stale");
          return await pending.event;
        }

        signupConfirmationNoticeRef.current.begin(resolution);
        const signOutResult = await gateway.signOutAfterSignupConfirmation(
          expectedUserId,
          owner,
        );
        if (signOutResult === "stale") {
          signupConfirmationNoticeRef.current.clear();
          settleSignupConfirmation("stale");
        }
        const eventResult = await pending.event;
        signupConfirmationNoticeRef.current.settle();
        return eventResult;
      } catch (error) {
        signupConfirmationNoticeRef.current.fail();
        signupConfirmationNoticeRef.current.settle();
        settleSignupConfirmation("stale");
        throw error;
      } finally {
        signupConfirmationOwnersRef.current.end(owner);
        if (signupConfirmationRef.current === pending) {
          signupConfirmationRef.current = null;
        }
      }
    })();
    pending.operation = operation;
    return operation;
  }

  function consumeSignupConfirmationResult(): PublishableSignupConfirmationResult | null {
    return signupConfirmationNoticeRef.current.consumeEvent();
  }

  function signOutForCoachIdentitySwitch(requestedEmail: string): Promise<PortalSignOutResult> {
    const existingSwitch = coachIdentitySwitchRef.current;
    if (existingSwitch?.operation) return existingSwitch.operation;

    const expectedUserId = currentUserIdRef.current;
    if (!expectedUserId) return Promise.resolve("stale");

    invalidatePortalOperations();
    portalResolutionOwnersRef.current.acceptIdentity(expectedUserId);
    const owner = portalResolutionOwnersRef.current.begin(expectedUserId);
    if (!owner.isCurrent()) return Promise.resolve("stale");

    const pending = createCoachIdentitySwitchPending(expectedUserId);
    coachIdentitySwitchRef.current = pending;
    const operation = (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          settleCoachIdentitySwitch("stale");
          return await pending.event;
        }
        const signOutResult = await createGateway(supabase)
          .signOutForCoachIdentitySwitch(requestedEmail, owner);
        if (signOutResult === "stale") settleCoachIdentitySwitch("stale");
        return await pending.event;
      } catch (error) {
        settleCoachIdentitySwitch("stale");
        throw error;
      } finally {
        portalResolutionOwnersRef.current.end(owner);
        if (coachIdentitySwitchRef.current === pending) {
          coachIdentitySwitchRef.current = null;
        }
      }
    })();
    pending.operation = operation;
    return operation;
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
    completeSignupConfirmation,
    consumeSignupConfirmationResult,
    signOutForCoachIdentitySwitch,
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

interface CoachIdentitySwitchPending {
  expectedUserId: string;
  event: Promise<PortalSignOutResult>;
  resolveEvent(result: PortalSignOutResult): void;
  operation: Promise<PortalSignOutResult> | null;
  settled: boolean;
}

type PublishableSignupConfirmationResult = Exclude<
  SignupConfirmationResult,
  { state: "stale" }
>;

interface SignupConfirmationPending {
  expectedUserId: string;
  event: Promise<PortalSignOutResult>;
  resolveEvent(result: PortalSignOutResult): void;
  operation: Promise<PortalSignOutResult> | null;
  settled: boolean;
}

function createCoachIdentitySwitchPending(expectedUserId: string): CoachIdentitySwitchPending {
  let resolveEvent!: (result: PortalSignOutResult) => void;
  const event = new Promise<PortalSignOutResult>((resolve) => {
    resolveEvent = resolve;
  });
  return {
    expectedUserId,
    event,
    resolveEvent,
    operation: null,
    settled: false,
  };
}

function createSignupConfirmationPending(expectedUserId: string): SignupConfirmationPending {
  let resolveEvent!: (result: PortalSignOutResult) => void;
  const event = new Promise<PortalSignOutResult>((resolve) => {
    resolveEvent = resolve;
  });
  return {
    expectedUserId,
    event,
    resolveEvent,
    operation: null,
    settled: false,
  };
}
