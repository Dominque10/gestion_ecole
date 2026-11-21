"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logout } from "@/server/auth/core";
import { clearSessionCookie, readSessionToken } from "@/server/auth/session";

export async function logoutAction(): Promise<void> {
  await logout(await readSessionToken());
  await clearSessionCookie();
  revalidatePath("/", "layout");
  redirect("/connexion");
}
