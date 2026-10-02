import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

import { handleAutomaticProgressPhotoRequest,
  verifyProgressPhotoStudentWithClient, type AutomaticPublicationDependencies,
} from "./automatic-progress-photo-request";
import { cleanOwnProgressPhotoResidue, publishOneOwnProgressPhoto,
  publishOwnProgressPhotoBatchWithPort } from "./automatic-progress-photo-publisher";
import type { AutomaticProgressPhotoPublicationPort } from "./supabase-progress-photo-publisher";
import type { ClaimedProgressPhoto } from "./progress-photo-finalizer";
import { abandonQueuedProgressPhoto, matchesSelectedProgressPhoto,
  type QueuedProgressPhoto } from "../model/progress-photo-upload-selection";
import { selectProgressPhoto } from "../model/select-progress-photo";

const studentId = "10000000-0000-4000-8000-000000000001";
const uploadIds = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
] as const;
const assetId = "60000000-0000-4000-8000-000000000001";
const attemptA = "50000000-0000-4000-8000-000000000001";
const attemptB = "50000000-0000-4000-8000-000000000002";
const stagingPath = "30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001.jpg";

function claim(attemptId = attemptA, uploadId = uploadIds[0], finalAssetId = assetId):
  ClaimedProgressPhoto & { attemptId: string } {
  return { uploadId, attemptId, stagingBucket: "progress-check-staging", stagingPath,
    expectedMime: "image/jpeg", finalBucket: "progress-check-photos",
    finalPath: `${attemptId}/${finalAssetId}.jpg` };
}

function request(body?: ReadableStream<Uint8Array>, headers?: HeadersInit, suffix = ""): Request {
  return { method: "POST", url: `http://localhost/api/progress-photos/publish${suffix}`,
    headers: new Headers({ Authorization: `Bearer ${"a".repeat(40)}`, ...headers }),
    body: body ?? null } as Request;
}

function bytesStream(bytes: string): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(bytes)); controller.close();
  } });
}

test("endpoint rejects unexpected bytes regardless of body and transport headers, then bounds one batch", async () => {
  const previous = process.env.PROGRESS_PHOTO_AUTO_PUBLISH_ENABLED;
  process.env.PROGRESS_PHOTO_AUTO_PUBLISH_ENABLED = "true";
  let verifications = 0;
  let batches = 0;
  const dependencies: AutomaticPublicationDependencies = {
    verifyStudent: async () => { verifications += 1;
      return { studentId, queuedUploadIds: uploadIds }; },
    publishBatch: async (student, ids) => { batches += 1;
      assert.equal(student, studentId);
      assert.deepEqual(ids, uploadIds.slice(0, 3));
      return "published";
    },
    cleanup: async () => 0,
  };
  try {
    assert.equal((await handleAutomaticProgressPhotoRequest(new Request(
      "http://localhost/api/progress-photos/publish", { method: "POST" }), dependencies)).status, 401);
    for (const forged of [
      request(bytesStream('{malformed'), { "Content-Length": "0" }),
      request(bytesStream('{"user_id":"foreign"}'), { "Transfer-Encoding": "chunked" }),
      request(bytesStream('x'), { "Content-Type": "application/octet-stream" }),
      request(undefined, undefined, "?upload_id=foreign"),
    ]) {
      assert.equal((await handleAutomaticProgressPhotoRequest(forged, dependencies)).status, 400);
    }
    assert.equal(verifications, 0);
    assert.equal(batches, 0);
    const emptyBody = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const accepted = await handleAutomaticProgressPhotoRequest(request(emptyBody,
      { "Content-Length": "999", "Transfer-Encoding": "chunked" }), dependencies);
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { status: "published" });
    assert.equal(accepted.headers.get("cache-control"), "no-store");
    assert.equal(verifications, 1);
    assert.equal(batches, 1);
    const denied = await handleAutomaticProgressPhotoRequest(request(), {
      ...dependencies, verifyStudent: async () => "unauthorized",
    });
    assert.equal(denied.status, 401);
    assert.equal(batches, 1);
  } finally {
    if (previous === undefined) delete process.env.PROGRESS_PHOTO_AUTO_PUBLISH_ENABLED;
    else process.env.PROGRESS_PHOTO_AUTO_PUBLISH_ENABLED = previous;
  }
});

test("server verifies the real session and derives the student plus exact own upload list", async () => {
  const calls: unknown[] = [];
  const token = "opaque-verified-token";
  const client = {
    auth: { getUser: async (received: string) => {
      calls.push(["getUser", received]);
      return { data: { user: { id: studentId } }, error: null };
    } },
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return { data: [{ uploadId: uploadIds[0], status: "en_cola" },
        { uploadId: uploadIds[1], status: "procesando" },
        { uploadId: uploadIds[2], status: "publicada" },
        { uploadId: uploadIds[3], status: "en_cola" }], error: null };
    },
  } as unknown as Pick<SupabaseClient, "auth" | "rpc">;
  assert.deepEqual(await verifyProgressPhotoStudentWithClient(token, client), {
    studentId, queuedUploadIds: [uploadIds[0], uploadIds[1], uploadIds[3]],
  });
  assert.deepEqual(calls, [["getUser", token],
    ["list_own_progress_photo_uploads", { p_limit: 100, p_offset: 0 }]]);
  const denied = {
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    rpc: async () => { throw new Error("must not query without session"); },
  } as unknown as Pick<SupabaseClient, "auth" | "rpc">;
  assert.equal(await verifyProgressPhotoStudentWithClient(token, denied), "unauthorized");
});

test("a server-issued reservation stays bound to the selected File and is abandoned before replacement", async () => {
  const original = new File(["a"], "one.jpg", { type: "image/jpeg" });
  const replacement = new File(["b"], "two.jpg", { type: "image/jpeg" });
  const queued: QueuedProgressPhoto = {
    reservation: { uploadId: uploadIds[0], bucketId: "progress-check-staging", objectName: stagingPath,
      mimeType: "image/jpeg", expiresAt: "2026-10-02T00:00:00Z" },
    pose: "frente", file: original, format: "jpeg", staged: true, enqueued: true,
  };
  assert.equal(matchesSelectedProgressPhoto(queued, "frente", { file: original, format: "jpeg" }), true);
  assert.equal(matchesSelectedProgressPhoto(queued, "frente", { file: replacement, format: "jpeg" }), false);
  assert.equal(matchesSelectedProgressPhoto(queued, "perfil", { file: original, format: "jpeg" }), false);
  let retained: QueuedProgressPhoto | null = queued;
  await assert.rejects(abandonQueuedProgressPhoto(queued, async (id) => {
    assert.equal(id, uploadIds[0]); throw new Error("temporary failure");
  }));
  assert.equal(retained, queued, "una cancelación fallida conserva la selección anterior");
  await abandonQueuedProgressPhoto(queued, async (id) => { assert.equal(id, uploadIds[0]); });
  retained = null;
  assert.equal(retained, null);
  const ui = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  const sql = readFileSync("supabase/migrations/20261002014402_progress_photo_automatic_publication.sql", "utf8");
  assert.match(ui, /await abandonQueuedProgressPhoto\(queued,[\s\S]*delete queuedPhotosRef\.current\[pose\]/);
  assert.doesNotMatch(ui, /Date\.now\(\)/);
  assert.match(ui, /await gateway\.getUpload\(pending\.reservation\.uploadId\)/);
  assert.match(sql, /upload\.id = p_upload_id and upload\.student_user_id = v_student/);
  assert.match(sql, /upload\.state = 'pending'/);
  assert.match(sql, /clock_timestamp\(\)/);
});

test("one server action processes at most three exact own claims", async () => {
  let claims = 0;
  let cleanups = 0;
  const port = {
    claimForStudent: async () => { claims += 1; return null; },
    claimDeletedFinal: async () => [],
    claimPublishedStaging: async () => { cleanups += 1; return []; }, claimOwnCleanup: async () => [],
    claimAbandoned: async () => [],
  } as unknown as AutomaticProgressPhotoPublicationPort;
  assert.equal(await publishOwnProgressPhotoBatchWithPort(studentId, uploadIds.slice(0, 3), port), "queued");
  assert.equal(claims, 3);
  await assert.rejects(publishOwnProgressPhotoBatchWithPort(studentId, uploadIds, port));
  assert.equal(claims, 3);
  assert.equal(await publishOwnProgressPhotoBatchWithPort(studentId, [], port), "idle");
  assert.equal(claims, 3);
  assert.equal(cleanups, 2, "an empty retry pass reclaims prior cleanup debt");
  const ui = readFileSync("src/features/progress-records/components/student-progress-photos.tsx", "utf8");
  assert.equal((ui.match(/await gateway\.publishOwnBatch\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(ui, /publishNextOwn/);
});

test("publisher verifies JPG, PNG and WebP then publishes JPEG while original is private", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    const source = await sharp({ create: { width: 40, height: 20, channels: 3,
      background: "#4488aa" } }).toFormat(format).toBuffer();
    const suffix = format === "jpeg" ? "jpg" : format;
    const ownClaim = { ...claim(), stagingPath: stagingPath.replace(/\.jpg$/, `.${suffix}`),
      expectedMime: `image/${format}` as ClaimedProgressPhoto["expectedMime"] };
    let staged = true;
    let final: Uint8Array | null = null;
    const port = {
      claimForStudent: async () => ownClaim,
      download: async (bucket: string) => bucket === "progress-check-staging"
        ? { bytes: source, mimeType: `image/${format}` }
        : { bytes: final!, mimeType: "image/jpeg" },
      upload: async (_bucket: string, _path: string, bytes: Uint8Array) => { final = bytes; },
      publishAutomatic: async (_upload: string, attemptId: string) => {
        assert.equal(attemptId, attemptA); assert.equal(staged, true); return assetId;
      },
      remove: async (bucket: string) => { if (bucket === "progress-check-staging") staged = false; },
      completePublishedStaging: async () => { assert.equal(staged, false); },
    } as unknown as AutomaticProgressPhotoPublicationPort;
    assert.equal(await publishOneOwnProgressPhoto(studentId, uploadIds[0], port), "published");
    assert.equal(staged, false);
  }
});

test("delayed attempt cannot remove a newer published candidate", async () => {
  const source = await sharp({ create: { width: 20, height: 20, channels: 3,
    background: "#4488aa" } }).jpeg().toBuffer();
  const old = claim(attemptA, uploadIds[0], "60000000-0000-4000-8000-000000000001");
  const current = claim(attemptB, uploadIds[0], "60000000-0000-4000-8000-000000000002");
  const objects = new Map<string, Uint8Array>();
  let resumeOld!: () => void;
  let oldUploadReached!: () => void;
  const oldBlocked = new Promise<void>((resolve) => { resumeOld = resolve; });
  const oldReached = new Promise<void>((resolve) => { oldUploadReached = resolve; });
  let activeAttempt = attemptA;
  const makePort = (ownClaim: ReturnType<typeof claim>) => ({
    claimForStudent: async () => ownClaim,
    download: async (bucket: string, path: string) => bucket === "progress-check-staging"
      ? { bytes: source, mimeType: "image/jpeg" }
      : { bytes: objects.get(path)!, mimeType: "image/jpeg" },
    upload: async (_bucket: string, path: string, bytes: Uint8Array) => {
      if (ownClaim.attemptId === attemptA) { oldUploadReached(); await oldBlocked; }
      objects.set(path, bytes);
    },
    publishAutomatic: async (_upload: string, attemptId: string) => {
      if (attemptId !== activeAttempt) throw new Error("stale attempt");
      return ownClaim.finalPath.split("/")[1].replace(/\.jpg$/, "");
    },
    releaseForRetry: async () => { throw new Error("already superseded"); },
    remove: async (bucket: string, path: string) => {
      if (bucket === "progress-check-photos") objects.delete(path);
    },
    completePublishedStaging: async () => undefined,
  }) as unknown as AutomaticProgressPhotoPublicationPort;
  const delayed = publishOneOwnProgressPhoto(studentId, uploadIds[0], makePort(old));
  await oldReached;
  activeAttempt = attemptB;
  assert.equal(await publishOneOwnProgressPhoto(studentId, uploadIds[0], makePort(current)), "published");
  resumeOld();
  assert.equal(await delayed, "retry");
  const cleaner = {
    claimDeletedFinal: async () => [],
    claimPublishedStaging: async () => [], claimOwnCleanup: async () => [],
    claimAbandoned: async () => [{ attemptId: attemptA, finalPath: old.finalPath }],
    remove: async (_bucket: string, path: string) => { objects.delete(path); },
    completeAbandoned: async () => undefined,
  } as unknown as AutomaticProgressPhotoPublicationPort;
  assert.equal(await cleanOwnProgressPhotoResidue(studentId, cleaner), 1);
  assert.equal(objects.has(old.finalPath), false);
  assert.equal(objects.has(current.finalPath), true);
});

test("failed post-publication staging deletion keeps final asset and leaves retryable cleanup debt", async () => {
  const source = await sharp({ create: { width: 20, height: 20, channels: 3,
    background: "#4488aa" } }).jpeg().toBuffer();
  let staged = true;
  let final: Uint8Array | null = null;
  let removes = 0;
  let debt = true;
  const port = {
    claimForStudent: async () => claim(),
    download: async (bucket: string) => bucket === "progress-check-staging"
      ? { bytes: source, mimeType: "image/jpeg" }
      : { bytes: final!, mimeType: "image/jpeg" },
    upload: async (_bucket: string, _path: string, bytes: Uint8Array) => { final = bytes; },
    publishAutomatic: async () => assetId,
    remove: async (bucket: string) => {
      assert.equal(bucket, "progress-check-staging", "jamás borra el final publicado");
      removes += 1;
      if (removes < 3) throw new Error("temporary Storage failure");
      staged = false;
    },
    completePublishedStaging: async () => { assert.equal(staged, false); debt = false; },
    claimDeletedFinal: async () => [],
    claimPublishedStaging: async () => debt ? [{ uploadId: uploadIds[0], stagingPath }] : [],
    claimOwnCleanup: async () => [], claimAbandoned: async () => [],
  } as unknown as AutomaticProgressPhotoPublicationPort;
  assert.equal(await publishOneOwnProgressPhoto(studentId, uploadIds[0], port), "published");
  assert.equal(staged, true);
  assert.equal(debt, true);
  assert.ok(final);
  assert.equal(await cleanOwnProgressPhotoResidue(studentId, port), 1);
  assert.equal(removes, 3);
  assert.equal(staged, false);
  assert.equal(debt, false);
  assert.ok(final);
});

test("deleted final stays hidden while Storage fails, then exact cleanup debt is retried", async () => {
  const finalPath = `${attemptA}/${assetId}.jpg`;
  let exists = true;
  let cleaned = false;
  let removals = 0;
  const port = {
    claimDeletedFinal: async (_student: string, limit: number) => {
      assert.equal(limit, 3);
      return cleaned ? [] : [{ assetId, finalPath }];
    },
    remove: async (_bucket: string, path: string) => {
      assert.equal(path, finalPath);
      removals += 1;
      if (removals <= 2) throw new Error("Storage unavailable");
      exists = false;
    },
    completeDeletedFinal: async (id: string) => {
      assert.equal(id, assetId);
      if (exists) throw new Error("object still present");
      cleaned = true;
    },
    claimPublishedStaging: async () => [], claimOwnCleanup: async () => [],
    claimAbandoned: async () => [],
  } as unknown as AutomaticProgressPhotoPublicationPort;
  assert.equal(await cleanOwnProgressPhotoResidue(studentId, port), 1);
  assert.equal(exists, true);
  assert.equal(cleaned, false);
  assert.equal(await cleanOwnProgressPhotoResidue(studentId, port), 1);
  assert.equal(exists, false);
  assert.equal(cleaned, true);
  assert.equal(removals, 3);
});

test("a cancelled upload with an already-missing object completes SQL cleanup safely", async () => {
  let completed = false;
  let attempts = 0;
  const port = {
    claimDeletedFinal: async () => [], claimPublishedStaging: async () => [],
    claimOwnCleanup: async () => completed ? [] : [{ uploadId: uploadIds[0],
      stagingPath, finalPath: null }],
    remove: async () => { attempts += 1; throw new Error("Storage reports missing object"); },
    completeCleanup: async (id: string) => { assert.equal(id, uploadIds[0]); completed = true; },
    claimAbandoned: async () => [],
  } as unknown as AutomaticProgressPhotoPublicationPort;
  assert.equal(await cleanOwnProgressPhotoResidue(studentId, port), 1);
  assert.equal(attempts, 2);
  assert.equal(completed, true);
});

test("SQL contracts scope attempts, cancellation and cleanup without altering legacy publication", () => {
  const sql = readFileSync("supabase/migrations/20261002014402_progress_photo_automatic_publication.sql", "utf8");
  const route = readFileSync("src/app/api/progress-photos/publish/route.ts", "utf8");
  assert.match(sql, /create table private\.progress_photo_automatic_attempts/);
  assert.match(sql, /attempt\.created_at > v_now - interval '1 minute'\) >= 3/);
  assert.match(sql, /upload\.id = p_upload_id and upload\.student_user_id = p_student_user_id/);
  assert.match(sql, /v_upload\.automatic_attempt_id <> p_attempt_id/);
  assert.match(sql, /attempt\.state = 'active'/);
  assert.match(sql, /attempt\.state = 'abandoned'/);
  assert.match(sql, /v_upload\.state <> 'published'[\s\S]*object\.name = v_upload\.object_name/);
  assert.match(sql, /set state = 'published', published_at = v_now, cleaned_at = null/);
  assert.match(sql, /upload\.student_user_id = v_student/);
  assert.match(sql, /create or replace function public\.list_own_progress_photo_uploads\(/);
  assert.match(sql, /upload\.state in \('pending', 'queued', 'processing'\)[\s\S]*upload\.expires_at <= clock_timestamp\(\) then 'fallida'/);
  assert.match(sql, /security definer set search_path = ''/);
  assert.doesNotMatch(sql, /create or replace function public\.publish_verified_progress_photo\(/);
  assert.match(route, /runtime = "nodejs"/);
});

test("HEIC, HEIF, RAW and ProRAW remain rejected", () => {
  for (const extension of ["heic", "heif", "raw", "dng"]) {
    assert.throws(() => selectProgressPhoto(new File(["x"], `photo.${extension}`, { type: "image/jpeg" })));
  }
});
