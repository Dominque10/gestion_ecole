// Réduction des images dans le navigateur, avant l'envoi (connexion 3G : on envoie peu d'octets).
// Le serveur revérifie de toute façon le type et la taille.

/** Plus grand côté de l'image après réduction (suffisant pour un en-tête de reçu ou de bulletin). */
export const MAX_IMAGE_SIDE = 800;
/** Cible en octets : sous la limite du serveur (500 Ko), avec de la marge. */
export const TARGET_IMAGE_BYTES = 300 * 1024;

/** Nouvelles dimensions : le plus grand côté ramené à `maxSide`, proportions conservées, jamais agrandi. */
export function scaledSize(
  width: number,
  height: number,
  maxSide = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Réduit une image et la convertit en WebP (ou JPEG si le navigateur ne sait pas produire du WebP).
 * Fond blanc : le cachet et la signature restent lisibles à l'impression.
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponible");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let best: Blob | null = null;
  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
    if (!blob) break;
    best = blob;
    if (blob.size <= TARGET_IMAGE_BYTES) break;
  }
  if (!best) throw new Error("Conversion impossible");
  return best;
}
