import { createClient } from "@supabase/supabase-js";
import { PROGRESS_PHOTO_MAX_BYTES } from "../model/progress-records-contract";
import type { ClaimedProgressPhoto, ProgressPhotoCleanupItem,
  ProgressPhotoPublicationPort } from "./progress-photo-finalizer";

const BUCKETS = new Set(["progress-check-staging", "progress-check-photos"]);
const PATH = /^[0-9a-f-]+\/[0-9a-f-]+\.(jpg|webp)$/;

function assertObjectAddress(bucket: string, path: string): void {
  if (!BUCKETS.has(bucket) || !PATH.test(path)) throw new Error("progress_photo_invalid_path");
}

export async function createSupabaseProgressPhotoPublisher(): Promise<ProgressPhotoPublicationPort> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.PROGRESS_PHOTO_TECHNICAL_EMAIL;
  const password = process.env.PROGRESS_PHOTO_TECHNICAL_PASSWORD;
  if (!baseUrl || !anonKey || !email || !password) {
    throw new Error("progress_photo_publisher_unconfigured");
  }
  const authClient = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: login, error: loginError } = await authClient.auth.signInWithPassword({
    email, password,
  });
  const publisherJwt = login.session?.access_token;
  if (loginError || !publisherJwt || !login.user) {
    throw new Error("progress_photo_publisher_auth_failed");
  }
  const { data: verified, error: claimsError } = await authClient.auth.getClaims(publisherJwt);
  if (claimsError || verified?.claims.role !== "progress_photo_publisher"
    || verified.claims.sub !== login.user.id
    || typeof verified.claims.exp !== "number"
    || verified.claims.exp - Math.floor(Date.now() / 1000) < 600
    || verified.claims.exp - Number(verified.claims.iat) > 900) {
    throw new Error("progress_photo_publisher_auth_failed");
  }
  const client = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${publisherJwt}` } },
  });

  async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await client.rpc(name, params);
    if (error) throw new Error("progress_photo_publisher_rpc_failed");
    return data as T;
  }

  return {
    claim: () => rpc<ClaimedProgressPhoto | null>("claim_progress_photo_for_verification"),
    claimCleanup: (limit) => rpc<readonly ProgressPhotoCleanupItem[]>(
      "claim_expired_progress_photo_cleanup", { p_limit: limit },
    ),
    completeCleanup: (uploadId) => rpc<void>("complete_progress_photo_cleanup", {
      p_upload_id: uploadId,
    }),
    fail: (uploadId) => rpc<void>("fail_progress_photo_verification", {
      p_upload_id: uploadId,
    }),
    publish: (uploadId, bytes, width, height) => rpc<string>("publish_verified_progress_photo", {
      p_upload_id: uploadId, p_byte_size: bytes, p_width: width, p_height: height,
    }),
    async download(bucket, path) {
      assertObjectAddress(bucket, path);
      const parts = path.split("/").map(encodeURIComponent).join("/");
      const url = new URL(`/storage/v1/object/authenticated/${bucket}/${parts}`, baseUrl);
      const response = await fetch(url, { headers: {
        Authorization: `Bearer ${publisherJwt}`, apikey: anonKey,
      }, cache: "no-store" });
      if (!response.ok || !response.body) throw new Error("progress_photo_download_failed");
      const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
      const length = response.headers.get("content-length");
      if (length && /^\d+$/.test(length) && Number(length) > PROGRESS_PHOTO_MAX_BYTES) {
        await response.body.cancel();
        throw new Error("progress_photo_too_large");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > PROGRESS_PHOTO_MAX_BYTES) {
            await reader.cancel();
            throw new Error("progress_photo_too_large");
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { bytes, mimeType };
    },
    async upload(bucket, path, bytes) {
      if (bucket !== "progress-check-photos") throw new Error("progress_photo_invalid_bucket");
      assertObjectAddress(bucket, path);
      const { error } = await client.storage.from(bucket).upload(path, bytes, {
        contentType: "image/jpeg", cacheControl: "0", upsert: false,
      });
      if (error) throw new Error("progress_photo_upload_failed");
    },
    async remove(bucket, path) {
      assertObjectAddress(bucket, path);
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new Error("progress_photo_cleanup_failed");
    },
  };
}
