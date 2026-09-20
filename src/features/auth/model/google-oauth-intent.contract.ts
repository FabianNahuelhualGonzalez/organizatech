import assert from "node:assert/strict";
import test from "node:test";
import {
  blockGoogleOAuthPortal,
  createGoogleOAuthPortalHandoffGuard,
  GOOGLE_OAUTH_HANDOFF_KEY,
  prepareGoogleOAuthPortalHandoff,
} from "./google-oauth-portal-handoff";


import {
  GOOGLE_OAUTH_INTENT_TTL_MS,
  buildGoogleOAuthCallbackUrl,
  consumeGoogleOAuthIntent,
  createGoogleOAuthIntent,
  parseGoogleOAuthCallback,
  persistGoogleOAuthIntent,
} from "./google-oauth-intent";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("intent opaco usa 128 bits, no contiene PII y se consume una sola vez", () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({
    mode: "registro",
    portal: "coach",
    now: 100,
    randomBytes: () => new Uint8Array(16).fill(10),
  });
  assert.equal(intent.id, "0a".repeat(16));
  assert.doesNotMatch(JSON.stringify(intent), /@|email|password|token/i);
  persistGoogleOAuthIntent(storage, intent);
  assert.deepEqual(consumeGoogleOAuthIntent(storage, intent.id, 101), intent);
  assert.equal(consumeGoogleOAuthIntent(storage, intent.id, 101), null);
});

test("intent vencido, manipulado o con entropía insuficiente falla cerrado", () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({ mode: "login", portal: "usuario", now: 100, randomBytes: () => new Uint8Array(16) });
  persistGoogleOAuthIntent(storage, intent);
  assert.equal(consumeGoogleOAuthIntent(storage, intent.id, 100 + GOOGLE_OAUTH_INTENT_TTL_MS + 1), null);
  assert.equal(consumeGoogleOAuthIntent(storage, "../../session", 100), null);
  assert.throws(() => createGoogleOAuthIntent({ mode: "login", portal: "usuario", randomBytes: () => new Uint8Array(15) }));
});

test("callback es same-origin exacto y parser exige flow, code e intent", () => {
  const id = "ab".repeat(16);
  const url = buildGoogleOAuthCallbackUrl("https://organizatech.cl/path", id);
  assert.equal(url, `https://organizatech.cl/login?flow=google-oauth&intent=${id}`);
  assert.deepEqual(parseGoogleOAuthCallback({ pathname: "/login", search: `?flow=google-oauth&intent=${id}&code=one` }), { invalid: false, code: "one", intentId: id });
  assert.deepEqual(parseGoogleOAuthCallback({ pathname: "/login", search: `?flow=google-oauth&intent=${id}` }), { invalid: true });
  assert.equal(parseGoogleOAuthCallback({ pathname: "/", search: "" }), null);
  assert.throws(() => buildGoogleOAuthCallbackUrl("javascript:alert(1)", id));
});

test("callback Google conserva el alias estable de la rama QA y su intent PKCE", () => {
  const id = "cd".repeat(16);
  const qaOrigin = "https://organizatech-git-qa-owner.vercel.app";
  const callback = new URL(buildGoogleOAuthCallbackUrl(`${qaOrigin}/login?mode=login`, id));
  callback.searchParams.set("code", "supabase-auth-code");

  assert.equal(callback.origin, qaOrigin);
  assert.equal(callback.pathname, "/login");
  assert.deepEqual(parseGoogleOAuthCallback(callback), {
    invalid: false,
    code: "supabase-auth-code",
    intentId: id,
  });
});

test("destino post-auth tipado sobrevive al intent sin incluir PII", () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({
    mode: "login",
    portal: "usuario",
    postAuthDestination: "user-coach-profile",
    now: 100,
    randomBytes: () => new Uint8Array(16).fill(11),
  });
  persistGoogleOAuthIntent(storage, intent);
  assert.equal(consumeGoogleOAuthIntent(storage, intent.id, 101)?.postAuthDestination, "user-coach-profile");
  assert.doesNotMatch(JSON.stringify(intent), /@|email|token|coachCode/i);
});



const cleanCoachLocation = { pathname: "/login", search: "?mode=login&tipo=coach" };

for (const corruption of ["json", "portal", "phase", "expired", "future", "other-user"] as const) {
  test(`handoff ${corruption}: fail closed sin caer al portal por defecto`, async () => {
    const storage = memoryStorage();
    const intent = createGoogleOAuthIntent({ mode: "login", portal: "coach" });
    const handoff = await prepareGoogleOAuthPortalHandoff(storage, intent, "identity-a", () => undefined);
    handoff.ready();
    const record = JSON.parse(storage.getItem(GOOGLE_OAUTH_HANDOFF_KEY)!);
    if (corruption === "portal") record.portal = "admin";
    if (corruption === "phase") record.phase = "granted";
    if (corruption === "expired") record.createdAt = Date.now() - GOOGLE_OAUTH_INTENT_TTL_MS - 1;
    if (corruption === "future") record.createdAt = Date.now() + 10000;
    storage.setItem(GOOGLE_OAUTH_HANDOFF_KEY, corruption === "json" ? "{" : JSON.stringify(record));
    const guard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => cleanCoachLocation });
    assert.equal(await guard.validate(corruption === "other-user" ? "identity-b" : "identity-a", "coach"), false);
    assert.equal(guard.decision(), "reject_oauth");
    assert.equal(await guard.validate("identity-a", "usuario"), false);
    assert.equal(await guard.validate("identity-a", "coach"), false, "rechazo pegajoso hasta intento explícito");
  });
}

test("callback no puede resolver portal aun tras limpieza de URL o intención inválida", () => {
  const storage = memoryStorage();
  let location = { pathname: "/login", search: "?flow=google-oauth&intent=invalid" };
  const guard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => location });
  location = cleanCoachLocation;
  assert.equal(guard.decision(), "defer");
  blockGoogleOAuthPortal(storage);
  const cleanGuard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => location });
  assert.equal(cleanGuard.decision(), "reject_oauth");
});

test("sin OAuth no altera registro, recovery ni restauración; reset permite login explícito", () => {
  for (const search of ["", "?mode=registro&tipo=coach", "?flow=recovery", "?tipo=usuario"]) {
    const storage = memoryStorage();
    const guard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => ({ pathname: "/login", search }) });
    assert.equal(guard.decision(), "continue");
    blockGoogleOAuthPortal(storage);
    assert.equal(guard.decision(), "reject_oauth");
    guard.reset();
    assert.equal(guard.decision(), "continue");
  }
});

test("storage fallido o reemplazo durante transferencia no libera la barrera", async () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({ mode: "login", portal: "coach" });
  const handoff = await prepareGoogleOAuthPortalHandoff(storage, intent, "identity-a", () => undefined);
  const guard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => cleanCoachLocation });
  assert.equal(guard.decision(), "defer");
  blockGoogleOAuthPortal(storage);
  assert.throws(() => handoff.ready());
  assert.equal(guard.decision(), "reject_oauth");
  const unavailable = createGoogleOAuthPortalHandoffGuard({
    storage: { ...storage, getItem() { throw new Error("storage unavailable"); } },
    location: () => cleanCoachLocation,
  });
  assert.equal(unavailable.decision(), "reject_oauth");
});

test("validación vuelve a revisar reemplazo y vencimiento después del digest asíncrono", async () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({ mode: "login", portal: "coach" });
  (await prepareGoogleOAuthPortalHandoff(storage, intent, "identity-a", () => undefined)).ready();
  const guard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => cleanCoachLocation });
  const validation = guard.validate("identity-a", "coach");
  blockGoogleOAuthPortal(storage);
  assert.equal(await validation, false);
});


test("permiso de montaje se invalida si otro intento sustituye la resolución backend pendiente", async () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({ mode: "login", portal: "coach" });
  (await prepareGoogleOAuthPortalHandoff(storage, intent, "identity-a", () => undefined)).ready();
  const guard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => cleanCoachLocation });
  const permit = guard.capturePermit();
  assert.equal(permit(), true);
  guard.complete();
  assert.equal(permit(), true, "consumir el handoff no invalida la publicación autorizada");
  blockGoogleOAuthPortal(storage);
  assert.equal(permit(), false, "un intento nuevo invalida incluso el portal ya aceptado");
  guard.reset();
  assert.equal(permit(), false);

  const normalGuard = createGoogleOAuthPortalHandoffGuard({ storage, location: () => cleanCoachLocation });
  const pendingNormal = normalGuard.capturePermit();
  blockGoogleOAuthPortal(storage);
  assert.equal(pendingNormal(), false, "OAuth invalida un bootstrap previo que usaba el default");
});


test("operación invalidada durante digest no sobrescribe el intento nuevo", async () => {
  const storage = memoryStorage();
  const intent = createGoogleOAuthIntent({ mode: "login", portal: "coach" });
  let current = true;
  const pending = prepareGoogleOAuthPortalHandoff(storage, intent, "identity-a", () => {
    if (!current) throw new Error("stale");
  });
  current = false;
  blockGoogleOAuthPortal(storage);
  const newer = storage.getItem(GOOGLE_OAUTH_HANDOFF_KEY);
  await assert.rejects(pending, /stale/);
  assert.equal(storage.getItem(GOOGLE_OAUTH_HANDOFF_KEY), newer);
});
