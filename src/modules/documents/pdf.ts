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
      // Ticket de caisse : largeur fixe de 80 mm, hauteur ajustée au contenu (pas de papier perdu).
      await page.setViewportSize({ width: Math.round(74 * MM_TO_PX), height: 200 });
      await page.setContent(html, { waitUntil: "load" });
      const contentHeight = await page.evaluate(() =>
        Math.ceil(document.body.getBoundingClientRect().height),
      );
      return await page.pdf({
        width: "80mm",
        height: `${contentHeight + Math.round(8 * MM_TO_PX)}px`,
        margin: { top: "3mm", bottom: "3mm", left: "3mm", right: "3mm" },
        printBackground: true,
      });
    }
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await context.close();
  }
}
