export const PROFILE_AVATAR_OUTPUT_SIZE = 512;
export const PROFILE_AVATAR_JPEG_QUALITY = 0.86;

export type AvatarSourceValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export interface AvatarImageFileLike {
  type: string;
  size?: number;
  name?: string;
}

export interface AvatarDrawFrame {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface AvatarEditorState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

const blockedAvatarSourceMimeTypes = new Set([
  "application/pdf",
  "image/gif",
  "image/svg+xml",
]);

export function validateAvatarSourceFile(file: AvatarImageFileLike | null | undefined): AvatarSourceValidationResult {
  if (!file) return { ok: false, error: "No pudimos cargar esta imagen. Prueba con otra foto." };

  const mimeType = normalizeMimeType(file.type);
  if (!mimeType || blockedAvatarSourceMimeTypes.has(mimeType) || mimeType.startsWith("video/")) {
    return { ok: false, error: "No pudimos cargar esta imagen. Prueba con otra foto." };
  }

  if (!mimeType.startsWith("image/")) {
    return { ok: false, error: "No pudimos cargar esta imagen. Prueba con otra foto." };
  }

  return { ok: true };
}

export function getAvatarEditorInitialState(): AvatarEditorState {
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

export function computeAvatarDrawFrame({
  imageWidth,
  imageHeight,
  outputSize = PROFILE_AVATAR_OUTPUT_SIZE,
  zoom,
  offsetX,
  offsetY,
}: {
  imageWidth: number;
  imageHeight: number;
  outputSize?: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}): AvatarDrawFrame {
  if (imageWidth <= 0 || imageHeight <= 0 || outputSize <= 0) {
    return { width: outputSize, height: outputSize, x: 0, y: 0 };
  }

  const safeZoom = Math.max(1, zoom);
  const coverScale = Math.max(outputSize / imageWidth, outputSize / imageHeight) * safeZoom;
  const width = imageWidth * coverScale;
  const height = imageHeight * coverScale;
  const clampedOffset = clampAvatarOffset({
    drawWidth: width,
    drawHeight: height,
    outputSize,
    offsetX,
    offsetY,
  });

  return {
    width,
    height,
    x: (outputSize - width) / 2 + clampedOffset.offsetX,
    y: (outputSize - height) / 2 + clampedOffset.offsetY,
  };
}

export function clampAvatarOffset({
  drawWidth,
  drawHeight,
  outputSize = PROFILE_AVATAR_OUTPUT_SIZE,
  offsetX,
  offsetY,
}: {
  drawWidth: number;
  drawHeight: number;
  outputSize?: number;
  offsetX: number;
  offsetY: number;
}) {
  const maxX = Math.max(0, (drawWidth - outputSize) / 2);
  const maxY = Math.max(0, (drawHeight - outputSize) / 2);

  return {
    offsetX: clamp(offsetX, -maxX, maxX),
    offsetY: clamp(offsetY, -maxY, maxY),
  };
}

export async function loadAvatarImage(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No pudimos cargar esta imagen. Prueba con otra foto."));
      image.src = objectUrl;
    });
    return image;
  } catch (error) {
    throw error instanceof Error ? error : new Error("No pudimos cargar esta imagen. Prueba con otra foto.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function exportAvatarImage({
  image,
  zoom,
  offsetX,
  offsetY,
  outputSize = PROFILE_AVATAR_OUTPUT_SIZE,
  quality = PROFILE_AVATAR_JPEG_QUALITY,
}: {
  image: HTMLImageElement;
  zoom: number;
  offsetX: number;
  offsetY: number;
  outputSize?: number;
  quality?: number;
}): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("No pudimos preparar la foto. Prueba con otra imagen.");

  const frame = computeAvatarDrawFrame({
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    outputSize,
    zoom,
    offsetX,
    offsetY,
  });

  context.fillStyle = "#07101a";
  context.fillRect(0, 0, outputSize, outputSize);
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) throw new Error("No pudimos preparar la foto. Prueba con otra imagen.");

  return new File([blob], "avatar.jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function normalizeMimeType(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
