import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAccessScope, getOwnSlpName, requireStrictAdmin, ADMIN_EMAILS } from "@/lib/permissions";
import { CommercialCard } from "@/components/commerciaux/CommercialCard";
import { normalizeSlp } from "@/lib/salespeople";
import { EffectifsPreviewBar } from "@/components/role-preview/EffectifsPreviewBar";
import { CommerciauxSapList } from "./CommerciauxSapList";
import { HeuresPanel } from "@/components/effectifs/HeuresPanel";
import { CommissionsPanel } from "@/components/effectifs/CommissionsPanel";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatBlock } from "@/components/ui/stat-block";
import { EmptyState } from "@/components/ui/empty-state";
import { Users } from "lucide-react";

export const metadata = { title: "Effectifs | Gervi" };
export const dynamic = "force-dynamic";

export default async function CommerciauxPage() {
  const session = await auth();
  if (!session) redirect("/login");

  // Droits : un non-manager ne voit que SA carte SAP (filtrée par l'API) et pas la
  // section « équipe ». Admin ET direction y accèdent (scope.all) ; mais seul un
  // admin strict peut (dé)cocher le rôle Admin (canEditAdmin).
  const scope = await getAccessScope(session);
  const isManager = scope.all;
  const strictAdmin = await requireStrictAdmin(session);
  // Trigramme de l'utilisateur connecté = destination des bascules « chez moi »
  // dans la popup de transfert (réservée aux managers, cf. canTransfer).
  const myTrigramme = isManager ? await getOwnSlpName(session) : null;
  const myName = session.user?.name ?? null;

  // ── Section équipe (admin/direction) : comptes connectés + présence + rôles ──
  let teamSection: React.ReactNode = null;
  // KPI d'équipe (bandeau de cases d'INFO teintées) + alerte remontée EN TÊTE.
  let teamKpis: React.ReactNode = null;
  let unassignedClients = 0;
  if (isManager) {
    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, stockSharePct: true },
      orderBy: { name: "asc" },
    });
    // Rôles (colonnes hors client typé tant que generate n'est pas relancé →
    // lecture raw, repli silencieux si absentes).
    const adminByUser = new Map<string, boolean>();
    const prepByUser = new Map<string, boolean>();
    const commByUser = new Map<string, boolean>();
    const dirByUser = new Map<string, boolean>();
    const livByUser = new Map<string, boolean>();
    const agrByUser = new Map<string, boolean>();
    try {
      const rows = await prisma.$queryRawUnsafe<{ id: string; isAdmin: boolean; isPreparateur: boolean; isCommercial: boolean; isDirection: boolean; isLivreur: boolean; isAgreeur: boolean }[]>(
        `SELECT "id", "isAdmin", "isPreparateur", "isCommercial", "isDirection", "isLivreur", "isAgreeur" FROM "User"`,
      );
      for (const r of rows) { adminByUser.set(r.id, r.isAdmin); prepByUser.set(r.id, r.isPreparateur); commByUser.set(r.id, r.isCommercial); dirByUser.set(r.id, r.isDirection); livByUser.set(r.id, r.isLivreur); agrByUser.set(r.id, r.isAgreeur); }
    } catch {
      // Colonnes de rôle partiellement absentes ? Repli sur isAdmin seul.
      try {
        const rows = await prisma.$queryRawUnsafe<{ id: string; isAdmin: boolean }[]>(`SELECT "id", "isAdmin" FROM "User"`);
        for (const r of rows) adminByUser.set(r.id, r.isAdmin);
      } catch { /* aucune colonne → admin/prep/dir false, commercial true par défaut */ }
    }
    const bootstrapAdmins = new Set(ADMIN_EMAILS.map((e) => e.toLowerCase()));

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
    unassignedClients = unassigned;

    // Effectif présent / force de vente (commercial coché, défaut vrai).
    const presentCount = users.filter((u) => presMap.get(u.id) ?? true).length;
    const commCount = users.filter((u) => commByUser.get(u.id) ?? true).length;

    // KPI d'équipe — cases de PRISE D'INFO : SurfaceCard teintée (identité couleur),
    // valeur héros via le StatBlock partagé. Texte foncé lisible (pas de tone coloré).
    teamKpis = (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SurfaceCard tinted accent="brand">
          <StatBlock label="Effectif" value={users.length} size="lg" />
        </SurfaceCard>
        <SurfaceCard tinted accent="emerald">
          <StatBlock label="Présents aujourd'hui" value={`${presentCount}/${users.length}`} size="lg" />
        </SurfaceCard>
        <SurfaceCard tinted accent="sky">
          <StatBlock label="Commerciaux" value={commCount} size="lg" />
        </SurfaceCard>
        <SurfaceCard tinted accent="amber">
          <StatBlock label="Sans commercial" value={unassigned} size="lg" />
        </SurfaceCard>
      </div>
    );

    teamSection = (
      <div className="space-y-4">
        <p className="hidden md:block text-callout text-muted-foreground max-w-2xl">
          Comptes connectés : présence du jour, % de stock attribué et menu{" "}
          <span className="font-medium text-foreground">Récupérer ▾</span> pour reprendre
          temporairement les clients d&apos;un collègue absent.
        </p>
        {/* « Voir comme » (admin/direction) — remplace le sélecteur global du menu */}
        <EffectifsPreviewBar />
        <div className="grid gap-3 sm:grid-cols-2">
          {users.map((user) => {
            const name = user.name || user.email || "—";
            // Les clients sont rattachés par TRIGRAMME (ex. « Jean-Michel GUNSLAY »
            // → JMG, « Maxyme MANDINE » → MM), pas par nom complet. On dérive le
            // trigramme (1re lettre de chaque mot) pour retrouver ses clients.
            const trig = name.split(/[\s.\-_]+/).filter(Boolean).map((w) => w[0]?.toUpperCase() ?? "").join("");
            const key = countMap.has(trig) ? trig : (countMap.has(name) ? name : trig);
            const counts = countMap.get(key) ?? { ALL: 0, CHR: 0, GMS: 0, EXPORT: 0, OTHER: 0 };
            const isBootstrapAdmin = !!user.email && bootstrapAdmins.has(user.email.toLowerCase());
            // Trigramme FIABLE pour la bascule vendeur (le `key` dérivé des
            // initiales échoue sur les noms composés/suffixés : « Jean-Michel
            // GUNSLAY » → JMGG). normalizeSlp mappe email/nom → MM/JMG/AG.
            const transferTrig = normalizeSlp(user.email) ?? normalizeSlp(name) ?? (countMap.has(trig) ? trig : null);
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
                isBootstrapAdmin={isBootstrapAdmin}
                isAdmin={isBootstrapAdmin || (adminByUser.get(user.id) ?? false)}
                isPreparateur={prepByUser.get(user.id) ?? false}
                isCommercial={commByUser.get(user.id) ?? true}
                isDirection={dirByUser.get(user.id) ?? false}
                isLivreur={livByUser.get(user.id) ?? false}
                isAgreeur={agrByUser.get(user.id) ?? false}
                canEditAdmin={strictAdmin}
                canTransfer={isManager}
                transferTrig={transferTrig}
                myTrigramme={myTrigramme}
                myName={myName}
              />
            );
          })}
          {users.length === 0 && (
            <div className="col-span-2 rounded-xl border border-border bg-card">
              <EmptyState
                icon={Users}
                title="Aucun compte enregistré"
                description="Les comptes apparaissent après leur première connexion Microsoft."
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        kicker="Équipe & rôles"
        title="Effectifs"
        help={
          <>
            Commerciaux SAP (activité sur 12 mois : CA net, volume BL, clients actifs) et,
            pour les administrateurs, gestion de l&apos;équipe : présence du jour, % de stock
            attribué et rôles (admin, préparateur en charge du stock).
          </>
        }
      />

      {/* Alerte actionnable EN TÊTE : clients orphelins (invisibles dans toute liste). */}
      {isManager && unassignedClients > 0 && (
        <Banner
          tone="warning"
          title={`${unassignedClients} client${unassignedClients > 1 ? "s" : ""} sans commercial assigné`}
          action={
            <Button asChild size="sm" variant="warning">
              <Link href="/clients?commercial=none">Voir</Link>
            </Button>
          }
        >
          Ces clients n&apos;apparaissent dans la liste d&apos;aucun commercial.
        </Banner>
      )}

      {/* ── PERFORMANCE : activité SAP (liste comparative) + état des commissions.
             L'API borne au périmètre : un commercial ne voit que la sienne. ── */}
      <section className="space-y-4">
        <p className="kicker">Performance</p>
        <CommerciauxSapList />
        <CommissionsPanel isManager={isManager} />
      </section>

      {/* ── ÉQUIPE : KPI d'effectif, rôles/présence, puis gestion horaire. Chaque
             employé saisit ses heures ; les managers voient l'équipe et sortent
             les feuilles PDF (compta). ── */}
      <section className="space-y-4">
        <p className="kicker">Équipe</p>
        {teamKpis}
        {teamSection}
        <HeuresPanel isManager={isManager} />
      </section>
    </div>
  );
}
