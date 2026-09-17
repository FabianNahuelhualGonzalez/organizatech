import type { CoachRenewalState } from "./coach-dashboard-view";

export const COACH_RENEWAL_OPTIONS: readonly { readonly state: CoachRenewalState; readonly label: string; readonly caption: string }[] = [
  { state: "renewed", label: "Pagado", caption: "El coach confirma el pago de este período" },
  { state: "pending", label: "Pago pendiente de confirmar", caption: "Consulta si sigue y confirma su pago" },
  { state: "declined", label: "No sigue", caption: "Avisó que no continúa" },
];

/** Radio keyboard geometry; never resolves renewal state or opens a modal. */
export function coachRenewalRadioTarget(state: CoachRenewalState, key: string): CoachRenewalState | null {
  const index = COACH_RENEWAL_OPTIONS.findIndex((option) => option.state === state);
  if (key === "ArrowRight" || key === "ArrowDown") return COACH_RENEWAL_OPTIONS[(index + 1) % 3].state;
  if (key === "ArrowLeft" || key === "ArrowUp") return COACH_RENEWAL_OPTIONS[(index + 2) % 3].state;
  if (key === "Home") return "renewed";
  if (key === "End") return "declined";
  return null;
}
