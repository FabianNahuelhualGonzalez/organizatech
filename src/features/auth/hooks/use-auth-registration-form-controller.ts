"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

import {
  createAuthRegistrationFormController,
  type CoachRegistrationFlow,
} from "@/features/auth/model/auth-registration-form-controller";

export type SharedCoachPreparationResult =
  | { state: "authorized"; userId: string }
  | { state: "sign_in_required" | "error" | "stale" };

export type SharedCoachLoginResult =
  | { state: "authorized"; userId: string }
  | { state: "rejected"; message: string }
  | { state: "error"; message: string }
  | { state: "busy" }
  | { state: "stale" };

interface UseAuthRegistrationFormControllerInput {
  authenticatedUserId: string | null;
  prepareSharedCoachRegistration(
    expectedUserId?: string,
  ): Promise<SharedCoachPreparationResult>;
  completeSharedCoachLogin(expectedUserId: string): Promise<SharedCoachLoginResult>;
}

export function useAuthRegistrationFormController(
  {
    authenticatedUserId,
    prepareSharedCoachRegistration,
    completeSharedCoachLogin: completeSharedCoachLoginOperation,
  }: UseAuthRegistrationFormControllerInput,
) {
  const controllerRef = useRef<ReturnType<typeof createAuthRegistrationFormController> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createAuthRegistrationFormController();
  }
  const controller = controllerRef.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  const selectCoachFlow = useCallback(async (flow: CoachRegistrationFlow) => {
    const capture = controller.selectCoachFlow(flow, authenticatedUserId);
    if (flow === "separate") return;
    const result = await prepareSharedCoachRegistration(authenticatedUserId ?? undefined);
    controller.completeSharedCoachEligibility(
      capture,
      result.state === "authorized"
        ? { state: "authorized", userId: result.userId }
        : { state: "sign_in_required" },
    );
  }, [authenticatedUserId, controller, prepareSharedCoachRegistration]);

  const completeSharedCoachLogin = useCallback(async (expectedUserId: string) => {
    const capture = controller.captureSharedCoachEligibility(expectedUserId);
    const result = await completeSharedCoachLoginOperation(expectedUserId);
    if (result.state === "busy" || result.state === "stale") return result;
    const completed = controller.completeSharedCoachEligibility(
      capture,
      result.state === "authorized"
        ? { state: "authorized", userId: result.userId }
        : { state: "sign_in_required" },
    );
    if (!completed) return { state: "stale" } as const;
    if (result.state !== "authorized") controller.beginSharedCoachLogin();
    return result;
  }, [completeSharedCoachLoginOperation, controller]);

  return {
    controller,
    state,
    selectCoachFlow,
    completeSharedCoachLogin,
  };
}

export type AuthRegistrationFormBinding = ReturnType<
  typeof useAuthRegistrationFormController
>;
