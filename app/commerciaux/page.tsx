import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAccessScope, ADMIN_EMAILS } from "@/lib/permissions";
import { preparateurEmails } from "@/lib/inventory";
import { CommercialCard } from "@/components/commerciaux/CommercialCard";
import { CommerciauxSapList } from "./CommerciauxSapList";

export const metadata = { title: "Effectifs | TeleVent" };
export const dynamic = "force-dynamic";

export default async function CommerciauxPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Droits : un non-admin ne voit que SA carte SAP (filtrée par l'API) et
  // pas la section « équipe » (présence / % stock / récupération de clients).
  const scope = await getAccessScope(session);
  const isAdmin = scope.all;

  // ── Section équipe (admin) : comptes connectés + présence + répartition ──
  let teamSection: React.ReactNode = null;
  if (isAdmin) {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, stockSharePct: true },
      orderBy: { name: "asc" },
    });
    // Rôles admin / préparateur / commercial (colonnes hors client typé tant que
    // generate n'est pas relancé → lecture raw, repli silencieux si absentes).
    const adminByUser = new Map<string, boolean>();
    const prepByUser = new Map<string, boolean>();
    const commByUser = new Map<string, boolean>();
    try {
      const rows = await prisma.$queryRawUnsafe<{ id: string; isAdmin: boolean; isPreparateur: boolean; isCommercial: boolean }[]>(
        `SELECT "id", "isAdmin", "isPreparateur", "isCommercial" FROM "User"`,
      );
      for (const r of rows) { adminByUser.set(r.id, r.isAdmin); prepByUser.set(r.id, r.isPreparateur); commByUser.set(r.id, r.isCommercial); }
    } catch {
      // Colonnes isPreparateur/isCommercial absentes ? Repli sur isAdmin seul (DDL partielle).
      try {
        const rows = await prisma.$queryRawUnsafe<{ id: string; isAdmin: boolean }[]>(`SELECT "id", "isAdmin" FROM "User"`);
        for (const r of rows) adminByUser.set(r.id, r.isAdmin);
      } catch { /* aucune colonne de rôle → admin/prep false, commercial true par défaut */ }
    }
    const bootstrapAdmins = new Set(ADMIN_EMAILS.map((e) => e.toLowerCase()));
    const bootstrapPreparateurs = new Set(preparateurEmails());

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const presences = await prisma.presence.findMany({ where: { date: todayStart } });
    const presMap = new Map(presences.map((p) => [p.userId, p.present]));

    // Nombre de clients par commercial + par type (commercial = chaîne libre).
    const breakdown = await prisma.client.groupBy({
      by: ["commercial", "type"],
      _count: { id: true },
      where: { commercial: { not: null } },
    });
    type Counts = { ALL: number; CHR: number; GMS: number; EXPORT: number; OTHER: number };
    const countMap = new Map<string, Counts>();
    for (const b of breakdown) {
      const name = b.commercial;
      if (!name) continue;
      const counts = countMap.get(name) ?? { ALL: 0, CHR: 0, GMS: 0, EXPORT: 0, OTHER: 0 };
      counts.ALL += b._count.id;
      if (b.type === "CHR") counts.CHR += b._count.id;
      else if (b.type === "GMS") counts.GMS += b._count.id;
      else if (b.type === "EXPORT") counts.EXPORT += b._count.id;
      else counts.OTHER += b._count.id;
      countMap.set(name, counts);
    }
    const unassigned = await prisma.client.count({
      where: { OR: [{ commercial: null }, { commercial: "" }] },
    });

    teamSection = (
      <section className="space-y-4">
        <div>
          <p className="kicker mb-1">Équipe TeleVent</p>
          <p className="hidden md:block text-[12.5px] text-muted-foreground max-w-2xl">
            Comptes connectés : présence du jour, % de stock attribué et menu{" "}
            <span className="font-medium text-foreground">Récupérer ▾</span> pour reprendre
            temporairement les clients d&apos;un collègue absent.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {users.map((user) => {
            const name = user.name || user.email || "—";
            // Les clients sont rattachés par TRIGRAMME (ex. « Jean-Michel GUNSLAY »
            // → JMG, « Maxyme MANDINE » → MM), pas par nom complet. On dérive le
            // trigramme (1re lettre de chaque mot) pour retrouver ses clients.
            const trig = name.split(/[\s.\-_]+/).filter(Boolean).map((w) => w[0]?.toUpperCase() ?? "").join("");
            const key = countMap.has(trig) ? trig : (countMap.has(name) ? name : trig);
            const counts = countMap.get(key) ?? { ALL: 0, CHR: 0, GMS: 0, EXPORT: 0, OTHER: 0 };
            const emailLc = user.email?.toLowerCase();
            const bootstrapPrep = !!emailLc && bootstrapPreparateurs.has(emailLc);
            return (
              <CommercialCard
                key={user.id}
                userId={user.id}
                name={name}
                commercialKey={key}
                email={user.email}
                counts={counts}
                isMe={user.id === session.user?.id}
                present={presMap.get(user.id) ?? true}
                stockSharePct={user.stockSharePct ?? 100}
                isBootstrapAdmin={!!user.email && bootstrapAdmins.has(user.email.toLowerCase())}
                isAdmin={(!!user.email && bootstrapAdmins.has(user.email.toLowerCase())) || (adminByUser.get(user.id) ?? false)}
                isBootstrapPreparateur={bootstrapPrep}
                isPreparateur={bootstrapPrep || (prepByUser.get(user.id) ?? false)}
                isCommercial={commByUser.get(user.id) ?? true}
              />
            );
          })}
          {users.length === 0 && (
            <div className="col-span-2 text-center py-10 text-muted-foreground border border-border rounded-xl bg-card">
              <p className="text-[14px]">Aucun compte enregistré.</p>
              <p className="text-[12px] mt-1">Les comptes apparaissent après leur première connexion Microsoft.</p>
            </div>
          )}
        </div>
        {unassigned > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/15 p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-amber-800 dark:text-amber-300">
                {unassigned} client{unassigned > 1 ? "s" : ""} sans commercial assigné
              </p>
              <p className="text-[11.5px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                Ces clients n&apos;apparaissent dans la liste d&apos;aucun commercial.
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- navigation full-reload volontaire (comportement preexistant inchange) */}
            <a
              href="/clients?commercial=none"
              className="text-[12px] font-medium text-amber-800 dark:text-amber-300 hover:underline"
            >
              Voir →
            </a>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="kicker mb-1.5">Équipe &amp; rôles</p>
        <h1 className="font-display text-[34px] font-semibold text-foreground tracking-tight leading-none">
          Effectifs
        </h1>
        <p className="hidden md:block text-[12.5px] text-muted-foreground mt-2 max-w-2xl">
          Commerciaux SAP (activité sur 12 mois : CA net, volume BL, clients actifs) et,
          pour les administrateurs, gestion de l&apos;équipe : présence du jour, % de stock
          attribué et rôles (admin, préparateur en charge du stock).
        </p>
      </header>

      <CommerciauxSapList />

      {teamSection}
    </div>
  );
}
