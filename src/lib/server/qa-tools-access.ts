import "server-only";

import { headers } from "next/headers";

import {
  collectProductionHosts,
  evaluateQaToolsAccess,
} from "@/lib/server/qa-tools-access-policy";

export async function isQaToolsAccessAllowed(): Promise<boolean> {
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? undefined;

  return evaluateQaToolsAccess({
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    qaToolsEnabled: process.env.ENABLE_QA_TOOLS,
    requestHost,
    productionHosts: collectProductionHosts(
      process.env.APP_PRODUCTION_HOSTS,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ),
    expectedQaSupabaseProjectRef: process.env.QA_EXPECTED_SUPABASE_PROJECT_REF,
    actualSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
}
