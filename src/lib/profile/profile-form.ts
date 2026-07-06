export const profileGenderValues = [
  "male",
  "female",
  "non_binary",
  "prefer_not_to_say",
  "not_specified",
] as const;

export type ProfileGender = typeof profileGenderValues[number];

export interface ProfileNameParts {
  firstName: string;
  lastName: string;
}

export interface ProfileFormInitialSource {
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  birthDate?: string | null;
  gender?: string | null;
}

export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: ProfileGender;
}

export interface ProfilePersonalDataInput {
  firstName: string;
  lastName?: string | null;
  birthDate?: string | null;
  gender?: string | null;
}

export interface ProfilePersonalDataPayload {
  first_name: string;
  last_name: string | null;
  birth_date: string | null;
  gender: ProfileGender;
  display_name: string;
}

export interface ProfileValidationResult {
  ok: boolean;
  payload: ProfilePersonalDataPayload | null;
  errors: Partial<Record<"firstName" | "lastName" | "birthDate" | "gender", string>>;
}

export interface InitialProfileInsertPayload {
  id: string;
  email: string;
  display_name: string;
  gender: ProfileGender;
}

export type EnsureProfileWriteDecision =
  | { type: "insert"; payload: InitialProfileInsertPayload }
  | { type: "update-email"; email: string }
  | { type: "noop" };

const maxFirstNameLength = 80;
const maxLastNameLength = 120;
const minProfileAge = 10;
const maxProfileAge = 100;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const profileGenderLabels: Record<ProfileGender, string> = {
  male: "Hombre",
  female: "Mujer",
  non_binary: "No binario",
  prefer_not_to_say: "Prefiero no decir",
  not_specified: "No especificado",
};

export function deriveNamePartsFromDisplayName(displayName: string | null | undefined): ProfileNameParts {
  const normalized = normalizeSpaces(displayName);
  if (!normalized) return { firstName: "", lastName: "" };

  const [firstName = "", ...rest] = normalized.split(" ");
  return {
    firstName,
    lastName: rest.join(" "),
  };
}

export function buildProfileFormInitialValues(source: ProfileFormInitialSource): ProfileFormValues {
  const legacyNameParts = deriveNamePartsFromDisplayName(source.displayName);
  const firstName = normalizeSpaces(source.firstName) || legacyNameParts.firstName;
  const lastName = normalizeSpaces(source.lastName) || legacyNameParts.lastName;
  const birthDate = normalizeBirthDate(source.birthDate) ?? "";
  const gender = normalizeGender(source.gender) ?? "not_specified";

  return {
    firstName,
    lastName,
    birthDate,
    gender,
  };
}

export function buildDisplayName(firstName: string, lastName?: string | null) {
  const normalizedFirstName = normalizeSpaces(firstName);
  const normalizedLastName = normalizeSpaces(lastName);
  return normalizedLastName ? `${normalizedFirstName} ${normalizedLastName}` : normalizedFirstName;
}

export function formatProfileAgeLabel(birthDate: string | null | undefined, referenceDate = new Date()) {
  const age = calculateAgeFromBirthDate(birthDate, referenceDate);
  return age === null ? "No configurada" : `${age} años`;
}

export function formatBirthDateLabel(value: string | null | undefined) {
  const parsed = parseDateOnly(value);
  if (!parsed) return "No configurada";
  return `${String(parsed.day).padStart(2, "0")}/${String(parsed.month).padStart(2, "0")}/${parsed.year}`;
}

export function calculateAgeFromBirthDate(birthDate: string | null | undefined, referenceDate = new Date()): number | null {
  const parsed = parseDateOnly(birthDate);
  if (!parsed) return null;

  const reference = {
    year: referenceDate.getFullYear(),
    month: referenceDate.getMonth() + 1,
    day: referenceDate.getDate(),
  };
  let age = reference.year - parsed.year;
  if (reference.month < parsed.month || (reference.month === parsed.month && reference.day < parsed.day)) {
    age -= 1;
  }
  return age;
}

export function isProfileGender(value: string | null | undefined): value is ProfileGender {
  return profileGenderValues.includes(value as ProfileGender);
}

export function buildProfilePersonalDataPayload(
  input: ProfilePersonalDataInput,
  referenceDate = new Date(),
): ProfileValidationResult {
  const firstName = normalizeSpaces(input.firstName);
  const lastName = normalizeSpaces(input.lastName);
  const birthDate = normalizeBirthDate(input.birthDate);
  const gender = normalizeGender(input.gender);
  const errors: ProfileValidationResult["errors"] = {};

  if (!firstName) {
    errors.firstName = "El nombre es obligatorio.";
  } else if (firstName.length > maxFirstNameLength) {
    errors.firstName = `El nombre no puede superar ${maxFirstNameLength} caracteres.`;
  }

  if (lastName.length > maxLastNameLength) {
    errors.lastName = `El apellido no puede superar ${maxLastNameLength} caracteres.`;
  }

  if (birthDate === undefined) {
    errors.birthDate = "Ingresa una fecha válida.";
  } else if (birthDate) {
    const age = calculateAgeFromBirthDate(birthDate, referenceDate);
    const birth = parseDateOnly(birthDate);
    const referenceKey = toDateKey({
      year: referenceDate.getFullYear(),
      month: referenceDate.getMonth() + 1,
      day: referenceDate.getDate(),
    });
    if (!birth || birthDate > referenceKey) {
      errors.birthDate = "La fecha de nacimiento no puede ser futura.";
    } else if (age === null || age < minProfileAge) {
      errors.birthDate = `La edad mínima permitida es ${minProfileAge} años.`;
    } else if (age > maxProfileAge) {
      errors.birthDate = `La edad máxima permitida es ${maxProfileAge} años.`;
    }
  }

  if (!gender) {
    errors.gender = "Selecciona un género válido.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, payload: null, errors };
  }

  return {
    ok: true,
    payload: {
      first_name: firstName,
      last_name: lastName || null,
      birth_date: birthDate ?? null,
      gender: gender ?? "not_specified",
      display_name: buildDisplayName(firstName, lastName),
    },
    errors,
  };
}

export function createInitialProfileInsertPayload({
  userId,
  email,
  displayName,
}: {
  userId: string;
  email: string | null | undefined;
  displayName?: string | null;
}): InitialProfileInsertPayload {
  const normalizedEmail = normalizeEmail(email);
  const emailPrefix = normalizedEmail ? normalizeSpaces(normalizedEmail.split("@")[0]) : "";
  const normalizedDisplayName = normalizeSpaces(displayName);
  return {
    id: userId,
    email: normalizedEmail,
    display_name: normalizedDisplayName || emailPrefix || "Usuario",
    gender: "not_specified",
  };
}

export function resolveEnsureProfileWrite({
  existing,
  userId,
  email,
  displayName,
}: {
  existing: { id: string; email: string | null } | null;
  userId: string;
  email: string | null | undefined;
  displayName?: string | null;
}): EnsureProfileWriteDecision {
  const normalizedEmail = normalizeEmail(email);
  if (!existing) {
    return {
      type: "insert",
      payload: createInitialProfileInsertPayload({ userId, email: normalizedEmail, displayName }),
    };
  }

  if (normalizedEmail && normalizeEmail(existing.email) !== normalizedEmail) {
    return { type: "update-email", email: normalizedEmail };
  }

  return { type: "noop" };
}

function normalizeSpaces(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeEmail(value: string | null | undefined) {
  return normalizeSpaces(value).toLowerCase();
}

function normalizeGender(value: string | null | undefined): ProfileGender | null {
  if (value == null || value.trim() === "") return "not_specified";
  const normalized = value.trim();
  return isProfileGender(normalized) ? normalized : null;
}

function normalizeBirthDate(value: string | null | undefined): string | null | undefined {
  const normalized = normalizeSpaces(value);
  if (!normalized) return null;
  const parsed = parseDateOnly(normalized);
  return parsed ? toDateKey(parsed) : undefined;
}

function parseDateOnly(value: string | null | undefined) {
  const normalized = normalizeSpaces(value);
  if (!dateOnlyPattern.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function toDateKey(value: { year: number; month: number; day: number }) {
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}
