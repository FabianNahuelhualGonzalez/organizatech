import type { AuthAccountType } from "./auth-route";
import { GOOGLE_OAUTH_INTENT_TTL_MS, parseGoogleOAuthCallback, type GoogleOAuthIntent, type OAuthIntentStorage } from "./google-oauth-intent";

export const GOOGLE_OAUTH_HANDOFF_KEY = "organizatech:google-oauth:portal-handoff:v1";

type Handoff = {
  version: 1;
  intentId: string;
  portal: AuthAccountType;
  createdAt: number;
  subject: string;
  phase: "transferring" | "ready";
};

// Navigation evidence only. Portal membership is always checked by the backend.
export function blockGoogleOAuthPortal(storage: OAuthIntentStorage) {
  storage.setItem(GOOGLE_OAUTH_HANDOFF_KEY, JSON.stringify({ version: 1, phase: "blocked" }));
}

export async function prepareGoogleOAuthPortalHandoff(
  storage: OAuthIntentStorage,
  intent: GoogleOAuthIntent,
  userId: string,
  assertCurrent: () => void,
) {
  const record: Handoff = {
    version: 1,
    intentId: intent.id,
    portal: intent.portal,
    createdAt: Date.now(),
    subject: await subjectDigest(intent.id, userId),
    phase: "transferring",
  };
  assertCurrent();
  storage.setItem(GOOGLE_OAUTH_HANDOFF_KEY, JSON.stringify(record));
  return {
    ready() {
      assertCurrent();
      if (storage.getItem(GOOGLE_OAUTH_HANDOFF_KEY) !== JSON.stringify(record)) {
        throw new Error("OAuth handoff was replaced.");
      }
      storage.setItem(GOOGLE_OAUTH_HANDOFF_KEY, JSON.stringify({ ...record, phase: "ready" }));
    },
    reject() {
      // Do not replace a newer OAuth attempt when this transfer became stale.
      const transferringRecord = JSON.stringify(record);
      const readyRecord = JSON.stringify({ ...record, phase: "ready" });
      try {
        const current = storage.getItem(GOOGLE_OAUTH_HANDOFF_KEY);
        if (current === transferringRecord || current === readyRecord) {
          blockGoogleOAuthPortal(storage);
        }
      } catch {
        // Storage failures remain fail-closed through the callback error path.
      }
    },
  };
}

export function createGoogleOAuthPortalHandoffGuard(input: {
  storage: OAuthIntentStorage | null;
  location: () => { pathname: string; search: string };
  now?: () => number;
}) {
  let accepted: Handoff | null = null;
  let rejected = false;
  let revision = 0;
  // A callback document may never mount a portal, even after error URL cleanup.
  const callbackDocument = Boolean(parseGoogleOAuthCallback(input.location()));
  function read(ignoreRejection = false): Handoff | "blocked" | null {
    if (rejected && !ignoreRejection) return "blocked";
    try {
      const raw = input.storage?.getItem(GOOGLE_OAUTH_HANDOFF_KEY);
      if (!raw) return accepted;
      const value = JSON.parse(raw) as Handoff;
      const now = input.now?.() ?? Date.now();
      if (!value || value.version !== 1
        || !/^[a-f0-9]{32,}$/.test(value.intentId)
        || !/^[a-f0-9]{64}$/.test(value.subject)
        || (value.portal !== "coach" && value.portal !== "usuario")
        || (value.phase !== "transferring" && value.phase !== "ready")
        || !Number.isSafeInteger(value.createdAt) || value.createdAt > now
        || now - value.createdAt > GOOGLE_OAUTH_INTENT_TTL_MS) {
        rejected = true;
        return "blocked";
      }
      return value;
    } catch {
      rejected = true;
      return "blocked";
    }
  }
  return {
    decision(): "continue" | "defer" | "reject_oauth" | "authorize_coach" | "authorize_user" {
      if (callbackDocument || parseGoogleOAuthCallback(input.location())) return "defer";
      const record = read();
      if (record === "blocked") return "reject_oauth";
      if (!record) return "continue";
      if (record.phase !== "ready") return "defer";
      return record.portal === "coach" ? "authorize_coach" : "authorize_user";
    },
    async validate(userId: string, portal: AuthAccountType): Promise<boolean> {
      const decision = this.decision();
      if (decision === "defer" || decision === "reject_oauth") return false;
      const record = read();
      if (!record) return true;
      if (record === "blocked" || record.portal !== portal
        || record.subject !== await subjectDigest(record.intentId, userId)) {
        rejected = true;
        return false;
      }
      // Recheck after the asynchronous digest; no replaced/expired intent may win.
      const current = read();
      if (JSON.stringify(current) !== JSON.stringify(record)) return false;
      return true;
    },
    capturePermit() {
      const capturedRevision = revision;
      const snapshot = JSON.stringify(read());
      return () => {
        // A subject mismatch must still publish the controlled error to this owner.
        // Replacement, expiry and reset invalidate the operation itself.
        const current = read(true);
        return capturedRevision === revision && !callbackDocument
          && !parseGoogleOAuthCallback(input.location())
          && current !== "blocked" && (!current || current.phase === "ready")
          && JSON.stringify(current) === snapshot;
      };
    },
    complete() {
      const record = read();
      if (!record || record === "blocked") return;
      accepted = record;
      input.storage?.removeItem(GOOGLE_OAUTH_HANDOFF_KEY);
    },
    reset() {
      revision += 1;
      accepted = null;
      rejected = false;
      try {
        input.storage?.removeItem(GOOGLE_OAUTH_HANDOFF_KEY);
      } catch {
        rejected = true;
      }
    },
  };
}

/**
 * Rehydrates the selected portal for the clean document that follows a Google
 * callback. This is navigation evidence only: callers must still resolve the
 * returned portal through the backend before publishing either portal.
 */
export function resolveGoogleOAuthPortalHandoffRoute(input: {
  storage: OAuthIntentStorage | null;
  location: () => { pathname: string; search: string };
}) {
  const decision = createGoogleOAuthPortalHandoffGuard(input).decision();
  if (decision === "authorize_coach") return "coach" as const;
  if (decision === "authorize_user") return "usuario" as const;
  return null;
}

async function subjectDigest(intentId: string, userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${intentId}:${userId}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
