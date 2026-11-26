// Site de démonstration (mise en service, Sg, décision D38) : école fictive et comptes connus, affichés
// sur la page de connexion quand DEMO_SITE=true. Aucune école réelle : nom, élèves et numéros inventés.
// Les numéros de téléphone n'appartiennent à personne : aucun SMS ne part (faux prestataire, H159).

export const DEMO_SCHOOL = {
  name: "École de démonstration Les Manguiers",
  code: "demo",
  matriculePrefix: "DEM",
} as const;

/** Mot de passe commun des comptes du personnel de démonstration (remis à neuf chaque nuit). */
export const DEMO_PASSWORD = "Manguiers-2026";

export type DemoAccountRole = "director" | "secretary" | "accountant" | "teacher";

export const DEMO_STAFF: readonly {
  role: DemoAccountRole;
  name: string;
  identifier: string;
}[] = [
  { role: "director", name: "Directrice Démo", identifier: "directeur@example.org" },
  { role: "secretary", name: "Secrétaire Démo", identifier: "secretariat@example.org" },
  { role: "accountant", name: "Caissier Démo", identifier: "caisse@example.org" },
  { role: "teacher", name: "Enseignant Démo", identifier: "enseignant@example.org" },
];

/** Parent de démonstration : deux enfants dans l'école (sélecteur d'enfant). */
export const DEMO_PARENT = { name: "Parent Démo", phone: "06 000 00 01" } as const;
