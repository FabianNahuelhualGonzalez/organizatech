export interface CycleHistoryPdfDownloadAnchor {
  download: string;
  href: string;
  rel: string;
  hidden: boolean;
  click(): void;
  remove(): void;
}

export interface CycleHistoryPdfDownloadEnvironment {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  createAnchor(): CycleHistoryPdfDownloadAnchor;
  appendAnchor(anchor: CycleHistoryPdfDownloadAnchor): void;
}

export function downloadCycleHistoryPdf(
  blob: Blob,
  filename: string,
  environment: CycleHistoryPdfDownloadEnvironment = createBrowserDownloadEnvironment(),
): void {
  const objectUrl = environment.createObjectUrl(blob);
  let anchor: CycleHistoryPdfDownloadAnchor | null = null;

  try {
    anchor = environment.createAnchor();
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.hidden = true;
    environment.appendAnchor(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    environment.revokeObjectUrl(objectUrl);
  }
}

function createBrowserDownloadEnvironment(): CycleHistoryPdfDownloadEnvironment {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    appendAnchor: (anchor) => document.body.appendChild(anchor as HTMLAnchorElement),
  };
}
