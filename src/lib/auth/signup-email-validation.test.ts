import assert from "node:assert/strict";

import {
  isValidSignupEmailFormat,
  validateSignupEmail,
} from "@/lib/auth/signup-email-validation";

const invalidEmailMessage = "Ingresa un correo válido para poder confirmar tu cuenta.";
const blockedEmailMessage = "No uses correos de prueba. Necesitamos un correo real para confirmar tu cuenta.";

{
  assert.equal(isValidSignupEmailFormat("fabian.nahuelhual+qa@organizatech.cl"), true);
  assert.equal(isValidSignupEmailFormat("a@b.c"), false);
  assert.equal(isValidSignupEmailFormat("fabian@@organizatech.cl"), false);
  assert.equal(isValidSignupEmailFormat(".fabian@organizatech.cl"), false);
  assert.equal(isValidSignupEmailFormat("fabian..qa@organizatech.cl"), false);
  assert.equal(isValidSignupEmailFormat(`${"a".repeat(65)}@organizatech.cl`), false);
  assert.equal(isValidSignupEmailFormat("fabian@-organizatech.cl"), false);
  assert.equal(isValidSignupEmailFormat("fabian@organizatech.c"), false);
}

{
  assert.equal(validateSignupEmail("Fabian@Organizatech.CL"), null);
  assert.equal(validateSignupEmail("fabian nahuelhual@organizatech.cl"), "El correo no debe contener espacios.");
  assert.equal(validateSignupEmail(" fabian@organizatech.cl"), "El correo no debe contener espacios.");
  assert.equal(validateSignupEmail("correo-invalido"), invalidEmailMessage);
  assert.equal(validateSignupEmail("fabian@example.com"), blockedEmailMessage);
  assert.equal(validateSignupEmail("test@organizatech.cl"), blockedEmailMessage);
}
