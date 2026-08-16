import type {
  CoachRegistrationPreparationPayload,
  CoachRegistrationWritePayload,
  LoginPayload,
  UserSignupPayload,
} from "@/features/auth/model/auth-form";
import type { AuthAccountType } from "@/features/auth/model/auth-route";
import type {
  CoachRegistrationOwner,
  PortalResolutionOwner,
} from "@/features/auth/model/portal-resolution-owner";

export const COACH_REGISTRATION_REQUIRED_MESSAGE =
  "Cuenta Coach no registrada. Crea una cuenta Coach para iniciar sesión.";
export const COACH_REGISTRATION_CONFIRMATION_MESSAGE =
  "Cuenta creada. Revisa tu correo para confirmar el registro.";
export const MULTIPORTAL_AUTH_ERROR_MESSAGE =
  "No pudimos completar la acción. Intenta nuevamente.";
export const COACH_REGISTRATION_IDENTITY_MISMATCH_MESSAGE =
  "El correo debe coincidir con la sesión activa.";

export type PortalSignOutReason =
  | "coach_registration_required"
  | "authorization_error";

export type PortalSignOutResult = "signed_out" | "stale";

export interface AuthenticatedPortalIdentity<TAuthState> {
  userId: string;
  email: string | null;
  authState: TAuthState;
}

export interface CoachRegistrationRecord {
  userId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  phoneNumber: string;
  professionalTitle: string;
}

export type RegistrationPasswordSignInResult<TAuthState> =
  | { kind: "authenticated"; identity: AuthenticatedPortalIdentity<TAuthState> }
  | { kind: "invalid_credentials" }
  | { kind: "stale" }
  | { kind: "error"; message: string };

export type RegistrationSignupResult<TAuthState> =
  | { kind: "authenticated"; identity: AuthenticatedPortalIdentity<TAuthState> }
  | { kind: "confirmation_required" }
  | { kind: "existing_identity" }
  | { kind: "stale" }
  | { kind: "error"; message: string };

export interface MultiportalAuthGateway<TAuthState> {
  getCurrentIdentity(
    expectedUserId?: string,
    owner?: CoachRegistrationOwner,
  ): Promise<AuthenticatedPortalIdentity<TAuthState> | null>;
  signInForCoachRegistration(
    credentials: LoginPayload,
    owner: CoachRegistrationOwner,
  ): Promise<RegistrationPasswordSignInResult<TAuthState>>;
  signUpForCoachRegistration(
    payload: UserSignupPayload,
    owner: CoachRegistrationOwner,
  ): Promise<RegistrationSignupResult<TAuthState>>;
  hasCoachRegistration(
    expectedUserId: string,
    owner?: PortalResolutionOwner | CoachRegistrationOwner,
  ): Promise<boolean>;
  createCoachRegistration(
    payload: CoachRegistrationWritePayload,
    expectedUserId: string,
    owner: CoachRegistrationOwner,
  ): Promise<CoachRegistrationRecord>;
  activateCoachRegistrationIdentity(
    identity: AuthenticatedPortalIdentity<TAuthState>,
    owner: CoachRegistrationOwner,
  ): Promise<AuthenticatedPortalIdentity<TAuthState> | null>;
  signOut(
    reason: PortalSignOutReason,
    owner: PortalResolutionOwner,
  ): Promise<PortalSignOutResult>;
}

export type PortalAccessResult =
  | {
    state: "user_authorized";
    requestedPortal: "usuario";
    userId: string;
  }
  | {
    state: "coach_authorized";
    requestedPortal: "coach";
    userId: string;
  }
  | {
    state: "coach_registration_required";
    requestedPortal: "coach";
    message: typeof COACH_REGISTRATION_REQUIRED_MESSAGE;
  }
  | {
    state: "error";
    requestedPortal: AuthAccountType;
    message: typeof MULTIPORTAL_AUTH_ERROR_MESSAGE;
  }
  | {
    state: "stale";
    requestedPortal: AuthAccountType;
  };

export type AuthorizedPortalAccess = Extract<
  PortalAccessResult,
  { state: "user_authorized" | "coach_authorized" }
>;

export type CoachRegistrationResult<TAuthState> =
  | {
    state: "coach_authorized";
    requestedPortal: "coach";
    userId: string;
    authState: TAuthState;
  }
  | {
    state: "coach_confirmation_required";
    requestedPortal: "coach";
    message: typeof COACH_REGISTRATION_CONFIRMATION_MESSAGE;
  }
  | {
    state: "error";
    requestedPortal: "coach";
    message: string;
    field?: "register-email";
  }
  | {
    state: "busy";
    requestedPortal: "coach";
  }
  | {
    state: "stale";
    requestedPortal: "coach";
  };

export interface MultiportalAuthController<TAuthState> {
  resolvePortalAccess(
    input: {
      requestedPortal: AuthAccountType;
      expectedUserId: string;
      owner: PortalResolutionOwner;
    },
    gateway: MultiportalAuthGateway<TAuthState>,
  ): Promise<PortalAccessResult>;
  registerCoach(
    input: CoachRegistrationPreparationPayload,
    owner: CoachRegistrationOwner,
    gateway: MultiportalAuthGateway<TAuthState>,
  ): Promise<CoachRegistrationResult<TAuthState>>;
  dispose(): void;
}

export function createMultiportalAuthController<TAuthState>(): MultiportalAuthController<TAuthState> {
  const registrationOwners = new Set<symbol>();
  let disposed = false;

  return {
    resolvePortalAccess(input, gateway) {
      return resolvePortalAccess(input, gateway);
    },

    registerCoach(input, owner, gateway) {
      if (disposed || !owner.isCurrent()) {
        return Promise.resolve(staleCoachRegistration());
      }
      if (registrationOwners.has(owner.id)) {
        return Promise.resolve({ state: "busy", requestedPortal: "coach" });
      }

      registrationOwners.add(owner.id);
      return registerCoach(input, owner, gateway).finally(() => {
        registrationOwners.delete(owner.id);
      });
    },

    dispose() {
      disposed = true;
      registrationOwners.clear();
    },
  };
}

async function resolvePortalAccess<TAuthState>(
  input: {
    requestedPortal: AuthAccountType;
    expectedUserId: string;
    owner: PortalResolutionOwner;
  },
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<PortalAccessResult> {
  if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);

  try {
    const identity = await gateway.getCurrentIdentity(input.expectedUserId);
    if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
    if (!identity || identity.userId !== input.expectedUserId) {
      return rejectPortalSession(input, gateway, "authorization_error");
    }

    if (input.requestedPortal === "usuario") {
      return {
        state: "user_authorized",
        requestedPortal: "usuario",
        userId: identity.userId,
      };
    }

    const hasCoachRegistration = await gateway.hasCoachRegistration(identity.userId, input.owner);
    if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
    if (hasCoachRegistration) {
      return {
        state: "coach_authorized",
        requestedPortal: "coach",
        userId: identity.userId,
      };
    }

    return rejectPortalSession(input, gateway, "coach_registration_required");
  } catch {
    if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
    return rejectPortalSession(input, gateway, "authorization_error");
  }
}

async function rejectPortalSession<TAuthState>(
  input: {
    requestedPortal: AuthAccountType;
    expectedUserId: string;
    owner: PortalResolutionOwner;
  },
  gateway: MultiportalAuthGateway<TAuthState>,
  reason: PortalSignOutReason,
): Promise<PortalAccessResult> {
  if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);

  try {
    const signOutResult = await gateway.signOut(reason, input.owner);
    if (signOutResult === "stale") return stalePortalResolution(input.requestedPortal);
  } catch {
    if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
    return controlledPortalError(input.requestedPortal);
  }

  if (reason === "coach_registration_required") {
    return {
      state: "coach_registration_required",
      requestedPortal: "coach",
      message: COACH_REGISTRATION_REQUIRED_MESSAGE,
    };
  }
  return controlledPortalError(input.requestedPortal);
}

function ownsPortalResolution(input: {
  expectedUserId: string;
  owner: PortalResolutionOwner;
}) {
  return input.owner.expectedUserId === input.expectedUserId && input.owner.isCurrent();
}

function stalePortalResolution(requestedPortal: AuthAccountType): PortalAccessResult {
  return { state: "stale", requestedPortal };
}

async function registerCoach<TAuthState>(
  input: CoachRegistrationPreparationPayload,
  owner: CoachRegistrationOwner,
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<CoachRegistrationResult<TAuthState>> {
  if (!owner.isCurrent()) return staleCoachRegistration();
  try {
    let identity = await gateway.getCurrentIdentity(owner.expectedUserId ?? undefined, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (identity && !owner.bindExpectedUserId(identity.userId)) return staleCoachRegistration();
    if (identity && !sameEmail(identity.email, input.auth.email)) {
      return {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_IDENTITY_MISMATCH_MESSAGE,
      };
    }

    if (!identity) {
      const signIn = await gateway.signInForCoachRegistration({
        email: input.auth.email,
        password: input.auth.password,
      }, owner);
      if (!owner.isCurrent() || signIn.kind === "stale") return staleCoachRegistration();
      if (signIn.kind === "authenticated") {
        identity = signIn.identity;
      } else if (signIn.kind === "invalid_credentials") {
        if (!owner.isCurrent()) return staleCoachRegistration();
        const signup = await gateway.signUpForCoachRegistration(input.auth, owner);
        if (!owner.isCurrent() || signup.kind === "stale") return staleCoachRegistration();
        if (signup.kind === "authenticated") {
          identity = signup.identity;
        } else if (signup.kind === "confirmation_required") {
          return {
            state: "coach_confirmation_required",
            requestedPortal: "coach",
            message: COACH_REGISTRATION_CONFIRMATION_MESSAGE,
          };
        } else if (signup.kind === "existing_identity") {
          return {
            state: "error",
            requestedPortal: "coach",
            field: "register-email",
            message: "Este correo ya está registrado. Inicia sesión con esa cuenta para agregar el acceso Coach.",
          };
        } else {
          return controlledCoachRegistrationError(signup.message);
        }
      } else {
        return controlledCoachRegistrationError(signIn.message);
      }
    }

    if (!owner.isCurrent() || !owner.bindExpectedUserId(identity.userId)) {
      return staleCoachRegistration();
    }
    if (!sameEmail(identity.email, input.auth.email)) {
      return {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_IDENTITY_MISMATCH_MESSAGE,
      };
    }

    const hasCoachRegistration = await gateway.hasCoachRegistration(identity.userId, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (!hasCoachRegistration) {
      const registration = await gateway.createCoachRegistration(
        input.registration,
        identity.userId,
        owner,
      );
      if (!owner.isCurrent()) return staleCoachRegistration();
      if (registration.userId !== identity.userId) {
        return controlledCoachRegistrationError();
      }
    }

    const activatedIdentity = await gateway.activateCoachRegistrationIdentity(identity, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (!activatedIdentity || activatedIdentity.userId !== identity.userId) {
      return controlledCoachRegistrationError();
    }
    return {
      state: "coach_authorized",
      requestedPortal: "coach",
      userId: activatedIdentity.userId,
      authState: activatedIdentity.authState,
    };
  } catch {
    if (!owner.isCurrent()) return staleCoachRegistration();
    return controlledCoachRegistrationError();
  }
}

function staleCoachRegistration(): CoachRegistrationResult<never> {
  return { state: "stale", requestedPortal: "coach" };
}

function controlledPortalError(requestedPortal: AuthAccountType): PortalAccessResult {
  return {
    state: "error",
    requestedPortal,
    message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
  };
}

function controlledCoachRegistrationError(message = MULTIPORTAL_AUTH_ERROR_MESSAGE): CoachRegistrationResult<never> {
  return {
    state: "error",
    requestedPortal: "coach",
    message,
  };
}

function sameEmail(left: string | null, right: string): boolean {
  return typeof left === "string" && left.trim().toLowerCase() === right.trim().toLowerCase();
}
