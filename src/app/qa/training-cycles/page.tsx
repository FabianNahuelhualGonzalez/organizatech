import { notFound } from "next/navigation";

import { isQaToolsAccessAllowed } from "@/lib/server/qa-tools-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TrainingCyclesQaPage() {
  if (!(await isQaToolsAccessAllowed())) notFound();

  const { TrainingCyclesQaClient } = await import("./training-cycles-qa-client");
  return <TrainingCyclesQaClient />;
}
