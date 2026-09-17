import type { CoachPendingInvitationsController, CoachPendingInvitationsControllerInput,
  CoachPendingInvitationsCursor, CoachPendingInvitationsItem,
} from "./coach-pending-invitations-controller-contract";
import { createCoachClientListController, readCoachClientListField, readCoachClientListString,
  readCoachClientListTimestamp, rejectCoachClientListPage } from "./internal/coach-client-list-controller";

const pendingShape = Object.freeze({
  totalField: "totalPending" as const,
  timestamp: (position: CoachPendingInvitationsCursor) => position.createdAt,
  copyCursor: (value: unknown): CoachPendingInvitationsCursor => Object.freeze({
    id: readCoachClientListString(value, "id"), createdAt: readCoachClientListTimestamp(value, "createdAt"),
  }),
  copyItem: (value: unknown): CoachPendingInvitationsItem => {
    const state = readCoachClientListField(value, "state");
    if (state !== "pending" && state !== "expired") return rejectCoachClientListPage();
    return Object.freeze({
      id: readCoachClientListString(value, "id"), createdAt: readCoachClientListTimestamp(value, "createdAt"),
      recipientEmail: readCoachClientListString(value, "recipientEmail"),
      issuedAt: readCoachClientListTimestamp(value, "issuedAt"), expiresAt: readCoachClientListTimestamp(value, "expiresAt"),
      state,
    });
  },
});

/** Public pending contract is unchanged; only the private lifecycle is shared with active relationships. */
export function createCoachPendingInvitationsController(
  input: CoachPendingInvitationsControllerInput,
): CoachPendingInvitationsController {
  return createCoachClientListController(input, pendingShape);
}
