import assert from "node:assert/strict";

import {
  AUTH_REGISTRATION_GENDER_VALUES,
  buildCoachRegistrationPayload,
  buildLoginPayload,
  buildUserSignupPayload,
} from "@/features/auth/model/auth-form";

function createUserRegistrationForm(overrides: Record<string, string> = {}) {
  const values = {
    "register-first-name": "Fabian",
    "register-last-name": "Nahuelhual",
    "register-birth-date": "1990-08-14",
    "register-gender": "male",
    "register-phone-number": "+56 9 1234 5678",
    "register-email": "Fabian@Organizatech.cl",
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
    });
    const serialized = JSON.stringify(result.payload.registration);
    for (const forbidden of ["age", "email", "password", "user_id", "owner_id", "profile_id", "role"] as const) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} no debe entrar al write Coach`);
    }
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

console.log("auth-form tests passed");
