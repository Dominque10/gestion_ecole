// Vérification des images envoyées (le type est lu dans le contenu, jamais cru sur parole).

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

/** Taille maximale acceptée par le serveur. Les images sont réduites dans le navigateur avant l'envoi. */
export const MAX_IMAGE_BYTES = 500 * 1024;

const EXTENSIONS: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Reconnaît PNG, JPEG et WebP par leur signature ; null pour tout autre contenu. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function imageExtension(type: ImageType): string {
  return EXTENSIONS[type];
}

export function imageTypeFromKey(key: string): ImageType | null {
  const ext = key.split(".").pop();
  const found = Object.entries(EXTENSIONS).find(([, e]) => e === ext);
  return found ? (found[0] as ImageType) : null;
}
