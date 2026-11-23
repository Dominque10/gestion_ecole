"use server";

import { redirect } from "next/navigation";
import { selectChild } from "@/server/auth/parent";
import { readSessionToken, requireAction } from "@/server/auth/session";

/** Choix d'un enfant : la session bascule sur son école si besoin, puis sa page s'ouvre. */
export async function openChildAction(formData: FormData): Promise<void> {
  const { principal } = await requireAction("parent:view");
  const enrollmentId = String(formData.get("inscription") ?? "");
  const child = await selectChild(await readSessionToken(), principal, enrollmentId);
  redirect(child ? `/parent/enfant/${child.enrollmentId}` : "/parent");
}
