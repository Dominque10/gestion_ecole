// Message d'absence au parent (décision D15) : un seul par élève et par jour, au responsable principal,
// 30 minutes après l'appel ; rien ne part si l'absence a été corrigée ou justifiée entre-temps ; les
// retards ne sont pas signalés. L'envoi (canal, modèle, coût, plafond) est fait par le module des
// notifications (4d).
import type { SmsProvider } from "@/server/sms";
import {
  ABSENCE_DELAY_SECONDS,
  processNotice,
  scheduleNotice,
  type NoticeOutcome,
} from "@/modules/notifications/notices";

/** Délai entre l'appel et le message (décision D15). */
export const NOTICE_DELAY_SECONDS = ABSENCE_DELAY_SECONDS;

export type AbsenceNotice = {
  schoolId: string;
  userId: string;
  enrollmentId: string;
  date: string;
};
export type { NoticeOutcome };

/** Programme le message du jour (une seule tâche en attente par élève et par jour). */
export function scheduleAbsenceNotice(notice: AbsenceNotice): Promise<void> {
  return scheduleNotice({ type: "absence", ...notice });
}

/** Envoie le message du jour (tâche du worker) ; `provider` remplace le prestataire (tests). */
export function processAbsenceNotice(
  input: unknown,
  provider?: SmsProvider,
): Promise<NoticeOutcome> {
  return processNotice(input, provider ? () => provider : undefined);
}
