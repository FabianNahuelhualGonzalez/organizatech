"use client";

import Image from "next/image";
import { Eye, EyeOff, LoaderCircle, LogIn, Mail, Save, UserPlus } from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  AUTH_REGISTRATION_GENDER_VALUES,
  type AuthFieldErrors,
  type AuthFieldName,
} from "@/features/auth/model/auth-form";
import type {
  AuthAccountType,
  AuthMode,
} from "@/features/auth/model/auth-route";
import {
  calculateAgeFromBirthDate,
  profileGenderLabels,
} from "@/lib/profile/profile-form";
import { AppBackButton } from "@/ui/navigation/app-back-button";

import styles from "./auth-screen.module.css";

interface AuthScreenProps {
  mode: AuthMode;
  accountType: AuthAccountType;
  message: string;
  statusTone: AuthStatusTone;
  fieldErrors: AuthFieldErrors;
  isBusy: boolean;
  coachIdentitySwitchRequired: boolean;
  loginEmail: string;
  loginPassword: string;
  registerName: string;
  registerEmail: string;
  registerPassword: string;
  registerConfirmPassword: string;
  onLoginEmailChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onRegisterNameChange: (value: string) => void;
  onRegisterEmailChange: (value: string) => void;
  onRegisterPasswordChange: (value: string) => void;
  onRegisterConfirmPasswordChange: (value: string) => void;
  onSubmit: (data: FormData) => void | Promise<void>;
  onCoachIdentitySwitch: () => void | Promise<void>;
  onForgotPassword: () => void;
  onModeChange: (mode: AuthMode) => void;
  onAccountTypeChange: (accountType: AuthAccountType) => void;
  onFieldErrorClear: (field: AuthFieldName) => void;
}

export type AuthStatusTone = "error" | "success" | "info";

export function AuthScreen({
  mode,
  accountType,
  message,
  statusTone,
  fieldErrors,
  isBusy,
  coachIdentitySwitchRequired,
  loginEmail,
  loginPassword,
  registerName,
  registerEmail,
  registerPassword,
  registerConfirmPassword,
  onLoginEmailChange,
  onLoginPasswordChange,
  onRegisterNameChange,
  onRegisterEmailChange,
  onRegisterPasswordChange,
  onRegisterConfirmPasswordChange,
  onSubmit,
  onCoachIdentitySwitch,
  onForgotPassword,
  onModeChange,
  onAccountTypeChange,
  onFieldErrorClear,
}: AuthScreenProps) {
  const isRegister = mode === "registro";
  const isCoachRegistration = isRegister && accountType === "coach";
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [professionalTitle, setProfessionalTitle] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const userTabRef = useRef<HTMLButtonElement>(null);
  const coachTabRef = useRef<HTMLButtonElement>(null);
  const age = birthDate ? calculateAgeFromBirthDate(birthDate) : null;

  function selectAccountType(nextAccountType: AuthAccountType) {
    onAccountTypeChange(nextAccountType);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextAccountType = accountType === "usuario" ? "coach" : "usuario";
    selectAccountType(nextAccountType);
    (nextAccountType === "usuario" ? userTabRef : coachTabRef).current?.focus();
  }

  return (
    <AuthFrame>
      <div className={styles.segmentedControl} role="tablist" aria-label="Tipo de cuenta">
        <button
          ref={userTabRef}
          className={accountType === "usuario" ? styles.activeTab : undefined}
          id="auth-tab-usuario"
          type="button"
          role="tab"
          aria-selected={accountType === "usuario"}
          aria-controls="auth-panel"
          tabIndex={accountType === "usuario" ? 0 : -1}
          onClick={() => selectAccountType("usuario")}
          onKeyDown={handleTabKeyDown}
        >
          Usuario
        </button>
        <button
          ref={coachTabRef}
          className={accountType === "coach" ? styles.activeTab : undefined}
          id="auth-tab-coach"
          type="button"
          role="tab"
          aria-selected={accountType === "coach"}
          aria-controls="auth-panel"
          tabIndex={accountType === "coach" ? 0 : -1}
          onClick={() => selectAccountType("coach")}
          onKeyDown={handleTabKeyDown}
        >
          Coach
        </button>
      </div>

      <form
        className={`${styles.card} ${isRegister ? styles.registrationCard : styles.loginCard}`}
        id="auth-panel"
        role="tabpanel"
        aria-labelledby={accountType === "usuario" ? "auth-tab-usuario" : "auth-tab-coach"}
        action={onSubmit}
        autoComplete={isRegister ? "off" : "on"}
      >
        {isRegister ? <h2>Crea tu cuenta</h2> : null}

        <div className={styles.fields}>
          {isRegister ? (
            <RegistrationFields
              age={age}
              birthDate={birthDate}
              gender={gender}
              lastName={lastName}
              phoneNumber={phoneNumber}
              professionalTitle={professionalTitle}
              includeProfessionalTitle={isCoachRegistration}
              firstName={registerName}
              email={registerEmail}
              password={registerPassword}
              confirmPassword={registerConfirmPassword}
              showPassword={showRegisterPassword}
              showConfirmPassword={showRegisterConfirmPassword}
              fieldErrors={fieldErrors}
              onBirthDateChange={setBirthDate}
              onGenderChange={setGender}
              onLastNameChange={setLastName}
              onPhoneNumberChange={setPhoneNumber}
              onProfessionalTitleChange={setProfessionalTitle}
              onFirstNameChange={onRegisterNameChange}
              onEmailChange={onRegisterEmailChange}
              onPasswordChange={onRegisterPasswordChange}
              onConfirmPasswordChange={onRegisterConfirmPasswordChange}
              onPasswordVisibilityChange={() => setShowRegisterPassword((current) => !current)}
              onConfirmPasswordVisibilityChange={() => setShowRegisterConfirmPassword((current) => !current)}
              onFieldErrorClear={onFieldErrorClear}
            />
          ) : (
            <>
              <AuthTextField
                id="login-email"
                name="login-email"
                label="Correo electrónico"
                placeholder="nombre@organizatech.cl"
                type="email"
                autoComplete="username"
                value={loginEmail}
                error={fieldErrors["login-email"]}
                onChange={onLoginEmailChange}
                onErrorClear={() => onFieldErrorClear("login-email")}
                required
              />
              <AuthPasswordField
                id="login-password"
                name="login-password"
                label="Contraseña"
                placeholder="••••••••"
                autoComplete="current-password"
                value={loginPassword}
                visible={showLoginPassword}
                error={fieldErrors["login-password"]}
                onChange={onLoginPasswordChange}
                onErrorClear={() => onFieldErrorClear("login-password")}
                onToggle={() => setShowLoginPassword((current) => !current)}
                required
              />
            </>
          )}
        </div>

        <AuthStatus message={message} tone={statusTone} />

        {isCoachRegistration && coachIdentitySwitchRequired ? (
          <button
            className={styles.primaryButton}
            type="button"
            aria-describedby="auth-form-status"
            disabled={isBusy}
            onClick={onCoachIdentitySwitch}
          >
            Cerrar sesión y continuar
          </button>
        ) : null}

        <button
          className={styles.primaryButton}
          type="submit"
          disabled={isBusy || (isCoachRegistration && coachIdentitySwitchRequired)}
        >
          {isRegister ? <UserPlus aria-hidden="true" size={21} /> : <LogIn aria-hidden="true" size={21} />}
          {isBusy && !coachIdentitySwitchRequired
            ? (isRegister ? "Creando cuenta..." : "Iniciando sesión...")
            : isRegister ? "Crear cuenta" : "Iniciar sesión"}
        </button>

        {!isRegister ? (
          <button className={styles.textButton} type="button" onClick={onForgotPassword}>
            ¿Olvidaste tu contraseña?
          </button>
        ) : null}

        <div className={styles.separator} aria-hidden="true"><span />ó<span /></div>

        <button
          className={styles.googleButton}
          type="button"
          aria-label="Continuar con Google (no disponible)"
          disabled
        >
          <span className={styles.googleMark} aria-hidden="true">G</span>
          Continuar con Google
        </button>

        <button
          className={styles.switchButton}
          type="button"
          onClick={() => onModeChange(isRegister ? "login" : "registro")}
        >
          {isRegister ? "¿Ya tienes cuenta? Iniciar sesión" : "¿No tienes cuenta? Crea una"}
        </button>
      </form>
    </AuthFrame>
  );
}

export function AuthLoadingScreen() {
  return (
    <AuthFrame>
      <div className={`${styles.card} ${styles.flowCard} ${styles.loadingCard}`} aria-busy="true" aria-live="polite">
        <LoaderCircle className={styles.loadingIcon} aria-hidden="true" size={30} />
        <h2>Validando sesión...</h2>
        <p className={styles.helperText}>Estamos revisando si ya tienes una sesión activa.</p>
      </div>
    </AuthFrame>
  );
}

interface PasswordRecoveryScreenProps {
  email: string;
  message: string;
  statusTone: AuthStatusTone;
  fieldErrors: AuthFieldErrors;
  isBusy: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (data: FormData) => void | Promise<void>;
  onBack: () => void;
  onFieldErrorClear: (field: AuthFieldName) => void;
}

export function PasswordRecoveryScreen({
  email,
  message,
  statusTone,
  fieldErrors,
  isBusy,
  onEmailChange,
  onSubmit,
  onBack,
  onFieldErrorClear,
}: PasswordRecoveryScreenProps) {
  return (
    <AuthFrame subtitle="Recupera el acceso a tu cuenta">
      <form className={`${styles.card} ${styles.flowCard}`} action={onSubmit} autoComplete="on">
        <h2>Recuperar contraseña</h2>
        <p className={styles.helperText}>Ingresa tu correo y enviaremos las instrucciones si la cuenta existe.</p>
        <AuthTextField
          id="recovery-email"
          name="recovery-email"
          label="Correo electrónico"
          placeholder="nombre@organizatech.cl"
          type="email"
          autoComplete="username"
          value={email}
          error={fieldErrors["recovery-email"]}
          onChange={onEmailChange}
          onErrorClear={() => onFieldErrorClear("recovery-email")}
          required
        />
        <AuthStatus message={message} tone={statusTone} />
        <button className={styles.primaryButton} type="submit" disabled={isBusy}>
          <Mail aria-hidden="true" size={20} />
          {isBusy ? "Enviando enlace..." : "Enviar enlace"}
        </button>
        <AppBackButton onBack={onBack} />
      </form>
    </AuthFrame>
  );
}

export function RecoveryExpiredScreen({
  message,
  onRequestNewLink,
}: {
  message: string;
  onRequestNewLink: () => void;
}) {
  return (
    <AuthFrame subtitle="Recupera el acceso a tu cuenta">
      <div className={`${styles.card} ${styles.flowCard}`}>
        <h2>Enlace expirado</h2>
        <AuthStatus
          message={message || "El enlace de recuperación expiró o ya fue utilizado."}
          tone="error"
        />
        <p className={styles.helperText}>Solicita un nuevo enlace para restablecer tu contraseña.</p>
        <button className={styles.primaryButton} type="button" onClick={onRequestNewLink}>
          <Mail aria-hidden="true" size={20} />
          Solicitar nuevo enlace
        </button>
      </div>
    </AuthFrame>
  );
}

interface NewPasswordScreenProps {
  password: string;
  confirmPassword: string;
  message: string;
  statusTone: AuthStatusTone;
  fieldErrors: AuthFieldErrors;
  isBusy: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (data: FormData) => void | Promise<void>;
  onFieldErrorClear: (field: AuthFieldName) => void;
}

export function NewPasswordScreen({
  password,
  confirmPassword,
  message,
  statusTone,
  fieldErrors,
  isBusy,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onFieldErrorClear,
}: NewPasswordScreenProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  return (
    <AuthFrame subtitle="Define una nueva contraseña">
      <form className={`${styles.card} ${styles.flowCard}`} action={onSubmit} autoComplete="off">
        <h2>Crear nueva contraseña</h2>
        <AuthPasswordField
          id="new-password"
          name="new-password"
          label="Nueva contraseña"
          placeholder="Crea una contraseña"
          autoComplete="new-password"
          value={password}
          visible={showPassword}
          error={fieldErrors["new-password"]}
          onChange={onPasswordChange}
          onErrorClear={() => onFieldErrorClear("new-password")}
          onToggle={() => setShowPassword((current) => !current)}
          required
        />
        <AuthPasswordField
          id="new-password-confirm"
          name="new-password-confirm"
          label="Confirmar nueva contraseña"
          placeholder="Repite tu contraseña"
          autoComplete="new-password"
          value={confirmPassword}
          visible={showConfirmPassword}
          error={fieldErrors["new-password-confirm"]}
          onChange={onConfirmPasswordChange}
          onErrorClear={() => onFieldErrorClear("new-password-confirm")}
          onToggle={() => setShowConfirmPassword((current) => !current)}
          required
        />
        <AuthStatus message={message} tone={statusTone} />
        <button className={styles.primaryButton} type="submit" disabled={isBusy}>
          <Save aria-hidden="true" size={20} />
          {isBusy ? "Actualizando..." : "Cambiar contraseña"}
        </button>
      </form>
    </AuthFrame>
  );
}

function AuthFrame({
  children,
  subtitle = "Evoluciona tu rendimiento",
}: {
  children: ReactNode;
  subtitle?: string;
}) {
  return (
    <section className={styles.shell} aria-labelledby="auth-brand-name">
      <header className={styles.header}>
        <div className={styles.brandLockup}>
          <Image className={styles.logo} src="/icon.svg" width={82} height={82} alt="" priority />
          <h1 id="auth-brand-name">organizatech</h1>
        </div>
        <p>{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function AuthStatus({ message, tone }: { message: string; tone: AuthStatusTone }) {
  if (!message) return null;

  const className = `${styles.status} ${
    tone === "error" ? styles.statusError : tone === "success" ? styles.statusSuccess : styles.statusInfo
  }`;

  return (
    <p
      className={className}
      id="auth-form-status"
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      {message}
    </p>
  );
}

interface RegistrationFieldsProps {
  age: number | null;
  birthDate: string;
  gender: string;
  lastName: string;
  phoneNumber: string;
  professionalTitle: string;
  includeProfessionalTitle: boolean;
  firstName: string;
  email: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  fieldErrors: AuthFieldErrors;
  onBirthDateChange: (value: string) => void;
  onGenderChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onPhoneNumberChange: (value: string) => void;
  onProfessionalTitleChange: (value: string) => void;
  onFirstNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onPasswordVisibilityChange: () => void;
  onConfirmPasswordVisibilityChange: () => void;
  onFieldErrorClear: (field: AuthFieldName) => void;
}

function RegistrationFields({
  age,
  birthDate,
  gender,
  lastName,
  phoneNumber,
  professionalTitle,
  includeProfessionalTitle,
  firstName,
  email,
  password,
  confirmPassword,
  showPassword,
  showConfirmPassword,
  fieldErrors,
  onBirthDateChange,
  onGenderChange,
  onLastNameChange,
  onPhoneNumberChange,
  onProfessionalTitleChange,
  onFirstNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onPasswordVisibilityChange,
  onConfirmPasswordVisibilityChange,
  onFieldErrorClear,
}: RegistrationFieldsProps) {
  return (
    <>
      <AuthTextField id="register-first-name" name="register-first-name" label="Nombre" placeholder="Nombre..." autoComplete="given-name" value={firstName} error={fieldErrors["register-first-name"]} onChange={onFirstNameChange} onErrorClear={() => onFieldErrorClear("register-first-name")} required />
      <AuthTextField id="register-last-name" name="register-last-name" label="Apellido" placeholder="Apellido..." autoComplete="family-name" value={lastName} error={fieldErrors["register-last-name"]} onChange={onLastNameChange} onErrorClear={() => onFieldErrorClear("register-last-name")} required />
      <div className={styles.birthRow}>
        <AuthTextField id="register-birth-date" name="register-birth-date" label="Fecha de nacimiento" type="date" autoComplete="bday" value={birthDate} error={fieldErrors["register-birth-date"]} onChange={onBirthDateChange} onErrorClear={() => onFieldErrorClear("register-birth-date")} required />
        <label className={styles.field} htmlFor="register-age">
          <span>Edad</span>
          <input id="register-age" value={age ?? ""} placeholder="--" readOnly aria-readonly="true" tabIndex={-1} />
        </label>
      </div>
      <label className={styles.field} htmlFor="register-gender">
        <span>Género</span>
        <select id="register-gender" name="register-gender" value={gender} aria-describedby={fieldErrors["register-gender"] ? "register-gender-error" : undefined} aria-invalid={Boolean(fieldErrors["register-gender"])} onChange={(event) => { onGenderChange(event.target.value); onFieldErrorClear("register-gender"); }} required>
          <option value="" disabled>Selecciona una opción</option>
          {AUTH_REGISTRATION_GENDER_VALUES.map((value) => <option value={value} key={value}>{profileGenderLabels[value]}</option>)}
        </select>
        <FieldError id="register-gender-error" message={fieldErrors["register-gender"]} />
      </label>
      <AuthTextField id="register-phone-number" name="register-phone-number" label="Celular" placeholder="+56912345678" type="tel" autoComplete="tel" inputMode="tel" value={phoneNumber} error={fieldErrors["register-phone-number"]} onChange={onPhoneNumberChange} onErrorClear={() => onFieldErrorClear("register-phone-number")} required />
      <AuthTextField id="register-email" name="register-email" label="Correo" placeholder="nombre@organizatech.cl" type="email" autoComplete="email" value={email} error={fieldErrors["register-email"]} onChange={onEmailChange} onErrorClear={() => onFieldErrorClear("register-email")} required />
      {includeProfessionalTitle ? (
        <AuthTextField id="register-professional-title" name="register-professional-title" label="Título de estudios" placeholder="Ej: Linc. en Ciencias del deporte" autoComplete="off" value={professionalTitle} error={fieldErrors["register-professional-title"]} onChange={onProfessionalTitleChange} onErrorClear={() => onFieldErrorClear("register-professional-title")} required />
      ) : null}
      <AuthPasswordField id="register-password" name="register-password" label="Contraseña" placeholder="Crea una contraseña" autoComplete="new-password" value={password} visible={showPassword} error={fieldErrors["register-password"]} onChange={onPasswordChange} onErrorClear={() => onFieldErrorClear("register-password")} onToggle={onPasswordVisibilityChange} required />
      <AuthPasswordField id="register-confirm-password" name="register-confirm-password" label="Confirmar contraseña" placeholder="Repite tu contraseña" autoComplete="new-password" value={confirmPassword} visible={showConfirmPassword} error={fieldErrors["register-confirm-password"]} onChange={onConfirmPasswordChange} onErrorClear={() => onFieldErrorClear("register-confirm-password")} onToggle={onConfirmPasswordVisibilityChange} required />
    </>
  );
}

interface AuthTextFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "email" | "search" | "tel" | "text" | "url" | "none" | "numeric" | "decimal";
  error?: string;
  onErrorClear?: () => void;
  required?: boolean;
}

function AuthTextField({
  id,
  name,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  inputMode,
  error,
  onErrorClear,
  required,
}: AuthTextFieldProps) {
  const errorId = error ? `${id}-error` : undefined;

  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-describedby={errorId}
        aria-invalid={Boolean(error)}
        required={required}
        onChange={(event) => {
          onChange(event.target.value);
          onErrorClear?.();
        }}
      />
      <FieldError id={`${id}-error`} message={error} />
    </label>
  );
}

interface AuthPasswordFieldProps extends Omit<AuthTextFieldProps, "type" | "inputMode"> {
  visible: boolean;
  onToggle: () => void;
}

function AuthPasswordField({ visible, onToggle, ...field }: AuthPasswordFieldProps) {
  const toggleLabel = visible ? "Ocultar contraseña" : "Mostrar contraseña";
  const errorId = field.error ? `${field.id}-error` : undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={field.id}>{field.label}</label>
      <span className={styles.passwordWrap}>
        <input
          id={field.id}
          name={field.name}
          type={visible ? "text" : "password"}
          value={field.value}
          placeholder={field.placeholder}
          autoComplete={field.autoComplete}
          aria-describedby={errorId}
          aria-invalid={Boolean(field.error)}
          required={field.required}
          onChange={(event) => {
            field.onChange(event.target.value);
            field.onErrorClear?.();
          }}
        />
        <button type="button" aria-label={toggleLabel} title={toggleLabel} onClick={onToggle}>
          {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
        </button>
      </span>
      <FieldError id={`${field.id}-error`} message={field.error} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span className={styles.fieldError} id={id} role="alert">{message}</span> : null;
}
