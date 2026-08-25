import assert from "node:assert/strict";

import {
  createAuthHref,
  DEFAULT_AUTH_ROUTE,
  resolveAuthRouteState,
} from "@/features/auth/model/auth-route";

assert.deepEqual(resolveAuthRouteState({}), DEFAULT_AUTH_ROUTE);
assert.deepEqual(resolveAuthRouteState({ mode: "login", tipo: "usuario" }), DEFAULT_AUTH_ROUTE);
assert.deepEqual(resolveAuthRouteState({ mode: "registro", tipo: "usuario" }), {
  mode: "registro",
  accountType: "usuario",
});
assert.deepEqual(resolveAuthRouteState({ mode: "registro", tipo: "coach" }), {
  mode: "registro",
  accountType: "coach",
});
assert.deepEqual(resolveAuthRouteState({ mode: ["registro"], tipo: ["coach"] }), {
  mode: "registro",
  accountType: "coach",
});
assert.deepEqual(resolveAuthRouteState({ mode: "admin", tipo: "owner" }), DEFAULT_AUTH_ROUTE);

assert.equal(createAuthHref(DEFAULT_AUTH_ROUTE), "/login");
assert.equal(
  createAuthHref({ mode: "registro", accountType: "usuario" }),
  "/login?mode=registro&tipo=usuario",
);
assert.equal(
  createAuthHref({ mode: "registro", accountType: "coach" }),
  "/login?mode=registro&tipo=coach",
);
assert.equal(
  createAuthHref({ mode: "login", accountType: "coach" }),
  "/login?mode=login&tipo=coach",
);

console.log("auth-route tests passed");
