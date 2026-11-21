import { fr, type Messages } from "./fr";

// Clés pointées, ex. "app.name". Le typage refuse une clé inexistante.
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

const dictionaries = { fr } as const;
export type Locale = keyof typeof dictionaries;
export const defaultLocale: Locale = "fr";

/**
 * Renvoie le texte associé à une clé. Les `{nom}` sont remplacés par `params.nom`.
 */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  locale: Locale = defaultLocale,
): string {
  const value = key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dictionaries[locale]);
  if (typeof value !== "string") {
    throw new Error(`Texte introuvable : ${key}`);
  }
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
