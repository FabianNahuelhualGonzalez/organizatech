import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isCoachInvitationTermsRequired } from "./data/coach-linking-repository";
import type { CoachLinkingController } from "./hooks/use-coach-linking-controller";
import { COACH_LINK_MESSAGES, lookupMessageRole } from "./model/coach-linking";

const required = "Esta invitación debe ser renovada por tu Coach antes de poder aceptarla.";
const requireComponent = createRequire(import.meta.url);
const prior = requireComponent.extensions[".css"];
requireComponent.extensions[".css"] = (module, filename) => {
  module.exports = Object.fromEntries([...readFileSync(filename, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)]
    .map((match) => [match[1], match[1]]));
};
const { CoachLinkConfirmationScreen } = requireComponent("./components/coach-linking-screens.tsx") as typeof import("./components/coach-linking-screens");
const { CoachLinkingCardBoundary } = requireComponent("./components/coach-linking-card.tsx") as typeof import("./components/coach-linking-card");
if (prior) requireComponent.extensions[".css"] = prior;
else delete requireComponent.extensions[".css"];

function controller(patch: Record<string, unknown>): CoachLinkingController {
  return {
    snapshot: {
      activeState: "none", activeStateIdentityKey: "synthetic-user", cardMode: "form",
      code: "AB2CD3EF4", lookupStatus: "idle", coachName: null,
      confirmation: null, accepting: false, confirmationError: null,
      success: null, authGateOpen: false, ...patch,
    },
    actions: { openForm() {}, closeForm() {}, setCode() {}, lookup: async () => null,
      retryLookup: async () => null, accept: async () => null, retryAccept: async () => null,
      cancelConfirmation() {}, settleSuccess() {}, continueFromGate() {} },
  } as CoachLinkingController;
}

test("legacy lookup shows the exact safe renewal message at code entry", () => {
  assert.equal(COACH_LINK_MESSAGES.requiere_renovacion, required);
  assert.equal(lookupMessageRole("requiere_renovacion"), "alert");
  const markup = renderToStaticMarkup(createElement(CoachLinkingCardBoundary, {
    controller: controller({ lookupStatus: "requiere_renovacion" }),
    onOpenConfirmation() {}, onOpenSuccess() {},
  }));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /disabled=""[^>]*>Vincular<\/button>/);
  assert.ok(markup.includes(required));
  assert.doesNotMatch(markup, /amountClp|frequency|25000|coach_invitation_terms_required/);
});

test("acceptance from an open confirmation shows renewal guidance and disables acceptance", () => {
  const markup = renderToStaticMarkup(createElement(CoachLinkConfirmationScreen, {
    controller: controller({ confirmation: { code: "AB2CD3EF4", coachName: "Coach Test",
      requestId: "10000000-0000-4000-8000-000000000001" }, confirmationError: "requiere_renovacion" }),
    onSuccess() {}, onCancel() {},
  }));
  assert.ok(markup.includes(required));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /disabled=""[^>]*>Vincularme<\/button>/);
  assert.doesNotMatch(markup, /No pudimos completar la vinculación|coach_invitation_terms_required/);
});

test("only the dedicated server error code maps to renewal", () => {
  assert.equal(isCoachInvitationTermsRequired({ code: "P0C01", message: "private" }), true);
  for (const error of [{ code: "22023", message: "coach_invitation_terms_required" },
    { code: "P0C02" }, { message: "coach_invitation_terms_required" }, null,
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("private"); } })]) {
    assert.equal(isCoachInvitationTermsRequired(error), false);
  }
});
