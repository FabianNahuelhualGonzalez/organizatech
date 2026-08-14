"use client";

import { useSearchParams } from "next/navigation";

import { OrganizatechApp } from "@/components/organizatech-app";
import { resolveAuthRouteState } from "@/features/auth/model/auth-route";

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
  const initialAuthRoute = resolveAuthRouteState({
    mode: searchParams.get("mode") ?? undefined,
    tipo: searchParams.get("tipo") ?? undefined,
  });

  return (
    <OrganizatechApp
      initialAuthRoute={initialAuthRoute}
      trainingCyclesRepositoryEnabled={trainingCyclesRepositoryEnabled}
      trainingCyclesSnapshotSource={trainingCyclesSnapshotSource}
      trainingWorkoutReadinessV2Enabled={trainingWorkoutReadinessV2Enabled}
    />
  );
}
