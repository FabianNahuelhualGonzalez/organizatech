"use client";

import { useEffect, useRef } from "react";

import { createSupabaseMultiportalAuthGateway } from "@/features/auth/data/supabase-multiportal-auth-gateway";
import type {
  CoachRegistrationSubmission,
  UserSignupPayload,
} from "@/features/auth/model/auth-form";
import type { AuthAccountType, AuthRouteState } from "@/features/auth/model/auth-route";
import {
  createPasswordRecoveryPortalGuard,
  type PasswordRecoveryPortalGuard,
  type PasswordRecoveryPortalMountPermit,
} from "@/features/auth/model/password-recovery-portal-guard";
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
  type SharedCoachLoginCompletionResult,
  type SharedCoachRegistrationPreparationResult,
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
  | "complete_signup_confirmation"
  | "hold_user_registration"
  | "hold_coach_registration"
  | "authorize_user"
  | "authorize_coach";

export type { CoachRegistrationOwner, PortalResolutionOwner, UserRegistrationOwner };

export function useMultiportalAuthBoundary(input: {
  initialRoute: AuthRouteState;
  currentRoute: AuthRouteState;
  initialPasswordRecoveryActive?: boolean;
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
  const passwordRecoveryPortalGuardRef = useRef<PasswordRecoveryPortalGuard | null>(null);
  if (!passwordRecoveryPortalGuardRef.current) {
    passwordRecoveryPortalGuardRef.current = createPasswordRecoveryPortalGuard(
      input.initialPasswordRecoveryActive,
    );
  }
  const passwordRecoveryMountPermitsRef = useRef(
    new WeakMap<PortalResolutionOwner, PasswordRecoveryPortalMountPermit>(),
  );
  const currentUserIdRef = useRef<string | null>(null);
  const signupConfirmationRef = useRef<SignupConfirmationPending | null>(null);
  const sharedCoachLoginRef = useRef<SharedCoachLoginPending | null>(null);
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
      passwordRecoveryPortalGuardRef.current?.release();
      settleSignupConfirmation("stale");
    };
  }, []);

  function beginPortalResolution(expectedUserId: string): PortalResolutionOwner {
    currentUserIdRef.current = expectedUserId;
    portalResolutionOwnersRef.current.acceptIdentity(expectedUserId);
    const owner = portalResolutionOwnersRef.current.begin(expectedUserId);
    passwordRecoveryMountPermitsRef.current.set(
      owner,
      passwordRecoveryPortalGuardRef.current!.capturePortalMountPermit(),
    );
    return owner;
  }

  function endPortalResolution(owner: PortalResolutionOwner) {
    portalResolutionOwnersRef.current.end(owner);
    passwordRecoveryMountPermitsRef.current.delete(owner);
  }

  function isPortalResolutionCurrent(owner: PortalResolutionOwner) {
    return portalResolutionOwnersRef.current.isCurrent(owner)
      && passwordRecoveryMountPermitsRef.current.get(owner)?.isCurrent() === true;
  }

  function beginCoachRegistrationSubmit(
    flow: CoachRegistrationSubmission["flow"],
  ): CoachRegistrationOwner {
    return coachRegistrationOwnersRef.current.begin({
      independentIdentity: flow === "separate",
    });
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

  function beginPasswordRecoveryPortalGuard() {
    const becameActive = passwordRecoveryPortalGuardRef.current!.begin();
    invalidatePortalOperations();
    return becameActive;
  }

  function releasePasswordRecoveryPortalGuard() {
    return passwordRecoveryPortalGuardRef.current!.release();
  }

  function isPasswordRecoveryPortalBlocked() {
    return passwordRecoveryPortalGuardRef.current!.isBlocked();
  }

  function signOutPasswordRecoveryLocally() {
    return passwordRecoveryPortalGuardRef.current!.runLocalSignOut(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return { error: null };
      const { error } = await supabase.auth.signOut({ scope: "local" });
      return { error };
    });
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
    if (event !== "SIGNED_OUT" && isPasswordRecoveryPortalBlocked()) {
      return "defer";
    }
    if (event === "SIGNED_OUT") {
      const pendingSignupConfirmation = signupConfirmationRef.current;
      invalidatePortalOperations();
      currentUserIdRef.current = null;
      if (pendingSignupConfirmation && settleSignupConfirmation("signed_out")) {
        return "complete_signup_confirmation";
      }
    } else if (currentUserId) {
      currentUserIdRef.current = currentUserId;
      const replacedIdentity = portalResolutionOwnersRef.current.acceptIdentity(currentUserId);
      coachRegistrationOwnersRef.current.acceptIdentity(currentUserId);
      userRegistrationOwnersRef.current.acceptIdentity(currentUserId);
      signupConfirmationOwnersRef.current.acceptIdentity(currentUserId);
      if (replacedIdentity) {
        initialResolutionPendingRef.current = false;
      }
    }
    const isSessionEstablishingEvent = event === "SIGNED_IN"
      || event === "INITIAL_SESSION"
      || event === "TOKEN_REFRESHED";
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
    if (isPasswordRecoveryPortalBlocked()) return "defer";
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
      || !isPortalResolutionCurrent(owner)
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
    payload: CoachRegistrationSubmission,
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

  async function prepareSharedCoachRegistration(
    expectedUserId?: string,
  ): Promise<SharedCoachRegistrationPreparationResult<SupabaseSessionState>> {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return { state: "sign_in_required" };
    if (expectedUserId) coachRegistrationOwnersRef.current.acceptIdentity(expectedUserId);
    const owner = coachRegistrationOwnersRef.current.begin();
    try {
      return await controllerRef.current!.prepareSharedCoachRegistration(
        expectedUserId,
        owner,
        createGateway(supabase),
      );
    } finally {
      coachRegistrationOwnersRef.current.end(owner);
    }
  }

  function completeSharedCoachLogin(
    expectedUserId: string,
  ): Promise<SharedCoachLoginCompletionResult<SupabaseSessionState>> {
    const existing = sharedCoachLoginRef.current;
    if (existing?.expectedUserId === expectedUserId) return existing.operation;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return Promise.resolve({
        state: "error",
        message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
      });
    }

    coachRegistrationOwnersRef.current.acceptIdentity(expectedUserId);
    const owner = coachRegistrationOwnersRef.current.begin();
    const operation = controllerRef.current!.completeSharedCoachLogin(
      expectedUserId,
      owner,
      createGateway(supabase),
    ).finally(() => {
      coachRegistrationOwnersRef.current.end(owner);
      if (sharedCoachLoginRef.current?.owner === owner) sharedCoachLoginRef.current = null;
    });
    const pending = { expectedUserId, owner, operation };
    sharedCoachLoginRef.current = pending;
    return operation;
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
    beginPasswordRecoveryPortalGuard,
    releasePasswordRecoveryPortalGuard,
    isPasswordRecoveryPortalBlocked,
    signOutPasswordRecoveryLocally,
    resolveSessionEventDecision,
    resolveInitialSessionDecision,
    completeInitialResolution,
    resolvePortalAccess,
    prepareSharedCoachRegistration,
    completeSharedCoachLogin,
    registerCoach,
    registerUser,
    completeSignupConfirmation,
    consumeSignupConfirmationResult,
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

interface SharedCoachLoginPending {
  expectedUserId: string;
  owner: CoachRegistrationOwner;
  operation: Promise<SharedCoachLoginCompletionResult<SupabaseSessionState>>;
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
