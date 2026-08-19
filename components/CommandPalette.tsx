"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Users, Search, CornerDownLeft } from "lucide-react";
import { flatNavItems, NAV_FOOTER, type NavItem } from "@/lib/navigation";

/**
 * Mots-clés de recherche PAR ROUTE — métadonnée propre à la palette. La
 * structure de navigation (entrées, libellés, icônes) vient de lib/navigation :
 * une route retirée de la nav disparaît d'ici sans autre maintenance (les clés
 * orphelines de cette map sont simplement ignorées).
 */
const KEYWORDS: Record<string, string> = {
  "/accueil": "home hub notifications tableau de bord",
  // Console fusionnée : couvre aussi l'écran 2 (saisie de commande / BL).
  "/console": "commande bl vente télévente appels écran 2 saisie bon livraison",
  "/clients": "base contacts plan appel televente vendeur commercial assignation incidents retard rappel annuaire",
  "/prospection": "prospects démarchage pipeline nouveaux clients relance",
  // Hub Livraisons : couvre les anciennes vues Par article · À préparer ·
  // Manquants, et désormais Ventes du jour (onglet /ventes-du-jour).
  "/livraisons": "détail livraison préparation dispatch bons transporteur tournée ventes du jour saisies magasin mise en préparation par article récap segments gms chr export à préparer manquants rupture stock négatif déficit",
  "/bons-commande": "bon de commande précommande lot affecter em pending export lots à affecter",
  "/products": "produits stock entrepôt",
  "/articles": "articles référentiel produits fiches",
  "/inventaire": "comptage stock entrepôt",
  "/fabrication": "production deco kit",
  "/fournisseurs": "achats fournisseurs annuaire contacts",
  "/commandes-fournisseurs": "achat fournisseur cf réception commandes",
  "/entrees": "réception marchandise em agréage réserve",
  "/dashboard": "pilotage dashboard géo carte stats statistiques",
  "/dashboard/magasins": "palmarès magasins classement top gms",
  "/encours": "factures impayés clients",
  "/etat-documentaire": "documents archive factures bl état documentaire",
  "/transport": "coût transport transporteur tarif livraison",
  "/commerciaux": "commerciaux objectifs slp équipe personnel préparateur rôles effectifs",
  "/planning": "planning congés cp récup calendrier équipe vacances absences plafond",
  "/salaires": "salaires primes paie éléments cabinet comptable",
  "/parametres": "réglages sap import thème",
};

/** Entrées « Aller à » — dérivées de la source de vérité nav (+ footer). */
const NAV: NavItem[] = [...flatNavItems(), ...NAV_FOOTER];

interface ClientHit { id: string; nom: string; code: string; type?: string | null }

/**
 * Palette de commandes ⌘K / Ctrl+K — navigation instantanée + recherche clients.
 * Montée globalement (cf. app/providers). Façon Linear/Raycast.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [clients, setClients] = useState<ClientHit[]>([]);

  // Raccourci global ⌘K / Ctrl+K (et fermeture Échap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (!open) setQ(""); }, [open]);

  // Recherche clients live (debounce) dès 2 caractères.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setClients([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/clients?search=${encodeURIComponent(term)}&limit=8`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setClients(Array.isArray(j?.clients) ? j.clients : []))
        .catch(() => {});
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  if (!open) return null;

  const ql = q.toLowerCase();
  const navShown = NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql) || (KEYWORDS[n.href] ?? "").includes(ql));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 backdrop-blur-sm p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <Command
        shouldFilter={false}
        label="Palette de commandes"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-border bg-popover shadow-modal overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder="Rechercher une page, un client…"
            className="flex-1 h-12 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-[12.5px] text-muted-foreground">
            Aucun résultat.
          </Command.Empty>

          {navShown.length > 0 && (
            <Command.Group heading="Aller à" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground">
              {navShown.map((n) => {
                const Icon = n.icon;
                return (
                  <Command.Item
                    key={n.href}
                    value={`nav:${n.href}`}
                    onSelect={() => go(n.href)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-foreground/85 cursor-pointer data-[selected=true]:bg-secondary data-[selected=true]:text-foreground"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {n.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {clients.length > 0 && (
            <Command.Group heading="Clients" className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground">
              {clients.map((c) => (
                <Command.Item
                  key={c.id}
                  value={`client:${c.id}`}
                  onSelect={() => go(`/clients/${c.id}`)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-foreground/85 cursor-pointer data-[selected=true]:bg-secondary data-[selected=true]:text-foreground"
                >
                  <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{c.nom}</span>
                  <span className="text-[10.5px] text-muted-foreground shrink-0">{c.code}{c.type ? ` · ${c.type}` : ""}</span>
                  <CornerDownLeft className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
