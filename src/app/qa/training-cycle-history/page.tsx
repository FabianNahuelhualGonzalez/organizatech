import { notFound } from "next/navigation";

import { isQaToolsAccessAllowed } from "@/lib/server/qa-tools-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TrainingCycleHistoryQaPage() {
  if (!(await isQaToolsAccessAllowed())) notFound();

  const { TrainingCycleHistoryQaClient } = await import("./training-cycle-history-qa-client");
  return <TrainingCycleHistoryQaClient />;
}
