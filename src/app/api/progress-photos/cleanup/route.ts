import { handleAutomaticProgressPhotoRequest } from "@/features/progress-records/server/automatic-progress-photo-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAutomaticProgressPhotoRequest(request, undefined, "cleanup");
}
