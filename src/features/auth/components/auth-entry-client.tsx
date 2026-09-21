"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { OrganizatechApp } from "@/components/organizatech-app";
import { AuthLoadingScreen } from "@/features/auth/components/auth-screen";
import { useGoogleOAuthCallbackGate } from "@/features/auth/hooks/use-google-oauth-callback-gate";
import { resolveAuthRouteState } from "@/features/auth/model/auth-route";
import { resolveGoogleOAuthPortalHandoffRoute } from "@/features/auth/model/google-oauth-portal-handoff";
import { getBrowserSessionStorage } from "@/lib/storage/browser-storage";
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
  const googleOAuth = useGoogleOAuthCallbackGate({
    postAuthDestination: initialCoachLinkNotificationDestination?.kind === "student-coaching"
      ? "user-coach-profile"
      : null,
  });
  if (googleOAuth.state === "checking") return <AuthLoadingScreen />;
  const routeFromLocation = resolveAuthRouteState({
    mode: googleOAuth.intent
      ? googleOAuth.intent.mode
      : searchParams.get("mode") ?? undefined,
    tipo: googleOAuth.intent
      ? googleOAuth.intent.portal
      : searchParams.get("tipo") ?? undefined,
  });
  // The clean document can receive INITIAL_SESSION before Next finishes
  // hydrating search params. A ready handoff wins over that default route, but
  // is only a request: useMultiportalAuthBoundary still authorizes it remotely.
  const handoffPortal = typeof window === "undefined"
    ? null
    : resolveGoogleOAuthPortalHandoffRoute({
      storage: getBrowserSessionStorage(),
      location: () => window.location,
    });
  const initialAuthRoute = handoffPortal
    ? { mode: "login" as const, accountType: handoffPortal }
    : routeFromLocation;

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
