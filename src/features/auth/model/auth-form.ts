import {
  isValidSignupEmailFormat,
  validateSignupEmail,
} from "@/lib/auth/signup-email-validation";
import {
  buildProfilePersonalDataPayload,
} from "@/lib/profile/profile-form";

export const COACH_PROFESSIONAL_TITLE_MAX_LENGTH = 160;
export const COACH_CONTACT_EMAIL_MAX_LENGTH = 254;
export const AUTH_REGISTRATION_PORTAL_METADATA_KEY =
  "organizatech_registration_portal" as const;
export const AUTH_REGISTRATION_GENDER_VALUES = [
  "male",
  "female",
  "non_binary",
  "prefer_not_to_say",
] as const;

export type AuthRegistrationGender = typeof AUTH_REGISTRATION_GENDER_VALUES[number];

export type AuthFieldName =
  | "login-email"
  | "login-password"
  | "register-first-name"
  | "register-last-name"
  | "register-birth-date"
  | "register-gender"
  | "register-phone-number"
  | "register-professional-title"
  | "register-contact-email"
  | "register-email"
  | "register-password"
  | "register-confirm-password"
  | "recovery-email"
  | "new-password"
  | "new-password-confirm";

export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>;

export interface LoginPayload {
  email: string;
  password: string;
}

export interface UserSignupMetadata {
  display_name: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: AuthRegistrationGender;
  phone_number: string;
}

export interface UserSignupPayload {
  email: string;
  password: string;
  options: {
    data: UserSignupMetadata;
    emailRedirectTo?: string;
  };
}

export type ConfirmationRegistrationMetadata =
  | (UserSignupMetadata & {
    organizatech_registration_portal: "usuario";
  })
  | (UserSignupMetadata & {
    organizatech_registration_portal: "coach";
    professional_title: string;
    contact_email: string;
  });

export interface ConfirmationRegistrationSignupPayload {
  email: string;
  password: string;
  options: {
    data: ConfirmationRegistrationMetadata;
    emailRedirectTo: string;
  };
}

export interface CoachRegistrationWritePayload {
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: AuthRegistrationGender;
  phone_number: string;
  professional_title: string;
  contact_email: string;
}

export interface CoachRegistrationPreparationPayload {
  auth: UserSignupPayload;
  registration: CoachRegistrationWritePayload;
}

export type CoachRegistrationSubmission =
  | ({ flow: "separate" } & CoachRegistrationPreparationPayload)
  | { flow: "shared"; registration: CoachRegistrationWritePayload };

export type AuthFormPreparation<T> =
  | { ok: true; payload: T }
  | { ok: false; field: AuthFieldName; message: string };

export function buildLoginPayload(formData: FormData): AuthFormPreparation<LoginPayload> {
  const email = readText(formData, "login-email").toLowerCase();
  const password = readRawText(formData, "login-password");

  if (!email) return { ok: false, field: "login-email", message: "Ingresa tu correo electrónico." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, field: "login-email", message: "Ingresa un correo electrónico válido." };
  }
  if (!password) return { ok: false, field: "login-password", message: "Ingresa tu contraseña." };

  return { ok: true, payload: { email, password } };
}

export function buildUserSignupPayload(
  formData: FormData,
  referenceDate = new Date(),
): AuthFormPreparation<UserSignupPayload> {
  const profile = buildRegistrationProfilePayload(formData, referenceDate);
  if (!profile.ok) return profile;
  const rawEmail = readRawText(formData, "register-email");
  const email = rawEmail.trim().toLowerCase();
  const password = readRawText(formData, "register-password");
  const confirmPassword = readRawText(formData, "register-confirm-password");

  if (!email) return { ok: false, field: "register-email", message: "Ingresa tu correo electrónico." };

  const emailValidation = validateSignupEmail(rawEmail);
  if (emailValidation) return { ok: false, field: "register-email", message: emailValidation };

  if (!password) return { ok: false, field: "register-password", message: "Crea una contraseña." };
  if (password.length < 8) {
    return { ok: false, field: "register-password", message: "La contraseña debe tener al menos 8 caracteres." };
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, field: "register-password", message: "La contraseña debe incluir letras y números." };
  }
  if (!confirmPassword) {
    return { ok: false, field: "register-confirm-password", message: "Confirma tu contraseña." };
  }
  if (password !== confirmPassword) {
    return { ok: false, field: "register-confirm-password", message: "Las contraseñas no coinciden." };
  }

  return {
    ok: true,
    payload: {
      email,
      password,
      options: {
        data: {
          ...profile.payload,
        },
      },
    },
  };
}

export function buildCoachRegistrationPayload(
  formData: FormData,
  referenceDate = new Date(),
): AuthFormPreparation<CoachRegistrationPreparationPayload> {
  const auth = buildUserSignupPayload(formData, referenceDate);
  if (!auth.ok) return auth;

  const registration = buildCoachRegistrationWritePayload(formData, auth.payload.options.data);
  if (!registration.ok) return registration;

  return {
    ok: true,
    payload: {
      auth: auth.payload,
      registration: registration.payload,
    },
  };
}

export function buildSharedCoachRegistrationPayload(
  formData: FormData,
  referenceDate = new Date(),
): AuthFormPreparation<CoachRegistrationWritePayload> {
  const profile = buildRegistrationProfilePayload(formData, referenceDate);
  if (!profile.ok) return profile;
  return buildCoachRegistrationWritePayload(formData, profile.payload);
}

function buildCoachRegistrationWritePayload(
  formData: FormData,
  profile: UserSignupMetadata,
): AuthFormPreparation<CoachRegistrationWritePayload> {

  const professionalTitle = normalizeSpaces(readText(formData, "register-professional-title"));
  const rawContactEmail = readRawText(formData, "register-contact-email");
  const contactEmail = rawContactEmail.trim().toLowerCase();
  if (!professionalTitle) {
    return {
      ok: false,
      field: "register-professional-title",
      message: "Ingresa tu título de estudios.",
    };
  }
  if (professionalTitle.length > COACH_PROFESSIONAL_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      field: "register-professional-title",
      message: `El título de estudios no puede superar ${COACH_PROFESSIONAL_TITLE_MAX_LENGTH} caracteres.`,
    };
  }
  if (!contactEmail) {
    return {
      ok: false,
      field: "register-contact-email",
      message: "Ingresa tu correo de contacto.",
    };
  }
  if (
    /\s/.test(contactEmail)
    || contactEmail.length > COACH_CONTACT_EMAIL_MAX_LENGTH
    || !isValidSignupEmailFormat(contactEmail)
  ) {
    return {
      ok: false,
      field: "register-contact-email",
      message: "Ingresa un correo de contacto válido.",
    };
  }

  const { first_name, last_name, birth_date, gender, phone_number } = profile;
  if (!last_name || !birth_date || !phone_number) {
    return {
      ok: false,
      field: "register-first-name",
      message: "Completa tus datos personales.",
    };
  }

  return {
    ok: true,
    payload: {
      first_name,
      last_name,
      birth_date,
      gender,
      phone_number,
      professional_title: professionalTitle,
      contact_email: contactEmail,
    },
  };
}

function buildRegistrationProfilePayload(
  formData: FormData,
  referenceDate: Date,
): AuthFormPreparation<UserSignupMetadata> {
  const firstName = readText(formData, "register-first-name");
  const lastName = readText(formData, "register-last-name");
  const birthDate = readText(formData, "register-birth-date");
  const gender = readText(formData, "register-gender");
  const phoneNumber = readText(formData, "register-phone-number");

  if (!firstName) return { ok: false, field: "register-first-name", message: "Ingresa tu nombre." };
  if (!lastName) return { ok: false, field: "register-last-name", message: "Ingresa tu apellido." };
  if (!birthDate) return { ok: false, field: "register-birth-date", message: "Ingresa tu fecha de nacimiento." };
  if (!isAuthRegistrationGender(gender)) {
    return { ok: false, field: "register-gender", message: "Selecciona un género válido." };
  }
  if (!phoneNumber) return { ok: false, field: "register-phone-number", message: "Ingresa tu celular." };

  const profile = buildProfilePersonalDataPayload({
    firstName,
    lastName,
    birthDate,
    gender,
    phoneNumber,
  }, referenceDate);
  if (!profile.ok || !profile.payload) {
    const profileError = resolveProfileFieldError(profile.errors);
    return profileError ?? {
      ok: false,
      field: "register-first-name",
      message: "Revisa tus datos personales.",
    };
  }

  const { display_name, first_name, last_name, birth_date, phone_number } = profile.payload;
  if (!last_name || !birth_date || !phone_number) {
    return { ok: false, field: "register-first-name", message: "Completa tus datos personales." };
  }

  return {
    ok: true,
    payload: {
      display_name,
      first_name,
      last_name,
      birth_date,
      gender,
      phone_number,
    },
  };
}

export function withSignupConfirmationMetadata(
  auth: UserSignupPayload,
  registration:
    | { portal: "usuario"; professionalTitle: null }
    | { portal: "coach"; professionalTitle: string; contactEmail: string },
  emailRedirectTo: string,
): ConfirmationRegistrationSignupPayload {
  const data = auth.options.data;
  const allowlistedData: UserSignupMetadata = {
    display_name: data.display_name,
    first_name: data.first_name,
    last_name: data.last_name,
    birth_date: data.birth_date,
    gender: data.gender,
    phone_number: data.phone_number,
  };
  return {
    email: auth.email,
    password: auth.password,
    options: {
      emailRedirectTo,
      data: registration.portal === "coach"
        ? {
          ...allowlistedData,
          [AUTH_REGISTRATION_PORTAL_METADATA_KEY]: "coach",
          professional_title: registration.professionalTitle,
          contact_email: registration.contactEmail,
        }
        : {
          ...allowlistedData,
          [AUTH_REGISTRATION_PORTAL_METADATA_KEY]: "usuario",
        },
    },
  };
}

function isAuthRegistrationGender(value: string): value is AuthRegistrationGender {
  return AUTH_REGISTRATION_GENDER_VALUES.includes(value as AuthRegistrationGender);
}

function resolveProfileFieldError(
  errors: ReturnType<typeof buildProfilePersonalDataPayload>["errors"],
): Extract<AuthFormPreparation<never>, { ok: false }> | null {
  const mappings = [
    ["firstName", "register-first-name"],
    ["lastName", "register-last-name"],
    ["birthDate", "register-birth-date"],
    ["gender", "register-gender"],
    ["phoneNumber", "register-phone-number"],
  ] as const;

  for (const [profileField, authField] of mappings) {
    const message = errors[profileField];
    if (message) return { ok: false, field: authField, message };
  }
  return null;
}

function readText(formData: FormData, key: string): string {
  return readRawText(formData, key).trim();
}

function readRawText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
