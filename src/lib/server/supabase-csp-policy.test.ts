import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildContentSecurityPolicy,
  resolveSupabaseCspEnvironment,
  resolveSupabaseCspOrigins,
  type SupabaseCspEnvironment,
} from "@/lib/server/supabase-csp-policy";

const PROJECT_HOST = "project-ref.supabase.co";
const PROJECT_ORIGIN = `https://${PROJECT_HOST}`;

function resolve(rawUrl: string | undefined, environment: SupabaseCspEnvironment = "production") {
  return resolveSupabaseCspOrigins(rawUrl, environment);
}

function getDirective(policy: string, name: string): string {
  return policy.split("; ").find((directive) => directive.startsWith(`${name} `) || directive === name) ?? "";
}

assert.deepEqual(resolve(PROJECT_ORIGIN), {
  httpOrigin: PROJECT_ORIGIN,
  websocketOrigin: `wss://${PROJECT_HOST}`,
});
assert.deepEqual(resolve(`${PROJECT_ORIGIN}/rest/v1/`), resolve(PROJECT_ORIGIN));
assert.deepEqual(resolve(`${PROJECT_ORIGIN}/auth/v1`), resolve(PROJECT_ORIGIN));
assert.deepEqual(resolve(`  ${PROJECT_ORIGIN}  `), resolve(PROJECT_ORIGIN));
assert.deepEqual(resolve(PROJECT_ORIGIN, "preview"), resolve(PROJECT_ORIGIN));
assert.deepEqual(resolve(PROJECT_ORIGIN, "development"), resolve(PROJECT_ORIGIN));

for (const localUrl of [
  "http://localhost:54321",
  "http://127.0.0.1:54321",
  "http://[::1]:54321",
]) {
  const origins = resolve(localUrl, "development");
  assert.equal(origins?.httpOrigin, localUrl);
  assert.equal(origins?.websocketOrigin, localUrl.replace("http:", "ws:"));
  assert.equal(resolve(localUrl, "preview"), null);
  assert.equal(resolve(localUrl, "production"), null);
}

for (const invalidUrl of [
  undefined,
  "",
  "not-a-url",
  `http://${PROJECT_HOST}`,
  `ws://${PROJECT_HOST}`,
  `wss://${PROJECT_HOST}`,
  `ftp://${PROJECT_HOST}`,
  "data:text/plain,hello",
  "javascript:alert(1)",
  "file:///tmp/example",
  "https://unapproved.example",
  `https://${PROJECT_HOST}.example.test`,
  `https://user:password@${PROJECT_HOST}`,
  `${PROJECT_ORIGIN}:8443`,
  `${PROJECT_ORIGIN}/storage/v1`,
  `${PROJECT_ORIGIN}?source=qa`,
  `${PROJECT_ORIGIN}#fragment`,
  `https://${PROJECT_HOST}; script-src *`,
  `${PROJECT_ORIGIN}/path;connect-src *`,
  `${PROJECT_ORIGIN}\nconnect-src *`,
  `${PROJECT_ORIGIN}\rconnect-src *`,
  `${PROJECT_ORIGIN}\tconnect-src *`,
  `${PROJECT_ORIGIN}\u0000connect-src *`,
]) {
  assert.equal(resolve(invalidUrl), null, `Debe rechazar ${JSON.stringify(invalidUrl)}`);
}

for (const invalidDevelopmentUrl of [
  `http://${PROJECT_HOST}`,
  "http://192.168.1.20:54321",
  "https://localhost:54321",
  "ftp://localhost:54321",
]) {
  assert.equal(resolve(invalidDevelopmentUrl, "development"), null);
}

assert.equal(resolveSupabaseCspEnvironment("development", undefined), "development");
assert.equal(resolveSupabaseCspEnvironment("development", "development"), "development");
assert.equal(resolveSupabaseCspEnvironment("production", "preview"), "preview");
assert.equal(resolveSupabaseCspEnvironment("production", "production"), "production");
assert.equal(resolveSupabaseCspEnvironment("development", "production"), "production");
assert.equal(resolveSupabaseCspEnvironment("test", undefined), "production");
assert.equal(resolveSupabaseCspEnvironment(undefined, undefined), "production");

const productionPolicy = buildContentSecurityPolicy({
  environment: "production",
  supabaseUrl: PROJECT_ORIGIN,
});
assert.match(getDirective(productionPolicy, "connect-src"), new RegExp(`https://${PROJECT_HOST} wss://${PROJECT_HOST}`));
assert.match(getDirective(productionPolicy, "img-src"), new RegExp(`https://${PROJECT_HOST}$`));
assert.match(getDirective(productionPolicy, "media-src"), new RegExp(`https://${PROJECT_HOST}$`));
assert.match(productionPolicy, /upgrade-insecure-requests/);
assert.doesNotMatch(productionPolicy, /(?:^|\s)http:/);
assert.doesNotMatch(productionPolicy, /(?:^|\s)ws:/);
assert.doesNotMatch(productionPolicy, /(?:^|\s)ftp:/);
assert.doesNotMatch(productionPolicy, /(?:^|\s)null(?:\s|;|$)/);
assert.doesNotMatch(productionPolicy, /unsafe-eval/);

const previewPolicy = buildContentSecurityPolicy({
  environment: "preview",
  supabaseUrl: PROJECT_ORIGIN,
});
assert.match(previewPolicy, /upgrade-insecure-requests/);
assert.doesNotMatch(previewPolicy, /(?:^|\s)http:|(?:^|\s)ws:|unsafe-eval/);

for (const maliciousUrl of [
  "https://unapproved.example",
  `http://${PROJECT_HOST}`,
  `ftp://${PROJECT_HOST}`,
  "data:text/plain,hello",
  `https://${PROJECT_HOST}; connect-src *`,
]) {
  assert.doesNotThrow(() => buildContentSecurityPolicy({
    environment: "production",
    supabaseUrl: maliciousUrl,
  }));
  const policy = buildContentSecurityPolicy({ environment: "production", supabaseUrl: maliciousUrl });
  assert.equal(getDirective(policy, "connect-src"), "connect-src 'self'");
  assert.doesNotMatch(policy, /unapproved|ftp:|(?:^|\s)null(?:\s|;|$)/);
}

const developmentPolicy = buildContentSecurityPolicy({
  environment: "development",
  supabaseUrl: "http://localhost:54321",
});
assert.match(getDirective(developmentPolicy, "connect-src"), /http:\/\/localhost:54321 ws:\/\/localhost:54321/);
assert.match(getDirective(developmentPolicy, "connect-src"), /ws:\/\/localhost:\*/);
assert.match(developmentPolicy, /unsafe-eval/);
assert.doesNotMatch(developmentPolicy, /upgrade-insecure-requests/);

const nextConfigSource = readFileSync("next.config.ts", "utf8");
assert.match(nextConfigSource, /buildContentSecurityPolicy\(\{/);
assert.match(nextConfigSource, /resolveSupabaseCspEnvironment/);
assert.doesNotMatch(nextConfigSource, /function getOrigin|function getWebSocketOrigin/);

console.log("supabase CSP policy tests passed");
