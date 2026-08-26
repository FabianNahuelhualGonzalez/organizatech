import type {
  AuthFieldErrors,
  AuthFieldName,
} from "@/features/auth/model/auth-form";

export type CoachRegistrationFlow = "shared" | "separate";

export interface AuthRegistrationValues {
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  phoneNumber: string;
  professionalTitle: string;
  contactEmail: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export type AuthRegistrationValueField = keyof AuthRegistrationValues;

export type SharedCoachEligibility =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "sign_in_required" }
  | { state: "authorized"; userId: string };

export interface AuthRegistrationFormState {
  revision: number;
  values: AuthRegistrationValues;
  fieldErrors: AuthFieldErrors;
  showPassword: boolean;
  showConfirmPassword: boolean;
  coachFlow: CoachRegistrationFlow | null;
  sharedCoachEligibility: SharedCoachEligibility;
  sharedCoachLoginPending: boolean;
}

export interface AuthRegistrationFormRevision {
  readonly revision: number;
}

export interface SharedCoachEligibilityCapture extends AuthRegistrationFormRevision {
  readonly expectedUserId: string | null;
}

export interface AuthRegistrationFormController {
  getState(): AuthRegistrationFormState;
  subscribe(listener: () => void): () => void;
  captureRevision(): AuthRegistrationFormRevision;
  captureSharedCoachEligibility(expectedUserId: string): SharedCoachEligibilityCapture;
  isRevisionCurrent(capture: AuthRegistrationFormRevision): boolean;
  edit(field: AuthRegistrationValueField, value: string): void;
  togglePasswordVisibility(field: "password" | "confirmPassword"): void;
  setFieldError(field: AuthFieldName, message: string): void;
  clearFieldError(field: AuthFieldName): void;
  clearFieldErrors(): void;
  selectCoachFlow(
    flow: CoachRegistrationFlow,
    expectedUserId: string | null,
  ): SharedCoachEligibilityCapture;
  completeSharedCoachEligibility(
    capture: SharedCoachEligibilityCapture,
    eligibility: Extract<SharedCoachEligibility, { state: "sign_in_required" | "authorized" }>,
  ): boolean;
  beginSharedCoachLogin(): void;
  resetIfCurrent(capture: AuthRegistrationFormRevision): boolean;
  reset(): void;
}

const FIELD_ERROR_BY_VALUE: Record<AuthRegistrationValueField, AuthFieldName> = {
  firstName: "register-first-name",
  lastName: "register-last-name",
  birthDate: "register-birth-date",
  gender: "register-gender",
  phoneNumber: "register-phone-number",
  professionalTitle: "register-professional-title",
  contactEmail: "register-contact-email",
  email: "register-email",
  password: "register-password",
  confirmPassword: "register-confirm-password",
};

function createEmptyValues(): AuthRegistrationValues {
  return {
    firstName: "",
    lastName: "",
    birthDate: "",
    gender: "",
    phoneNumber: "",
    professionalTitle: "",
    contactEmail: "",
    email: "",
    password: "",
    confirmPassword: "",
  };
}

function createInitialState(revision: number): AuthRegistrationFormState {
  return {
    revision,
    values: createEmptyValues(),
    fieldErrors: {},
    showPassword: false,
    showConfirmPassword: false,
    coachFlow: null,
    sharedCoachEligibility: { state: "idle" },
    sharedCoachLoginPending: false,
  };
}

export function createAuthRegistrationFormController(): AuthRegistrationFormController {
  let revision = 0;
  let state = createInitialState(revision);
  const listeners = new Set<() => void>();

  function publish(nextState: Omit<AuthRegistrationFormState, "revision">) {
    revision += 1;
    state = { ...nextState, revision };
    for (const listener of listeners) listener();
  }

  function withoutFieldError(field: AuthFieldName) {
    if (!(field in state.fieldErrors)) return state.fieldErrors;
    const nextErrors = { ...state.fieldErrors };
    delete nextErrors[field];
    return nextErrors;
  }

  function captureRevision(): AuthRegistrationFormRevision {
    return Object.freeze({ revision });
  }

  function captureSharedCoachEligibility(
    expectedUserId: string | null,
  ): SharedCoachEligibilityCapture {
    return Object.freeze({ revision, expectedUserId });
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    captureRevision,

    captureSharedCoachEligibility,

    isRevisionCurrent(capture) {
      return capture.revision === revision;
    },

    edit(field, value) {
      publish({
        ...state,
        values: { ...state.values, [field]: value },
        fieldErrors: withoutFieldError(FIELD_ERROR_BY_VALUE[field]),
      });
    },

    togglePasswordVisibility(field) {
      publish({
        ...state,
        showPassword: field === "password" ? !state.showPassword : state.showPassword,
        showConfirmPassword: field === "confirmPassword"
          ? !state.showConfirmPassword
          : state.showConfirmPassword,
      });
    },

    setFieldError(field, message) {
      publish({
        ...state,
        fieldErrors: { ...state.fieldErrors, [field]: message },
      });
    },

    clearFieldError(field) {
      const fieldErrors = withoutFieldError(field);
      if (fieldErrors === state.fieldErrors) return;
      publish({ ...state, fieldErrors });
    },

    clearFieldErrors() {
      if (Object.keys(state.fieldErrors).length === 0) return;
      publish({ ...state, fieldErrors: {} });
    },

    selectCoachFlow(flow, expectedUserId) {
      publish({
        ...state,
        values: flow === "shared"
          ? {
            ...state.values,
            email: "",
            password: "",
            confirmPassword: "",
          }
          : state.values,
        fieldErrors: {},
        showPassword: flow === "shared" ? false : state.showPassword,
        showConfirmPassword: flow === "shared" ? false : state.showConfirmPassword,
        coachFlow: flow,
        sharedCoachEligibility: flow === "shared"
          ? { state: "checking" }
          : { state: "idle" },
        sharedCoachLoginPending: false,
      });
      return captureSharedCoachEligibility(expectedUserId);
    },

    completeSharedCoachEligibility(capture, eligibility) {
      if (
        capture.revision !== revision
        || state.coachFlow !== "shared"
        || (
          eligibility.state === "authorized"
          && eligibility.userId !== capture.expectedUserId
        )
      ) return false;
      publish({
        ...state,
        sharedCoachEligibility: eligibility,
        sharedCoachLoginPending: false,
      });
      return true;
    },

    beginSharedCoachLogin() {
      publish({
        ...state,
        coachFlow: "shared",
        sharedCoachEligibility: { state: "sign_in_required" },
        sharedCoachLoginPending: true,
      });
    },

    resetIfCurrent(capture) {
      if (capture.revision !== revision) return false;
      publish(createInitialState(revision));
      return true;
    },

    reset() {
      publish(createInitialState(revision));
    },
  };
}
