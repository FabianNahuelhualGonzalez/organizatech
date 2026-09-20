import assert from "node:assert/strict";
import test from "node:test";

import { getCoachClientDisplayName, type CoachClient } from "./coach-client";
import { countCoachClients, filterCoachClients } from "./coach-client-portfolio";

const clients: readonly CoachClient[] = Object.freeze([
  Object.freeze({
    id: "active-without-cycle", state: "active", displayName: "Ángela Pérez",
    email: "angela@example.test", cycle: null,
  }),
  Object.freeze({
    id: "active-with-cycle", state: "active", displayName: null,
    email: "linked@example.test",
    cycle: Object.freeze({ id: "cycle", description: null, completedSessions: null, plannedSessions: null }),
  }),
  Object.freeze({
    id: "pending", state: "pending", displayName: null,
    email: "invited@example.test", invitationCode: null,
  }),
  Object.freeze({
    id: "inactive", state: "inactive", displayName: "Camila",
    email: "former@example.test",
  }),
]);

test("los contadores separan vínculo y ciclo: un activo sin ciclo sigue activo", () => {
  assert.deepEqual(countCoachClients(clients), { active: 2, pending: 1, inactive: 1 });
  assert.deepEqual(countCoachClients([]), { active: 0, pending: 0, inactive: 0 });
  assert.equal(clients[0].state, "active");
  if (clients[0].state === "active") assert.equal(clients[0].cycle, null);
});

test("búsqueda vacía devuelve sólo la pestaña elegida conservando el orden", () => {
  assert.deepEqual(filterCoachClients(clients, "active", "  ").map((client) => client.id), [
    "active-without-cycle", "active-with-cycle",
  ]);
  assert.deepEqual(filterCoachClients(clients, "inactive", "").map((client) => client.id), ["inactive"]);
  assert.deepEqual(filterCoachClients([], "pending", ""), []);
});

test("busca por nombre con acentos, mayúsculas, espacios y Unicode descompuesto", () => {
  for (const query of ["ÁNGELA", " angela ", "Pe\u0301rez"]) {
    assert.deepEqual(filterCoachClients(clients, "active", query).map((client) => client.id), [
      "active-without-cycle",
    ]);
  }
});

test("busca por correo sin inventar nombre del pendiente ni buscar fuera de la cartera", () => {
  assert.deepEqual(filterCoachClients(clients, "pending", "INVITED@").map((client) => client.id), ["pending"]);
  assert.deepEqual(filterCoachClients(clients, "pending", "Camila"), []);
  assert.deepEqual(filterCoachClients(clients, "active", "not-shared@example.test"), []);
  assert.equal(getCoachClientDisplayName(clients[2]), "invited@example.test");
  assert.equal(getCoachClientDisplayName(clients[1]), "linked@example.test");
  assert.equal(getCoachClientDisplayName(clients[0]), "Ángela Pérez");
});

test("nombre compartido vacío usa correo y nunca agrega datos a la identidad", () => {
  const client: CoachClient = {
    id: "whitespace-name", state: "active", displayName: "  ", email: "known@example.test", cycle: null,
  };
  assert.equal(getCoachClientDisplayName(client), "known@example.test");
  assert.deepEqual(Object.keys(client).sort(), ["cycle", "displayName", "email", "id", "state"]);
});

test("filtrar no muta la cartera ni cambia sus contadores globales", () => {
  const snapshot = JSON.stringify(clients);
  const filtered = filterCoachClients(clients, "inactive", "CAM");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0], clients[3]);
  assert.deepEqual(countCoachClients(clients), { active: 2, pending: 1, inactive: 1 });
  assert.equal(JSON.stringify(clients), snapshot);
});
