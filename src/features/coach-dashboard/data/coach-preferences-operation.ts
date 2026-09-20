import {
  CoachPreferencesError,
  type CoachPreferencesOperation,
  type CoachPreferencesPinnedClient,
} from "./coach-preferences-contract";
import { waitForCoachPreferencesAuth, withCoachPreferencesDeadline } from "./coach-preferences-deadline";

interface AuthUser { readonly id: string }

export interface CoachPreferencesPrincipal {
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

/** Captures identity once; server RPCs independently enforce Coach membership. */
export async function captureCoachPreferencesOperation(input: {
  readonly principal: CoachPreferencesPrincipal;
  readonly expectedUserId: string;
  readonly isCurrent: () => boolean;
  readonly createPinnedClient: (accessToken: string) => CoachPreferencesPinnedClient;
  /** Forward the repository signal to share one total capture + RPC deadline. */
  readonly signal?: AbortSignal;
  /** Standalone capture only. The repository owns the budget when signal is supplied. */
  readonly timeoutMilliseconds?: number;
}): Promise<CoachPreferencesOperation> {
  const capture = async (signal: AbortSignal): Promise<CoachPreferencesOperation> => {
    const assertCurrent = () => {
      if (signal.aborted) throw new CoachPreferencesError("timeout");
      if (!input.isCurrent()) throw new CoachPreferencesError("operation_stale");
    };
    assertCurrent();
    const result = await waitForCoachPreferencesAuth(input.principal.auth.getSession(), signal);
    assertCurrent();
    const session = result.data.session;
    if (result.error || !session || session.user.id !== input.expectedUserId || !session.access_token) {
      throw new CoachPreferencesError("forbidden");
    }
    const token = session.access_token;
    const identity = await waitForCoachPreferencesAuth(input.principal.auth.getUser(token), signal);
    assertCurrent();
    if (identity.error || identity.data.user?.id !== input.expectedUserId) {
      throw new CoachPreferencesError("forbidden");
    }
    return { client: input.createPinnedClient(token), isCurrent: input.isCurrent };
  };
  return input.signal ? capture(input.signal) : withCoachPreferencesDeadline(capture, input.timeoutMilliseconds);
}
