"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createProfileController,
  type ProfileController,
  type ProfileIdentityPort,
} from "@/features/profile/model/profile-controller";
import {
  PROFILE_AVATAR_IMAGE_ERROR_REFRESH_THROTTLE_MS,
  shouldRefreshProfileAvatarAfterImageError,
  shouldRefreshProfileAvatarOnForegroundEvent,
} from "@/lib/profile/profile-avatar";
import { getCurrentProfileAvatar, uploadProfileAvatar } from "@/lib/profile/profile-avatar-repository";
import { getProfilePersonalData, updateProfilePersonalData } from "@/lib/profile/profile-repository";
import type { Screen } from "@/lib/navigation/app-navigation";
import type { DataMode } from "@/lib/supabase/session";

const PROFILE_AVATAR_ERROR_REFRESH_THROTTLE_MS = PROFILE_AVATAR_IMAGE_ERROR_REFRESH_THROTTLE_MS;

export function useProfileController(input: {
  identity: ProfileIdentityPort;
  enabled: boolean;
  dataMode: DataMode;
  trainingDataPrepared: boolean;
  screen: Screen;
}) {
  const controller = useMemo(() => createProfileController({
    identity: input.identity,
    source: {
      readProfile: getProfilePersonalData,
      readAvatar: getCurrentProfileAvatar,
      saveProfile: updateProfilePersonalData,
      uploadAvatar: uploadProfileAvatar,
    },
  }), [input.identity]);
  const [subscription, setSubscription] = useState(() => ({
    controller,
    snapshot: controller.getSnapshot(),
  }));
  const snapshot = subscription.controller === controller
    ? subscription.snapshot
    : controller.getSnapshot();
  const lastImageErrorRefreshAtRef = useRef(0);
  const lastForegroundEventAtRef = useRef(0);

  useEffect(() => {
    setSubscription({ controller, snapshot: controller.getSnapshot() });
    const unsubscribe = controller.subscribe((nextSnapshot) => {
      setSubscription({ controller, snapshot: nextSnapshot });
    });
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller.replaceIdentityScope({
      enabled: input.enabled,
      dataMode: input.dataMode,
      trainingDataPrepared: input.trainingDataPrepared,
    });
  }, [controller, input.dataMode, input.enabled, input.trainingDataPrepared]);

  useEffect(() => {
    if (!input.enabled || !input.trainingDataPrepared) return;
    if (input.screen === "perfil") {
      void controller.refreshProfile();
      return;
    }
    void controller.bootstrap();
  }, [controller, input.enabled, input.screen, input.trainingDataPrepared]);

  useEffect(() => {
    function refreshOnResume() {
      const now = Date.now();
      if (!shouldRefreshProfileAvatarOnForegroundEvent(lastForegroundEventAtRef.current, now)) return;
      lastForegroundEventAtRef.current = now;
      void controller.foreground();
    }

    function refreshOnVisibilityChange() {
      if (document.visibilityState === "visible") refreshOnResume();
    }

    document.addEventListener("visibilitychange", refreshOnVisibilityChange);
    window.addEventListener("focus", refreshOnResume);
    window.addEventListener("pageshow", refreshOnResume);
    window.addEventListener("online", refreshOnResume);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisibilityChange);
      window.removeEventListener("focus", refreshOnResume);
      window.removeEventListener("pageshow", refreshOnResume);
      window.removeEventListener("online", refreshOnResume);
    };
  }, [controller]);

  const handleAvatarImageError = useCallback(() => {
    const now = Date.now();
    if (now - lastImageErrorRefreshAtRef.current < PROFILE_AVATAR_ERROR_REFRESH_THROTTLE_MS) return;
    if (!shouldRefreshProfileAvatarAfterImageError(lastImageErrorRefreshAtRef.current, now)) return;
    lastImageErrorRefreshAtRef.current = now;
    void controller.refreshAvatar({
      force: true,
      allowProfileLookup: true,
      publishProfileLookup: false,
      foreground: true,
      publishLoading: false,
    });
    void controller.foreground();
  }, [controller]);

  return {
    controller,
    ...snapshot,
    refreshProfilePersonalData: controller.refreshProfile,
    refreshProfileAvatar: controller.foreground,
    handleSaveProfilePersonalData: controller.saveProfile,
    handleUploadProfileAvatar: controller.uploadAvatar,
    handleProfileAvatarImageError: handleAvatarImageError,
  };
}

export type ProfileBoundary = ReturnType<typeof useProfileController>;
export type { ProfileController };
