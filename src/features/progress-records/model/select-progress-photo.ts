import { PROGRESS_PHOTO_MAX_BYTES } from "./progress-records-contract";

export type StudentPhotoFormat = "jpeg" | "png" | "webp";

export interface SelectedProgressPhoto {
  readonly file: File;
  readonly format: StudentPhotoFormat;
}

// The format is only a staging hint. The publisher verifies the original bytes.
export function selectProgressPhoto(file: File): SelectedProgressPhoto {
  if (file.size < 1 || file.size > PROGRESS_PHOTO_MAX_BYTES) {
    throw new Error("progress_photo_invalid_size");
  }
  const byMime: Readonly<Record<string, StudentPhotoFormat>> = {
    "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp",
  };
  const byExtension: Readonly<Record<string, StudentPhotoFormat>> = {
    jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp",
  };
  const extension = file.name.includes(".") ? file.name.split(".").at(-1)?.toLowerCase() ?? "" : "";
  const extensionFormat = extension ? byExtension[extension] : undefined;
  if (extension && !extensionFormat) throw new Error("progress_photo_unsupported_file");
  const format = byMime[file.type.toLowerCase()]
    ?? ((file.type === "" || file.type === "application/octet-stream")
      ? extensionFormat : undefined);
  if (!format || (extensionFormat && extensionFormat !== format)) {
    throw new Error("progress_photo_unsupported_file");
  }
  return { file, format };
}
