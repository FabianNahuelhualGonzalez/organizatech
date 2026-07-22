import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { CycleHistoryLoadState } from "@/lib/training/cycle-history/cycle-history-coordinator";
import {
  CYCLE_HISTORY_PDF_PUBLIC_ERROR,
  createCycleHistoryPdfActionController,
  resolveCycleHistoryPdfModel,
  type CycleHistoryPdfActionState,
} from "@/lib/training/cycle-history/cycle-history-pdf-action";
import { buildCycleHistoryPdfTestDetailState } from "@/lib/training/cycle-history/cycle-history-pdf-test-fixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function testModelResolutionRequiresEveryCycleIdToMatch() {
  const validState = buildCycleHistoryPdfTestDetailState();
  const cycleId = validState.cycleId;
  assert.equal(resolveCycleHistoryPdfModel(cycleId, validState), validState.data.pdfModel);

  assert.equal(resolveCycleHistoryPdfModel("other-cycle", validState), null);
  assert.equal(resolveCycleHistoryPdfModel(cycleId, { ...validState, cycleId: "other-cycle" }), null);
  assert.equal(resolveCycleHistoryPdfModel(cycleId, {
    ...validState,
    data: {
      ...validState.data,
      metadata: { ...validState.data.metadata, cycleId: "other-cycle" },
    },
  }), null);
  assert.equal(resolveCycleHistoryPdfModel(cycleId, {
    ...validState,
    data: {
      ...validState.data,
      pdfModel: {
        ...validState.data.pdfModel,
        cycle: { ...validState.data.pdfModel.cycle, cycleId: "other-cycle" },
      },
    },
  }), null);
}

async function testReadyAndEmptyGenerateUsingTheModelFilename() {
  for (const status of ["ready", "empty"] as const) {
    const detailState = buildCycleHistoryPdfTestDetailState(status);
    const downloads: string[] = [];
    const controller = createCycleHistoryPdfActionController({
      renderPdf: async () => new Blob(["pdf"]),
      downloadPdf: (_blob, filename) => downloads.push(filename),
    });

    assert.equal(
      await controller.generate(detailState.cycleId, detailState, () => true),
      true,
    );
    assert.deepEqual(downloads, [detailState.data.pdfModel.filename]);
    assert.deepEqual(controller.getState(), {
      isBusy: false,
      cycleId: detailState.cycleId,
      error: null,
    });
  }
}

async function testNonGeneratableStatesNeverRender() {
  let renderCalls = 0;
  const controller = createCycleHistoryPdfActionController({
    renderPdf: async () => {
      renderCalls += 1;
      return new Blob(["pdf"]);
    },
  });
  const states: CycleHistoryLoadState[] = [
    { status: "idle" },
    { status: "disabled" },
    { status: "loading", cycleId: "cycle-pdf-qa" },
    {
      status: "error",
      cycleId: "cycle-pdf-qa",
      error: { code: "fixture", message: "Mensaje público" },
    },
  ];

  for (const state of states) {
    assert.equal(await controller.generate("cycle-pdf-qa", state, () => true), false);
  }
  assert.equal(renderCalls, 0);
}

async function testBusyLockRejectsASecondGeneration() {
  const pendingRender = deferred<Blob>();
  const detailState = buildCycleHistoryPdfTestDetailState();
  let renderCalls = 0;
  let downloadCalls = 0;
  const controller = createCycleHistoryPdfActionController({
    renderPdf: () => {
      renderCalls += 1;
      return pendingRender.promise;
    },
    downloadPdf: () => {
      downloadCalls += 1;
    },
  });

  const first = controller.generate(detailState.cycleId, detailState, () => true);
  const second = await controller.generate(detailState.cycleId, detailState, () => true);
  assert.equal(second, false);
  assert.equal(renderCalls, 1);
  assert.equal(controller.getState().isBusy, true);

  pendingRender.resolve(new Blob(["pdf"]));
  assert.equal(await first, true);
  assert.equal(downloadCalls, 1);
  assert.equal(controller.getState().isBusy, false);
}

async function testPublicErrorAndFinallyStateOnRenderOrDownloadFailure() {
  const detailState = buildCycleHistoryPdfTestDetailState();
  for (const failure of ["render", "download"] as const) {
    const controller = createCycleHistoryPdfActionController({
      renderPdf: async () => {
        if (failure === "render") throw new Error("private renderer details");
        return new Blob(["pdf"]);
      },
      downloadPdf: () => {
        if (failure === "download") throw new Error("private browser details");
      },
    });

    assert.equal(await controller.generate(detailState.cycleId, detailState, () => true), false);
    assert.deepEqual(controller.getState(), {
      isBusy: false,
      cycleId: detailState.cycleId,
      error: CYCLE_HISTORY_PDF_PUBLIC_ERROR,
    });
    assert.doesNotMatch(controller.getState().error ?? "", /private|renderer|browser/i);
  }
}

async function testCycleChangePreventsLateDownload() {
  const detailState = buildCycleHistoryPdfTestDetailState();

  const changedRender = deferred<Blob>();
  let changedDownloads = 0;
  const changedController = createCycleHistoryPdfActionController({
    renderPdf: () => changedRender.promise,
    downloadPdf: () => {
      changedDownloads += 1;
    },
  });
  const changedResult = changedController.generate(detailState.cycleId, detailState, () => false);
  changedRender.resolve(new Blob(["pdf"]));
  assert.equal(await changedResult, false);
  assert.equal(changedDownloads, 0);
  assert.equal(changedController.getState().error, null);
}

async function testInvalidatePublishesInitialStateAndKeepsOldFinallyStale() {
  const detailState = buildCycleHistoryPdfTestDetailState();
  const firstRender = deferred<Blob>();
  const secondRender = deferred<Blob>();
  const renders = [firstRender, secondRender];
  const listenerStates: CycleHistoryPdfActionState[] = [];
  let renderIndex = 0;
  let downloadCalls = 0;
  const controller = createCycleHistoryPdfActionController({
    renderPdf: () => renders[renderIndex++].promise,
    downloadPdf: () => {
      downloadCalls += 1;
    },
  });
  const unsubscribe = controller.subscribe((state) => listenerStates.push({ ...state }));

  const firstResult = controller.generate(detailState.cycleId, detailState, () => true);
  controller.invalidate();
  assert.deepEqual(listenerStates[listenerStates.length - 1], {
    isBusy: false,
    cycleId: null,
    error: null,
  });

  const secondResult = controller.generate(detailState.cycleId, detailState, () => true);
  firstRender.resolve(new Blob(["old-pdf"]));
  assert.equal(await firstResult, false);
  assert.equal(downloadCalls, 0);
  assert.deepEqual(controller.getState(), {
    isBusy: true,
    cycleId: detailState.cycleId,
    error: null,
  });

  secondRender.resolve(new Blob(["new-pdf"]));
  assert.equal(await secondResult, true);
  assert.equal(downloadCalls, 1);
  assert.equal(controller.getState().isBusy, false);

  const listenerCallCount = listenerStates.length;
  unsubscribe();
  controller.invalidate();
  assert.equal(listenerStates.length, listenerCallCount);
  assert.deepEqual(controller.getState(), { isBusy: false, cycleId: null, error: null });
}

function testReactAndSourceContracts() {
  const actionSource = readFileSync(
    "src/lib/training/cycle-history/cycle-history-pdf-action.ts",
    "utf8",
  );
  const containerSource = readFileSync(
    "src/components/training/cycle-history/CycleHistoryProductiveContainer.tsx",
    "utf8",
  );
  const selectedSource = readFileSync(
    "src/components/training/cycle-history/CycleHistorySelectedCycle.tsx",
    "utf8",
  );

  assert.doesNotMatch(actionSource, /supabase|repository|data-source/i);
  assert.match(containerSource, /createCycleHistoryPdfActionController\(\)/);
  assert.match(containerSource, /pdfActionController\.invalidate\(\)/);
  assert.match(containerSource, /currentState\.expandedCycleId === requestedCycleId/);
  assert.match(containerSource, /currentState\.detailState === capturedDetailState/);
  const handler = /function handleDownloadPdf[\s\S]*?\n  }\n\n  return/.exec(containerSource)?.[0] ?? "";
  assert.ok(handler.length > 0);
  assert.doesNotMatch(handler, /Supabase|loadCycleDetail|createRepository|dataSource/i);
  assert.match(selectedSource, /aria-busy={isPdfActionBusy}/);
  assert.match(selectedSource, /className={styles\.pdfActionError} role="alert"/);
}

async function run() {
  testModelResolutionRequiresEveryCycleIdToMatch();
  await testReadyAndEmptyGenerateUsingTheModelFilename();
  await testNonGeneratableStatesNeverRender();
  await testBusyLockRejectsASecondGeneration();
  await testPublicErrorAndFinallyStateOnRenderOrDownloadFailure();
  await testCycleChangePreventsLateDownload();
  await testInvalidatePublishesInitialStateAndKeepsOldFinallyStale();
  testReactAndSourceContracts();
  console.log("cycle-history-pdf-action tests passed");
}

void run();
