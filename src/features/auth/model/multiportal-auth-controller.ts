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
  UserRegistrationOwner,
} from "@/features/auth/model/portal-resolution-owner";

export const USER_REGISTRATION_REQUIRED_MESSAGE =
  "Cuenta Usuario no registrada. Crea una cuenta Usuario para iniciar sesión.";
export const COACH_REGISTRATION_REQUIRED_MESSAGE =
  "Cuenta Coach no registrada. Crea una cuenta Coach para iniciar sesión.";
export const USER_REGISTRATION_CONFIRMATION_MESSAGE =
  "Muchas gracias por crear tu cuenta en Organizatech. Revisa tu correo y haz clic en el enlace de confirmación para activar tu cuenta. Después podrás iniciar sesión.";
export const COACH_REGISTRATION_CONFIRMATION_MESSAGE =
  "Muchas gracias por crear tu cuenta Coach en Organizatech. Revisa tu correo y haz clic en el enlace de confirmación para activar tu cuenta. Después podrás iniciar sesión como Coach.";
export const REGISTRATION_EXISTING_IDENTITY_MESSAGE =
  "Revisa tu correo para continuar. Si no recibes un mensaje, inicia sesión o recupera tu contraseña.";
export const USER_REGISTRATION_CONFIRMED_MESSAGE =
  "Correo confirmado correctamente. Tu cuenta Usuario está lista. Ya puedes iniciar sesión.";
export const COACH_REGISTRATION_CONFIRMED_MESSAGE =
  "Correo confirmado correctamente. Tu cuenta Coach está lista. Ya puedes iniciar sesión.";
export const SIGNUP_CONFIRMATION_INVALID_MESSAGE =
  "El enlace de confirmación es inválido, venció o ya fue utilizado.";
export const COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE =
  "Este correo ya se encuentra registrado como Coach. Intente con otro correo.";
export const MULTIPORTAL_AUTH_ERROR_MESSAGE =
  "No pudimos completar la acción. Intenta nuevamente.";
export const COACH_REGISTRATION_IDENTITY_MISMATCH_MESSAGE =
  "El correo debe coincidir con la sesión activa.";
export const COACH_REGISTRATION_IDENTITY_SWITCH_MESSAGE =
  "Hay una sesión activa con otro correo. Cierra sesión para registrar esta cuenta Coach.";
export const USER_REGISTRATION_IDENTITY_MISMATCH_MESSAGE =
  "El correo debe coincidir con la sesión activa.";

export type PortalSignOutReason =
  | "user_registration_required"
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
  createdAt: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  phoneNumber: string;
  professionalTitle: string;
}

export interface UserRegistrationRecord {
  userId: string;
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

export interface SignupConfirmationRecord {
  status: "confirmed" | "expired" | "invalid";
  portal: AuthAccountType | null;
}

export type SignupConfirmationResult =
  | {
    state: "confirmed";
    requestedPortal: AuthAccountType;
    message: typeof USER_REGISTRATION_CONFIRMED_MESSAGE
      | typeof COACH_REGISTRATION_CONFIRMED_MESSAGE;
  }
  | {
    state: "invalid";
    requestedPortal: AuthAccountType;
    message: typeof SIGNUP_CONFIRMATION_INVALID_MESSAGE;
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

export interface MultiportalAuthGateway<TAuthState> {
  getCurrentIdentity(
    expectedUserId?: string,
    owner?: CoachRegistrationOwner | UserRegistrationOwner | PortalResolutionOwner,
  ): Promise<AuthenticatedPortalIdentity<TAuthState> | null>;
  signInForCoachRegistration(
    credentials: LoginPayload,
    owner: CoachRegistrationOwner,
  ): Promise<RegistrationPasswordSignInResult<TAuthState>>;
  signUpForCoachRegistration(
    payload: CoachRegistrationPreparationPayload,
    owner: CoachRegistrationOwner,
  ): Promise<RegistrationSignupResult<TAuthState>>;
  signInForUserRegistration(
    credentials: LoginPayload,
    owner: UserRegistrationOwner,
  ): Promise<RegistrationPasswordSignInResult<TAuthState>>;
  signUpForUserRegistration(
    payload: UserSignupPayload,
    owner: UserRegistrationOwner,
  ): Promise<RegistrationSignupResult<TAuthState>>;
  getOwnSignupConfirmation(
    expectedUserId: string,
    owner: PortalResolutionOwner,
  ): Promise<SignupConfirmationRecord>;
  signOutAfterSignupConfirmation(
    expectedUserId: string,
    owner: PortalResolutionOwner,
  ): Promise<PortalSignOutResult>;
  hasUserRegistration(
    expectedUserId: string,
    owner?: PortalResolutionOwner | UserRegistrationOwner,
  ): Promise<boolean>;
  getCoachRegistration(
    expectedUserId: string,
    owner?: PortalResolutionOwner | CoachRegistrationOwner,
  ): Promise<CoachRegistrationRecord | null>;
  createCoachRegistration(
    payload: CoachRegistrationWritePayload,
    expectedUserId: string,
    owner: CoachRegistrationOwner,
  ): Promise<CoachRegistrationRecord>;
  createUserRegistration(
    expectedUserId: string,
    owner: UserRegistrationOwner,
  ): Promise<UserRegistrationRecord>;
  activateUserRegistrationIdentity(
    identity: AuthenticatedPortalIdentity<TAuthState>,
    owner: UserRegistrationOwner,
  ): Promise<AuthenticatedPortalIdentity<TAuthState> | null>;
  activateCoachRegistrationIdentity(
    identity: AuthenticatedPortalIdentity<TAuthState>,
    owner: CoachRegistrationOwner,
  ): Promise<AuthenticatedPortalIdentity<TAuthState> | null>;
  signOut(
    reason: PortalSignOutReason,
    owner: PortalResolutionOwner,
  ): Promise<PortalSignOutResult>;
  signOutForCoachIdentitySwitch(
    requestedEmail: string,
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
    coach: CoachRegistrationRecord;
  }
  | {
    state: "coach_registration_required";
    requestedPortal: "coach";
    message: typeof COACH_REGISTRATION_REQUIRED_MESSAGE;
  }
  | {
    state: "user_registration_required";
    requestedPortal: "usuario";
    message: typeof USER_REGISTRATION_REQUIRED_MESSAGE;
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
    coach: CoachRegistrationRecord;
    authState: TAuthState;
  }
  | {
    state: "coach_confirmation_required";
    requestedPortal: "coach";
    message: typeof COACH_REGISTRATION_CONFIRMATION_MESSAGE;
  }
  | {
    state: "identity_switch_required";
    requestedPortal: "coach";
    message: typeof COACH_REGISTRATION_IDENTITY_SWITCH_MESSAGE;
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

export type UserRegistrationResult<TAuthState> =
  | {
    state: "user_authorized";
    requestedPortal: "usuario";
    userId: string;
    authState: TAuthState;
  }
  | {
    state: "user_confirmation_required";
    requestedPortal: "usuario";
    message: typeof USER_REGISTRATION_CONFIRMATION_MESSAGE;
  }
  | {
    state: "error";
    requestedPortal: "usuario";
    message: string;
    field?: "register-email";
  }
  | {
    state: "busy";
    requestedPortal: "usuario";
  }
  | {
    state: "stale";
    requestedPortal: "usuario";
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
  registerUser(
    input: UserSignupPayload,
    owner: UserRegistrationOwner,
    gateway: MultiportalAuthGateway<TAuthState>,
  ): Promise<UserRegistrationResult<TAuthState>>;
  resolveSignupConfirmation(
    input: {
      expectedUserId: string;
      owner: PortalResolutionOwner;
    },
    gateway: MultiportalAuthGateway<TAuthState>,
  ): Promise<SignupConfirmationResult>;
  dispose(): void;
}

export function createMultiportalAuthController<TAuthState>(): MultiportalAuthController<TAuthState> {
  const registrationOwners = new Set<symbol>();
  const userRegistrationOwners = new Set<symbol>();
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

    registerUser(input, owner, gateway) {
      if (disposed || !owner.isCurrent()) {
        return Promise.resolve(staleUserRegistration());
      }
      if (userRegistrationOwners.has(owner.id)) {
        return Promise.resolve({ state: "busy", requestedPortal: "usuario" });
      }

      userRegistrationOwners.add(owner.id);
      return registerUser(input, owner, gateway).finally(() => {
        userRegistrationOwners.delete(owner.id);
      });
    },

    resolveSignupConfirmation(input, gateway) {
      if (disposed || !input.owner.isCurrent()) {
        return Promise.resolve({
          state: "stale",
          requestedPortal: "usuario",
        });
      }
      return resolveSignupConfirmation(input, gateway);
    },

    dispose() {
      disposed = true;
      registrationOwners.clear();
      userRegistrationOwners.clear();
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
      const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, input.owner);
      if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
      if (hasUserRegistration) {
        return {
          state: "user_authorized",
          requestedPortal: "usuario",
          userId: identity.userId,
        };
      }

      return rejectPortalSession(input, gateway, "user_registration_required");
    }

    const coachRegistration = await gateway.getCoachRegistration(identity.userId, input.owner);
    if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
    if (coachRegistration && coachRegistration.userId !== identity.userId) {
      return rejectPortalSession(input, gateway, "authorization_error");
    }
    if (coachRegistration) {
      return {
        state: "coach_authorized",
        requestedPortal: "coach",
        userId: identity.userId,
        coach: coachRegistration,
      };
    }

    return rejectPortalSession(input, gateway, "coach_registration_required");
  } catch {
    if (!ownsPortalResolution(input)) return stalePortalResolution(input.requestedPortal);
    return rejectPortalSession(input, gateway, "authorization_error");
  }
}

async function resolveSignupConfirmation<TAuthState>(
  input: {
    expectedUserId: string;
    owner: PortalResolutionOwner;
  },
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<SignupConfirmationResult> {
  const stale = (): SignupConfirmationResult => ({
    state: "stale",
    requestedPortal: "usuario",
  });
  if (!ownsPortalResolution(input)) return stale();

  try {
    const identity = await gateway.getCurrentIdentity(input.expectedUserId, input.owner);
    if (!ownsPortalResolution(input)) return stale();
    if (!identity || identity.userId !== input.expectedUserId) return stale();

    const confirmation = await gateway.getOwnSignupConfirmation(
      identity.userId,
      input.owner,
    );
    if (!ownsPortalResolution(input)) return stale();
    const requestedPortal = confirmation.portal ?? "usuario";
    if (confirmation.status !== "confirmed" || !confirmation.portal) {
      return {
        state: "invalid",
        requestedPortal,
        message: SIGNUP_CONFIRMATION_INVALID_MESSAGE,
      };
    }

    return {
      state: "confirmed",
      requestedPortal: confirmation.portal,
      message: confirmation.portal === "coach"
        ? COACH_REGISTRATION_CONFIRMED_MESSAGE
        : USER_REGISTRATION_CONFIRMED_MESSAGE,
    };
  } catch {
    if (!ownsPortalResolution(input)) return stale();
    return {
      state: "error",
      requestedPortal: "usuario",
      message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
    };
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

  if (reason === "user_registration_required") {
    return {
      state: "user_registration_required",
      requestedPortal: "usuario",
      message: USER_REGISTRATION_REQUIRED_MESSAGE,
    };
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
        state: "identity_switch_required",
        requestedPortal: "coach",
        message: COACH_REGISTRATION_IDENTITY_SWITCH_MESSAGE,
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
        const signup = await gateway.signUpForCoachRegistration(input, owner);
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
            message: REGISTRATION_EXISTING_IDENTITY_MESSAGE,
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

    const existingCoachRegistration = await gateway.getCoachRegistration(identity.userId, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (existingCoachRegistration) {
      if (existingCoachRegistration.userId !== identity.userId) {
        return controlledCoachRegistrationError();
      }
      return {
        state: "error",
        requestedPortal: "coach",
        field: "register-email",
        message: COACH_REGISTRATION_ALREADY_EXISTS_MESSAGE,
      };
    }

    const coachRegistration = existingCoachRegistration ?? await gateway.createCoachRegistration(
      input.registration,
      identity.userId,
      owner,
    );
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (coachRegistration.userId !== identity.userId) {
      return controlledCoachRegistrationError();
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
      coach: coachRegistration,
      authState: activatedIdentity.authState,
    };
  } catch {
    if (!owner.isCurrent()) return staleCoachRegistration();
    return controlledCoachRegistrationError();
  }
}

async function registerUser<TAuthState>(
  input: UserSignupPayload,
  owner: UserRegistrationOwner,
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<UserRegistrationResult<TAuthState>> {
  if (!owner.isCurrent()) return staleUserRegistration();
  try {
    let identity = await gateway.getCurrentIdentity(owner.expectedUserId ?? undefined, owner);
    if (!owner.isCurrent()) return staleUserRegistration();
    if (identity && !owner.bindExpectedUserId(identity.userId)) return staleUserRegistration();
    if (identity && !sameEmail(identity.email, input.email)) {
      return {
        state: "error",
        requestedPortal: "usuario",
        field: "register-email",
        message: USER_REGISTRATION_IDENTITY_MISMATCH_MESSAGE,
      };
    }

    if (!identity) {
      const signIn = await gateway.signInForUserRegistration({
        email: input.email,
        password: input.password,
      }, owner);
      if (!owner.isCurrent() || signIn.kind === "stale") return staleUserRegistration();
      if (signIn.kind === "authenticated") {
        identity = signIn.identity;
      } else if (signIn.kind === "invalid_credentials") {
        if (!owner.isCurrent()) return staleUserRegistration();
        const signup = await gateway.signUpForUserRegistration(input, owner);
        if (!owner.isCurrent() || signup.kind === "stale") return staleUserRegistration();
        if (signup.kind === "authenticated") {
          identity = signup.identity;
        } else if (signup.kind === "confirmation_required") {
          return {
            state: "user_confirmation_required",
            requestedPortal: "usuario",
            message: USER_REGISTRATION_CONFIRMATION_MESSAGE,
          };
        } else if (signup.kind === "existing_identity") {
          return {
            state: "error",
            requestedPortal: "usuario",
            message: REGISTRATION_EXISTING_IDENTITY_MESSAGE,
          };
        } else {
          return controlledUserRegistrationError(signup.message);
        }
      } else {
        return controlledUserRegistrationError(signIn.message);
      }
    }

    if (!owner.isCurrent() || !owner.bindExpectedUserId(identity.userId)) {
      return staleUserRegistration();
    }
    if (!sameEmail(identity.email, input.email)) {
      return {
        state: "error",
        requestedPortal: "usuario",
        field: "register-email",
        message: USER_REGISTRATION_IDENTITY_MISMATCH_MESSAGE,
      };
    }

    const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, owner);
    if (!owner.isCurrent()) return staleUserRegistration();
    if (!hasUserRegistration) {
      const registration = await gateway.createUserRegistration(identity.userId, owner);
      if (!owner.isCurrent()) return staleUserRegistration();
      if (registration.userId !== identity.userId) {
        return controlledUserRegistrationError();
      }
    }

    const activatedIdentity = await gateway.activateUserRegistrationIdentity(identity, owner);
    if (!owner.isCurrent()) return staleUserRegistration();
    if (!activatedIdentity || activatedIdentity.userId !== identity.userId) {
      return controlledUserRegistrationError();
    }
    return {
      state: "user_authorized",
      requestedPortal: "usuario",
      userId: activatedIdentity.userId,
      authState: activatedIdentity.authState,
    };
  } catch {
    if (!owner.isCurrent()) return staleUserRegistration();
    return controlledUserRegistrationError();
  }
}

function staleCoachRegistration(): CoachRegistrationResult<never> {
  return { state: "stale", requestedPortal: "coach" };
}

function staleUserRegistration(): UserRegistrationResult<never> {
  return { state: "stale", requestedPortal: "usuario" };
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

function controlledUserRegistrationError(message = MULTIPORTAL_AUTH_ERROR_MESSAGE): UserRegistrationResult<never> {
  return {
    state: "error",
    requestedPortal: "usuario",
    message,
  };
}

function sameEmail(left: string | null, right: string): boolean {
  return typeof left === "string" && left.trim().toLowerCase() === right.trim().toLowerCase();
}
