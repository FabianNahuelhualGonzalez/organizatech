import { Suspense } from "react";

import { AuthEntryClient } from "@/features/auth/components/auth-entry-client";
import { AuthLoadingScreen } from "@/features/auth/components/auth-screen";

const qaTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa";

const productionTrainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "production" &&
  process.env.ENABLE_TRAINING_CYCLES_REPOSITORY === "true";

const trainingCyclesRepositoryEnabled =
  qaTrainingCyclesRepositoryEnabled || productionTrainingCyclesRepositoryEnabled;

const trainingCyclesSnapshotSource = productionTrainingCyclesRepositoryEnabled
  ? "ui-main-production"
  : "ui-main-qa";

const trainingWorkoutReadinessV2Enabled =
  process.env.ENABLE_TRAINING_WORKOUT_READINESS_V2 === "true";

export default function Home() {
  return (
    <Suspense fallback={<main className="app-shell"><AuthLoadingScreen /></main>}>
      <AuthEntryClient
        trainingCyclesRepositoryEnabled={trainingCyclesRepositoryEnabled}
        trainingCyclesSnapshotSource={trainingCyclesSnapshotSource}
        trainingWorkoutReadinessV2Enabled={trainingWorkoutReadinessV2Enabled}
      />
    </Suspense>
  );
}
