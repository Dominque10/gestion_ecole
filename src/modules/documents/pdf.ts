// Conversion HTML → PDF avec Chromium (Playwright), dans le worker. Un seul navigateur est lancé et
// réutilisé ; chaque document s'ouvre dans un contexte isolé, sans accès réseau.
import { chromium, type Browser } from "playwright-core";
import type { PageFormat } from "./html";

let browser: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
  browser ??= chromium.launch({ headless: true });
  return browser;
}

export async function closePdfBrowser(): Promise<void> {
  if (!browser) return;
  const current = await browser;
  browser = undefined;
  await current.close();
}

const MM_TO_PX = 96 / 25.4;

export async function htmlToPdf(html: string, format: PageFormat): Promise<Uint8Array> {
  const context = await (
    await getBrowser()
  ).newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await context.newPage();
    if (format === "ticket") {
      // Ticket de caisse : largeur fixe de 80 mm, hauteur ajustée au contenu.
      await page.setViewportSize({ width: Math.round(80 * MM_TO_PX), height: 600 });
      await page.setContent(html, { waitUntil: "load" });
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      return await page.pdf({
        width: "80mm",
        height: `${height + Math.round(6 * MM_TO_PX)}px`,
        printBackground: true,
      });
    }
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await context.close();
  }
}
