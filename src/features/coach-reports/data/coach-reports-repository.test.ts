import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CoachReportsError, createCoachReportsRepository } from "./coach-reports-repository";

const reportId = "10000000-0000-4000-8000-000000000001";
const studentId = "40000000-0000-4000-8000-000000000004";
const episodeId = "50000000-0000-4000-8000-000000000005";
const assetId = "20000000-0000-4000-8000-000000000002";
const photoUploadId = "30000000-0000-4000-8000-000000000003";
const now = "2026-10-17T12:00:00.000Z";

function fixture() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const responses: Record<string, unknown> = {
    page_own_coach_progress_reports: { items: [{ id: reportId, studentName: "Alumno QA", studentUserId: studentId, episodeId, kind: "photos", sentAt: now, reviewedAt: null, itemCount: 1 }], pending: 1, reviewed: 0, hasMore: false },
    get_own_coach_progress_report: {
      id: reportId, studentName: "Alumno QA", episodeId, kind: "photos", message: null, sentAt: now, reviewedAt: null,
      items: [{ position: 1, assetId, assetKind: "photo", bucketId: "progress-check-photos", objectName: `${photoUploadId}/${assetId}.jpg`, mimeType: "image/jpeg", bytes: 120, checkedOn: "2026-10-17", pose: "frente", displayName: null }],
    },
    get_previous_own_coach_photo_report: null,
  };
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args }); return { data: responses[name], error: null };
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob(["image"], { type: "image/jpeg" }), error: null }) }) },
  } as unknown as SupabaseClient;
  return { repository: createCoachReportsRepository(client), calls, responses };
}

test("la bandeja usa una allowlist de RPC y valida el resumen", async () => {
  const { repository, calls } = fixture();
  assert.equal((await repository.list({ status: "pending", kind: null, query: "" })).items[0]?.studentName, "Alumno QA");
  assert.deepEqual(calls, [{ name: "page_own_coach_progress_reports", args: {
    p_status: "pending", p_kind: null, p_query: "", p_limit: 20, p_offset: 0,
  } }]);
});

test("la página siguiente conserva filtros y desplazamiento del servidor", async () => {
  const { repository, calls, responses } = fixture();
  responses.page_own_coach_progress_reports = { items: [], pending: 25, reviewed: 4, hasMore: false };
  const page = await repository.list({ status: "reviewed", kind: "photos", query: "Fabian" }, 20);
  assert.equal(page.reviewed, 4);
  assert.deepEqual(calls, [{ name: "page_own_coach_progress_reports", args: {
    p_status: "reviewed", p_kind: "photos", p_query: "Fabian", p_limit: 20, p_offset: 20,
  } }]);
});

test("abrir un reporte no lo marca revisado; sólo la acción explícita lo cambia", async () => {
  const { repository, calls } = fixture();
  const detail = await repository.open(reportId);
  assert.equal(detail.reviewedAt, null);
  assert.deepEqual(calls, [{ name: "get_own_coach_progress_report", args: { p_report_id: reportId } }]);
  await assert.rejects(repository.open("invalid"), CoachReportsError);
});

test("revisar y comparar usan sólo el reporte autorizado", async () => {
  const { repository, calls, responses } = fixture();
  responses.set_own_coach_progress_report_reviewed = { ...responses.get_own_coach_progress_report as object, reviewedAt: now };
  assert.equal((await repository.review(reportId, true)).reviewedAt, now);
  assert.equal(await repository.previous(reportId), null);
  assert.deepEqual(calls, [
    { name: "set_own_coach_progress_report_reviewed", args: { p_report_id: reportId, p_reviewed: true } },
    { name: "get_previous_own_coach_photo_report", args: { p_report_id: reportId } },
  ]);
});

test("un reporte conserva su texto cuando se revocan todas sus fotos", async () => {
  const { repository, responses } = fixture();
  responses.page_own_coach_progress_reports = { items: [{
    id: reportId, studentName: "Alumno QA", studentUserId: studentId, episodeId, kind: "photos", sentAt: now,
    reviewedAt: null, itemCount: 0,
  }], pending: 1, reviewed: 0, hasMore: false };
  responses.get_own_coach_progress_report = {
    id: reportId, studentName: "Alumno QA", episodeId, kind: "photos", message: "Registro conservado",
    sentAt: now, reviewedAt: null, items: [],
  };
  assert.equal((await repository.list({ status: "pending", kind: null, query: "" })).items[0]?.itemCount, 0);
  assert.deepEqual((await repository.open(reportId)).items, []);
});

test("la descarga usa solamente el bucket y objectName entregados por el servidor", async () => {
  const { repository } = fixture();
  const item = (await repository.open(reportId)).items[0]!;
  assert.equal((await repository.download(item)).type, "image/jpeg");
});


test("rechaza una ruta de almacenamiento que no corresponde al tipo de reporte", async () => {
  const { repository, responses } = fixture();
  const detail = responses.get_own_coach_progress_report as { items: Array<{ objectName: string }> };
  detail.items[0]!.objectName = "untrusted/path.jpg";
  await assert.rejects(repository.open(reportId), CoachReportsError);
});
