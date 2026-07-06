import { ShieldCheck, Sparkles } from "lucide-react";

import type { ProfileViewModel } from "@/lib/profile/profile-view-model";
import { UserAvatar } from "./UserAvatar";

const personalRows = [
  { label: "Fecha de nacimiento", value: "No configurada" },
  { label: "Edad", value: "No configurada" },
  { label: "Género", value: "No especificado" },
];

const preferenceRows = [
  { label: "Unidad de peso", value: "kg" },
  { label: "Tema", value: "Oscuro" },
  { label: "Notificaciones", value: "No configuradas" },
  { label: "Recordatorios", value: "Próximamente" },
];

export function ProfileScreen({ profile }: { profile: ProfileViewModel }) {
  return (
    <section className="screen profile-screen">
      <div className="profile-hero">
        <UserAvatar profile={profile} size="large" />
        <div className="profile-hero-copy">
          <p className="eyebrow">Perfil</p>
          <h2>{profile.displayName}</h2>
          {profile.email && <p>{profile.email}</p>}
        </div>
      </div>

      <ProfileSection
        title="Datos personales"
        description="Información base para identificar tu cuenta."
        rows={[
          { label: "Nombre completo", value: profile.displayName },
          { label: "Correo", value: profile.email ?? "No disponible" },
          ...personalRows,
        ]}
      />

      <ProfileSection
        title="Preferencias"
        description="Configuración preparada para futuras opciones personales."
        rows={preferenceRows}
      />

      <section className="profile-section profile-feature-section">
        <div className="profile-section-header">
          <div>
            <h3>Coaching</h3>
            <p>Próximamente podrás vincularte con un coach, compartir tu progreso y recibir seguimiento personalizado.</p>
          </div>
          <span className="profile-coming-soon">Próximamente</span>
        </div>
        <div className="profile-feature-icon" aria-hidden="true">
          <Sparkles size={18} />
        </div>
      </section>

      <section className="profile-section profile-privacy-section">
        <div className="profile-feature-icon" aria-hidden="true">
          <ShieldCheck size={18} />
        </div>
        <div>
          <h3>Privacidad</h3>
          <p>Tus datos personales y de salud se configurarán con permisos antes de compartirlos con un coach.</p>
        </div>
      </section>
    </section>
  );
}

function ProfileSection({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="profile-section">
      <div className="profile-section-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
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
