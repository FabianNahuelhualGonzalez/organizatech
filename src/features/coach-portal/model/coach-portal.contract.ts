import assert from "node:assert/strict";
import test from "node:test";

import type { CoachRegistrationRecord } from "@/features/auth/model/multiportal-auth-controller";
import {
  COACH_HOME_MESSAGE,
  COACH_HOME_WELCOME,
  COACH_PORTAL_MENU_ITEMS,
  createCoachPortalProfileViewModel,
  createCoachPortalSession,
  createInitialCoachPortalState,
  reduceCoachPortalState,
} from "@/features/coach-portal/model/coach-portal";

const registration: CoachRegistrationRecord = {
  userId: "coach-a",
  createdAt: "2026-08-16T12:00:00.000Z",
  firstName: "Ada",
  lastName: "Lovelace",
  birthDate: "1990-08-17",
  gender: "prefer_not_to_say",
  phoneNumber: "+56 9 1234 5678",
  professionalTitle: "Preparadora física",
};

test("la sesión Coach sólo se crea con identidad Auth y fila autoritativa coincidentes", () => {
  const session = createCoachPortalSession({
    authorizedUserId: "coach-a",
    authenticatedUser: { id: "coach-a", email: "auth@example.com" },
    registration,
  });

  assert.deepEqual(session, {
    portal: "coach",
    userId: "coach-a",
    email: "auth@example.com",
    registration,
  });
  assert.equal(createCoachPortalSession({
    authorizedUserId: "coach-b",
    authenticatedUser: { id: "coach-a", email: "auth@example.com" },
    registration,
  }), null);
  assert.equal(createCoachPortalSession({
    authorizedUserId: "coach-a",
    authenticatedUser: { id: "coach-a", email: "auth@example.com" },
    registration: { ...registration, userId: "coach-b" },
  }), null);
});

test("perfil Coach deriva edad desde birth_date y correo desde Auth", () => {
  const session = createCoachPortalSession({
    authorizedUserId: "coach-a",
    authenticatedUser: { id: "coach-a", email: "auth@example.com" },
    registration,
  });
  assert.ok(session);

  assert.deepEqual(createCoachPortalProfileViewModel(session, new Date(2026, 7, 16)), {
    fullName: "Ada Lovelace",
    email: "auth@example.com",
    age: 35,
    ageLabel: "35 años",
    birthDateLabel: "17/08/1990",
    genderLabel: "Prefiero no decir",
    professionalTitle: "Preparadora física",
  });
});

test("inicio, orden del menú y navegación local permanecen cerrados", () => {
  assert.equal(COACH_HOME_WELCOME, "bienvenido Coach.");
  assert.equal(
    COACH_HOME_MESSAGE,
    "Gracias por registrarte. Estamos construyendo algo grande, muchas gracias por la confianza!",
  );
  assert.deepEqual(COACH_PORTAL_MENU_ITEMS.map(({ label }) => label), [
    "Mi perfil",
    "Panel principal",
    "Entrenemos",
    "Comparación semanal",
    "Modificar ciclo de entrenamiento",
    "Historial ciclo de entrenamiento",
    "Calendario",
    "Mensajes",
    "Cerrar sesión",
  ]);
  assert.deepEqual(COACH_PORTAL_MENU_ITEMS.map(({ availability }) => availability), [
    "enabled",
    "disabled",
    "disabled",
    "disabled",
    "disabled",
    "disabled",
    "disabled",
    "disabled",
    "action",
  ]);

  const menuState = reduceCoachPortalState(createInitialCoachPortalState(), { type: "menu_opened" });
  assert.deepEqual(menuState, { screen: "home", isMenuOpen: true });
  assert.deepEqual(reduceCoachPortalState(menuState, { type: "profile_opened" }), {
    screen: "profile",
    isMenuOpen: false,
  });
  assert.deepEqual(reduceCoachPortalState(menuState, { type: "reset" }), {
    screen: "home",
    isMenuOpen: false,
  });
});
