// Message de reçu au parent (4d), programmé après chaque paiement enregistré (caisse ou en ligne).
import { scheduleNotice } from "@/modules/notifications/notices";

export async function notifyReceipt(job: {
  schoolId: string;
  userId: string;
  enrollmentId: string;
  paymentId: string;
}): Promise<void> {
  await scheduleNotice({ type: "receipt", ...job }).catch((error: unknown) =>
    console.error("Message de reçu non programmé :", (error as Error).message),
  );
}
