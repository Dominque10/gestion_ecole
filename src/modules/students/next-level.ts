// Niveau suivant pour la réinscription (fonction pure) : dans l'ordre des cycles puis des niveaux,
// CM2 → 6e, 3e → 2nde. Après le dernier niveau (Tle), pas de niveau suivant.
import { cycleRank, type Cycle } from "@/modules/settings/defaults";

export type OrderedLevel = { id: string; cycle: Cycle; position: number };

export function nextLevelId(levels: readonly OrderedLevel[], currentId: string): string | null {
  const sorted = [...levels].sort(
    (a, b) => cycleRank(a.cycle) - cycleRank(b.cycle) || a.position - b.position,
  );
  const index = sorted.findIndex((l) => l.id === currentId);
  return index >= 0 && index < sorted.length - 1 ? sorted[index + 1].id : null;
}
