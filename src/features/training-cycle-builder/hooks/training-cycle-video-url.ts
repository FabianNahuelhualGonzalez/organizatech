const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

export type TrainingCycleVideoUrlValidation =
  | { readonly valid: true; readonly normalizedUrl: string | null; readonly videoId: string | null }
  | { readonly valid: false; readonly message: string };

function videoIdFromUrl(url: URL): string | null {
  if (url.hostname === "youtu.be") {
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length === 1 ? segments[0] : null;
  }

  if (url.pathname === "/watch") {
    const candidates = url.searchParams.getAll("v");
    return candidates.length === 1 ? candidates[0] : null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (
    segments.length === 2 &&
    (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live")
  ) {
    return segments[1];
  }

  return null;
}

/**
 * Acepta únicamente URLs HTTPS de YouTube con un identificador de video real.
 * Normaliza variantes válidas para evitar persistir parámetros o rutas ajenas.
 */
export function validateOptionalYouTubeVideoUrl(
  value: string,
): TrainingCycleVideoUrlValidation {
  const candidate = value.trim();
  if (!candidate) return { valid: true, normalizedUrl: null, videoId: null };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { valid: false, message: "Ingresa un enlace de YouTube válido." };
  }

  if (
    url.protocol !== "https:" ||
    !YOUTUBE_HOSTS.has(url.hostname) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return {
      valid: false,
      message: "Usa un enlace HTTPS de youtube.com o youtu.be, sin credenciales.",
    };
  }

  const videoId = videoIdFromUrl(url);
  if (!videoId || !YOUTUBE_VIDEO_ID.test(videoId)) {
    return { valid: false, message: "El enlace no contiene un video de YouTube válido." };
  }

  return {
    valid: true,
    videoId,
    normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function normalizeOptionalYouTubeVideoUrl(value: string): string | null {
  const validation = validateOptionalYouTubeVideoUrl(value);
  if (!validation.valid) throw new TypeError(validation.message);
  return validation.normalizedUrl;
}
