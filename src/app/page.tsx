import { OrganizatechApp } from "@/components/organizatech-app";

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
  process.env.ENABLE_TRAINING_WORKOUT_READINESS_V2 === "true" &&
  process.env.VERCEL_ENV !== "production";
export default function Home() {
  return (
    <OrganizatechApp
      trainingCyclesRepositoryEnabled={trainingCyclesRepositoryEnabled}
      trainingCyclesSnapshotSource={trainingCyclesSnapshotSource}
      trainingWorkoutReadinessV2Enabled={trainingWorkoutReadinessV2Enabled}
    />
  );
}
