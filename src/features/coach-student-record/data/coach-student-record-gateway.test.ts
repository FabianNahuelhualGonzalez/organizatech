import assert from "node:assert/strict";
import test from "node:test";

import {
  CoachStudentRecordError, createCoachStudentRecordGateway,
} from "./coach-student-record-gateway";

const coach = "10000000-0000-4000-8000-000000000001";
const student = "10000000-0000-4000-8000-000000000002";
const episode = "20000000-0000-4000-8000-000000000001";
const asset = "30000000-0000-4000-8000-000000000001";
const check = "40000000-0000-4000-8000-000000000001";
const path = `${student}/${asset}.pdf`;
const subject = {
  episodeId: episode, studentUserId: student, studentName: "Alumno",
  studentEmail: "alumno@example.test", linkedAt: "2026-11-01T10:00:00Z",
};
const document = {
  assetId: asset, bucketId: "progress-medical-documents", objectName: path,
  mimeType: "application/pdf", bytes: 100, displayName: "Documento médico",
  availableAt: "2026-11-01T10:00:00Z",
} as const;
const photo = {
  assetId: asset, bucketId: "progress-check-photos", objectName: `${student}/${asset}.jpg`,
  mimeType: "image/jpeg", bytes: 100, checkId: check, checkedOn: "2026-11-01", pose: "front",
};

function fixture(options: { staleAfter?: number; revokeDocument?: boolean; invalidPhoto?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let verifications = 0;
  const client = {
    auth: {
      async getSession() {
        verifications++;
        return { data: { session: { access_token: "test", user: { id: coach } } }, error: null };
      },
      async getUser() { return { data: { user: { id: coach } }, error: null }; },
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "get_own_coach_student_record_subject") {
        return options.revokeDocument && calls.length > 2
          ? { data: null, error: { code: "42501" } }
          : { data: subject, error: null };
      }
      if (name === "list_shared_student_medical_documents") {
        return { data: [document], error: null };
      }
      return { data: [options.invalidPhoto ? { ...photo, objectName: "other/private.jpg" } : photo], error: null };
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "progress-medical-documents");
        return { async download(objectName: string) {
          assert.equal(objectName, path);
          return { data: null, error: { code: "42501" } };
        } };
      },
    },
  };
  const gateway = createCoachStudentRecordGateway(
    client as unknown as Parameters<typeof createCoachStudentRecordGateway>[0],
    coach, episode, () => options.staleAfter === undefined || verifications < options.staleAfter,
  );
  return { gateway, calls };
}

test("los documentos usan el lector existente y revalidan el episodio antes de devolverlos", async () => {
  const { gateway, calls } = fixture();
  assert.deepEqual(await gateway.listDocuments(), [document]);
  assert.deepEqual(calls.map((item) => item.name), [
    "get_own_coach_student_record_subject", "list_shared_student_medical_documents",
    "get_own_coach_student_record_subject",
  ]);
  assert.equal(calls[1].args.p_student_user_id, student);
});

test("revocación y cambio de selección fallan cerrados", async () => {
  await assert.rejects(fixture({ revokeDocument: true }).gateway.listDocuments(),
    (error: unknown) => error instanceof CoachStudentRecordError && error.code === "forbidden");
  await assert.rejects(fixture({ staleAfter: 2 }).gateway.listPhotos(),
    (error: unknown) => error instanceof CoachStudentRecordError && error.code === "forbidden");
});

test("Storage revalida el PDF y una foto con ruta inválida nunca llega a pantalla", async () => {
  const { gateway } = fixture();
  await assert.rejects(gateway.download(document),
    (error: unknown) => error instanceof CoachStudentRecordError && error.code === "unavailable");
  await assert.rejects(fixture({ invalidPhoto: true }).gateway.listPhotos(), CoachStudentRecordError);
});
