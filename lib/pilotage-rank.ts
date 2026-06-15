/**
 * Classement « top » par valeur NETTE — fonction PURE (zéro I/O, zéro import)
 * pour être testable hors-ligne (vitest ne résout pas l'alias `@/`, et
 * lib/pilotage importe Prisma).
 *
 * Net = brut − déduction par clé. On nette AVANT de classer (un client à fort
 * volume d'avoirs peut reculer dans le top), puis on coupe à `limit`. Même
 * logique métier que topSuppliers (Achats NET = EM − retours).
 */
export function rankByNet(
  gross: { key: string; gross: number; count: number }[],
  deductByKey: Map<string, number>,
  limit: number,
): { key: string; net: number; count: number }[] {
  return gross
    .map((g) => ({ key: g.key, net: g.gross - (deductByKey.get(g.key) ?? 0), count: g.count }))
    .sort((a, b) => b.net - a.net)
    .slice(0, limit);
}
