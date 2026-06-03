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

export default function Home() {
  return (
    <OrganizatechApp
      trainingCyclesRepositoryEnabled={trainingCyclesRepositoryEnabled}
      trainingCyclesSnapshotSource={trainingCyclesSnapshotSource}
    />
  );
}
