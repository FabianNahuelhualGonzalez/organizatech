import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCoachCommercialMoney,
  calculateCoachDashboardMoney,
  calculateCoachRenewalAmountInPlay,
  formatCoachClpAmount,
  parseCoachMonthlyFeeInput,
  projectCoachClosedMonthMoney,
  type CoachClosedMonthMoneySnapshot,
  type CoachCommercialMoneyInput,
  type CoachDashboardMoneyInput,
} from "./coach-dashboard-money";

const input: CoachDashboardMoneyInput = Object.freeze({
  feeClp: 35_000, activeCount: 15, alertCount: 3, pendingCount: 2,
});

test("ingresos, riesgo y potencial provienen de tarifa única CLP y sus conteos", () => {
  assert.deepEqual(calculateCoachDashboardMoney(input), {
    incomeClp: 525_000, atRiskClp: 105_000, potentialClp: 595_000,
  });
  assert.deepEqual(calculateCoachDashboardMoney({ ...input, feeClp: 50_000 }), {
    incomeClp: 750_000, atRiskClp: 150_000, potentialClp: 850_000,
  });
});

test("tarifa o conteos desconocidos no se convierten en cero", () => {
  assert.deepEqual(calculateCoachDashboardMoney({ ...input, feeClp: null }), {
    incomeClp: null, atRiskClp: null, potentialClp: null,
  });
  assert.deepEqual(calculateCoachDashboardMoney({ ...input, activeCount: null }), {
    incomeClp: null, atRiskClp: 105_000, potentialClp: null,
  });
  assert.deepEqual(calculateCoachDashboardMoney({ ...input, alertCount: null, pendingCount: null }), {
    incomeClp: 525_000, atRiskClp: null, potentialClp: null,
  });
  assert.deepEqual(calculateCoachDashboardMoney({ feeClp: null, activeCount: 0, alertCount: 0, pendingCount: 0 }), {
    incomeClp: null, atRiskClp: null, potentialClp: null,
  });
});

test("cero conocido es válido, incluyendo tarifa gratuita y cartera vacía", () => {
  for (const scenario of [{ ...input, feeClp: 0 }, { ...input, activeCount: 0, alertCount: 0, pendingCount: 0 }]) {
    assert.deepEqual(calculateCoachDashboardMoney(scenario), { incomeClp: 0, atRiskClp: 0, potentialClp: 0 });
  }
  assert.equal(calculateCoachDashboardMoney({ ...input, feeClp: 0, activeCount: null }).incomeClp, null);
});

test("en juego incluye renovados y pendientes y excluye todas las bajas confirmadas", () => {
  for (const declined of [0, 1, 300, null]) {
    assert.equal(calculateCoachRenewalAmountInPlay(35_000, { renewed: 2, pending: 3, declined }), 175_000);
  }
  assert.equal(calculateCoachRenewalAmountInPlay(35_000, { renewed: 0, pending: 0, declined: 5 }), 0);
});

test("en juego conserva los desconocidos de los únicos operandos relevantes", () => {
  assert.equal(calculateCoachRenewalAmountInPlay(null, { renewed: 0, pending: 0, declined: 1 }), null);
  assert.equal(calculateCoachRenewalAmountInPlay(35_000, { renewed: null, pending: 2, declined: 1 }), null);
  assert.equal(calculateCoachRenewalAmountInPlay(35_000, { renewed: 2, pending: null, declined: 1 }), null);
});

test("rechaza negativos, fracciones, NaN, infinitos y enteros inseguros sin clamping", () => {
  for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(calculateCoachDashboardMoney({ ...input, feeClp: invalid }), {
      incomeClp: null, atRiskClp: null, potentialClp: null,
    });
    assert.equal(calculateCoachDashboardMoney({ ...input, activeCount: invalid }).incomeClp, null);
    assert.equal(calculateCoachDashboardMoney({ ...input, pendingCount: invalid }).potentialClp, null);
    assert.equal(calculateCoachDashboardMoney({ ...input, alertCount: invalid }).atRiskClp, null);
    assert.equal(calculateCoachRenewalAmountInPlay(1, { renewed: invalid, pending: 0, declined: 0 }), null);
    assert.equal(calculateCoachRenewalAmountInPlay(1, { renewed: 0, pending: invalid, declined: 0 }), null);
  }
});

test("sumas y productos se rechazan antes de devolver dinero fuera del rango seguro", () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(calculateCoachDashboardMoney({ feeClp: 1, activeCount: max, alertCount: 0, pendingCount: 1 }), {
    incomeClp: max, atRiskClp: 0, potentialClp: null,
  });
  assert.equal(calculateCoachDashboardMoney({ feeClp: 2, activeCount: max, alertCount: 0, pendingCount: 0 }).incomeClp, null);
  assert.equal(calculateCoachRenewalAmountInPlay(0, { renewed: max, pending: 1, declined: 0 }), null);
  assert.equal(calculateCoachRenewalAmountInPlay(max, { renewed: 1, pending: 1, declined: 0 }), null);
  assert.equal(calculateCoachRenewalAmountInPlay(1, { renewed: max - 1, pending: 1, declined: 0 }), max);
});

test("no agrega topes arbitrarios de negocio por debajo del entero seguro", () => {
  assert.equal(calculateCoachDashboardMoney({ feeClp: 1_000_000, activeCount: 1_000_000, alertCount: 0, pendingCount: 0 }).incomeClp, 1_000_000_000_000);
  assert.equal(calculateCoachRenewalAmountInPlay(2, { renewed: 1_000_000, pending: 1_000_000, declined: 0 }), 4_000_000);
});

test("formatea CLP con miles por punto y sin espacios o decimales", () => {
  for (const [amount, expected] of [[0, "$0"], [1, "$1"], [999, "$999"], [1000, "$1.000"], [525000, "$525.000"], [-105000, "−$105.000"]] as const) {
    assert.equal(formatCoachClpAmount(amount), expected);
  }
  assert.equal(formatCoachClpAmount(Number.MAX_SAFE_INTEGER), "$9.007.199.254.740.991");
});

test("no presenta valores desconocidos o inválidos como dinero real", () => {
  for (const invalid of [null, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(formatCoachClpAmount(invalid), null);
  }
});

test("cero negativo no llega al modelo ni al formato", () => {
  const money = calculateCoachDashboardMoney({ feeClp: -0, activeCount: -0, alertCount: -0, pendingCount: -0 });
  assert.deepEqual(money, { incomeClp: 0, atRiskClp: 0, potentialClp: 0 });
  assert.equal(formatCoachClpAmount(-0), "$0");
  assert.equal(Object.is(calculateCoachRenewalAmountInPlay(-0, { renewed: 1, pending: 0, declined: 0 }), -0), false);
});

test("cálculos son deterministas y no alteran inputs congelados", () => {
  const snapshot = JSON.stringify(input);
  assert.deepEqual(calculateCoachDashboardMoney(input), calculateCoachDashboardMoney(input));
  assert.equal(JSON.stringify(input), snapshot);
});

test("tarifa acepta enteros ASCII, presets y cero explícito sin topes comerciales", () => {
  for (const [raw, expected] of [
    ["0", 0], ["000", 0], ["1", 1], ["999", 999], ["1000", 1000],
    ["25000", 25_000], ["35000", 35_000], ["50000", 50_000],
    ["00035", 35], ["1000000000000", 1_000_000_000_000],
  ] as const) {
    assert.equal(parseCoachMonthlyFeeInput(raw), expected, raw);
    assert.equal(Object.is(parseCoachMonthlyFeeInput(raw), -0), false, raw);
  }
});

test("tarifa acepta sólo bloques de miles completos después del primer grupo", () => {
  for (const [raw, expected] of [
    ["0.000", 0], ["1.000", 1_000], ["25.000", 25_000],
    ["35.000", 35_000], ["50.000", 50_000], ["999.999", 999_999],
    ["1.000.000", 1_000_000], ["123.456.789", 123_456_789],
  ] as const) {
    assert.equal(parseCoachMonthlyFeeInput(raw), expected, raw);
  }
});

test("tarifa recorta únicamente espacios exteriores", () => {
  for (const raw of [" 35000 ", "\t35.000\n", "\r\n35000\r\n", "\u00a035.000\u00a0"]) {
    assert.equal(parseCoachMonthlyFeeInput(raw), 35_000, raw);
  }
});

test("tarifa vacía o incompleta conserva null y nunca se convierte en cero", () => {
  for (const raw of ["", " ", "\t\n", ".", "35.", "35.0", "35.00", ".000", "1.000."]) {
    const feeClp = parseCoachMonthlyFeeInput(raw);
    assert.equal(feeClp, null, raw);
    assert.deepEqual(calculateCoachDashboardMoney({ ...input, feeClp }), {
      incomeClp: null, atRiskClp: null, potentialClp: null,
    });
  }
});

test("tarifa rechaza decimales y puntos mal agrupados sin corregirlos", () => {
  for (const raw of [
    "0.5", "35.5", "35,5", "35,000", "35.000,00", "35000.00",
    "1234.000", "1.0000", "1.00.000", "1..000", "1.000..000", "1.000.00",
  ]) {
    assert.equal(parseCoachMonthlyFeeInput(raw), null, raw);
  }
});

test("tarifa rechaza signos, notaciones alternativas, moneda y texto sin truncar", () => {
  for (const raw of [
    "-0", "-35000", "−35000", "+35000", "(35000)", "3.5e4", "35e3",
    "0x88b8", "0XFF", "0o10", "0b10", "35000n", "NaN", "Infinity",
    "$35000", "$35.000", "35.000$", "CLP 35000", "35000abc", "abc35000", "35_000",
  ]) {
    assert.equal(parseCoachMonthlyFeeInput(raw), null, raw);
  }
});

test("tarifa rechaza espacios interiores, caracteres invisibles y dígitos no ASCII", () => {
  for (const raw of [
    "35 000", "35\t000", "35\n000", "35\u00a0000", "35\u202f000",
    "35. 000", "35 .000", "35000\u200b", "35\u0000000", "３５０００", "٣٥٠٠٠",
  ]) {
    assert.equal(parseCoachMonthlyFeeInput(raw), null, raw);
  }
});

test("tarifa admite MAX_SAFE exacto y rechaza overflow sin redondear o lanzar", () => {
  for (const raw of ["9007199254740991", "9.007.199.254.740.991"]) {
    assert.equal(parseCoachMonthlyFeeInput(raw), Number.MAX_SAFE_INTEGER, raw);
  }
  for (const raw of [
    "9007199254740992", "9007199254740993", "9.007.199.254.740.992",
    "9.007.199.254.740.993", "9".repeat(400), `1${".000".repeat(150)}`,
  ]) {
    assert.equal(parseCoachMonthlyFeeInput(raw), null, raw);
  }
});

test("tarifa hace roundtrip del formato CLP sin dólar en los bordes de agrupación", () => {
  const amounts = new Set([0, 1, 25_000, 35_000, 50_000, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]);
  for (let exponent = 1; exponent <= 15; exponent += 1) {
    const boundary = 10 ** exponent;
    for (const offset of [-1, 0, 1]) amounts.add(boundary + offset);
  }
  for (const amount of amounts) {
    const formatted = formatCoachClpAmount(amount);
    assert.ok(formatted !== null);
    assert.equal(parseCoachMonthlyFeeInput(formatted.slice(1)), amount, formatted);
    assert.equal(parseCoachMonthlyFeeInput(String(amount)), amount, String(amount));
    assert.equal(parseCoachMonthlyFeeInput(formatted), null, formatted);
  }
});

test("tarifa es pura y determinista sobre entradas congeladas", () => {
  const rawInputs = Object.freeze([" 35.000 ", "0", "", "35..000", "9007199254740992"]);
  const snapshot = JSON.stringify(rawInputs);
  const moneySnapshot = JSON.stringify(input);
  assert.deepEqual(rawInputs.map(parseCoachMonthlyFeeInput), [35_000, 0, null, null, null]);
  assert.deepEqual(rawInputs.map(parseCoachMonthlyFeeInput), rawInputs.map(parseCoachMonthlyFeeInput));
  assert.equal(JSON.stringify(rawInputs), snapshot);
  assert.equal(JSON.stringify(input), moneySnapshot);
});

const commercial: CoachCommercialMoneyInput = Object.freeze({
  feeClp: 35_000, activeCount: 15, pendingInvitationCount: 2, declinedCount: 3, confirmedPaymentsClp: 70_000,
});
const closedMonth: CoachClosedMonthMoneySnapshot = Object.freeze({
  kind: "closed-month", month: "2026-08", feeClpAtClose: 25_000,
  portfolioAtClose: Object.freeze({ activeCount: 10, pendingInvitationCount: 1, declinedCount: 2 }),
  confirmedPaymentsClpAtClose: 125_000,
});

test("proyección comercial separa activos, potencial de invitaciones, no-sigue y pago manual confirmado", () => {
  assert.deepEqual(calculateCoachCommercialMoney(commercial), {
    activeEstimateClp: 525_000, invitationPotentialClp: 70_000, totalPotentialClp: 595_000,
    declinedLossEstimateClp: 105_000, confirmedPaymentsClp: 70_000,
  });
  assert.deepEqual(Object.keys(calculateCoachCommercialMoney(commercial)).sort(), [
    "activeEstimateClp", "confirmedPaymentsClp", "declinedLossEstimateClp", "invitationPotentialClp", "totalPotentialClp",
  ]);
});

test("cambiar tarifa o cartera cambia sólo estimaciones, nunca pagos ya confirmados", () => {
  const updated = calculateCoachCommercialMoney({ ...commercial, feeClp: 50_000, activeCount: 20 });
  assert.deepEqual(updated, {
    activeEstimateClp: 1_000_000, invitationPotentialClp: 100_000, totalPotentialClp: 1_100_000,
    declinedLossEstimateClp: 150_000, confirmedPaymentsClp: 70_000,
  });
  assert.equal(calculateCoachCommercialMoney({ ...commercial, feeClp: null }).confirmedPaymentsClp, 70_000);
  assert.equal(calculateCoachCommercialMoney({ ...commercial, confirmedPaymentsClp: 19_999 }).confirmedPaymentsClp, 19_999);
});

test("pagos vencidos y alertas no se convierten en bajas, pérdidas o deuda", () => {
  const baseline = { ...commercial, declinedCount: 0 };
  const value = { ...baseline, expiredPaymentCount: 99, pendingPaymentCount: 80, alertCount: 70 };
  assert.deepEqual(calculateCoachCommercialMoney(value), calculateCoachCommercialMoney(baseline));
  assert.equal(calculateCoachCommercialMoney(value).declinedLossEstimateClp, 0);
  assert.equal(calculateCoachCommercialMoney({ ...value, declinedCount: null }).declinedLossEstimateClp, null);
});

test("agregados de cohortes independientes no inventan relaciones ni restan bajas de activos", () => {
  // Membership and deduplication are caller prerequisites, not facts inferred from counts.
  assert.deepEqual(calculateCoachCommercialMoney({ ...commercial, activeCount: 1, declinedCount: 10 }), {
    activeEstimateClp: 35_000, invitationPotentialClp: 70_000, totalPotentialClp: 105_000,
    declinedLossEstimateClp: 350_000, confirmedPaymentsClp: 70_000,
  });
  const noInvitations = calculateCoachCommercialMoney({ ...commercial, pendingInvitationCount: 0 });
  assert.equal(noInvitations.invitationPotentialClp, 0);
  assert.equal(noInvitations.totalPotentialClp, noInvitations.activeEstimateClp);
});

test("null conserva desconocidos por métrica sin borrar operandos independientes", () => {
  assert.deepEqual(calculateCoachCommercialMoney({ ...commercial, feeClp: null }), {
    activeEstimateClp: null, invitationPotentialClp: null, totalPotentialClp: null,
    declinedLossEstimateClp: null, confirmedPaymentsClp: 70_000,
  });
  assert.deepEqual(calculateCoachCommercialMoney({ ...commercial, activeCount: null }), {
    activeEstimateClp: null, invitationPotentialClp: 70_000, totalPotentialClp: null,
    declinedLossEstimateClp: 105_000, confirmedPaymentsClp: 70_000,
  });
  assert.deepEqual(calculateCoachCommercialMoney({ ...commercial, pendingInvitationCount: null, declinedCount: null, confirmedPaymentsClp: null }), {
    activeEstimateClp: 525_000, invitationPotentialClp: null, totalPotentialClp: null,
    declinedLossEstimateClp: null, confirmedPaymentsClp: null,
  });
});

test("ceros explícitos y cero negativo se normalizan sin tratar null como cero", () => {
  const zeros = { feeClp: -0, activeCount: -0, pendingInvitationCount: -0, declinedCount: -0, confirmedPaymentsClp: -0 };
  assert.deepEqual(calculateCoachCommercialMoney(zeros), {
    activeEstimateClp: 0, invitationPotentialClp: 0, totalPotentialClp: 0, declinedLossEstimateClp: 0, confirmedPaymentsClp: 0,
  });
  assert.deepEqual(calculateCoachCommercialMoney({ ...commercial, feeClp: 0, confirmedPaymentsClp: 0 }), calculateCoachCommercialMoney(zeros));
  assert.equal(calculateCoachCommercialMoney({ ...zeros, activeCount: null }).activeEstimateClp, null);
  assert.equal(calculateCoachCommercialMoney({ ...zeros, confirmedPaymentsClp: null }).confirmedPaymentsClp, null);
});

test("nuevos cálculos rechazan fracciones, negativos y no finitos por operando sin contaminar otros", () => {
  for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "35000" as never]) {
    assert.equal(calculateCoachCommercialMoney({ ...commercial, activeCount: invalid }).activeEstimateClp, null);
    assert.equal(calculateCoachCommercialMoney({ ...commercial, pendingInvitationCount: invalid }).invitationPotentialClp, null);
    assert.equal(calculateCoachCommercialMoney({ ...commercial, declinedCount: invalid }).declinedLossEstimateClp, null);
    const invalidConfirmed = calculateCoachCommercialMoney({ ...commercial, confirmedPaymentsClp: invalid });
    assert.equal(invalidConfirmed.confirmedPaymentsClp, null);
    assert.equal(invalidConfirmed.activeEstimateClp, 525_000);
    const invalidFee = calculateCoachCommercialMoney({ ...commercial, feeClp: invalid });
    assert.equal(invalidFee.activeEstimateClp, null);
    assert.equal(invalidFee.invitationPotentialClp, null);
    assert.equal(invalidFee.declinedLossEstimateClp, null);
    assert.equal(invalidFee.confirmedPaymentsClp, 70_000);
  }
});

test("overflow de suma o producto no redondea dinero ni exige sumar pagos a proyecciones", () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(calculateCoachCommercialMoney({ feeClp: 1, activeCount: max, pendingInvitationCount: 1, declinedCount: max, confirmedPaymentsClp: max }), {
    activeEstimateClp: max, invitationPotentialClp: 1, totalPotentialClp: null,
    declinedLossEstimateClp: max, confirmedPaymentsClp: max,
  });
  assert.deepEqual(calculateCoachCommercialMoney({ feeClp: 2, activeCount: max, pendingInvitationCount: 1, declinedCount: max, confirmedPaymentsClp: 0 }), {
    activeEstimateClp: null, invitationPotentialClp: 2, totalPotentialClp: null,
    declinedLossEstimateClp: null, confirmedPaymentsClp: 0,
  });
  assert.equal(calculateCoachCommercialMoney({ ...commercial, feeClp: 0, activeCount: max, pendingInvitationCount: 1 }).totalPotentialClp, null);
});

test("histórico calcula sólo con mes, tarifa y cartera del snapshot cerrado recibido", () => {
  assert.deepEqual(projectCoachClosedMonthMoney(closedMonth), {
    ...closedMonth,
    money: {
      activeEstimateClp: 250_000, invitationPotentialClp: 25_000, totalPotentialClp: 275_000,
      declinedLossEstimateClp: 50_000, confirmedPaymentsClp: 125_000,
    },
  });
  const historical = projectCoachClosedMonthMoney(closedMonth);
  for (const feeClp of [0, 35_000, 50_000, Number.MAX_SAFE_INTEGER, null]) {
    calculateCoachCommercialMoney({ ...commercial, feeClp });
    assert.deepEqual(projectCoachClosedMonthMoney({ ...closedMonth, currentFeeClp: feeClp } as CoachClosedMonthMoneySnapshot), historical);
    assert.equal(closedMonth.feeClpAtClose, 25_000);
    assert.equal(closedMonth.confirmedPaymentsClpAtClose, 125_000);
  }
});

test("histórico no sustituye tarifa desconocida por tarifa actual o cero ni borra pago confirmado", () => {
  const snapshot = { ...closedMonth, feeClpAtClose: null, currentFeeClp: 50_000 };
  assert.deepEqual(projectCoachClosedMonthMoney(snapshot)?.money, {
    activeEstimateClp: null, invitationPotentialClp: null, totalPotentialClp: null,
    declinedLossEstimateClp: null, confirmedPaymentsClp: 125_000,
  });
  const partial = projectCoachClosedMonthMoney({
    ...closedMonth, portfolioAtClose: { activeCount: null, pendingInvitationCount: 2, declinedCount: null }, confirmedPaymentsClpAtClose: null,
  });
  assert.deepEqual(partial?.money, {
    activeEstimateClp: null, invitationPotentialClp: 50_000, totalPotentialClp: null,
    declinedLossEstimateClp: null, confirmedPaymentsClp: null,
  });
});

test("histórico sólo acepta mes civil canónico y marcador cerrado explícito sin usar reloj", () => {
  for (const month of ["2026-01", "2026-12", "0001-01", "9999-12"]) {
    assert.equal(projectCoachClosedMonthMoney({ ...closedMonth, month })?.month, month);
  }
  for (const month of ["", "2026-00", "2026-13", "2026-1", "0000-01", "10000-01", "2026-08-01", "2026-08T00:00:00Z", " 2026-08", "2026-08 ", "2026-08\n", "2026-08\r\n"]) {
    assert.equal(projectCoachClosedMonthMoney({ ...closedMonth, month }), null, month);
  }
  for (const value of [null, undefined, [], {}, { ...closedMonth, kind: "open-month" }, { ...closedMonth, month: null }, { ...closedMonth, portfolioAtClose: null }, { ...closedMonth, portfolioAtClose: [] }]) {
    assert.equal(projectCoachClosedMonthMoney(value as CoachClosedMonthMoneySnapshot), null);
  }
});

test("snapshot inválido por campo conserva null independiente y nunca inventa cierre o valores", () => {
  const value = projectCoachClosedMonthMoney({
    ...closedMonth, feeClpAtClose: -1,
    portfolioAtClose: { activeCount: NaN, pendingInvitationCount: 2, declinedCount: Infinity },
    confirmedPaymentsClpAtClose: 17_000,
  });
  assert.equal(value?.feeClpAtClose, null);
  assert.deepEqual(value?.portfolioAtClose, { activeCount: null, pendingInvitationCount: 2, declinedCount: null });
  assert.equal(value?.money.confirmedPaymentsClp, 17_000);
  assert.equal(projectCoachClosedMonthMoney({ ...closedMonth, confirmedPaymentsClpAtClose: Number.MAX_SAFE_INTEGER + 1 })?.money.confirmedPaymentsClp, null);
});

test("proyecciones y snapshots son deterministas, congelados y no comparten objetos mutables", () => {
  const source = { ...closedMonth, portfolioAtClose: { ...closedMonth.portfolioAtClose } };
  const historical = projectCoachClosedMonthMoney(source);
  assert.ok(historical);
  assert.notEqual(historical.portfolioAtClose, source.portfolioAtClose);
  source.portfolioAtClose.activeCount = 900;
  source.feeClpAtClose = 99_000;
  source.confirmedPaymentsClpAtClose = 3;
  assert.equal(historical.portfolioAtClose.activeCount, 10);
  assert.equal(historical.money.activeEstimateClp, 250_000);
  assert.equal(historical.money.confirmedPaymentsClp, 125_000);
  for (const object of [historical, historical.portfolioAtClose, historical.money, calculateCoachCommercialMoney(commercial)]) {
    assert.equal(Object.isFrozen(object), true);
  }
  assert.deepEqual(projectCoachClosedMonthMoney(closedMonth), historical);
  assert.deepEqual(calculateCoachCommercialMoney(commercial), calculateCoachCommercialMoney(commercial));
});

test("legacy conserva shape y cálculos originales sin contaminarse con campos comerciales nuevos", () => {
  const legacy = { ...input, ...commercial, confirmedPaymentsClp: 17_000 };
  assert.deepEqual(calculateCoachDashboardMoney(legacy), {
    incomeClp: 525_000, atRiskClp: 105_000, potentialClp: 595_000,
  });
  assert.equal(calculateCoachRenewalAmountInPlay(35_000, { renewed: 2, pending: 3, declined: null }), 175_000);
});
