import { authenticatedProgressClient, privateError, PRIVATE_PHOTO_HEADERS } from "@/features/progress-records/server/photo-auth";
import { cloudinaryConfig, downloadPhoto } from "@/features/progress-records/server/cloudinary-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const session = await authenticatedProgressClient(request);
  if (!session) return privateError(401);
  const { assetId } = await context.params;
  const reportId = new URL(request.url).searchParams.get("reportId");
  if (!UUID.test(assetId) || (reportId !== null && !UUID.test(reportId))) return privateError(404);
  const { data, error } = await session.client.rpc("get_own_cloudinary_progress_photo", {
    p_asset_id: assetId, p_report_id: reportId,
  });
  if (error || !data || typeof data.cloudinaryAssetId !== "string" || !MIME.has(data.mimeType)) {
    return privateError(404);
  }
  try {
    const upstream = await downloadPhoto(data.cloudinaryAssetId, cloudinaryConfig(process.env));
    if (!upstream.ok || !upstream.body) return privateError(502);
    return new Response(upstream.body, {
      status: 200,
      headers: { ...PRIVATE_PHOTO_HEADERS, "Content-Type": data.mimeType,
        "Content-Disposition": "inline" },
    });
  } catch {
    return privateError(502);
  }
}
