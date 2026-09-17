import assert from "node:assert/strict";
import test from "node:test";

import {
  COACH_INVITATION_MAX_RESENDS_PER_WINDOW,
  COACH_INVITATION_RESEND_INTERVAL_MS,
  COACH_INVITATION_RESEND_WINDOW_MS,
  COACH_INVITATION_VALIDITY_MS,
  getCoachInvitationExpiresAtMs,
  getCoachInvitationResendEligibility,
  type CoachInvitationResendPolicyInput,
} from "./coach-invitation-policy";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Synthetic, explicit UTC timestamp. No phone clock or local calendar dependency.
const ISSUED_AT = Date.UTC(2026, 8, 5, 13);
const EXPIRES_AT = ISSUED_AT + 7 * DAY;

function policyInput(
  elapsedMs: number,
  reservedOffsetsMs: readonly number[] = [],
): CoachInvitationResendPolicyInput {
  return {
    state: "pending",
    issuedAtMs: ISSUED_AT,
    serverNowMs: ISSUED_AT + elapsedMs,
    acceptedResendOperations: reservedOffsetsMs.map((offset) => ({ reservedAtMs: ISSUED_AT + offset })),
  };
}

test("constantes corresponden exactamente a siete días, tres reenvíos/24h y 60s", () => {
  assert.equal(COACH_INVITATION_VALIDITY_MS, 7 * DAY);
  assert.equal(COACH_INVITATION_RESEND_WINDOW_MS, DAY);
  assert.equal(COACH_INVITATION_RESEND_INTERVAL_MS, MINUTE);
  assert.equal(COACH_INVITATION_MAX_RESENDS_PER_WINDOW, 3);
});

test("vencimiento usa duración absoluta del servidor, incluso durante cambio horario chileno", () => {
  assert.equal(getCoachInvitationExpiresAtMs(ISSUED_AT), EXPIRES_AT);
  assert.equal(EXPIRES_AT - ISSUED_AT, 604_800_000);
});

test("sigue vigente a 7 días menos 1ms y vence exactamente a los 7 días", () => {
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(7 * DAY - 1)), {
    allowed: true, reason: null, retryAtMs: null,
  });
  for (const elapsed of [7 * DAY, 7 * DAY + 1]) {
    assert.deepEqual(getCoachInvitationResendEligibility(policyInput(elapsed)), {
      allowed: false, reason: "expired", retryAtMs: null,
    });
  }
});

test("un reenvío reciente nunca extiende los siete días del código", () => {
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(7 * DAY, [7 * DAY - MINUTE])), {
    allowed: false, reason: "expired", retryAtMs: null,
  });
});

test("primer reenvío espera también 60s desde el envío inicial", () => {
  for (const elapsed of [0, MINUTE - 1]) {
    assert.deepEqual(getCoachInvitationResendEligibility(policyInput(elapsed)), {
      allowed: false, reason: "cooldown", retryAtMs: ISSUED_AT + MINUTE,
    });
  }
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(MINUTE)), {
    allowed: true, reason: null, retryAtMs: null,
  });
});

test("cada reserva nueva exige 60s completos antes de otra, no 59.999s", () => {
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(2 * MINUTE - 1, [MINUTE])), {
    allowed: false, reason: "cooldown", retryAtMs: ISSUED_AT + 2 * MINUTE,
  });
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(2 * MINUTE, [MINUTE])), {
    allowed: true, reason: null, retryAtMs: null,
  });
});

test("permite la tercera operación nueva, pero no una cuarta en la ventana", () => {
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(3 * MINUTE, [MINUTE, 2 * MINUTE])), {
    allowed: true, reason: null, retryAtMs: null,
  });
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(4 * MINUTE, [MINUTE, 2 * MINUTE, 3 * MINUTE])), {
    allowed: false, reason: "resend-limit", retryAtMs: ISSUED_AT + MINUTE + DAY,
  });
});

test("ventana móvil: una reserva deja de contar exactamente 24h después", () => {
  const history = [MINUTE, 2 * MINUTE, 3 * MINUTE];
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(DAY + MINUTE - 1, history)), {
    allowed: false, reason: "resend-limit", retryAtMs: ISSUED_AT + DAY + MINUTE,
  });
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(DAY + MINUTE, history)), {
    allowed: true, reason: null, retryAtMs: null,
  });
});

test("no reinicia cupos por medianoche ni por día calendario", () => {
  const input = policyInput(DAY + 2 * MINUTE, [DAY - 3 * MINUTE, DAY - 2 * MINUTE, DAY - MINUTE]);
  assert.deepEqual(getCoachInvitationResendEligibility(input), {
    allowed: false, reason: "resend-limit", retryAtMs: ISSUED_AT + 2 * DAY - 3 * MINUTE,
  });
});

test("historial viejo no consume cupo y el orden de llegada no cambia resultado", () => {
  const ordered = [MINUTE, 2 * MINUTE, 3 * MINUTE, 2 * DAY + MINUTE, 2 * DAY + 2 * MINUTE];
  const reverse = [...ordered].reverse();
  const shuffled = [ordered[3], ordered[1], ordered[4], ordered[0], ordered[2]];
  for (const history of [ordered, reverse, shuffled]) {
    assert.deepEqual(getCoachInvitationResendEligibility(policyInput(2 * DAY + 3 * MINUTE, history)), {
      allowed: true, reason: null, retryAtMs: null,
    });
  }
});

test("si el historial contiene más de tres reservas, espera que queden menos de tres", () => {
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(5 * MINUTE, [4 * MINUTE, MINUTE, 3 * MINUTE, 2 * MINUTE])), {
    allowed: false, reason: "resend-limit", retryAtMs: ISSUED_AT + 2 * MINUTE + DAY,
  });
});

test("retryAt respeta el mayor bloqueo cuando la ventana se libera antes del cooldown", () => {
  const history = [MINUTE, 2 * MINUTE, DAY + MINUTE - 30 * SECOND];
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(DAY + MINUTE - 1, history)), {
    allowed: false, reason: "cooldown", retryAtMs: ISSUED_AT + DAY + MINUTE + 30 * SECOND,
  });
});

test("no propone reintentar con una invitación que habrá vencido para entonces", () => {
  for (const latest of [7 * DAY - MINUTE, 7 * DAY - 30 * SECOND]) {
    assert.deepEqual(getCoachInvitationResendEligibility(policyInput(7 * DAY - 1, [latest])), {
      allowed: false, reason: "cooldown", retryAtMs: null,
    });
  }
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(6 * DAY + 5 * MINUTE, [6 * DAY + MINUTE, 6 * DAY + 2 * MINUTE, 6 * DAY + 3 * MINUTE])), {
    allowed: false, reason: "resend-limit", retryAtMs: null,
  });
});

test("invitaciones aceptadas y revocadas nunca autorizan reenvíos", () => {
  for (const state of ["accepted", "revoked"] as const) {
    assert.deepEqual(getCoachInvitationResendEligibility({ ...policyInput(HOUR), state }), {
      allowed: false, reason: state, retryAtMs: null,
    });
  }
});

test("rechaza timestamps inválidos, fraccionarios, infinitos y fuera de Date", () => {
  const invalidTimestamps = [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_001];
  for (const invalid of invalidTimestamps) {
    assert.equal(getCoachInvitationExpiresAtMs(invalid), null);
    assert.deepEqual(getCoachInvitationResendEligibility({ ...policyInput(HOUR), issuedAtMs: invalid }), {
      allowed: false, reason: "invalid-input", retryAtMs: null,
    });
    assert.deepEqual(getCoachInvitationResendEligibility({ ...policyInput(HOUR), serverNowMs: invalid }), {
      allowed: false, reason: "invalid-input", retryAtMs: null,
    });
    assert.deepEqual(getCoachInvitationResendEligibility({ ...policyInput(HOUR), acceptedResendOperations: [{ reservedAtMs: invalid }] }), {
      allowed: false, reason: "invalid-input", retryAtMs: null,
    });
  }
  assert.equal(getCoachInvitationExpiresAtMs(8_640_000_000_000_000), null);
});

test("rechaza emisión futura y reservas anteriores a emisión o futuras al reloj servidor", () => {
  for (const input of [policyInput(-1), policyInput(HOUR, [-1]), policyInput(HOUR, [HOUR + 1])]) {
    assert.deepEqual(getCoachInvitationResendEligibility(input), {
      allowed: false, reason: "invalid-input", retryAtMs: null,
    });
  }
});

test("reservas cuentan sin depender del resultado posterior del proveedor", () => {
  // Each entry represents a newly reserved logical operation. Delivery failure
  // or ambiguity is intentionally absent: it cannot refund a quota reservation.
  const snapshot = policyInput(4 * MINUTE, [MINUTE, 2 * MINUTE, 3 * MINUTE]);
  assert.equal(getCoachInvitationResendEligibility(snapshot).reason, "resend-limit");
  // Re-checking an idempotent retry does not append another reservation here.
  assert.deepEqual(getCoachInvitationResendEligibility(snapshot), getCoachInvitationResendEligibility(snapshot));
  assert.equal(snapshot.acceptedResendOperations.length, 3);
});

test("no deduplica operaciones por timestamp: esa identidad pertenece al servidor", () => {
  assert.deepEqual(getCoachInvitationResendEligibility(policyInput(3 * MINUTE, [MINUTE, MINUTE, MINUTE])), {
    allowed: false, reason: "resend-limit", retryAtMs: ISSUED_AT + DAY + MINUTE,
  });
});

test("no ordena ni altera el historial congelado provisto por servidor", () => {
  const history = Object.freeze([
    Object.freeze({ reservedAtMs: ISSUED_AT + 3 * MINUTE }),
    Object.freeze({ reservedAtMs: ISSUED_AT + MINUTE }),
    Object.freeze({ reservedAtMs: ISSUED_AT + 2 * MINUTE }),
  ]);
  const input = Object.freeze({ ...policyInput(4 * MINUTE), acceptedResendOperations: history });
  const before = JSON.stringify(input);
  assert.equal(getCoachInvitationResendEligibility(input).reason, "resend-limit");
  assert.equal(JSON.stringify(input), before);
});
