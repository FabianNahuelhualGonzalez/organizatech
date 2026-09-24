import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { attestPhoto, downloadPhoto, photoInput, uploadPhoto } from "./cloudinary-photo";
import { boundedPhotoForm } from "./photo-auth";

const config = { cloudName: "qa-cloud", apiKey: "test-key", apiSecret: "test-secret",
  attestationKey: "a".repeat(48) };
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 0, 0]);

test("rechaza PDF, contenido engañoso, extensión ajena y exceso de 20 MB", () => {
  assert.throws(() => photoInput(new Uint8Array(Buffer.from("%PDF-1.7")), "application/pdf", "x.pdf"));
  assert.throws(() => photoInput(jpeg, "image/png", "x.png"));
  assert.throws(() => photoInput(jpeg, "image/jpeg", "x.pdf"));
  assert.throws(() => photoInput(new Uint8Array(20 * 1024 * 1024 + 1), "image/jpeg", "x.jpg"));
  assert.equal(photoInput(jpeg, "image/jpeg", "x.jpeg").mime, "image/jpeg");
});

test("el límite multipart cuenta bytes reales aunque Content-Length mienta", async () => {
  const form = new FormData();
  form.set("pose", "frente");
  form.set("file", new Blob([jpeg], { type: "image/jpeg" }), "original.jpg");
  const valid = await boundedPhotoForm(new Request("http://local.invalid", { method: "POST", body: form }));
  assert.equal(valid.get("pose"), "frente");
  const oversized = new Request("http://local.invalid", { method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "1" },
    body: Buffer.alloc(21 * 1024 * 1024 + 1) });
  await assert.rejects(boundedPhotoForm(oversized), /photo_too_large/);
});

test("firma la carga en servidor, restringe formato y sanitiza antes de guardar el original", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.cloudinary.com/v1_1/qa-cloud/image/upload");
    assert.equal(init?.method, "POST");
    const body = init?.body as FormData;
    assert.equal(body.get("type"), "authenticated");
    assert.equal(body.get("allowed_formats"), "jpg,png,webp,heic");
    assert.equal(body.get("transformation"), "fl_force_strip");
    assert.equal(body.get("discard_original_filename"), "true");
    assert.equal(body.get("overwrite"), "false");
    assert.equal(body.get("folder"), null);
    const publicId = String(body.get("public_id"));
    assert.match(publicId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal((body.get("file") as File).name, `${publicId}.jpg`);
    const params = Object.fromEntries([...body.entries()].filter(([key]) => !["file", "signature", "api_key"].includes(key))) as Record<string, string>;
    const serialized = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`).join("&");
    assert.equal(body.get("signature"), createHash("sha1").update(serialized + config.apiSecret).digest("hex"));
    const version = 123456789;
    const signature = createHash("sha1").update(`public_id=${publicId}&version=${version}${config.apiSecret}`).digest("hex");
    return Response.json({ asset_id: "opaqueCloudinaryAssetId123", public_id: publicId,
      resource_type: "image", type: "authenticated", format: "jpg", version,
      bytes: jpeg.byteLength, width: 100, height: 200, signature, secure_url: "https://never-return.example" });
  };
  const result = await uploadPhoto(photoInput(jpeg, "image/jpeg", "private.jpg"), config, fetcher);
  assert.equal(result.mime, "image/jpeg");
  assert.equal(JSON.stringify(result).includes("secure_url"), false);
  const issuedAt = 123456789;
  assert.equal(attestPhoto("student", result, issuedAt, config.attestationKey),
    createHmac("sha256", config.attestationKey).update([
      "student", result.assetId, result.cloudinaryAssetId, result.mime,
      result.extension, result.bytes, result.width, result.height, issuedAt,
    ].join("|")).digest("hex"));
});

test("rechaza respuesta de proveedor sin tipo authenticated o firma válida", async () => {
  await assert.rejects(uploadPhoto(photoInput(jpeg, "image/jpeg", "x.jpg"), config,
    async () => Response.json({ public_id: "forged", type: "upload" })));
});

test("descarga autenticada envía firma sólo en cuerpo backend, sin URL entregable", async () => {
  await downloadPhoto("opaqueCloudinaryAssetId123", config, async (url, init) => {
    assert.equal(url, "https://api.cloudinary.com/v1_1/qa-cloud/asset/download");
    assert.equal(init?.method, "POST");
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("asset_id"), "opaqueCloudinaryAssetId123");
    assert.ok(body.get("signature"));
    return new Response(jpeg, { status: 200 });
  });
});
