import type { CoachRegistrationRecord } from "@/features/auth/model/multiportal-auth-controller";
import {
  calculateAgeFromBirthDate,
  formatBirthDateLabel,
  isProfileGender,
  profileGenderLabels,
} from "@/lib/profile/profile-form";

export const COACH_HOME_WELCOME = "bienvenido Coach.";
export const COACH_HOME_MESSAGE =
  "Gracias por registrarte. Estamos construyendo algo grande, muchas gracias por la confianza!";

export const COACH_PORTAL_MENU_ITEMS = [
  { id: "profile", label: "Mi perfil", availability: "enabled" },
  { id: "dashboard", label: "Panel principal", availability: "disabled" },
  { id: "training", label: "Entrenemos", availability: "disabled" },
  { id: "comparison", label: "Comparación semanal", availability: "disabled" },
  { id: "edit-cycle", label: "Modificar ciclo de entrenamiento", availability: "disabled" },
  { id: "cycle-history", label: "Historial ciclo de entrenamiento", availability: "disabled" },
  { id: "calendar", label: "Calendario", availability: "disabled" },
  { id: "messages", label: "Mensajes", availability: "disabled" },
  { id: "logout", label: "Cerrar sesión", availability: "action" },
] as const;

export type CoachPortalScreen = "home" | "profile";

export interface CoachPortalState {
  readonly screen: CoachPortalScreen;
  readonly isMenuOpen: boolean;
}

export type CoachPortalAction =
  | { type: "menu_opened" }
  | { type: "menu_closed" }
  | { type: "profile_opened" }
  | { type: "home_opened" }
  | { type: "reset" };

export interface CoachPortalSession {
  readonly portal: "coach";
  readonly userId: string;
  readonly email: string | null;
  readonly registration: CoachRegistrationRecord;
}

export interface CoachPortalProfileViewModel {
  readonly fullName: string;
  readonly email: string;
  readonly age: number | null;
  readonly ageLabel: string;
  readonly birthDateLabel: string;
  readonly genderLabel: string;
  readonly professionalTitle: string;
}

export function createInitialCoachPortalState(): CoachPortalState {
  return { screen: "home", isMenuOpen: false };
}

export function reduceCoachPortalState(
  state: CoachPortalState,
  action: CoachPortalAction,
): CoachPortalState {
  switch (action.type) {
    case "menu_opened":
      return state.isMenuOpen ? state : { ...state, isMenuOpen: true };
    case "menu_closed":
      return state.isMenuOpen ? { ...state, isMenuOpen: false } : state;
    case "profile_opened":
      return { screen: "profile", isMenuOpen: false };
    case "home_opened":
    case "reset":
      return createInitialCoachPortalState();
  }
}

export function createCoachPortalSession(input: {
  authorizedUserId: string;
  authenticatedUser: { id: string; email?: string | null } | null;
  registration: CoachRegistrationRecord;
}): CoachPortalSession | null {
  const { authenticatedUser, authorizedUserId, registration } = input;
  if (
    !authenticatedUser
    || authenticatedUser.id !== authorizedUserId
    || registration.userId !== authorizedUserId
  ) return null;

  return {
    portal: "coach",
    userId: authorizedUserId,
    email: authenticatedUser.email ?? null,
    registration,
  };
}

export function createCoachPortalProfileViewModel(
  session: CoachPortalSession,
  referenceDate = new Date(),
): CoachPortalProfileViewModel {
  const { registration } = session;
  const age = calculateAgeFromBirthDate(registration.birthDate, referenceDate);
  const genderLabel = isProfileGender(registration.gender)
    ? profileGenderLabels[registration.gender]
    : registration.gender;

  return {
    fullName: `${registration.firstName} ${registration.lastName}`.trim(),
    email: session.email ?? "Correo no disponible",
    age,
    ageLabel: age === null ? "No disponible" : `${age} años`,
    birthDateLabel: formatBirthDateLabel(registration.birthDate),
    genderLabel,
    professionalTitle: registration.professionalTitle,
  };
}
