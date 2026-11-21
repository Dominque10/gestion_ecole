// Textes de l'interface en français (langue par défaut).
// Toute chaîne visible par l'utilisateur doit venir d'ici, jamais écrite en dur dans un composant.
export const fr = {
  app: {
    name: "Gestion scolaire",
    description: "Gestion des élèves, des frais de scolarité et des bulletins",
  },
  home: {
    placeholder: "La plateforme est en cours de construction.",
    login: "Se connecter",
  },
  login: {
    title: "Connexion",
    schoolCode: "Code de l'école",
    schoolCodeHelp:
      "Donné par votre école. Laissez vide si vous êtes administrateur de la plateforme.",
    identifier: "Téléphone ou email",
    identifierHelp: "Exemple : 06 123 45 67",
    password: "Mot de passe",
    submit: "Se connecter",
    pending: "Connexion…",
    invalid: "Code de l'école, téléphone ou mot de passe incorrect.",
    locked: "Trop d'essais. Votre compte est bloqué jusqu'à {heure}.",
    missingFields: "Remplissez le téléphone (ou l'email) et le mot de passe.",
  },
  session: {
    loading: "Chargement…",
    welcome: "Bonjour {nom}",
    roles: "Vos rôles : {roles}",
    platform: "Administration de la plateforme",
    logout: "Se déconnecter",
  },
  roles: {
    director: "Directeur",
    secretary: "Secrétaire / surveillant",
    accountant: "Comptable / caissier",
    teacher: "Enseignant",
    parent: "Parent",
    support: "Support (lecture seule)",
  },
} as const;

export type Messages = typeof fr;
