"use client";

import Image from "next/image";
import {
  CalendarDays,
  ChartNoAxesCombined,
  Dumbbell,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Pencil,
  Settings2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useReducer, useRef, useState, type RefObject } from "react";

import {
  COACH_HOME_MESSAGE,
  COACH_HOME_WELCOME,
  COACH_PORTAL_MENU_ITEMS,
  createCoachPortalProfileViewModel,
  createInitialCoachPortalState,
  reduceCoachPortalState,
  type CoachPortalSession,
} from "@/features/coach-portal/model/coach-portal";
import { CalendarRemindersProductiveBoundary } from "@/features/calendar-reminders";
import { AppBackButton } from "@/ui/navigation/app-back-button";
import {
  OVERLAY_INITIAL_FOCUS_ATTRIBUTE,
  useOverlayFocusManagement,
} from "@/ui/overlays/use-overlay-focus-management";

import styles from "./coach-portal.module.css";

const COACH_PORTAL_DRAWER_ID = "coach-portal-navigation-drawer";

const coachMenuIcons: Record<(typeof COACH_PORTAL_MENU_ITEMS)[number]["id"], LucideIcon> = {
  profile: UserRound,
  dashboard: LayoutDashboard,
  training: Dumbbell,
  comparison: ChartNoAxesCombined,
  "edit-cycle": Settings2,
  "cycle-history": History,
  calendar: CalendarDays,
  messages: MessagesSquare,
  logout: LogOut,
};

export interface CoachPortalBoundaryProps {
  session: CoachPortalSession;
  isLoggingOut: boolean;
  onLogout: () => void | Promise<void>;
}

export function CoachPortalBoundary({
  session,
  isLoggingOut,
  onLogout,
}: CoachPortalBoundaryProps) {
  const [state, dispatch] = useReducer(
    reduceCoachPortalState,
    undefined,
    createInitialCoachPortalState,
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const profile = useMemo(() => createCoachPortalProfileViewModel(session), [session]);

  function handleLogout() {
    dispatch({ type: "reset" });
    void onLogout();
  }

  return (
    <main className={styles.shell} data-portal="coach">
      <header className={styles.topbar}>
        <button
          ref={menuButtonRef}
          className={styles.iconButton}
          type="button"
          aria-label="Abrir menú Coach"
          aria-expanded={state.isMenuOpen}
          aria-controls={COACH_PORTAL_DRAWER_ID}
          disabled={isLoggingOut}
          onClick={() => dispatch({ type: "menu_opened" })}
        >
          <Menu aria-hidden="true" size={24} />
        </button>
        <div className={styles.brand}>
          <Image className={styles.brandIcon} src="/icon.svg" width={38} height={38} alt="" priority />
          <div>
            <h1>Organizatech</h1>
            <p>Coaching</p>
          </div>
        </div>
        <span className={styles.topbarSpacer} aria-hidden="true" />
      </header>

      <CoachPortalNavigationDrawer
        isOpen={state.isMenuOpen}
        activeScreen={state.screen}
        isCalendarOpen={isCalendarOpen}
        fullName={profile.fullName}
        professionalTitle={profile.professionalTitle}
        isLoggingOut={isLoggingOut}
        restoreFocusRef={menuButtonRef}
        onClose={() => dispatch({ type: "menu_closed" })}
        onOpenProfile={() => {
          setIsCalendarOpen(false);
          dispatch({ type: "profile_opened" });
        }}
        onOpenCalendar={() => {
          dispatch({ type: "menu_closed" });
          setIsCalendarOpen(true);
        }}
        onLogout={handleLogout}
      />

      {isCalendarOpen ? (
        <CalendarRemindersProductiveBoundary
          identityKey={session.userId}
          onBack={() => setIsCalendarOpen(false)}
        />
      ) : state.screen === "home" ? (
        <CoachPortalHome fullName={profile.fullName} />
      ) : (
        <CoachPortalProfile
          session={session}
          profile={profile}
          onBack={() => dispatch({ type: "home_opened" })}
        />
      )}
    </main>
  );
}

function CoachPortalHome({ fullName }: { fullName: string }) {
  return (
    <section className={styles.home} aria-labelledby="coach-home-title">
      <p className={styles.welcome}>{COACH_HOME_WELCOME}</p>
      <h2 id="coach-home-title">{fullName}</h2>
      <p className={styles.homeMessage}>{COACH_HOME_MESSAGE}</p>
    </section>
  );
}

function CoachPortalProfile({
  session,
  profile,
  onBack,
}: {
  session: CoachPortalSession;
  profile: ReturnType<typeof createCoachPortalProfileViewModel>;
  onBack: () => void;
}) {
  const { registration } = session;

  return (
    <section className={styles.profileScreen} aria-labelledby="coach-profile-title">
      <div className={styles.backRow}>
        <AppBackButton onBack={onBack} />
      </div>

      <div className={styles.profileSummary}>
        <div className={styles.avatarPlaceholder} aria-hidden="true">
          <UserRound size={50} strokeWidth={1.5} />
        </div>
        <div className={styles.summaryCopy}>
          <p className={styles.summaryLabel}>Perfil Coach</p>
          <h2 id="coach-profile-title">{profile.fullName}</h2>
          <p>{profile.email}</p>
          <p>{profile.ageLabel}</p>
          <p className={styles.profession}>{profile.professionalTitle}</p>
        </div>
      </div>

      <section className={styles.dataCard} aria-labelledby="coach-personal-data-title">
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.summaryLabel}>Información de la cuenta</p>
            <h3 id="coach-personal-data-title">Datos personales</h3>
          </div>
          <button
            className={styles.editButton}
            type="button"
            aria-label="Editar perfil (próximamente)"
            aria-disabled="true"
            disabled
          >
            <Pencil aria-hidden="true" size={16} />
            <span>Próximamente</span>
          </button>
        </div>

        <dl className={styles.dataList}>
          <CoachProfileField label="Nombre" value={registration.firstName} />
          <CoachProfileField label="Apellido" value={registration.lastName} />
          <CoachProfileField label="Fecha de nacimiento" value={profile.birthDateLabel} />
          <CoachProfileField label="Edad" value={profile.ageLabel} />
          <CoachProfileField label="Género" value={profile.genderLabel} />
          <CoachProfileField label="Celular" value={registration.phoneNumber} />
          <CoachProfileField label="Correo electrónico" value={profile.email} />
          <CoachProfileField label="Título profesional" value={registration.professionalTitle} />
        </dl>
      </section>
    </section>
  );
}

function CoachProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.dataRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CoachPortalNavigationDrawer({
  isOpen,
  activeScreen,
  isCalendarOpen,
  fullName,
  professionalTitle,
  isLoggingOut,
  restoreFocusRef,
  onClose,
  onOpenProfile,
  onOpenCalendar,
  onLogout,
}: {
  isOpen: boolean;
  activeScreen: "home" | "profile";
  isCalendarOpen: boolean;
  fullName: string;
  professionalTitle: string;
  isLoggingOut: boolean;
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenCalendar: () => void;
  onLogout: () => void;
}) {
  const drawerRef = useOverlayFocusManagement<HTMLDivElement>({
    isActive: isOpen,
    onClose,
    canClose: !isLoggingOut,
    restoreFocusRef,
  });

  if (!isOpen) return null;

  return (
    <>
      <button className={styles.backdrop} type="button" aria-label="Cerrar menú Coach" onClick={onClose} />
      <div
        ref={drawerRef}
        className={styles.drawer}
        id={COACH_PORTAL_DRAWER_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Menú Coach"
        tabIndex={-1}
      >
        <button
          className={styles.closeButton}
          type="button"
          aria-label="Cerrar menú Coach"
          disabled={isLoggingOut}
          onClick={onClose}
          {...{ [OVERLAY_INITIAL_FOCUS_ATTRIBUTE]: "" }}
        >
          <X aria-hidden="true" size={24} />
        </button>

        <div className={styles.drawerIdentity}>
          <div className={styles.drawerAvatar} aria-hidden="true">
            <UserRound size={34} strokeWidth={1.5} />
          </div>
          <div>
            <p>{fullName}</p>
            <span>{professionalTitle}</span>
          </div>
        </div>

        <nav aria-label="Navegación Coach">
          <ul className={styles.menuList}>
            {COACH_PORTAL_MENU_ITEMS.map((item) => {
              const ItemIcon = coachMenuIcons[item.id];

              if (item.availability === "disabled") {
                return (
                  <li key={item.id}>
                    <button className={styles.disabledMenuItem} type="button" aria-disabled="true" disabled>
                      <ItemIcon aria-hidden="true" size={19} />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              }

              if (item.id === "profile") {
                return (
                  <li key={item.id}>
                    <button
                      className={styles.menuItem}
                      type="button"
                      aria-current={!isCalendarOpen && activeScreen === "profile" ? "page" : undefined}
                      onClick={onOpenProfile}
                    >
                      <ItemIcon aria-hidden="true" size={19} />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              }

              if (item.id === "calendar") {
                return (
                  <li key={item.id}>
                    <button
                      className={styles.menuItem}
                      type="button"
                      aria-current={isCalendarOpen ? "page" : undefined}
                      onClick={onOpenCalendar}
                    >
                      <ItemIcon aria-hidden="true" size={19} />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              }

              return (
                <li key={item.id} className={styles.logoutRow}>
                  <button
                    className={styles.logoutButton}
                    type="button"
                    disabled={isLoggingOut}
                    onClick={onLogout}
                  >
                    <ItemIcon aria-hidden="true" size={19} />
                    <span>{isLoggingOut ? "Cerrando sesión..." : item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
