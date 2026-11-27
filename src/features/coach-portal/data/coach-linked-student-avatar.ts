import { getCoachStudentRecordGateway } from "@/features/coach-student-record/data/coach-student-record-gateway";

export async function loadCoachLinkedStudentAvatar(coachId: string, episodeId: string, isCurrent: () => boolean): Promise<Blob | null> {
  const gateway = getCoachStudentRecordGateway(coachId, episodeId, isCurrent);
  const subject = await gateway.getSubject();
  return subject.avatarPath ? gateway.downloadAvatar(subject) : null;
}
