import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

import type {
  CoachRegistrationWritePayload,
  LoginPayload,
  UserSignupPayload,
} from "@/features/auth/model/auth-form";
import type {
  AuthenticatedPortalIdentity,
  CoachRegistrationRecord,
  MultiportalAuthGateway,
  PortalSignOutReason,
  UserRegistrationRecord,
} from "@/features/auth/model/multiportal-auth-controller";
import { translateAuthError } from "@/lib/supabase/auth-errors";
import type { SupabaseSessionState } from "@/lib/supabase/session";
import type {
  CoachRegistrationOwner,
  PortalResolutionOwner,
  UserRegistrationOwner,
} from "@/features/auth/model/portal-resolution-owner";

const USER_REGISTRATION_COLUMNS = "user_id";
const COACH_REGISTRATION_COLUMNS =
  "user_id,created_at,first_name,last_name,birth_date,gender,phone_number,professional_title";

interface CoachRegistrationRow {
  user_id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string;
  phone_number: string;
  professional_title: string;
}

interface UserRegistrationRow {
  user_id: string;
}

export interface SupabaseMultiportalAuthGatewayOptions {
  createRegistrationClient?(): SupabaseClient;
  onBeforeSignOut?(reason: PortalSignOutReason, owner: PortalResolutionOwner): void;
  onSignOutError?(reason: PortalSignOutReason, owner: PortalResolutionOwner): void;
}

export class MultiportalAuthRepositoryError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "MultiportalAuthRepositoryError";
  }
}

export function createSupabaseMultiportalAuthGateway(
  supabase: SupabaseClient,
  options: SupabaseMultiportalAuthGatewayOptions = {},
): MultiportalAuthGateway<SupabaseSessionState> {
  let registrationClient: SupabaseClient | null = null;
  let registrationIdentityUserId: string | null = null;

  function getRegistrationClient() {
    registrationClient ??= options.createRegistrationClient?.() ?? createIsolatedRegistrationClient();
    return registrationClient;
  }

  function dataClientFor(expectedUserId: string) {
    return registrationClient && registrationIdentityUserId === expectedUserId
      ? registrationClient
      : supabase;
  }

  return {
    getCurrentIdentity(expectedUserId, owner) {
      return getAuthoritativeIdentity(supabase, expectedUserId, owner);
    },

    async signInForCoachRegistration(credentials: LoginPayload, owner) {
      if (!owner.isCurrent()) return { kind: "stale" };
      const isolatedClient = getRegistrationClient();
      const { data, error } = await isolatedClient.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });
      if (!owner.isCurrent()) return { kind: "stale" };
      if (error) {
        if (isInvalidCredentialsError(error)) return { kind: "invalid_credentials" };
        return { kind: "error", message: translateAuthError(error) };
      }

      const identity = data.user
        ? await getAuthoritativeIdentity(isolatedClient, data.user.id, owner)
        : null;
      if (!owner.isCurrent()) return { kind: "stale" };
      if (identity) registrationIdentityUserId = identity.userId;
      return identity
        ? { kind: "authenticated", identity }
        : { kind: "error", message: translateAuthError(new Error("auth session missing")) };
    },

    async signUpForCoachRegistration(payload: UserSignupPayload, owner) {
      if (!owner.isCurrent()) return { kind: "stale" };
      const isolatedClient = getRegistrationClient();
      const { data, error } = await isolatedClient.auth.signUp(payload);
      if (!owner.isCurrent()) return { kind: "stale" };
      if (error) return { kind: "error", message: translateAuthError(error) };
      if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
        return { kind: "existing_identity" };
      }
      if (!data.session) return { kind: "confirmation_required" };

      const identity = data.user
        ? await getAuthoritativeIdentity(isolatedClient, data.user.id, owner)
        : null;
      if (!owner.isCurrent()) return { kind: "stale" };
      if (identity) registrationIdentityUserId = identity.userId;
      return identity
        ? { kind: "authenticated", identity }
        : { kind: "error", message: translateAuthError(new Error("auth session missing")) };
    },

    async signInForUserRegistration(credentials: LoginPayload, owner) {
      if (!owner.isCurrent()) return { kind: "stale" };
      const isolatedClient = getRegistrationClient();
      const { data, error } = await isolatedClient.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });
      if (!owner.isCurrent()) return { kind: "stale" };
      if (error) {
        if (isInvalidCredentialsError(error)) return { kind: "invalid_credentials" };
        return { kind: "error", message: translateAuthError(error) };
      }

      const identity = data.user
        ? await getAuthoritativeIdentity(isolatedClient, data.user.id, owner)
        : null;
      if (!owner.isCurrent()) return { kind: "stale" };
      if (identity) registrationIdentityUserId = identity.userId;
      return identity
        ? { kind: "authenticated", identity }
        : { kind: "error", message: translateAuthError(new Error("auth session missing")) };
    },

    async signUpForUserRegistration(payload: UserSignupPayload, owner) {
      if (!owner.isCurrent()) return { kind: "stale" };
      const isolatedClient = getRegistrationClient();
      const { data, error } = await isolatedClient.auth.signUp(payload);
      if (!owner.isCurrent()) return { kind: "stale" };
      if (error) return { kind: "error", message: translateAuthError(error) };
      if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
        return { kind: "existing_identity" };
      }
      if (!data.session) return { kind: "confirmation_required" };

      const identity = data.user
        ? await getAuthoritativeIdentity(isolatedClient, data.user.id, owner)
        : null;
      if (!owner.isCurrent()) return { kind: "stale" };
      if (identity) registrationIdentityUserId = identity.userId;
      return identity
        ? { kind: "authenticated", identity }
        : { kind: "error", message: translateAuthError(new Error("auth session missing")) };
    },

    async hasUserRegistration(expectedUserId, owner) {
      const row = await readOwnUserRegistration(dataClientFor(expectedUserId), expectedUserId, owner);
      return row !== null;
    },

    async getCoachRegistration(expectedUserId, owner) {
      const row = await readOwnCoachRegistration(
        dataClientFor(expectedUserId),
        expectedUserId,
        owner,
      );
      return row;
    },

    async createCoachRegistration(payload, expectedUserId, owner) {
      if (!ownsRegistration(owner, expectedUserId)) throw staleRegistrationError();
      const client = dataClientFor(expectedUserId);
      const rpcPayload = toCoachRegistrationRpcPayload(payload, expectedUserId);
      const { data, error } = await client.rpc("register_own_coach", rpcPayload);
      if (error) {
        throw new MultiportalAuthRepositoryError("No pudimos registrar el acceso Coach.", error);
      }
      if (!ownsRegistration(owner, expectedUserId)) throw staleRegistrationError();
      const row = mapCoachRegistrationRow(data);
      if (!row || row.userId !== expectedUserId) {
        throw new MultiportalAuthRepositoryError("No pudimos confirmar el registro Coach.");
      }
      await requireAuthoritativeIdentity(client, expectedUserId, owner);
      if (!ownsRegistration(owner, expectedUserId)) throw staleRegistrationError();
      return row;
    },

    async createUserRegistration(expectedUserId, owner) {
      if (!ownsRegistration(owner, expectedUserId)) throw staleRegistrationError();
      const client = dataClientFor(expectedUserId);
      const { data, error } = await client.rpc("register_own_user");
      if (error) {
        throw new MultiportalAuthRepositoryError("No pudimos registrar el acceso Usuario.", error);
      }
      if (!ownsRegistration(owner, expectedUserId)) throw staleRegistrationError();
      const row = mapUserRegistrationRow(data);
      if (!row || row.userId !== expectedUserId) {
        throw new MultiportalAuthRepositoryError("No pudimos confirmar el registro Usuario.");
      }
      await requireAuthoritativeIdentity(client, expectedUserId, owner);
      if (!ownsRegistration(owner, expectedUserId)) throw staleRegistrationError();
      return row;
    },

    async activateUserRegistrationIdentity(identity, owner) {
      return activateRegistrationIdentity(supabase, identity, owner);
    },

    async activateCoachRegistrationIdentity(identity, owner) {
      if (!ownsRegistration(owner, identity.userId)) return null;
      const currentIdentity = await getAuthoritativeIdentity(supabase, undefined, owner);
      if (!owner.isCurrent()) return null;
      if (currentIdentity) {
        return currentIdentity.userId === identity.userId ? currentIdentity : null;
      }

      const session = identity.authState.session;
      if (!session?.access_token || !session.refresh_token) return null;
      if (!ownsRegistration(owner, identity.userId)) return null;
      const { data, error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (error) throw new MultiportalAuthRepositoryError("No pudimos activar la sesión Coach.", error);
      if (!ownsRegistration(owner, identity.userId)) return null;
      const activatedIdentity = mapAuthenticatedIdentity(data.session, data.user);
      if (!activatedIdentity || activatedIdentity.userId !== identity.userId) return null;
      return getAuthoritativeIdentity(supabase, identity.userId, owner);
    },

    async signOut(reason, owner) {
      if (!owner.isCurrent()) return "stale";
      const identity = await getAuthoritativeIdentity(supabase, owner.expectedUserId, owner);
      if (
        !identity
        || identity.userId !== owner.expectedUserId
        || !owner.isCurrent()
      ) {
        return "stale";
      }

      options.onBeforeSignOut?.(reason, owner);
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        options.onSignOutError?.(reason, owner);
        throw new MultiportalAuthRepositoryError("No pudimos cerrar la sesión.", error);
      }
      return "signed_out";
    },
  };
}

export function toCoachRegistrationInsertPayload(
  input: CoachRegistrationWritePayload,
): CoachRegistrationWritePayload {
  return {
    first_name: input.first_name,
    last_name: input.last_name,
    birth_date: input.birth_date,
    gender: input.gender,
    phone_number: input.phone_number,
    professional_title: input.professional_title,
  };
}

export function toCoachRegistrationRpcPayload(
  input: CoachRegistrationWritePayload,
  expectedUserId: string,
) {
  const payload = toCoachRegistrationInsertPayload(input);
  return {
    p_expected_user_id: expectedUserId,
    p_first_name: payload.first_name,
    p_last_name: payload.last_name,
    p_birth_date: payload.birth_date,
    p_gender: payload.gender,
    p_phone_number: payload.phone_number,
    p_professional_title: payload.professional_title,
  };
}

async function getAuthoritativeIdentity(
  supabase: SupabaseClient,
  expectedUserId?: string,
  owner?: { isCurrent(): boolean },
): Promise<AuthenticatedPortalIdentity<SupabaseSessionState> | null> {
  if (owner && !owner.isCurrent()) return null;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (owner && !owner.isCurrent()) return null;
  if (userError && isMissingSessionError(userError)) return null;
  if (userError) {
    throw new MultiportalAuthRepositoryError("No pudimos validar la sesión.", userError);
  }

  const user = userData.user;
  if (!user) return null;
  if (expectedUserId && user.id !== expectedUserId) {
    return null;
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (owner && !owner.isCurrent()) return null;
  if (sessionError) {
    throw new MultiportalAuthRepositoryError("No pudimos validar la sesión.", sessionError);
  }
  const session = sessionData.session;
  if (!session || session.user.id !== user.id) {
    return null;
  }

  return mapAuthenticatedIdentity(session, user);
}

async function requireAuthoritativeIdentity(
  supabase: SupabaseClient,
  expectedUserId: string,
  owner?: { isCurrent(): boolean },
) {
  const identity = await getAuthoritativeIdentity(supabase, expectedUserId, owner);
  if (!identity || identity.userId !== expectedUserId) {
    throw new MultiportalAuthRepositoryError("La identidad autenticada cambió.");
  }
  return identity;
}

async function activateRegistrationIdentity(
  supabase: SupabaseClient,
  identity: AuthenticatedPortalIdentity<SupabaseSessionState>,
  owner: UserRegistrationOwner,
): Promise<AuthenticatedPortalIdentity<SupabaseSessionState> | null> {
  if (!ownsRegistration(owner, identity.userId)) return null;
  const currentIdentity = await getAuthoritativeIdentity(supabase, undefined, owner);
  if (!owner.isCurrent()) return null;
  if (currentIdentity) {
    return currentIdentity.userId === identity.userId ? currentIdentity : null;
  }

  const session = identity.authState.session;
  if (!session?.access_token || !session.refresh_token) return null;
  if (!ownsRegistration(owner, identity.userId)) return null;
  const { data, error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw new MultiportalAuthRepositoryError("No pudimos activar la sesión Usuario.", error);
  if (!ownsRegistration(owner, identity.userId)) return null;
  const activatedIdentity = mapAuthenticatedIdentity(data.session, data.user);
  if (!activatedIdentity || activatedIdentity.userId !== identity.userId) return null;
  return getAuthoritativeIdentity(supabase, identity.userId, owner);
}

async function readOwnUserRegistration(
  supabase: SupabaseClient,
  expectedUserId: string,
  owner?: { isCurrent(): boolean },
): Promise<UserRegistrationRecord | null> {
  await requireAuthoritativeIdentity(supabase, expectedUserId, owner);
  if (owner && !owner.isCurrent()) throw staleRegistrationError();
  const { data, error } = await supabase
    .from("user_registrations")
    .select(USER_REGISTRATION_COLUMNS)
    .maybeSingle();
  if (error) {
    throw new MultiportalAuthRepositoryError("No pudimos validar el acceso Usuario.", error);
  }

  const row = mapUserRegistrationRow(data);
  if (row && row.userId !== expectedUserId) {
    throw new MultiportalAuthRepositoryError("La autorización Usuario no pertenece a la sesión.");
  }
  await requireAuthoritativeIdentity(supabase, expectedUserId, owner);
  return row;
}

async function readOwnCoachRegistration(
  supabase: SupabaseClient,
  expectedUserId: string,
  owner?: { isCurrent(): boolean },
): Promise<CoachRegistrationRecord | null> {
  await requireAuthoritativeIdentity(supabase, expectedUserId, owner);
  if (owner && !owner.isCurrent()) throw staleRegistrationError();
  const { data, error } = await supabase
    .from("coach_registrations")
    .select(COACH_REGISTRATION_COLUMNS)
    .maybeSingle();
  if (error) {
    throw new MultiportalAuthRepositoryError("No pudimos validar el acceso Coach.", error);
  }

  const row = mapCoachRegistrationRow(data);
  if (row && row.userId !== expectedUserId) {
    throw new MultiportalAuthRepositoryError("La autorización Coach no pertenece a la sesión.");
  }
  await requireAuthoritativeIdentity(supabase, expectedUserId, owner);
  return row;
}

function ownsRegistration(
  owner: CoachRegistrationOwner | UserRegistrationOwner,
  expectedUserId: string,
) {
  return owner.isCurrent() && owner.expectedUserId === expectedUserId;
}

function staleRegistrationError() {
  return new MultiportalAuthRepositoryError("La operación de registro ya no está vigente.");
}

function createIsolatedRegistrationClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/(?:rest|auth)\/v1\/?$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new MultiportalAuthRepositoryError("Supabase no está configurado.");
  }
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function mapAuthenticatedIdentity(
  session: Session | null,
  user: User | null,
): AuthenticatedPortalIdentity<SupabaseSessionState> | null {
  if (!session || !user || session.user.id !== user.id) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    authState: {
      isConfigured: true,
      dataMode: "supabase",
      session,
      user,
    },
  };
}

function mapCoachRegistrationRow(value: unknown): CoachRegistrationRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as CoachRegistrationRow;
  if (
    typeof row.user_id !== "string" ||
    typeof row.created_at !== "string" ||
    typeof row.first_name !== "string" ||
    typeof row.last_name !== "string" ||
    typeof row.birth_date !== "string" ||
    typeof row.gender !== "string" ||
    typeof row.phone_number !== "string" ||
    typeof row.professional_title !== "string"
  ) {
    throw new MultiportalAuthRepositoryError("La respuesta de autorización Coach no es válida.");
  }
  return {
    userId: row.user_id,
    createdAt: row.created_at,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    gender: row.gender,
    phoneNumber: row.phone_number,
    professionalTitle: row.professional_title,
  };
}

function mapUserRegistrationRow(value: unknown): UserRegistrationRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as UserRegistrationRow;
  if (typeof row.user_id !== "string") {
    throw new MultiportalAuthRepositoryError("La respuesta de autorización Usuario no es válida.");
  }
  return { userId: row.user_id };
}

function readErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String(error.code ?? "");
}

function readErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String(error.message ?? "").toLowerCase();
}

function isInvalidCredentialsError(error: unknown): boolean {
  return readErrorCode(error) === "invalid_credentials" ||
    readErrorMessage(error).includes("invalid login credentials");
}

function isMissingSessionError(error: unknown): boolean {
  return readErrorCode(error) === "session_not_found" ||
    readErrorMessage(error).includes("auth session missing");
}
