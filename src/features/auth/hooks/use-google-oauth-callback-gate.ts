"use client";

import { useEffect, useRef, useState } from "react";

import {
  completeGoogleOAuth,
  isGoogleOAuthStaleOperationError,
  startGoogleOAuth,
  type GoogleOAuthOperationGuard,
  type GoogleOAuthPendingOperation,
} from "@/features/auth/data/google-oauth-gateway";
import {
  buildGoogleUserRegistrationPayload,
  buildSharedCoachRegistrationPayload,
  type AuthFieldName,
} from "@/features/auth/model/auth-form";
import {
  createGoogleOAuthOperationOwnerController,
  createGoogleOAuthSingleFlight,
  createGoogleOAuthStartController,
  transferGoogleOAuthAndNavigate,
  type GoogleOAuthOperationOwner,
} from "@/features/auth/model/google-oauth-operation-owner";
import {
  parseGoogleOAuthCallback,
  type GoogleOAuthIntent,
} from "@/features/auth/model/google-oauth-intent";
import type { AuthAccountType, AuthMode } from "@/features/auth/model/auth-route";
import { MULTIPORTAL_AUTH_ERROR_MESSAGE } from "@/features/auth/model/multiportal-auth-controller";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type GoogleOAuthBoundaryState = {
  readonly state: "checking" | "ready";
  readonly intent: GoogleOAuthIntent | null;
  readonly registrationPending: boolean;
  readonly isBusy: boolean;
  readonly message: string;
  readonly statusTone: "error" | "info";
};

export type GoogleOAuthRegistrationResult =
  | { readonly state: "submitted" | "stale" }
  | { readonly state: "field_error"; readonly field: AuthFieldName; readonly message: string }
  | { readonly state: "error"; readonly message: string };

export interface GoogleOAuthFormRevisionGuard {
  isCurrent(): boolean;
}

export interface GoogleOAuthBoundary extends GoogleOAuthBoundaryState {
  start(input: { mode: AuthMode; portal: AuthAccountType }): Promise<void>;
  submitRegistration(
    formData: FormData,
    formGuard: GoogleOAuthFormRevisionGuard,
  ): Promise<GoogleOAuthRegistrationResult>;
  cancelRegistration(): void;
}

const READY_STATE: GoogleOAuthBoundaryState = {
  state: "ready",
  intent: null,
  registrationPending: false,
  isBusy: false,
  message: "",
  statusTone: "info",
};

export function useGoogleOAuthCallbackGate(): GoogleOAuthBoundary {
  const [state, setState] = useState<GoogleOAuthBoundaryState>(() => {
    if (typeof window === "undefined") return { ...READY_STATE, state: "checking" };
    return parseGoogleOAuthCallback(window.location)
      ? { ...READY_STATE, state: "checking" }
      : READY_STATE;
  });
  const ownerControllerRef = useRef(createGoogleOAuthOperationOwnerController());
  const pendingOperationRef = useRef<GoogleOAuthPendingOperation | null>(null);
  const pendingOwnerRef = useRef<GoogleOAuthOperationOwner | null>(null);
  const expectedLocationRef = useRef<string | null>(null);
  const callbackAttemptRef = useRef<{
    flightKey: string;
    callbackLocation: string;
    owner: GoogleOAuthOperationOwner;
    flight: Promise<GoogleOAuthPendingOperation>;
    handlingStarted: boolean;
  } | null>(null);
  const startControllerRef = useRef(createGoogleOAuthStartController());
  const submitFlightRef = useRef(createGoogleOAuthSingleFlight());

  useEffect(() => {
    const ownerController = ownerControllerRef.current;
    ownerController.mount();
    const callback = parseGoogleOAuthCallback(window.location);
    const principal = getSupabaseBrowserClient();
    const subscription = principal?.auth.onAuthStateChange((_event, session) => {
      ownerController.acceptPrincipalIdentity(session?.user.id ?? null);
    });

    if (!callback) {
      setState((current) => current.state === "checking" ? READY_STATE : current);
      return () => {
        subscription?.data.subscription.unsubscribe();
        ownerController.scheduleUnmount();
      };
    }
    if (callback.invalid || !principal) {
      window.history.replaceState(null, "", "/login");
      setState({ ...READY_STATE, message: MULTIPORTAL_AUTH_ERROR_MESSAGE, statusTone: "error" });
      return () => {
        subscription?.data.subscription.unsubscribe();
        ownerController.scheduleUnmount();
      };
    }

    const flightKey = `${callback.intentId}:${callback.code}`;
    let attempt = callbackAttemptRef.current;
    if (!attempt || attempt.flightKey !== flightKey) {
      const owner = ownerController.begin();
      const callbackLocation = currentLocationKey();
      const callbackGuard: GoogleOAuthOperationGuard = {
        isCurrent: () => owner.isCurrent() && currentLocationKey() === callbackLocation,
      };
      attempt = {
        flightKey,
        callbackLocation,
        owner,
        flight: completeGoogleOAuth({
          code: callback.code,
          intentId: callback.intentId,
          storage: window.sessionStorage,
          guard: callbackGuard,
        }),
        handlingStarted: false,
      };
      callbackAttemptRef.current = attempt;
    }
    const { owner, callbackLocation, flight } = attempt;
    const callbackGuard: GoogleOAuthOperationGuard = {
      isCurrent: () => owner.isCurrent() && currentLocationKey() === callbackLocation,
    };
    if (!attempt.handlingStarted) {
      attempt.handlingStarted = true;
      void flight.then(async (operation) => {
        if (!callbackGuard.isCurrent() || !owner.bindExpectedUserId(operation.userId)) return;
        await operation.assertPrincipalAvailable(principal, callbackGuard);
        if (!callbackGuard.isCurrent()) return;

        if (operation.intent.mode === "login") {
          await transferGoogleOAuthAndNavigate({
            transfer: () => operation.transferToPrincipal(principal, callbackGuard),
            guard: callbackGuard,
            navigate: () => window.location.replace(cleanLoginUrl(operation.intent.portal)),
          });
          return;
        }

        const cleanRegistrationLocation = cleanRegistrationUrl(operation.intent.portal);
        window.history.replaceState(null, "", cleanRegistrationLocation);
        if (!owner.isCurrent()) return;
        expectedLocationRef.current = currentLocationKey();
        pendingOwnerRef.current = owner;
        pendingOperationRef.current = operation;
        setState({
          state: "ready",
          intent: operation.intent,
          registrationPending: true,
          isBusy: false,
          message: "",
          statusTone: "info",
        });
      }).catch((error) => {
        if (isGoogleOAuthStaleOperationError(error) || !owner.isCurrent()) return;
        window.history.replaceState(null, "", "/login");
        setState({ ...READY_STATE, message: MULTIPORTAL_AUTH_ERROR_MESSAGE, statusTone: "error" });
      });
    }

    return () => {
      subscription?.data.subscription.unsubscribe();
      ownerController.scheduleUnmount();
    };
  }, []);

  function resetPendingRegistration() {
    ownerControllerRef.current.invalidate();
    pendingOperationRef.current = null;
    pendingOwnerRef.current = null;
    expectedLocationRef.current = null;
    callbackAttemptRef.current = null;
    submitFlightRef.current.clear();
    setState(READY_STATE);
  }

  function cancelRegistration() {
    resetPendingRegistration();
  }

  function start(input: { mode: AuthMode; portal: AuthAccountType }) {
    return startControllerRef.current.start(`${input.mode}:${input.portal}`, async () => {
      resetPendingRegistration();
      const owner = ownerControllerRef.current.begin();
      setState({ ...READY_STATE, isBusy: true });
      try {
        await startGoogleOAuth(input);
      } catch (error) {
        if (!owner.isCurrent()) return;
        setState({
          ...READY_STATE,
          message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
          statusTone: "error",
        });
        if (isGoogleOAuthStaleOperationError(error)) return;
      }
    });
  }

  async function submitRegistration(
    formData: FormData,
    formGuard: GoogleOAuthFormRevisionGuard,
  ): Promise<GoogleOAuthRegistrationResult> {
    const operation = pendingOperationRef.current;
    const owner = pendingOwnerRef.current;
    if (!operation || !owner || !isPendingRegistrationCurrent(operation, owner)) {
      return { state: "stale" };
    }
    let executeRegistration: (guard: GoogleOAuthOperationGuard) => Promise<void>;
    if (operation.intent.portal === "coach") {
      const preparation = buildSharedCoachRegistrationPayload(formData);
      if (!preparation.ok) {
        return { state: "field_error", field: preparation.field, message: preparation.message };
      }
      executeRegistration = (guard) => operation.registerCoach(preparation.payload, guard);
    } else {
      const preparation = buildGoogleUserRegistrationPayload(formData);
      if (!preparation.ok) {
        return { state: "field_error", field: preparation.field, message: preparation.message };
      }
      executeRegistration = (guard) => operation.registerUser(preparation.payload, guard);
    }

    const combinedGuard: GoogleOAuthOperationGuard = {
      isCurrent: () => formGuard.isCurrent() && isPendingRegistrationCurrent(operation, owner),
    };
    setState((current) => ({ ...current, isBusy: true, message: "", statusTone: "info" }));

    return submitFlightRef.current.run(`${operation.intent.id}:${operation.userId}`, async () => {
      try {
        await executeRegistration(combinedGuard);
        if (!combinedGuard.isCurrent()) return { state: "stale" } as const;
        const principal = getSupabaseBrowserClient();
        if (!principal) throw new Error("Supabase is not configured.");
        const navigated = await transferGoogleOAuthAndNavigate({
          transfer: () => operation.transferToPrincipal(principal, combinedGuard),
          guard: combinedGuard,
          navigate: () => window.location.replace(cleanLoginUrl(operation.intent.portal)),
        });
        if (!navigated) return { state: "stale" } as const;
        return { state: "submitted" } as const;
      } catch (error) {
        if (isGoogleOAuthStaleOperationError(error) || !owner.isCurrent()) {
          return { state: "stale" } as const;
        }
        const message = MULTIPORTAL_AUTH_ERROR_MESSAGE;
        setState((current) => ({ ...current, isBusy: false, message, statusTone: "error" }));
        return { state: "error", message } as const;
      } finally {
        if (owner.isCurrent()) {
          setState((current) => ({ ...current, isBusy: false }));
        }
      }
    });
  }

  function isPendingRegistrationCurrent(
    operation: GoogleOAuthPendingOperation,
    owner: GoogleOAuthOperationOwner,
  ) {
    return owner.isCurrent()
      && owner.expectedUserId === operation.userId
      && pendingOperationRef.current === operation
      && pendingOwnerRef.current === owner
      && expectedLocationRef.current !== null
      && currentLocationKey() === expectedLocationRef.current;
  }

  return {
    ...state,
    start,
    submitRegistration,
    cancelRegistration,
  };
}

function currentLocationKey() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function cleanRegistrationUrl(portal: AuthAccountType) {
  return `/login?mode=registro&tipo=${portal}`;
}

function cleanLoginUrl(portal: AuthAccountType) {
  return `/login?mode=login&tipo=${portal}`;
}
