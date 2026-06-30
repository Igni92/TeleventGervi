import type { Session } from "next-auth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Journal d'audit applicatif (#8).
 *
 * `writeAudit` enregistre une action sensible dans la table `AuditLog`.
 * Best-effort : l'écriture est ENTIÈREMENT enveloppée dans un try/catch —
 * un échec d'audit (DB indisponible, modèle non migré…) ne doit JAMAIS jeter
 * ni faire échouer l'action métier appelante. On `await` quand même afin de
 * profiter de l'opération mais toute erreur est seulement journalisée.
 *
 * L'acteur est résolu depuis `opts.session` (email/name) si fourni, sinon
 * depuis les champs explicites `actorEmail` / `actorName`.
 */
export type WriteAuditOptions = {
  session?: Session | null;
  actorEmail?: string | null;
  actorName?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  details?: unknown;
};

export async function writeAudit(opts: WriteAuditOptions): Promise<void> {
  try {
    const actorEmail = opts.session?.user?.email ?? opts.actorEmail ?? null;
    const actorName = opts.session?.user?.name ?? opts.actorName ?? null;

    await prisma.auditLog.create({
      data: {
        actorEmail,
        actorName,
        action: opts.action,
        entity: opts.entity ?? null,
        entityId: opts.entityId ?? null,
        summary: opts.summary ?? null,
        details:
          opts.details === undefined
            ? undefined
            : (opts.details as Prisma.InputJsonValue),
      },
    });
  } catch (e) {
    // Audit best-effort : on ne propage jamais l'erreur à l'appelant.
    console.warn("[audit] writeAudit échoué (non-bloquant):", (e as Error).message);
  }
}
