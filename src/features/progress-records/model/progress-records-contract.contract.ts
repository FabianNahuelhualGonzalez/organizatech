// Focused executable contract; intentionally outside the global package test registry.
import assert from "node:assert/strict";
import test from "node:test";
import {
  PROGRESS_DOCUMENT_MAX_BYTES,
  PROGRESS_PHOTO_MAX_BYTES,
  ProgressContractError,
  type ProgressReportCommand,
  normalizeProgressReportCommand,
  validateProgressUploadDraft,
} from "./progress-records-contract";

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

test("acepta únicamente las parejas MIME/extensión cerradas para fotos", () => {
  for (const [mimeType, extension] of [
    ["image/jpeg", "jpg"],
    ["image/jpeg", "jpeg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/heic", "heic"],
  ] as const) {
    assert.deepEqual(validateProgressUploadDraft({ kind: "photo", mimeType, extension, bytes: 1 }), {
      kind: "photo", mimeType, extension, bytes: 1,
    });
  }
  assert.throws(
    () => validateProgressUploadDraft({ kind: "photo", mimeType: "image/jpeg", extension: "png", bytes: 1 }),
    (error) => error instanceof ProgressContractError && error.code === "invalid_format",
  );
  assert.throws(
    () => validateProgressUploadDraft({
      kind: "photo", mimeType: "image/gif", extension: "gif", bytes: 1,
    } as never),
    (error) => error instanceof ProgressContractError && error.code === "invalid_format",
  );
  assert.throws(
    () => validateProgressUploadDraft({
      kind: "medical_document", mimeType: "image/jpeg", extension: "jpg",
      bytes: 1, displayName: "imagen", category: "otro",
    } as never),
    (error) => error instanceof ProgressContractError && error.code === "invalid_format",
  );
});

test("rechaza fotos sobre 20 MB y documentos sobre 25 MB", () => {
  assert.doesNotThrow(() => validateProgressUploadDraft({
    kind: "photo", mimeType: "image/webp", extension: "webp", bytes: PROGRESS_PHOTO_MAX_BYTES,
  }));
  assert.throws(() => validateProgressUploadDraft({
    kind: "photo", mimeType: "image/webp", extension: "webp", bytes: PROGRESS_PHOTO_MAX_BYTES + 1,
  }), (error) => error instanceof ProgressContractError && error.code === "file_too_large");
  assert.doesNotThrow(() => validateProgressUploadDraft({
    kind: "medical_document", mimeType: "application/pdf", extension: "pdf",
    bytes: PROGRESS_DOCUMENT_MAX_BYTES, displayName: "Examen", category: "examen_medico",
  }));
  assert.throws(() => validateProgressUploadDraft({
    kind: "medical_document", mimeType: "application/pdf", extension: "pdf",
    bytes: PROGRESS_DOCUMENT_MAX_BYTES + 1, displayName: "Examen", category: "examen_medico",
  }), (error) => error instanceof ProgressContractError && error.code === "file_too_large");
});

test("el reporte conserva el orden exacto y no admite ownership enviado por cliente", () => {
  const normalized = normalizeProgressReportCommand({
    kind: "photos", assetIds: [id(2), id(1)], message: "  Evolución semanal  ", requestId: id(3),
  });
  assert.deepEqual(normalized.assetIds, [id(2), id(1)]);
  assert.equal(normalized.message, "Evolución semanal");
  assert.deepEqual(Object.keys(normalized).sort(), ["assetIds", "kind", "message", "requestId"]);
  for (const forbidden of ["studentUserId", "coachUserId", "relationshipEpisodeId", "ownerId", "profileId"]) {
    assert.ok(!Object.hasOwn(normalized, forbidden));
  }
});

test("rechaza BOLA por ids repetidos, ids inválidos y más de un documento", () => {
  for (const command of [
    { kind: "photos", assetIds: [id(1), id(1)], message: null, requestId: id(2) },
    { kind: "photos", assetIds: ["otro-owner"], message: null, requestId: id(2) },
    { kind: "medical_document", assetIds: [id(1), id(2)], message: null, requestId: id(3) },
    { kind: "video", assetIds: [id(1)], message: null, requestId: id(3) },
  ] as const) {
    assert.throws(
      () => normalizeProgressReportCommand(command as ProgressReportCommand),
      (error) => error instanceof ProgressContractError && error.code === "invalid_report",
    );
  }
});
