import assert from "node:assert/strict";

import {
  collectProductionHosts,
  evaluateQaToolsAccess,
  type QaToolsAccessInput,
} from "@/lib/server/qa-tools-access-policy";

const QA_REF = "qaexampleprojectref";
const OTHER_REF = "otherexampleproject";

const previewInput: QaToolsAccessInput = {
  vercelEnv: "preview",
  nodeEnv: "production",
  qaToolsEnabled: "true",
  requestHost: "preview.example.test",
  productionHosts: "app.example.test,www.example.test",
  expectedQaSupabaseProjectRef: QA_REF,
  actualSupabaseUrl: `https://${QA_REF}.supabase.co`,
};

function evaluate(overrides: Partial<QaToolsAccessInput> = {}) {
  return evaluateQaToolsAccess({ ...previewInput, ...overrides });
}

assert.equal(evaluate({ vercelEnv: "production" }), false, "Production bloquea aunque el flag esté activo");
assert.equal(evaluate({ vercelEnv: "production", actualSupabaseUrl: `https://${QA_REF}.supabase.co` }), false);
assert.equal(evaluate({ requestHost: "app.example.test" }), false, "Un host productivo bloquea Preview");
assert.equal(evaluate({ qaToolsEnabled: undefined }), false, "Preview requiere flag");
assert.equal(evaluate({ qaToolsEnabled: "false" }), false, "Flag false bloquea");

for (const value of ["TRUE", "1", " true", "true "]) {
  assert.equal(evaluate({ qaToolsEnabled: value }), false, `Flag ambiguo ${JSON.stringify(value)} bloquea`);
}

assert.equal(evaluate(), true, "Preview válido queda habilitado");
assert.equal(evaluate({ actualSupabaseUrl: `https://${OTHER_REF}.supabase.co` }), false, "Ref distinto bloquea");
assert.equal(evaluate({ actualSupabaseUrl: "not-a-url" }), false, "URL inválida bloquea");
assert.equal(evaluate({ actualSupabaseUrl: `http://${QA_REF}.supabase.co` }), false, "HTTP bloquea");

for (const url of [
  `https://${QA_REF}.supabase.co:8443`,
  `https://${QA_REF}.supabase.co/rest/v1`,
  `https://${QA_REF}.supabase.co?source=qa`,
  `https://${QA_REF}.supabase.co#qa`,
  `https://user:password@${QA_REF}.supabase.co`,
  `https://${QA_REF}.supabase.co.example.test`,
]) {
  assert.equal(evaluate({ actualSupabaseUrl: url }), false, `URL no canónica ${url} bloquea`);
}

assert.equal(evaluate({ vercelEnv: undefined, nodeEnv: "development", qaToolsEnabled: undefined }), false);
assert.equal(evaluate({ vercelEnv: undefined, nodeEnv: "development" }), true, "Development explícito válido");
assert.equal(evaluate({
  vercelEnv: undefined,
  nodeEnv: "development",
  actualSupabaseUrl: `https://${OTHER_REF}.supabase.co`,
}), false, "Development no acepta Supabase distinto");
assert.equal(evaluate({ vercelEnv: "staging", nodeEnv: "development" }), false, "Entorno desconocido bloquea");
assert.equal(evaluate({ vercelEnv: undefined, nodeEnv: "production" }), false, "NODE_ENV production no habilita");

assert.equal(evaluate({ requestHost: "PREVIEW.EXAMPLE.TEST:443" }), true, "Host y puerto se normalizan");
assert.equal(evaluate({
  requestHost: "APP.EXAMPLE.TEST:443",
  productionHosts: "app.example.test.",
}), false, "Host productivo uppercase/puerto se bloquea");
assert.equal(evaluate({ requestHost: "preview.example.test, proxy.internal.test" }), true, "Solo se usa el primer forwarded host");
assert.equal(evaluate({ requestHost: "sub.app.example.test" }), true, "Subdominio parecido no coincide");
assert.equal(evaluate({
  requestHost: "second.example.test",
  productionHosts: "first.example.test, second.example.test, third.example.test",
}), false, "Lista de hosts productivos se procesa completa");

const combinedHosts = collectProductionHosts("app.example.test", "production.example.test");
assert.equal(combinedHosts, "app.example.test,production.example.test");
assert.equal(evaluate({
  requestHost: "production.example.test",
  productionHosts: combinedHosts,
}), false, "La URL productiva de Vercel se incorpora al bloqueo");

assert.equal(evaluate({ requestHost: undefined }), false, "Host ausente bloquea");
assert.equal(evaluate({ requestHost: "https://preview.example.test" }), false, "Host inválido bloquea");
assert.equal(evaluate({ productionHosts: "https://app.example.test" }), false, "Sin hosts productivos válidos bloquea");

console.log("qa-tools access policy tests passed");
