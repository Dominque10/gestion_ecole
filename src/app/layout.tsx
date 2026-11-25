import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { t } from "@/i18n";
import { isDemoMode } from "@/server/env";
import { ServiceWorkerRegistration } from "./service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: t("app.name"),
  description: t("app.description"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ServiceWorkerRegistration />
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
        {children}
      </body>
    </html>
  );
}

/** Mode démonstration (faux prestataires) : rappelé sur chaque page. Lu au moment de la requête. */
async function DemoBanner() {
  await connection();
  if (!isDemoMode()) return null;
  return (
    <p className="bg-amber-400 px-3 py-1 text-center text-sm font-medium text-black">
      {t("demo.banner")}
    </p>
  );
}
