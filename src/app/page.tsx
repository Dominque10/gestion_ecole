import { t } from "@/i18n";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      <p className="text-base">{t("home.placeholder")}</p>
    </main>
  );
}
