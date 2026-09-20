"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CoachLinkingRepositoryError,
  coachLinkingRepository,
  type CoachLinkingRepository,
} from "../data/coach-linking-repository";
import {
  clearCoachLinkEntry,
  isCompleteCoachLinkCode,
  normalizeCoachLinkCode,
  persistCoachLinkEntry,
  type CoachLinkActiveState,
  type CoachLinkStoredEntry,
  type CoachLinkLookupStatus,
} from "../model/coach-linking";

export interface CoachLinkingSnapshot {
  readonly activeState: CoachLinkActiveState;
  readonly activeStateIdentityKey: string | null;
  readonly cardMode: "closed" | "form";
  readonly code: string;
  readonly lookupStatus: CoachLinkLookupStatus;
  readonly coachName: string | null;
  readonly confirmation: null | {
    readonly code: string;
    readonly coachName: string;
    readonly requestId: string;
  };
  readonly accepting: boolean;
  readonly confirmationError: "network" | "ya_tiene_coach" | null;
  readonly success: null | { readonly kind: "new" | "recovered"; readonly coachName: string };
  readonly authGateOpen: boolean;
}

export interface CoachLinkingController {
  readonly snapshot: CoachLinkingSnapshot;
  readonly actions: {
    openForm(): void;
    closeForm(): void;
    setCode(value: string): void;
    lookup(): Promise<"confirmation" | "success" | null>;
    retryLookup(): Promise<"confirmation" | "success" | null>;
    accept(): Promise<"success" | null>;
    retryAccept(): Promise<"success" | null>;
    cancelConfirmation(): void;
    settleSuccess(): void;
    continueFromGate(): void;
  };
}

function recoverPendingEmails(repository: CoachLinkingRepository, identityKey: string) {
  void repository.dispatchPendingEmails(identityKey).catch(() => undefined);
}

const EMPTY: CoachLinkingSnapshot = {
  activeState: "loading",
  activeStateIdentityKey: null,
  cardMode: "closed",
  code: "",
  lookupStatus: "idle",
  coachName: null,
  confirmation: null,
  accepting: false,
  confirmationError: null,
  success: null,
  authGateOpen: false,
};

function browserStorage(): Pick<Storage, "removeItem" | "setItem"> | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function useCoachLinkingController(input: {
  readonly identityKey: string | null;
  readonly enabled: boolean;
  readonly initialEntry: CoachLinkStoredEntry | null;
  readonly repository?: CoachLinkingRepository;
  readonly createRequestId?: () => string;
  readonly onResumeProfile: () => void;
  readonly onResumeConfirmation: () => void;
  readonly onResumeSuccess: () => void;
  readonly onSessionExpired: () => void;
}): CoachLinkingController {
  const repository = input.repository ?? coachLinkingRepository;
  const createRequestId = input.createRequestId;
  const initialCode = input.initialEntry?.code ?? null;
  const [snapshot, setSnapshot] = useState<CoachLinkingSnapshot>(() => ({
    ...EMPTY,
    code: initialCode ?? "",
    cardMode: initialCode ? "form" : "closed",
    authGateOpen: Boolean(initialCode && !input.enabled),
  }));
  const generation = useRef(0);
  const lookupFlight = useRef<AbortController | null>(null);
  const acceptFlight = useRef<AbortController | null>(null);
  const resumeHandled = useRef(false);
  const identityKeyRef = useRef(input.identityKey);
  const pendingEntryCode = useRef(initialCode);
  const resumeConfirmation = useRef(input.initialEntry?.resumeConfirmation && input.initialEntry.requestId
    ? { code: input.initialEntry.code, requestId: input.initialEntry.requestId }
    : null);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const resumeRef = useRef(input.onResumeProfile);
  resumeRef.current = input.onResumeProfile;
  const resumeConfirmationNavigationRef = useRef(input.onResumeConfirmation);
  resumeConfirmationNavigationRef.current = input.onResumeConfirmation;
  const resumeSuccessNavigationRef = useRef(input.onResumeSuccess);
  resumeSuccessNavigationRef.current = input.onResumeSuccess;
  const expiredRef = useRef(input.onSessionExpired);
  expiredRef.current = input.onSessionExpired;

  const expireSession = useCallback(() => {
    expiredRef.current();
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    const previousIdentityKey = identityKeyRef.current;
    identityKeyRef.current = input.identityKey;
    const switchedDirectly = previousIdentityKey !== null
      && input.identityKey !== null
      && previousIdentityKey !== input.identityKey;
    lookupFlight.current?.abort();
    acceptFlight.current?.abort();
    resumeHandled.current = false;
    if (switchedDirectly) {
      resumeConfirmation.current = null;
      pendingEntryCode.current = null;
      clearCoachLinkEntry(browserStorage());
    }
    if (!input.enabled || !input.identityKey) {
      setSnapshot((state) => ({
        ...EMPTY,
        code: pendingEntryCode.current ?? state.confirmation?.code ?? state.code,
        cardMode: pendingEntryCode.current || state.confirmation || state.code ? "form" : "closed",
        authGateOpen: Boolean(pendingEntryCode.current || resumeConfirmation.current),
      }));
      return;
    }

    const abort = new AbortController();
    setSnapshot((state) => switchedDirectly ? EMPTY : ({
      ...state,
      activeState: "loading",
      activeStateIdentityKey: null,
      authGateOpen: false,
      code: pendingEntryCode.current ?? state.code,
      cardMode: pendingEntryCode.current ? "form" : state.cardMode,
    }));
    void repository.readActive(input.identityKey, abort.signal).then(async (result) => {
      if (generation.current !== current) return;
      const pendingResume = resumeConfirmation.current;
      if (pendingResume) {
        const resumed = await repository.lookup(input.identityKey!, pendingResume.code, abort.signal);
        if (generation.current !== current || abort.signal.aborted) return;
        if (resumed.status === "valido") {
          const confirmation = {
            code: pendingResume.code,
            coachName: resumed.coachName,
            requestId: pendingResume.requestId,
          } as const;
          setSnapshot((state) => ({
            ...state,
            activeState: "none",
            activeStateIdentityKey: input.identityKey,
            cardMode: "form",
            code: pendingResume.code,
            coachName: resumed.coachName,
            confirmation,
            lookupStatus: "idle",
          }));
          resumeConfirmationNavigationRef.current();
          return;
        }
        if (resumed.status === "ya_aceptado") {
          resumeConfirmation.current = null;
          pendingEntryCode.current = null;
          clearCoachLinkEntry(browserStorage());
          setSnapshot((state) => ({
            ...state,
            activeState: "linked",
            activeStateIdentityKey: input.identityKey,
            cardMode: "closed",
            code: "",
            coachName: resumed.coachName,
            confirmation: null,
            success: { kind: "recovered", coachName: resumed.coachName },
            lookupStatus: "idle",
          }));
          resumeSuccessNavigationRef.current();
          return;
        }
        resumeConfirmation.current = null;
        persistCoachLinkEntry(browserStorage(), pendingResume.code);
        setSnapshot((state) => ({
          ...state,
          activeState: result.status === "linked" ? "linked" : "none",
          activeStateIdentityKey: input.identityKey,
          cardMode: "form",
          code: pendingResume.code,
          confirmation: null,
          lookupStatus: resumed.status,
        }));
        resumeRef.current();
        return;
      }
      if (result.status === "linked") {
        recoverPendingEmails(repository, input.identityKey!);
        pendingEntryCode.current = null;
        clearCoachLinkEntry(browserStorage());
        setSnapshot((state) => ({
          ...state,
          activeState: "linked",
          activeStateIdentityKey: input.identityKey,
          cardMode: "closed",
          coachName: result.coachName,
          code: "",
          lookupStatus: "idle",
        }));
        return;
      }
      setSnapshot((state) => ({
        ...state,
        activeState: "none",
        activeStateIdentityKey: input.identityKey,
      }));
      if (pendingEntryCode.current && !resumeHandled.current) {
        resumeHandled.current = true;
        resumeRef.current();
      }
    }).catch((error) => {
      if (generation.current !== current || abort.signal.aborted) return;
      if (error instanceof CoachLinkingRepositoryError && error.code === "session_expired") {
        expireSession();
        return;
      }
      setSnapshot((state) => ({
        ...state,
        activeState: "none",
        activeStateIdentityKey: input.identityKey,
        cardMode: pendingEntryCode.current ? "form" : state.cardMode,
        code: pendingEntryCode.current ?? state.code,
        confirmation: null,
        lookupStatus: resumeConfirmation.current ? "error_red" : state.lookupStatus,
      }));
      if (pendingEntryCode.current && !resumeHandled.current) {
        resumeHandled.current = true;
        resumeRef.current();
      }
    });
    return () => abort.abort();
  }, [expireSession, initialCode, input.enabled, input.identityKey, repository]);

  const openForm = useCallback(() => {
    setSnapshot((state) => state.activeState === "linked" ? state : {
      ...state,
      cardMode: "form",
      lookupStatus: state.code ? "incompleto" : "idle",
    });
  }, []);

  const closeForm = useCallback(() => {
    lookupFlight.current?.abort();
    resumeConfirmation.current = null;
    pendingEntryCode.current = null;
    clearCoachLinkEntry(browserStorage());
    setSnapshot((state) => ({
      ...state,
      cardMode: "closed",
      code: "",
      lookupStatus: "idle",
      confirmation: null,
      confirmationError: null,
    }));
  }, []);

  const setCode = useCallback((value: string) => {
    const code = normalizeCoachLinkCode(value).clean;
    setSnapshot((state) => ({
      ...state,
      code,
      lookupStatus: code.length > 0 && !isCompleteCoachLinkCode(code) ? "incompleto" : "idle",
      confirmation: null,
      confirmationError: null,
    }));
  }, []);

  const lookup = useCallback(async (): Promise<"confirmation" | "success" | null> => {
    const state = snapshotRef.current;
    if (!input.enabled || !input.identityKey || state.lookupStatus === "validando"
      || !isCompleteCoachLinkCode(state.code)) return null;
    const code = normalizeCoachLinkCode(state.code).clean;
    pendingEntryCode.current = code;
    persistCoachLinkEntry(browserStorage(), code);
    const flight = new AbortController();
    lookupFlight.current?.abort();
    lookupFlight.current = flight;
    setSnapshot((current) => ({ ...current, lookupStatus: "validando" }));
    try {
      const result = await repository.lookup(input.identityKey, code, flight.signal);
      if (lookupFlight.current !== flight || flight.signal.aborted) return null;
      lookupFlight.current = null;
      if (result.status === "valido") {
        const pendingResume = resumeConfirmation.current;
        const requestId = pendingResume?.code === code
          ? pendingResume.requestId
          : createRequestId?.() ?? crypto.randomUUID();
        const confirmation = { code, coachName: result.coachName, requestId } as const;
        resumeConfirmation.current = { code, requestId };
        persistCoachLinkEntry(browserStorage(), code, requestId);
        setSnapshot((current) => ({
          ...current,
          lookupStatus: "idle",
          coachName: result.coachName,
          confirmation,
          confirmationError: null,
        }));
        return "confirmation";
      }
      if (result.status === "ya_aceptado") {
        recoverPendingEmails(repository, input.identityKey);
        resumeConfirmation.current = null;
        pendingEntryCode.current = null;
        clearCoachLinkEntry(browserStorage());
        setSnapshot((current) => ({
          ...current,
          lookupStatus: "idle",
          coachName: result.coachName,
          success: { kind: "recovered", coachName: result.coachName },
          activeState: "linked",
          activeStateIdentityKey: input.identityKey,
          cardMode: "closed",
        }));
        return "success";
      }
      setSnapshot((current) => ({ ...current, lookupStatus: result.status }));
      return null;
    } catch (error) {
      if (lookupFlight.current !== flight || flight.signal.aborted) return null;
      lookupFlight.current = null;
      if (error instanceof CoachLinkingRepositoryError && error.code === "session_expired") {
        expireSession();
        return null;
      }
      setSnapshot((current) => ({ ...current, lookupStatus: "error_red" }));
      return null;
    }
  }, [createRequestId, expireSession, input.enabled, input.identityKey, repository]);

  const accept = useCallback(async (): Promise<"success" | null> => {
    const state = snapshotRef.current;
    if (!input.enabled || !input.identityKey || state.accepting || !state.confirmation) return null;
    const confirmation = state.confirmation;
    const flight = new AbortController();
    acceptFlight.current?.abort();
    acceptFlight.current = flight;
    setSnapshot((current) => ({ ...current, accepting: true, confirmationError: null }));
    try {
      const result = await repository.accept(
        input.identityKey,
        confirmation.code,
        confirmation.requestId,
        flight.signal,
      );
      if (acceptFlight.current !== flight || flight.signal.aborted) return null;
      acceptFlight.current = null;
      if (result.status === "linked" || result.status === "already_linked") {
        recoverPendingEmails(repository, input.identityKey);
        resumeConfirmation.current = null;
        pendingEntryCode.current = null;
        clearCoachLinkEntry(browserStorage());
        setSnapshot((current) => ({
          ...current,
          accepting: false,
          activeState: "linked",
          activeStateIdentityKey: input.identityKey,
          cardMode: "closed",
          coachName: result.coachName,
          success: {
            kind: result.status === "linked" ? "new" : "recovered",
            coachName: result.coachName,
          },
        }));
        return "success";
      }
      if (result.status === "ya_tiene_coach") {
        setSnapshot((current) => ({ ...current, accepting: false, confirmationError: "ya_tiene_coach" }));
        return null;
      }
      setSnapshot((current) => ({ ...current, accepting: false, confirmationError: "network" }));
      return null;
    } catch (error) {
      if (acceptFlight.current !== flight || flight.signal.aborted) return null;
      acceptFlight.current = null;
      if (error instanceof CoachLinkingRepositoryError && error.code === "session_expired") {
        persistCoachLinkEntry(browserStorage(), confirmation.code, confirmation.requestId);
        expireSession();
        return null;
      }
      setSnapshot((current) => ({ ...current, accepting: false, confirmationError: "network" }));
      return null;
    }
  }, [expireSession, input.enabled, input.identityKey, repository]);

  const cancelConfirmation = useCallback(() => {
    acceptFlight.current?.abort();
    resumeConfirmation.current = null;
    const code = snapshotRef.current.confirmation?.code ?? snapshotRef.current.code;
    pendingEntryCode.current = code;
    persistCoachLinkEntry(browserStorage(), code);
    setSnapshot((state) => ({
      ...state,
      cardMode: "form",
      code,
      lookupStatus: "idle",
      confirmation: null,
      confirmationError: null,
      accepting: false,
    }));
  }, []);

  const settleSuccess = useCallback(() => {
    resumeConfirmation.current = null;
    pendingEntryCode.current = null;
    setSnapshot((state) => ({
      ...state,
      success: null,
      confirmation: null,
      confirmationError: null,
      code: "",
      lookupStatus: "idle",
      activeState: "linked",
      cardMode: "closed",
    }));
  }, []);

  const continueFromGate = useCallback(() => {
    setSnapshot((state) => ({ ...state, authGateOpen: false }));
  }, []);

  return {
    snapshot,
    actions: {
      openForm,
      closeForm,
      setCode,
      lookup,
      retryLookup: lookup,
      accept,
      retryAccept: accept,
      cancelConfirmation,
      settleSuccess,
      continueFromGate,
    },
  };
}
