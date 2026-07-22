import assert from "node:assert/strict";

import {
  downloadCycleHistoryPdf,
  type CycleHistoryPdfDownloadAnchor,
  type CycleHistoryPdfDownloadEnvironment,
} from "@/lib/training/cycle-history/cycle-history-pdf-download";

function createEnvironment(options: { failOnClick?: boolean } = {}) {
  const events: string[] = [];
  const anchor: CycleHistoryPdfDownloadAnchor = {
    download: "",
    href: "",
    rel: "",
    hidden: false,
    click() {
      events.push("click");
      if (options.failOnClick) throw new Error("simulated download failure");
    },
    remove() {
      events.push("remove");
    },
  };
  const environment: CycleHistoryPdfDownloadEnvironment = {
    createObjectUrl() {
      events.push("create-url");
      return "blob:fixture";
    },
    revokeObjectUrl(url) {
      events.push(`revoke:${url}`);
    },
    createAnchor() {
      events.push("create-anchor");
      return anchor;
    },
    appendAnchor() {
      events.push("append");
    },
  };
  return { anchor, environment, events };
}

function testDownloadUsesFilenameAndAlwaysCleansResources() {
  const fixture = createEnvironment();
  downloadCycleHistoryPdf(
    new Blob(["pdf"], { type: "application/pdf" }),
    "organizatech-ciclo-7-2026-07-21.pdf",
    fixture.environment,
  );

  assert.equal(fixture.anchor.download, "organizatech-ciclo-7-2026-07-21.pdf");
  assert.equal(fixture.anchor.href, "blob:fixture");
  assert.equal(fixture.anchor.rel, "noopener");
  assert.equal(fixture.anchor.hidden, true);
  assert.deepEqual(fixture.events, [
    "create-url",
    "create-anchor",
    "append",
    "click",
    "remove",
    "revoke:blob:fixture",
  ]);
  assert.doesNotMatch(fixture.anchor.download, /persona|example|cycle-pdf-qa/i);
}

function testDownloadFailureStillRemovesAnchorAndRevokesUrl() {
  const fixture = createEnvironment({ failOnClick: true });
  assert.throws(
    () => downloadCycleHistoryPdf(new Blob(["pdf"]), "historial.pdf", fixture.environment),
    /simulated download failure/,
  );
  assert.deepEqual(fixture.events.slice(-2), ["remove", "revoke:blob:fixture"]);
}

testDownloadUsesFilenameAndAlwaysCleansResources();
testDownloadFailureStillRemovesAnchorAndRevokesUrl();

console.log("cycle-history-pdf-download tests passed");
