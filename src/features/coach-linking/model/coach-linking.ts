export const COACH_LINK_CODE_LENGTH = 9;
export const COACH_LINK_ENTRY_STORAGE_KEY = "organizatech.coach-link.entry.v1";
const ENTRY_TTL_MS = 8 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CoachLinkStoredEntry {
  readonly code: string;
  readonly resumeConfirmation: boolean;
  readonly requestId: string | null;
}

export type CoachLinkNotificationDestination =
  | { readonly kind: "student-coaching" }
  | { readonly kind: "coach-student"; readonly episodeId: string };

export function captureCoachLinkNotificationDestination(
  destination: string | null,
  episodeId: string | null,
): CoachLinkNotificationDestination | null {
  if (destination === "profile-coaching" && episodeId === null) {
    return { kind: "student-coaching" };
  }
  if (destination === null && episodeId !== null && UUID.test(episodeId)) {
    return { kind: "coach-student", episodeId };
  }
  return null;
}

export type CoachLinkLookupStatus =
  | "idle"
  | "incompleto"
  | "validando"
  | "invalido"
  | "ya_usado"
  | "no_corresponde"
  | "vencido"
  | "cancelado"
  | "ya_tiene_coach"
  | "error_red";

export type CoachLinkServerStatus = Exclude<CoachLinkLookupStatus, "idle" | "incompleto" | "validando">;

export type CoachLinkLookupResult =
  | { readonly status: "valido"; readonly coachName: string }
  | { readonly status: "ya_aceptado"; readonly coachName: string }
  | { readonly status: CoachLinkServerStatus };

export type CoachLinkAcceptResult =
  | { readonly status: "linked" | "already_linked"; readonly coachName: string }
  | { readonly status: CoachLinkServerStatus };

export type CoachLinkActiveResult =
  | { readonly status: "none" }
  | { readonly status: "linked"; readonly coachName: string };

export type CoachLinkActiveState = "loading" | "none" | "linked";

export const COACH_LINK_MESSAGES: Readonly<Record<Exclude<CoachLinkLookupStatus, "idle">, string>> = {
  incompleto: "Escribe los 9 caracteres del código.",
  validando: "Validando código…",
  invalido: "Error: este código no existe. Revisa que esté bien escrito.",
  ya_usado: "Error: este código ya fue usado. Pídele a tu coach uno nuevo.",
  no_corresponde: "Esta invitación está asociada a otro correo. Inicia sesión con el correo al que recibiste la invitación.",
  vencido: "Pendiente: este código venció. Pídele a tu coach que te comparta uno nuevo.",
  cancelado: "Pendiente: tu coach canceló esta invitación. Pídele que te envíe un código nuevo.",
  ya_tiene_coach: "Atención: ya tienes un coach activo. No puedes reemplazarlo desde aquí.",
  error_red: "No pudimos verificar el código. Revisa tu conexión e intenta de nuevo. Si ya se procesó, no se creará un vínculo duplicado.",
};

export function normalizeCoachLinkCode(value: string): { readonly clean: string; readonly display: string } {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, COACH_LINK_CODE_LENGTH);
  return {
    clean,
    display: [clean.slice(0, 3), clean.slice(3, 6), clean.slice(6, 9)].filter(Boolean).join("-"),
  };
}

export function isCompleteCoachLinkCode(value: string): boolean {
  return /^(?:[ABCDEFGHJKLMNPQRSTUVWXYZ]{2}[23456789]){3}$/.test(normalizeCoachLinkCode(value).clean);
}

export function coachInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

export function lookupMessageRole(status: CoachLinkLookupStatus): "alert" | "status" {
  return status === "invalido" || status === "ya_usado" || status === "no_corresponde"
    ? "alert"
    : "status";
}

export function captureCoachLinkEntry(
  queryValue: string | null,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  now = Date.now(),
): CoachLinkStoredEntry | null {
  const queryCode = queryValue ? normalizeCoachLinkCode(queryValue).clean : "";
  if (queryCode && isCompleteCoachLinkCode(queryCode)) {
    const entry = { code: queryCode, resumeConfirmation: false, requestId: null } as const;
    storage?.setItem(COACH_LINK_ENTRY_STORAGE_KEY, JSON.stringify({ ...entry, storedAt: now }));
    return entry;
  }
  if (!storage) return null;
  try {
    const raw = storage.getItem(COACH_LINK_ENTRY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      code?: unknown;
      storedAt?: unknown;
      resumeConfirmation?: unknown;
      requestId?: unknown;
    };
    const resumeConfirmation = parsed.resumeConfirmation === true;
    const requestId = typeof parsed.requestId === "string" ? parsed.requestId : null;
    if (typeof parsed.code !== "string" || typeof parsed.storedAt !== "number"
      || now - parsed.storedAt < 0 || now - parsed.storedAt > ENTRY_TTL_MS
      || !isCompleteCoachLinkCode(parsed.code)
      || (resumeConfirmation && (!requestId || !UUID.test(requestId)))
      || (!resumeConfirmation && requestId !== null)) {
      storage.removeItem(COACH_LINK_ENTRY_STORAGE_KEY);
      return null;
    }
    return {
      code: normalizeCoachLinkCode(parsed.code).clean,
      resumeConfirmation,
      requestId,
    };
  } catch {
    storage.removeItem(COACH_LINK_ENTRY_STORAGE_KEY);
    return null;
  }
}

export function persistCoachLinkEntry(
  storage: Pick<Storage, "setItem"> | null,
  code: string,
  requestId: string | null = null,
  now = Date.now(),
) {
  const clean = normalizeCoachLinkCode(code).clean;
  if (!isCompleteCoachLinkCode(clean) || (requestId !== null && !UUID.test(requestId))) return false;
  storage?.setItem(COACH_LINK_ENTRY_STORAGE_KEY, JSON.stringify({
    code: clean,
    resumeConfirmation: requestId !== null,
    requestId,
    storedAt: now,
  }));
  return true;
}

export function clearCoachLinkEntry(storage: Pick<Storage, "removeItem"> | null) {
  storage?.removeItem(COACH_LINK_ENTRY_STORAGE_KEY);
}
