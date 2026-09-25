import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { cleanExpiredProgressPhotos, finalizeNextProgressPhoto,
  type ClaimedProgressPhoto, type ProgressPhotoPublicationPort } from "./progress-photo-finalizer";

const claim: ClaimedProgressPhoto = {
  uploadId: "10000000-0000-4000-8000-000000000001",
  stagingBucket: "progress-check-staging",
  stagingPath: "20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001.jpg",
  expectedMime: "image/jpeg",
  finalBucket: "progress-check-photos",
  finalPath: "40000000-0000-4000-8000-000000000001/50000000-0000-4000-8000-000000000001.jpg",
};

async function fixture() {
  const source = await sharp({ create: { width: 40, height: 20, channels: 3,
    background: "#446688" } }).jpeg().withExif({ IFD0: { Copyright: "fixture" } }).toBuffer();
  let staged = true;
  let final: Uint8Array | null = null;
  let published = false;
  let failed = false;
  let completed = false;
  let failStageRemoval = false;
  let corruptFinalRead = false;
  const port: ProgressPhotoPublicationPort = {
    claim: async () => claim,
    download: async (bucket) => {
      if (bucket === "progress-check-staging" && staged) {
        return { bytes: source, mimeType: "image/jpeg" };
      }
      if (bucket === "progress-check-photos" && final) {
        return { bytes: corruptFinalRead ? new Uint8Array(final.byteLength) : final,
          mimeType: "image/jpeg" };
      }
      throw new Error("missing");
    },
    upload: async (_bucket, _path, bytes) => { final = bytes; },
    remove: async (bucket) => {
      if (bucket === "progress-check-staging") {
        if (failStageRemoval) throw new Error("cleanup unavailable");
        staged = false;
      } else final = null;
    },
    publish: async () => { published = true; return "50000000-0000-4000-8000-000000000001"; },
    fail: async () => { failed = true; },
    claimCleanup: async () => [{ uploadId: claim.uploadId,
      stagingPath: claim.stagingPath, finalPath: claim.finalPath }],
    completeCleanup: async () => { completed = true; },
  };
  return { port, state: () => ({ staged, final, published, failed, completed }),
    failStageRemoval: () => { failStageRemoval = true; },
    recoverStageRemoval: () => { failStageRemoval = false; },
    corruptFinalRead: () => { corruptFinalRead = true; } };
}

test("publisher verifies stored bytes and removes staging before publication", async () => {
  const mock = await fixture();
  assert.deepEqual(await finalizeNextProgressPhoto(mock.port), {
    status: "published", assetId: "50000000-0000-4000-8000-000000000001",
  });
  assert.equal(mock.state().staged, false);
  assert.equal(mock.state().published, true);
  assert.equal(mock.state().failed, false);
});

test("failed cleanup never publishes and remains retryable within a bounded pass", async () => {
  const mock = await fixture();
  mock.failStageRemoval();
  assert.deepEqual(await finalizeNextProgressPhoto(mock.port), { status: "failed" });
  assert.equal(mock.state().published, false);
  assert.equal(mock.state().failed, true);
  assert.equal(mock.state().staged, true);
  mock.recoverStageRemoval();
  assert.equal(await cleanExpiredProgressPhotos(mock.port), 1);
  assert.equal(mock.state().staged, false);
  assert.equal(mock.state().completed, true);
});

test("different bytes read back from final Storage never become an asset", async () => {
  const mock = await fixture();
  mock.corruptFinalRead();
  assert.deepEqual(await finalizeNextProgressPhoto(mock.port), { status: "failed" });
  assert.equal(mock.state().published, false);
  assert.equal(mock.state().staged, false);
  assert.equal(mock.state().final, null);
});
