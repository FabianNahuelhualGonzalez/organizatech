import type { CoachClient } from "./coach-client";

export type CoachInvitationEmailCheck =
  | { readonly kind: "empty"; readonly email: string }
  | { readonly kind: "invalid"; readonly email: string; readonly showError: boolean }
  | {
      readonly kind: "already-active" | "already-pending";
      readonly email: string;
      readonly clientId: string;
    }
  | { readonly kind: "valid"; readonly email: string };

export function normalizeCoachInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Local form feedback against an already authorized portfolio, not an account
 * lookup or a substitute for backend validation, uniqueness, and consent.
 */
export function checkCoachInvitationEmail(
  input: string,
  clients: readonly CoachClient[],
): CoachInvitationEmailCheck {
  const email = normalizeCoachInvitationEmail(input);
  if (!email) return { kind: "empty", email };
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    return { kind: "invalid", email, showError: email.includes("@") };
  }

  // A historical inactive entry must not hide a newer link or invitation.
  const active = clients.find((client) => client.state === "active"
    && normalizeCoachInvitationEmail(client.email) === email);
  if (active) return { kind: "already-active", email, clientId: active.id };
  const pending = clients.find((client) => client.state === "pending"
    && normalizeCoachInvitationEmail(client.email) === email);
  if (pending) return { kind: "already-pending", email, clientId: pending.id };
  return { kind: "valid", email };
}

/** Canonical compact form; ambiguous characters are rejected, never guessed. */
export function normalizeCoachInvitationCode(input: string): string | null {
  const candidate = input.trim();
  if (!/^[a-z2-9-]+$/i.test(candidate)) return null;
  const match = /^([A-HJ-NP-Z]{2}[2-9])-?([A-HJ-NP-Z]{2}[2-9])-?([A-HJ-NP-Z]{2}[2-9])$/
    .exec(candidate.toUpperCase());
  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

export function formatCoachInvitationCode(input: string): string | null {
  const code = normalizeCoachInvitationCode(input);
  return code === null ? null : `${code.slice(0, 3)}-${code.slice(3, 6)}-${code.slice(6, 9)}`;
}
