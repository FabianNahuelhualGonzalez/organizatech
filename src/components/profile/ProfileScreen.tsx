"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";

import {
  buildProfileFormInitialValues,
  buildProfilePersonalDataPayload,
  formatBirthDateLabel,
  formatProfileAgeLabel,
  profileGenderLabels,
  profileGenderValues,
  type ProfileFormValues,
  type ProfilePersonalDataInput,
} from "@/lib/profile/profile-form";
import { validateAvatarSourceFile } from "@/lib/profile/profile-avatar-image";
import type { ProfilePersonalData } from "@/lib/profile/profile-repository";
import type { ProfileViewModel } from "@/lib/profile/profile-view-model";
import { ProfileAvatarEditor } from "./ProfileAvatarEditor";
import { UserAvatar } from "./UserAvatar";

const preferenceRows = [
  { label: "Unidad de peso", value: "kg" },
  { label: "Tema", value: "Oscuro" },
  { label: "Notificaciones de actualizaciones de sistema", value: "Activa" },
  { label: "Recordatorios", value: "Próximamente" },
];

export function ProfileScreen({
  profile,
  personalData,
  canEditPersonalData,
  personalDataLoading,
  personalDataError,
  canEditAvatar,
  avatarLoading,
  avatarError,
  onAvatarImageError,
  avatarResetKey,
  onReloadPersonalData,
  onSavePersonalData,
  onUploadAvatar,
  onDeleteAvatar,
  cycleContextLabel,
}: {
  profile: ProfileViewModel;
  personalData: ProfilePersonalData | null;
  canEditPersonalData: boolean;
  personalDataLoading: boolean;
  personalDataError: string;
  canEditAvatar: boolean;
  avatarLoading: boolean;
  avatarError: string;
  onAvatarImageError?: () => void;
  avatarResetKey?: number;
  onReloadPersonalData: () => void;
  onSavePersonalData: (input: ProfilePersonalDataInput) => Promise<ProfilePersonalData>;
  onUploadAvatar: (file: File) => Promise<void>;
  onDeleteAvatar: () => Promise<void>;
  cycleContextLabel: string;
}) {
  const ageLabel = formatProfileAgeLabel(personalData?.birthDate ?? null);

  return (
    <section className="screen profile-screen">
      <div className="profile-hero" data-section="profile-avatar">
        <div className="profile-avatar-stack">
          <UserAvatar profile={profile} size="large" onImageError={onAvatarImageError} resetKey={avatarResetKey} />
          <ProfileAvatarControls
            hasAvatar={Boolean(profile.avatarUrl)}
            canEdit={canEditAvatar}
            isLoading={avatarLoading}
            externalError={avatarError}
            onUpload={onUploadAvatar}
            onDelete={onDeleteAvatar}
          />
        </div>
        <div className="profile-hero-copy">
          <h2>{profile.displayName}</h2>
          {profile.email && <p className="profile-email-text">{profile.email}</p>}
          <p>Edad: {ageLabel}</p>
          <p>Ciclo actual: {cycleContextLabel}</p>
        </div>
      </div>

      <PersonalDataSection
        profile={profile}
        personalData={personalData}
        canEdit={canEditPersonalData}
        isLoading={personalDataLoading}
        loadError={personalDataError}
        onReload={onReloadPersonalData}
        onSave={onSavePersonalData}
      />

      <ProfileSection
        title="Preferencias de sistema"
        description="Configuración predeterminada, se esta preparando para futuras opciones personales."
        rows={preferenceRows}
        actionLabel="Editar datos"
        disabledAction
      />

      <section className="profile-section profile-feature-section">
        <span className="profile-coming-soon">Próximamente</span>
        <div className="profile-section-header">
          <div>
            <h3>Coaching</h3>
            <p>Próximamente podrás vincularte con un coach, compartir tu progreso y recibir seguimiento personalizado.</p>
          </div>
        </div>
      </section>
    </section>
  );
}

function ProfileAvatarControls({
  hasAvatar,
  canEdit,
  isLoading,
  externalError,
  onUpload,
  onDelete,
}: {
  hasAvatar: boolean;
  canEdit: boolean;
  isLoading: boolean;
  externalError: string;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const isBusy = isLoading || isWorking;

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    const validation = validateAvatarSourceFile(file);
    if (!validation.ok) {
      setStatusMessage(validation.error);
      return;
    }

    setStatusMessage("");
    setSelectedFile(file);
  }

  async function handleConfirmAvatar(file: File) {
    setIsWorking(true);
    setStatusMessage("Subiendo foto...");
    try {
      await onUpload(file);
      setStatusMessage("Foto actualizada.");
      setSelectedFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setStatusMessage(message.includes("sesión") || message.includes("Inicia sesión")
        ? message
        : "No pudimos guardar la foto. Prueba con otra imagen.");
      throw error;
    } finally {
      setIsWorking(false);
    }
  }

  async function handleDeleteAvatar() {
    setIsWorking(true);
    setStatusMessage("Eliminando foto...");
    try {
      await onDelete();
      setStatusMessage("Foto eliminada.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "No se pudo eliminar la foto de perfil.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="profile-avatar-controls">
      <input
        ref={fileInputRef}
        className="profile-avatar-input"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={!canEdit || isBusy}
      />
      {canEdit ? (
        <>
          <p className="profile-avatar-help">Elige una foto para tu perfil.</p>
          <div className="profile-avatar-actions">
            <button
              className="profile-edit-button"
              type="button"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              <Pencil size={14} aria-hidden="true" />
              {hasAvatar ? "Cambiar foto" : "Subir foto"}
            </button>
            {hasAvatar && (
              <button
                className="profile-edit-button profile-avatar-delete-button"
                type="button"
                disabled={isBusy}
                onClick={() => void handleDeleteAvatar()}
              >
                <Trash2 size={14} aria-hidden="true" />
                Eliminar foto
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="profile-avatar-help">Inicia sesión para guardar tu foto de perfil.</p>
      )}
      {(statusMessage || externalError) && (
        <p className="profile-avatar-status">{statusMessage || externalError}</p>
      )}
      <ProfileAvatarEditor
        file={selectedFile}
        isOpen={Boolean(selectedFile)}
        isSaving={isWorking}
        onCancel={() => setSelectedFile(null)}
        onConfirm={handleConfirmAvatar}
      />
    </div>
  );
}

function PersonalDataSection({
  profile,
  personalData,
  canEdit,
  isLoading,
  loadError,
  onReload,
  onSave,
}: {
  profile: ProfileViewModel;
  personalData: ProfilePersonalData | null;
  canEdit: boolean;
  isLoading: boolean;
  loadError: string;
  onReload: () => void;
  onSave: (input: ProfilePersonalDataInput) => Promise<ProfilePersonalData>;
}) {
  const initialValues = useMemo(() => buildProfileFormInitialValues({
    displayName: personalData?.displayName ?? profile.displayName,
    firstName: personalData?.firstName ?? null,
    lastName: personalData?.lastName ?? null,
    birthDate: personalData?.birthDate ?? null,
    gender: personalData?.gender ?? "not_specified",
    phoneNumber: personalData?.phoneNumber ?? null,
  }), [personalData, profile.displayName]);
  const [isEditing, setIsEditing] = useState(false);
  const [values, setValues] = useState<ProfileFormValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setValues(initialValues);
    setFieldErrors({});
  }, [initialValues]);

  const readRows = [
    { label: "Nombre", value: initialValues.firstName || "No informado" },
    { label: "Apellido", value: initialValues.lastName || "No informado" },
    { label: "Fecha de nacimiento", value: formatBirthDateLabel(personalData?.birthDate ?? null) },
    { label: "Edad", value: formatProfileAgeLabel(personalData?.birthDate ?? null) },
    { label: "Género", value: profileGenderLabels[personalData?.gender ?? "not_specified"] },
    { label: "Celular", value: personalData?.phoneNumber ?? "No informado" },
    { label: "Correo", value: profile.email ?? "No disponible", kind: "email" },
  ];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = buildProfilePersonalDataPayload(values);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      setStatusMessage("Revisa los datos antes de guardar.");
      return;
    }
    const payload = validation.payload;
    if (!payload) {
      setFieldErrors({ phoneNumber: "Ingresa un número de celular válido." });
      setStatusMessage("Revisa los datos antes de guardar.");
      return;
    }

    setIsSaving(true);
    setFieldErrors({});
    setStatusMessage("Guardando...");
    try {
      await onSave({
        firstName: payload.first_name,
        lastName: payload.last_name,
        birthDate: payload.birth_date,
        gender: payload.gender,
        phoneNumber: payload.phone_number,
      });
      setIsEditing(false);
      setStatusMessage("Cambios guardados.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "No pudimos guardar tu perfil.");
    } finally {
      setIsSaving(false);
    }
  }

  function cancelEdition() {
    setValues(initialValues);
    setFieldErrors({});
    setStatusMessage("");
    setIsEditing(false);
  }

  return (
    <section className="profile-section" data-section="personal-data">
      <div className="profile-section-header">
        <div>
          <h3>Datos personales</h3>
          <p>Información base para identificar tu cuenta.</p>
        </div>
        <button
          className="profile-edit-button"
          type="button"
          disabled={!canEdit || isLoading || isEditing}
          onClick={() => {
            setValues(initialValues);
            setIsEditing(true);
            setStatusMessage("");
            setFieldErrors({});
          }}
        >
          Editar datos
        </button>
      </div>

      {isEditing ? (
        <form className="profile-form" onSubmit={handleSubmit}>
          <ProfileField label="Nombre" error={fieldErrors.firstName}>
            <input
              value={values.firstName}
              onChange={(event) => setValues((current) => ({ ...current, firstName: event.target.value }))}
              maxLength={80}
            />
          </ProfileField>
          <ProfileField label="Apellido" error={fieldErrors.lastName}>
            <input
              value={values.lastName}
              onChange={(event) => setValues((current) => ({ ...current, lastName: event.target.value }))}
              maxLength={120}
            />
          </ProfileField>
          <ProfileField label="Fecha de nacimiento" error={fieldErrors.birthDate}>
            <input
              type="date"
              value={values.birthDate}
              onChange={(event) => setValues((current) => ({ ...current, birthDate: event.target.value }))}
            />
          </ProfileField>
          <div className="profile-info-row profile-readonly-row">
            <dt>Edad</dt>
            <dd>{formatProfileAgeLabel(values.birthDate)}</dd>
          </div>
          <ProfileField label="Género" error={fieldErrors.gender}>
            <select
              value={values.gender}
              onChange={(event) => setValues((current) => ({ ...current, gender: event.target.value as ProfileFormValues["gender"] }))}
            >
              {profileGenderValues.map((gender) => (
                <option value={gender} key={gender}>{profileGenderLabels[gender]}</option>
              ))}
            </select>
          </ProfileField>
          <ProfileField label="Celular" error={fieldErrors.phoneNumber}>
            <input
              value={values.phoneNumber}
              onChange={(event) => setValues((current) => ({ ...current, phoneNumber: event.target.value }))}
              maxLength={30}
              placeholder="+56 9 1234 5678"
              inputMode="tel"
              autoComplete="tel"
            />
          </ProfileField>
          <ProfileField label="Correo">
            <input value={profile.email ?? "No disponible"} readOnly aria-readonly="true" />
          </ProfileField>

          {statusMessage && <p className="profile-form-status">{statusMessage}</p>}
          <div className="profile-form-actions">
            <button className="button secondary" type="button" onClick={cancelEdition} disabled={isSaving}>
              Cancelar
            </button>
            <button className="button" type="submit" disabled={isSaving}>
              {isSaving ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="profile-info-list">
            {readRows.map((row) => (
              <div className="profile-info-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd className={row.kind === "email" ? "profile-email-value" : undefined}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {isLoading && <p className="profile-form-status">Cargando datos personales...</p>}
          {loadError && (
            <div className="profile-inline-notice">
              <span>{loadError}</span>
              {canEdit && <button type="button" onClick={onReload}>Reintentar</button>}
            </div>
          )}
          {!canEdit && <p className="profile-form-status">Inicia sesión para guardar tu perfil.</p>}
          {statusMessage && <p className="profile-form-status">{statusMessage}</p>}
        </>
      )}
    </section>
  );
}

function ProfileField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="profile-field">
      <span>{label}</span>
      {children}
      {error && <small>{error}</small>}
    </label>
  );
}

function ProfileSection({
  title,
  description,
  rows,
  actionLabel,
  disabledAction = false,
}: {
  title: string;
  description: string;
  rows: Array<{ label: string; value: string }>;
  actionLabel?: string;
  disabledAction?: boolean;
}) {
  return (
    <section className="profile-section">
      <div className="profile-section-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {actionLabel ? (
          <button className="profile-edit-button" type="button" disabled={disabledAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      <dl className="profile-info-list">
        {rows.map((row) => (
          <div className="profile-info-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
