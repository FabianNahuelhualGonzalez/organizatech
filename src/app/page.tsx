import { OrganizatechApp } from "@/components/organizatech-app";

const trainingCyclesRepositoryEnabled =
  process.env.VERCEL_ENV === "preview" &&
  process.env.NEXT_PUBLIC_ENABLE_QA_TOOLS === "true" &&
  process.env.NEXT_PUBLIC_SUPABASE_ENV === "qa";

export default function Home() {
  return <OrganizatechApp trainingCyclesRepositoryEnabled={trainingCyclesRepositoryEnabled} />;
}
