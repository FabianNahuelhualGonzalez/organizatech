import type {
  CoachRegistrationPreparationPayload,
  CoachRegistrationSubmission,
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
  "Si corresponde, completa la confirmación desde tu correo. También puedes iniciar sesión, recuperar tu contraseña o usar otro correo de acceso.";
export const COACH_REGISTRATION_CONFIRMATION_MESSAGE =
  USER_REGISTRATION_CONFIRMATION_MESSAGE;
export const USER_REGISTRATION_CONFIRMED_MESSAGE =
  "Correo confirmado correctamente. Tu cuenta Usuario está lista. Ya puedes iniciar sesión.";
export const COACH_REGISTRATION_CONFIRMED_MESSAGE =
  "Correo confirmado correctamente. Tu cuenta Coach está lista. Ya puedes iniciar sesión.";
export const SIGNUP_CONFIRMATION_INVALID_MESSAGE =
  "El enlace de confirmación es inválido, venció o ya fue utilizado.";
export const MULTIPORTAL_AUTH_ERROR_MESSAGE =
  "No pudimos completar la acción. Intenta nuevamente.";
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
  contactEmail: string;
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
  signUpForCoachRegistration(
    payload: CoachRegistrationPreparationPayload,
    owner: CoachRegistrationOwner,
  ): Promise<RegistrationSignupResult<TAuthState>>;
  createSharedCoachRegistration(
    payload: CoachRegistrationWritePayload,
    expectedUserId: string,
    owner: CoachRegistrationOwner,
  ): Promise<CoachRegistrationRecord>;
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
    owner: PortalResolutionOwner | CoachRegistrationOwner,
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

export type SharedCoachRegistrationPreparationResult<TAuthState> =
  | {
    state: "authorized";
    userId: string;
    authState: TAuthState;
  }
  | { state: "sign_in_required" }
  | { state: "error" }
  | { state: "stale" };

export type SharedCoachLoginCompletionResult<TAuthState> =
  | Extract<SharedCoachRegistrationPreparationResult<TAuthState>, { state: "authorized" }>
  | {
    state: "rejected";
    message: typeof MULTIPORTAL_AUTH_ERROR_MESSAGE;
  }
  | {
    state: "error";
    message: typeof MULTIPORTAL_AUTH_ERROR_MESSAGE;
  }
  | { state: "busy" | "stale" };

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
    input: CoachRegistrationSubmission,
    owner: CoachRegistrationOwner,
    gateway: MultiportalAuthGateway<TAuthState>,
  ): Promise<CoachRegistrationResult<TAuthState>>;
  prepareSharedCoachRegistration(
    expectedUserId: string | undefined,
    owner: CoachRegistrationOwner,
    gateway: MultiportalAuthGateway<TAuthState>,
  ): Promise<SharedCoachRegistrationPreparationResult<TAuthState>>;
  completeSharedCoachLogin(
    expectedUserId: string,
    owner: CoachRegistrationOwner,
    gateway: MultiportalAuthGateway<TAuthState>,
  ): Promise<SharedCoachLoginCompletionResult<TAuthState>>;
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
  const sharedCoachLoginOwners = new Set<symbol>();
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

    prepareSharedCoachRegistration(expectedUserId, owner, gateway) {
      if (disposed || !owner.isCurrent()) {
        return Promise.resolve({ state: "stale" });
      }
      return prepareSharedCoachRegistration(expectedUserId, owner, gateway);
    },

    completeSharedCoachLogin(expectedUserId, owner, gateway) {
      if (disposed || !ownsSharedCoachLogin(owner, expectedUserId)) {
        return Promise.resolve({ state: "stale" });
      }
      if (sharedCoachLoginOwners.has(owner.id)) {
        return Promise.resolve({ state: "busy" });
      }

      sharedCoachLoginOwners.add(owner.id);
      return completeSharedCoachLogin(expectedUserId, owner, gateway).finally(() => {
        sharedCoachLoginOwners.delete(owner.id);
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
      sharedCoachLoginOwners.clear();
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
  input: CoachRegistrationSubmission,
  owner: CoachRegistrationOwner,
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<CoachRegistrationResult<TAuthState>> {
  return input.flow === "shared"
    ? registerSharedCoach(input.registration, owner, gateway)
    : registerSeparateCoach(input, owner, gateway);
}

async function prepareSharedCoachRegistration<TAuthState>(
  expectedUserId: string | undefined,
  owner: CoachRegistrationOwner,
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<SharedCoachRegistrationPreparationResult<TAuthState>> {
  if (!owner.isCurrent()) return { state: "stale" };
  try {
    const identity = await gateway.getCurrentIdentity(expectedUserId, owner);
    if (!owner.isCurrent()) return { state: "stale" };
    if (!identity || (expectedUserId && identity.userId !== expectedUserId)) {
      return { state: "sign_in_required" };
    }
    if (!owner.bindExpectedUserId(identity.userId)) return { state: "stale" };
    const hasUserRegistration = await gateway.hasUserRegistration(identity.userId, owner);
    if (!owner.isCurrent()) return { state: "stale" };
    if (!hasUserRegistration) return { state: "sign_in_required" };
    return {
      state: "authorized",
      userId: identity.userId,
      authState: identity.authState,
    };
  } catch {
    return owner.isCurrent() ? { state: "error" } : { state: "stale" };
  }
}

async function completeSharedCoachLogin<TAuthState>(
  expectedUserId: string,
  owner: CoachRegistrationOwner,
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<SharedCoachLoginCompletionResult<TAuthState>> {
  if (!ownsSharedCoachLogin(owner, expectedUserId)) return { state: "stale" };

  const preparation = await prepareSharedCoachRegistration(expectedUserId, owner, gateway);
  if (!ownsSharedCoachLogin(owner, expectedUserId)) return { state: "stale" };
  if (preparation.state === "authorized") {
    return preparation.userId === expectedUserId ? preparation : { state: "stale" };
  }
  if (preparation.state === "stale") return preparation;

  try {
    const signOutResult = await gateway.signOut("authorization_error", owner);
    if (signOutResult === "stale") return { state: "stale" };
    return {
      state: "rejected",
      message: MULTIPORTAL_AUTH_ERROR_MESSAGE,
    };
  } catch {
    return ownsSharedCoachLogin(owner, expectedUserId)
      ? { state: "error", message: MULTIPORTAL_AUTH_ERROR_MESSAGE }
      : { state: "stale" };
  }
}

function ownsSharedCoachLogin(
  owner: CoachRegistrationOwner,
  expectedUserId: string,
) {
  return owner.isCurrent() && owner.expectedUserId === expectedUserId;
}

async function registerSharedCoach<TAuthState>(
  registration: CoachRegistrationWritePayload,
  owner: CoachRegistrationOwner,
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<CoachRegistrationResult<TAuthState>> {
  if (!owner.isCurrent()) return staleCoachRegistration();
  try {
    const currentIdentity = await gateway.getCurrentIdentity(owner.expectedUserId ?? undefined, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (!currentIdentity || !owner.bindExpectedUserId(currentIdentity.userId)) {
      return controlledCoachRegistrationError();
    }
    const hasUserRegistration = await gateway.hasUserRegistration(currentIdentity.userId, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (!hasUserRegistration) return controlledCoachRegistrationError();

    const coachRegistration = await gateway.createSharedCoachRegistration(
      registration,
      currentIdentity.userId,
      owner,
    );
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (coachRegistration.userId !== currentIdentity.userId) {
      return controlledCoachRegistrationError();
    }
    return {
      state: "coach_authorized",
      requestedPortal: "coach",
      userId: currentIdentity.userId,
      coach: coachRegistration,
      authState: currentIdentity.authState,
    };
  } catch {
    if (!owner.isCurrent()) return staleCoachRegistration();
    return controlledCoachRegistrationError();
  }
}

async function registerSeparateCoach<TAuthState>(
  input: CoachRegistrationPreparationPayload & { flow: "separate" },
  owner: CoachRegistrationOwner,
  gateway: MultiportalAuthGateway<TAuthState>,
): Promise<CoachRegistrationResult<TAuthState>> {
  if (!owner.isCurrent()) return staleCoachRegistration();
  try {

    const signup = await gateway.signUpForCoachRegistration(input, owner);
    if (!owner.isCurrent() || signup.kind === "stale") return staleCoachRegistration();
    if (signup.kind === "confirmation_required" || signup.kind === "existing_identity") {
      return {
        state: "coach_confirmation_required",
        requestedPortal: "coach",
        message: COACH_REGISTRATION_CONFIRMATION_MESSAGE,
      };
    }
    if (signup.kind === "error") {
      return controlledCoachRegistrationError();
    }
    const identity = signup.identity;

    if (!owner.isCurrent() || !owner.bindExpectedUserId(identity.userId)) {
      return staleCoachRegistration();
    }

    const coachRegistration = await gateway.getCoachRegistration(identity.userId, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (!coachRegistration || coachRegistration.userId !== identity.userId) {
      return controlledCoachRegistrationError();
    }

    const activeIdentity = await gateway.getCurrentIdentity(undefined, owner);
    if (!owner.isCurrent()) return staleCoachRegistration();
    if (activeIdentity && activeIdentity.userId !== identity.userId) {
      return {
        state: "coach_confirmation_required",
        requestedPortal: "coach",
        message: COACH_REGISTRATION_CONFIRMATION_MESSAGE,
      };
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
        } else if (
          signup.kind === "confirmation_required"
          || signup.kind === "existing_identity"
        ) {
          return {
            state: "user_confirmation_required",
            requestedPortal: "usuario",
            message: USER_REGISTRATION_CONFIRMATION_MESSAGE,
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
