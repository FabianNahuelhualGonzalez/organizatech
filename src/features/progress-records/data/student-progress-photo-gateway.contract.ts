import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createStudentProgressPhotoGateway, StudentProgressPhotoGatewayError } from "./student-progress-photo-gateway";

const uploadId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000002";
const reportId = "30000000-0000-4000-8000-000000000003";
const requestId = "40000000-0000-4000-8000-000000000004";
const objectName = `${uploadId}/${assetId}.jpg`;
const now = "2026-09-30T12:00:00Z";

function fixture() {
  const calls: { name: string; args: unknown }[] = [];
  const storage: { bucket?: string; path?: string; upsert?: boolean; contentType?: string; file?: File } = {};
  const outputs: Record<string, unknown> = {
    begin_own_progress_photo_upload: { uploadId, bucketId: "progress-check-staging", objectName,
      mimeType: "image/jpeg", expiresAt: now },
    finalize_own_progress_photo_upload: uploadId,
    list_own_progress_photo_uploads: [{ uploadId, pose: "frente", status: "en_cola", assetId: null,
      createdAt: now, expiresAt: now, publishedAt: null }],
    list_own_progress_photos: [{ assetId, bucketId: "progress-check-photos", objectName,
      mimeType: "image/jpeg", bytes: 100, width: 10, height: 10, pose: "frente", checkId: null,
      createdAt: now, availableAt: now }],
    get_own_progress_photo: { assetId, bucketId: "progress-check-photos", objectName,
      mimeType: "image/jpeg", bytes: 100, width: 10, height: 10, pose: "frente", checkId: null,
      createdAt: now, availableAt: now },
    list_own_progress_checks: [{ id: uploadId, checkedOn: "2026-09-30", createdAt: now,
      photos: [{ assetId, bucketId: "progress-check-photos", objectName, mimeType: "image/jpeg",
        bytes: 100, width: 10, height: 10, pose: "frente", position: 1 }] }],
    create_own_progress_check: { id: uploadId, checkedOn: "2026-09-30" },
    get_own_progress_photo_deletion_target: { kind: "photo" },
    delete_own_progress_photo: "photo_deleted",
    delete_own_progress_check: "check_deleted",
    attach_own_progress_check_photo: "frente",
    get_own_student_progress_access: { relationshipEpisodeId: uploadId,
      coachName: "Coach QA", coachEmail: "coach@example.com" },
    create_own_progress_photo_report: { id: reportId },
    get_own_progress_report_delivery_status: { emailStatus: "sent", notificationAccepted: true,
      sentAt: now, coachName: "Coach QA", coachEmail: "coach@example.com" },
    list_own_progress_photo_report_statuses: [{ assetId, sentAt: now, coachName: "Coach QA" }],
  };
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: outputs[name], error: null };
    },
    storage: { from: (bucket: string) => {
      storage.bucket = bucket;
      return {
        upload: async (path: string, image: File, options: { upsert: boolean; contentType: string }) => {
          storage.path = path;
          storage.file = image;
          storage.upsert = options.upsert;
          storage.contentType = options.contentType;
          return { error: null };
        },
        download: async (path: string) => {
          storage.path = path;
          return { data: new Blob(["jpeg"], { type: "image/jpeg" }), error: null };
        },
      };
    } },
  } as unknown as SupabaseClient;
  return { gateway: createStudentProgressPhotoGateway(client), calls, storage, outputs };
}

test("reserva, staging y cola usan sólo la ruta entregada por SQL", async () => {
  const { gateway, calls, storage } = fixture();
  const original = new File(["image"], "source.jpg", { type: "image/jpeg" });
  await assert.rejects(gateway.stage(uploadId, original),
    (error: unknown) => error instanceof StudentProgressPhotoGatewayError && error.code === "invalid_input");
  const reservation = await gateway.reserve("frente", "jpeg");
  assert.equal(reservation.objectName, objectName);
  await gateway.stage(reservation.uploadId, original);
  await assert.rejects(gateway.stage(reservation.uploadId,
    new File(["image"], "replacement.jpg", { type: "image/jpeg" })),
  (error: unknown) => error instanceof StudentProgressPhotoGatewayError && error.code === "invalid_input");
  await gateway.enqueue(reservation.uploadId);
  assert.deepEqual(calls, [
    { name: "begin_own_progress_photo_upload", args: { p_pose: "frente", p_format: "jpeg" } },
    { name: "finalize_own_progress_photo_upload", args: { p_upload_id: uploadId } },
  ]);
  assert.deepEqual(storage, { bucket: "progress-check-staging", path: objectName, file: original,
    upsert: false, contentType: "image/jpeg" });
});

test("PNG is staged unchanged with SQL MIME and opaque path", async () => {
  const { gateway, outputs, storage } = fixture();
  outputs.begin_own_progress_photo_upload = { uploadId, bucketId: "progress-check-staging",
    objectName: `${uploadId}/${assetId}.png`, mimeType: "image/png", expiresAt: now };
  const reservation = await gateway.reserve("perfil", "png");
  const original = new File(["png bytes"], "selected.png", { type: "image/png" });
  await gateway.stage(reservation.uploadId, original);
  assert.equal(storage.file, original);
  assert.equal(storage.contentType, "image/png");
  assert.equal(storage.path, reservation.objectName);
});

test("gateway rejects HEIC, RAW and an unauthorized staging path", async () => {
  const { gateway, outputs, calls, storage } = fixture();
  await assert.rejects(gateway.reserve("perfil", "heic" as never), StudentProgressPhotoGatewayError);
  await assert.rejects(gateway.reserve("perfil", "raw" as never), StudentProgressPhotoGatewayError);
  assert.equal(calls.length, 0);
  const reservation = await gateway.reserve("perfil", "jpeg");
  await assert.rejects(gateway.stage(reservation.uploadId,
    new File(["bytes"], "photo.heic", { type: "image/jpeg" })), StudentProgressPhotoGatewayError);
  await assert.rejects(gateway.stage(reservation.uploadId,
    new File(["bytes"], "photo.dng", { type: "image/x-adobe-dng" })), StudentProgressPhotoGatewayError);
  assert.equal(storage.file, undefined);
  outputs.begin_own_progress_photo_upload = { uploadId, bucketId: "progress-check-staging",
    objectName: `${uploadId}/${assetId}.heic`, mimeType: "image/heic", expiresAt: now };
  await assert.rejects(gateway.reserve("perfil", "jpeg"), StudentProgressPhotoGatewayError);
});

test("final read routes reject HEIC path and MIME even when a server response claims an asset", async () => {
  const { gateway, outputs } = fixture();
  outputs.get_own_progress_photo = { ...(outputs.get_own_progress_photo as object),
    objectName: `${uploadId}/${assetId}.heic`, mimeType: "image/heic" };
  await assert.rejects(gateway.getPhoto(assetId), StudentProgressPhotoGatewayError);
  await assert.rejects(gateway.downloadOwnPhoto(assetId), StudentProgressPhotoGatewayError);
  outputs.list_own_progress_photos = [{ ...(outputs.list_own_progress_photos as object[])[0],
    objectName: `${uploadId}/${assetId}.heic`, mimeType: "image/heic" }];
  await assert.rejects(gateway.listPhotos(), StudentProgressPhotoGatewayError);
  outputs.list_own_progress_checks = [{ id: uploadId, checkedOn: "2026-09-30", createdAt: now,
    photos: [{ assetId, bucketId: "progress-check-photos",
      objectName: `${uploadId}/${assetId}.heic`, mimeType: "image/heic",
      bytes: 100, width: 10, height: 10, pose: "frente", position: 1 }] }];
  await assert.rejects(gateway.listChecks(), StudentProgressPhotoGatewayError);
});

test("lecturas y check usan allowlist de argumentos; Storage recibe ruta autorizada por detalle", async () => {
  const { gateway, calls, storage } = fixture();
  assert.equal((await gateway.listUploads())[0].status, "en_cola");
  const photos = await gateway.listPhotos();
  assert.equal(photos[0].assetId, assetId);
  assert.equal(photos[0].checkId, null);
  assert.equal((await gateway.listChecks())[0].photos[0].position, 1);
  assert.equal((await gateway.getPhoto(assetId)).objectName, objectName);
  assert.equal((await gateway.createCheck("2026-09-30", [assetId])).id, uploadId);
  await gateway.downloadOwnPhoto(assetId);
  assert.equal(storage.bucket, "progress-check-photos");
  assert.equal(storage.path, objectName);
  assert.deepEqual(calls.map((call) => call.args), [
    { p_limit: 50, p_offset: 0 }, { p_limit: 50, p_offset: 0 },
    { p_limit: 50, p_offset: 0 }, { p_asset_id: assetId },
    { p_checked_on: "2026-09-30", p_asset_ids: [assetId] }, { p_asset_id: assetId },
  ]);
});

test("entrada inválida y respuesta con bucket o path alterado fallan cerradas", async () => {
  const { gateway, outputs } = fixture();
  await assert.rejects(gateway.createCheck("2026-02-30", [assetId]), StudentProgressPhotoGatewayError);
  await assert.rejects(gateway.createCheck("2026-09-30", [assetId, assetId]), StudentProgressPhotoGatewayError);
  await assert.rejects(gateway.listPhotos(101), StudentProgressPhotoGatewayError);
  outputs.get_own_progress_photo = { ...(outputs.get_own_progress_photo as object),
    bucketId: "progress-check-staging" };
  await assert.rejects(gateway.downloadOwnPhoto(assetId), StudentProgressPhotoGatewayError);
});

test("delete target and confirmation send only one opaque asset ID", async () => {
  const { gateway, calls, outputs } = fixture();
  assert.equal(await gateway.getDeletionTarget(assetId), "photo");
  assert.equal(await gateway.deletePublishedPhoto(assetId, false), "photo_deleted");
  outputs.get_own_progress_photo_deletion_target = { kind: "check" };
  assert.equal(await gateway.getDeletionTarget(assetId), "check");
  assert.equal(await gateway.deletePublishedPhoto(assetId, true), "check_deleted");
  outputs.delete_own_progress_check = "already_deleted";
  assert.equal(await gateway.deletePublishedPhoto(assetId, true), "already_deleted");
  assert.deepEqual(calls, [
    { name: "get_own_progress_photo_deletion_target", args: { p_asset_id: assetId } },
    { name: "delete_own_progress_photo", args: { p_asset_id: assetId } },
    { name: "get_own_progress_photo_deletion_target", args: { p_asset_id: assetId } },
    { name: "delete_own_progress_check", args: { p_asset_id: assetId } },
    { name: "delete_own_progress_check", args: { p_asset_id: assetId } },
  ]);
});

test("report gateway keeps ordered IDs and derives the recipient through the active episode", async () => {
  const { gateway, calls, outputs } = fixture();
  assert.equal(await gateway.attachPhotoToCheck(uploadId, assetId), "frente");
  const coach = await gateway.getCoachAccess();
  assert.deepEqual(coach, { relationshipEpisodeId: uploadId,
    coachName: "Coach QA", coachEmail: "coach@example.com" });
  assert.equal(await gateway.createPhotoReport([assetId], "  Avance  ", requestId, coach.relationshipEpisodeId), reportId);
  assert.deepEqual(await gateway.getPhotoReportDeliveryStatus(reportId), {
    emailStatus: "sent", notificationAccepted: true, sentAt: now,
    coachName: "Coach QA", coachEmail: "coach@example.com",
  });
  assert.deepEqual(await gateway.listPhotoReportStatuses([assetId]), [{ assetId, sentAt: now,
    coachName: "Coach QA" }]);
  assert.deepEqual(calls, [
    { name: "attach_own_progress_check_photo", args: { p_check_id: uploadId, p_asset_id: assetId } },
    { name: "get_own_student_progress_access", args: {} },
    { name: "create_own_progress_photo_report", args: {
      p_expected_episode_id: uploadId, p_asset_ids: [assetId], p_message: "Avance", p_request_id: requestId,
    } },
    { name: "get_own_progress_report_delivery_status", args: { p_report_id: reportId } },
    { name: "list_own_progress_photo_report_statuses", args: { p_asset_ids: [assetId] } },
  ]);
  outputs.get_own_progress_report_delivery_status = { ...(outputs.get_own_progress_report_delivery_status as object),
    notificationAccepted: false };
  assert.equal((await gateway.getPhotoReportDeliveryStatus(reportId)).notificationAccepted, false);
  await assert.rejects(gateway.createPhotoReport([assetId, assetId], "", requestId, uploadId),
    StudentProgressPhotoGatewayError);
});
