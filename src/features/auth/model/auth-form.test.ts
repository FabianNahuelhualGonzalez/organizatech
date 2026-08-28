import assert from "node:assert/strict";

import {
  AUTH_REGISTRATION_GENDER_VALUES,
  AUTH_REGISTRATION_PORTAL_METADATA_KEY,
  buildCoachRegistrationPayload,
  buildGoogleUserRegistrationPayload,
  buildLoginPayload,
  buildSharedCoachRegistrationPayload,
  buildUserSignupPayload,
  withSignupConfirmationMetadata,
} from "@/features/auth/model/auth-form";

function createUserRegistrationForm(overrides: Record<string, string> = {}) {
  const values = {
    "register-first-name": "Fabian",
    "register-last-name": "Nahuelhual",
    "register-birth-date": "1990-08-14",
    "register-gender": "male",
    "register-phone-number": "+56 9 1234 5678",
    "register-email": "Fabian@Organizatech.cl",
    "register-contact-email": " Contacto@Organizatech.cl ",
    "register-password": "segura123",
    "register-confirm-password": "segura123",
    age: "36",
    role: "admin",
    user_id: "otro-usuario",
    owner_id: "otro-owner",
    profile_id: "otro-perfil",
    ...overrides,
  };
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

{
  const result = buildGoogleUserRegistrationPayload(
    createUserRegistrationForm({
      "register-email": "pii-no-transportada@example.test",
      "register-password": "credencial-no-transportada-123",
    }),
    new Date(2026, 7, 14),
  );
  assert.deepEqual(result, {
    ok: true,
    payload: {
      first_name: "Fabian",
      last_name: "Nahuelhual",
      birth_date: "1990-08-14",
      gender: "male",
      phone_number: "+56 9 1234 5678",
    },
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of ["email", "password", "user_id", "owner_id", "profile_id", "role"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} no entra al DTO Google Usuario`);
  }
}

{
  const result = buildSharedCoachRegistrationPayload(createUserRegistrationForm({
    "register-professional-title": "Preparador físico",
    "register-contact-email": " Fabian@Organizatech.cl ",
    "register-email": "Fabian@Organizatech.cl",
    "register-password": "otra-clave-que-no-debe-usarse",
    "register-confirm-password": "otra-clave-que-no-debe-usarse",
  }), new Date(2026, 7, 14));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.payload, {
      first_name: "Fabian",
      last_name: "Nahuelhual",
      birth_date: "1990-08-14",
      gender: "male",
      phone_number: "+56 9 1234 5678",
      professional_title: "Preparador físico",
      contact_email: "fabian@organizatech.cl",
    });
    const serialized = JSON.stringify(result.payload);
    assert.equal(serialized.includes("password"), false);
    assert.equal(serialized.includes("user_id"), false);
    assert.equal(serialized.includes("owner_id"), false);
    assert.equal(serialized.includes("profile_id"), false);
    assert.equal(serialized.includes("role"), false);
  }
}

{
  const login = new FormData();
  login.set("login-email", "correo-invalido");
  login.set("login-password", "secreta");
  assert.deepEqual(buildLoginPayload(login), {
    ok: false,
    field: "login-email",
    message: "Ingresa un correo electrónico válido.",
  });
}

{
  const login = new FormData();
  login.set("login-email", " User@Email.com ");
  login.set("login-password", "secreta");
  login.set("role", "coach");

  assert.deepEqual(buildLoginPayload(login), {
    ok: true,
    payload: { email: "user@email.com", password: "secreta" },
  });
}

{
  const result = buildUserSignupPayload(
    createUserRegistrationForm(),
    new Date(2026, 7, 14),
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.payload, {
      email: "fabian@organizatech.cl",
      password: "segura123",
      options: {
        data: {
          display_name: "Fabian Nahuelhual",
          first_name: "Fabian",
          last_name: "Nahuelhual",
          birth_date: "1990-08-14",
          gender: "male",
          phone_number: "+56 9 1234 5678",
        },
      },
    });

    const serialized = JSON.stringify(result.payload);
    for (const forbidden of ["age", "user_id", "owner_id", "profile_id", "role", "coach"]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} no debe entrar al payload`);
    }
  }
}

assert.equal(
  buildUserSignupPayload(
    createUserRegistrationForm({ "register-birth-date": "2016-08-15" }),
    new Date(2026, 7, 14),
  ).ok,
  false,
);
assert.equal(
  buildUserSignupPayload(
    createUserRegistrationForm({ "register-phone-number": "+56 nueve" }),
    new Date(2026, 7, 14),
  ).ok,
  false,
);
assert.equal(
  buildUserSignupPayload(
    createUserRegistrationForm({ "register-confirm-password": "distinta123" }),
    new Date(2026, 7, 14),
  ).ok,
  false,
);

for (const manipulatedGender of ["not_specified", "admin", "coach"]) {
  const result = buildUserSignupPayload(
    createUserRegistrationForm({ "register-gender": manipulatedGender }),
    new Date(2026, 7, 14),
  );
  assert.deepEqual(result, {
    ok: false,
    field: "register-gender",
    message: "Selecciona un género válido.",
  });
}

assert.deepEqual(AUTH_REGISTRATION_GENDER_VALUES, [
  "male",
  "female",
  "non_binary",
  "prefer_not_to_say",
]);

{
  const result = buildCoachRegistrationPayload(createUserRegistrationForm({
    "register-professional-title": "  Lic.   en Ciencias del Deporte  ",
  }), new Date(2026, 7, 14));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.payload.registration, {
      first_name: "Fabian",
      last_name: "Nahuelhual",
      birth_date: "1990-08-14",
      gender: "male",
      phone_number: "+56 9 1234 5678",
      professional_title: "Lic. en Ciencias del Deporte",
      contact_email: "contacto@organizatech.cl",
    });
    assert.deepEqual(Object.keys(result.payload.registration), [
      "first_name",
      "last_name",
      "birth_date",
      "gender",
      "phone_number",
      "professional_title",
      "contact_email",
    ]);
    const serialized = JSON.stringify(result.payload.registration);
    for (const forbidden of ["age", "password", "user_id", "owner_id", "profile_id", "role"] as const) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} no debe entrar al write Coach`);
    }
    assert.equal(serialized.includes("fabian@organizatech.cl"), false, "correo Auth no entra al write Coach");
  }
}

assert.deepEqual(
  buildCoachRegistrationPayload(createUserRegistrationForm(), new Date(2026, 7, 14)),
  {
    ok: false,
    field: "register-professional-title",
    message: "Ingresa tu título de estudios.",
  },
);

{
  const built = buildCoachRegistrationPayload(createUserRegistrationForm({
    "register-professional-title": "Preparador físico",
  }), new Date(2026, 7, 14));
  assert.equal(built.ok, true);
  if (built.ok) {
    const maliciousAuth = {
      ...built.payload.auth,
      options: {
        data: {
          ...built.payload.auth.options.data,
          user_id: "attacker-user",
          owner_id: "attacker-owner",
          profile_id: "attacker-profile",
          role: "admin",
        },
      },
      user_id: "attacker-user",
      owner_id: "attacker-owner",
      profile_id: "attacker-profile",
      role: "admin",
    } as typeof built.payload.auth;

    const coachSignup = withSignupConfirmationMetadata(
      maliciousAuth,
      {
        portal: "coach",
        professionalTitle: built.payload.registration.professional_title,
        contactEmail: built.payload.registration.contact_email,
      },
      "https://preview.example.test/login?flow=signup-confirmation",
    );
    assert.deepEqual(coachSignup.options.data, {
      display_name: "Fabian Nahuelhual",
      first_name: "Fabian",
      last_name: "Nahuelhual",
      birth_date: "1990-08-14",
      gender: "male",
      phone_number: "+56 9 1234 5678",
      [AUTH_REGISTRATION_PORTAL_METADATA_KEY]: "coach",
      professional_title: "Preparador físico",
      contact_email: "contacto@organizatech.cl",
    });
    assert.equal(
      coachSignup.options.emailRedirectTo,
      "https://preview.example.test/login?flow=signup-confirmation",
    );
    const userSignup = withSignupConfirmationMetadata(
      maliciousAuth,
      { portal: "usuario", professionalTitle: null },
      "https://preview.example.test/login?flow=signup-confirmation",
    );
    assert.equal(userSignup.options.data[AUTH_REGISTRATION_PORTAL_METADATA_KEY], "usuario");
    assert.equal("professional_title" in userSignup.options.data, false);
    assert.equal("contact_email" in userSignup.options.data, false);

    const serializedSignup = JSON.stringify({ coachSignup, userSignup });
    for (const forbidden of [
      "organizatech_registration_intent_id",
      "user_id",
      "owner_id",
      "profile_id",
      "role",
    ] as const) {
      assert.equal(serializedSignup.includes(forbidden), false, `${forbidden} no entra al signup`);
    }
  }
}

for (const invalidContactEmail of [
  "",
  "correo-invalido",
  " contacto @organizatech.cl ",
  `${"a".repeat(245)}@organizatech.cl`,
]) {
  const result = buildCoachRegistrationPayload(createUserRegistrationForm({
    "register-professional-title": "Preparador físico",
    "register-contact-email": invalidContactEmail,
  }), new Date(2026, 7, 14));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.field, "register-contact-email");
}

console.log("auth-form tests passed");
