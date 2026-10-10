import { COACH_COMMERCIAL_FREQUENCIES, type CoachCommercialFrequency } from "@/lib/coach-commercial-terms";
import { CoachInvitationsError } from "./coach-invitations-contract";

export function coachInvitationAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000_000) {
    throw new CoachInvitationsError("invalid_input");
  }
  return value;
}

export function coachInvitationFrequency(value: unknown): CoachCommercialFrequency {
  if (!COACH_COMMERCIAL_FREQUENCIES.includes(value as CoachCommercialFrequency)) {
    throw new CoachInvitationsError("invalid_input");
  }
  return value as CoachCommercialFrequency;
}

export function parseCoachInvitationAmount(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000_000_000 ? value : null;
}
