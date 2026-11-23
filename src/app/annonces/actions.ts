"use server";

import { refresh } from "next/cache";
import { t } from "@/i18n";
import type { FormState } from "@/lib/form-state";
import { publishAnnouncement } from "@/modules/announcements/announcements";
import { requireAction } from "@/server/auth/session";
import { refusalMessage } from "@/server/forms";

export async function publishAnnouncementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { principal } = await requireAction("announcements:send");
  const audience = String(formData.get("public") ?? "school");
  const values = {
    public: audience,
    niveau: String(formData.get("niveau") ?? ""),
    classe: String(formData.get("classe") ?? ""),
    titre: String(formData.get("titre") ?? "").slice(0, 120),
    texte: String(formData.get("texte") ?? "").slice(0, 400),
    envoyer: formData.get("envoyer") === "on" ? "on" : "",
  };
  try {
    const result = await publishAnnouncement(principal, {
      audience: audience === "level" ? "level" : audience === "class" ? "class" : "school",
      levelId: audience === "level" ? values.niveau || null : null,
      classId: audience === "class" ? values.classe || null : null,
      title: values.titre,
      body: values.texte,
      sendMessage: values.envoyer === "on",
    });
    refresh();
    return {
      status: "success",
      message:
        result.messages > 0
          ? t("announcements.publishedWithMessages", { n: result.messages })
          : t("announcements.published"),
      fieldErrors: {},
      values: {},
    };
  } catch (error) {
    return { status: "error", message: refusalMessage(error), fieldErrors: {}, values };
  }
}
