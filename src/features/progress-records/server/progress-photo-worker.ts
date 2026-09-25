import { cleanExpiredProgressPhotos, finalizeNextProgressPhoto } from "./progress-photo-finalizer";
import { createSupabaseProgressPhotoPublisher } from "./supabase-progress-photo-publisher";

// Invoke from an authorized Node worker outside Vercel. No browser or UI import.
export async function runProgressPhotoPublisherPass() {
  const publisher = await createSupabaseProgressPhotoPublisher();
  const cleaned = await cleanExpiredProgressPhotos(publisher);
  const result = await finalizeNextProgressPhoto(publisher);
  return { cleaned, status: result.status };
}
