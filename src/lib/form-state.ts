/** État renvoyé par une action serveur de formulaire (affiché par le composant client). */
export type FormState = {
  status: "idle" | "error" | "success";
  message: string | null;
  /** Message par champ (clé = attribut `name` du champ). */
  fieldErrors: Record<string, string>;
  /** Valeurs saisies, renvoyées pour ne pas vider le formulaire en cas d'erreur (jamais de mot de passe). */
  values: Record<string, string>;
};

export const idleFormState: FormState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  values: {},
};
