"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { OrganizatechApp } from "@/components/organizatech-app";
import { AuthLoadingScreen } from "@/features/auth/components/auth-screen";
import { useGoogleOAuthCallbackGate } from "@/features/auth/hooks/use-google-oauth-callback-gate";
import { resolveAuthRouteState } from "@/features/auth/model/auth-route";
import {
  captureCoachLinkEntry,
  captureCoachLinkNotificationDestination,
} from "@/features/coach-linking/model/coach-linking";

interface AuthEntryClientProps {
  trainingCyclesRepositoryEnabled: boolean;
  trainingCyclesSnapshotSource: "ui-main-production" | "ui-main-qa";
  trainingWorkoutReadinessV2Enabled: boolean;
}

export function AuthEntryClient({
  trainingCyclesRepositoryEnabled,
  trainingCyclesSnapshotSource,
  trainingWorkoutReadinessV2Enabled,
}: AuthEntryClientProps) {
  const searchParams = useSearchParams();
  const [initialCoachLinkEntry] = useState(() => captureCoachLinkEntry(
    searchParams.get("coachCode"),
    typeof window === "undefined" ? null : window.sessionStorage,
  ));
  const [initialCoachLinkNotificationDestination] = useState(() => (
    captureCoachLinkNotificationDestination(
      searchParams.get("coachLinkDestination"),
      searchParams.get("coachLinkEpisode"),
    )
  ));
  const googleOAuth = useGoogleOAuthCallbackGate();
  if (googleOAuth.state === "checking") return <AuthLoadingScreen />;
  const initialAuthRoute = resolveAuthRouteState({
    mode: googleOAuth.intent
      ? googleOAuth.intent.mode
      : searchParams.get("mode") ?? undefined,
    tipo: googleOAuth.intent
      ? googleOAuth.intent.portal
      : searchParams.get("tipo") ?? undefined,
  });

  return (
    <OrganizatechApp
      googleOAuth={googleOAuth}
      initialAuthRoute={initialAuthRoute}
      initialCoachLinkEntry={initialCoachLinkEntry}
      initialCoachLinkNotificationDestination={initialCoachLinkNotificationDestination}
      trainingCyclesRepositoryEnabled={trainingCyclesRepositoryEnabled}
      trainingCyclesSnapshotSource={trainingCyclesSnapshotSource}
      trainingWorkoutReadinessV2Enabled={trainingWorkoutReadinessV2Enabled}
    />
  );
}
