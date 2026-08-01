import { buildWorkoutShareImageFilename } from "@/lib/training/workout-share-model";

const PNG_MIME_TYPE = "image/png";
export const WORKOUT_SHARE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export interface WorkoutShareImageActionInput {
  readonly png: Blob;
  readonly generatedAt: string;
}

export interface WorkoutShareImageShareData<TFile> {
  readonly files: readonly TFile[];
}

export interface WorkoutShareImageDownloadData {
  readonly objectUrl: string;
  readonly filename: string;
}

export interface WorkoutShareImageActionPorts<TFile> {
  readonly createFile: (blob: Blob, filename: string, type: typeof PNG_MIME_TYPE) => TFile;
  readonly canShare: (data: Readonly<WorkoutShareImageShareData<TFile>>) => boolean;
  readonly share: (data: Readonly<WorkoutShareImageShareData<TFile>>) => Promise<void>;
  readonly createObjectUrl: (file: TFile) => string;
  readonly download: (data: Readonly<WorkoutShareImageDownloadData>) => Promise<void>;
  readonly revokeObjectUrl: (objectUrl: string) => void;
  readonly isAbortError: (error: unknown) => boolean;
}

export type WorkoutShareImageActionResult =
  | { readonly kind: "shared" }
  | { readonly kind: "downloaded" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed" };

export async function executeWorkoutShareImageAction<TFile>(
  input: Readonly<WorkoutShareImageActionInput>,
  ports: Readonly<WorkoutShareImageActionPorts<TFile>>,
): Promise<WorkoutShareImageActionResult> {
  if (
    input.png.type !== PNG_MIME_TYPE
    || input.png.size === 0
    || input.png.size > WORKOUT_SHARE_IMAGE_MAX_BYTES
  ) {
    return { kind: "failed" };
  }

  const filename = buildWorkoutShareImageFilename({ generatedAt: input.generatedAt });
  let file: TFile;
  try {
    file = ports.createFile(input.png, filename, PNG_MIME_TYPE);
  } catch {
    return { kind: "failed" };
  }

  const shareData: WorkoutShareImageShareData<TFile> = { files: [file] };
  let shareSupported = false;
  try {
    shareSupported = ports.canShare(shareData);
  } catch {
    shareSupported = false;
  }

  if (shareSupported) {
    let sharePromise: Promise<void>;
    try {
      sharePromise = ports.share(shareData);
    } catch (error) {
      if (isSafeAbortError(error, ports.isAbortError)) return { kind: "cancelled" };
      return downloadWorkoutShareImage(file, filename, ports);
    }

    try {
      await sharePromise;
      return { kind: "shared" };
    } catch (error) {
      if (isSafeAbortError(error, ports.isAbortError)) return { kind: "cancelled" };
      return downloadWorkoutShareImage(file, filename, ports);
    }
  }

  return downloadWorkoutShareImage(file, filename, ports);
}

function isSafeAbortError(
  error: unknown,
  isAbortError: (error: unknown) => boolean,
): boolean {
  try {
    return isAbortError(error);
  } catch {
    return false;
  }
}

async function downloadWorkoutShareImage<TFile>(
  file: TFile,
  filename: string,
  ports: Readonly<WorkoutShareImageActionPorts<TFile>>,
): Promise<WorkoutShareImageActionResult> {
  let objectUrl: string;
  try {
    objectUrl = ports.createObjectUrl(file);
  } catch {
    return { kind: "failed" };
  }

  let result: WorkoutShareImageActionResult = { kind: "failed" };
  try {
    await ports.download({ objectUrl, filename });
    result = { kind: "downloaded" };
  } catch {
    result = { kind: "failed" };
  } finally {
    try {
      ports.revokeObjectUrl(objectUrl);
    } catch {
      result = { kind: "failed" };
    }
  }
  return result;
}
