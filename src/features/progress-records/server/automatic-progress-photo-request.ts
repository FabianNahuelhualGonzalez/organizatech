import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { runOwnProgressPhotoCleanupPass,
  runOwnProgressPhotoPublisherBatch } from "./automatic-progress-photo-publisher";

type OwnUpload = { uploadId?: unknown; status?: unknown };
type VerifiedStudent = { studentId: string; queuedUploadIds: readonly string[] };

export interface AutomaticPublicationDependencies {
  verifyStudent(token: string): Promise<VerifiedStudent | "unauthorized">;
  publishBatch(studentId: string, uploadIds: readonly string[]): Promise<"idle" | "published" | "queued" | "retry">;
  cleanup(studentId: string): Promise<number>;
}

export async function verifyProgressPhotoStudent(token: string): Promise<VerifiedStudent | "unauthorized"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("progress_photo_unconfigured");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return verifyProgressPhotoStudentWithClient(token, client);
}

export async function verifyProgressPhotoStudentWithClient(
  token: string,
  client: Pick<SupabaseClient, "auth" | "rpc">,
): Promise<VerifiedStudent | "unauthorized"> {
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return "unauthorized";
  const { data, error } = await client.rpc("list_own_progress_photo_uploads", {
    p_limit: 100, p_offset: 0,
  });
  if (error || !Array.isArray(data)) return "unauthorized";
  const queuedUploadIds = (data as OwnUpload[])
    .filter((upload) => (upload.status === "en_cola" || upload.status === "procesando")
      && typeof upload.uploadId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(upload.uploadId))
    .slice(0, 3).map((upload) => upload.uploadId as string);
  return { studentId: userData.user.id, queuedUploadIds };
}

const defaultDependencies: AutomaticPublicationDependencies = {
  verifyStudent: verifyProgressPhotoStudent,
  publishBatch: runOwnProgressPhotoPublisherBatch,
  cleanup: runOwnProgressPhotoCleanupPass,
};

function reply(status: number, state: "idle" | "queued" | "published" | "retry" | "error" | "cleaning") {
  return Response.json({ status: state }, { status, headers: { "Cache-Control": "no-store" } });
}

// Inspect bytes, not body presence or transport headers. Never parse or use client input.
async function hasUnexpectedInput(request: Request): Promise<boolean> {
  if (new URL(request.url).search) return true;
  const reader = request.body?.getReader();
  if (!reader) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), 2000);
  });
  try {
    for (let reads = 0; reads < 3; reads += 1) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === "timeout") return true;
      if (next.done) return false;
      if (next.value.byteLength > 0) return true;
    }
    return true;
  } catch { return true; }
  finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

export async function handleAutomaticProgressPhotoRequest(
  request: Request,
  dependencies: AutomaticPublicationDependencies = defaultDependencies,
  action: "publish" | "cleanup" = "publish",
): Promise<Response> {
  if (request.method !== "POST") return reply(405, "error");
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(authorization);
  if (!match) return reply(401, "error");
  if (process.env.PROGRESS_PHOTO_AUTO_PUBLISH_ENABLED !== "true") return reply(503, "error");
  if (await hasUnexpectedInput(request)) return reply(400, "error");
  try {
    const student = await dependencies.verifyStudent(match[1]);
    if (student === "unauthorized") return reply(401, "error");
    if (action === "cleanup") {
      await dependencies.cleanup(student.studentId);
      return reply(202, "cleaning");
    }
    // The slice is a second bound even when a dependency returns malformed data.
    // An empty batch still retries bounded cleanup debt from an earlier publication.
    const result = await dependencies.publishBatch(student.studentId,
      student.queuedUploadIds.slice(0, 3));
    return reply(result === "retry" ? 503 : 202, result);
  } catch { return reply(503, "error"); }
}
