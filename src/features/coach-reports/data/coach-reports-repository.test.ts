import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CoachReportsError, createCoachReportsRepository } from "./coach-reports-repository";

const reportId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000002";
const photoUploadId = "30000000-0000-4000-8000-000000000003";
const now = "2026-10-17T12:00:00.000Z";

function fixture() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const responses: Record<string, unknown> = {
    list_own_coach_progress_reports: [{ id: reportId, studentName: "Alumno QA", kind: "photos", sentAt: now, reviewedAt: null, itemCount: 1 }],
    review_own_coach_progress_report: {
      id: reportId, kind: "photos", message: null, sentAt: now, reviewedAt: now,
      items: [{ position: 1, assetId, assetKind: "photo", bucketId: "progress-check-photos", objectName: `${photoUploadId}/${assetId}.jpg`, mimeType: "image/jpeg", bytes: 120, checkedOn: "2026-10-17", pose: "frente", displayName: null }],
    },
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
  assert.equal((await repository.list())[0]?.studentName, "Alumno QA");
  assert.deepEqual(calls, [{ name: "list_own_coach_progress_reports", args: { p_limit: 50 } }]);
});

test("abrir un reporte lo marca revisado en el mismo RPC autorizado", async () => {
  const { repository, calls } = fixture();
  const detail = await repository.open(reportId);
  assert.equal(detail.reviewedAt, now);
  assert.deepEqual(calls, [{ name: "review_own_coach_progress_report", args: { p_report_id: reportId } }]);
  await assert.rejects(repository.open("invalid"), CoachReportsError);
});

test("la descarga usa solamente el bucket y objectName entregados por el servidor", async () => {
  const { repository } = fixture();
  const item = (await repository.open(reportId)).items[0]!;
  assert.equal((await repository.download(item)).type, "image/jpeg");
});


test("rechaza una ruta de almacenamiento que no corresponde al tipo de reporte", async () => {
  const { repository, responses } = fixture();
  const detail = responses.review_own_coach_progress_report as { items: Array<{ objectName: string }> };
  detail.items[0]!.objectName = "untrusted/path.jpg";
  await assert.rejects(repository.open(reportId), CoachReportsError);
});
