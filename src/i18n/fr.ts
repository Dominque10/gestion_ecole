// Textes de l'interface en français (langue par défaut).
// Toute chaîne visible par l'utilisateur doit venir d'ici, jamais écrite en dur dans un composant.
export const fr = {
  app: {
    name: "Gestion scolaire",
    description: "Gestion des élèves, des frais de scolarité et des bulletins",
  },
  home: {
    placeholder: "La plateforme est en cours de construction.",
  },
} as const;

export type Messages = typeof fr;
