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
  avatarPath: null, avatarUpdatedAt: null,
};
const document = {
  assetId: asset, bucketId: "progress-medical-documents", objectName: path,
  mimeType: "application/pdf", bytes: 100, displayName: "Documento médico",
  availableAt: "2026-11-01T10:00:00Z",
} as const;
const photo = {
  assetId: asset, bucketId: "progress-check-photos", objectName: `${student}/${asset}.jpg`,
  mimeType: "image/jpeg", bytes: 100, checkId: check, checkedOn: "2026-11-01", pose: "front",
} as const;

function fixture(options: { staleAfter?: number; revokeDocument?: boolean;
  revokeAvatar?: boolean; invalidPhoto?: boolean; invalidAvatar?: boolean } = {}) {
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
        return (options.revokeDocument && calls.length > 2)
          || (options.revokeAvatar && calls.length > 2)
          ? { data: null, error: { code: "42501" } }
          : { data: { ...subject,
            avatarPath: options.invalidAvatar ? `${coach}/avatar` : `${student}/avatar`,
            avatarUpdatedAt: "2026-11-01T10:00:00Z" }, error: null };
      }
      if (name === "list_shared_student_medical_documents") {
        return { data: [document], error: null };
      }
      return { data: [options.invalidPhoto ? { ...photo, objectName: "other/private.jpg" } : photo], error: null };
    },
    storage: {
      from(bucket: string) {
        assert.ok(["progress-medical-documents", "profile-avatars", "progress-check-photos"].includes(bucket));
        return { async download(objectName: string) {
          assert.equal(objectName, bucket === "profile-avatars" ? `${student}/avatar`
            : bucket === "progress-check-photos" ? photo.objectName : path);
          return bucket === "progress-medical-documents"
            ? { data: null, error: { code: "42501" } }
            : { data: new Blob(["image"], { type: "image/jpeg" }), error: null };
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

test("avatar y miniatura requieren el episodio activo antes y después del archivo", async () => {
  const { gateway, calls } = fixture();
  const selected = await gateway.getSubject();
  assert.equal((await gateway.downloadAvatar(selected)).type, "image/jpeg");
  assert.equal((await gateway.download(photo)).type, "image/jpeg");
  assert.ok(calls.filter((call) => call.name === "get_own_coach_student_record_subject").length >= 5);
  await assert.rejects(fixture({ invalidAvatar: true }).gateway.getSubject(), CoachStudentRecordError);
  const revoked = fixture({ revokeAvatar: true });
  await assert.rejects(revoked.gateway.downloadAvatar(await revoked.gateway.getSubject()),
    (error: unknown) => error instanceof CoachStudentRecordError && error.code === "forbidden");
});
