/**
 * Auth machine pour les crons Vercel (et déclencheurs externes).
 *
 * Vercel ajoute automatiquement `Authorization: Bearer <CRON_SECRET>` aux
 * requêtes de ses crons. On accepte aussi l'en-tête `x-cron-secret` (pour un
 * déclencheur externe). Désactivé si `CRON_SECRET` n'est pas défini côté
 * serveur : aucun bypass possible (retourne toujours false).
 *
 * Accepte tout objet à en-têtes (NextRequest OU Request standard) : on ne lit
 * que `headers.get(...)`, ce qui permet aux routes typées `req: Request` de
 * l'appeler sans cast.
 */
export function isCronAuthorized(req: { headers: Headers }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get("x-cron-secret") === secret) return true;
  return false;
}
