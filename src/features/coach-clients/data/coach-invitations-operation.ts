import {
  CoachInvitationsError,
  type CapturedCoachInvitationsOperation,
  type CoachInvitationsIdentity,
  type CoachInvitationsPinnedClient,
} from "./coach-invitations-contract";

interface AuthUser { readonly id: string }
/** Existing principal only. Never construct or mutate a shared Auth session here. */
export interface CoachInvitationsPrincipal {
  readonly auth: {
    getSession(): PromiseLike<{
      readonly data: { readonly session: { readonly user: AuthUser; readonly access_token: string } | null };
      readonly error: unknown;
    }>;
    getUser(accessToken: string): PromiseLike<{
      readonly data: { readonly user: AuthUser | null };
      readonly error: unknown;
    }>;
  };
}

/** Called only inside the repository's total capture + transport deadline.
 * Non-abortable Auth calls may settle late; every continuation checks the signal
 * before another Auth call or creation of a pinned transport. */
export async function captureCoachInvitationsOperation<Client = CoachInvitationsPinnedClient>(input: {
  readonly principal: CoachInvitationsPrincipal;
  readonly identity: CoachInvitationsIdentity;
  readonly isCurrent: (snapshot: CoachInvitationsIdentity) => boolean;
  readonly createPinnedClient: (accessToken: string) => Client;
  readonly signal: AbortSignal;
}): Promise<Omit<CapturedCoachInvitationsOperation, "client"> & { readonly client: Client }> {
  const { principal, identity, isCurrent, createPinnedClient, signal } = input;
  const assertCurrent = () => {
    if (signal.aborted) throw new CoachInvitationsError("aborted");
    if (!isCurrent(identity)) throw new CoachInvitationsError("operation_stale");
  };
  assertCurrent();
  const result = await principal.auth.getSession();
  assertCurrent();
  const session = result.data.session;
  if (result.error || !session || session.user.id !== identity.userId
    || typeof session.access_token !== "string" || !session.access_token || /\s/.test(session.access_token)) {
    throw new CoachInvitationsError("forbidden");
  }
  // Preserve exactly the credential verified below, never re-read mutable Auth.
  const accessToken = session.access_token;
  const verified = await principal.auth.getUser(accessToken);
  assertCurrent();
  if (verified.error || verified.data.user?.id !== identity.userId) {
    throw new CoachInvitationsError("forbidden");
  }
  return Object.freeze({ identity, client: createPinnedClient(accessToken),
    isCurrent: (snapshot: CoachInvitationsIdentity) => snapshot.userId === identity.userId
      && snapshot.generation === identity.generation && isCurrent(identity),
  });
}
